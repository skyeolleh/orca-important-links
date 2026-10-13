import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { sha256 } from '../host/asar.mjs'
const run = promisify(execFile)
test('적용 스크립트는 검증만 수행·원자적 적용·복원을 지원하고 바뀐 설치본을 덮어쓰지 않는다', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-links-install-')), artifacts = join(root, 'artifacts'), install = join(root, 'orca')
  await mkdir(artifacts); await mkdir(join(install, 'resources'), { recursive: true })
  const original = Buffer.from('original'), replacement = Buffer.from('replacement'), exe = Buffer.from('fixture-not-executable')
  const plan = { version: '1.4.222', install, originalPath: join(install, 'resources', 'app.asar'), executable: join(install, 'Orca.exe'),
    backup: join(artifacts, 'original.asar'), replacement: join(artifacts, 'connected.asar'), originalHash: sha256(original), replacementHash: sha256(replacement), executableHash: sha256(exe) }
  const script = join(root, 'Apply-Connector.ps1')
  try {
    await copyFile(new URL('../host/Apply-Connector.ps1', import.meta.url), script)
    await writeFile(plan.backup, original); await writeFile(plan.originalPath, original); await writeFile(plan.replacement, replacement); await writeFile(plan.executable, exe)
    await writeFile(join(artifacts, 'connection-plan.json'), JSON.stringify(plan))
    const call = (...args) => run('powershell.exe', ['-NoProfile', '-File', script, ...args], { windowsHide: true, timeout: 30000 })
    await call('-ValidateOnly'); assert.deepEqual(await readFile(plan.originalPath), original)
    await call(); assert.deepEqual(await readFile(plan.originalPath), replacement)
    await call('-Restore'); assert.deepEqual(await readFile(plan.originalPath), original)
    await writeFile(plan.originalPath, 'updated-by-another-process')
    await assert.rejects(call()); assert.equal((await readFile(plan.originalPath)).toString(), 'updated-by-another-process')
    assert.deepEqual(await readFile(plan.backup), original)
  } finally {
    // 자동 생성한 전용 검증 폴더만 정리한다.
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + '\\codex-links-install-'))
    await rm(root, { recursive: true, force: true })
  }
})
