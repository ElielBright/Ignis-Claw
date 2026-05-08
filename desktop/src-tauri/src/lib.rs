use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Cursor, Write, Read};
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};
use futures_util::StreamExt;
use printpdf::*;
use image::io::Reader as ImageReader;
use zip::ZipWriter;
use zip::write::FileOptions;
use chrono::Local;

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

fn download_image(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("Failed to download image: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Image download failed with status {}", response.status()));
    }
    let bytes = response.bytes().map_err(|e| format!("Failed to read image bytes: {}", e))?;
    Ok(bytes.to_vec())
}

fn documents_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let dir = home.join("Documents").join("IgnisClaw");
    let _ = fs::create_dir_all(&dir);
    dir
}

#[derive(Debug, Serialize)]
pub struct DocumentResult {
    pub path: String,
    pub format: String,
    pub title: String,
}

#[tauri::command]
async fn create_document(
    topic: String,
    format: String,
    content: String,
    image_urls: Vec<String>,
) -> Result<DocumentResult, String> {
    let out_dir = documents_dir();
    let timestamp = Local::now().format("%Y%m%d_%H%M%S");
    let safe_topic = topic.replace(|c: char| !c.is_alphanumeric() && c != ' ', "_").replace(' ', "_");
    let title = format!("{}_{}", safe_topic, timestamp);

    let result = match format.to_lowercase().as_str() {
        "pdf" => generate_pdf(&out_dir, &title, &topic, &content, &image_urls),
        "docx" => generate_docx(&out_dir, &title, &topic, &content, &image_urls),
        "pptx" => generate_pptx(&out_dir, &title, &topic, &content, &image_urls),
        _ => Err(format!("Unsupported format: {}. Use pdf, docx, or pptx.", format)),
    }?;

    Ok(result)
}

// ─── PDF Generation ───────────────────────────────────────────────────────────

fn generate_pdf(
    out_dir: &PathBuf,
    title: &str,
    topic: &str,
    content: &str,
    image_urls: &[String],
) -> Result<DocumentResult, String> {
    let (doc, page1, layer1) = PdfDocument::new(
        topic,
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let font = doc.add_builtin_font(BuiltinFont::Helvetica)?;
    let font_bold = doc.add_builtin_font(BuiltinFont::HelveticaBold)?;

    let current_layer = doc.get_page(page1).get_layer(layer1);
    let mut y_pos = 270.0;

    // Title
    current_layer.use_text(topic, 24.0, Mm(20.0), Mm(y_pos), &font_bold);
    y_pos -= 15.0;

    let date = Local::now().format("%B %d, %Y").to_string();
    current_layer.use_text(&date, 10.0, Mm(20.0), Mm(y_pos), &font);
    y_pos -= 20.0;

    // Content
    let mut current_page = page1;
    let mut current_layer_id = layer1;

    for line in content.lines() {
        if y_pos < 30.0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), "Layer 1");
            current_page = new_page;
            current_layer_id = new_layer;
            y_pos = 270.0;
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            y_pos -= 6.0;
            continue;
        }

        let font_size = if trimmed.starts_with("## ") { 16.0 }
            else if trimmed.starts_with("# ") { 20.0 }
            else if trimmed.starts_with("### ") { 14.0 }
            else { 10.0 };

        let clean_text = trimmed.trim_start_matches(|c| c == '#' || c == ' ').trim();
        let use_font = if font_size > 10.0 { &font_bold } else { &font };

        let layer = doc.get_page(current_page).get_layer(current_layer_id);
        layer.use_text(clean_text, font_size, Mm(20.0), Mm(y_pos), use_font);
        y_pos -= font_size * 0.7;
    }

    // Page numbers
    let total_pages = doc.page_count();
    for i in 0..total_pages {
        let page = doc.get_page(i);
        let layer = page.get_layer(page.layer_count() - 1);
        layer.use_text(
            &format!("Page {} of {}", i + 1, total_pages),
            8.0,
            Mm(180.0),
            Mm(10.0),
            &font,
        );
    }

    let file_path = out_dir.join(format!("{}.pdf", title));
    let file = fs::File::create(&file_path).map_err(|e| format!("Failed to create PDF file: {}", e))?;
    doc.save(&mut BufWriter::new(file)).map_err(|e| format!("Failed to save PDF: {}", e))?;

    Ok(DocumentResult {
        path: file_path.to_string_lossy().to_string(),
        format: "pdf".to_string(),
        title: topic.to_string(),
    })
}

