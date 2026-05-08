const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

// ===== STATE =====
let chatHistory = [];
let isStreaming = false;
let conversations = [];
let currentConversation = null;

// ===== DOM REFS =====
const $ = (sel) => document.querySelector(sel);
const onboarding = $("#onboarding");
const chatScreen = $("#chat-screen");
const messagesEl = $("#messages");
const userInput = $("#user-input");
const sendBtn = $("#send-btn");
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
const docBtn = $("#doc-btn");
const docModal = $("#doc-modal");
const docTopic = $("#doc-topic");
const docFormat = $("#doc-format");
const docContent = $("#doc-content");
const docImages = $("#doc-images");
const docStatus = $("#doc-status");
const docGenerateBtn = $("#doc-generate-btn");
const docCancelBtn = $("#doc-cancel-btn");
const docModalClose = $("#doc-modal-close");

// ===== PROVIDER DEFAULTS =====
const providerDefaults = {
    "ollama-cloud": { url: "https://ollama.com/v1", model: "gemma4:31b" },
  "openai": { url: "https://api.openai.com/v1", model: "gpt-4o" },
  "openrouter": { url: "https://openrouter.ai/api/v1", model: "meta-llama/llama-3-70b" },
  "custom": { url: "http://127.0.0.1:11434/v1", model: "llama3" },
};

// ===== INIT =====
document.addEventListener("DOMContentLoaded", async () => {
  const hasSettings = await invoke("has_settings");
  if (hasSettings) {
    const settings = await invoke("load_settings");
    showChat(settings);
  } else {
    showOnboarding();
  }
  setupEventListeners();
});

function setupEventListeners() {
  // Provider change
  provider.addEventListener("change", () => {
    const defaults = providerDefaults[provider.value];
    if (defaults) {
      baseUrl.value = defaults.url;
      model.value = defaults.model;
    }
  });

  // Test connection
  testBtn.addEventListener("click", async () => {
    connStatus.textContent = "Testing connection...";
    connStatus.className = "connection-status";
    try {
      const result = await invoke("test_connection", {
        apiKey: apiKey.value,
        baseUrl: baseUrl.value,
      });
      connStatus.textContent = "✅ " + result;
      connStatus.className = "connection-status success";
    } catch (err) {
      connStatus.textContent = "❌ " + err;
      connStatus.className = "connection-status error";
    }
  });

  // Save settings
  saveBtn.addEventListener("click", async () => {
    if (!apiKey.value.trim()) {
      connStatus.textContent = "❌ Please enter an API key";
      connStatus.className = "connection-status error";
      return;
    }
    try {
      await invoke("save_settings", {
        settings: {
          api_key: apiKey.value,
          base_url: baseUrl.value,
          model: model.value,
          provider: provider.value,
        },
      });
      const settings = await invoke("load_settings");
      showChat(settings);
    } catch (err) {
      connStatus.textContent = "❌ " + err;
      connStatus.className = "connection-status error";
    }
  });

  // Settings button
  settingsBtn.addEventListener("click", () => {
    showOnboarding(true);
  });

  // Toggle sidebar
  toggleSidebar.addEventListener("click", () => {
    sidebar.classList.toggle("collapsed");
  });

  // New chat
  newChatBtn.addEventListener("click", () => {
    startNewChat();
  });

  // Send message
  sendBtn.addEventListener("click", sendMessage);

  // Input handling
  userInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  userInput.addEventListener("input", () => {
    userInput.style.height = "auto";
    userInput.style.height = Math.min(userInput.scrollHeight, 180) + "px";
  });

  // Quick action buttons
  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      userInput.value = btn.dataset.prompt;
      userInput.focus();
    });
  });

  // Document modal
  docBtn.addEventListener("click", () => {
    docModal.classList.remove("hidden");
    docTopic.value = "";
    docFormat.value = "pdf";
    docContent.value = "";
    docImages.value = "";
    docStatus.textContent = "";
    docStatus.className = "doc-status";
  });

  docModalClose.addEventListener("click", closeDocModal);
  docCancelBtn.addEventListener("click", closeDocModal);
  docModal.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-overlay")) closeDocModal();
  });

  docGenerateBtn.addEventListener("click", generateDocument);

  // Stream listener
  listen("stream-chunk", (event) => {
    const { content, done } = event.payload;
    if (done) {
      finishStreaming();
      return;
    }
    appendStreamContent(content);
  });
}

function closeDocModal() {
  docModal.classList.add("hidden");
}

