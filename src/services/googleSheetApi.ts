import { SHEET_FOCUS_SYNC_GAP_MS, SHEET_SYNC_INTERVAL_MS } from '../config'
import type { ClassroomDetail, PublicClassroom } from '../types/api'
import type { Api } from './api'
import { ApiError, GENERIC_ERROR_MESSAGE, networkError, notSignedIn } from './apiError'
import { indexedDbStore } from './browserStore'
import { currentToken, forgetToken, googleClientId, requestToken } from './googleAuth'
import { loadSheet, pushWrite, spreadsheetId, type LoadedSheet } from './googleSheets'
import { rulesApi } from './rulesApi'
import { createSaveQueue } from './saveQueue'
import type { Change, SheetDb, TableName } from './sheetRules'
import { cloneDb, pendingFrom, reconcile, type PendingWrite } from './sheetSync'
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
let syncing: Promise<void> | null = null
let pullAgain: boolean = false
let syncTimer: ReturnType<typeof setInterval> | null = null
let lastPull: number = 0
const reloadListeners: Set<() => void> = new Set()
const copies = indexedDbStore<SheetCopy>()
const holdTeacherTab = teacherTabLock(TEACHER_TAB_LOCK)

const queue = createSaveQueue({
  run: (item) => pushWrite({ spreadsheetId: spreadsheetId(), token: currentToken, sheetIds }, item),
  // Not awaited: the refusal can come from inside a sync, which then pulls once more when it finishes.
  onRefused: async (error) => {
    console.warn('sheet refused a change; reloading it', error.message)
    void sync()
  },
  onChange: () => void keepCopy(),
})

export const saveStatus = queue.status

export function usesGoogleSheet(): boolean {
  return googleClientId() !== '' && spreadsheetId() !== ''
}

export function setGoogleSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
}

// Lets an open classroom replace what it shows after a sync brought in the sheet's changes.
export function onSheetReloaded(listener: () => void): () => void {
  reloadListeners.add(listener)
  return () => reloadListeners.delete(listener)
}

// Call from the click on "Sign In Again"; the popup must open inside it.
export async function signInAgain(): Promise<void> {
  await requestToken()
  await sync()
}

export function retrySaving(): Promise<void> {
  return sync()
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

// Pulls the whole sheet, replays the changes it hasn't taken yet on top, then pushes the ones that still apply.
function sync(): Promise<void> {
  if (syncing !== null) {
    pullAgain = true
    return syncing
  }
  syncing = (async () => {
    do {
      pullAgain = false
      await pullAndPush()
    } while (pullAgain)
  })().finally(() => {
    syncing = null
  })
  return syncing
}

async function pullAndPush(): Promise<void> {
  if (db === null || currentToken() === '') {
    return
  }
  let sheet: LoadedSheet
  try {
    sheet = await loadSheet(spreadsheetId(), currentToken())
  } catch (error) {
    console.warn('reading the sheet failed; changes stay in this browser', error)
    queue.fail(error)
    return
  }
  adopt(sheet)
  await queue.resume()
}

// Synchronous from the read to the swap, so a change made while the sheet was loading is replayed too.
function adopt(sheet: LoadedSheet): void {
  lastPull = Date.now()
  sheetIds = sheet.sheetIds
  const previous = db === null ? '' : contentOf(db)
  const merged = reconcile(sheet.db, queue.pendingWrites())
  db = merged.projected
  queue.replace(merged.push, merged.dropped)
  if (merged.dropped > 0) {
    console.warn('changes dropped because the sheet changed', merged.dropped)
  }
  if (contentOf(db) !== previous) {
    reloadListeners.forEach((listener) => listener())
  }
}

// Row numbers differ between rows read from the sheet and rows made here, without the classroom being any different.
function contentOf(copy: SheetDb): string {
  return JSON.stringify(copy, (key, value: unknown) => (key === 'rowNumber' ? undefined : value))
}

function syncWhenSeen(): void {
  if (document.visibilityState === 'visible' && Date.now() - lastPull >= SHEET_FOCUS_SYNC_GAP_MS) {
    void sync()
  }
}

function onlineAgain(): void {
  void sync()
}

function warnBeforeLeaving(event: BeforeUnloadEvent): void {
  if (queue.pendingWrites().length > 0) {
    event.preventDefault()
  }
}

function startSyncing(): void {
  stopSyncing()
  syncTimer = setInterval(() => void sync(), SHEET_SYNC_INTERVAL_MS)
  window.addEventListener('online', onlineAgain)
  document.addEventListener('visibilitychange', syncWhenSeen)
  window.addEventListener('beforeunload', warnBeforeLeaving)
}

function stopSyncing(): void {
  if (syncTimer !== null) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  window.removeEventListener('online', onlineAgain)
  document.removeEventListener('visibilitychange', syncWhenSeen)
  window.removeEventListener('beforeunload', warnBeforeLeaving)
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

export const googleSheetApi: Api = {
  // requestToken comes first: the Google popup only opens inside the sign-in click.
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
    startSyncing()
    void queue.resume()
    console.info('sheet loaded', JSON.stringify({ classrooms: sheet.db.classrooms.length, students: sheet.db.students.length, turns: sheet.db.turns.length, unsaved: queue.pendingWrites().length }))
  },
  // Saves what it can first; the copy kept in this browser is cleared only when nothing is left unsaved.
  logout: async () => {
    stopSyncing()
    if (currentToken() !== '') {
      await sync()
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