// ─── DOCX Generation ──────────────────────────────────────────────────────────

fn generate_docx(
    out_dir: &PathBuf,
    title: &str,
    topic: &str,
    content: &str,
    _image_urls: &[String],
) -> Result<DocumentResult, String> {
    let file_path = out_dir.join(format!("{}.docx", title));
    let file = fs::File::create(&file_path).map_err(|e| format!("Failed to create DOCX: {}", e))?;
    let mut zip = ZipWriter::new(file);

    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // [Content_Types].xml
    zip.start_file("[Content_Types].xml", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#)?;

    // _rels/.rels
    zip.start_file("_rels/.rels", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#)?;

    // word/_rels/document.xml.rels
    zip.start_file("word/_rels/document.xml.rels", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#)?;

    // Build document body XML
    let mut body_xml = String::new();
    body_xml.push_str("<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">");
    body_xml.push_str("<w:body>");

    // Title paragraph
    body_xml.push_str(&format!(
        "<w:p><w:pPr><w:pStyle w:val=\"Title\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
        escape_xml(topic)
    ));

    // Date
    let date = Local::now().format("%B %d, %Y").to_string();
    body_xml.push_str(&format!(
        "<w:p><w:r><w:rPr><w:i/><w:sz w:val=\"20\"/></w:rPr><w:t>{}</w:t></w:r></w:p>",
        escape_xml(&date)
    ));

    // Content paragraphs
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            body_xml.push_str("<w:p><w:r><w:br/></w:r></w:p>");
            continue;
        }

        let clean = trimmed.trim_start_matches(|c| c == '#' || c == ' ').trim();

        if trimmed.starts_with("## ") {
            body_xml.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"Heading2\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
                escape_xml(clean)
            ));
        } else if trimmed.starts_with("### ") {
            body_xml.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"Heading3\"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>",
                escape_xml(clean)
            ));
        } else {
            body_xml.push_str(&format!(
                "<w:p><w:r><w:t>{}</w:t></w:r></w:p>",
                escape_xml(trimmed)
            ));
        }
    }

    body_xml.push_str("</w:body></w:document>");

    // word/document.xml
    zip.start_file("word/document.xml", options)?;
    zip.write_all(body_xml.as_bytes())?;

    zip.finish().map_err(|e| format!("Failed to finalize DOCX: {}", e))?;

    Ok(DocumentResult {
        path: file_path.to_string_lossy().to_string(),
        format: "docx".to_string(),
        title: topic.to_string(),
    })
}

// ─── PPTX Generation ──────────────────────────────────────────────────────────

