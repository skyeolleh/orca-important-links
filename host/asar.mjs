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

// 원래 데이터 위치는 유지하고 새 시작 코드만 뒤에 붙인다.
export function appendPreservingLayout(original, path, content) {
  const archive = readArchive(original), header = structuredClone(archive.header), previous = archive.entries.get(path)
  if (!previous || previous.unpacked || previous.link) throw new Error('시작 코드 항목을 확인하지 못했습니다.')
  const data = Buffer.from(content), blockSize = 512 * 1024, blocks = []
  for (let i = 0; i < data.length; i += blockSize) blocks.push(sha256(data.subarray(i, i + blockSize)))
  const parts = path.split('/'), name = parts.pop(); let parent = header
  for (const part of parts) parent = parent.files[part]
  parent.files[name] = { ...previous, size: data.length, offset: String(original.length - archive.dataStart),
    integrity: { algorithm: 'SHA256', hash: sha256(data), blockSize, blocks } }
  const json = Buffer.from(JSON.stringify(header)), capacity = archive.dataStart - 16
  if (json.length > capacity) throw new Error('기존 헤더 공간에 맞지 않습니다. 실행 중 적용을 준비하지 않습니다.')
  const buffer = Buffer.concat([original, data])
  buffer.fill(0, 16, archive.dataStart); json.copy(buffer, 16); buffer.writeUInt32LE(json.length, 12)
  return { buffer, ...verifyPreservedLayout(original, buffer, path) }
}

export function verifyPreservedLayout(original, replacement, targetPath) {
  const before = readArchive(original), after = readArchive(replacement)
  if (before.dataStart !== after.dataStart || before.entries.size !== after.entries.size || replacement.length <= original.length ||
    !original.subarray(before.dataStart).equals(replacement.subarray(after.dataStart, original.length))) throw new Error('실행 중인 앱이 읽는 원래 데이터 위치나 내용이 달라졌습니다.')
  let preservedEntries = 0, cachedEntries = 0
  for (const [path, entry] of before.entries) {
    const next = after.entries.get(path)
    if (!next) throw new Error('기존 항목이 사라졌습니다.')
    if (!entry.unpacked && !entry.link) {
      const start = after.dataStart + Number(entry.offset)
      if (!before.read(path).equals(replacement.subarray(start, start + entry.size))) throw new Error('기존 캐시 읽기가 바뀌었습니다.')
    }
    cachedEntries++
    if (path === targetPath) continue
    if (JSON.stringify(entry) !== JSON.stringify(next)) throw new Error('다른 항목의 위치 정보가 달라졌습니다.')
    if (!entry.unpacked && !entry.link && !before.read(path).equals(after.read(path))) throw new Error('다른 파일이 바뀌었습니다.')
    preservedEntries++
  }
  const entry = after.entries.get(targetPath)
  if (!entry || entry.unpacked || entry.link || Number(entry.offset) !== original.length - before.dataStart || entry.size !== replacement.length - original.length) throw new Error('새 시작 코드의 위치가 올바르지 않습니다.')
  const data = after.read(targetPath), integrity = entry.integrity
  if (!integrity || integrity.algorithm !== 'SHA256' || integrity.blockSize !== 512 * 1024 || integrity.hash !== sha256(data)) throw new Error('새 시작 코드의 무결성 검증 실패.')
  const blocks = []
  for (let i = 0; i < data.length; i += integrity.blockSize) blocks.push(sha256(data.subarray(i, i + integrity.blockSize)))
  if (JSON.stringify(blocks) !== JSON.stringify(integrity.blocks)) throw new Error('시작 코드 블록 검증 실패.')
  return { preservedEntries, cachedEntries, dataStart: before.dataStart, cacheCompatible: true }
}
