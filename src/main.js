import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const SEARCH = q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
const HOME = 'newtab.html'
const TOOLBAR_H = 124

const appWindow = getCurrentWindow()
let counter = 0
let tabs = []
let activeId = null
let viewReady = false
let syncing = false
let overlayOpen = false

const $ = id => document.getElementById(id)
const tabsEl = $('tabs'), addressEl = $('address'), overlayEl = $('overlay')

function normalize(input) {
  const v = (input || '').trim()
  if (!v) return HOME
  if (v === HOME || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('about:')) return v
  const looksLikeUrl = !v.includes(' ') && (v.includes('.') || v === 'localhost' || v.startsWith('localhost:'))
  return looksLikeUrl ? `https://${v}` : SEARCH(v)
}
function hostnameFor(url) {
  if (!url || url === HOME || url.endsWith('newtab.html')) return ''
  try { return new URL(url).hostname } catch { return '' }
}
function titleFor(url) {
  const host = hostnameFor(url)
  return host ? host.replace(/^www\./, '') : 'New Tab'
}
function faviconLetter(url) {
  const host = hostnameFor(url)
  return host ? host.replace(/^www\./, '').charAt(0).toUpperCase() : 'U'
}
const activeTab = () => tabs.find(t => t.id === activeId)

/* ---------------- Window controls (borderless window) ---------------- */
$('win-close').addEventListener('click', () => appWindow.close().catch(e => console.error('close failed', e)))
$('win-min').addEventListener('click', () => appWindow.minimize().catch(() => {}))
$('win-max').addEventListener('click', () => appWindow.toggleMaximize().catch(() => {}))
$('tab-row').addEventListener('dblclick', e => {
  if (!e.target.closest('button') && !e.target.closest('.tab')) appWindow.toggleMaximize().catch(() => {})
})

/* ---------------- Web view plumbing ---------------- */
async function layout() {
  if (!viewReady) return
  try { await invoke('set_browser_bounds', { x: 0, y: TOOLBAR_H, width: window.innerWidth, height: Math.max(100, window.innerHeight - TOOLBAR_H) }) } catch {}
}
function setProgress(done = false) { $('progress').style.width = done ? '0' : '70%' }

async function navigateTo(raw) {
  const tab = activeTab(); if (!tab) return
  const url = normalize(raw)
  tab.url = url
  tab.title = titleFor(url)
  closeOverlay(false) // overlay hides; navigate_browser re-shows the web view
  renderTabs(); setProgress()
  // The bundled new-tab page must be addressed by the app origin
  // (http://tauri.localhost in production, the Vite server in dev) —
  // a relative URL would resolve against whichever site is open.
  const actualUrl = url === HOME ? `${window.location.origin}/newtab.html` : url
  try {
    if (!viewReady) {
      await invoke('create_browser_view', { url: actualUrl, x: 0, y: TOOLBAR_H, width: window.innerWidth, height: Math.max(100, window.innerHeight - TOOLBAR_H) })
      viewReady = true
    } else {
      await invoke('navigate_browser', { url: actualUrl })
    }
  } catch (e) { console.error(e) }
  addressEl.value = url === HOME ? '' : url
  setTimeout(() => setProgress(true), 500)
}

/* ---------------- Tabs ---------------- */
function renderTabs() {
  tabsEl.innerHTML = ''
  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeId ? ' active' : '')
    el.dataset.tab = tab.id
    el.setAttribute('role', 'tab')
    const label = document.createElement('span')
    label.textContent = tab.title || titleFor(tab.url)
    const close = document.createElement('button')
    close.className = 'close'
    close.dataset.close = tab.id
    close.title = 'Close tab'
    close.textContent = '\u00D7'
    el.append(label, close)
    tabsEl.appendChild(el)
  }
  const tab = activeTab()
  $('tab-count').textContent = String(tabs.length)
  $('seg-count').textContent = String(tabs.length)
  if (tab) {
    if (document.activeElement !== addressEl) addressEl.value = tab.url === HOME ? '' : tab.url
    $('site-icon').textContent = faviconLetter(tab.url)
  }
}
// Delegated clicks: reliable regardless of re-renders.
tabsEl.addEventListener('click', e => {
  const closeBtn = e.target.closest('[data-close]')
  if (closeBtn) { e.stopPropagation(); closeTab(Number(closeBtn.dataset.close)); return }
  const tabEl = e.target.closest('[data-tab]')
  if (tabEl) switchTab(Number(tabEl.dataset.tab))
})
tabsEl.addEventListener('auxclick', e => {
  if (e.button !== 1) return
  const tabEl = e.target.closest('[data-tab]')
  if (tabEl) closeTab(Number(tabEl.dataset.tab))
})

