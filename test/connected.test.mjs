import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LinkLibrary } from '../host/link-library.mjs'
import { resolveFocusedSession, sessionStorageKey, linksFromMessages } from '../host/session-links-core.mjs'
import { subscribeLinksFeed, openSessionLink } from '../host/session-links-feed.mjs'
import { verifyFuse } from '../host/prepare-connector.mjs'
const storage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) } }
const session = (id, hostId = 'local') => ({ id, hostId, cwd: 'D:/work', title: id, mode: 'terminal' })
const message = (id, text, role = 'assistant') => ({ id, role, timestamp: 10, blocks: [{ type: 'text', text }] })
const action = model => ({ scope: 'session', sessionKey: model.snapshot().session.key, id: model.snapshot().links[0].id })
function terminalState() {
  return { activeWorktreeId: 'work', groupsByWorktree: { work: [{ id: 'group', activeTabId: 'unified' }] },
    activeGroupIdByWorktree: { work: 'group' }, unifiedTabsByWorktree: { work: [{ id: 'unified', contentType: 'terminal', entityId: 'tab' }] },
    terminalLayoutsByTabId: { tab: { activeLeafId: 'leaf' } },
    agentStatusByPaneKey: { 'tab:leaf': { paneKey: 'tab:leaf', agentType: 'codex', providerSession: { id: 'actual-session', transcriptPath: 'D:/session.jsonl' } } },
    getKnownWorktreeById: () => ({ path: 'D:/work' }) }
}
test('선택한 터미널의 실제 Codex ID를 사용하며 새 탭·다른 도구에 이전 목록을 붙이지 않는다', () => {
  const state = terminalState(); assert.equal(resolveFocusedSession(state).id, 'actual-session')
  state.unifiedTabsByWorktree.work[0].entityId = 'new-tab'; assert.equal(resolveFocusedSession(state), null)
  state.unifiedTabsByWorktree.work[0].contentType = 'browser'; assert.equal(resolveFocusedSession(state), null)
  state.unifiedTabsByWorktree.work = []; assert.equal(resolveFocusedSession(state), null)
})
test('분할 터미널은 활성 칸만 선택하고 주인을 확정할 수 없으면 빈 세션으로 둔다', () => {
  const state = terminalState(); state.agentStatusByPaneKey['tab:second'] = { paneKey: 'tab:second', agentType: 'codex', providerSession: { id: 'second' } }
  assert.equal(resolveFocusedSession(state).id, 'actual-session')
  state.terminalLayoutsByTabId.tab.activeLeafId = 'second'; assert.equal(resolveFocusedSession(state).id, 'second')
  state.terminalLayoutsByTabId.tab.activeLeafId = null; assert.equal(resolveFocusedSession(state), null)
})
test('구조화된 Codex 세션은 실행 호스트와 실제 ID를 함께 사용한다', () => {
  const state = terminalState(); state.unifiedTabsByWorktree.work[0] = { id: 'unified', contentType: 'agent-session', entityId: 'native', agentSessionAgent: 'codex', executionHostId: 'runtime:owner' }
  assert.equal(resolveFocusedSession(state).hostId, 'runtime:owner'); assert.equal(resolveFocusedSession(state).id, 'native')
  state.unifiedTabsByWorktree.work[0].agentSessionAgent = 'claude'; assert.equal(resolveFocusedSession(state), null)
  assert.notEqual(sessionStorageKey(session('same', 'local')), sessionStorageKey(session('same', 'runtime:owner')))
})
test('답변 링크만 수집하고 사용자·도구·하위 에이전트·코드 예제는 제외한다', () => {
  const links = linksFromMessages([message('a', '[프리뷰](<D:/한글 폴더/화면(1).html>) ` [예제](https://bad.test)`'),
    message('u', '[사용자](https://user.test)', 'user'), message('t', '[도구](https://tool.test)', 'tool'),
    { ...message('child', '[자식](https://child.test)'), agentId: 'child' }])
  assert.equal(links.length, 1); assert.equal(links[0].target, 'D:/한글 폴더/화면(1).html')
})
test('자동 수집·글로벌 별표·다른 세션·재시작 복원을 함께 유지한다', () => {
  const data = storage(), model = new LinkLibrary(data); model.select(session('one'))
  model.update({ type: 'snapshot', messages: [message('m', '[프리뷰](Docs/preview.html)')] }); model.bookmark(action(model))
  model.select(session('two')); assert.equal(model.snapshot().links.length, 0); assert.equal(model.snapshot().bookmarks.length, 1)
  model.update({ type: 'appended', messages: [message('n', '[다른 프리뷰](Docs/two.html)')] })
  const reopened = new LinkLibrary(data); reopened.select(session('one'))
  assert.equal(reopened.snapshot().links[0].target, 'D:/work/Docs/preview.html'); assert.equal(reopened.snapshot().links[0].bookmarked, true)
  reopened.select(session('two')); assert.equal(reopened.snapshot().links[0].target, 'D:/work/Docs/two.html')
})
test('삭제한 링크는 재수집과 기록 재설정 후에도 숨기며 다른 세션에서 되돌려도 원래 세션만 바뀐다', () => {
  const model = new LinkLibrary(storage()); model.select(session('one'))
  const frame = { type: 'snapshot', messages: [message('m', '[프리뷰](D:/one.html)')] }; model.update(frame)
  const token = model.remove(action(model)); model.update({ ...frame, type: 'reset' }); assert.equal(model.snapshot().links[0].hidden, true)
  model.select(session('two')); model.undo(token); assert.equal(model.snapshot().links.length, 0)
  model.select(session('one')); assert.equal(model.snapshot().links[0].hidden, false)
})
test('등록 대화상자를 연 뒤 세션이 바뀌면 이전 등록 요청을 거부한다', () => {
  const model = new LinkLibrary(storage()); model.select(session('one')); const key = model.snapshot().session.key
  model.select(session('two')); assert.throws(() => model.add({ scope: 'session', sessionKey: key, text: 'D:/old.html' }), /세션이 바뀌/)
  assert.equal(model.snapshot().links.length, 0)
  assert.throws(() => model.add({ scope: 'bookmarks', sessionKey: key, text: 'preview.html' }), /세션이 바뀌/)
})
test('상대 경로는 저장 시 절대 경로로 확정하며 이후 작업 폴더가 바뀌어도 원래 파일을 유지한다', () => {
  const data = storage(), model = new LinkLibrary(data); model.select(session('one'))
  model.update({ type: 'snapshot', messages: [message('m', '[프리뷰](page.html)')] })
  const reopened = new LinkLibrary(data); reopened.select({ ...session('one'), cwd: 'D:/different' })
  assert.equal(reopened.snapshot().links[0].target, 'D:/work/page.html')
})
test('수정된 답변에서 빠졌다가 다시 등장하는 삭제 링크도 재등록하지 않는다', () => {
  const model = new LinkLibrary(storage()); model.select(session('one'))
  const frame = { type: 'snapshot', messages: [message('m', '[프리뷰](D:/hidden.html)')] }
  model.update(frame); model.remove(action(model)); model.update({ type: 'appended', messages: [message('m', '링크 없는 수정 답변')] })
  model.update({ ...frame, type: 'appended' }); assert.equal(model.snapshot().links[0].hidden, true)
})
test('Codex 세션이 없을 때도 글로벌 등록·삭제·되돌리기·재시작을 지원한다', () => {
  const data = storage(), model = new LinkLibrary(data)
  model.add({ scope: 'bookmarks', text: 'https://example.com/preview', title: '고정 링크' })
  const params = { scope: 'bookmarks', id: model.snapshot().bookmarks[0].id }, token = model.remove(params)
  assert.equal(model.snapshot().bookmarks.length, 0); model.undo(token)
  assert.equal(new LinkLibrary(data).snapshot().bookmarks[0].title, '고정 링크')
})
test('글로벌 삭제와 세션 삭제는 독립적이며 저장 실패는 등록 상태를 바꾸지 않는다', () => {
  const data = storage(), model = new LinkLibrary(data); model.select(session('one'))
  model.update({ type: 'snapshot', messages: [message('m', '[프리뷰](D:/one.html)')] }); model.bookmark(action(model))
  model.remove({ scope: 'bookmarks', id: model.snapshot().bookmarks[0].id }); assert.equal(model.snapshot().links[0].hidden, false)
  data.setItem = () => { throw Error('quota') }; assert.throws(() => model.bookmark(action(model)))
  assert.equal(model.snapshot().bookmarks.length, 0)
})
test('잘못된 백업은 원자적으로 거부하며 이전 수동 목록은 글로벌로 병합한다', () => {
  const model = new LinkLibrary(storage()), data = { format: 'orca-session-links-plugin', version: 3, groups: [{ name: '이전 작업', links: [{ title: '프리뷰', target: 'D:/preview.html' }] }], bookmarks: [] }
  model.importLegacy(JSON.stringify(data)); assert.equal(model.snapshot().bookmarks.length, 1)
  data.groups[0].links.push({ title: '실행', target: 'javascript:bad()' })
  assert.throws(() => model.importLegacy(JSON.stringify(data))); assert.equal(model.snapshot().bookmarks.length, 1)
})
test('파일 북마크는 호스트별로 분리하며 웹 주소는 공유한다', () => {
  const model = new LinkLibrary(storage())
  for (const host of ['runtime:a', 'runtime:b']) {
    model.select(session('same', host)); model.add({ scope: 'bookmarks', text: '[파일](/repo/page.html) [웹](https://example.com)' })
  }
  assert.equal(model.snapshot().bookmarks.length, 3)
})
test('구독 해제 후 늦게 도착한 기록을 무시하고 원격 구독은 소유 호스트로 보낸다', async () => {
  let callback, disposed = 0, frames = 0, selector
  const stop = subscribeLinksFeed({ nativeChat: { subscribe: (_, cb) => { callback = cb; return () => disposed++ } } }, session('one'), () => frames++, assert.fail)
  callback({ type: 'snapshot', messages: [] }); stop(); callback({ type: 'appended', messages: [] })
  assert.equal(frames, 1); assert.equal(disposed, 1)
  const remoteStop = subscribeLinksFeed({ runtimeEnvironments: { subscribe: async (args, cb) => {
    selector = args.selector; cb.onResponse({ ok: true, result: { type: 'snapshot', messages: [] } }); return { unsubscribe: () => disposed++ }
  } } }, session('two', 'runtime:owner'), () => frames++, assert.fail)
  remoteStop(); await new Promise(resolve => setImmediate(resolve)); assert.equal(selector, 'owner'); assert.equal(disposed, 2)
})
test('SSH 기록을 로컬로 읽지 않고 실행 파일 바로 열기를 거부한다', async () => {
  let error
  subscribeLinksFeed({ nativeChat: { subscribe: assert.fail } }, session('remote', 'ssh:owner'), assert.fail, e => { error = e })
  assert.match(error, /SSH/)
  await assert.rejects(openSessionLink({ shell: { openPath: assert.fail, openFilePath: assert.fail } }, { type: 'file', target: 'D:/run.exe' }, session('one')))
  let args; await openSessionLink({ shell: { openPath: assert.fail, openFilePath: async (...a) => { args = a; return true } } }, { type: 'file', target: 'D:/preview.html' }, session('one'))
  assert.deepEqual(args, ['D:/preview.html', 'local'])
})

