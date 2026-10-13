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

#[tauri::command]
fn create_browser_view(window: Window, url: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    if window.get_webview(VIEW_LABEL).is_some() {
        return navigate_browser(window, url);
    }
    let builder = WebviewBuilder::new(VIEW_LABEL, webview_url(&url));
    window
        .add_child(builder, LogicalPosition::new(x, y), LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn navigate_browser(window: Window, url: String) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    // The frontend always passes absolute URLs (the new-tab page is passed
    // as <app-origin>/newtab.html), so a plain parse + navigate is correct
    // for both web pages and bundled app pages.
    let parsed = parse_url(&url)?;
    view.navigate(parsed).map_err(|e| e.to_string())
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
fn set_browser_bounds(window: Window, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    let view = window.get_webview(VIEW_LABEL).ok_or("browser view not created")?;
    view.set_position(LogicalPosition::new(x, y)).map_err(|e| e.to_string())?;
    view.set_size(LogicalSize::new(width, height)).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            create_browser_view,
            navigate_browser,
            browser_url,
            browser_back,
            browser_forward,
            reload_browser,
            set_browser_bounds,
            hide_browser_view,
            show_browser_view
        ])
        .run(tauri::generate_context!())
        .expect("error while running Umbra");
}
