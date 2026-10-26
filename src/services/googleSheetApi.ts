import { MAX_ROSTER_BYTES } from '../config'
import type { ClassroomDetail, NewStudent, Outcome, PublicClassroom } from '../types/api'
import { readRosterGrid } from '../utils/xlsx'
import type { Api } from './api'
import { ApiError, GENERIC_ERROR_MESSAGE, networkError, notSignedIn } from './apiError'
import { currentToken, forgetToken, googleClientId, requestToken } from './googleAuth'
import { loadSheet, spreadsheetId, writeToSheet, type LoadedSheet, type WriteOutcome } from './googleSheets'
import { createSaveQueue } from './saveQueue'
import * as rules from './sheetRules'
import type { Change, SheetDb, SheetRow, SheetWrite, TableName } from './sheetRules'

// The whole sheet is read once at sign-in; every screen then reads this copy, and changes are written in the background.
let db: SheetDb | null = null
let sheetIds: Map<TableName, number> = new Map()
let onSignedOut: () => void = () => {}
const reloadListeners: Set<() => void> = new Set()

const queue = createSaveQueue({
  run: async (write) => keepRowNumbers(write, await writeToSheet({ spreadsheetId: spreadsheetId(), token: currentToken, sheetIds }, write)),
  onRefused: async (error) => {
    console.warn('sheet refused a change; reloading it', error.message)
    await reload()
  },
})

export const saveStatus = queue.status

export function usesGoogleSheet(): boolean {
  return googleClientId() !== '' && spreadsheetId() !== ''
}

export function setGoogleSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

// Lets an open classroom replace what it shows after the sheet was reloaded.
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

// Rows the rules already removed from db can still wait in the queue, and their row numbers must shift too.
function trackedRows(table: TableName): SheetRow[] {
  const rows = new Set<SheetRow>(db === null ? [] : (db[table] as SheetRow[]))
  for (const write of queue.pendingWrites()) {
    if (write.table === table) {
      for (const row of write.kind === 'append' ? write.rows : [write.row]) {
        rows.add(row)
      }
    }
  }
  return [...rows]
}

function keepRowNumbers(write: SheetWrite, outcome: WriteOutcome): void {
  if (write.kind === 'append' && outcome.kind === 'appended') {
    write.rows.forEach((row, index) => {
      row.rowNumber = outcome.firstRow + index
    })
    return
  }
  if (write.kind !== 'delete' || outcome.kind !== 'deleted') {
    return
  }
  for (const row of trackedRows(write.table)) {
    if (row !== write.row && row.rowNumber !== null && row.rowNumber > outcome.rowNumber) {
      row.rowNumber--
    }
  }
  write.row.rowNumber = null
}

function adoptSheet(sheet: LoadedSheet): void {
  db = sheet.db
  sheetIds = sheet.sheetIds
}

async function reload(): Promise<void> {
  try {
    adoptSheet(await loadSheet(spreadsheetId(), currentToken()))
    reloadListeners.forEach((listener) => listener())
  } catch (error) {
    console.error('reloading the sheet failed', error)
  }
}

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  if (queue.pendingWrites().length > 0) {
    event.preventDefault()
  }
}

function loaded(): SheetDb {
  if (db === null) {
    onSignedOut()
    throw notSignedIn()
  }
  return db
}

async function change(apply: (current: SheetDb) => Change): Promise<ClassroomDetail> {
  const result = apply(loaded())
  queue.enqueue(result.writes)
  return result.detail
}

function scriptUrl(): string {
  return (import.meta.env.VITE_SHEET_API_URL ?? '').trim()
}

// The student link has no Google sign-in, so it reads through the read-only Apps Script.
async function readPublicClassroom(classroomSlug: string): Promise<PublicClassroom> {
  if (scriptUrl() === '') {
    throw new ApiError(404, 'classroom_not_found', "Classroom links aren't set up on this site yet.")
  }
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

function unavailablePhotos(): Promise<ClassroomDetail> {
  return Promise.reject(new ApiError(400, 'photos_unavailable', 'Photos are not available yet. Choose an emoji pawn instead.'))
}

export const googleSheetApi: Api = {
  login: async () => {
    const token = await requestToken()
    const sheet = await loadSheet(spreadsheetId(), token)
    adoptSheet(sheet)
    queue.clear()
    window.addEventListener('beforeunload', warnBeforeLeaving)
    console.info('sheet loaded', JSON.stringify({ classrooms: sheet.db.classrooms.length, students: sheet.db.students.length, turns: sheet.db.turns.length }))
  },
  logout: async () => {
    if (currentToken() !== '') {
      await queue.resume()
    }
    if (queue.pendingWrites().length > 0) {
      console.warn('signed out with unsaved changes', queue.pendingWrites().length)
    }
    queue.clear()
    db = null
    window.removeEventListener('beforeunload', warnBeforeLeaving)
    forgetToken()
  },
  me: async () => {
    if (db === null || currentToken() === '') {
      throw notSignedIn()
    }
  },

  listClassrooms: async () => rules.listClassrooms(loaded()),
  createClassroom: (name: string, students: NewStudent[]) => change((current) => rules.createClassroom(current, rules.systemClock, name, students)),
  getClassroom: async (id: string) => rules.getClassroom(loaded(), id),
  previewRoster: async (file: File) => {
    if (file.size > MAX_ROSTER_BYTES) {
      throw new ApiError(400, 'file_too_large', `The file is larger than ${MAX_ROSTER_BYTES / 1024} KB.`)
    }
    const result = await readRosterGrid(await file.arrayBuffer())
    if (!result.ok) {
      throw new ApiError(400, 'not_xlsx', result.message)
    }
    return result.grid
  },

  updateStudent: (id: string, student: NewStudent) => change((current) => rules.updateStudent(current, id, student)),
  deleteStudent: (id: string) => change((current) => rules.deleteStudent(current, id)),
  setPhoto: unavailablePhotos,
  removePhoto: unavailablePhotos,

  setCurrentStage: (classroomSlug: string, currentStageSlug: string | null) => change((current) => rules.setCurrentStage(current, classroomSlug, currentStageSlug)),
  openSession: (classroomSlug: string, stageSlug: string) => change((current) => rules.openSession(current, rules.systemClock, classroomSlug, stageSlug)),

  closeSession: (id: string) => change((current) => rules.closeSession(current, rules.systemClock, id)),
  setAbsent: (sessionId: string, studentId: string, absent: boolean) => change((current) => rules.setAbsent(current, rules.systemClock, sessionId, studentId, absent)),
  recordResult: (sessionId: string, studentId: string, questionId: string, outcome: Outcome) =>
    change((current) => rules.recordResult(current, rules.systemClock, sessionId, studentId, questionId, outcome)),

  getPublicClassroom: readPublicClassroom,
}
