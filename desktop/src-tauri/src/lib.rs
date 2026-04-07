use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub api_key: String,
    pub base_url: String,
    pub model: String,
    pub provider: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            api_key: String::new(),
            base_url: "https://ollama.com/v1".to_string(),
            model: "qwen3-coder:480b".to_string(),
            provider: "ollama-cloud".to_string(),
        }
    }
}

fn settings_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join(".ignis");
    let _ = fs::create_dir_all(&dir);
    dir.join("config.json")
}

#[tauri::command]
fn load_settings() -> AppSettings {
    let path = settings_path();
    match fs::read_to_string(&path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
        Err(_) => AppSettings::default(),
    }
}

#[tauri::command]
fn save_settings(settings: AppSettings) -> Result<(), String> {
    let path = settings_path();
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn has_settings() -> bool {
    let settings = load_settings();
    !settings.api_key.is_empty() && !settings.base_url.is_empty()
}

#[derive(Serialize, Clone)]
struct StreamChunk {
    content: String,
    done: bool,
}

#[tauri::command]
async fn send_message(
    app: AppHandle,
    messages: Vec<serde_json::Value>,
) -> Result<(), String> {
    let settings = load_settings();

    let url = format!("{}/chat/completions", settings.base_url.trim_end_matches('/'));

    let body = serde_json::json!({
        "model": settings.model,
        "messages": messages,
        "stream": true,
    });

    let client = reqwest::Client::new();
    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", settings.api_key))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("API error {}: {}", status, text));
    }

    let mut stream = response.bytes_stream();
    let mut buffer = String::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        let text = String::from_utf8_lossy(&chunk);
        buffer.push_str(&text);

        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() || line == "data: [DONE]" {
                if line == "data: [DONE]" {
                    let _ = app.emit("stream-chunk", StreamChunk {
                        content: String::new(),
                        done: true,
                    });
                }
                continue;
            }

            if let Some(json_str) = line.strip_prefix("data: ") {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(json_str) {
                    if let Some(content) = parsed["choices"][0]["delta"]["content"].as_str() {
                        let _ = app.emit("stream-chunk", StreamChunk {
                            content: content.to_string(),
                            done: false,
                        });
                    }
                }
            }
        }
    }

    let _ = app.emit("stream-chunk", StreamChunk {
        content: String::new(),
        done: true,
    });

    Ok(())
}

#[tauri::command]
async fn test_connection(api_key: String, base_url: String) -> Result<String, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("Connection failed: {}", e))?;

    if response.status().is_success() {
        Ok("Connected successfully!".to_string())
    } else {
        Err(format!("API returned status {}", response.status()))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            has_settings,
            send_message,
            test_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ignis Claw");
}
