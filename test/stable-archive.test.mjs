import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appendPreservingLayout, verifyPreservedLayout, readArchive, sha256 } from '../host/asar.mjs'
import { buildConnectorBundle } from '../host/connector-bundle.mjs'
import { Script } from 'node:vm'
import { applyStablePlan } from '../host/apply-stable-bytes.mjs'
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
function fixture() {
  const boot = Buffer.from('const boot = true;'), other = Buffer.from('existing data'), blockSize = 4194304
  const file = (data, offset) => ({ size: data.length, offset: String(offset), integrity: { algorithm: 'SHA256', hash: sha256(data), blockSize, blocks: [sha256(data)] } })
  const header = { files: { 'boot.js': file(boot, 0), 'other.js': file(other, boot.length), 'native.node': { size: 10, unpacked: true } } }
  const json = Buffer.from(JSON.stringify(header)), capacity = Math.ceil((json.length + 256) / 4) * 4, dataStart = 16 + capacity
  const prefix = Buffer.alloc(dataStart); prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(dataStart - 8, 4); prefix.writeUInt32LE(dataStart - 12, 8); prefix.writeUInt32LE(json.length, 12); json.copy(prefix, 16)
  return Buffer.concat([prefix, boot, other])
}
test('새 시작 코드만 추가하며 기존 캐시와 새 헤더가 다른 모든 파일을 같은 위치에서 읽는다', () => {
  const original = fixture(), before = readArchive(original), content = Buffer.from('const boot = true; const connector = true;')
  const result = appendPreservingLayout(original, 'boot.js', content), after = readArchive(result.buffer)
  assert.equal(result.cacheCompatible, true); assert.equal(result.preservedEntries, 2); assert.equal(result.cachedEntries, 3)
  assert.equal(after.dataStart, before.dataStart); assert.deepEqual(after.read('boot.js'), content)
  assert.deepEqual(after.read('other.js'), before.read('other.js'))
  const cached = before.entries.get('boot.js'), start = after.dataStart + Number(cached.offset)
  assert.deepEqual(result.buffer.subarray(start, start + cached.size), before.read('boot.js'))
})
test('원래 데이터 손상·헤더 공간 부족·시작 코드 무결성 손상을 거부한다', () => {
  const original = fixture(), result = appendPreservingLayout(original, 'boot.js', Buffer.from('new boot'))
  const damaged = Buffer.from(result.buffer); damaged[readArchive(original).dataStart] ^= 1
  assert.throws(() => verifyPreservedLayout(original, damaged, 'boot.js'), /원래 데이터/)
  const corrupt = Buffer.from(result.buffer); corrupt[corrupt.length - 1] ^= 1
  assert.throws(() => verifyPreservedLayout(original, corrupt, 'boot.js'), /무결성/)
  assert.throws(() => appendPreservingLayout(original, 'boot.js', Buffer.alloc(5 * 1024 * 1024)), /헤더 공간/)
})
test('묶은 연결 코드는 중첩 모듈 문법 없이 실행 가능하고 앱 저장소 경로를 제한한다', async () => {
  const bundle = await buildConnectorBundle('store-fixture.js')
  const script = bundle.replace(/^import .*\n/gm, '')
  assert.doesNotMatch(script, /^export /m); assert.doesNotMatch(script, /^import /m)
  assert.doesNotThrow(() => new Script(script)); await assert.rejects(buildConnectorBundle('../arbitrary.js'))
})
test('실행 중 설치는 원래 데이터와 파일을 유지하며 정확한 해시·반복 적용·변경된 설치본 거부를 확인한다', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-links-stable-')), install = join(root, 'orca'), resources = join(install, 'resources')
  try {
    await mkdir(resources, { recursive: true })
    const original = fixture(), replacement = appendPreservingLayout(original, 'boot.js', Buffer.from('new boot')).buffer
    const executable = Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 5, 49, 48, 48, 48, 48])])
    const plan = { version: '1.4.222', strategy: 'preserve-layout', cacheCompatible: true, targetPath: 'boot.js', install,
      originalPath: join(resources, 'app.asar'), backup: join(root, 'backup.asar'), replacement: join(root, 'connected.asar'), executable: join(install, 'Orca.exe'),
      originalHash: sha256(original), replacementHash: sha256(replacement), executableHash: sha256(executable) }
    await writeFile(plan.originalPath, original); await writeFile(plan.backup, original); await writeFile(plan.replacement, replacement); await writeFile(plan.executable, executable)
    const planPath = join(root, 'plan.json'); await writeFile(planPath, JSON.stringify(plan))
    const before = await stat(plan.originalPath), result = await applyStablePlan(planPath), after = await stat(plan.originalPath)
    assert.equal(result.applied, true); assert.equal(after.ino, before.ino); assert.deepEqual(await readFile(plan.originalPath), replacement)
    assert.equal((await applyStablePlan(planPath)).alreadyApplied, true)
    await writeFile(plan.originalPath, 'another version'); await assert.rejects(applyStablePlan(planPath), /현재 설치본/)
    assert.equal((await readFile(plan.originalPath)).toString(), 'another version'); assert.deepEqual(await readFile(plan.backup), original)
  } finally {
    const parent = resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')
    assert.ok(resolve(root).startsWith(parent + 'codex-links-stable-')); await rm(root, { recursive: true, force: true })
  }
})
