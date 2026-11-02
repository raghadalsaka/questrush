import { SIGN_OUT_SAVE_WAIT_MS } from '../config'
import type { ClassroomDetail, PublicClassroom } from '../types/api'
import type { Api } from './api'
import { ApiError, GENERIC_ERROR_MESSAGE, networkError, notSignedIn } from './apiError'
import { indexedDbStore } from './browserStore'
import { currentToken, forgetToken, googleClientId, requestToken } from './googleAuth'
import { loadSheet, pushWrite, scriptUrl, spreadsheetId, type LoadedSheet, type WriteOutcome } from './googleSheets'
import { rulesApi } from './rulesApi'
import { createSaveQueue } from './saveQueue'
import type { Change, SheetDb, SheetRow, TableName } from './sheetRules'
import { cloneDb, pendingFrom, reconcile, rowKey, rowsOf, type PendingWrite } from './sheetSync'
import { teacherTabLock } from './teacherTabLock'

// What this browser keeps for one sheet: the last merged copy and the changes the sheet hasn't taken yet.
export interface SheetCopy {
  db: SheetDb
  pending: PendingWrite[]
}

const TEACHER_TAB_LOCK: string = 'questrush-teacher-sheet'

let db: SheetDb | null = null
let sheetIds: Map<TableName, number> = new Map()
let onSignedOut: () => void = () => {}
const reloadListeners: Set<() => void> = new Set()
const copies = indexedDbStore<SheetCopy>()
const holdTeacherTab = teacherTabLock(TEACHER_TAB_LOCK)

const queue = createSaveQueue({
  run: async (item) => {
    keepRowNumbers(item, await pushWrite({ spreadsheetId: spreadsheetId(), token: currentToken, sheetIds }, item))
  },
  // The one read outside sign-in: what Google refused must disappear from the screen, so the sheet is read again.
  onRefused: async (error) => {
    console.warn('sheet refused a change; reloading it', error.message)
    try {
      adopt(await loadSheet(spreadsheetId(), currentToken()))
    } catch (reloadError) {
      console.warn('reloading the sheet failed', reloadError)
    }
  },
  onChange: () => void keepCopy(),
})

export const saveStatus = queue.status

// Reads go through the script and writes through the teacher's Google sign-in, so all three are needed.
export function usesGoogleSheet(): boolean {
  return googleClientId() !== '' && spreadsheetId() !== '' && scriptUrl() !== ''
}

export function setGoogleSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

// Lets an open classroom replace what it shows after the sheet was read again.
export function onSheetReloaded(listener: () => void): () => void {
  reloadListeners.add(listener)
  return () => reloadListeners.delete(listener)
}

// Call from the click on "Sign In Again"; the popup must open inside it.
export async function signInAgain(): Promise<void> {
  await requestToken()
  await queue.resume()
}

export function retrySaving(): Promise<void> {
  return queue.resume()
}

export function dismissSaveMessage(): void {
  queue.dismiss()
}

function copyKey(): string {
  return `sheet:${spreadsheetId()}`
}

// Storage failing must not stop teaching: the changes still go to the sheet, they just wouldn't survive a refresh.
async function keepCopy(): Promise<void> {
  if (db === null) {
    return
  }
  try {
    await copies.save(copyKey(), { db, pending: [...queue.pendingWrites()] })
  } catch (error) {
    console.warn('keeping the sheet copy in this browser failed', error)
  }
}

async function storedCopy(): Promise<SheetCopy | null> {
  try {
    return await copies.load(copyKey())
  } catch (error) {
    console.warn('reading the sheet copy kept in this browser failed', error)
    return null
  }
}

// Synchronous from the read to the swap, so a change made while the sheet was loading is replayed too.
function adopt(sheet: LoadedSheet): void {
  sheetIds = sheet.sheetIds
  const previous = db === null ? '' : contentOf(db)
  const merged = reconcile(sheet.db, queue.pendingWrites())
  db = merged.projected
  queue.replace(merged.push, merged.dropped)
  if (merged.dropped > 0) {
    console.warn('changes dropped because the sheet changed', merged.dropped)
  }
  if (previous === '' || contentOf(db) !== previous) {
    reloadListeners.forEach((listener) => listener())
  }
}

// Row numbers differ between rows read from the sheet and rows made here, without the classroom being any different.
function contentOf(copy: SheetDb): string {
  return JSON.stringify(copy, (key, value: unknown) => (key === 'rowNumber' ? undefined : value))
}

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  if (queue.pendingWrites().length > 0) {
    event.preventDefault()
  }
}

