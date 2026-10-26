import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleSheetApi, onSheetReloaded, retrySaving, saveStatus, usesGoogleSheet } from '../../src/services/googleSheetApi'
import { TABLES, type TableName } from '../../src/services/sheetRules'
import { jsonResponse as json } from './helpers'

vi.mock('../../src/services/googleAuth', () => ({
  googleClientId: () => 'client.apps.googleusercontent.com',
  requestToken: vi.fn(async () => 'token-1'),
  currentToken: () => 'token-1',
  forgetToken: vi.fn(),
}))

const SCRIPT_URL: string = 'https://script.google.com/macros/s/test/exec'
const AMIRA: string = '00000000-0000-4000-8000-000000000001'
const BEN: string = '00000000-0000-4000-8000-000000000002'
const TAB_NAMES: TableName[] = Object.keys(TABLES) as TableName[]

// A small stand-in for the Sheets API that keeps every tab's rows, header first, so row numbers behave as on Google.
interface FakeSheet {
  tabs: Map<TableName, string[][]>
  refuseWritesWith: number | null
  loads: number
}

function newSheet(): FakeSheet {
  const tabs = new Map<TableName, string[][]>(TAB_NAMES.map((table) => [table, [[...TABLES[table]]]]))
  tabs.get('classrooms')?.push(['year-3', 'Year 3', '', '2026-10-01T08:00:00.000Z'])
  tabs.get('students')?.push([AMIRA, 'year-3', 'Amira', '🦊', '1', '2026-10-01T08:00:00.000Z'], [BEN, 'year-3', 'Ben', '🐼', '2', '2026-10-01T08:00:00.000Z'])
  return { tabs, refuseWritesWith: null, loads: 0 }
}

function fakeGoogle(sheet: FakeSheet): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    if (url.startsWith(SCRIPT_URL)) {
      return json({ data: { name: 'Year 3', currentStageSlug: null, students: [], results: [] } })
    }
    if (url.includes('?fields=sheets')) {
      sheet.loads++
      return json({ sheets: TAB_NAMES.map((title, sheetId) => ({ properties: { sheetId, title } })) })
    }
    if (url.includes('values:batchGet')) {
      return json({ valueRanges: TAB_NAMES.map((table) => ({ values: sheet.tabs.get(table) })) })
    }
    if (method !== 'GET' && sheet.refuseWritesWith !== null) {
      return json({ error: { message: 'no' } }, sheet.refuseWritesWith)
    }
    const target = /\/values\/(\w+)!A(\d+)/.exec(url)
    const rows = sheet.tabs.get((target?.[1] ?? '') as TableName) ?? []
    if (url.includes(':append')) {
      const firstRow = rows.length + 1
      rows.push(...(body as { values: string[][] }).values)
      return json({ updates: { updatedRange: `${target?.[1]}!A${firstRow}:G${rows.length}` } })
    }
    if (url.includes(':batchUpdate')) {
      const range = (body as { requests: { deleteDimension: { range: { sheetId: number; startIndex: number } } }[] }).requests[0]?.deleteDimension.range
      sheet.tabs.get(TAB_NAMES[range?.sheetId ?? -1] as TableName)?.splice(range?.startIndex ?? -1, 1)
      return json({})
    }
    const rowIndex = Number(target?.[2]) - 1
    if (method === 'PUT') {
      rows[rowIndex] = (body as { values: string[][] }).values[0] as string[]
      return json({})
    }
    return json({ values: rows[rowIndex] === undefined ? [] : [rows[rowIndex]] })
  }) as unknown as typeof fetch
}

