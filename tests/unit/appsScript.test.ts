import { describe, expect, it } from 'vitest'
import scriptSource from '../../apps-script/Code.js?raw'
import { TABLES } from '../../src/services/sheetRules'
import type { PublicClassroom } from '../../src/types/api'

interface ScriptBody<T> {
  data?: T
  error?: { status: number; code: string; message: string }
}

interface Script {
  doGet: (e: unknown) => { text: string }
  TABLES: Record<string, readonly string[]>
}

const CLASSROOMS: unknown[][] = [
  [...TABLES.classrooms],
  ['year-3', 'Year 3', 'stage-1', '2026-10-01T08:00:00.000Z'],
  ['year-4', 'Year 4', '', '2026-10-02T08:00:00.000Z'],
]
const STUDENTS: unknown[][] = [
  [...TABLES.students],
  ['s2', 'year-3', 'Ben', '🐼', 2, '2026-10-01T08:00:00.000Z'],
  ['s1', 'year-3', 'Amira', '🦊', '1', '2026-10-01T08:00:00.000Z'],
  ['', '', '', '', '', ''],
  ['s3', 'year-4', 'Chloe', '🐯', '1', '2026-10-02T08:00:00.000Z'],
]
const TURNS: unknown[][] = [
  [...TABLES.turns],
  ['year-3', 'stage-1', 'x', 's2', 'q2', 'incorrect', '2026-10-01T09:00:00.000Z'],
  ['year-3', 'stage-1', 'x', 's1', 'q1', 'correct', '2026-10-01T09:01:00.000Z'],
  ['year-4', 'stage-1', 'y', 's3', 'q1', 'correct', '2026-10-02T09:00:00.000Z'],
]

function loadScript(tabs: Map<string, unknown[][]>): Script {
  const sheet = (rows: unknown[][]) => ({
    getDataRange: () => ({
      getValues: () => {
        const width = Math.max(...rows.map((row) => row.length))
        return rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? ''))
      },
    }),
  })
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (name: string) => (tabs.has(name) ? sheet(tabs.get(name) as unknown[][]) : null) }) },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => ({ text, setMimeType: function () { return this } }),
    },
    console: { info: () => {}, warn: () => {}, error: () => {} },
  }
  const factory = new Function(...Object.keys(globals), `${scriptSource}\nreturn { doGet, TABLES }`) as (...values: unknown[]) => Script
  return factory(...Object.values(globals))
}

function get(script: Script, slug: string, action: string = 'public'): ScriptBody<PublicClassroom> {
  return JSON.parse(script.doGet({ parameter: { action, slug } }).text)
}

describe('Apps Script student link', () => {
  const tabs = () => new Map([['classrooms', CLASSROOMS], ['students', STUDENTS], ['turns', TURNS]])

  it('shows one classroom with points, without used questions or the session', () => {
    expect(get(loadScript(tabs()), 'year-3').data).toEqual({
      name: 'Year 3',
      currentStageSlug: 'stage-1',
      students: [
        { id: 's1', name: 'Amira', emoji: '🦊', photoFile: null, position: 1, points: 1 },
        { id: 's2', name: 'Ben', emoji: '🐼', photoFile: null, position: 2, points: 0 },
      ],
      results: [
        { studentId: 's1', stageSlug: 'stage-1', outcome: 'correct' },
        { studentId: 's2', stageSlug: 'stage-1', outcome: 'incorrect' },
      ],
    })
  })

  it('answers unknown and malformed links with a not-found message', () => {
    for (const slug of ['year-9', 'Not A Slug']) {
      const body = get(loadScript(tabs()), slug)
      expect(body.error?.status).toBe(404)
      expect(body.error?.message).toContain('Ask your teacher')
    }
  })

  it('treats missing tabs as no classrooms yet', () => {
    expect(get(loadScript(new Map()), 'year-3').error?.code).toBe('classroom_not_found')
  })

  it('refuses to read a tab whose header row was changed', () => {
    const changed = tabs()
    changed.set('students', [['name', 'id'], ...STUDENTS.slice(1)])

    expect(get(loadScript(changed), 'year-3').error).toMatchObject({ status: 500, code: 'sheet_header_changed' })
  })

  it('accepts no writes and no other actions', () => {
    expect(scriptSource).not.toMatch(/function doPost/)
    expect(get(loadScript(tabs()), 'year-3', 'listClassrooms').error?.code).toBe('unknown_action')
  })

  it('reads the tabs with the same columns the browser writes', () => {
    const script = loadScript(tabs())

    for (const [table, columns] of Object.entries(script.TABLES)) {
      expect(columns).toEqual(TABLES[table as keyof typeof TABLES])
    }
  })
})
