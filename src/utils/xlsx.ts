import type { RosterGrid } from '../types/api'

// Same limits as the Go API (roster.ParseGrid), so both backends read a workbook the same way.
export const MAX_ROSTER_ROWS: number = 1000
export const MAX_ROSTER_COLUMNS: number = 50
const MAX_CELL_LENGTH: number = 200
const MAX_UNZIPPED_BYTES: number = 50 * 1024 * 1024

const ZIP_LOCAL_SIGNATURE: number = 0x04034b50
const ZIP_CENTRAL_SIGNATURE: number = 0x02014b50
const ZIP_END_SIGNATURE: number = 0x06054b50
const ZIP_END_RECORD_LENGTH: number = 22
const ZIP_MAX_COMMENT_LENGTH: number = 0xffff
const ZIP_STORED: number = 0
const ZIP_DEFLATED: number = 8

const NOT_XLSX: string = 'This file could not be read as an Excel .xlsx workbook.'

export type RosterGridResult = { ok: true; grid: RosterGrid } | { ok: false; message: string }

interface ZipEntry {
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export async function readRosterGrid(data: ArrayBuffer): Promise<RosterGridResult> {
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  if (bytes.length < 4 || view.getUint32(0, true) !== ZIP_LOCAL_SIGNATURE) {
    return { ok: false, message: 'Choose an Excel workbook saved as .xlsx.' }
  }
  try {
    return await readFirstSheet(bytes, view)
  } catch (error) {
    console.error('The roster workbook could not be read', error)
    return { ok: false, message: NOT_XLSX }
  }
}

async function readFirstSheet(bytes: Uint8Array<ArrayBuffer>, view: DataView): Promise<RosterGridResult> {
  const entries = readCentralDirectory(bytes, view)
  const readPart = async (path: string): Promise<Document> => parseXml(await inflate(bytes, view, entries, path))
  const sheet = elementsNamed(await readPart('xl/workbook.xml'), 'sheet')[0]
  if (sheet === undefined) {
    return { ok: false, message: 'The workbook has no sheets.' }
  }
  const relationships = elementsNamed(await readPart('xl/_rels/workbook.xml.rels'), 'Relationship')
  const sheetRelationship = relationships.find((relationship) => relationship.getAttribute('Id') === relationshipId(sheet))
  if (sheetRelationship === undefined) {
    throw new Error('the first sheet has no relationship')
  }
  const sharedStringsRelationship = relationships.find((relationship) => (relationship.getAttribute('Type') ?? '').endsWith('/sharedStrings'))
  const sharedStrings = sharedStringsRelationship === undefined ? [] : readSharedStrings(await readPart(partPath(sharedStringsRelationship)))
  const grid = readGrid(await readPart(partPath(sheetRelationship)), sharedStrings)
  return { ok: true, grid: { ...grid, sheetName: sheet.getAttribute('name') ?? '' } }
}

function readCentralDirectory(bytes: Uint8Array, view: DataView): Map<string, ZipEntry> {
  let end = -1
  const lowest = Math.max(0, bytes.length - ZIP_END_RECORD_LENGTH - ZIP_MAX_COMMENT_LENGTH)
  for (let offset = bytes.length - ZIP_END_RECORD_LENGTH; offset >= lowest; offset--) {
    if (view.getUint32(offset, true) === ZIP_END_SIGNATURE) {
      end = offset
      break
    }
  }
  if (end < 0) {
    throw new Error('zip end record not found')
  }
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true)
  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  for (let index = 0; index < count; index++) {
    if (view.getUint32(offset, true) !== ZIP_CENTRAL_SIGNATURE) {
      throw new Error('zip central directory is corrupt')
    }
    const nameLength = view.getUint16(offset + 28, true)
    entries.set(decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength)), {
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
    })
    offset += 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  return entries
}

