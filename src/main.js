import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const HOME = 'newtab.html'
const BASE_CHROME_H = 129
const BOOKMARKS_BAR_H = 36
const ENGINES = {
  duckduckgo: { label: 'DuckDuckGo', url: q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  google: { label: 'Google', url: q => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  bing: { label: 'Bing', url: q => `https://www.bing.com/search?q=${encodeURIComponent(q)}` },
}

/* ---------- Persistent state (this PC only) ---------- */
function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback } catch { return fallback }
}
function saveJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch {} }

let settings = Object.assign({
  theme: 'system', forceDark: false, bookmarksBar: true,
  searchEngine: 'duckduckgo', zoom: '1',
  aiProvider: 'none', aiApiKey: '', aiModel: '', aiBaseUrl: '',
  aiPrompt: 'You are Umbra AI, a helpful browser assistant. Answer questions about the web page using its content as context. Be concise and clear.',
}, loadJSON('umbra-settings-v1', {}))

let bookmarks = loadJSON('umbra-bookmarks-v1', null)
if (!Array.isArray(bookmarks)) {
  bookmarks = [
    { title: 'DuckDuckGo', url: 'https://duckduckgo.com' },
    { title: 'Wikipedia', url: 'https://www.wikipedia.org' },
    { title: 'GitHub', url: 'https://github.com' },
    { title: 'Hacker News', url: 'https://news.ycombinator.com' },
  ]
  saveJSON('umbra-bookmarks-v1', bookmarks)
}
let historyItems = loadJSON('umbra-history-v1', [])
let incognitoMode = false

/* ---------- Tabs state ---------- */
const appWindow = getCurrentWindow()
let counter = 0
let tabs = []
let activeId = null
let viewReady = false
let syncing = false
let overlayOpen = false
let managerKind = 'bookmarks'
let lastKnownUrl = ''

const $ = id => document.getElementById(id)
const tabsEl = $('tabs'), addressEl = $('address'), overlayEl = $('overlay')

