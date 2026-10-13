import { LinkLibrary } from './link-library.mjs'
import { resolveFocusedSession, sessionStorageKey, loadLinks } from './session-links-core.mjs'
import { subscribeLinksFeed, openSessionLink } from './session-links-feed.mjs'

export const FRAME_NAME = 'orca-plugin-panel:plugin:yeojh-local.session-links/links'
export function mountLinksConnector({ doc = document, store, api, storage = localStorage }) {
  const library = new LinkLibrary(storage)
  let enabled = false, stopped = false, feed = null, epoch = 0, key = null, refreshEpoch = 0
  let panel = null, nonce = '', calls = [], snapshotQueued = false
  const view = doc.defaultView
  function findPanel() {
    const current = enabled ? doc.querySelector(`iframe[name="${FRAME_NAME}"]`) : null
    if (current !== panel) { panel = current; nonce = current ? crypto.randomUUID() : ''; calls = [] }
    return panel?.contentWindow ?? null
  }
  function publish() {
    if (snapshotQueued || stopped) return
    snapshotQueued = true
    queueMicrotask(() => {
      snapshotQueued = false
      if (!stopped) findPanel()?.postMessage({ type: 'session-links:snapshot', nonce, ...library.snapshot() }, '*')
    })
  }
  function connect() {
    feed?.(); feed = null; const token = ++epoch
    if (!enabled || !library.session) return
    feed = subscribeLinksFeed(api, library.session, frame => {
      if (token !== epoch || stopped) return
      try { library.update(frame) } catch (error) { library.error = error.message }
      publish()
    }, error => { if (token === epoch && !stopped) { library.error = error; publish() } })
  }
  function select() {
    const next = enabled ? resolveFocusedSession(store.getState()) : null
    const nextKey = next ? `${sessionStorageKey(next)}:${next.mode}:${next.transcriptPath ?? ''}` : ''
    if (nextKey !== key) { key = nextKey; library.select(next); connect(); publish() }
    else if (next && library.session?.title !== next.title) { library.session = next; publish() }
  }
  async function checkPlugin() {
    const token = ++refreshEpoch
    try {
      const list = await api.plugins.list()
      if (token !== refreshEpoch || stopped) return
      enabled = list.some(plugin => plugin.pluginKey === 'yeojh-local.session-links' && /^0\.4\.\d+$/.test(plugin.version) && !plugin.needsReconsent && !plugin.blockedByKillList &&
        ['running', 'idle', 'restarting'].includes(plugin.status))
    } catch { if (token !== refreshEpoch || stopped) return; enabled = false }
    select(); findPanel(); publish()
  }
  async function onMessage(event) {
    const source = findPanel(), data = event.data
    if (!source || event.source !== source || !data || data.type !== 'session-links:request') return
    if (typeof data.requestId !== 'string' || data.requestId.length > 100 || typeof data.action !== 'string') return
    const now = Date.now(); calls = calls.filter(time => now - time < 10000)
    if (calls.length >= 30) return
    calls.push(now)
    const reply = (ok, error, value) => {
      if (!stopped && findPanel() === source) source.postMessage({ type: 'session-links:result', requestId: data.requestId, ok, error, value }, '*')
    }
    if (data.action === 'hello') { publish(); reply(true); return }
    if (data.nonce !== nonce) { reply(false, '연결이 바뀌었습니다. 현재 목록에서 다시 시도하세요.'); return }
    const params = data.params
    let size = Infinity
    try { size = JSON.stringify(params).length } catch {}
    if (!params || typeof params !== 'object' || Array.isArray(params) || size > (data.action === 'importLegacy' ? 2100000 : 10000)) { reply(false, '요청 형식이 올바르지 않습니다.'); return }
    try {
      let value
      switch (data.action) {
        case 'bookmark': library.bookmark(params); break
        case 'hide': library.hide(params); break
        case 'add': library.add(params); break
        case 'remove': value = library.remove(params); break
        case 'undo': library.undo(params); break
        case 'export': value = library.exportBackup(); break
        case 'importLegacy': library.importLegacy(params.text); break
        case 'open': {
          const { link, hostId } = library.find(params)
          await openSessionLink(api, link, { hostId }); break
        }
        case 'refresh': connect(); break
        default: throw new Error('지원하지 않는 요청입니다.')
      }
      publish(); reply(true, undefined, value)
    } catch (error) { reply(false, error.message) }
  }
  function onStorage(event) {
    if (event.key?.startsWith('orca-session-links:')) {
      library.reloadBookmarks()
      if (library.session) library.links = loadLinks(storage, library.session)
      publish()
    }
  }
  const unsubscribe = store.subscribe(select)
  const stopChanged = api.plugins.onChanged?.(checkPlugin)
  const observer = new view.MutationObserver(() => { const previous = panel; findPanel(); if (panel !== previous) publish() })
  observer.observe(doc.body, { childList: true, subtree: true })
  view.addEventListener('message', onMessage); view.addEventListener('storage', onStorage)
  void checkPlugin()
  return () => {
    stopped = true; epoch++; refreshEpoch++; feed?.(); unsubscribe?.(); stopChanged?.(); observer.disconnect()
    view.removeEventListener('message', onMessage); view.removeEventListener('storage', onStorage)
  }
}
