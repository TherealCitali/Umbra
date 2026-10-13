# Umbra — lightweight Windows browser

A fast, RAM-efficient Windows browser built with **Tauri 2 (Rust) + WebView2** (the Chromium engine already built into Windows 10/11). No bundled Chromium, so the portable executable is only a few MB and a single web-view process is shared across tabs.

## Features (v0.3)
- **Dark mode + force dark**: light/dark/system theme for the whole UI, plus an experimental force-dark that inverts bright web pages (Settings → Appearance, or Menu → Night mode)
- **Ask AI (bring your own key)**: ChatGPT, Google Gemini, Claude, OpenRouter, DeepSeek, ByteDance, AlibabaCloud, SiliconFlow, or any OpenAI-compatible custom endpoint. Ask questions about the current page (Menu → Ask AI). Your API key is stored only in local storage on your PC. AI *agent* browsing (AI clicking/browsing for you) is planned — see the disabled toggle in Settings.
- **Bookmarks bar** (Chrome-style) with star button (`Ctrl+D`), bookmarks & history managers, history recording (max 200, never in Incognito)
- **Incognito mode**: ephemeral WebView2 profile, recreated live; no history is recorded while it is on
- Tabs (open / close / switch) sharing one WebView2 process — very low RAM; tab overview cards; middle-click closes a tab
- Find in page, page zoom (50–200%), print / save as PDF, view source, full-screen, share (copy URL), clear browsing data
- macOS-style traffic-light window controls (close / minimize / maximize); **the window reopens at its last size and position** (tauri-plugin-window-state)
- Eddy-inspired interface: pastel floating pill chrome and a calm start page (original implementation, no Eddy code/assets)
- Shortcuts: `Ctrl+T` new tab, `Ctrl+W` close tab, `Ctrl+L` address bar, `Ctrl+R` reload, `Ctrl+D` bookmark, `Alt+←/→` back/forward, `Esc` closes overlays
- Note: closing the last tab opens a fresh New Tab (standard browser behaviour) — use the red traffic light to quit Umbra

## Roadmap
- Extensions engine (ad blocking arrives with it)
- Built-in password manager, downloads manager, desktop-site user-agent switch
- AI agent browsing with your own API key

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
