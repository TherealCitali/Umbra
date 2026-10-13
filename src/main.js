import { invoke } from '@tauri-apps/api/core'

const SEARCH = q => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`
const HOME = 'newtab.html'

let counter = 0
let tabs = []
let activeId = null
let viewReady = false
let syncing = false

const $ = id => document.getElementById(id)
const tabsEl = $('tabs'), addressEl = $('address')

function normalize(input) {
  const v = input.trim()
  if (!v) return HOME
  if (v === HOME || v.startsWith('http://') || v.startsWith('https://') || v.startsWith('about:')) return v
  const looksLikeUrl = !v.includes(' ') && (v.includes('.') || v === 'localhost' || v.startsWith('localhost:'))
  return looksLikeUrl ? `https://${v}` : SEARCH(v)
}
function titleFor(url) {
  if (!url || url === HOME || url.endsWith('newtab.html')) return 'New Tab'
  try { return new URL(url).hostname.replace(/^www\./, '') || url } catch { return url }
}
const activeTab = () => tabs.find(t => t.id === activeId)

async function layout() {
  if (!viewReady) return
  try { await invoke('set_browser_bounds', { x: 0, y: 88, width: window.innerWidth, height: Math.max(100, window.innerHeight - 88) }) } catch {}
}
async function navigateTo(raw) {
  const tab = activeTab(); if (!tab) return
  const url = normalize(raw)
  tab.url = url
  renderTabs(); setProgress()
  // The bundled new-tab page must be addressed by the app origin
  // (http://tauri.localhost in production, the Vite server in dev) —
  // a relative URL would resolve against whichever site is open.
  const actualUrl = url === HOME ? `${window.location.origin}/newtab.html` : url
  try {
    if (!viewReady) {
      await invoke('create_browser_view', { url: actualUrl, x: 0, y: 88, width: window.innerWidth, height: Math.max(100, window.innerHeight - 88) })
      viewReady = true
    } else {
      await invoke('navigate_browser', { url: actualUrl })
    }
  } catch (e) { console.error(e) }
  addressEl.value = url === HOME ? '' : url
  setTimeout(() => setProgress(true), 500)
}
function setProgress(done = false) { $('progress').style.width = done ? '0' : '70%' }

function renderTabs() {
  tabsEl.innerHTML = ''
  for (const tab of tabs) {
    const el = document.createElement('div')
    el.className = 'tab' + (tab.id === activeId ? ' active' : '')
    el.innerHTML = `<span></span><button class="close" title="Close tab">×</button>`
    el.querySelector('span').textContent = tab.title || titleFor(tab.url)
    el.addEventListener('click', () => switchTab(tab.id))
    el.querySelector('.close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id) })
    tabsEl.appendChild(el)
  }
  const tab = activeTab()
  if (tab && document.activeElement !== addressEl) addressEl.value = (tab.url === HOME ? '' : tab.url)
}
function createTab(url = HOME, activate = true) {
  const tab = { id: ++counter, url: normalize(url), title: titleFor(url) }
  tabs.push(tab)
  if (activate) { activeId = tab.id; renderTabs(); navigateTo(tab.url) } else renderTabs()
  return tab
}
async function switchTab(id) {
  if (id === activeId) return
  activeId = id; renderTabs()
  const tab = activeTab(); if (tab) await navigateTo(tab.url)
}
async function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id)
  if (idx < 0) return
  tabs.splice(idx, 1)
  if (!tabs.length) { createTab(); return }
  if (activeId === id) { activeId = tabs[Math.min(idx, tabs.length - 1)].id; renderTabs(); await navigateTo(activeTab().url) }
  else renderTabs()
}

// Sync address bar with in-page navigation (link clicks) once per second.
setInterval(async () => {
  if (!viewReady || syncing) return
  syncing = true
  try {
    const url = await invoke('browser_url')
    const tab = activeTab()
    if (tab && url && !url.endsWith('newtab.html') && tab.url !== url) { tab.url = url; tab.title = titleFor(url); renderTabs() }
  } catch {} finally { syncing = false }
}, 1000)

$('new-tab').addEventListener('click', () => createTab())
$('go').addEventListener('click', () => navigateTo(addressEl.value))
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
  else if (mod && e.key.toLowerCase() === 'w') { e.preventDefault(); closeTab(activeId) }
  else if (mod && e.key.toLowerCase() === 'l') { e.preventDefault(); addressEl.focus() }
  else if (mod && e.key.toLowerCase() === 'r') { e.preventDefault(); invoke('reload_browser').catch(() => {}) }
  else if (e.altKey && e.key === 'ArrowLeft') invoke('browser_back').catch(() => {})
  else if (e.altKey && e.key === 'ArrowRight') invoke('browser_forward').catch(() => {})
})

createTab()
layout()
