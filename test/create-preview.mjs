import { readFile, writeFile, mkdir } from 'node:fs/promises'
const panel = await readFile(new URL('../panel.html', import.meta.url), 'utf8')
const theme = '<style>:root{--background:#0a0a0a;--foreground:#f5f5f5;--muted-foreground:#999;--border:#262626;--card:#161616;--card-foreground:#f5f5f5;--accent:#242424;--accent-foreground:#fff;--popover:#171717;--popover-foreground:#fff;--secondary:#262626;--secondary-foreground:#fff;--primary:#eee;--primary-foreground:#111;--ring:#aaa;--destructive:#ff7373;--radius:8px}</style>'
const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>중요 링크 0.4.0 샘플</title><style>body{margin:24px;background:#111;color:#eee;font:14px 'Malgun Gothic',sans-serif}iframe{display:block;width:360px;height:750px;border:1px solid #333;border-radius:8px;margin-top:16px}button{padding:8px;margin-right:8px;background:#222;color:#eee;border:1px solid #444;border-radius:6px}</style><p>플러그인 UI 샘플입니다. 실제 Orca 수집 결과가 아닙니다.</p><button id="a">세션 A</button><button id="b">새 세션 B</button><iframe title="중요 링크"></iframe><script>
const frame=document.querySelector('iframe');frame.srcdoc=${JSON.stringify(panel.replace('</head>', theme + '</head>')).replace(/<\/script/gi, '<\\/script')};
let selected='A',serial=0;const lists={A:[{id:'one',key:'one',type:'file',target:'D:/preview/combat.html',title:'전투 콤보 프리뷰',kind:'preview'},{id:'two',key:'two',type:'file',target:'D:/preview/character.html',title:'캐릭터 상태 프리뷰',kind:'preview'}],B:[]},bookmarks=[],undo=new Map();
function publish(){frame.contentWindow.postMessage({type:'session-links:snapshot',version:4,nonce:'sample',session:{id:selected,key:selected,title:'샘플 세션 '+selected},links:lists[selected].map(l=>({...l,bookmarked:bookmarks.some(b=>b.id===l.id)})),bookmarks,error:''},'*')}
document.querySelector('#a').onclick=()=>{selected='A';publish()};document.querySelector('#b').onclick=()=>{selected='B';publish()};
addEventListener('message',e=>{if(e.source!==frame.contentWindow||e.data?.type!=='session-links:request')return;const {action,params,requestId}=e.data;let error,value;const scope=params?.scope;
if(action==='bookmark'){const link=lists[selected].find(l=>l.id===params.id),i=bookmarks.findIndex(l=>l.id===params.id);if(i>=0)bookmarks.splice(i,1);else if(link)bookmarks.push({...link})}
if(action==='remove'){const source=scope==='session'?lists[selected]:bookmarks,i=source.findIndex(l=>l.id===params.id);if(i>=0){const link=source.splice(i,1)[0],token=String(++serial);undo.set(token,{source,link});value={undoToken:token}}}
if(action==='undo'){const record=undo.get(params.undoToken);if(record){record.source.push(record.link);undo.delete(params.undoToken)}}
if(action==='open')error='샘플 화면입니다. 실제 파일은 열지 않습니다.';
if(action==='add'||action==='export'||action==='importLegacy')error='실제 등록과 백업은 연결된 Orca 패널에서 사용하세요.';
publish();frame.contentWindow.postMessage({type:'session-links:result',requestId,ok:!error,error,value},'*')});
</script></html>`
const artifacts = new URL('../host/artifacts/', import.meta.url)
await mkdir(artifacts, { recursive: true }); await writeFile(new URL('panel-preview.html', artifacts), html)
console.log('샘플 패널 프리뷰를 만들었습니다.')