function normalize(input) {
  const v = (input || '').trim()
  if (!v) return HOME
  if (v === HOME || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('about:') || v.startsWith('view-source:')) return v
  const looksLikeUrl = !v.includes(' ') && (v.includes('.') || v === 'localhost' || v.startsWith('localhost:'))
  return looksLikeUrl ? `https://${v}` : ENGINES[settings.searchEngine].url(v)
}
function hostnameFor(url) {
  if (!url || url === HOME || url.endsWith('newtab.html')) return ''
  try { return new URL(url.replace(/^view-source:/, '')).hostname } catch { return '' }
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
const chromeH = () => BASE_CHROME_H + (settings.bookmarksBar ? BOOKMARKS_BAR_H : 0)

/* ---------- Theme & settings ---------- */
function effectiveTheme() {
  if (settings.theme === 'dark' || settings.theme === 'light') return settings.theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function applySettings() {
  document.documentElement.dataset.theme = effectiveTheme()
  document.documentElement.style.setProperty('--chrome-h', chromeH() + 'px')
  $('bookmarks-bar').hidden = !settings.bookmarksBar
  $('engine-label').textContent = ENGINES[settings.searchEngine].label
  // Sync settings form
  $('set-theme').value = settings.theme
  $('set-force-dark').checked = !!settings.forceDark
  $('set-bookmarks-bar').checked = !!settings.bookmarksBar
  $('set-search-engine').value = settings.searchEngine
  $('set-zoom').value = String(settings.zoom)
  $('set-ai-provider').value = settings.aiProvider
  $('set-ai-key').value = settings.aiApiKey
  $('set-ai-model').value = settings.aiModel
  $('set-ai-baseurl').value = settings.aiBaseUrl
  $('set-ai-prompt').value = settings.aiPrompt
  $('set-incognito').checked = incognitoMode
  document.querySelector('[data-menu="night"]')?.classList.toggle('on', effectiveTheme() === 'dark')
  document.querySelector('[data-menu="incognito"]')?.classList.toggle('on', incognitoMode)
  saveJSON('umbra-settings-v1', settings)
  renderBookmarksBar()
  layout()
}
function saveSettings() { saveJSON('umbra-settings-v1', settings) }

/* ---------- Window controls: macOS traffic lights ---------- */
$('win-close').addEventListener('click', () => appWindow.close().catch(e => console.error('close failed', e)))
$('win-min').addEventListener('click', () => appWindow.minimize().catch(() => {}))
$('win-max').addEventListener('click', () => appWindow.toggleMaximize().catch(() => {}))
$('tab-row').addEventListener('dblclick', e => {
  if (!e.target.closest('button') && !e.target.closest('.tab')) appWindow.toggleMaximize().catch(() => {})
})

/* ---------- Web view plumbing ---------- */
async function layout() {
  if (!viewReady) return
  try { await invoke('set_browser_bounds', { x: 0, y: chromeH(), width: window.innerWidth, height: Math.max(100, window.innerHeight - chromeH()) }) } catch {}
}
function setProgress(done = false) { $('progress').style.width = done ? '0' : '70%' }
async function applyPageTweaks() {
  if (!viewReady) return
  const tab = activeTab()
  try { await invoke('apply_page_dark', { enabled: !!settings.forceDark && !!tab && !tab.url.endsWith('newtab.html') && tab.url !== HOME }) } catch {}
  try { if (String(settings.zoom) !== '1') await invoke('set_page_zoom', { zoom: parseFloat(settings.zoom) }) } catch {}
}

async function navigateTo(raw) {
  const tab = activeTab(); if (!tab) return
  const url = normalize(raw)
  tab.url = url
  tab.title = titleFor(url)
  closeOverlay(false)
  renderTabs(); setProgress()
  const actualUrl = url === HOME ? `${window.location.origin}/newtab.html` : url
  try {
    if (!viewReady) {
      await invoke('create_browser_view', { url: actualUrl, incognito: incognitoMode, x: 0, y: chromeH(), width: window.innerWidth, height: Math.max(100, window.innerHeight - chromeH()) })
      viewReady = true
    } else {
      await invoke('navigate_browser', { url: actualUrl })
    }
  } catch (e) { console.error(e) }
  addressEl.value = url === HOME ? '' : url
  recordHistory(url, tab.title)
  setTimeout(() => { setProgress(true); applyPageTweaks() }, 700)
}

/* ---------- Tabs ---------- */
function isBookmarked(url) { return bookmarks.some(b => b.url === url) }
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
    close.className = 'close'; close.dataset.close = tab.id; close.title = 'Close tab'; close.textContent = '\u00D7'
    el.append(label, close)
    tabsEl.appendChild(el)
  }
  const tab = activeTab()
  $('tab-count').textContent = String(tabs.length)
  $('seg-count').textContent = String(tabs.length)
  if (tab) {
    if (document.activeElement !== addressEl) addressEl.value = tab.url === HOME ? '' : tab.url
    $('site-icon').textContent = faviconLetter(tab.url)
    const bm = $('bookmark-btn')
    bm.textContent = isBookmarked(tab.url) ? '\u2605' : '\u2606'
    bm.classList.toggle('bookmarked', isBookmarked(tab.url))
  }
}
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
  if (!tabs.length) { createTab(); return }
  if (wasActive) {
    activeId = tabs[Math.min(idx, tabs.length - 1)].id
    renderTabs()
    await navigateTo(activeTab().url)
  } else {
    renderTabs()
    if (overlayOpen) renderOverview()
  }
}

