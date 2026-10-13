import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { ShelfState } from '../src/shelf-state.mjs'

test('세션 목록과 글로벌 직접 등록을 분리한다', () => {
  const state = new ShelfState()
  state.add('https://example.com/current'); state.add('https://example.com/global', '', 'bookmarks')
  state.create('다른 세션')
  assert.equal(state.active.links.length, 0); assert.equal(state.bookmarks.length, 1)
  state.select('group-1'); assert.equal(state.active.links.length, 1)
})
test('양쪽에 등록한 링크의 삭제와 복원이 독립적이다', () => {
  const state = new ShelfState(); state.add('D:/preview.html'); const link = state.active.links[0]
  state.bookmark(link); state.remove(link.key, 'links')
  assert.equal(state.bookmarks.length, 1); assert.equal(state.active.links.length, 0)
  state.restoreLink(link, 'group-1', 'links'); state.remove(link.key, 'bookmarks')
  assert.equal(state.bookmarks.length, 0); assert.equal(state.active.links.length, 1)
})
test('반복 백업 복원과 주소 중복을 합친다', () => {
  const state = new ShelfState(); state.rename('검토'); state.add('D:/preview.html'); state.add('d:\\preview.html')
  state.bookmark(state.active.links[0]); const restored = new ShelfState()
  restored.import(state.export()); restored.import(state.export())
  assert.equal(restored.groups.find(group => group.name === '검토').links.length, 1)
  assert.equal(restored.bookmarks.length, 1)
})
test('위험 주소가 포함된 가져오기는 기존 자료를 변경하지 않는다', () => {
  const state = new ShelfState(); state.add('D:/keep.html'); const previous = state.export()
  assert.throws(() => state.import(JSON.stringify({ format:'orca-session-links-plugin',version:3,
    groups:[{name:'가져올 자료',links:[{target:'D:/ok.html'},{target:'javascript:bad()'}]}],bookmarks:[] })))
  assert.equal(state.export(), previous)
})
test('배포 목록과 플러그인의 ID·버전·진입점이 일치한다', async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url)))
  const marketplace = JSON.parse(await readFile(new URL('../orca-marketplace.json', import.meta.url)))
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
  assert.equal(marketplace.plugins[0].id, `${manifest.publisher}.${manifest.id}`)
  assert.equal(pkg.version, manifest.version); assert.equal(marketplace.plugins[0].source.ref, 'main')
  assert.deepEqual(manifest.capabilities, [])
  const panel = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
  assert.doesNotMatch(panel, /__FONT__|__STYLE__|__SCRIPT__|window\.api|localStorage|\bfetch\(/)
})
