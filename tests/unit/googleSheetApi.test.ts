import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleSheetApi, onSheetReloaded, retrySaving, saveStatus, usesGoogleSheet } from '../../src/services/googleSheetApi'
import { TABLES, type TableName } from '../../src/services/sheetRules'
import { jsonResponse as json } from './helpers'

const kept = vi.hoisted(() => new Map<string, unknown>())

// Copies on the way in and out, as IndexedDB's structured clone does.
vi.mock('../../src/services/browserStore', () => ({
  indexedDbStore: () => ({
    load: async (key: string) => (kept.has(key) ? structuredClone(kept.get(key)) : null),
    save: async (key: string, value: unknown) => {
      kept.set(key, structuredClone(value))
    },
    remove: async (key: string) => {
      kept.delete(key)
    },
  }),
}))

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
  offline: boolean
  loads: number
}

function newSheet(): FakeSheet {
  const tabs = new Map<TableName, string[][]>(TAB_NAMES.map((table) => [table, [[...TABLES[table]]]]))
  tabs.get('classrooms')?.push(['year-3', 'Year 3', '', '2026-10-01T08:00:00.000Z'])
  tabs.get('students')?.push([AMIRA, 'year-3', 'Amira', '🦊', '1', '2026-10-01T08:00:00.000Z'], [BEN, 'year-3', 'Ben', '🐼', '2', '2026-10-01T08:00:00.000Z'])
  return { tabs, refuseWritesWith: null, offline: false, loads: 0 }
}

