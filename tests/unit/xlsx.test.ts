import { describe, expect, it, vi } from 'vitest'
import { MAX_ROSTER_COLUMNS, MAX_ROSTER_ROWS, readRosterGrid } from '../../src/utils/xlsx'

const MAIN_NS: string = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL_NS: string = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS: string = 'http://schemas.openxmlformats.org/package/2006/relationships'

async function deflateRaw(text: string): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// A minimal zip writer: readRosterGrid ignores CRCs, so they are left at zero.
async function zip(files: Record<string, string>): Promise<ArrayBuffer> {
  const encoder = new TextEncoder()
  const locals: Uint8Array<ArrayBuffer>[] = []
  const centrals: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = encoder.encode(name)
    const data = await deflateRaw(text)
    const size = encoder.encode(text).length
    const local = new Uint8Array(30 + nameBytes.length + data.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(8, 8, true)
    localView.setUint32(18, data.length, true)
    localView.setUint32(22, size, true)
    localView.setUint16(26, nameBytes.length, true)
    local.set(nameBytes, 30)
    local.set(data, 30 + nameBytes.length)
    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(10, 8, true)
    centralView.setUint32(20, data.length, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    locals.push(local)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, centrals.length, true)
  endView.setUint16(10, centrals.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)
  return new Blob([...locals, ...centrals, end]).arrayBuffer()
}

interface WorkbookParts {
  sheetData: string
  sharedStrings?: string[]
  sheetName?: string
  sheetTarget?: string
}

function workbook(parts: WorkbookParts): Promise<ArrayBuffer> {
  const target = parts.sheetTarget ?? 'worksheets/sheet1.xml'
  const sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  const files: Record<string, string> = {
    'xl/workbook.xml': `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets><sheet name="${parts.sheetName ?? 'Sheet1'}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels':
      `<Relationships xmlns="${PACKAGE_REL_NS}">` +
      `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="${target}"/>` +
      (parts.sharedStrings === undefined ? '' : `<Relationship Id="rId2" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>`) +
      `</Relationships>`,
    [sheetPath]: `<worksheet xmlns="${MAIN_NS}"><sheetData>${parts.sheetData}</sheetData></worksheet>`,
  }
  if (parts.sharedStrings !== undefined) {
    files['xl/sharedStrings.xml'] = `<sst xmlns="${MAIN_NS}">${parts.sharedStrings.join('')}</sst>`
  }
  return zip(files)
}

describe('readRosterGrid', () => {
  it('reads shared, rich, inline and boolean cells, and fills skipped rows and columns', async () => {
    const data = await workbook({
      sheetName: 'Class 3B',
      sharedStrings: ['<si><t>Name</t></si>', '<si><r><t>Amira </t></r><r><t>Haddad</t></r><rPh><t>あみら</t></rPh></si>', '<si><t>  Ben Carter  </t></si>'],
      sheetData:
        '<row r="1"><c r="A1" t="s"><v>0</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2" t="b"><v>1</v></c></row>' +
        '<row r="4"><c r="A4" t="s"><v>2</v></c><c r="B4"><v>12345</v></c></row>' +
        '<row r="5"><c r="A5" t="inlineStr"><is><t>Chloe</t></is></c><c r="B5" s="1"/></row>' +
        '<row r="7"><c r="A7" s="1"/></row>',
    })

    expect(await readRosterGrid(data)).toEqual({
      ok: true,
      grid: {
        sheetName: 'Class 3B',
        truncated: false,
        rows: [['Name'], ['Amira Haddad', '', 'TRUE'], [], ['Ben Carter', '12345'], ['Chloe']],
      },
    })
  })

  it('stops at the row and column limits and caps long cells', async () => {
    const wide = Array.from({ length: MAX_ROSTER_COLUMNS + 2 }, (_, index) => `<c t="inlineStr"><is><t>c${index}</t></is></c>`).join('')
    const data = await workbook({
      sheetData:
        `<row r="1">${wide}</row>` +
        `<row r="2"><c r="A2" t="inlineStr"><is><t>${'x'.repeat(250)}</t></is></c></row>` +
        `<row r="${MAX_ROSTER_ROWS + 1}"><c r="A${MAX_ROSTER_ROWS + 1}" t="inlineStr"><is><t>late</t></is></c></row>`,
    })

    const result = await readRosterGrid(data)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.grid.truncated).toBe(true)
    expect(result.grid.rows[0]).toHaveLength(MAX_ROSTER_COLUMNS)
    expect(result.grid.rows[1]?.[0]).toBe('x'.repeat(200))
    expect(result.grid.rows).toHaveLength(2)
  })

  it('follows an absolute sheet target', async () => {
    const data = await workbook({ sheetTarget: '/xl/worksheets/first.xml', sheetData: '<row r="1"><c r="A1" t="inlineStr"><is><t>Omar</t></is></c></row>' })

    expect(await readRosterGrid(data)).toEqual({ ok: true, grid: { sheetName: 'Sheet1', truncated: false, rows: [['Omar']] } })
  })

  it('refuses a file that is not a zip workbook', async () => {
    const data = new TextEncoder().encode('Name\nAmira').buffer as ArrayBuffer

    expect(await readRosterGrid(data)).toEqual({ ok: false, message: 'Choose an Excel workbook saved as .xlsx.' })
  })

  it('refuses a zip without a workbook', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const data = await zip({ 'notes.txt': 'hello' })

    expect(await readRosterGrid(data)).toEqual({ ok: false, message: 'This file could not be read as an Excel .xlsx workbook.' })
  })
})
