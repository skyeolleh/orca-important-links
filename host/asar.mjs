import { createHash } from 'node:crypto'

export const sha256 = data => createHash('sha256').update(data).digest('hex')
export function readArchive(buffer) {
  const header = JSON.parse(buffer.subarray(16, 16 + buffer.readUInt32LE(12)).toString('utf8'))
  const dataStart = 8 + buffer.readUInt32LE(4)
  const entries = new Map()
  function walk(files, prefix = '') {
    for (const [name, entry] of Object.entries(files)) {
      const path = prefix + name
      if (entry.files) walk(entry.files, path + '/')
      else entries.set(path, entry)
    }
  }
  walk(header.files)
  return { header, dataStart, entries, read(path) {
    const entry = entries.get(path)
    if (!entry || entry.unpacked || entry.link) throw new Error(`압축 파일을 읽을 수 없습니다: ${path}`)
    return buffer.subarray(dataStart + Number(entry.offset), dataStart + Number(entry.offset) + entry.size)
  } }
}
export function appendArchive(original, additions) {
  const archive = readArchive(original), header = structuredClone(archive.header)
  const payload = original.subarray(archive.dataStart), parts = [payload]
  let offset = payload.length
  for (const [path, content] of additions) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content)
    const names = path.split('/'), name = names.pop()
    let directory = header
    for (const segment of names) directory = directory.files[segment] ??= { files: {} }
    const blockSize = 4 * 1024 * 1024, blocks = []
    for (let start = 0; start < data.length; start += blockSize) blocks.push(sha256(data.subarray(start, start + blockSize)))
    directory.files[name] = { size: data.length, offset: String(offset),
      integrity: { algorithm: 'SHA256', hash: sha256(data), blockSize, blocks } }
    parts.push(data); offset += data.length
  }
  const json = Buffer.from(JSON.stringify(header)), payloadLength = Math.ceil((json.length + 4) / 4) * 4
  const pickle = Buffer.alloc(payloadLength + 4)
  pickle.writeUInt32LE(payloadLength, 0); pickle.writeUInt32LE(json.length, 4); json.copy(pickle, 8)
  const size = Buffer.alloc(8); size.writeUInt32LE(4, 0); size.writeUInt32LE(pickle.length, 4)
  const result = Buffer.concat([size, pickle, ...parts]), rebuilt = readArchive(result)
  let preserved = 0
  for (const [path, entry] of archive.entries) {
    if (additions.has(path)) continue
    if (entry.unpacked || entry.link) {
      if (JSON.stringify(entry) !== JSON.stringify(rebuilt.entries.get(path))) throw new Error(`항목이 바뀌었습니다: ${path}`)
    } else if (!archive.read(path).equals(rebuilt.read(path))) throw new Error(`원본이 바뀌었습니다: ${path}`)
    preserved++
  }
  for (const [path, content] of additions) {
    if (!Buffer.from(content).equals(rebuilt.read(path))) throw new Error(`추가 파일 검증 실패: ${path}`)
  }
  return { buffer: result, preserved }
}