async function inflate(bytes: Uint8Array<ArrayBuffer>, view: DataView, entries: Map<string, ZipEntry>, path: string): Promise<string> {
  const entry = entries.get(path)
  if (entry === undefined) {
    throw new Error(`${path} is missing`)
  }
  if (view.getUint32(entry.localOffset, true) !== ZIP_LOCAL_SIGNATURE) {
    throw new Error(`${path} has no local header`)
  }
  const start = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true)
  const compressed = bytes.slice(start, start + entry.compressedSize)
  if (entry.method === ZIP_STORED) {
    return new TextDecoder().decode(compressed)
  }
  if (entry.method !== ZIP_DEFLATED || entry.uncompressedSize > MAX_UNZIPPED_BYTES) {
    throw new Error(`${path} uses compression method ${entry.method} or is too large`)
  }
  const reader = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    total += value.length
    if (total > MAX_UNZIPPED_BYTES) {
      await reader.cancel()
      throw new Error(`${path} unzips past the size limit`)
    }
    chunks.push(value)
  }
  return new Blob(chunks).text()
}

function parseXml(text: string): Document {
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.getElementsByTagName('parsererror').length > 0) {
    throw new Error('workbook XML is malformed')
  }
  return document
}

// Spreadsheet XML puts every element in a namespace, so elements are matched by local name.
function elementsNamed(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.localName === localName)
}

function childrenNamed(parent: Element, localName: string): Element[] {
  return Array.from(parent.children).filter((element) => element.localName === localName)
}

// Browsers resolve the r: prefix to the relationships namespace; parsers without XML namespace support keep the raw name.
function relationshipId(sheet: Element): string {
  const attribute = Array.from(sheet.attributes).find(
    (candidate) =>
      (candidate.localName === 'id' && (candidate.namespaceURI ?? '').endsWith('/relationships')) ||
      (candidate.namespaceURI === null && /^[^:]+:id$/.test(candidate.name)),
  )
  return attribute?.value ?? ''
}

function partPath(relationship: Element): string {
  const target = relationship.getAttribute('Target') ?? ''
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`
}

// Phonetic guides (rPh) hold furigana for the text, not part of it.
function readSharedStrings(document: Document): string[] {
  return elementsNamed(document, 'si').map((item) =>
    elementsNamed(item, 't')
      .filter((text) => text.parentElement?.localName !== 'rPh')
      .map((text) => text.textContent ?? '')
      .join(''),
  )
}

function readGrid(document: Document, sharedStrings: readonly string[]): Omit<RosterGrid, 'sheetName'> {
  const rows: string[][] = []
  let truncated = false
  let previousRow = 0
  for (const row of elementsNamed(document, 'row')) {
    const rowNumber = Number(row.getAttribute('r') ?? previousRow + 1)
    previousRow = rowNumber
    if (rowNumber > MAX_ROSTER_ROWS) {
      truncated = true
      break
    }
    while (rows.length < rowNumber - 1) {
      rows.push([])
    }
    const read = readRow(row, sharedStrings)
    rows.push(read.cells)
    truncated ||= read.truncated
  }
  while (rows.length > 0 && (rows[rows.length - 1] as string[]).every((cell) => cell === '')) {
    rows.pop()
  }
  return { rows, truncated }
}

function readRow(row: Element, sharedStrings: readonly string[]): { cells: string[]; truncated: boolean } {
  const cells: string[] = []
  let truncated = false
  let previousColumn = -1
  for (const cell of childrenNamed(row, 'c')) {
    const reference = cell.getAttribute('r')
    const column = reference === null ? previousColumn + 1 : columnIndex(reference)
    previousColumn = column
    if (column >= MAX_ROSTER_COLUMNS) {
      truncated = true
      continue
    }
    while (cells.length < column) {
      cells.push('')
    }
    cells[column] = [...cellText(cell, sharedStrings).trim()].slice(0, MAX_CELL_LENGTH).join('')
  }
  while (cells.length > 0 && cells[cells.length - 1] === '') {
    cells.pop()
  }
  return { cells, truncated }
}

function cellText(cell: Element, sharedStrings: readonly string[]): string {
  const type = cell.getAttribute('t')
  if (type === 'inlineStr') {
    return childrenNamed(cell, 'is').flatMap((inline) => elementsNamed(inline, 't').map((text) => text.textContent ?? '')).join('')
  }
  const value = childrenNamed(cell, 'v')[0]?.textContent ?? ''
  if (type === 's') {
    return sharedStrings[Number(value)] ?? ''
  }
  if (type === 'b') {
    return value === '1' ? 'TRUE' : 'FALSE'
  }
  return value
}

function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference.toUpperCase())?.[0] ?? ''
  let index = 0
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index - 1
}