function createTab(url = HOME, activate = true) {
  const tab = { id: ++counter, url: normalize(url), title: titleFor(url) }
  tabs.push(tab)
  if (activate) { activeId = tab.id; renderTabs(); navigateTo(tab.url) } else renderTabs()
  return tab
}
async function switchTab(id) {
  if (id === activeId) { closeOverlay(); return }
  activeId = id; renderTabs()
  const tab = activeTab(); if (tab) await navigateTo(tab.url)
}
async function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id)
  if (idx < 0) return
  const wasActive = id === activeId
  tabs.splice(idx, 1)
  if (!tabs.length) {
    // Browsers open a fresh New Tab when the last tab closes. To quit the
    // app itself, use the X in the top-right window controls.
    createTab()
    return
  }
  if (wasActive) {
    activeId = tabs[Math.min(idx, tabs.length - 1)].id
    renderTabs()
    await navigateTo(activeTab().url)
  } else {
    renderTabs()
    if (overlayOpen) renderOverview()
  }
}

/* ---------------- Overlay: tab overview + menu ---------------- */
function renderOverview() {
  const grid = $('overview-grid')
  grid.innerHTML = ''
  for (const tab of tabs) {
    const card = document.createElement('article')
    card.className = 'card' + (tab.id === activeId ? ' active' : '')
    const top = document.createElement('div'); top.className = 'card-top'
    const fav = document.createElement('span'); fav.className = 'card-favicon'; fav.textContent = faviconLetter(tab.url)
    const title = document.createElement('span'); title.className = 'card-title'; title.textContent = tab.title || titleFor(tab.url)
    const close = document.createElement('button'); close.className = 'card-close'; close.title = 'Close tab'; close.textContent = '\u00D7'
    close.addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id) })
    top.append(fav, title, close)
    const preview = document.createElement('div'); preview.className = 'card-preview'; preview.textContent = hostnameFor(tab.url) || 'New Tab'
    const domain = document.createElement('div'); domain.className = 'card-domain'; domain.textContent = hostnameFor(tab.url) || 'Umbra start page'
    card.append(top, preview, domain)
    card.addEventListener('click', () => switchTab(tab.id))
    grid.appendChild(card)
  }
}
async function openOverlay(mode) {
  overlayOpen = true
  $('overview-panel').hidden = mode !== 'tabs'
  $('menu-panel').hidden = mode !== 'menu'
  overlayEl.hidden = false
  if (mode === 'tabs') renderOverview()
  if (viewReady) { try { await invoke('hide_browser_view') } catch {} }
}
function closeOverlay(reshow = true) {
  if (!overlayOpen && overlayEl.hidden) return
  overlayOpen = false
  overlayEl.hidden = true
  if (reshow && viewReady) invoke('show_browser_view').catch(() => {})
}
$('tabs-btn').addEventListener('click', () => openOverlay('tabs'))
$('menu-btn').addEventListener('click', () => openOverlay('menu'))
$('overview-done').addEventListener('click', () => closeOverlay())
$('menu-done').addEventListener('click', () => closeOverlay())
$('overview-new-tab').addEventListener('click', () => createTab())
document.querySelectorAll('#menu-panel [data-action]').forEach(btn => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action
    if (action === 'new-tab') createTab()
    else if (action === 'home') navigateTo(HOME)
    else if (action === 'reload') { closeOverlay(); invoke('reload_browser').catch(() => {}) }
    else if (action === 'github') navigateTo('https://github.com/TherealCitali/Umbra')
    else if (action === 'close-tab') closeTab(activeId)
    else if (action === 'quit') appWindow.close().catch(() => {})
  })
})

/* ---------------- Toolbar ---------------- */
$('new-tab').addEventListener('click', () => createTab())
$('omnibox-new-tab').addEventListener('click', () => createTab())
$('reload').addEventListener('click', async () => { setProgress(); try { await invoke('reload_browser') } catch {} setTimeout(() => setProgress(true), 500) })
$('back').addEventListener('click', () => invoke('browser_back').catch(() => {}))
$('forward').addEventListener('click', () => invoke('browser_forward').catch(() => {}))
$('home').addEventListener('click', () => navigateTo(HOME))
addressEl.addEventListener('keydown', e => { if (e.key === 'Enter') navigateTo(addressEl.value) })
addressEl.addEventListener('focus', () => addressEl.select())
window.addEventListener('resize', layout)
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 't') { e.preventDefault(); createTab() }
  else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); if (activeId != null) closeTab(activeId) }
  else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); addressEl.focus() }
  else if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); invoke('reload_browser').catch(() => {}) }
  else if (e.key === 'Escape' && overlayOpen) closeOverlay()
  else if (e.altKey && e.key === 'ArrowLeft') invoke('browser_back').catch(() => {})
  else if (e.altKey && e.key === 'ArrowRight') invoke('browser_forward').catch(() => {})
})

// Sync address bar with in-page navigation (link clicks) once per second.
setInterval(async () => {
  if (!viewReady || syncing) return
  syncing = true
  try {
    const url = await invoke('browser_url')
    const tab = activeTab()
    if (tab && url && !url.endsWith('newtab.html') && tab.url !== url) {
      tab.url = url; tab.title = titleFor(url); renderTabs()
      if (overlayOpen) renderOverview()
    }
  } catch {} finally { syncing = false }
}, 1000)

createTab()
layout()
