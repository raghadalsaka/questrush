import { columnLabel } from '../utils/roster'
import { ApiError, GENERIC_ERROR_MESSAGE } from './apiError'
import { cellsOf, emptyDb, LATER_COLUMNS, rowFrom, TABLES, type SheetDb, type SheetRow, type TableName } from './sheetRules'
import type { PendingWrite } from './sheetSync'

const SHEETS_API: string = 'https://sheets.googleapis.com/v4/spreadsheets'
const TABLE_NAMES: readonly TableName[] = Object.keys(TABLES) as TableName[]
const OFFLINE_MESSAGE: string = "Can't reach Google Sheets. Check the connection; your changes are kept in this browser."

export interface SheetConnection {
  spreadsheetId: string
  token: () => string
  sheetIds: Map<TableName, number>
}

// Where a write landed, so the caller can keep the row numbers it holds in step with the sheet.
export type WriteOutcome = { kind: 'appended'; firstRow: number } | { kind: 'updated' } | { kind: 'deleted'; rowNumber: number }

export interface LoadedSheet {
  db: SheetDb
  sheetIds: Map<TableName, number>
}

type ScriptTabs = { tabs: Partial<Record<TableName, { sheetId?: number; values?: unknown[][] } | null>> }

export function spreadsheetId(): string {
  return (import.meta.env.VITE_SHEET_ID ?? '').trim()
}

export function scriptUrl(): string {
  return (import.meta.env.VITE_SHEET_API_URL ?? '').trim()
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
    throw new ApiError(0, 'network', OFFLINE_MESSAGE)
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

// The tab list and every tab's rows come from the script in one request; only a sheet missing tabs is written to here.
export async function loadSheet(id: string, token: string): Promise<LoadedSheet> {
  const { tabs } = await readFromScript<ScriptTabs>({ action: 'sheet' })
  const sheetIds = new Map<TableName, number>()
  for (const table of TABLE_NAMES) {
    const sheetId = tabs[table]?.sheetId
    if (sheetId !== undefined) {
      sheetIds.set(table, sheetId)
    }
  }
  const missing = TABLE_NAMES.filter((table) => !sheetIds.has(table))
  if (missing.length > 0) {
    await createTabs(id, token, missing, sheetIds)
  }
  const db = emptyDb()
  const headerless: TableName[] = []
  const outdated: TableName[] = []
  for (const table of TABLE_NAMES) {
    const values = tabs[table]?.values ?? []
    if (values.length === 0) {
      headerless.push(table)
      continue
    }
    const header = (values[0] ?? []).map((cell) => String(cell))
    if (header.join(',') !== TABLES[table].join(',')) {
      if (!lacksOnlyLaterColumns(table, header)) {
        throw new ApiError(500, 'sheet_header_changed', `The "${table}" tab's first row must be: ${TABLES[table].join(', ')}.`)
      }
      outdated.push(table)
    }
    const rows = values
      .slice(1)
      .map((cells, offset) => rowFrom(table, offset + 2, cells))
      .filter((row) => cellsOf(table, row).some((cell) => cell !== ''))
    ;(db[table] as SheetRow[]).push(...rows)
  }
  if (headerless.length > 0 || outdated.length > 0) {
    await writeHeaders(id, token, [...headerless, ...outdated])
  }
  return { db, sheetIds }
}

function lacksOnlyLaterColumns(table: TableName, header: readonly string[]): boolean {
  const columns: readonly string[] = TABLES[table]
  const required = columns.length - (LATER_COLUMNS[table]?.length ?? 0)
  return header.length >= required && header.length < columns.length && header.every((cell, index) => cell === columns[index])
}

// Reads never use the teacher's Google sign-in: the read-only Apps Script answers them, as it does for the student link.
async function readFromScript<T>(params: Record<string, string>): Promise<T> {
  const url = `${scriptUrl()}?${new URLSearchParams(params).toString()}`
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  } catch (error) {
    console.error(`GET ${url} failed`, error)
    throw new ApiError(0, 'network', OFFLINE_MESSAGE)
  }
  const body = (await response.json().catch(() => null)) as { data?: T; error?: { status?: number; code?: string; message?: string } } | null
  if (!response.ok || body === null || typeof body !== 'object') {
    console.error(`GET ${url} answered ${response.status} without a readable body`)
    throw new ApiError(502, 'script_unreadable', "The QuestRush script didn't answer as expected. Check that it is deployed as a web app anyone can open.")
  }
  if (body.error !== undefined) {
    throw new ApiError(body.error.status ?? 500, body.error.code ?? 'script_error', body.error.message ?? GENERIC_ERROR_MESSAGE)
  }
  return body.data as T
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

// Saves are plain writes: nothing is read first, so updates and deletes use the row numbers this browser keeps in step.
// RAW keeps every cell as typed text: "=1+1" is never a formula and "007" keeps its zeros. OVERWRITE fills the rows
// after the table without shifting rows below.
export async function pushWrite(connection: SheetConnection, item: PendingWrite): Promise<WriteOutcome> {
  const { spreadsheetId: id, token } = connection
  const { write } = item
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
  const rowNumber = write.row.rowNumber
  if (rowNumber === null) {
    throw new ApiError(500, 'sheet_error', 'This row was never saved to the sheet.')
  }
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