function fakeGoogle(sheet: FakeSheet): typeof fetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = decodeURIComponent(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
    if (sheet.offline) {
      throw new TypeError('Failed to fetch')
    }
    if (url.startsWith(SCRIPT_URL)) {
      const params = new URL(url).searchParams
      if (params.get('action') !== 'sheet') {
        return json({ data: { name: 'Year 3', currentStageSlug: null, students: [], results: [] } })
      }
      const only = params.get('tab')
      if (only === null) {
        sheet.loads++
      }
      const tabs = TAB_NAMES.filter((table) => only === null || table === only).map((table) => [table, { sheetId: TAB_NAMES.indexOf(table), values: sheet.tabs.get(table) }])
      return json({ data: { tabs: Object.fromEntries(tabs) } })
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
    if (method === 'GET' && /!A1:[A-Z]+$/.test(url)) {
      return json({ values: rows })
    }
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
    kept.clear()
    vi.mocked(fetch).mockClear()
    sheet.loads = 0
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('is used when the OAuth client, the sheet and the read-only script are all configured', () => {
    expect(usesGoogleSheet()).toBe(true)
    vi.stubEnv('VITE_SHEET_API_URL', '')
    expect(usesGoogleSheet()).toBe(false)
    vi.stubEnv('VITE_SHEET_API_URL', SCRIPT_URL)
    vi.stubEnv('VITE_SHEET_ID', '')
    expect(usesGoogleSheet()).toBe(false)
  })

  it('needs a sign-in before it has any data', async () => {
    await expect(googleSheetApi.me()).rejects.toMatchObject({ status: 401 })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reads the sheet once at sign-in, through the script, and answers every screen from that copy', async () => {
    await googleSheetApi.login()

    expect(await googleSheetApi.listClassrooms()).toEqual([{ slug: 'year-3', name: 'Year 3', studentCount: 2, createdAt: '2026-10-01T08:00:00.000Z' }])
    expect((await googleSheetApi.getClassroom('year-3')).students.map((student) => student.name)).toEqual(['Amira', 'Ben'])
    await expect(googleSheetApi.me()).resolves.toBeUndefined()
    expect(vi.mocked(fetch).mock.calls.map((call) => String(call[0]))).toEqual([`${SCRIPT_URL}?action=sheet`])
  })

  it('shows a change at once and writes it to the sheet in the background', async () => {
    await googleSheetApi.login()

    const detail = await googleSheetApi.openSession('year-3', 'stage-1')

    expect(detail.session?.stageSlug).toBe('stage-1')
    await retrySaving()
    expect(sheet.tabs.get('sessions')?.[1]).toEqual([detail.session?.id, 'year-3', 'stage-1', detail.session?.openedAt, ''])
    expect(saveStatus.value.state).toBe('idle')
  })

  it('refuses rule-breaking changes in the browser without writing anything', async () => {
    await googleSheetApi.login()
    const session = (await googleSheetApi.openSession('year-3', 'stage-1')).session?.id as string
    await googleSheetApi.recordResult(session, AMIRA, 'q1', 'correct')

    await expect(googleSheetApi.recordResult(session, AMIRA, 'q2', 'incorrect')).rejects.toMatchObject({ code: 'student_already_assessed' })
    await retrySaving()
    expect(sheet.tabs.get('turns')).toHaveLength(2)
  })

  it('keeps row numbers right when an earlier row is deleted', async () => {
    await googleSheetApi.login()
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
    await googleSheetApi.login()
    const reloaded = vi.fn()
    const stop = onSheetReloaded(reloaded)
    sheet.refuseWritesWith = 403

    await googleSheetApi.openSession('year-3', 'stage-1')
    await retrySaving()

    expect(saveStatus.value).toMatchObject({ state: 'refused', pending: 0 })
    expect(reloaded).toHaveBeenCalled()
    expect((await googleSheetApi.getClassroom('year-3')).session).toBeNull()
    stop()
  })

  it('reads a classroom link through the read-only script, without signing in', async () => {
    const view = await googleSheetApi.getPublicClassroom('year 3')

    expect(view.name).toBe('Year 3')
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toBe(`${SCRIPT_URL}?action=public&slug=year%203`)
  })

  it('refuses large roster files without calling Google', async () => {
    const large = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'class.xlsx')

    await expect(googleSheetApi.previewRoster(large)).rejects.toMatchObject({ code: 'file_too_large' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps unsaved changes in this browser across a sign-out and sends them after the next sign-in', async () => {
    await googleSheetApi.login()
    sheet.refuseWritesWith = 401
    const session = (await googleSheetApi.openSession('year-3', 'stage-1')).session?.id as string
    await googleSheetApi.recordResult(session, AMIRA, 'q1', 'correct')
    await retrySaving()
    expect(saveStatus.value).toMatchObject({ state: 'needs-sign-in', pending: 2 })

    await googleSheetApi.logout()
    expect(kept.size).toBe(1)
    sheet.refuseWritesWith = null
    await googleSheetApi.login()
    await retrySaving()

    expect(sheet.tabs.get('turns')?.[1]).toEqual(['year-3', 'stage-1', session, AMIRA, 'q1', 'correct', expect.any(String)])
    expect(saveStatus.value).toMatchObject({ state: 'idle', pending: 0 })
  })

  it('saves with plain writes: nothing is read from the sheet after sign-in', async () => {
    await googleSheetApi.login()
    vi.mocked(fetch).mockClear()

    const session = (await googleSheetApi.openSession('year-3', 'stage-1')).session?.id as string
    await googleSheetApi.recordResult(session, AMIRA, 'q1', 'correct')
    await googleSheetApi.updateStudent(BEN, { name: 'Ben C', emoji: '🐼' })
    await retrySaving()

    expect(vi.mocked(fetch).mock.calls.some((call) => String(call[0]).startsWith(SCRIPT_URL))).toBe(false)
    expect(sheet.tabs.get('students')?.[2]?.[2]).toBe('Ben C')
    expect(sheet.tabs.get('turns')).toHaveLength(2)
  })

  it('lets the sheet win at the next sign-in when it changed the same row first, and says a change was dropped', async () => {
    await googleSheetApi.login()
    sheet.refuseWritesWith = 401
    await googleSheetApi.updateStudent(AMIRA, { name: 'Amira H', emoji: '🦊' })
    await retrySaving()
    await googleSheetApi.logout()
    sheet.refuseWritesWith = null
    ;(sheet.tabs.get('students')?.[1] as string[])[2] = 'Amira (edited on the sheet)'

    await googleSheetApi.login()

    expect(sheet.tabs.get('students')?.[1]?.[2]).toBe('Amira (edited on the sheet)')
    expect((await googleSheetApi.getClassroom('year-3')).students[0]?.name).toBe('Amira (edited on the sheet)')
    expect(saveStatus.value).toMatchObject({ state: 'dropped', message: '1 change was dropped because the sheet changed.' })
  })

  it('shows changes made on another device only after the site is opened again', async () => {
    await googleSheetApi.login()
    sheet.tabs.get('classrooms')?.push(['year-4', 'Year 4', '', '2026-10-02T08:00:00.000Z'])

    await retrySaving()
    expect((await googleSheetApi.listClassrooms()).map((classroom) => classroom.slug)).toEqual(['year-3'])

    await googleSheetApi.logout()
    await googleSheetApi.login()
    expect((await googleSheetApi.listClassrooms()).map((classroom) => classroom.slug)).toEqual(['year-4', 'year-3'])
  })

  it('keeps the row numbers it holds in step when rows are deleted and added', async () => {
    await googleSheetApi.login()
    await googleSheetApi.updateStudent(AMIRA, { name: 'Amira', emoji: '🦊' })
    await googleSheetApi.deleteStudent(AMIRA)
    await googleSheetApi.updateStudent(BEN, { name: 'Ben C', emoji: '🐼' })
    await retrySaving()

    expect(sheet.tabs.get('students')?.map((row) => row[2])).toEqual(['name', 'Ben C'])
  })

  it('clears the copy kept in this browser on sign-out once everything is saved', async () => {
    await googleSheetApi.login()
    await googleSheetApi.openSession('year-3', 'stage-1')
    expect(kept.size).toBe(1)

    await googleSheetApi.logout()

    expect(kept.size).toBe(0)
    expect(sheet.tabs.get('sessions')).toHaveLength(2)
  })
})
