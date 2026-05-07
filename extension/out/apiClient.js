"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.streamChatCompletion = streamChatCompletion;
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const url_1 = require("url");
async function streamChatCompletion(messages, settings, callbacks, tools) {
    const url = new url_1.URL(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`);
    const body = {
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
            let toolCalls = [];
            if (!res.statusCode || res.statusCode >= 400) {
                let errorBody = '';
                res.on('data', (chunk) => { errorBody += chunk.toString(); });
                res.on('end', () => {
                    callbacks.onError(`API error ${res.statusCode}: ${errorBody}`);
                    resolve();
                });
                return;
            }
            res.on('data', (chunk) => {
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
                                    if (tc.id)
                                        toolCalls[index].id += tc.id;
                                    if (tc.function?.name)
                                        toolCalls[index].function.name += tc.function.name;
                                    if (tc.function?.arguments)
                                        toolCalls[index].function.arguments += tc.function.arguments;
                                }
                            }
                        }
                        catch {
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
//# sourceMappingURL=apiClient.js.map