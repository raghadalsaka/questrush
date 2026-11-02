import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSheet, pushWrite, type SheetConnection } from '../../src/services/googleSheets'
import { TABLES, type StudentRow, type TableName, type TurnRow } from '../../src/services/sheetRules'
import { jsonResponse as json } from './helpers'

const ID: string = 'sheet-id'
const SCRIPT_URL: string = 'https://script.google.com/macros/s/test/exec'
const ALL_TABS: { properties: { sheetId: number; title: string } }[] = Object.keys(TABLES).map((title, index) => ({ properties: { sheetId: index + 10, title } }))

function request(index: number): { url: string; method: string; body: unknown; auth: string } {
  const [url, init] = vi.mocked(fetch).mock.calls[index] as [string, RequestInit]
  return {
    url: decodeURIComponent(url),
    method: init.method ?? 'GET',
    body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    auth: (init.headers as Record<string, string>).Authorization ?? '',
  }
}

function student(rowNumber: number | null, id: string): StudentRow {
  return { rowNumber, id, classroom_slug: 'year-3', name: id, emoji: '🦊', position: '1', created_at: '' }
}

describe('googleSheets', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SHEET_API_URL', SCRIPT_URL)
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('loadSheet', () => {
    function tabs(values: Partial<Record<TableName, unknown[][] | null>>): Response {
      return json({
        data: {
          tabs: Object.fromEntries(
            (Object.keys(TABLES) as TableName[]).map((table, index) => {
              const rows = values[table] === undefined ? [[...TABLES[table]]] : values[table]
              return [table, rows === null ? null : { sheetId: index + 10, values: rows }]
            }),
          ),
        },
      })
    }

    it("reads every tab through the script in one request, without the teacher's sign-in, keeping each row's sheet row number", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        tabs({ classrooms: [[...TABLES.classrooms], ['year-3', 'Year 3', '', '2026-10-01']], students: [[...TABLES.students], ['s1', 'year-3', 'Amira', '🦊', '1', ''], [], ['s2', 'year-3', 'Ben', '🐼', '2']] }),
      )

      const { db, sheetIds } = await loadSheet(ID, 'token-1')

      expect(fetch).toHaveBeenCalledTimes(1)
      const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit]
      expect(url).toBe(`${SCRIPT_URL}?action=sheet`)
      expect(init.headers).toBeUndefined()
      expect(db.classrooms).toEqual([{ rowNumber: 2, slug: 'year-3', name: 'Year 3', current_stage_slug: '', created_at: '2026-10-01' }])
      expect(db.students.map((row) => [row.rowNumber, row.id, row.created_at])).toEqual([
        [2, 's1', ''],
        [4, 's2', ''],
      ])
      expect(db.sessions).toEqual([])
      expect(sheetIds.get('absences')).toBe(14)
    })

    it('creates missing tabs with the sign-in and gives every empty tab its header row', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(tabs({ students: null, turns: null, sessions: null, absences: null }))
        .mockResolvedValueOnce(json({ replies: ALL_TABS.slice(1).map((tab) => ({ addSheet: tab })) }))
        .mockResolvedValueOnce(json({}))

      const { sheetIds } = await loadSheet(ID, 'token-1')

      expect(request(1)).toMatchObject({ method: 'POST', auth: 'Bearer token-1', body: { requests: [{ addSheet: { properties: { title: 'students' } } }, {}, {}, {}] } })
      const headers = request(2).body as { valueInputOption: string; data: { range: string }[] }
      expect(headers.valueInputOption).toBe('RAW')
      expect(headers.data.map((entry) => entry.range)).toEqual(['students!A1:F1', 'turns!A1:G1', 'sessions!A1:E1', 'absences!A1:C1'])
      expect(sheetIds.size).toBe(5)
    })

    it('refuses a tab whose header row was changed', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(tabs({ classrooms: [['name', 'slug']] }))

      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ code: 'sheet_header_changed' })
    })

    it('explains a script that is unreachable, misdeployed or failing', async () => {
      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ status: 0, code: 'network' })

      vi.mocked(fetch).mockResolvedValue(new Response('<html>Sign in</html>', { status: 200 }))
      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ status: 502, code: 'script_unreadable' })

      vi.mocked(fetch).mockResolvedValue(json({ error: { status: 500, code: 'sheet_header_changed', message: 'The "turns" tab changed.' } }))
      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ status: 500, code: 'sheet_header_changed' })
    })
  })

  describe('pushWrite', () => {
    const connection: SheetConnection = { spreadsheetId: ID, token: () => 'token-2', sheetIds: new Map<TableName, number>([['students', 11]]) }

    it('appends rows as raw text after the table, without reading first, and says where they landed', async () => {
      const turns: TurnRow[] = [
        { rowNumber: null, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: 'x', student_id: 's1', question_id: '007', status: 'correct', created_at: 't' },
        { rowNumber: null, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: 'x', student_id: 's2', question_id: '=1+1', status: 'incorrect', created_at: 't' },
      ]
      vi.mocked(fetch).mockResolvedValueOnce(json({ updates: { updatedRange: 'turns!A5:G6' } }))

      expect(await pushWrite(connection, { write: { kind: 'append', table: 'turns', rows: turns }, before: null })).toEqual({ kind: 'appended', firstRow: 5 })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(request(0)).toMatchObject({ method: 'POST', auth: 'Bearer token-2', url: expect.stringContaining('/values/turns!A1:append?valueInputOption=RAW&insertDataOption=OVERWRITE') })
      expect(request(0).body).toEqual({ values: [['year-3', 'stage-1', 'x', 's1', '007', 'correct', 't'], ['year-3', 'stage-1', 'x', 's2', '=1+1', 'incorrect', 't']] })
    })

    it('updates the row number it holds, without reading first', async () => {
      const row = { ...student(3, 's1'), name: 'Amira H' }
      vi.mocked(fetch).mockResolvedValueOnce(json({}))

      expect(await pushWrite(connection, { write: { kind: 'update', table: 'students', row }, before: student(3, 's1') })).toEqual({ kind: 'updated' })
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(request(0)).toMatchObject({ method: 'PUT', url: expect.stringContaining('/values/students!A3:F3'), body: { values: [['s1', 'year-3', 'Amira H', '🦊', '1', '']] } })
    })

    it('deletes the row number it holds and says which one', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({}))

      expect(await pushWrite(connection, { write: { kind: 'delete', table: 'students', row: student(4, 's1') }, before: student(4, 's1') })).toEqual({ kind: 'deleted', rowNumber: 4 })
      expect(request(0).body).toEqual({ requests: [{ deleteDimension: { range: { sheetId: 11, dimension: 'ROWS', startIndex: 3, endIndex: 4 } } }] })
    })

    it('refuses to change a row that was never saved to the sheet', async () => {
      await expect(pushWrite(connection, { write: { kind: 'update', table: 'students', row: student(null, 's1') }, before: null })).rejects.toMatchObject({ status: 500 })
      expect(fetch).not.toHaveBeenCalled()
    })
  })
})
