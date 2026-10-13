import { normalizeLink, classifyLink, extractMarkdownLinks } from './link-parser.mjs'

const FORMAT = 'orca-session-links-plugin'
const MAX_GROUPS = 50, MAX_LINKS = 500, MAX_MARKS = 200
const nameOf = value => typeof value === 'string' ? value.trim().slice(0, 120) : ''
const fail = message => { throw new Error(message) }

function cleanLink(raw) {
  if (!raw || typeof raw !== 'object') fail('링크 형식이 올바르지 않습니다.')
  const link = normalizeLink(raw.target || raw.href)
  if (!link) fail('웹 주소 또는 절대 파일 경로를 사용해 주세요.')
  const title = nameOf(raw.title) || defaultTitle(link.target)
  return { ...link, title, kind: classifyLink(title, link.target) }
}

export function defaultTitle(target) {
  if (/^https?:/i.test(target)) {
    const url = new URL(target)
    const name = url.pathname.split('/').filter(Boolean).at(-1) || url.hostname
    try { return decodeURIComponent(name).slice(0, 120) } catch { return name.slice(0, 120) }
  }
  return target.split('/').at(-1).slice(0, 120)
}

export class ShelfState {
  constructor() {
    this.groups = [{ id: 'group-1', name: '새 작업', links: [] }]
    this.activeId = 'group-1'
    this.bookmarks = []
    this.nextId = 2
  }
  get active() { return this.groups.find(group => group.id === this.activeId) }
  select(id) {
    if (!this.groups.some(group => group.id === id)) fail('작업 묶음을 찾을 수 없습니다.')
    this.activeId = id
  }
  create(name) {
    if (this.groups.length >= MAX_GROUPS) fail('작업 묶음은 최대 50개까지 만들 수 있습니다.')
    name = nameOf(name)
    if (!name) fail('작업 이름을 입력해 주세요.')
    const group = { id: `group-${this.nextId++}`, name, links: [] }
    this.groups.push(group); this.activeId = group.id
  }
  rename(name) {
    name = nameOf(name)
    if (!name) fail('작업 이름을 입력해 주세요.')
    this.active.name = name
  }
  add(text, title = '', scope = 'links') {
    if (typeof text !== 'string' || text.length > 100000) fail('입력은 10만 글자 이내로 작성해 주세요.')
    let links = extractMarkdownLinks(text)
    if (!links.length) {
      links = text.split(/\r?\n/).map(value => value.trim()).filter(Boolean).map(href => cleanLink({ href }))
    }
    if (!links.length) fail('주소나 마크다운 링크를 붙여 넣어 주세요.')
    if (title.trim()) {
      if (links.length !== 1) fail('이름은 링크를 하나 추가할 때 지정할 수 있습니다.')
      links[0].title = nameOf(title)
    }
    links = links.map(cleanLink)
    const previous = scope === 'bookmarks' ? this.bookmarks : this.active.links
    const merged = new Map(previous.map(link => [link.key, link]))
    for (const link of links) merged.set(link.key, link)
    if (merged.size > (scope === 'bookmarks' ? MAX_MARKS : MAX_LINKS)) fail('이 목록에 추가할 수 있는 링크 수를 초과했습니다.')
    const result = [...merged.values()]
    if (scope === 'bookmarks') this.bookmarks = result
    else this.active.links = result
    return links.length
  }
  isBookmarked(key) { return this.bookmarks.some(link => link.key === key) }
  bookmark(link) {
    if (this.isBookmarked(link.key)) { this.bookmarks = this.bookmarks.filter(item => item.key !== link.key); return }
    if (this.bookmarks.length >= MAX_MARKS) fail('북마크는 최대 200개까지 추가할 수 있습니다.')
    this.bookmarks.push({ ...link })
  }
  remove(key, scope) {
    if (scope === 'bookmarks') this.bookmarks = this.bookmarks.filter(link => link.key !== key)
    else this.active.links = this.active.links.filter(link => link.key !== key)
  }
  restoreLink(link, groupId, scope) {
    const list = scope === 'bookmarks' ? this.bookmarks : this.groups.find(group => group.id === groupId)?.links
    if (!list || list.some(item => item.key === link.key)) return
    if (list.length >= (scope === 'bookmarks' ? MAX_MARKS : MAX_LINKS)) fail('목록이 가득 차 복원하지 못했습니다.')
    list.push(link)
  }
  export() {
    return JSON.stringify({ format: FORMAT, version: 3, activeId: this.activeId,
      groups: this.groups, bookmarks: this.bookmarks }, null, 2)
  }
  import(text) {
    if (typeof text !== 'string' || text.length > 2000000 || new TextEncoder().encode(text).length > 2000000) fail('백업은 2MB 이내의 텍스트여야 합니다.')
    let data
    try { data = JSON.parse(text) } catch { fail('백업 JSON을 확인해 주세요.') }
    if (!data || data.format !== FORMAT || ![1, 3].includes(data.version)) fail('지원하는 링크 보관함 백업이 아닙니다.')
    const groups = data.version === 1 ? data.sessions : data.groups
    if (!Array.isArray(groups) || groups.length > MAX_GROUPS) fail('작업 묶음은 최대 50개까지 가져올 수 있습니다.')
    const incoming = groups.map(group => {
      if (!group || !Array.isArray(group.links) || group.links.length > MAX_LINKS || !nameOf(group.name)) fail('작업 묶음 형식을 확인해 주세요.')
      return { name: nameOf(group.name), links: group.links.map(cleanLink), raw: group.links }
    })
    let marks = data.version === 1 ? incoming.flatMap(group => group.raw.filter(link => link.pinned).map(cleanLink)) : data.bookmarks
    if (!Array.isArray(marks) || marks.length > MAX_MARKS) fail('북마크 형식을 확인해 주세요.')
    marks = marks.map(cleanLink)
    const mergedMarks = new Map(this.bookmarks.map(link => [link.key, link]))
    for (const link of marks) mergedMarks.set(link.key, link)
    const next = this.groups.map(group => ({ ...group, links: [...group.links] }))
    let nextId = this.nextId
    for (const item of incoming) {
      let group = next.find(group => group.name === item.name)
      if (!group) { group = { id: `group-${nextId++}`, name: item.name, links: [] }; next.push(group) }
      const merged = new Map(group.links.map(link => [link.key, link]))
      for (const link of item.links) merged.set(link.key, link)
      group.links = [...merged.values()]
    }
    if (next.length > MAX_GROUPS || next.some(group => group.links.length > MAX_LINKS) || mergedMarks.size > MAX_MARKS) fail('가져온 목록과 기존 목록을 합치면 허용 수를 초과합니다.')
    this.groups = next; this.bookmarks = [...mergedMarks.values()]; this.nextId = nextId
    return incoming.length
  }
}
