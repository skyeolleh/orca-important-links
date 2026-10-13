const icons = {
  stack: '<path d="m3 7 9-4 9 4-9 4-9-4Zm0 5 9 4 9-4M3 17l9 4 9-4"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2-5.7-3-5.7 3 1.1-6.2L3 9.6l6.3-.9L12 3Z"/>',
  page: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M7 6.5h.1M10 6.5h.1M9 13l-2 2 2 2M15 13l2 2-2 2"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>',
  edit: '<path d="m16 3 5 5-12 12H4v-5L16 3ZM13 6l5 5"/>',
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
const icon = name => {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  node.setAttribute('viewBox', '0 0 24 24'); node.setAttribute('aria-hidden', 'true')
  node.innerHTML = icons[name] || icons.file
  return node
}
document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)))
let previousFocus, toastTimer
const isMac = navigator.userAgent.includes('Mac')
const shortcut = isMac ? '⌘C' : 'Ctrl+C'

function toast(message, undo) {
  clearTimeout(toastTimer)
  const node = $('#toast'); node.hidden = false; node.querySelector('span').textContent = message
  const button = node.querySelector('button'); button.hidden = !undo
  button.onclick = () => { try { undo(); node.hidden = true; render() } catch (error) { toast(error.message) } }
  toastTimer = setTimeout(() => { node.hidden = true }, undo ? 12000 : 6000)
}
function locationOf(link) {
  if (link.type === 'web') return new URL(link.target).hostname
  const parts = link.target.split('/')
  return parts.slice(-3).join('/')
}
function typeOf(link) {
  if (link.type === 'web') return link.kind === 'preview' ? '웹 프리뷰' : '웹 링크'
  const extension = link.target.split('.').at(-1).toLowerCase().split(/[?#]/)[0]
  if (['html', 'htm'].includes(extension)) return 'HTML 프리뷰'
  if (['mp4', 'webm', 'mov'].includes(extension)) return '영상'
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(extension)) return '이미지'
  return link.kind === 'report' ? '검증 자료' : '파일'
}
function render() {
  const selectedKey = document.activeElement?.closest('[data-key]')?.dataset.key
  const selectedAction = document.activeElement?.dataset.action
  const selectedScope = document.activeElement?.closest('[data-scope]')?.dataset.scope
  const selectedId = document.activeElement?.id
  const list = $('#list'); list.replaceChildren()
  for (const [scope, title, source] of [['links', '현재 세션', state.active.links], ['bookmarks', '글로벌', state.bookmarks]]) {
    const section = el('section', 'scope-section'); section.dataset.scope = scope; section.setAttribute('aria-label', title)
    const heading = el('div', 'scope-heading')
    const label = el('h2', 'scope-title', title)
    label.title = scope === 'links' ? `${state.active.name} · 메뉴에서 직접 선택` : '모든 작업 묶음에서 공유하는 링크'
    label.append(el('span', 'scope-count', String(source.length)))
    const add = el('button', 'icon-button'); add.id = scope === 'links' ? 'add' : 'add-global'
    add.setAttribute('aria-label', `${title} 링크 추가`); add.title = `${title} 링크 추가`; add.append(icon('plus'))
    add.onclick = () => addDialog(scope)
    heading.append(label, add); section.append(heading); list.append(section)
    if (!source.length) {
      const empty = el('p', 'scope-empty', scope === 'links' ? '이 세션에 등록한 링크가 없어요.' : '다른 작업에서도 볼 링크를 등록해 주세요.')
      section.append(empty); if (selectedId === add.id) add.focus(); continue
    }
    const links = [...source.filter(link => link.kind === 'preview'), ...source.filter(link => link.kind !== 'preview')]
    for (const link of links) {
      const preview = link.kind === 'preview'
      const row = el('article', `link-row${preview ? ' preview-card' : ''}`); row.dataset.key = link.key
      const body = el('button', 'link-body'); body.dataset.action = 'address'; body.title = `${link.target}\n주소 확인·복사`
      body.setAttribute('aria-label', `${link.title} 주소 확인·복사`)
      const badge = el('span', 'file-icon'); badge.append(icon(preview ? 'page' : link.type === 'web' ? 'globe' : 'file'))
      const copy = el('span', 'link-copy'); copy.append(el('span', 'link-type', typeOf(link)), el('span', 'link-title', link.title), el('span', 'link-location', locationOf(link)))
      body.append(badge, copy); body.onclick = () => addressDialog(link)
      const actions = el('div', 'row-actions')
      if (scope === 'links') {
        const star = el('button', 'icon-button'); star.dataset.action = 'bookmark'; star.append(icon('star'))
        star.setAttribute('aria-pressed', String(state.isBookmarked(link.key)))
        star.setAttribute('aria-label', state.isBookmarked(link.key) ? `${link.title} 글로벌 등록 해제` : `${link.title} 글로벌 등록`)
        star.title = state.isBookmarked(link.key) ? '글로벌 등록 해제' : '글로벌에도 등록'
        star.onclick = () => {
          try { const marked = state.isBookmarked(link.key); state.bookmark(link); render(); toast(marked ? '글로벌 등록을 해제했습니다.' : '글로벌에도 등록했습니다.') }
          catch (error) { toast(error.message) }
        }
        actions.append(star)
      }
      {
        const remove = el('button', 'icon-button remove'); remove.dataset.action = 'remove'; remove.append(icon('close'))
        remove.title = `${title}에서 제거`; remove.setAttribute('aria-label', `${link.title} ${title}에서 제거`)
        remove.onclick = () => {
          const groupId = state.activeId
          state.remove(link.key, scope); render()
          toast(`${title}에서 제거했습니다.`, () => state.restoreLink(link, groupId, scope))
        }; actions.append(remove)
      }
      row.append(body, actions); section.append(row)
      if (selectedKey === link.key && selectedScope === scope && selectedAction) row.querySelector(`[data-action="${selectedAction}"]`)?.focus()
    }
    if (selectedId === add.id) add.focus()
  }
}
function closeDialog() { $('#overlay').hidden = true; previousFocus?.isConnected && previousFocus.focus() }
function dialog(title) {
  previousFocus = document.activeElement
  $('#overlay').hidden = false; $('#dialog-title').textContent = title
  $('#dialog-body').replaceChildren(); $('#dialog-actions').replaceChildren(); $('#dialog-error').hidden = true
  return $('#dialog-body')
}
function action(label, callback, primary = false) {
  const button = el('button', primary ? 'primary' : '', label)
  button.onclick = () => {
    try { callback() } catch (error) { $('#dialog-error').hidden = false; $('#dialog-error').textContent = error.message }
  }
  $('#dialog-actions').append(button); return button
}
function field(parent, label, tag, id, placeholder = '') {
  const caption = el('label', '', label); caption.htmlFor = id
  const input = el(tag); input.id = id; input.placeholder = placeholder
  parent.append(caption, input); return input
}
function addDialog(defaultScope = 'links') {
  const body = dialog('링크 추가')
  const scope = field(body, '등록 위치', 'select', 'add-scope')
  for (const [value, title] of [['links', '현재 세션'], ['bookmarks', '글로벌']]) {
    const option = el('option', '', title); option.value = value; scope.append(option)
  }
  scope.value = defaultScope
  const description = el('p'); body.append(description)
  const describe = () => { description.textContent = scope.value === 'bookmarks' ? '모든 작업 묶음에서 공유하는 글로벌 링크로 등록합니다.' : `‘${state.active.name}’에 등록합니다. 실제 세션 자동 연결은 지원되지 않습니다.` }
  scope.onchange = describe; describe()
  const text = field(body, '주소 또는 마크다운 링크', 'textarea', 'add-text', '[프리뷰](D:/작업/preview.html)')
  const name = field(body, '이름 (선택)', 'input', 'add-name', '링크를 하나 추가할 때 지정')
  action('취소', closeDialog); action('추가', () => { const count = state.add(text.value, name.value, scope.value); closeDialog(); render(); toast(`${count}개 링크를 반영했습니다.`) }, true)
  text.focus()
}
function groupDialog(rename = false) {
  const body = dialog(rename ? '작업 이름 변경' : '새 작업 묶음')
  body.append(el('p', '', '작업 묶음은 직접 선택하는 분류입니다. 실제 Codex 세션과 자동으로 연결되지 않습니다.'))
  const name = field(body, '작업 이름', 'input', 'group-name', '예: 캐릭터 상태 작업')
  name.maxLength = 120; name.value = rename ? state.active.name : ''
  action('취소', closeDialog); const submit = action(rename ? '변경' : '만들기', () => {
    rename ? state.rename(name.value) : state.create(name.value)
    closeDialog(); render()
  }, true)
  name.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); submit.click() } }
  name.focus(); name.select()
}
function copyText(input) {
  input.focus(); input.select()
  let copied = false
  try { copied = document.execCommand('copy') === true } catch {}
  toast(copied ? '복사했습니다.' : `텍스트를 선택했습니다. ${shortcut}로 복사해 주세요.`)
}
function addressDialog(link) {
  const body = dialog(link.title)
  body.append(el('p', '', '현재 Orca 플러그인에서는 직접 열기가 지원되지 않습니다. 주소를 복사해 브라우저나 파일 탐색기에 붙여 넣어 주세요.'))
  const address = field(body, '주소', 'textarea', 'link-address'); address.value = link.target; address.readOnly = true
  action('닫기', closeDialog); action('주소 복사', () => copyText(address), true)
  address.focus(); address.select()
}
function backupDialog(importing = false) {
  const body = dialog(importing ? '백업 가져오기' : '백업 내보내기')
  body.append(el('p', '', importing ? '백업 텍스트를 붙여 넣어 주세요. 기존 목록을 유지하며 합칩니다. 예전 0.1 버전 백업도 가져올 수 있어요.' : '패널을 닫거나 Orca를 재시작하면 목록이 사라질 수 있습니다. 이 텍스트를 파일에 복사해 보관해 주세요.'))
  const text = field(body, '백업 JSON', 'textarea', 'backup-text'); text.className = 'backup-text'
  if (!importing) { text.value = state.export(); text.readOnly = true }
  action('닫기', closeDialog)
  action(importing ? '가져오기' : '백업 복사', () => {
    if (!importing) { copyText(text); return }
    const count = state.import(text.value); closeDialog(); render(); toast(`${count}개 작업 묶음을 가져왔습니다.`)
  }, true)
  text.focus(); if (!importing) text.select()
}
function helpDialog() {
  const body = dialog('사용 안내')
  const items = [
    ['현재 세션과 글로벌', '각 영역의 + 버튼으로 해당 위치에 등록합니다. 현재 세션의 별표를 누르면 글로벌에도 등록합니다. 두 영역에서 같은 링크를 각각 관리할 수 있습니다.'],
    ['세션 선택', '현재 세션 영역은 메뉴에서 직접 선택한 작업 묶음을 표시합니다. 실제 Codex 세션을 자동 추적하지 않습니다. 글로벌 링크는 모든 작업 묶음에서 공유합니다.'],
    ['임시 보관과 백업', '목록은 열린 패널의 메모리에만 남습니다. 패널 재생성·재설치·Orca 재시작 전에 메뉴에서 백업 텍스트를 보관하세요.'],
    ['현재 지원 범위', '실제 Codex 세션 자동 추적, 대화 링크 자동 등록, 직접 열기, 영구 저장은 현재 Orca 패널 API에서 지원되지 않습니다.']
  ]
  for (const [title, description] of items) { const item = el('div', 'help-item'); item.append(el('strong', '', title), el('p', '', description)); body.append(item) }
  action('확인', closeDialog, true); $('#close-dialog').focus()
}
function menuDialog() {
  const body = dialog('보관함 메뉴')
  const select = field(body, '작업 묶음 (직접 선택)', 'select', 'group')
  for (const group of state.groups) { const option = el('option', '', group.name); option.value = group.id; select.append(option) }
  select.value = state.activeId
  select.onchange = () => { state.select(select.value); closeDialog(); render() }
  for (const [title, name, callback] of [
    ['새 작업 묶음', 'plus', () => groupDialog()], ['작업 이름 변경', 'edit', () => groupDialog(true)], ['백업 내보내기', 'backup', () => backupDialog()],
    ['백업 가져오기', 'restore', () => backupDialog(true)], ['사용 안내', 'info', helpDialog]
  ]) {
    const button = el('button', 'menu-button', title); button.prepend(icon(name)); button.onclick = () => { closeDialog(); callback() }; body.append(button)
  }
  select.focus()
}
$('#more').onclick = menuDialog
$('#close-dialog').onclick = closeDialog
$('#overlay').onclick = event => { if (event.target === $('#overlay')) closeDialog() }
document.addEventListener('keydown', event => {
  if ($('#overlay').hidden) return
  if (event.key === 'Escape') { event.preventDefault(); closeDialog(); return }
  if (event.key !== 'Tab') return
  const controls = [...$('.dialog').querySelectorAll('button,input,textarea,select')].filter(node => !node.disabled && !node.hidden)
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
})
render()
