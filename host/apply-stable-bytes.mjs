import { readFile, open, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sha256, verifyPreservedLayout } from './asar.mjs'
import { verifyFuse } from './prepare-connector.mjs'

async function writeAll(handle, data, position) {
  let written = 0
  while (written < data.length) {
    const result = await handle.write(data, written, data.length - written, position + written)
    if (!result.bytesWritten) throw new Error('연결 파일 쓰기가 중단됐습니다.')
    written += result.bytesWritten
  }
}

export async function applyStablePlan(planPath) {
  const plan = JSON.parse(await readFile(planPath, 'utf8'))
  if (plan.strategy !== 'preserve-layout' || !plan.cacheCompatible || plan.version !== '1.4.222' ||
    resolve(plan.originalPath) !== resolve(join(plan.install, 'resources', 'app.asar'))) throw new Error('실행 중 적용 계획의 대상·버전·형식이 올바르지 않습니다.')
  const original = await readFile(plan.backup), replacement = await readFile(plan.replacement), executable = await readFile(plan.executable)
  if (sha256(original) !== plan.originalHash || sha256(replacement) !== plan.replacementHash || sha256(executable) !== plan.executableHash) throw new Error('원본·연결 파일·Orca 버전이 준비 이후 바뀌었습니다.')
  verifyFuse(executable)
  const proof = verifyPreservedLayout(original, replacement, plan.targetPath)
  const current = await readFile(plan.originalPath)
  if (sha256(current) === plan.replacementHash) return { applied: true, alreadyApplied: true, ...proof }
  if (sha256(current) !== plan.originalHash) throw new Error('현재 설치본이 원본과 다릅니다. 덮어쓰지 않습니다.')
  let first = 0, last = proof.dataStart
  while (first < last && original[first] === replacement[first]) first++
  while (last > first && original[last - 1] === replacement[last - 1]) last--
  if (first === last) throw new Error('연결 헤더의 변경을 확인하지 못했습니다.')
  const initialOwner = await stat(plan.originalPath), handle = await open(plan.originalPath, 'r+')
  let headerTouched = false, appendStarted = false
  try {
    const before = await handle.stat()
    if (before.size !== original.length || before.ino !== initialOwner.ino) throw new Error('설치 파일 크기나 소유가 바뀌었습니다.')
    const checked = Buffer.alloc(original.length)
    let read = 0
    while (read < checked.length) {
      const result = await handle.read(checked, read, checked.length - read, read)
      if (!result.bytesRead) throw new Error('설치 파일 확인이 중단됐습니다.')
      read += result.bytesRead
    }
    if (sha256(checked) !== plan.originalHash) throw new Error('적용 직전 설치 파일이 바뀌었습니다.')
    // 원래 파일 데이터에는 쓰지 않는다. 뒤에 새 코드가 완전히 기록된 후 헤더만 바꾼다.
    appendStarted = true
    await writeAll(handle, replacement.subarray(original.length), original.length); await handle.sync()
    const owner = await stat(plan.originalPath)
    // Windows의 경로 stat과 핸들 stat은 dev 값이 다르므로 같은 종류끼리 비교한다.
    if (owner.ino !== initialOwner.ino || owner.dev !== initialOwner.dev) throw new Error('설치 파일이 다른 프로세스에 의해 교체됐습니다.')
    headerTouched = true
    await writeAll(handle, replacement.subarray(first, last), first); await handle.sync()
    if (sha256(await readFile(plan.originalPath)) !== plan.replacementHash) throw new Error('적용된 파일의 최종 해시가 다릅니다.')
    return { applied: true, ...proof, headerBytesWritten: last - first, appendedBytes: replacement.length - original.length }
  } catch (error) {
    if (headerTouched) {
      // 이미 새 코드를 읽은 프로세스도 계속 읽을 수 있도록 뒤의 데이터는 유지한다.
      await writeAll(handle, original.subarray(first, last), first); await handle.sync()
      throw new Error(`연결 적용 실패로 기존 헤더를 복원했습니다. 캐시 호환을 위한 추가 데이터와 원본 백업은 보존했습니다. ${error.message}`)
    }
    if (appendStarted) { await handle.truncate(original.length); await handle.sync() }
    throw error
  } finally { await handle.close() }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await applyStablePlan(process.argv[2])))
}
