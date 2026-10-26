import { columnLabel } from '../utils/roster'
import { ApiError } from './apiError'
import { cellsOf, emptyDb, rowFrom, TABLES, type ColumnOf, type SheetDb, type SheetRow, type SheetWrite, type TableName } from './sheetRules'

const SHEETS_API: string = 'https://sheets.googleapis.com/v4/spreadsheets'
const TABLE_NAMES: readonly TableName[] = Object.keys(TABLES) as TableName[]

// The cells that identify a row, re-read before an update or delete so a sheet edited elsewhere is never overwritten.
const ROW_KEYS: { [T in TableName]: readonly ColumnOf<T>[] } = {
  classrooms: ['slug'],
  students: ['id'],
  turns: ['classroom_slug', 'stage_slug', 'student_id'],
  sessions: ['id'],
  absences: ['session_id', 'student_id'],
}

export interface SheetConnection {
  spreadsheetId: string
  token: () => string
  sheetIds: Map<TableName, number>
}

export interface LoadedSheet {
  db: SheetDb
  sheetIds: Map<TableName, number>
}

// Where a write landed, so the caller can keep the row numbers it holds in step with the sheet.
export type WriteOutcome = { kind: 'appended'; firstRow: number } | { kind: 'updated' } | { kind: 'deleted'; rowNumber: number }

type ValueRanges = { valueRanges?: { values?: unknown[][] }[] }

export function spreadsheetId(): string {
  return (import.meta.env.VITE_SHEET_ID ?? '').trim()
}

function rangeOf(table: TableName, rowNumber?: number): string {
  const lastColumn = columnLabel(TABLES[table].length - 1)
  return rowNumber === undefined ? `${table}!A1:${lastColumn}` : `${table}!A${rowNumber}:${lastColumn}${rowNumber}`
}

async function call<T>(token: string, method: string, url: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    })
  } catch (error) {
    console.error(`${method} ${url} failed`, error)
    throw new ApiError(0, 'network', "Can't reach Google Sheets. Check the connection; your changes are kept in this tab.")
  }
  if (response.ok) {
    return (await response.json()) as T
  }
  const problem = ((await response.json().catch(() => null)) as { error?: { message?: string } } | null)?.error?.message ?? ''
  console.error(`${method} ${url} answered ${response.status}`, problem)
  if (response.status === 401) {
    throw new ApiError(401, 'google_sign_in_expired', 'Your Google sign-in expired. Sign in again to keep saving.')
  }
  if (response.status === 403) {
    throw new ApiError(403, 'sheet_forbidden', "This Google account can't edit the QuestRush sheet. Ask its owner to share it with you as an editor.")
  }
  if (response.status === 404) {
    throw new ApiError(404, 'sheet_not_found', "The QuestRush sheet wasn't found. Check the sheet id the site was built with.")
  }
  throw new ApiError(response.status, 'sheet_error', `Google Sheets refused the change${problem === '' ? '' : `: ${problem}`}`)
}

function readTabs(id: string, token: string): Promise<ValueRanges> {
  const ranges = TABLE_NAMES.map((table) => `ranges=${encodeURIComponent(rangeOf(table))}`).join('&')
  return call<ValueRanges>(token, 'GET', `${SHEETS_API}/${id}/values:batchGet?${ranges}&majorDimension=ROWS`)
}

// The tab list and every tab's rows are requested together; only a sheet missing tabs needs a second read.
export async function loadSheet(id: string, token: string): Promise<LoadedSheet> {
  const [sheetIds, firstRead] = await Promise.all([readSheetIds(id, token), readTabs(id, token).catch((error: unknown) => error)])
  const missing = TABLE_NAMES.filter((table) => !sheetIds.has(table))
  if (missing.length > 0) {
    await createTabs(id, token, missing, sheetIds)
  }
  if (missing.length === 0 && firstRead instanceof Error) {
    throw firstRead
  }
  const data = missing.length === 0 ? (firstRead as ValueRanges) : await readTabs(id, token)
  const db = emptyDb()
  const headerless: TableName[] = []
  TABLE_NAMES.forEach((table, index) => {
    const values = data.valueRanges?.[index]?.values ?? []
    if (values.length === 0) {
      headerless.push(table)
      return
    }
    const header = (values[0] ?? []).map((cell) => String(cell))
    if (header.join(',') !== TABLES[table].join(',')) {
      throw new ApiError(500, 'sheet_header_changed', `The "${table}" tab's first row must be: ${TABLES[table].join(', ')}.`)
    }
    const rows = values
      .slice(1)
      .map((cells, offset) => rowFrom(table, offset + 2, cells))
      .filter((row) => cellsOf(table, row).some((cell) => cell !== ''))
    ;(db[table] as SheetRow[]).push(...rows)
  })
  if (headerless.length > 0) {
    await writeHeaders(id, token, headerless)
  }
  return { db, sheetIds }
}