/* ---------- Bookmarks & history ---------- */
function renderBookmarksBar() {
  const bar = $('bookmarks-bar')
  bar.innerHTML = ''
  if (!bookmarks.length) {
    const hint = document.createElement('span')
    hint.className = 'bm-empty'
    hint.textContent = 'Star a page to add it to the bookmarks bar'
    bar.appendChild(hint)
    return
  }
  for (const bm of bookmarks) {
    const pill = document.createElement('button')
    pill.className = 'bm-pill'
    const name = document.createElement('span')
    name.className = 'bm-name'; name.textContent = bm.title || titleFor(bm.url)
    const del = document.createElement('span')
    del.className = 'bm-del'; del.textContent = '\u00D7'; del.title = 'Remove bookmark'
    del.addEventListener('click', e => {
      e.stopPropagation()
      bookmarks = bookmarks.filter(b => b.url !== bm.url)
      saveJSON('umbra-bookmarks-v1', bookmarks)
      renderBookmarksBar(); renderTabs()
    })
    pill.append(name, del)
    pill.addEventListener('click', () => navigateTo(bm.url))
    bar.appendChild(pill)
  }
}
function recordHistory(url, title) {
  if (incognitoMode || !url || url === HOME || url.endsWith('newtab.html') || url.startsWith('view-source:') || url.startsWith('about:')) return
  historyItems = historyItems.filter(h => h.url !== url)
  historyItems.unshift({ url, title: title || titleFor(url), ts: Date.now() })
  historyItems = historyItems.slice(0, 200)
  saveJSON('umbra-history-v1', historyItems)
}
$('bookmark-btn').addEventListener('click', () => {
  const tab = activeTab(); if (!tab || tab.url === HOME) return
  if (isBookmarked(tab.url)) bookmarks = bookmarks.filter(b => b.url !== tab.url)
  else bookmarks.push({ title: tab.title || titleFor(tab.url), url: tab.url })
  saveJSON('umbra-bookmarks-v1', bookmarks)
  renderBookmarksBar(); renderTabs()
})

/* ---------- Overlay panels ---------- */
const PANELS = ['overview-panel', 'menu-panel', 'settings-panel', 'manager-panel', 'ai-panel', 'find-panel']
function showPanel(panelId) {
  for (const id of PANELS) $(id).hidden = id !== panelId
}
async function openOverlay(panelId) {
  overlayOpen = true
  showPanel(panelId)
  overlayEl.hidden = false
  if (viewReady) { try { await invoke('hide_browser_view') } catch {} }
}
function closeOverlay(reshow = true) {
  if (!overlayOpen && overlayEl.hidden) return
  overlayOpen = false
  overlayEl.hidden = true
  if (reshow && viewReady) invoke('show_browser_view').catch(() => {})
}
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
function renderManager() {
  const list = $('manager-list')
  const isBm = managerKind === 'bookmarks'
  $('manager-title').textContent = isBm ? 'Bookmarks' : 'History'
  $('manager-add-current').style.display = isBm ? '' : 'none'
  $('manager-clear').textContent = isBm ? 'Remove all' : 'Clear history'
  list.innerHTML = ''
  const items = isBm ? bookmarks : historyItems
  if (!items.length) {
    const empty = document.createElement('div')
    empty.className = 'list-empty'
    empty.textContent = isBm ? 'No bookmarks yet — star a page to add one.' : 'No history yet.'
    list.appendChild(empty)
    return
  }
  for (const item of items) {
    const row = document.createElement('div')
    row.className = 'list-row'
    const main = document.createElement('div'); main.className = 'list-main'
    const t = document.createElement('div'); t.className = 'list-title'; t.textContent = item.title || titleFor(item.url)
    const s = document.createElement('div'); s.className = 'list-sub'
    s.textContent = isBm ? item.url : `${item.url} · ${new Date(item.ts).toLocaleString()}`
    main.append(t, s)
    const del = document.createElement('button'); del.className = 'list-del'; del.textContent = '\u00D7'; del.title = 'Remove'
    del.addEventListener('click', e => {
      e.stopPropagation()
      if (isBm) { bookmarks = bookmarks.filter(b => b.url !== item.url); saveJSON('umbra-bookmarks-v1', bookmarks); renderBookmarksBar(); renderTabs() }
      else { historyItems = historyItems.filter(h => h.url !== item.url); saveJSON('umbra-history-v1', historyItems) }
      renderManager()
    })
    row.append(main, del)
    row.addEventListener('click', () => navigateTo(item.url))
    list.appendChild(row)
  }
}
$('tabs-btn').addEventListener('click', () => { renderOverview(); openOverlay('overview-panel') })
$('menu-btn').addEventListener('click', () => openOverlay('menu-panel'))
$('overview-new-tab').addEventListener('click', () => createTab())
$('seg-incognito').addEventListener('click', async () => { await setIncognito(!incognitoMode); closeOverlay() })
document.querySelectorAll('[data-close-overlay]').forEach(b => b.addEventListener('click', () => closeOverlay()))
document.querySelectorAll('[data-open-panel]').forEach(b => b.addEventListener('click', () => openOverlay(b.dataset.openPanel + '-panel')))
$('menu-quit').addEventListener('click', () => appWindow.close().catch(() => {}))
$('manager-add-current').addEventListener('click', () => {
  const tab = activeTab(); if (!tab || tab.url === HOME || isBookmarked(tab.url)) return
  bookmarks.push({ title: tab.title || titleFor(tab.url), url: tab.url })
  saveJSON('umbra-bookmarks-v1', bookmarks); renderBookmarksBar(); renderTabs(); renderManager()
})
$('manager-clear').addEventListener('click', () => {
  if (managerKind === 'bookmarks') { bookmarks = []; saveJSON('umbra-bookmarks-v1', bookmarks); renderBookmarksBar(); renderTabs() }
  else { historyItems = []; saveJSON('umbra-history-v1', historyItems) }
  renderManager()
})

