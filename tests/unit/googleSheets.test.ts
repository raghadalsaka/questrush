import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSheet, writeToSheet, type SheetConnection } from '../../src/services/googleSheets'
import { TABLES, type StudentRow, type TableName, type TurnRow } from '../../src/services/sheetRules'
import { jsonResponse as json } from './helpers'

const ID: string = 'sheet-id'
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
    vi.stubGlobal('fetch', vi.fn())
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('loadSheet', () => {
    it('reads the tab list and every tab at once, keeping each row\'s sheet row number', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(json({ sheets: ALL_TABS }))
        .mockResolvedValueOnce(
          json({
            valueRanges: [
              { values: [[...TABLES.classrooms], ['year-3', 'Year 3', '', '2026-10-01']] },
              { values: [[...TABLES.students], ['s1', 'year-3', 'Amira', '🦊', '1', ''], [], ['s2', 'year-3', 'Ben', '🐼', '2']] },
              { values: [[...TABLES.turns]] },
              { values: [[...TABLES.sessions]] },
              { values: [[...TABLES.absences]] },
            ],
          }),
        )

      const { db, sheetIds } = await loadSheet(ID, 'token-1')

      expect(fetch).toHaveBeenCalledTimes(2)
      expect(request(1).url).toContain('values:batchGet?ranges=classrooms!A1:D&ranges=students!A1:F&ranges=turns!A1:G')
      expect(request(1).auth).toBe('Bearer token-1')
      expect(db.classrooms).toEqual([{ rowNumber: 2, slug: 'year-3', name: 'Year 3', current_stage_slug: '', created_at: '2026-10-01' }])
      expect(db.students.map((row) => [row.rowNumber, row.id, row.created_at])).toEqual([
        [2, 's1', ''],
        [4, 's2', ''],
      ])
      expect(db.sessions).toEqual([])
      expect(sheetIds.get('absences')).toBe(14)
    })

    it('creates missing tabs, reads again, and gives every empty tab its header row', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(json({ sheets: [ALL_TABS[0]] }))
        .mockResolvedValueOnce(json({ error: { message: 'Unable to parse range: students!A1:F' } }, 400))
        .mockResolvedValueOnce(json({ replies: ALL_TABS.slice(1).map((tab) => ({ addSheet: tab })) }))
        .mockResolvedValueOnce(json({ valueRanges: [{ values: [[...TABLES.classrooms]] }, {}, {}, {}, {}] }))
        .mockResolvedValueOnce(json({}))

      const { sheetIds } = await loadSheet(ID, 'token-1')

      expect(request(2).body).toMatchObject({ requests: [{ addSheet: { properties: { title: 'students' } } }, {}, {}, {}] })
      const headers = request(4).body as { valueInputOption: string; data: { range: string }[] }
      expect(headers.valueInputOption).toBe('RAW')
      expect(headers.data.map((entry) => entry.range)).toEqual(['students!A1:F1', 'turns!A1:G1', 'sessions!A1:E1', 'absences!A1:C1'])
      expect(sheetIds.size).toBe(5)
    })

    it('refuses a tab whose header row was changed', async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(json({ sheets: ALL_TABS }))
        .mockResolvedValueOnce(json({ valueRanges: [{ values: [['name', 'slug']] }, {}, {}, {}, {}] }))

      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ code: 'sheet_header_changed' })
    })

    it('explains expired sign-ins, missing access and network failures', async () => {
      vi.mocked(fetch).mockResolvedValue(json({ error: { message: 'expired' } }, 401))
      await expect(loadSheet(ID, 'old')).rejects.toMatchObject({ status: 401, code: 'google_sign_in_expired' })

      vi.mocked(fetch).mockResolvedValue(json({ error: { message: 'denied' } }, 403))
      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ status: 403, code: 'sheet_forbidden' })

      vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))
      await expect(loadSheet(ID, 'token-1')).rejects.toMatchObject({ status: 0, code: 'network' })
    })
  })

  describe('writeToSheet', () => {
    const connection: SheetConnection = { spreadsheetId: ID, token: () => 'token-2', sheetIds: new Map<TableName, number>([['students', 11]]) }

    it('appends rows as raw text after the table and says where they landed', async () => {
      const turns: TurnRow[] = [
        { rowNumber: null, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: 'x', student_id: 's1', question_id: '007', status: 'correct', created_at: 't' },
        { rowNumber: null, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: 'x', student_id: 's2', question_id: '=1+1', status: 'incorrect', created_at: 't' },
      ]
      vi.mocked(fetch).mockResolvedValueOnce(json({ updates: { updatedRange: 'turns!A5:G6' } }))

      expect(await writeToSheet(connection, { kind: 'append', table: 'turns', rows: turns })).toEqual({ kind: 'appended', firstRow: 5 })
      expect(request(0).url).toContain('/values/turns!A1:append?valueInputOption=RAW&insertDataOption=OVERWRITE')
      expect(request(0).body).toEqual({ values: [['year-3', 'stage-1', 'x', 's1', '007', 'correct', 't'], ['year-3', 'stage-1', 'x', 's2', '=1+1', 'incorrect', 't']] })
    })

    it('re-reads a row before updating it', async () => {
      const row = student(3, 's1')
      row.name = 'Amira H'
      vi.mocked(fetch).mockResolvedValueOnce(json({ values: [['s1', 'year-3', 'Amira', '🦊', '1', '']] })).mockResolvedValueOnce(json({}))

      expect(await writeToSheet(connection, { kind: 'update', table: 'students', row })).toEqual({ kind: 'updated' })
      expect(request(0)).toMatchObject({ method: 'GET', url: expect.stringContaining('/values/students!A3:F3') })
      expect(request(1)).toMatchObject({ method: 'PUT', body: { values: [['s1', 'year-3', 'Amira H', '🦊', '1', '']] } })
    })

    it('refuses to touch a row that no longer holds the same record', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ values: [['someone-else']] }))

      await expect(writeToSheet(connection, { kind: 'update', table: 'students', row: student(3, 's1') })).rejects.toMatchObject({ status: 409, code: 'sheet_changed' })
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('deletes the verified row and says which one', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ values: [['s1']] })).mockResolvedValueOnce(json({}))

      expect(await writeToSheet(connection, { kind: 'delete', table: 'students', row: student(3, 's1') })).toEqual({ kind: 'deleted', rowNumber: 3 })
      expect(request(1).body).toEqual({ requests: [{ deleteDimension: { range: { sheetId: 11, dimension: 'ROWS', startIndex: 2, endIndex: 3 } } }] })
    })
  })
})