describe('googleSheetApi', () => {
  let sheet: FakeSheet

  beforeEach(async () => {
    vi.stubEnv('VITE_SHEET_ID', 'sheet-id')
    vi.stubEnv('VITE_SHEET_API_URL', SCRIPT_URL)
    sheet = newSheet()
    vi.stubGlobal('fetch', fakeGoogle(sheet))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await googleSheetApi.logout()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is used when both the OAuth client and the sheet are configured', () => {
    expect(usesGoogleSheet()).toBe(true)
    vi.stubEnv('VITE_SHEET_ID', '')
    expect(usesGoogleSheet()).toBe(false)
  })

  it('needs a sign-in before it has any data', async () => {
    await expect(googleSheetApi.me()).rejects.toMatchObject({ status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the sheet once at sign-in and answers every screen from that copy', async () => {
    await googleSheetApi.login('')

    expect(await googleSheetApi.listClassrooms()).toEqual([{ slug: 'year-3', name: 'Year 3', studentCount: 2, createdAt: '2026-10-01T08:00:00.000Z' }])
    expect((await googleSheetApi.getClassroom('year-3')).students.map((student) => student.name)).toEqual(['Amira', 'Ben'])
    await expect(googleSheetApi.me()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows a change at once and writes it to the sheet in the background', async () => {
    await googleSheetApi.login('')

    const detail = await googleSheetApi.openSession('year-3', 'stage-1')

    expect(detail.session?.stageSlug).toBe('stage-1')
    await retrySaving()
    expect(sheet.tabs.get('sessions')?.[1]).toEqual([detail.session?.id, 'year-3', 'stage-1', detail.session?.openedAt, ''])
    expect(saveStatus.value.state).toBe('idle')
  })

  it('refuses rule-breaking changes in the browser without writing anything', async () => {
    await googleSheetApi.login('')
    const session = (await googleSheetApi.openSession('year-3', 'stage-1')).session?.id as string
    await googleSheetApi.recordResult(session, AMIRA, 'q1', 'correct')

    await expect(googleSheetApi.recordResult(session, AMIRA, 'q2', 'incorrect')).rejects.toMatchObject({ code: 'student_already_assessed' })
    await retrySaving()
    expect(sheet.tabs.get('turns')).toHaveLength(2)
  })

  it('keeps row numbers right when an earlier row is deleted', async () => {
    await googleSheetApi.login('')
    const session = (await googleSheetApi.openSession('year-3', 'stage-1')).session?.id as string
    await googleSheetApi.setAbsent(session, AMIRA, true)
    await googleSheetApi.setAbsent(session, BEN, true)
    await retrySaving()
    expect(sheet.tabs.get('absences')?.map((row) => row[1])).toEqual(['student_id', AMIRA, BEN])

    await googleSheetApi.setAbsent(session, AMIRA, false)
    await googleSheetApi.setAbsent(session, BEN, false)
    await retrySaving()

    expect(saveStatus.value.state).toBe('idle')
    expect(sheet.tabs.get('absences')).toEqual([[...TABLES.absences]])
  })

  it('reloads the sheet and tells open screens when Google refuses a change', async () => {
    await googleSheetApi.login('')
    const reloaded = vi.fn()
    const stop = onSheetReloaded(reloaded)
    sheet.refuseWritesWith = 403

    await googleSheetApi.openSession('year-3', 'stage-1')
    await retrySaving()

    expect(saveStatus.value).toMatchObject({ state: 'refused', pending: 0 })
    expect(sheet.loads).toBe(2)
    expect(reloaded).toHaveBeenCalledTimes(1)
    expect((await googleSheetApi.getClassroom('year-3')).session).toBeNull()
    stop()
  })

  it('reads a classroom link through the read-only script, without signing in', async () => {
    const view = await googleSheetApi.getPublicClassroom('year 3')

    expect(view.name).toBe('Year 3')
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(`${SCRIPT_URL}?action=public&slug=year%203`)
  })

  it('refuses photos and large roster files without calling Google', async () => {
    const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'class.xlsx')

    await expect(googleSheetApi.previewRoster(large)).rejects.toMatchObject({ code: 'file_too_large' })
    await expect(googleSheetApi.setPhoto('student', large)).rejects.toMatchObject({ code: 'photos_unavailable' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