/* ---------- Incognito (separate ephemeral profile) ---------- */
async function setIncognito(enabled) {
  incognitoMode = enabled
  $('incognito-badge').hidden = !enabled
  applySettings()
  if (!viewReady) return
  const tab = activeTab(); if (!tab) return
  const actualUrl = tab.url === HOME ? `${window.location.origin}/newtab.html` : tab.url
  closeOverlay(false)
  try {
    await invoke('recreate_browser_view', { url: actualUrl, incognito: enabled, x: 0, y: chromeH(), width: window.innerWidth, height: Math.max(100, window.innerHeight - chromeH()) })
    setTimeout(applyPageTweaks, 700)
  } catch (e) { console.error('incognito switch failed', e) }
}

/* ---------- Menu actions ---------- */
document.querySelectorAll('[data-menu]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const action = btn.dataset.menu
    const tab = activeTab()
    if (action === 'night') {
      settings.theme = effectiveTheme() === 'dark' ? 'light' : 'dark'
      applySettings()
    } else if (action === 'bookmarks') { managerKind = 'bookmarks'; renderManager(); openOverlay('manager-panel') }
    else if (action === 'history') { managerKind = 'history'; renderManager(); openOverlay('manager-panel') }
    else if (action === 'incognito') { await setIncognito(!incognitoMode); closeOverlay() }
    else if (action === 'share') {
      if (tab) { try { await navigator.clipboard.writeText(tab.url); btn.lastChild.textContent = 'Copied!'; setTimeout(() => btn.lastChild.textContent = 'Share', 1200) } catch {} }
    }
    else if (action === 'ai') {
      $('ai-context').textContent = tab && tab.url !== HOME ? `Page: ${tab.title || tab.url} (${tab.url})` : 'No web page open — answers will be general (open a page to ask about it).'
      openOverlay('ai-panel')
    }
    else if (action === 'settings') openOverlay('settings-panel')
    else if (action === 'find') { openOverlay('find-panel'); setTimeout(() => $('find-input').focus(), 60) }
    else if (action === 'source') { if (tab && tab.url.startsWith('http')) { closeOverlay(false); invoke('navigate_browser', { url: `view-source:${tab.url}` }).catch(e => console.error(e)) } }
    else if (action === 'fullscreen') { try { await appWindow.setFullscreen(!(await appWindow.isFullscreen())) } catch {} closeOverlay() }
    else if (action === 'print') { closeOverlay(); invoke('print_page').catch(() => {}) }
  })
})

