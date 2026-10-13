use tauri::{LogicalPosition, LogicalSize, Manager, WebviewBuilder, WebviewUrl, Window};

const VIEW_LABEL: &str = "browser-view";

fn parse_url(raw: &str) -> Result<url::Url, String> {
    url::Url::parse(raw).map_err(|e| e.to_string())
}

fn webview_url(raw: &str) -> WebviewUrl {
    if raw == "newtab.html" || raw.ends_with("newtab.html") {
        WebviewUrl::App("newtab.html".into())
    } else {
        match url::Url::parse(raw) {
            Ok(u) => WebviewUrl::External(u),
            Err(_) => WebviewUrl::App("newtab.html".into()),
        }
    }
}

fn add_view(window: &Window, url: &str, incognito: bool, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let builder = WebviewBuilder::new(VIEW_LABEL, webview_url(url)).incognito(incognito);
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn create_browser_view(window: Window, url: String, incognito: bool, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if window.get_webview(VIEW_LABEL).is_some() {
        return navigate_browser(window, url);
    }
    add_view(&window, &url, incognito, x, y, width, height)
}

#[tauri::command]
fn recreate_browser_view(window: Window, url: String, incognito: bool, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if let Some(view) = window.get_webview(VIEW_LABEL) {
        view.close().map_err(|e| e.to_string())?;
    }
    add_view(&window, &url, incognito, x, y, width, height)
}

#[tauri::command]
fn navigate_browser(window: Window, url: String) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    // The frontend always passes absolute URLs (the new-tab page is passed
    // as <app-origin>/newtab.html), so a plain parse + navigate is correct
    // for both web pages and bundled app pages.
    let parsed = parse_url(&url)?;
    let _ = view.show();
    view.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
fn hide_browser_view(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn show_browser_view(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.show().map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_url(window: Window) -> Result<String, String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.url().map(|u| u.to_string()).map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_back(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.eval("window.history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
fn browser_forward(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.eval("window.history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
fn reload_browser(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.eval("window.location.reload()").map_err(|e| e.to_string())
}

#[tauri::command]
fn print_page(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.eval("window.print()").map_err(|e| e.to_string())
}

#[tauri::command]
fn find_in_page(window: Window, text: String) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    let needle = serde_json::to_string(&text).map_err(|e| e.to_string())?;
    view.eval(format!("window.find({needle}, false, false, true, false, false, false)"))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn set_page_zoom(window: Window, zoom: f64) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.set_zoom(zoom).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_browsing_data(window: Window) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.clear_all_browsing_data().map_err(|e| e.to_string())
}

#[tauri::command]
fn apply_page_dark(window: Window, enabled: bool) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    let flag = if enabled { "true" } else { "false" };
    let script = format!(
        r#"(function(){{
  var enabled = {flag};
  var id = '__umbra_force_dark';
  var el = document.getElementById(id);
  if (!enabled) {{ if (el) el.remove(); return; }}
  if (!el) {{
    el = document.createElement('style');
    el.id = id;
    el.textContent = 'html {{ filter: invert(1) hue-rotate(180deg) !important; background: #101014 !important; }} img, video, picture, canvas, [style*="background-image"] {{ filter: invert(1) hue-rotate(180deg) !important; }}';
    (document.head || document.documentElement).appendChild(el);
  }}
}})()"#
    );
    view.eval(script).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_browser_bounds(window: Window, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    view.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

/* ---------- Ask AI: page fetching + provider calls (no CORS in Rust) ---------- */

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Umbra/0.3")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())
}

fn strip_html(html: &str) -> String {
    let mut text = html.to_string();
    for tag in ["script", "style", "noscript", "svg", "head"] {
        let open = format!("<{tag}");
        let close = format!("</{tag}>");
        loop {
            let lower = text.to_lowercase();
            match (lower.find(&open), lower.find(&close)) {
                (Some(start), Some(end)) if end > start => {
                    text.replace_range(start..end + close.len(), " ");
                }
                _ => break,
            }
        }
    }
    let mut out = String::with_capacity(text.len());
    let mut in_tag = false;
    for ch in text.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let cleaned = out
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(12000).collect()
}

#[tauri::command]
async fn fetch_page_text(url: String) -> Result<String, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Ok(String::new());
    }
    let client = http_client()?;
    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("page returned HTTP {}", resp.status()));
    }
    let html = resp.text().await.map_err(|e| e.to_string())?;
    Ok(strip_html(&html))
}

