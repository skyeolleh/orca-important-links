import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readArchive, appendPreservingLayout, sha256 } from './asar.mjs'
import { buildConnectorBundle } from './connector-bundle.mjs'

// 실행 파일의 보안 설정은 읽기만 한다. 서명 검사가 켜져 있으면 준비를 거부한다.
export function verifyFuse(executable) {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
  const position = executable.indexOf(sentinel)
  if (position < 0 || executable.indexOf(sentinel, position + 1) !== -1) throw new Error('Orca 실행 파일의 보안 설정을 확인하지 못했습니다.')
  const wire = position + sentinel.length
  if (executable[wire] !== 1 || executable[wire + 1] < 5 || executable[wire + 2 + 4] !== 48) {
    throw new Error('설치본이 ASAR 서명 검사를 요구하거나 지원하지 않는 형식입니다. 보안 설정은 변경하지 않습니다.')
  }
}

export async function prepare(install, artifacts) {
  const originalPath = join(install, 'resources', 'app.asar')
  const original = await readFile(originalPath), archive = readArchive(original)
  const version = JSON.parse(archive.read('package.json')).version
  if (version !== '1.4.222') throw new Error(`Orca ${version}은 아직 연결 검증 대상이 아닙니다. 앱 버전에 맞게 연결 코드를 갱신하세요.`)
  const executable = join(install, 'Orca.exe')
  verifyFuse(await readFile(executable))
  const facade = [...archive.entries.keys()].find(path => /^out\/renderer\/assets\/store-[^/]+\.js$/.test(path) &&
    /as useAppStore[},]/.test(archive.read(path).toString('utf8')))
  if (!facade) throw new Error('상태 저장소 연결 지점을 찾지 못했습니다.')
  const html = archive.read('out/renderer/index.html').toString('utf8')
  if (/session-links-entry|session-links-connector-entry|important-links-entry/.test(html)) throw new Error('이미 연결 코드가 있습니다. 기존 연결을 복원한 후 준비하세요.')
  const match = html.match(/<script type="module" crossorigin src="\.\/([^"<>]+\.js)"/)
  if (!match || !/^assets\/index-[\w-]+\.js$/.test(match[1])) throw new Error('Orca 시작 코드의 경로를 확인하지 못했습니다.')
  const targetPath = 'out/renderer/' + match[1], boot = archive.read(targetPath)
  if (boot.includes('ORCA_IMPORTANT_LINKS_CONNECTOR_V1')) throw new Error('이미 연결된 시작 코드입니다. 기존 연결을 복원한 후 준비하세요.')
  const bundle = await buildConnectorBundle(facade.split('/').at(-1))
  const patched = appendPreservingLayout(original, targetPath, Buffer.concat([boot, Buffer.from(bundle)]))
  await mkdir(artifacts, { recursive: true })
  const backup = join(artifacts, `original-${version}.asar`), replacement = join(artifacts, `connected-${version}.asar`)
  await writeFile(backup, original); await writeFile(replacement, patched.buffer)
  const pluginVersion = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url))).version
  const plan = { version, pluginVersion, install: resolve(install), originalPath: resolve(originalPath),
    executable: resolve(executable), executableHash: sha256(await readFile(executable)),
    backup: resolve(backup), replacement: resolve(replacement), originalHash: sha256(original),
    replacementHash: sha256(patched.buffer), preservedEntries: patched.preservedEntries, cachedEntries: patched.cachedEntries,
    dataStart: patched.dataStart, cacheCompatible: true, strategy: 'preserve-layout', targetPath, addedEntries: 0 }
  await writeFile(join(artifacts, 'connection-plan.json'), JSON.stringify(plan, null, 2))
  return plan
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') throw new Error('현재 연결 설치는 Windows Orca 1.4.222용입니다.')
  const install = process.argv[2] ?? join(process.env.LOCALAPPDATA, 'Programs', 'orca')
  const artifacts = join(dirname(fileURLToPath(import.meta.url)), 'artifacts')
  const plan = await prepare(install, artifacts)
  console.log(JSON.stringify({ version: plan.version, preservedEntries: plan.preservedEntries, plan: join(artifacts, 'connection-plan.json'), applied: false }))
}
