import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { ToolDefinition, ToolCall } from './tools';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[] | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

export interface ApiSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onToolCalls: (toolCalls: ToolCall[]) => void;
  onDone: (fullContent: string, toolCalls: ToolCall[]) => void;
  onError: (error: string) => void;
}

export async function streamChatCompletion(
  messages: ChatMessage[],
  settings: ApiSettings,
  callbacks: StreamCallbacks,
  tools?: ToolDefinition[]
): Promise<void> {
  const url = new URL(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`);

  const body: Record<string, any> = {
    model: settings.model,
    messages,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    }));
  }

  const bodyStr = JSON.stringify(body);

  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
    },
  };

  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(options, (res) => {
      let buffer = '';
      let fullContent = '';
      let toolCalls: ToolCall[] = [];

      if (!res.statusCode || res.statusCode >= 400) {
        let errorBody = '';
        res.on('data', (chunk: Buffer) => { errorBody += chunk.toString(); });
        res.on('end', () => {
          callbacks.onError(`API error ${res.statusCode}: ${errorBody}`);
          resolve();
        });
        return;
      }

      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') {
            if (trimmed === 'data: [DONE]') {
              if (toolCalls.length > 0) {
                callbacks.onToolCalls(toolCalls);
              }
              callbacks.onDone(fullContent, toolCalls);
            }
            continue;
          }

          if (trimmed.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              const delta = parsed.choices?.[0]?.delta;

              if (delta?.content) {
                fullContent += delta.content;
                callbacks.onChunk(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  while (toolCalls.length <= index) {
                    toolCalls.push({
                      id: '',
                      type: 'function',
                      function: { name: '', arguments: '' },
                    });
                  }
                  if (tc.id) toolCalls[index].id += tc.id;
                  if (tc.function?.name) toolCalls[index].function.name += tc.function.name;
                  if (tc.function?.arguments) toolCalls[index].function.arguments += tc.function.arguments;
                }
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      });

      res.on('end', () => {
        if (toolCalls.length > 0) {
          callbacks.onToolCalls(toolCalls);
        }
        callbacks.onDone(fullContent, toolCalls);
        resolve();
      });
    });

    req.on('error', (err) => {
      callbacks.onError(`Request failed: ${err.message}`);
      resolve();
    });

    req.write(bodyStr);
    req.end();
  });
}