fn openai_endpoint(provider: &str, base_url: &str) -> Result<String, String> {
    let base = match provider {
        "chatgpt" => "https://api.openai.com/v1",
        "openrouter" => "https://openrouter.ai/api/v1",
        "deepseek" => "https://api.deepseek.com",
        "siliconflow" => "https://api.siliconflow.cn/v1",
        "alibaba" => "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "bytedance" => "https://ark.cn-beijing.volces.com/api/v3",
        "custom" => {
            if base_url.trim().is_empty() {
                return Err("Custom provider needs an endpoint URL in AI settings.".to_string());
            }
            base_url.trim()
        }
        _ => return Err(format!("unsupported provider: {provider}")),
    };
    let base = base.trim_end_matches('/');
    if base.ends_with("/chat/completions") {
        Ok(base.to_string())
    } else {
        Ok(format!("{base}/chat/completions"))
    }
}

fn default_model(provider: &str) -> &'static str {
    match provider {
        "chatgpt" => "gpt-4o-mini",
        "openrouter" => "openai/gpt-4o-mini",
        "deepseek" => "deepseek-chat",
        "gemini" => "gemini-2.5-flash",
        "claude" => "claude-3-5-haiku-latest",
        _ => "",
    }
}

#[tauri::command]
async fn ai_ask(
    provider: String,
    api_key: String,
    model: String,
    base_url: String,
    prompt: String,
    page_title: String,
    page_url: String,
    page_context: String,
    question: String,
) -> Result<String, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("No API key saved. Add your own API key in Settings → AI assistant.".to_string());
    }
    let model = if model.trim().is_empty() { default_model(&provider).to_string() } else { model.trim().to_string() };
    if model.is_empty() {
        return Err("No model set. Enter a model name in Settings → AI assistant.".to_string());
    }
    let system = if prompt.trim().is_empty() {
        "You are Umbra AI, a helpful browser assistant. Answer using the page content as context. Be concise."
    } else {
        prompt.trim()
    };
    let context = if page_context.trim().is_empty() {
        "(page text could not be extracted — it may need JavaScript or a login; answer generally and say so if relevant)".to_string()
    } else {
        page_context.trim().to_string()
    };
    let user = format!("Page title: {page_title}\nPage URL: {page_url}\n\nPage content:\n{context}\n\nQuestion: {question}");
    let client = http_client()?;

    let value: serde_json::Value = match provider.as_str() {
        "gemini" => {
            let endpoint = format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent");
            let body = serde_json::json!({
                "contents": [{ "parts": [{ "text": format!("{system}\n\n{user}") }] }],
                "generationConfig": { "maxOutputTokens": 1024 }
            });
            let resp = client.post(endpoint).header("x-goog-api-key", key).json(&body).send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() { return Err(format!("Gemini API {status}: {v}")); }
            v
        }
        "claude" => {
            let body = serde_json::json!({
                "model": model,
                "max_tokens": 1024,
                "system": system,
                "messages": [{ "role": "user", "content": user }]
            });
            let resp = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", key)
                .header("anthropic-version", "2023-06-01")
                .json(&body)
                .send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() { return Err(format!("Claude API {status}: {v}")); }
            v
        }
        _ => {
            let endpoint = openai_endpoint(&provider, &base_url)?;
            let body = serde_json::json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system },
                    { "role": "user", "content": user }
                ]
            });
            let resp = client
                .post(endpoint)
                .header("Authorization", format!("Bearer {key}"))
                .json(&body)
                .send().await.map_err(|e| e.to_string())?;
            let status = resp.status();
            let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
            if !status.is_success() { return Err(format!("{provider} API {status}: {v}")); }
            v
        }
    };

    // Extract answer text from the three response shapes.
    if provider == "gemini" {
        if let Some(parts) = value["candidates"][0]["content"]["parts"].as_array() {
            let text: String = parts.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join("");
            if !text.is_empty() { return Ok(text); }
        }
    } else if provider == "claude" {
        if let Some(blocks) = value["content"].as_array() {
            let text: String = blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("");
            if !text.is_empty() { return Ok(text); }
        }
    } else if let Some(content) = value["choices"][0]["message"]["content"].as_str() {
        if !content.is_empty() { return Ok(content.to_string()); }
    }
    Err(format!("The provider replied without answer text: {value}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Restores the window's last size, position and maximized state on launch.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            create_browser_view,
            recreate_browser_view,
            navigate_browser,
            browser_url,
            browser_back,
            browser_forward,
            reload_browser,
            set_browser_bounds,
            hide_browser_view,
            show_browser_view,
            print_page,
            find_in_page,
            set_page_zoom,
            clear_browsing_data,
            apply_page_dark,
            fetch_page_text,
            ai_ask
        ])
        .run(tauri::generate_context!())
        .expect("error while running Umbra");
}