test('파일 열기 실패를 표시하고 원격 파일·없는 API를 폴더 열기로 대신 처리하지 않는다', async () => {
  const link = { type: 'file', target: 'D:/preview.html' }
  await assert.rejects(openSessionLink({ shell: { openPath: assert.fail, openFilePath: async () => false } }, link, session('one')), /파일을 열지 못/)
  await assert.rejects(openSessionLink({ shell: { openPath: assert.fail } }, link, session('one')), /지원하지/)
  await assert.rejects(openSessionLink({ shell: { openFilePath: assert.fail } }, link, session('one', 'runtime:owner')), /원격 호스트/)
})

test('현재 세션·글로벌 접기는 독립적으로 저장하고 다른 세션·재실행 후에도 유지한다', () => {
  const data = storage(), model = new LinkLibrary(data); model.select(session('one'))
  model.add({ scope: 'session', sessionKey: model.snapshot().session.key, text: 'D:/preview.html' })
  model.setCollapsed({ scope: 'session', collapsed: true }); model.select(session('two'))
  assert.deepEqual(model.snapshot().collapsedSections, { session: true, bookmarks: false })
  const reopened = new LinkLibrary(data); reopened.setCollapsed({ scope: 'bookmarks', collapsed: true })
  assert.deepEqual(reopened.snapshot().collapsedSections, { session: true, bookmarks: true })
  reopened.setCollapsed({ scope: 'session', collapsed: false }); reopened.select(session('one'))
  assert.equal(reopened.snapshot().links.length, 1); assert.equal(reopened.snapshot().collapsedSections.bookmarks, true)
  assert.throws(() => reopened.setCollapsed({ scope: 'arbitrary', collapsed: true }))
  data.setItem = () => { throw Error('quota') }; assert.throws(() => reopened.setCollapsed({ scope: 'session', collapsed: true }), /저장하지/)
  assert.equal(reopened.snapshot().collapsedSections.session, false)
})
test('실행 파일의 서명 검사를 우회하지 않고 활성화된 보안 설정이면 설치 준비를 거부한다', () => {
  const file = Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 5, 48, 48, 48, 48, 48])])
  verifyFuse(file); file[file.length - 1] = 49; assert.throws(() => verifyFuse(file), /서명 검사/)
})
