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
exports.ChatPanel = void 0;
const vscode = __importStar(require("vscode"));
const apiClient_1 = require("./apiClient");
const fileHandler_1 = require("./fileHandler");
const tools_1 = require("./tools");
class ChatPanel {
    constructor(extensionUri, context) {
        this.extensionUri = extensionUri;
        this.messages = [];
        this.currentConversationId = 0;
        this.disposables = [];
        this.pendingFiles = [];
        this.abortController = null;
        this.context = context;
        ChatPanel.currentPanel = this;
        this.panel = vscode.window.createWebviewPanel(ChatPanel.viewType, 'Ignis Claw 🔥', vscode.ViewColumn.Beside, {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(extensionUri, 'media'),
            ],
        });
        this.panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
        this.panel.webview.onDidReceiveMessage((msg) => {
            if (msg.type === 'ready') {
                this.sendSettings();
                this.sendConversationsList();
            }
        });
    }
    reveal() {
        this.panel.reveal();
    }
    addFilesToContext(files) {
        this.pendingFiles.push(...files);
        const names = files.map((f) => f.name).join(', ');
        this.panel.webview.postMessage({
            type: 'filesAttached',
            files: this.pendingFiles.map((f) => ({ name: f.name, isImage: f.isImage })),
        });
        vscode.window.showInformationMessage(`Uploaded ${files.length} file(s) to Ignis Claw: ${names}`);
    }
    dispose() {
        this.saveConversations();
        ChatPanel.currentPanel = undefined;
        this.panel.dispose();
        for (const d of this.disposables)
            d.dispose();
    }
    static createOrShow(extensionUri, context) {
        if (ChatPanel.currentPanel) {
            ChatPanel.currentPanel.reveal();
            return ChatPanel.currentPanel;
        }
        ChatPanel.currentPanel = new ChatPanel(extensionUri, context);
        return ChatPanel.currentPanel;
    }
    // --- Conversation Persistence ---
    getConversations() {
        return this.context.globalState.get(ChatPanel.CONVERSATIONS_KEY, []);
    }
    saveConversations() {
        const conversations = this.getConversations();
        const existing = conversations.findIndex(c => c.id === this.currentConversationId);
        const entry = {
            id: this.currentConversationId,
            title: conversations.find(c => c.id === this.currentConversationId)?.title || 'New Chat',
            messages: this.messages,
            createdAt: conversations.find(c => c.id === this.currentConversationId)?.createdAt || Date.now(),
            updatedAt: Date.now(),
        };
        if (existing >= 0) {
            conversations[existing] = entry;
        }
        else {
            conversations.push(entry);
        }
        this.context.globalState.update(ChatPanel.CONVERSATIONS_KEY, conversations);
    }
    deleteConversation(id) {
        const conversations = this.getConversations().filter(c => c.id !== id);
        this.context.globalState.update(ChatPanel.CONVERSATIONS_KEY, conversations);
        if (this.currentConversationId === id) {
            this.messages = [];
            this.pendingFiles = [];
            this.currentConversationId = Date.now();
        }
    }
    // --- Message handling ---
    async handleMessage(msg) {
        switch (msg.type) {
            case 'sendMessage':
                await this.handleSendMessage(msg.text);
                break;
            case 'getSettings':
                this.sendSettings();
                break;
            case 'saveSettings':
                await this.saveSettings(msg.settings);
                break;
            case 'uploadFile':
                await this.handleUploadFile();
                break;
            case 'removeFile':
                this.handleRemoveFile(msg.index);
                break;
            case 'newChat':
                if (this.messages.length > 0) {
                    this.saveConversations();
                }
                this.messages = [];
                this.pendingFiles = [];
                this.currentConversationId = Date.now();
                this.sendConversationsList();
                break;
            case 'loadConversations':
                this.sendConversationsList();
                break;
            case 'loadConversation':
                this.loadConversation(msg.id);
                break;
            case 'deleteConversation':
                this.deleteConversation(msg.id);
                this.sendConversationsList();
                break;
            case 'renameConversation':
                this.renameConversation(msg.id, msg.title);
                break;
            case 'cancelStream':
                this.cancelStream();
                break;
        }
    }
    sendConversationsList() {
        const conversations = this.getConversations().map(c => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
        }));
        this.postMessage({ type: 'conversationsList', conversations });
    }
    loadConversation(id) {
        if (this.messages.length > 0) {
            this.saveConversations();
        }
        const conversations = this.getConversations();
        const conv = conversations.find(c => c.id === id);
        if (conv) {
            this.messages = conv.messages;
            this.currentConversationId = conv.id;
            this.pendingFiles = [];
            this.postMessage({ type: 'conversationLoaded', id: conv.id, messages: conv.messages, title: conv.title });
        }
    }
    cancelStream() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        this.postMessage({ type: 'cancelled' });
        this.postMessage({ type: 'streamEnd' });
    }
    renameConversation(id, title) {
        const conversations = this.getConversations();
        const conv = conversations.find(c => c.id === id);
        if (conv) {
            conv.title = title;
        }
        if (id === this.currentConversationId) {
            const self = conversations.find(c => c.id === this.currentConversationId);
            if (self)
                self.title = title;
        }
        this.context.globalState.update(ChatPanel.CONVERSATIONS_KEY, conversations);
        this.sendConversationsList();
    }
    handleRemoveFile(index) {
        if (index >= 0 && index < this.pendingFiles.length) {
            const removed = this.pendingFiles.splice(index, 1)[0];
            this.panel.webview.postMessage({
                type: 'filesAttached',
                files: this.pendingFiles.map((f) => ({ name: f.name, isImage: f.isImage })),
            });
            vscode.window.showInformationMessage(`Removed ${removed.name} from context`);
        }
    }
    async handleSendMessage(text) {
        const settings = this.getSettings();
        if (!settings.apiKey) {
            this.postMessage({
                type: 'assistantMessage',
                text: '⚠️ **API key not configured.**\n\nPlease set your API key in VS Code settings (`File → Preferences → Settings → Ignis Claw`) or use the settings button in the sidebar.',
            });
            return;
        }
        let userContent = text;
        if (this.pendingFiles.length > 0) {
            const parts = [{ type: 'text', text }];
            for (const file of this.pendingFiles) {
                if (file.isImage) {
                    parts.push({
                        type: 'image_url',
                        image_url: { url: `data:${file.mimeType};base64,${file.content}` },
                    });
                }
                else {
                    const decoded = Buffer.from(file.content, 'base64').toString('utf-8');
                    parts.push({
                        type: 'text',
                        text: `\n\n[File: ${file.name}]\n\`\`\`\n${decoded}\n\`\`\``,
                    });
                }
            }
            userContent = parts;
        }
        this.messages.push({ role: 'user', content: userContent });
        this.pendingFiles = [];
        this.postMessage({ type: 'userMessage', text });
        this.saveConversations();
        const systemPrompt = 'You are Ignis Claw (Ignis for short), a powerful AI coding assistant running as a VS Code extension. ' +
            'You help users with software engineering tasks: writing code, explaining code, ' +
            'debugging, refactoring, building projects from scratch, and analyzing UI designs. ' +
            'When users upload UI design images, carefully analyze the layout, colors, components, ' +
            'and structure to generate accurate code. ' +
            'You have access to tools that let you read and write files in the user\'s workspace, ' +
            'search code, list files, and run commands. ' +
            'When working on a task, use tools proactively to explore the codebase, make changes, ' +
            'and verify your work. Read files before editing them. ' +
            'Be concise and helpful. Always format code in markdown code blocks with language tags. ' +
            'IMPORTANT: After making changes to files, briefly summarize what you changed and why.';
        await this.runToolLoop(systemPrompt, settings);
    }
    async runToolLoop(systemPrompt, settings) {
        let toolResultMessages = [];
        let turnCount = 0;
        const maxTurns = 25;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        let cancelled = false;
        signal.addEventListener('abort', () => { cancelled = true; }, { once: true });
        for (let turns = 0; turns < maxTurns && !cancelled; turns++) {
            turnCount++;
            const allMessages = [
                { role: 'system', content: systemPrompt },
                ...this.messages,
                ...toolResultMessages,
            ];
            let currentText = '';
            let currentToolCalls = [];
            let hadError = false;
            this.postMessage({ type: 'streamStart' });
            await (0, apiClient_1.streamChatCompletion)(allMessages, settings, {
                onChunk: (content) => {
                    currentText += content;
                    this.postMessage({ type: 'streamChunk', content });
                },
                onToolCalls: (toolCalls) => {
                    currentToolCalls = toolCalls;
                },
                onDone: (fullContent) => {
                    currentText = fullContent;
                },
                onError: (error) => {
                    hadError = true;
                    this.postMessage({ type: 'error', text: error });
                },
            }, tools_1.toolDefinitions, signal);
            if (cancelled)
                break;
            if (hadError) {
                this.postMessage({ type: 'streamEnd' });
                return;
            }
            this.postMessage({ type: 'streamEnd' });
            if (currentToolCalls.length === 0) {
                this.messages.push({ role: 'assistant', content: currentText });
                this.saveConversations();
                this.sendConversationsList();
                return;
            }
            this.messages.push({
                role: 'assistant',
                content: currentText || null,
                tool_calls: currentToolCalls,
            });
            const toolCallResults = [];
            for (const tc of currentToolCalls) {
                this.postMessage({
                    type: 'toolStart',
                    toolCall: {
                        name: tc.function.name,
                        args: tc.function.arguments,
                    },
                });
                const result = await (0, tools_1.executeTool)(tc);
                this.postMessage({
                    type: 'toolEnd',
                    toolCall: {
                        name: tc.function.name,
                        args: tc.function.arguments,
                    },
                    result: result.content,
                    isError: result.isError,
                });
                toolCallResults.push(result);
            }
            toolResultMessages = toolCallResults;
        }
        this.abortController = null;
        if (!cancelled) {
            this.messages.push({
                role: 'assistant',
                content: `Reached maximum of ${maxTurns} tool call turns. If you need more, please ask me to continue.`,
            });
        }
    }
    async handleUploadFile() {
        const files = await (0, fileHandler_1.uploadDesign)();
        if (files) {
            this.addFilesToContext(files);
        }
    }
    // --- Settings ---
    getSettings() {
        const config = vscode.workspace.getConfiguration('ignis-claw');
        return {
            apiKey: config.get('apiKey') || '',
            baseUrl: config.get('baseUrl') || 'https://ollama.com/v1',
            model: config.get('model') || 'gemma4:31b',
            provider: config.get('provider') || 'ollama-cloud',
            clawPath: config.get('clawPath') || '',
        };
    }
    sendSettings() {
        const s = this.getSettings();
        this.postMessage({
            type: 'settings',
            settings: {
                apiKey: s.apiKey,
                baseUrl: s.baseUrl,
                model: s.model,
                provider: s.provider,
            },
        });
    }
    async saveSettings(settings) {
        const config = vscode.workspace.getConfiguration('ignis-claw');
        await config.update('apiKey', settings.apiKey, vscode.ConfigurationTarget.Global);
        await config.update('baseUrl', settings.baseUrl, vscode.ConfigurationTarget.Global);
        await config.update('model', settings.model, vscode.ConfigurationTarget.Global);
        await config.update('provider', settings.provider, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('Ignis Claw settings saved!');
    }
    // --- Helpers ---
    postMessage(msg) {
        this.panel.webview.postMessage(msg);
    }
    getHtml() {
        const stylesUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'styles.css'));
        const scriptUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'chat.js'));
        const logoUri = this.panel.webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'logo.png'));
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel.webview.cspSource} 'unsafe-inline'; font-src https://fonts.gstatic.com; img-src ${this.panel.webview.cspSource} data: https:; script-src 'nonce-ignis';">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="${stylesUri}">
  <title>Ignis Claw</title>
