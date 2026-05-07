# Ignis Claw 🔥

AI coding assistant for VS Code. Chat with AI, upload UI designs, build projects, and let Ignis read and modify your code — all inside VS Code.

![Banner](media/banner.png)

## Features

- **Chat with AI** – Ask questions, get code help, debug issues
- **Read & Write Files** – Ignis can read your workspace files, make changes, and create new files
- **Search Code** – Grep search and glob file listing across your project
- **Run Commands** – Execute terminal commands (with your approval)
- **Upload UI Designs** – Upload screenshots/designs and get them coded
- **OpenAI Compatible** – Works with OpenAI, OpenRouter, Ollama, or any OpenAI-compatible API

## Quick Start

1. Install the extension
2. Press `Ctrl+Shift+P` → **Ignis Claw: Open Chat**
3. Configure your API key and provider
4. Start coding!

## Tools Available to Ignis

| Tool | Description |
|------|-------------|
| `read_file` | Read any file in your project |
| `write_file` | Write or overwrite files |
| `edit_file` | Make targeted edits to existing files |
| `create_file` | Create new files |
| `list_files` | List files by glob pattern |
| `grep_search` | Search file contents with regex |
| `run_command` | Run terminal commands (approval required) |

## Configuration

Set these in VS Code settings (`Ctrl+,` → search `ignis-claw`):

- `ignis-claw.apiKey` – Your API key
- `ignis-claw.baseUrl` – API base URL (default: `https://ollama.com/v1`)
- `ignis-claw.model` – Model name (default: `qwen3-coder:480b`)
- `ignis-claw.provider` – Provider: `ollama-cloud`, `openai`, `openrouter`, or `custom`
