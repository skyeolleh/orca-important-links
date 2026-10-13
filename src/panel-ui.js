const icons = {
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M18 6 6 18"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3 9.6l6.3-.9L12 3Z"/>',
  page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M9 13l-2 2 2 2M15 13l2 2-2 2"/>',
  file: '<path d="M14 2H6v20h14V8l-6-6ZM14 2v6h6M8 13h8M8 17h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  backup: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  restore: '<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>'
}
const $ = selector => document.querySelector(selector)
const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true'); node.innerHTML = icons[name] || icons.file
  return node
}
document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)))
let previousFocus, toastTimer
function toast(message, undo) {
  clearTimeout(toastTimer)
  const node = $('#toast'); node.hidden = false; node.querySelector('span').textContent = message
  const button = node.querySelector('button'); button.hidden = !undo
  button.onclick = async () => { try { await undo(); node.hidden = true } catch (error) { toast(error.message) } }
  toastTimer = setTimeout(() => { node.hidden = true }, undo ? 12000 : 6000)
}
async function perform(action, params, message) {
  try { const value = await request(action, params); if (message) toast(message); return value }
  catch (error) { toast(error.message); return null }
}
function render() {
  const focused = document.activeElement
  const key = focused?.closest('[data-key]')?.dataset.key, scopeId = focused?.closest('[data-scope]')?.dataset.scope
  const selectedAction = focused?.dataset.action, selectedId = focused?.id
  const status = $('#connection')
  status.textContent = !state.connected ? '자동 수집을 사용하려면 Orca 연결 코드를 적용해 주세요.' : state.error
  status.hidden = state.connected && !state.error
  const list = $('#list'); list.replaceChildren()
  for (const [scope, title, source] of [['session', '현재 세션', state.links.filter(link => !link.hidden)], ['bookmarks', '글로벌', state.bookmarks]]) {
    const section = el('section', 'scope-section'); section.dataset.scope = scope; section.setAttribute('aria-label', title)
    const heading = el('div', 'scope-heading'), label = el('h2', 'scope-title', title)
    label.append(el('span', 'scope-count', String(source.length)))
    const add = el('button', 'icon-button'); add.id = scope === 'session' ? 'add' : 'add-global'
    add.setAttribute('aria-label', `${title} 링크 추가`); add.title = `${title} 링크 추가`; add.append(icon('plus'))
    add.disabled = !state.connected || (scope === 'session' && !state.session)
    add.onclick = () => addDialog(scope); heading.append(label, add); section.append(heading); list.append(section)
    if (scope === 'session' && state.session) section.append(el('p', 'session-caption', state.session.title || '코덱스 세션'))
    if (!source.length) section.append(el('p', 'scope-empty', scope === 'bookmarks' ? '다른 세션에서도 볼 링크를 등록하세요.' : !state.connected ? '연결 대기 중' : !state.session ? 'Codex 세션을 선택하세요.' : '답변에 제공된 프리뷰 링크가 여기에 모입니다.'))
    for (const link of [...source.filter(link => link.kind === 'preview'), ...source.filter(link => link.kind !== 'preview')]) {
      const params = { scope, id: link.id, sessionKey: state.session?.key }
      const row = el('article', `link-row${link.kind === 'preview' ? ' preview-card' : ''}`); row.dataset.key = link.id
      const body = el('button', 'link-body'); body.dataset.action = 'open'; body.title = link.target
      body.setAttribute('aria-label', `${link.title} 열기`)
      const badge = el('span', 'file-icon'); badge.append(icon(link.kind === 'preview' ? 'page' : link.type === 'web' ? 'globe' : 'file'))
      const copy = el('span', 'link-copy')
      let location = link.target.split('/').slice(-3).join('/')
      if (link.type === 'web') { try { location = new URL(link.target).hostname } catch {} }
      copy.append(el('span', 'link-type', link.kind === 'preview' ? '프리뷰' : link.type === 'web' ? '웹 링크' : '파일'), el('span', 'link-title', link.title), el('span', 'link-location', location))
      body.append(badge, copy); body.onclick = () => perform('open', params)
      const actions = el('div', 'row-actions')
      if (scope === 'session') {
        const star = el('button', 'icon-button'); star.dataset.action = 'bookmark'; star.append(icon('star'))
        star.setAttribute('aria-pressed', String(link.bookmarked)); star.title = link.bookmarked ? '글로벌 등록 해제' : '글로벌에도 등록'
        star.setAttribute('aria-label', `${link.title} ${star.title}`)
        star.onclick = () => perform('bookmark', params); actions.append(star)
      }
      const remove = el('button', 'icon-button remove'); remove.dataset.action = 'remove'; remove.append(icon('close'))
      remove.title = `${title}에서 제거`; remove.setAttribute('aria-label', `${link.title} ${remove.title}`)
      remove.onclick = async () => {
        const result = await perform('remove', params)
        if (result) toast(`${title}에서 제거했습니다.`, () => request('undo', { undoToken: result.undoToken }))
      }
      actions.append(remove); row.append(body, actions); section.append(row)
      if (key === link.id && scopeId === scope && selectedAction) row.querySelector(`[data-action="${selectedAction}"]`)?.focus()
    }
    if (selectedId === add.id) add.focus()
  }
}
function closeDialog() { $('#overlay').hidden = true; if (previousFocus?.isConnected) previousFocus.focus() }
function dialog(title) {
  previousFocus = document.activeElement; $('#overlay').hidden = false; $('#dialog-title').textContent = title
  $('#dialog-body').replaceChildren(); $('#dialog-actions').replaceChildren(); $('#dialog-error').hidden = true
  return $('#dialog-body')
}
function action(label, callback, primary = false) {
  const button = el('button', primary ? 'primary' : '', label)
  button.onclick = async () => {
    button.disabled = true
    try { await callback() } catch (error) { $('#dialog-error').hidden = false; $('#dialog-error').textContent = error.message }
    finally { button.disabled = false }
  }
  $('#dialog-actions').append(button); return button
}
function field(parentNode, label, tag, id, placeholder = '') {
  const caption = el('label', '', label); caption.htmlFor = id
  const input = el(tag); input.id = id; input.placeholder = placeholder; parentNode.append(caption, input); return input
}
function addDialog(scope) {
  const sessionKey = state.session?.key
  const body = dialog(scope === 'session' ? '현재 세션에 추가' : '글로벌에 추가')
  const text = field(body, '주소 또는 Markdown 링크', 'textarea', 'add-text', '[프리뷰](D:/작업/preview.html)')
  const name = field(body, '이름 (선택)', 'input', 'add-name'); name.maxLength = 500
  action('취소', closeDialog); action('추가', async () => {
    await request('add', { scope, sessionKey, text: text.value, title: name.value }); closeDialog()
  }, true); text.focus()
}
function copyText(input) {
  input.focus(); input.select(); let copied = false
  try { copied = document.execCommand('copy') === true } catch {}
  toast(copied ? '복사했습니다.' : `텍스트를 선택했습니다. ${navigator.userAgent.includes('Mac') ? '⌘C' : 'Ctrl+C'}로 복사하세요.`)
}
async function backupDialog(importing) {
  try {
    const value = importing ? '' : await request('export')
    const body = dialog(importing ? '백업 가져오기' : '백업 내보내기')
    body.append(el('p', '', importing ? '기존 목록을 유지하며 글로벌에 병합합니다. 이전 수동 목록 백업도 지원합니다.' : '현재 세션과 글로벌 링크의 백업입니다. 다른 세션 목록은 이 백업에 포함되지 않습니다.'))
    const text = field(body, '백업 JSON', 'textarea', 'backup-text'); text.className = 'backup-text'; text.value = value; text.readOnly = !importing
    action('닫기', closeDialog); action(importing ? '가져오기' : '복사', async () => {
      if (!importing) { copyText(text); return }
      await request('importLegacy', { text: text.value }); closeDialog(); toast('글로벌 목록에 가져왔습니다.')
    }, true); text.focus()
  } catch (error) { toast(error.message) }
}
function helpDialog() {
  const body = dialog('사용 안내')
  for (const [title, description] of [
    ['자동 수집', 'Orca 연결 코드가 적용되고 이 플러그인이 활성화되면, 선택한 Codex 세션의 답변 링크를 자동으로 수집합니다. 새 세션은 해당 세션의 링크만 표시합니다.'],
    ['글로벌', '별표를 누르거나 글로벌의 + 버튼으로 등록하세요. 다른 세션과 Orca 재시작 후에도 유지됩니다.'],
    ['연결 설치', '저장소 README의 연결 코드 설치 절차를 한 번 진행해야 합니다. 플러그인 업데이트만으로 Orca 앱 연결 코드가 설치되지는 않습니다. Orca 자동 업데이트 후에는 연결을 다시 준비해야 할 수 있습니다.'],
    ['파일 열기', '프리뷰·문서·미디어는 기본 앱으로 열립니다. 원격 호스트 파일은 로컬 파일로 대신 열지 않습니다.']
  ]) { const item = el('div', 'help-item'); item.append(el('strong', '', title), el('p', '', description)); body.append(item) }
  action('확인', closeDialog, true); $('#close-dialog').focus()
}
function menuDialog() {
  const body = dialog('보관함 메뉴')
  for (const [title, name, callback] of [
    ['다시 수집', 'restore', () => perform('refresh', {})],
    ['백업 내보내기', 'backup', () => backupDialog(false)],
    ['백업 가져오기', 'restore', () => backupDialog(true)], ['사용 안내', 'info', helpDialog]
  ]) { const button = el('button', 'menu-button', title); button.prepend(icon(name)); button.onclick = () => { closeDialog(); callback() }; body.append(button) }
  body.querySelector('button').focus()
}
$('#more').onclick = menuDialog; $('#close-dialog').onclick = closeDialog
$('#overlay').onclick = event => { if (event.target === $('#overlay')) closeDialog() }
document.addEventListener('keydown', event => {
  if ($('#overlay').hidden) return
  if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return }
  if (event.key !== 'Tab') return
  const controls = [...$('.dialog').querySelectorAll('button,input,textarea,select')].filter(node => !node.disabled && !node.hidden)
  if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
})
render(); greet()