async function generateDocument() {
  const topic = docTopic.value.trim();
  const format = docFormat.value;
  const content = docContent.value.trim();
  const imagesStr = docImages.value.trim();

  if (!topic) {
    docStatus.textContent = "❌ Please enter a topic";
    docStatus.className = "doc-status error";
    return;
  }
  if (!content) {
    docStatus.textContent = "❌ Please enter document content";
    docStatus.className = "doc-status error";
    return;
  }

  const imageUrls = imagesStr ? imagesStr.split("\n").map(s => s.trim()).filter(s => s.length > 0) : [];

  docGenerateBtn.disabled = true;
  docGenerateBtn.textContent = "Generating...";
  docStatus.textContent = "⏳ Creating document...";
  docStatus.className = "doc-status";

  try {
    const result = await invoke("create_document", {
      topic,
      format,
      content,
      imageUrls,
    });

    docStatus.innerHTML = `✅ ${format.toUpperCase()} created!<br><small>${result.path}</small>`;
    docStatus.className = "doc-status success";

    // Add to chat
    appendMessage("assistant", `📄 Created **${format.toUpperCase()}** document: **${topic}**\n\nSaved to: \`${result.path}\``);
    chatHistory.push({ role: "assistant", content: `📄 Created ${format.toUpperCase()} document: ${topic}\nSaved to: ${result.path}` });
  } catch (err) {
    docStatus.textContent = `❌ Error: ${err}`;
    docStatus.className = "doc-status error";
  } finally {
    docGenerateBtn.disabled = false;
    docGenerateBtn.textContent = "Generate 🔥";
  }
}

// ===== SCREENS =====
function showOnboarding(prefill = false) {
  onboarding.classList.remove("hidden");
  chatScreen.classList.add("hidden");
  if (prefill) {
    invoke("load_settings").then((settings) => {
      apiKey.value = settings.api_key || "";
      baseUrl.value = settings.base_url || "";
      model.value = settings.model || "";
      provider.value = settings.provider || "ollama-cloud";
    });
  }
}

function showChat(settings) {
  onboarding.classList.add("hidden");
  chatScreen.classList.remove("hidden");
  modelBadge.textContent = settings.model || "unknown";
  if (!currentConversation) {
    startNewChat();
  }
}

// ===== CHAT MANAGEMENT =====
function startNewChat() {
  currentConversation = {
    id: Date.now(),
    title: "New Chat",
    messages: [],
  };
  chatHistory = [];
  conversations.push(currentConversation);
  renderChatHistory();
  messagesEl.innerHTML = `
    <div class="welcome-message">
      <div class="welcome-logo">🔥</div>
      <h2>Welcome to Ignis Claw</h2>
      <p>Your AI coding assistant. Ask me anything about code, debugging, or building software.</p>
      <div class="quick-actions">
        <button class="quick-btn" data-prompt="Explain the code in my current project">💡 Explain Code</button>
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
}

function renderChatHistory() {
  chatHistoryEl.innerHTML = conversations
    .slice()
    .reverse()
    .map(
      (c) =>
        `<div class="chat-history-item" data-id="${c.id}">${c.title}</div>`
    )
    .join("");
}

// ===== MESSAGING =====
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || isStreaming) return;

  // Clear welcome screen on first message
  const welcome = messagesEl.querySelector(".welcome-message");
  if (welcome) welcome.remove();

  // Add user message
  chatHistory.push({ role: "user", content: text });
  appendMessage("user", text);

  // Update conversation title
  if (currentConversation && currentConversation.title === "New Chat") {
    currentConversation.title = text.substring(0, 40) + (text.length > 40 ? "..." : "");
    renderChatHistory();
  }

  // Reset input
  userInput.value = "";
  userInput.style.height = "auto";

  // Start streaming
  isStreaming = true;
  sendBtn.disabled = true;
  setStatus("streaming", "Thinking...");
  showThinking();

  try {
    // Build system message
    const messages = [
      {
        role: "system",
        content:
          "You are Ignis Claw (Ignis for short), a powerful AI coding assistant. You help users with software engineering tasks. Be concise, helpful, and format code in markdown code blocks with language tags.",
      },
      ...chatHistory,
    ];

    await invoke("send_message", { messages });
  } catch (err) {
    removeThinking();
    appendMessage("assistant", `❌ Error: ${err}`);
    finishStreaming();
  }
}

let currentStreamEl = null;
let currentStreamContent = "";

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

function appendStreamContent(content) {
  if (!currentStreamEl) {
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

  currentStreamContent += content;
  const bodyEl = currentStreamEl.querySelector(".message-body");
  bodyEl.innerHTML = renderMarkdown(currentStreamContent);
  scrollToBottom();
}

function finishStreaming() {
  if (currentStreamContent) {
    chatHistory.push({ role: "assistant", content: currentStreamContent });
  }
  currentStreamEl = null;
  currentStreamContent = "";
  isStreaming = false;
  sendBtn.disabled = false;
  setStatus("online", "Ready");
}

function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
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

// ===== MARKDOWN RENDERING =====
function renderMarkdown(text) {
  let html = escapeHtml(text);

  // Code blocks: ```lang\ncode\n```
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_, lang, code) =>
      `<pre><code class="language-${lang || "text"}">${code.trim()}</code></pre>`
  );

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Line breaks -> paragraphs
  html = html
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");

  return html;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ===== UTILS =====
function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusText.textContent = text;
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}
