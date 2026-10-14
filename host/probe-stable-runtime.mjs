import { readFile, writeFile, copyFile, unlink } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { readArchive, sha256 } from './asar.mjs'
import { promisify } from 'node:util'
const run = promisify(execFile), here = dirname(fileURLToPath(import.meta.url)), artifacts = join(here, 'artifacts')
const plan = JSON.parse(await readFile(join(artifacts, 'connection-plan.json'), 'utf8'))
const executable = await readFile(plan.executable), sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX')
const position = executable.indexOf(sentinel), wire = position + sentinel.length
if (position < 0 || executable[wire] !== 1 || executable[wire + 2] !== 49) throw new Error('창 없는 Node 실행 모드를 확인하지 못했습니다. 검증 실행을 중단합니다.')
const script = join(artifacts, 'runtime-read-probe.cjs'), archive = join(artifacts, 'runtime-read-probe.asar'), ready = join(artifacts, 'runtime-read-ready.asar')
const source = `const fs=require('node:fs'),raw=require('original-fs'),crypto=require('node:crypto');
const [mode,archive,ready,target]=process.argv.slice(2);const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const boot=archive+'/'+target,others=['package.json','out/renderer/index.html','out/renderer/assets/store-DiJH2_9Y.js'];
if(mode==='cached'){const before=hash(fs.readFileSync(boot)),checks=others.map(p=>hash(fs.readFileSync(archive+'/'+p))),old=raw.readFileSync(archive),next=raw.readFileSync(ready),fd=raw.openSync(archive,'r+');try{raw.writeSync(fd,next.subarray(old.length),0,next.length-old.length,old.length);raw.fsyncSync(fd);const end=8+old.readUInt32LE(4);let first=0,last=end;while(first<end&&old[first]===next[first])first++;while(last>first&&old[last-1]===next[last-1])last--;raw.writeSync(fd,next.subarray(first,last),0,last-first,first);raw.fsyncSync(fd);}finally{raw.closeSync(fd)}console.log(JSON.stringify({cachedBootstrapUnchanged:before===hash(fs.readFileSync(boot)),otherReadsUnchanged:others.every((p,i)=>checks[i]===hash(fs.readFileSync(archive+'/'+p)))}));}
else{const data=fs.readFileSync(boot);console.log(JSON.stringify({freshHasConnector:data.toString().includes('ORCA_IMPORTANT_LINKS_CONNECTOR_V1'),freshBootstrapHash:hash(data)}));}`
try {
  await writeFile(script, source); await copyFile(plan.backup, archive); await copyFile(plan.replacement, ready)
  const call = async mode => JSON.parse((await run(plan.executable, [script, mode, archive, ready, plan.targetPath], {
    windowsHide: true, timeout: 30000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })).stdout.trim())
  const cached = await call('cached'), fresh = await call('fresh')
  const expectedHash = plan.bootstrapHash ?? sha256(readArchive(await readFile(plan.replacement)).read(plan.targetPath))
  if (!cached.cachedBootstrapUnchanged || !cached.otherReadsUnchanged || !fresh.freshHasConnector || fresh.freshBootstrapHash !== expectedHash) throw new Error('Orca의 실제 ASAR 캐시·새 시작 코드 읽기 검증 실패.')
  const result = { ...cached, ...fresh, originalHash: plan.originalHash, replacementHash: plan.replacementHash, noDesktopWindow: true }
  await writeFile(join(artifacts, 'runtime-read-proof.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result))
} finally {
  for (const path of [script, archive, ready]) { try { await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error } }
}
