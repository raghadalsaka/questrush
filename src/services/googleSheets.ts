import { columnLabel } from '../utils/roster'
import { ApiError } from './apiError'
import { cellsOf, emptyDb, rowFrom, TABLES, type SheetDb, type SheetRow, type TableName } from './sheetRules'
import { decideRow, findRow, rowKey, type PendingWrite } from './sheetSync'

const SHEETS_API: string = 'https://sheets.googleapis.com/v4/spreadsheets'
const TABLE_NAMES: readonly TableName[] = Object.keys(TABLES) as TableName[]

export interface SheetConnection {
  spreadsheetId: string
  token: () => string
  sheetIds: Map<TableName, number>
}

export interface LoadedSheet {
  db: SheetDb
  sheetIds: Map<TableName, number>
}

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
    throw new ApiError(0, 'network', "Can't reach Google Sheets. Check the connection; your changes are kept in this browser.")
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

// Each push re-reads its tab and finds rows by key, because rows deleted elsewhere move every row number below them.
// RAW keeps every cell as typed text: "=1+1" is never a formula and "007" keeps its zeros. OVERWRITE fills the rows
// after the table without shifting rows below. Resolves to the number of rows dropped because the sheet changed first.
export async function pushWrite(connection: SheetConnection, item: PendingWrite): Promise<number> {
  const { spreadsheetId: id, token } = connection
  const { write } = item
  const table = write.table
  const current = await readTab(connection, table)
  if (write.kind === 'append') {
    const decisions = write.rows.map((row) => decideRow(current, table, 'append', row, null))
    const rows = write.rows.filter((_, index) => decisions[index] === 'push')
    if (rows.length > 0) {
      await call(token(), 'POST', `${SHEETS_API}/${id}/values/${encodeURIComponent(`${table}!A1`)}:append?valueInputOption=RAW&insertDataOption=OVERWRITE`, {
        values: rows.map((row) => cellsOf(table, row)),
      })
    }
    return decisions.filter((decision) => decision === 'drop').length
  }
  const decision = decideRow(current, table, write.kind, write.row, item.before)
  if (decision !== 'push') {
    return decision === 'drop' ? 1 : 0
  }
  const rowNumber = (findRow(current, table, rowKey(table, write.row)) as SheetRow).rowNumber as number
  if (write.kind === 'update') {
    await call(token(), 'PUT', `${SHEETS_API}/${id}/values/${encodeURIComponent(rangeOf(table, rowNumber))}?valueInputOption=RAW`, {
      values: [cellsOf(table, write.row)],
    })
    return 0
  }
  const sheetId = connection.sheetIds.get(table)
  if (sheetId === undefined) {
    throw new ApiError(500, 'sheet_error', `The "${table}" tab is missing.`)
  }
  await call(token(), 'POST', `${SHEETS_API}/${id}:batchUpdate`, {
    requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowNumber - 1, endIndex: rowNumber } } }],
  })
  return 0
}

async function readTab(connection: SheetConnection, table: TableName): Promise<SheetRow[]> {
  const data = await call<{ values?: unknown[][] }>(connection.token(), 'GET', `${SHEETS_API}/${connection.spreadsheetId}/values/${encodeURIComponent(rangeOf(table))}`)
  return (data.values ?? []).slice(1).map((cells, offset) => rowFrom(table, offset + 2, cells))
}
