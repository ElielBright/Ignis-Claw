(function () {
  const vscode = acquireVsCodeApi();

  let chatHistory = [];
  let isStreaming = false;
  let conversations = [];
  let currentConversation = null;
  let currentStreamEl = null;
  let currentStreamContent = "";
  let attachedFiles = [];

  const $ = (sel) => document.querySelector(sel);
  const stopIconSVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  const sendIconSVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></svg>';

  const onboarding = $("#onboarding");
  const chatScreen = $("#chat-screen");
  const messagesEl = $("#messages");
  const userInput = $("#user-input");
  const sendBtn = $("#send-btn");
  const uploadBtn = $("#upload-btn");
  const statusDot = $("#status-dot");
  const statusText = $("#status-text");
  const modelBadge = $("#model-badge");
  const provider = $("#provider");
  const apiKey = $("#api-key");
  const baseUrl = $("#base-url");
  const model = $("#model");
  const testBtn = $("#test-btn");
  const saveBtn = $("#save-btn");
  const connStatus = $("#connection-status");
  const settingsBtn = $("#settings-btn");
  const newChatBtn = $("#new-chat-btn");
  const toggleSidebar = $("#toggle-sidebar");
  const sidebar = $("#sidebar");
  const chatHistoryEl = $("#chat-history");

  const providerDefaults = {
    "ollama-cloud": { url: "https://ollama.com/v1", model: "qwen3-coder:480b" },
    "openai": { url: "https://api.openai.com/v1", model: "gpt-4o" },
    "openrouter": { url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3-70b" },
    "custom": { url: "http://127.0.0.1:11434/v1", model: "llama3" },
  };

  document.addEventListener("DOMContentLoaded", () => {
    vscode.postMessage({ type: "getSettings" });
    vscode.postMessage({ type: "loadConversations" });
    setupEventListeners();
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    switch (msg.type) {
      case "settings":
        handleSettings(msg.settings);
        break;
      case "userMessage":
        appendMessage("user", msg.text);
        break;
      case "assistantMessage":
        appendMessage("assistant", msg.text);
        break;
      case "streamStart":
        startStreaming();
        break;
      case "streamChunk":
        appendStreamContent(msg.content);
        break;
      case "streamEnd":
        finishStreaming();
        break;
      case "error":
        removeThinking();
        appendMessage("assistant", "❌ Error: " + msg.text);
        finishStreaming();
        break;
      case "filesAttached":
        attachedFiles = msg.files || [];
        updateFileBadge();
        break;
      case "toolStart":
        showToolCall(msg.toolCall);
        break;
      case "toolEnd":
        finishToolCall(msg.toolCall, msg.result, msg.isError);
        break;
      case "conversationsList":
        conversations = msg.conversations || [];
        renderChatHistory();
        break;
      case "conversationLoaded":
        loadConversationMessages(msg.messages, msg.title);
        break;
      case "cancelled":
        removeCurrentStream();
        appendMessage("assistant", "_\[Response cancelled\]_");
        break;
    }
  });

  function handleSettings(settings) {
    if (settings.apiKey && settings.baseUrl) {
      showChat(settings);
    } else {
      showOnboarding();
    }
    if (settings.apiKey) apiKey.value = settings.apiKey;
    if (settings.baseUrl) baseUrl.value = settings.baseUrl;
    if (settings.model) model.value = settings.model;
    if (settings.provider) {
      provider.value = settings.provider;
      const defaults = providerDefaults[settings.provider];
      if (defaults) {
        baseUrl.value = settings.baseUrl || defaults.url;
        model.value = settings.model || defaults.model;
      }
    }
  }

  function setupEventListeners() {
    provider.addEventListener("change", () => {
      const defaults = providerDefaults[provider.value];
      if (defaults) {
        baseUrl.value = defaults.url;
        model.value = defaults.model;
      }
    });

    testBtn.addEventListener("click", async () => {
      connStatus.textContent = "Testing connection...";
      connStatus.className = "connection-status";
      try {
        const resp = await fetch(baseUrl.value.replace(/\/+$/, "") + "/models", {
          headers: { Authorization: "Bearer " + apiKey.value },
        });
        if (resp.ok) {
          connStatus.textContent = "✅ Connected successfully!";
          connStatus.className = "connection-status success";
        } else {
          connStatus.textContent = "❌ API returned status " + resp.status;
          connStatus.className = "connection-status error";
        }
      } catch (err) {
        connStatus.textContent = "❌ " + err.message;
        connStatus.className = "connection-status error";
      }
    });

    saveBtn.addEventListener("click", () => {
      if (!apiKey.value.trim()) {
        connStatus.textContent = "❌ Please enter an API key";
        connStatus.className = "connection-status error";
        return;
      }
      vscode.postMessage({
        type: "saveSettings",
        settings: {
          apiKey: apiKey.value,
          baseUrl: baseUrl.value,
          model: model.value,
          provider: provider.value,
        },
      });
      showChat({
        apiKey: apiKey.value,
        baseUrl: baseUrl.value,
        model: model.value,
        provider: provider.value,
      });
    });

    settingsBtn.addEventListener("click", () => {
      showOnboarding(true);
    });

    toggleSidebar.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });

    newChatBtn.addEventListener("click", () => {
      startNewChat();
    });

    sendBtn.addEventListener("click", sendMessage);
    uploadBtn.addEventListener("click", () => {
      vscode.postMessage({ type: "uploadFile" });
    });

    userInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    userInput.addEventListener("input", () => {
      userInput.style.height = "auto";
      userInput.style.height = Math.min(userInput.scrollHeight, 180) + "px";
    });

    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        userInput.value = btn.dataset.prompt;
        userInput.focus();
      });
    });
  }

  function showOnboarding(prefill) {
    onboarding.classList.remove("hidden");
    chatScreen.classList.add("hidden");
  }

  function showChat(settings) {
    onboarding.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    modelBadge.textContent = settings.model || "unknown";
    if (!currentConversation || !messagesEl.querySelector(".welcome-message, .message")) {
      startNewChat();
    }
  }

  function startNewChat() {
    currentConversation = {
      id: Date.now(),
      title: "New Chat",
      messages: [],
    };
    chatHistory = [];
    attachedFiles = [];
    messagesEl.innerHTML = `
      <div class="welcome-message">
        <div class="welcome-logo">🔥</div>
        <h2>Welcome to Ignis Claw</h2>
        <p>Your AI coding assistant. Chat, upload UI designs, build projects – all inside VS Code.</p>
        <div class="quick-actions">
          <button class="quick-btn" data-prompt="Read the current project structure and explain what it does">💡 Explain Project</button>
          <button class="quick-btn" data-prompt="Help me debug an error">🐛 Debug Error</button>
          <button class="quick-btn" data-prompt="Write a function that">⚡ Write Code</button>
          <button class="quick-btn" data-prompt="Refactor this code to be more efficient">🔧 Refactor</button>
        </div>
      </div>`;
    document.querySelectorAll(".quick-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        userInput.value = btn.dataset.prompt;
        userInput.focus();
      });
    });
    vscode.postMessage({ type: "newChat" });
  }

  function renderChatHistory() {
    if (!chatHistoryEl) return;
    chatHistoryEl.innerHTML = conversations
      .slice()
      .reverse()
      .map(
        (c) =>
          `<div class="chat-history-item" data-id="${c.id}" title="${escapeHtml(c.title)}">
            <span class="history-item-title">${escapeHtml(c.title)}</span>
            <button class="history-delete-btn" data-id="${c.id}" title="Delete conversation">×</button>
          </div>`
      )
      .join("");

    chatHistoryEl.querySelectorAll(".chat-history-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.target.classList.contains("history-delete-btn")) return;
        const id = parseInt(item.dataset.id);
        if (id === currentConversation?.id) return;
        vscode.postMessage({ type: "loadConversation", id });
      });
    });

    chatHistoryEl.querySelectorAll(".history-delete-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id);
        if (confirm("Delete this conversation?")) {
          vscode.postMessage({ type: "deleteConversation", id });
          if (currentConversation?.id === id) {
            startNewChat();
          }
        }
      });
    });
  }

  function loadConversationMessages(messages, title) {
    messagesEl.innerHTML = "";
    chatHistory = messages || [];
    attachedFiles = [];

    const hasMessages = messages && messages.length > 0;

    if (!hasMessages) {
      currentConversation = { id: Date.now(), title: "New Chat", messages: [] };
      startNewChat();
      return;
    }

    currentConversation = {
      id: conversations.find(c => c.title === title || c.id === Date.now())?.id || Date.now(),
      title: title || "Chat",
      messages: messages,
    };

    for (const msg of messages) {
      if (msg.role === "user") {
        const content = typeof msg.content === "string" ? msg.content : "[File upload]";
        appendMessage("user", content);
      } else if (msg.role === "assistant") {
        const content = typeof msg.content === "string" ? msg.content : "";
        if (content) appendMessage("assistant", content);
      }
    }

    renderChatHistory();
    scrollToBottom();
  }

  function sendMessage() {
    if (isStreaming) {
      vscode.postMessage({ type: "cancelStream" });
      return;
    }

    const text = userInput.value.trim();
    if (!text) return;

    const welcome = messagesEl.querySelector(".welcome-message");
    if (welcome) welcome.remove();

    if (currentConversation && currentConversation.title === "New Chat") {
      currentConversation.title =
        text.substring(0, 40) + (text.length > 40 ? "..." : "");
      renderChatHistory();
      vscode.postMessage({
        type: "renameConversation",
        id: currentConversation.id,
        title: currentConversation.title,
      });
    }

    userInput.value = "";
    userInput.style.height = "auto";
    isStreaming = true;
    sendBtn.innerHTML = stopIconSVG;
    sendBtn.classList.add("stop-btn");
    setStatus("streaming", "Thinking...");
    showThinking();

    vscode.postMessage({ type: "sendMessage", text });
  }

  function updateFileBadge() {
    let badge = document.getElementById("file-badge");
    if (attachedFiles.length > 0) {
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "file-badge";
        badge.className = "file-badge";
        document.querySelector(".input-hint").before(badge);
      }
      const items = attachedFiles.map((f, i) =>
        `<span class="file-badge-item">
          <span class="file-badge-name">${escapeHtml(f.name)}</span>
          <button class="file-badge-remove" data-index="${i}" title="Remove file">×</button>
        </span>`
      ).join(" ");
      badge.innerHTML = "📎 " + items;
      badge.querySelectorAll(".file-badge-remove").forEach((btn) => {
        btn.addEventListener("click", () => {
          const index = parseInt(btn.dataset.index);
          vscode.postMessage({ type: "removeFile", index });
        });
      });
    } else {
      if (badge) badge.remove();
    }
  }

  function showToolCall(toolCall) {
    removeThinking();
    const div = document.createElement("div");
    div.className = "tool-call";
    div.id = "tool-" + Date.now();
    let args;
    try {
      const parsed = JSON.parse(toolCall.args);
      args = Object.entries(parsed).map(([k, v]) =>
        `<div class="tool-arg"><span class="tool-arg-key">${k}:</span> <span class="tool-arg-val">${escapeHtml(String(v).substring(0, 200))}</span></div>`
      ).join("");
    } catch {
      args = escapeHtml(toolCall.args.substring(0, 200));
    }
    div.innerHTML = `
      <div class="tool-call-header">
        <span class="tool-call-icon">🛠</span>
        <span class="tool-call-name">${escapeHtml(toolCall.name)}</span>
        <span class="tool-call-status running">running...</span>
      </div>
      <div class="tool-call-args">${args}</div>
      <div class="tool-call-result hidden"></div>
    `;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function finishToolCall(toolCall, result, isError) {
    const runningEl = document.querySelector(".tool-call:last-child");
    if (!runningEl) return;
    const statusEl = runningEl.querySelector(".tool-call-status");
    statusEl.className = "tool-call-status " + (isError ? "error" : "done");
    statusEl.textContent = isError ? "failed" : "done";
    const resultEl = runningEl.querySelector(".tool-call-result");
    resultEl.classList.remove("hidden");
    const preview = result.substring(0, 500);
    resultEl.innerHTML = `<pre class="tool-result-pre">${escapeHtml(preview)}${result.length > 500 ? '\n... (truncated)' : ''}</pre>`;
    scrollToBottom();
  }

  function showThinking() {
    const div = document.createElement("div");
    div.id = "thinking";
    div.className = "message assistant";
    div.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">🔥</div>
        <span class="message-author">Ignis</span>
      </div>
      <div class="thinking-indicator">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
        <span>Thinking...</span>
      </div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function removeThinking() {
    const thinking = document.getElementById("thinking");
    if (thinking) thinking.remove();
  }

  function removeCurrentStream() {
    if (currentStreamEl && currentStreamEl.parentNode) {
      currentStreamEl.parentNode.removeChild(currentStreamEl);
    }
    currentStreamEl = null;
    currentStreamContent = "";
  }

  function startStreaming() {
    removeThinking();
    currentStreamEl = document.createElement("div");
    currentStreamEl.className = "message assistant";
    currentStreamEl.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">🔥</div>
        <span class="message-author">Ignis</span>
      </div>
      <div class="message-body"></div>`;
    messagesEl.appendChild(currentStreamEl);
    currentStreamContent = "";
  }

  function appendStreamContent(content) {
    if (!currentStreamEl) return;
    currentStreamContent += content;
    const bodyEl = currentStreamEl.querySelector(".message-body");
    bodyEl.innerHTML = renderMarkdown(currentStreamContent);
    scrollToBottom();
  }

  function finishStreaming() {
    currentStreamEl = null;
    currentStreamContent = "";
    isStreaming = false;
    sendBtn.innerHTML = sendIconSVG;
    sendBtn.classList.remove("stop-btn");
    setStatus("online", "Ready");
  }

  function appendMessage(role, content) {
    const div = document.createElement("div");
    div.className = "message " + role;
    const avatar = role === "user" ? "U" : "🔥";
    const author = role === "user" ? "You" : "Ignis";
    div.innerHTML = `
      <div class="message-header">
        <div class="message-avatar">${avatar}</div>
        <span class="message-author">${author}</span>
      </div>
      <div class="message-body">${renderMarkdown(content)}</div>`;
    messagesEl.appendChild(div);
    scrollToBottom();
  }

  function renderMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(
      /```(\w*)\n([\s\S]*?)```/g,
      (_, lang, code) =>
        `<pre><code class="language-${lang || "text"}">${code.trim()}</code></pre>`
    );

    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

    html = html
      .split("\n\n")
      .map((p) => "<p>" + p.replace(/\n/g, "<br>") + "</p>")
      .join("");

    return html;
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function setStatus(state, text) {
    statusDot.className = "status-dot " + state;
    statusText.textContent = text;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }
})();