fn generate_pptx(
    out_dir: &PathBuf,
    title: &str,
    topic: &str,
    content: &str,
    _image_urls: &[String],
) -> Result<DocumentResult, String> {
    let file_path = out_dir.join(format!("{}.pptx", title));
    let file = fs::File::create(&file_path).map_err(|e| format!("Failed to create PPTX: {}", e))?;
    let mut zip = ZipWriter::new(file);

    let options = FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // Parse slides from markdown content
    let mut slides: Vec<Vec<String>> = Vec::new();
    slides.push(vec![format!("Ignis Claw Presentation"), topic.to_string()]);

    let mut current_slide: Vec<String> = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim().to_string();
        if trimmed.starts_with("## ") && !current_slide.is_empty() {
            slides.push(current_slide.clone());
            current_slide = Vec::new();
            current_slide.push(trimmed.clone());
        } else if !trimmed.is_empty() {
            current_slide.push(trimmed);
        }
    }
    if !current_slide.is_empty() {
        slides.push(current_slide);
    }

    let slide_count = slides.len();

    // Build [Content_Types].xml with slide overrides
    let mut ct = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>"#);

    for i in 0..slide_count {
        ct.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>",
            i + 1
        ));
    }
    ct.push_str(r#"<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>"#);

    zip.start_file("[Content_Types].xml", options)?;
    zip.write_all(ct.as_bytes())?;

    // _rels/.rels
    zip.start_file("_rels/.rels", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"#)?;

    // ppt/_rels/presentation.xml.rels
    let mut pres_rels = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>"#);
    for i in 0..slide_count {
        pres_rels.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{}.xml\"/>",
            3 + i, i + 1
        ));
    }
    pres_rels.push_str("</Relationships>");

    zip.start_file("ppt/_rels/presentation.xml.rels", options)?;
    zip.write_all(pres_rels.as_bytes())?;

    // ppt/theme/theme1.xml
    zip.start_file("ppt/theme/theme1.xml", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Ignis Theme">
  <a:themeElements>
    <a:clrScheme name="Ignis">
      <a:dk1><a:srgbClr val="000000"/></a:dk1>
      <a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="F97316"/></a:accent1>
      <a:accent2><a:srgbClr val="4472C4"/></a:accent2>
      <a:accent3><a:srgbClr val="70AD47"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="ED7D31"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Ignis">
      <a:majorFont><a:latin typeface="Calibri Light"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Ignis">
      <a:fillStyleLst><a:solidFill><a:srgbClr val="F97316"/></a:solidFill></a:fillStyleLst>
      <a:lnStyleLst><a:ln w="6350"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln></a:lnStyleLst>
      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
      <a:bgFillStyleLst><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
</a:theme>"#)?;

    // ppt/slideLayouts/slideLayout1.xml
    zip.start_file("ppt/slideLayouts/slideLayout1.xml", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">
  <p:cSld><p:spTree/></p:cSld>
</p:sldLayout>"#)?;

    // ppt/slideMasters/slideMaster1.xml
    zip.start_file("ppt/slideMasters/slideMaster1.xml", options)?;
    zip.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree/></p:cSld>
  <p:clrMap/>
</p:sldMaster>"#)?;

    // ppt/presentation.xml
    let mut pres_xml = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>"#);
    for i in 0..slide_count {
        pres_xml.push_str(&format!("<p:sldId id=\"{}\" r:id=\"rId{}\"/>", 256 + i, 3 + i));
    }
    pres_xml.push_str(r#"</p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>"#);

    zip.start_file("ppt/presentation.xml", options)?;
    zip.write_all(pres_xml.as_bytes())?;

    // Write slides
    for (idx, slide_lines) in slides.iter().enumerate() {
        let mut slide_xml = String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>"#);

        let mut shape_id = 1;
        let mut y_offset = 800000;

        for line in slide_lines {
            let clean = line.trim_start_matches(|c| c == '#' || c == ' ').trim();
            if clean.is_empty() { continue; }

            let is_title = shape_id == 1;
            let font_size = if is_title { "4400" } else { "1800" };
            let bold = if is_title { "1" } else { "0" };
            let color = if is_title { "F97316" } else { "333333" };
            let height = if is_title { "700000" } else { "350000" };

            slide_xml.push_str(&format!(
                r#"<p:sp>
          <p:nvSpPr><p:cNvPr id="{}" name="Text{}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
          <p:spPr><a:xfrm><a:off x="914400" y="{}"/><a:ext cx="7315200" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
          <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="{}" b="{}" dirty="0"><a:solidFill><a:srgbClr val="{}"/></a:solidFill></a:rPr><a:t>{}</a:t></a:r></a:p></p:txBody>
        </p:sp>"#,
                shape_id, shape_id, y_offset, height,
                font_size, bold, color, escape_xml(clean)
            ));
            shape_id += 1;
            y_offset += if is_title { 900000 } else { 400000 };
        }

        slide_xml.push_str(r#"</p:spTree>
  </p:cSld>
  <p:clrMap/>
</p:sld>"#);

        zip.start_file(&format!("ppt/slides/slide{}.xml", idx + 1), options)?;
        zip.write_all(slide_xml.as_bytes())?;
    }

    zip.finish().map_err(|e| format!("Failed to finalize PPTX: {}", e))?;

    Ok(DocumentResult {
        path: file_path.to_string_lossy().to_string(),
        format: "pptx".to_string(),
        title: topic.to_string(),
    })
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
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
            create_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ignis Claw");
}