async function readSheetIds(id: string, token: string): Promise<Map<TableName, number>> {
  const data = await call<{ sheets?: { properties?: { sheetId?: number; title?: string } }[] }>(token, 'GET', `${SHEETS_API}/${id}?fields=sheets.properties(sheetId,title)`)
  const sheetIds = new Map<TableName, number>()
  for (const sheet of data.sheets ?? []) {
    const title = sheet.properties?.title ?? ''
    if ((TABLE_NAMES as readonly string[]).includes(title) && sheet.properties?.sheetId !== undefined) {
      sheetIds.set(title as TableName, sheet.properties.sheetId)
    }
  }
  return sheetIds
}

async function createTabs(id: string, token: string, tables: readonly TableName[], sheetIds: Map<TableName, number>): Promise<void> {
  const created = await call<{ replies?: { addSheet?: { properties?: { sheetId?: number; title?: string } } }[] }>(token, 'POST', `${SHEETS_API}/${id}:batchUpdate`, {
    requests: tables.map((table) => ({ addSheet: { properties: { title: table, gridProperties: { frozenRowCount: 1 } } } })),
  })
  for (const reply of created.replies ?? []) {
    const properties = reply.addSheet?.properties
    if (properties?.title !== undefined && properties.sheetId !== undefined) {
      sheetIds.set(properties.title as TableName, properties.sheetId)
    }
  }
  console.info('sheet tabs created', tables.join(', '))
}

// A new or emptied tab gets its header first, so the first appended row never lands on row 1.
async function writeHeaders(id: string, token: string, tables: readonly TableName[]): Promise<void> {
  await call(token, 'POST', `${SHEETS_API}/${id}/values:batchUpdate`, {
    valueInputOption: 'RAW',
    data: tables.map((table) => ({ range: rangeOf(table, 1), values: [[...TABLES[table]]] })),
  })
  console.info('sheet header rows written', tables.join(', '))
}

// RAW keeps every cell as typed text: "=1+1" is never a formula and "007" keeps its zeros. OVERWRITE fills the rows
// after the table without shifting rows below, so the row numbers kept in the browser stay right.
export async function writeToSheet(connection: SheetConnection, write: SheetWrite): Promise<WriteOutcome> {
  const { spreadsheetId: id, token } = connection
  const table = write.table
  if (write.kind === 'append') {
    const appended = await call<{ updates?: { updatedRange?: string } }>(
      token(),
      'POST',
      `${SHEETS_API}/${id}/values/${encodeURIComponent(`${table}!A1`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`,
      { values: write.rows.map((row) => cellsOf(table, row)) },
    )
    const firstRow = Number(/![A-Z]+(\d+)/.exec(appended.updates?.updatedRange ?? '')?.[1] ?? Number.NaN)
    if (!Number.isInteger(firstRow)) {
      throw new ApiError(500, 'sheet_error', 'Google Sheets saved the rows but did not say where.')
    }
    return { kind: 'appended', firstRow }
  }
  const rowNumber = await verifiedRowNumber(connection, table, write.row)
  if (write.kind === 'update') {
    await call(token(), 'PUT', `${SHEETS_API}/${id}/values/${encodeURIComponent(rangeOf(table, rowNumber))}?valueInputOption=RAW`, {
      values: [cellsOf(table, write.row)],
    })
    return { kind: 'updated' }
  }
  const sheetId = connection.sheetIds.get(table)
  if (sheetId === undefined) {
    throw new ApiError(500, 'sheet_error', `The "${table}" tab is missing.`)
  }
  await call(token(), 'POST', `${SHEETS_API}/${id}:batchUpdate`, {
    requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } }],
  })
  return { kind: 'deleted', rowNumber }
}

async function verifiedRowNumber(connection: SheetConnection, table: TableName, row: SheetRow): Promise<number> {
  const rowNumber = row.rowNumber
  if (rowNumber === null) {
    throw new ApiError(500, 'sheet_error', 'This row was never saved to the sheet.')
  }
  const current = await call<{ values?: unknown[][] }>(connection.token(), 'GET', `${SHEETS_API}/${connection.spreadsheetId}/values/${encodeURIComponent(rangeOf(table, rowNumber))}`)
  const columns: readonly string[] = TABLES[table]
  const onSheet = cellsOf(table, rowFrom(table, rowNumber, current.values?.[0] ?? []))
  const expected = cellsOf(table, row)
  const keyIndexes = (ROW_KEYS[table] as readonly string[]).map((column) => columns.indexOf(column))
  if (keyIndexes.some((index) => onSheet[index] !== expected[index])) {
    throw new ApiError(409, 'sheet_changed', 'The sheet was changed somewhere else, so QuestRush reloaded it. Check the classroom and try again.')
  }
  return rowNumber
}