</head>
<body>
  <div class="crt-overlay"></div>
  <div id="onboarding" class="screen">
    <div class="onboard-container">
      <div class="onboard-logo">
        <span class="fire-icon">🔥</span>
        <h1>Ignis Claw</h1>
        <p class="tagline">AI Coding Assistant</p>
      </div>
      <div class="onboard-form">
        <div class="form-group">
          <label for="provider">Provider</label>
          <select id="provider">
            <option value="ollama-cloud">Ollama Cloud</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom OpenAI-Compatible</option>
          </select>
        </div>
        <div class="form-group">
          <label for="api-key">API Key</label>
          <input type="password" id="api-key" placeholder="Paste your API key here..." />
        </div>
        <div class="form-group">
          <label for="base-url">Base URL</label>
          <input type="text" id="base-url" value="https://ollama.com/v1" />
        </div>
        <div class="form-group">
          <label for="model">Model</label>
          <input type="text" id="model" value="gemma4:31b" placeholder="e.g. gpt-4o, claude-sonnet" />
        </div>
        <div id="connection-status" class="connection-status"></div>
        <div class="onboard-actions">
          <button id="test-btn" class="btn-secondary">Test Connection</button>
          <button id="save-btn" class="btn-primary">Start Chatting 🔥</button>
        </div>
      </div>
    </div>
  </div>

  <div id="chat-screen" class="screen hidden">
    <aside id="sidebar">
      <div class="sidebar-header">
        <span class="fire-icon-sm">🔥</span>
        <span class="sidebar-title">Ignis</span>
      </div>
      <nav class="sidebar-nav">
        <button id="new-chat-btn" class="sidebar-btn active" title="New Chat">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
          <span>New Chat</span>
        </button>
      </nav>
      <div id="chat-history" class="chat-history"></div>
      <div class="sidebar-footer">
        <button id="settings-btn" class="sidebar-btn" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          <span>Settings</span>
        </button>
        <div class="model-badge" id="model-badge"></div>
      </div>
    </aside>

    <main id="chat-main">
      <div id="chat-header" class="chat-header">
        <div class="header-left">
          <button id="toggle-sidebar" class="icon-btn" title="Toggle Sidebar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          </button>
          <h2>Ignis Claw <span class="version-tag">v0.2</span></h2>
        </div>
        <div class="header-right">
          <button id="upload-btn" class="icon-btn" title="Upload UI Design or File">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <span id="status-dot" class="status-dot online"></span>
          <span id="status-text" class="status-text">Ready</span>
        </div>
      </div>

      <div id="messages" class="messages">
        <div class="welcome-message arcade-welcome">
          <div class="welcome-logo">
            <img src="${logoUri}" alt="Ignis Claw Logo" class="custom-logo" />
          </div>
          <h2>SYSTEM_READY // IGNIS_CLAW_OS</h2>
          <p>> INITIALIZING_COGNITIVE_CORE...<br>> AWAITING_USER_INPUT_</p>
          <div class="quick-actions">
            <button class="quick-btn" data-prompt="Read the current project structure and explain what it does">💡 Explain Project</button>
            <button class="quick-btn" data-prompt="Help me debug an error">🐛 Debug Error</button>
            <button class="quick-btn" data-prompt="Write a function that">⚡ Write Code</button>
            <button class="quick-btn" data-prompt="Refactor this code to be more efficient">🔧 Refactor</button>
          </div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <textarea id="user-input" placeholder="Ask Ignis to read code, make changes, run commands..." rows="1"></textarea>
          <button id="send-btn" class="send-btn" title="Send message">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>
          </button>
        </div>
        <p class="input-hint">Press <kbd>Enter</kbd> to send · <kbd>Shift+Enter</kbd> for new line</p>
      </div>
    </main>
  </div>

  <script nonce="ignis">
    window.IGNIS_CLAW_LOGO = "${logoUri}";
  </script>
  <script nonce="ignis" src="${scriptUri}"></script>
</body>
</html>`;
    }
}
exports.ChatPanel = ChatPanel;
ChatPanel.viewType = 'ignisClaw.chat';
ChatPanel.CONVERSATIONS_KEY = 'ignis-claw.conversations';
//# sourceMappingURL=chatPanel.js.map