/* ---------- Settings form ---------- */
$('set-theme').addEventListener('change', e => { settings.theme = e.target.value; applySettings() })
$('set-force-dark').addEventListener('change', async e => {
  settings.forceDark = e.target.checked; saveSettings()
  if (viewReady) { try { await invoke('apply_page_dark', { enabled: settings.forceDark }) } catch {} }
  if (settings.forceDark) setTimeout(applyPageTweaks, 300)
})
$('set-bookmarks-bar').addEventListener('change', e => { settings.bookmarksBar = e.target.checked; applySettings() })
$('set-search-engine').addEventListener('change', e => { settings.searchEngine = e.target.value; applySettings() })
$('set-zoom').addEventListener('change', async e => {
  settings.zoom = e.target.value; saveSettings()
  if (viewReady) { try { await invoke('set_page_zoom', { zoom: parseFloat(settings.zoom) }) } catch {} }
})
$('set-incognito').addEventListener('change', async e => { await setIncognito(e.target.checked); closeOverlay() })
for (const [id, key] of [['set-ai-provider', 'aiProvider'], ['set-ai-key', 'aiApiKey'], ['set-ai-model', 'aiModel'], ['set-ai-baseurl', 'aiBaseUrl'], ['set-ai-prompt', 'aiPrompt']]) {
  $(id).addEventListener('input', e => { settings[key] = e.target.value; saveSettings() })
}
$('clear-data-btn').addEventListener('click', async e => {
  const btn = e.target; btn.textContent = 'Clearing…'
  try { await invoke('clear_browsing_data') ; btn.textContent = 'Cleared ✓' } catch (err) { btn.textContent = 'Failed — reopen app'; console.error(err) }
  setTimeout(() => btn.textContent = 'Clear data', 1800)
})
$('clear-history-btn').addEventListener('click', e => {
  historyItems = []; saveJSON('umbra-history-v1', historyItems)
  e.target.textContent = 'Cleared ✓'; setTimeout(() => e.target.textContent = 'Clear history', 1500)
})
$('about-github-btn').addEventListener('click', () => navigateTo('https://github.com/TherealCitali/Umbra'))

/* ---------- Ask AI ---------- */
$('ai-ask-btn').addEventListener('click', async () => {
  const question = $('ai-question').value.trim()
  const answerEl = $('ai-answer')
  if (!question) { answerEl.textContent = 'Type a question first.'; return }
  if (settings.aiProvider === 'none') { answerEl.textContent = 'No AI provider selected. Open AI settings and choose a provider.'; return }
  if (!settings.aiApiKey.trim()) { answerEl.textContent = 'No API key saved. Open AI settings and paste your own API key.'; return }
  const tab = activeTab()
  answerEl.textContent = 'Reading the page and asking AI…'
  let pageText = ''
  if (tab && tab.url.startsWith('http')) {
    try { pageText = await invoke('fetch_page_text', { url: tab.url }) } catch (e) { console.error('page fetch failed', e) }
  }
  try {
    answerEl.textContent = await invoke('ai_ask', {
      provider: settings.aiProvider, apiKey: [SECURITY_DATA], model: settings.aiModel,
      baseUrl: settings.aiBaseUrl, prompt: settings.aiPrompt,
      pageTitle: tab ? (tab.title || '') : '', pageUrl: tab ? tab.url : '',
      pageContext: pageText, question,
    })
  } catch (e) {
    answerEl.textContent = `AI request failed: ${e}\n\nCheck your provider, model and API key in Settings → AI assistant.`
  }
})

/* ---------- Find in page ---------- */
async function doFind() {
  const text = $('find-input').value
  if (!text || !viewReady) return
  closeOverlay()
  try { await invoke('find_in_page', { text }) } catch (e) { console.error(e) }
}
$('find-next-btn').addEventListener('click', doFind)
$('find-input').addEventListener('keydown', e => { if (e.key === 'Enter') doFind() })

/* ---------- Toolbar ---------- */
$('new-tab').addEventListener('click', () => createTab())
$('omnibox-new-tab').addEventListener('click', () => createTab())
$('reload').addEventListener('click', async () => { setProgress(); try { await invoke('reload_browser') } catch {} setTimeout(() => { setProgress(true); applyPageTweaks() }, 600) })
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
  else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); $('bookmark-btn').click() }
  else if (e.key === 'Escape' && overlayOpen) closeOverlay()
  else if (e.altKey && e.key === 'ArrowLeft') invoke('browser_back').catch(() => {})
  else if (e.altKey && e.key === 'ArrowRight') invoke('browser_forward').catch(() => {})
})

// Sync the address bar with in-page navigation; re-apply page tweaks after it settles.
setInterval(async () => {
  if (!viewReady || syncing) return
  syncing = true
  try {
    const url = await invoke('browser_url')
    const tab = activeTab()
    if (tab && url && !url.endsWith('newtab.html') && tab.url !== url) {
      tab.url = url; tab.title = titleFor(url); renderTabs()
      recordHistory(url, tab.title)
      if (overlayOpen && !$('overview-panel').hidden) renderOverview()
      setTimeout(applyPageTweaks, 500)
    }
    lastKnownUrl = url || lastKnownUrl
  } catch {} finally { syncing = false }
}, 1000)

applySettings()
createTab()
layout()
