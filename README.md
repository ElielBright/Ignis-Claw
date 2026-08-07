# Ignis-Claw 🔥

An open-source AI Coding Assistant that fits right into your developer workflow. Ignis-Claw consists of a **VS Code Extension** and a **Tauri-powered Desktop Application**, helping you write, edit, search, and document code seamlessly.

This project is built upon the core agent harness principles of Project Claw (a clean-room implementation inspired by Claude Code) and enhanced with client integrations.

---

## Repository Structure

```text
.
├── desktop/           # Tauri-based Desktop application (Vanilla JS + Rust)
├── extension/         # TypeScript-based VS Code extension
├── rust/              # Core Agent harness (Rust port workspace)
├── src/               # CLI / Agent harness (Python workspace)
└── README.md          # Project documentation
```

---

## 🔌 VS Code Extension (`extension/`)

The **Ignis Claw** VS Code extension embeds the AI assistant directly inside your editor.

### Features
* **Chat Panel** – Interact with the AI helper from a side panel.
* **Workspace Read & Write** – Ignis can explain, refactor, edit, and create code files in the active workspace.
* **Full Context Search** – Execute grep searches and glob lists.
* **Terminal Command Execution** – Allows running commands with your explicit approval.
* **Upload UI Designs** – Import layout screenshots directly to generate working front-end code.

### Quick Start
1. Navigate to the `extension/` folder:
   ```bash
   cd extension
   ```
2. Install dependencies and compile:
   ```bash
   npm install
   npm run compile
   ```
3. Open VS Code in extension development mode (or package/install the compiled version `ignis-claw-0.1.0.vsix` already available in the `extension/` directory).
4. Launch the chat sidebar with `Ctrl+Shift+P` → **Ignis Claw: Open Chat**.
5. Set up your preferred API settings (`Ctrl+,` and search for `ignis-claw`).

---

## 💻 Desktop Application (`desktop/`)

A cross-platform desktop application compiling with **Tauri v2** and a fast, responsive Vanilla HTML/CSS/JS frontend.

### Features
* **Multi-Provider AI Client** – Out-of-the-box support for Ollama Cloud, OpenAI, OpenRouter, and Custom OpenAI-compatible local APIs.
* **Tiers of Configurations** – Save API credentials, endpoint URLs, and custom models locally.
* **Chat History** – Keep track of conversations inside a toggleable sidebar.
* **Report & Document Generator** – Generate formatted PDF, DOCX, or PPTX reports directly from markdown formatting and images using Tauri command bindings.

### Build & Run
Ensure you have the Rust toolchain (Rustup) and Node.js installed.
1. Navigate to the `desktop/` directory:
   ```bash
   cd desktop
   ```
2. Build Tauri dependencies and execute:
   ```bash
   npm install
   npm run tauri dev
   ```

---

## 🛠️ CLI & Agent Harness (`rust/` & `src/`)

The repository retains the underlying CLI and agent harness frameworks.
* **Python Harness (`src/`)** – Clean-room Python CLI helper containing command declarations and tool inventories. Run discovery:
  ```bash
  python3 -m src.main summary
  ```
* **Rust Port (`rust/`)** – High-performance agent CLI port containing workspace parser and parser configurations.

---

## ⚙️ Configuration

Both components connect to OpenAI-compatible endpoints. Configure:
* **Provider**: `ollama-cloud`, `openai`, `openrouter`, or `custom`
* **Base URL**: e.g., `https://ollama.com/v1` (default) or `https://api.openai.com/v1`
* **Model**: e.g., `gemma4:31b` or `qwen3-coder:480b`
* **API Key**: Authentication credentials

---

## Disclaimer & Ownership

* This repository does **not** claim ownership of the original Claude Code source material.
* This repository is **not** affiliated with, endorsed by, or maintained by Anthropic.
* Cloned and customized to build tailored VS Code and desktop extension clients.
