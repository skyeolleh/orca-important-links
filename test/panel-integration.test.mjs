import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { mountLinksConnector, FRAME_NAME } from '../host/panel-connector.mjs'
test('패널과 Orca 연결: 자동 수집·열기·별표·실제 세션 전환·늦은 기록·위조 요청', { skip: !process.env.HAPPY_DOM_MODULE }, async () => {
  const { Window } = await import(pathToFileURL(process.env.HAPPY_DOM_MODULE).href)
  const host = new Window({ url: 'http://localhost/' }), doc = host.document
  doc.body.innerHTML = '<iframe></iframe>'; const frame = doc.querySelector('iframe'); frame.name = FRAME_NAME
  const child = frame.contentWindow
  // 브라우저 통신만 모사하며 실제 Orca 창·브라우저·파일을 열지 않는다.
  host.postMessage = data => host.dispatchEvent(new host.MessageEvent('message', { data, source: child }))
  child.postMessage = data => child.dispatchEvent(new child.MessageEvent('message', { data, source: host }))
  let changed, current = 'one', pluginVersion = '0.3.2', pluginChanged
  const callbacks = [], opened = []
  const state = () => ({ activeWorktreeId: 'work', activeTabIdByWorktree: { work: 'tab' }, terminalLayoutsByTabId: { tab: { activeLeafId: 'leaf' } },
    agentStatusByPaneKey: { 'tab:leaf': { paneKey: 'tab:leaf', agentType: 'codex', providerSession: { id: current } } }, getKnownWorktreeById: () => ({ path: 'D:/work' }) })
  const api = { plugins: { list: async () => [{ pluginKey: 'yeojh-local.session-links', version: pluginVersion, status: 'idle' }], onChanged: cb => { pluginChanged = cb; return () => {} } },
    nativeChat: { subscribe: (args, cb) => { callbacks.push({ args, cb }); return () => {} } }, shell: { openUrl: async url => opened.push(url), openPath: async path => opened.push(path) } }
  const dispose = mountLinksConnector({ doc, store: { getState: state, subscribe: cb => { changed = cb; return () => {} } }, api, storage: host.localStorage })
  const tick = () => new Promise(resolve => setTimeout(resolve, 10))
  try {
    await tick(); assert.equal(callbacks.length, 0)
    pluginVersion = '0.4.0'; pluginChanged(); await tick(); assert.equal(callbacks[0].args.sessionId, 'one')
    const html = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
    child.document.write(html.replace(/<script>[\s\S]*?<\/script>/, ''))
    child.eval(html.match(/<script>([\s\S]*?)<\/script>/)[1]); await tick()
    const message = { id: 'm', role: 'assistant', timestamp: 1, blocks: [{ type: 'text', text: '[프리뷰](D:/work/page.html)' }] }
    callbacks[0].cb({ type: 'snapshot', messages: [message] }); await tick()
    assert.equal(child.document.querySelectorAll('.link-row').length, 1)
    child.document.querySelector('[data-action="open"]').click(); await tick(); assert.deepEqual(opened, ['D:/work/page.html'])
    child.document.querySelector('[data-action="bookmark"]').click(); await tick(); assert.equal(child.document.querySelectorAll('.link-row').length, 2)
    current = 'two'; changed(); await tick(); assert.equal(child.document.querySelectorAll('[data-scope="session"] .link-row').length, 0)
    assert.equal(child.document.querySelectorAll('[data-scope="bookmarks"] .link-row').length, 1)
    callbacks[0].cb({ type: 'appended', messages: [{ ...message, id: 'late' }] }); await tick()
    assert.equal(child.document.querySelectorAll('[data-scope="session"] .link-row').length, 0)
    host.dispatchEvent(new host.MessageEvent('message', { data: { type: 'session-links:request', requestId: 'fake', action: 'open', params: { target: 'D:/run.exe' } }, source: host }))
    await tick(); assert.equal(opened.length, 1)
    current = 'one'; changed(); await tick(); assert.equal(child.document.querySelectorAll('[data-scope="session"] .link-row').length, 1)
    child.document.querySelector('[data-scope="session"] [data-action="remove"]').click(); await tick()
    assert.equal(child.document.querySelectorAll('[data-scope="session"] .link-row').length, 0)
    assert.equal(child.document.querySelectorAll('[data-scope="bookmarks"] .link-row').length, 1)
    child.document.querySelector('#toast button').click(); await tick(); assert.equal(child.document.querySelectorAll('[data-scope="session"] .link-row').length, 1)
  } finally { dispose(); await host.happyDOM.close() }
})
