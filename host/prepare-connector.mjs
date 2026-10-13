import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readArchive, appendArchive, sha256 } from './asar.mjs'

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
  let html = archive.read('out/renderer/index.html').toString('utf8')
  if (/session-links-entry|session-links-connector-entry|important-links-entry/.test(html)) throw new Error('이미 연결 코드가 있습니다. 기존 연결을 복원한 후 준비하세요.')
  const additions = new Map(), prefix = 'out/renderer/assets/important-links-host/'
  for (const name of ['session-links-core.mjs', 'session-links-feed.mjs', 'link-library.mjs', 'panel-connector.mjs']) {
    additions.set(prefix + 'host/' + name, await readFile(new URL(name, import.meta.url)))
  }
  additions.set(prefix + 'src/link-parser.mjs', await readFile(new URL('../src/link-parser.mjs', import.meta.url)))
  const entry = `import {useAppStore} from '../${facade.split('/').at(-1)}';
import {mountLinksConnector} from './host/panel-connector.mjs';
function start(){try{if(!window.api?.plugins?.list)return;const dispose=mountLinksConnector({store:useAppStore,api:window.api});window.addEventListener('pagehide',dispose,{once:true});}catch(error){console.error('중요 링크 연결 초기화 실패',error);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();`
  additions.set(prefix + 'important-links-entry.mjs', Buffer.from(entry))
  if (!html.includes('</head>')) throw new Error('Orca 진입 화면 형식이 바뀌었습니다.')
  html = html.replace('</head>', '<script type="module" src="./assets/important-links-host/important-links-entry.mjs"></script>\n</head>')
  additions.set('out/renderer/index.html', Buffer.from(html))
  const patched = appendArchive(original, additions)
  await mkdir(artifacts, { recursive: true })
  const backup = join(artifacts, `original-${version}.asar`), replacement = join(artifacts, `connected-${version}.asar`)
  await writeFile(backup, original); await writeFile(replacement, patched.buffer)
  const pluginVersion = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url))).version
  const plan = { version, pluginVersion, install: resolve(install), originalPath: resolve(originalPath),
    executable: resolve(executable), executableHash: sha256(await readFile(executable)),
    backup: resolve(backup), replacement: resolve(replacement), originalHash: sha256(original),
    replacementHash: sha256(patched.buffer), preservedEntries: patched.preserved, addedEntries: additions.size }
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
