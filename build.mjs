import { readFile, writeFile } from 'node:fs/promises'
const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const core = (await read('./src/link-parser.mjs')).replace(/export /g, '') + '\n'
const model = (await read('./src/shelf-state.mjs')).replace(/^import .*\n/, '').replace(/export /g, '')
const ui = await read('./src/panel-ui.js')
const font = (await readFile(new URL('./src/Geist-Variable.woff2', import.meta.url))).toString('base64')
const css = (await read('./src/panel.css')).replace('__FONT__', font)
const script = `(() => {\n'use strict';\n${core}\n${model}\nconst state = new ShelfState();\n\n${ui}\n})();`
const panel = (await read('./src/panel-template.html')).replace('/*__STYLE__*/', css)
  .replace('/*__SCRIPT__*/', script.replace(/<\/script/gi, '<\\/script'))
await writeFile(new URL('./panel.html', import.meta.url), panel)
console.log('설치용 panel.html을 생성했습니다.')
