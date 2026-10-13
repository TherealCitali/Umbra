# Umbra — lightweight Windows browser

A fast, RAM-efficient Windows browser built with **Tauri 2 (Rust) + WebView2** (the Chromium engine already built into Windows 10/11). No bundled Chromium, so the portable executable is only a few MB and a single web-view process is shared across tabs.

## Features (v0.2)
- Tabs (open / close / switch) sharing one WebView2 process — very low RAM
- Eddy-inspired interface: pastel floating pill chrome, tab-overview cards, calm start page (original implementation, no Eddy code/assets)
- Borderless window with built-in minimize / maximize / close controls; drag the top strip to move, double-click it to maximize
- Tab overview (tab-count button) with large close buttons; middle-click a tab to close it
- Address bar: type a URL or search (DuckDuckGo by default)
- Back / forward / reload / home, new-tab start page
- Address-bar sync when you click links inside pages
- Shortcuts: `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+L` address bar, `Ctrl+R` reload, `Alt+←/→` back/forward, `Esc` closes the overview/menu
- Note: closing the last tab opens a fresh New Tab (standard browser behaviour) — use the top-right ✕ to quit Umbra

## Download a build
Every push to `main` builds a Windows `.exe` on GitHub Actions:
**Actions → Build Windows Browser → latest run → Artifacts → `Umbra-windows-exe`**

## Local development (Windows)
Prerequisites: Node 20, Rust (rustup), and WebView2 (preinstalled on Windows 11 / recent Windows 10).

```powershell
npm install
npm run tauri dev     # run in development
npm run tauri build   # NSIS installer + exe under src-tauri/target/release/
```

## How it works
- `index.html` + `src/` — toolbar/tabs UI (the main window)
- `src-tauri/` — Rust shell; creates one child webview for web content and exposes navigate/back/forward/reload commands
- `.github/workflows/build.yml` — Windows CI producing the artifact
