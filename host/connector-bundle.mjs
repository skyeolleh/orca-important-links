import { readFile } from 'node:fs/promises'
export async function buildConnectorBundle(facadeName) {
  if (!/^store-[\w-]+\.js$/.test(facadeName)) throw new Error('상태 저장소 경로가 올바르지 않습니다.')
  const sources = []
  for (const name of ['../src/link-parser.mjs', 'session-links-core.mjs', 'session-links-feed.mjs', 'link-library.mjs', 'panel-connector.mjs']) {
    const source = (await readFile(new URL(name, import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
      .replace(/^import\s+[\s\S]*?\sfrom\s+['"][^'"]+['"]\s*\n/gm, '')
      .replace(/^export\s*\{[^}]+\}\s*\n/gm, '').replace(/^export (?=(?:async )?function |class |const )/gm, '')
    sources.push(source)
  }
  return `\n// ORCA_IMPORTANT_LINKS_CONNECTOR_V1\nimport {useAppStore as orcaImportantLinksStore} from './${facadeName}';\n(() => {\n${sources.join('\n')}\n
function startImportantLinks(){try{if(!window.api?.plugins?.list)return;const dispose=mountLinksConnector({store:orcaImportantLinksStore,api:window.api});window.addEventListener('pagehide',dispose,{once:true});}catch(error){console.error('중요 링크 연결 초기화 실패',error);}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startImportantLinks,{once:true});else startImportantLinks();\n})();\n`
}
