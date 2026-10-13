import { readFile } from 'node:fs/promises'
import { verifyPreservedLayout, sha256 } from './asar.mjs'
const plan = JSON.parse(await readFile(process.argv[2], 'utf8'))
if (plan.strategy !== 'preserve-layout' || !plan.cacheCompatible) throw new Error('실행 중 적용을 지원하는 계획이 아닙니다.')
const original = await readFile(plan.backup), replacement = await readFile(plan.replacement)
if (sha256(original) !== plan.originalHash || sha256(replacement) !== plan.replacementHash) throw new Error('검증할 원본·연결 파일의 해시가 다릅니다.')
console.log(JSON.stringify(verifyPreservedLayout(original, replacement, plan.targetPath)))