// Saves don't read the sheet first, so the row numbers held here, in the copy and in the waiting changes, follow each write.
function keepRowNumbers(item: PendingWrite, outcome: WriteOutcome): void {
  const { write } = item
  const rows = trackedRows(write.table)
  if (write.kind === 'append' && outcome.kind === 'appended') {
    const rowsByKey = new Map<string, SheetRow[]>()
    for (const row of rows) {
      const key = rowKey(write.table, row)
      rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), row])
    }
    write.rows.forEach((appended, index) => {
      for (const row of rowsByKey.get(rowKey(write.table, appended)) ?? []) {
        row.rowNumber = outcome.firstRow + index
      }
    })
    return
  }
  if (write.kind !== 'delete' || outcome.kind !== 'deleted') {
    return
  }
  const key = rowKey(write.table, write.row)
  for (const row of rows) {
    if (rowKey(write.table, row) === key) {
      row.rowNumber = null
    } else if (row.rowNumber !== null && row.rowNumber > outcome.rowNumber) {
      row.rowNumber--
    }
  }
}

function trackedRows(table: TableName): SheetRow[] {
  const rows: SheetRow[] = db === null ? [] : [...(db[table] as SheetRow[])]
  for (const pending of queue.pendingWrites()) {
    if (pending.write.table === table) {
      rows.push(...rowsOf(pending))
    }
  }
  return rows
}

function loaded(): SheetDb {
  if (db === null) {
    onSignedOut()
    throw notSignedIn()
  }
  return db
}

// Shown and kept in this browser at once; the sheet gets it in the background.
async function change(apply: (current: SheetDb) => Change): Promise<ClassroomDetail> {
  const current = loaded()
  const before = cloneDb(current)
  const result = apply(current)
  queue.enqueue(pendingFrom(result.writes, before))
  return result.detail
}

// The student link has no Google sign-in, so it reads through the read-only Apps Script.
async function readPublicClassroom(classroomSlug: string): Promise<PublicClassroom> {
  let response: Response
  try {
    response = await fetch(`${scriptUrl()}?action=public&slug=${encodeURIComponent(classroomSlug)}`, { cache: 'no-store', redirect: 'follow' })
  } catch (error) {
    console.error('public classroom failed', error)
    throw networkError(error)
  }
  const body = (await response.json().catch(() => null)) as { data?: PublicClassroom; error?: { status?: number; code?: string; message?: string } } | null
  if (!response.ok || body === null || typeof body !== 'object') {
    console.error('public classroom returned an unreadable response', response.status)
    throw new ApiError(response.status, 'http_error', GENERIC_ERROR_MESSAGE)
  }
  if (body.error !== undefined) {
    throw new ApiError(body.error.status ?? 500, body.error.code ?? 'http_error', body.error.message ?? GENERIC_ERROR_MESSAGE)
  }
  return body.data as PublicClassroom
}

export const googleSheetApi: Api = {
  // The sheet is read once here, through the script; requestToken comes first because the popup only opens inside the click.
  login: async () => {
    const token = await requestToken()
    await holdTeacherTab()
    const kept = await storedCopy()
    queue.clear()
    queue.replace(kept?.pending ?? [], 0)
    let sheet: LoadedSheet
    try {
      sheet = await loadSheet(spreadsheetId(), token)
    } catch (error) {
      queue.clear()
      throw error
    }
    db = kept?.db ?? null
    adopt(sheet)
    await keepCopy()
    window.addEventListener('beforeunload', warnBeforeLeaving)
    void queue.resume()
    console.info('sheet loaded', JSON.stringify({ classrooms: sheet.db.classrooms.length, students: sheet.db.students.length, turns: sheet.db.turns.length, unsaved: queue.pendingWrites().length }))
  },
  // Saves what it can in a few seconds; the copy kept in this browser is cleared only when nothing is left unsaved.
  logout: async () => {
    window.removeEventListener('beforeunload', warnBeforeLeaving)
    if (currentToken() !== '') {
      await Promise.race([queue.resume(), new Promise<void>((resolve) => setTimeout(resolve, SIGN_OUT_SAVE_WAIT_MS))])
    }
    const unsaved = queue.pendingWrites().length
    if (unsaved > 0) {
      console.warn('signed out with unsaved changes; they stay in this browser until the next sign-in', unsaved)
    } else if (db !== null) {
      await copies.remove(copyKey()).catch((error: unknown) => console.warn('clearing the sheet copy failed', error))
    }
    db = null
    queue.clear()
    forgetToken()
  },
  me: async () => {
    if (db === null || currentToken() === '') {
      throw notSignedIn()
    }
  },

  ...rulesApi(loaded, change),

  getPublicClassroom: readPublicClassroom,
}
