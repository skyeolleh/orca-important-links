import { normalizeLink, classifyLink, linksFromMessages, mergeLinks, loadLinks, saveLinks,
  sessionStorageKey, extractMarkdownLinks } from './session-links-core.mjs'

const BOOKMARKS = 'orca-session-links:v2:bookmarks'
const bookmarkId = (link, hostId) => `${link.type === 'web' ? 'web' : hostId}|${link.key}`
export class LinkLibrary {
  constructor(storage) {
    this.storage = storage; this.session = null; this.links = []; this.messages = new Map(); this.error = ''
    this.undoEntries = new Map()
    this.reloadBookmarks()
  }
  reloadBookmarks() {
    this.bookmarks = []
    try {
      const data = JSON.parse(this.storage.getItem(BOOKMARKS) ?? '[]')
      if (!Array.isArray(data)) return
      this.bookmarks = data.flatMap(item => {
        if (!item || typeof item !== 'object') return []
        const link = normalizeLink(item.href)
        if (!link || typeof item.title !== 'string' || typeof item.hostId !== 'string') return []
        return [{ ...link, title: item.title.slice(0, 500), kind: classifyLink(item.title, link.href),
          hostId: item.hostId, sessionTitle: String(item.sessionTitle ?? '').slice(0, 200),
          updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
          id: bookmarkId(link, item.hostId) }]
      }).slice(0, 200)
    } catch { this.error = '북마크 저장 기록을 읽지 못했습니다.' }
  }
  select(session) {
    this.session = session; this.messages.clear(); this.links = session ? loadLinks(this.storage, session) : []
    this.error = ''; this.hasMore = false
  }
  update(frame) {
    if (!this.session) return
    if (frame.error) { this.error = '대화 기록을 읽지 못했습니다. 새로고침해 다시 연결하세요.'; return }
    if (frame.pending) return
    const incoming = linksFromMessages(frame.messages ?? [], this.session.cwd)
    const changed = new Set([...(frame.removedIds ?? []), ...(frame.messages ?? []).map(m => m.itemId ?? m.id)])
    const keys = new Set(incoming.map(link => link.key))
    this.links = this.links.filter(link => link.hidden || !changed.has(link.messageId) || keys.has(link.key))
    if (frame.type === 'reset') this.links = this.links.filter(link => !link.messageId || link.hidden)
    if (['snapshot', 'replacement', 'reset'].includes(frame.type)) this.messages.clear()
    for (const id of frame.removedIds ?? []) this.messages.delete(id)
    for (const message of frame.messages ?? []) this.messages.set(message.itemId ?? message.id, message)
    while (this.messages.size > 1000) this.messages.delete(this.messages.keys().next().value)
    this.links = mergeLinks(this.links, linksFromMessages([...this.messages.values()], this.session.cwd))
    this.hasMore = frame.hasMore ?? this.hasMore; this.error = ''; this.saveSession()
  }
  saveSession() {
    if (this.session && !saveLinks(this.storage, this.session, this.links)) {
      throw new Error('목록을 저장하지 못했습니다. 저장 공간을 확인하세요.')
    }
  }
  assertSession(key) {
    if (!this.session || key !== sessionStorageKey(this.session)) throw new Error('세션이 바뀌었습니다. 현재 목록에서 다시 시도하세요.')
  }
  find(params) {
    if (params.scope === 'bookmarks') {
      const link = this.bookmarks.find(item => item.id === params.id)
      if (!link) throw new Error('북마크가 이미 삭제됐습니다.')
      return { link, hostId: link.hostId }
    }
    if (params.scope !== 'session') throw new Error('알 수 없는 목록입니다.')
    this.assertSession(params.sessionKey)
    const link = this.links.find(item => item.key === params.id)
    if (!link) throw new Error('링크가 목록에 없습니다.')
    return { link, hostId: this.session.hostId }
  }
  bookmark(params) {
    const { link, hostId } = this.find(params), id = bookmarkId(link, hostId)
    this.reloadBookmarks()
    const existing = this.bookmarks.find(item => item.id === id)
    const next = existing ? this.bookmarks.filter(item => item.id !== id) :
      [{ ...link, href: link.target, id, hostId, sessionTitle: this.session?.title ?? '', updatedAt: Date.now() }, ...this.bookmarks]
    if (next.length > 200) throw new Error('북마크는 최대 200개입니다. 사용하지 않는 항목을 먼저 해제하세요.')
    try { this.storage.setItem(BOOKMARKS, JSON.stringify(next)) }
    catch { throw new Error('북마크를 저장하지 못했습니다.') }
    this.bookmarks = next
  }
  hide(params) {
    const { link } = this.find(params)
    if (params.scope !== 'session') throw new Error('북마크는 별표로 해제할 수 있습니다.')
    const original = link.hidden; link.hidden = !original
    try { this.saveSession() } catch (error) { link.hidden = original; throw error }
  }
  add(params) {
    if (params.scope !== 'bookmarks') this.assertSession(params.sessionKey)
    if (params.scope === 'bookmarks' && Object.hasOwn(params, 'sessionKey') && params.sessionKey !== (this.session ? sessionStorageKey(this.session) : undefined)) {
      throw new Error('세션이 바뀌었습니다. 등록 창을 다시 열어 주세요.')
    }
    if (typeof params.text !== 'string' || params.text.length > 8192) throw new Error('추가할 내용은 8KB 이내로 입력하세요.')
    const cwd = this.session?.cwd ?? ''
    let links = extractMarkdownLinks(params.text, cwd)
    if (!links.length) {
      const direct = normalizeLink(params.text, cwd)
      if (direct) links = [{ ...direct, title: String(params.title || direct.href).slice(0, 500), kind: classifyLink(params.title, direct.href) }]
    }
    if (!links.length) throw new Error('웹 주소·파일 경로 또는 Markdown 링크를 입력하세요.')
    if (params.title && links.length === 1) links[0].title = String(params.title).slice(0, 500)
    if (params.scope === 'bookmarks') {
      this.reloadBookmarks()
      const hostId = this.session?.hostId ?? 'local'
      const entries = new Map(this.bookmarks.map(link => [link.id, link]))
      for (const link of links) { const id = bookmarkId(link, hostId); entries.set(id, { ...link, href: link.target, id, hostId, updatedAt: Date.now() }) }
      if (entries.size > 200) throw new Error('글로벌 링크는 최대 200개입니다.')
      const next = [...entries.values()]
      this.storage.setItem(BOOKMARKS, JSON.stringify(next)); this.bookmarks = next; return
    }
    const next = mergeLinks(this.links, links.map(link => ({ ...link, updatedAt: Date.now() })))
    if (!saveLinks(this.storage, this.session, next)) throw new Error('목록을 저장하지 못했습니다.')
    this.links = next
  }
  remove(params) {
    const { link } = this.find(params)
    const token = crypto.randomUUID()
    if (params.scope === 'bookmarks') {
      this.reloadBookmarks()
      const next = this.bookmarks.filter(item => item.id !== link.id)
      this.storage.setItem(BOOKMARKS, JSON.stringify(next)); this.bookmarks = next
      this.undoEntries.set(token, { scope: 'bookmarks', link: { ...link } })
    } else {
      const previous = link.hidden; link.hidden = true
      try { this.saveSession() } catch (error) { link.hidden = previous; throw error }
      this.undoEntries.set(token, { scope: 'session', session: { ...this.session }, key: link.key })
    }
    while (this.undoEntries.size > 20) this.undoEntries.delete(this.undoEntries.keys().next().value)
    return { undoToken: token }
  }
  undo(params) {
    const entry = this.undoEntries.get(params.undoToken)
    if (!entry) throw new Error('되돌릴 기록이 없습니다.')
    if (entry.scope === 'bookmarks') {
      this.reloadBookmarks()
      const next = new Map(this.bookmarks.map(link => [link.id, link])); next.set(entry.link.id, entry.link)
      if (next.size > 200) throw new Error('글로벌 링크 목록이 가득 찼습니다.')
      this.storage.setItem(BOOKMARKS, JSON.stringify([...next.values()])); this.bookmarks = [...next.values()]
    } else {
      const links = loadLinks(this.storage, entry.session), link = links.find(link => link.key === entry.key)
      if (!link) throw new Error('원래 세션의 링크가 삭제되었습니다.')
      link.hidden = false
      if (!saveLinks(this.storage, entry.session, links)) throw new Error('되돌린 목록을 저장하지 못했습니다.')
      if (this.session && sessionStorageKey(this.session) === sessionStorageKey(entry.session)) this.links = links
    }
    this.undoEntries.delete(params.undoToken)
  }
  exportBackup() {
    return JSON.stringify({ format: 'orca-important-links', version: 4,
      session: this.session ? { ...this.session, links: this.links } : null, bookmarks: this.bookmarks }, null, 2)
  }
  importLegacy(text) {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > 2000000) throw new Error('백업은 2MB 이내로 가져올 수 있습니다.')
    let data
    try { data = JSON.parse(text) } catch { throw new Error('이전 버전의 백업 텍스트를 붙여넣으세요.') }
    if (!data || typeof data !== 'object') throw new Error('지원하는 백업이 아닙니다.')
    let groups
    if (data.format === 'orca-important-links' && data.version === 4) {
      if (!Array.isArray(data.bookmarks)) throw new Error('글로벌 목록 형식을 확인하세요.')
      groups = [{ name: '글로벌 백업', links: data.bookmarks }]
      if (data.session) {
        if (!Array.isArray(data.session.links)) throw new Error('세션 목록 형식을 확인하세요.')
        groups.push({ name: '세션 백업', links: data.session.links.filter(link => !link.hidden).map(link => ({ ...link, hostId: data.session.hostId })) })
      }
    } else if (data.format === 'orca-session-links-plugin' && [1, 3].includes(data.version)) {
      groups = data.version === 1 ? data.sessions : data.groups
      if (data.version === 3 && Array.isArray(data.bookmarks)) groups = [...(groups ?? []), { name: '글로벌 백업', links: data.bookmarks }]
    }
    if (!Array.isArray(groups) || groups.length > 51) throw new Error('지원하는 목록 백업이 아닙니다.')
    this.reloadBookmarks()
    const next = new Map(this.bookmarks.map(link => [link.id, link]))
    for (const old of groups) {
      if (typeof old.name !== 'string' || !Array.isArray(old.links) || old.links.length > 500) throw new Error('세션 목록이 올바르지 않습니다.')
      for (const item of old.links) {
        const link = normalizeLink(item?.target || item?.href)
        if (!link || typeof item.title !== 'string') throw new Error('지원하지 않는 링크가 포함돼 있습니다.')
        const hostId = item.hostId ?? 'local'
        if (typeof hostId !== 'string' || !/^(local|(?:ssh|runtime):[^\s\u0000-\u001f]+)$/.test(hostId) || hostId.length > 1024) throw new Error('파일 소유 호스트가 올바르지 않습니다.')
        const id = bookmarkId(link, hostId)
        if (!next.has(id)) next.set(id, { ...link, id, hostId, title: item.title.slice(0, 500),
          kind: classifyLink(item.title, link.href), sessionTitle: `가져온 자료 · ${old.name.slice(0, 100)}`, updatedAt: Date.now() })
      }
    }
    if (next.size > 200) throw new Error('가져온 북마크가 200개를 초과합니다.')
    const bookmarks = [...next.values()]
    try { this.storage.setItem(BOOKMARKS, JSON.stringify(bookmarks)) } catch { throw new Error('가져온 자료를 저장하지 못했습니다.') }
    this.bookmarks = bookmarks
  }
  snapshot() {
    const ids = new Set(this.bookmarks.map(item => item.id))
    return { version: 4, session: this.session ? { id: this.session.id, hostId: this.session.hostId,
      title: this.session.title, key: sessionStorageKey(this.session) } : null,
      links: this.links.map(link => ({ ...link, id: link.key, bookmarked: ids.has(bookmarkId(link, this.session.hostId)) })),
      bookmarks: this.bookmarks.map(link => ({ ...link, bookmarked: true })), error: this.error, hasMore: this.hasMore }
  }
}
