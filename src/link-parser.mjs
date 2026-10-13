const BLOCKED = /[\u0000-\u001f\u007f]/
const PREVIEW = /프리뷰|미리보기|preview|\.(?:html?|png|jpe?g|gif|webp|mp4|webm|mov|svg)(?:[?#:]|$)/i
const REPORT = /검증|결과|보고서|report|validation|verification|\.(?:json|pdf)(?:[?#:]|$)/i

export function normalizeLink(raw, cwd = '') {
  if (typeof raw !== 'string') return null
  let href = raw.trim().replace(/^<|>$/g, '').replace(/\\([()[\]<>])/g, '$1')
  if (!href || href.length > 4096 || BLOCKED.test(href)) return null
  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      if (url.username || url.password) return null
      return { href: url.href, target: url.href, type: 'web', key: url.href }
    } catch { return null }
  }
  if (/^file:\/\//i.test(href)) {
    try {
      const url = new URL(href)
      if (url.hostname && url.hostname !== 'localhost') return null
      href = decodeURIComponent(url.pathname)
      if (/^\/[A-Za-z]:\//.test(href)) href = href.slice(1)
    } catch { return null }
  } else if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(href) && !/^[A-Za-z]:[\\/]/.test(href)) {
    return null
  }
  // 프리뷰는 운영체제로 열고, 소스 줄 번호는 표시용 링크에만 유지한다.
  let target = href.replace(/:\d+(?::\d+)?$/, '').replace(/#L\d+(?:-L\d+)?$/, '')
  if (!/^(?:[A-Za-z]:[\\/]|\/(?!\/))/.test(target)) {
    if (!cwd || href.startsWith('#') || href.startsWith('//') || href.startsWith('\\\\')) return null
    const root = cwd.replace(/\\/g, '/').replace(/\/$/, '')
    target = `${root}/${target}`
  }
  target = target.replace(/\\/g, '/')
  try {
    const win = /^[A-Za-z]:\//.test(target)
    const url = new URL(`file://${win ? '/' : ''}${target}`)
    target = decodeURIComponent(url.pathname)
    if (win) target = target.slice(1)
    return { href, target, type: 'file', key: win ? target.toLowerCase() : target }
  } catch { return null }
}

export function extractMarkdownLinks(text, cwd = '') {
  if (typeof text !== 'string') return []
  // 예제 코드와 기억 출처는 실제 결과 링크로 수집하지 않는다.
  text = text.replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/g, '')
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '').replace(/`[^`\n]*`/g, '')
  const found = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[' || text[i - 1] === '!' || text[i - 1] === '\\') continue
    let j = i + 1, nesting = 1
    for (; j < text.length && nesting; j++) {
      if (text[j] === '\\') { j++; continue }
      if (text[j] === '[') nesting++
      if (text[j] === ']') nesting--
    }
    if (nesting || text[j] !== '(') continue
    const title = text.slice(i + 1, j - 1).replace(/[*_`]/g, '').trim()
    let end = j + 1, raw
    if (text[end] === '<') {
      const close = text.indexOf('>', end + 1)
      if (close < 0 || text[close + 1] !== ')') continue
      raw = text.slice(end + 1, close); end = close + 2
    } else {
      const start = end
      nesting = 1
      for (; end < text.length && nesting; end++) {
        if (text[end] === '\\' && /[()]/.test(text[end + 1] ?? '')) { end++; continue }
        if (text[end] === '(') nesting++
        if (text[end] === ')') nesting--
      }
      if (nesting) continue
      raw = text.slice(start, end - 1).replace(/\s+["'][^\n]*["']\s*$/, '')
    }
    const link = normalizeLink(raw, cwd)
    if (link) found.push({ ...link, title: title || raw, kind: classifyLink(title, link.href) })
    i = end - 1
  }
  return found
}

export function classifyLink(title, href) {
  if (PREVIEW.test(`${title} ${href}`)) return 'preview'
  if (REPORT.test(`${title} ${href}`)) return 'report'
  return 'document'
}
