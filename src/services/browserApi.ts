import type { ClassroomDetail } from '../types/api'
import type { Api } from './api'
import { ApiError } from './apiError'
import type { BrowserStore } from './browserStore'
import { rulesApi } from './rulesApi'
import * as rules from './sheetRules'
import type { Change, SheetDb } from './sheetRules'
import { teacherTabLock } from './teacherTabLock'

const LOCAL_COPY_KEY: string = 'local'
const TEACHER_TAB_LOCK: string = 'questrush-teacher-local'

// Classrooms kept only in this browser: no sign-in, every change saved to IndexedDB before it is shown.
export function createBrowserApi(store: BrowserStore<SheetDb>, locks?: LockManager): Api {
  let db: Promise<SheetDb> | null = null
  const holdTeacherTab = teacherTabLock(TEACHER_TAB_LOCK, locks)

  async function readCopy(): Promise<SheetDb> {
    let stored: SheetDb | null
    try {
      stored = await store.load(LOCAL_COPY_KEY)
    } catch (error) {
      console.error('reading the browser copy failed', error)
      throw storageError()
    }
    return stored ?? rules.emptyDb()
  }

  function loaded(): Promise<SheetDb> {
    db ??= readCopy().catch((error: unknown) => {
      db = null
      throw error
    })
    return db
  }

  async function change(apply: (current: SheetDb) => Change): Promise<ClassroomDetail> {
    const current = await loaded()
    const result = apply(current)
    if (result.writes.length === 0) {
      return result.detail
    }
    try {
      await store.save(LOCAL_COPY_KEY, current)
    } catch (error) {
      console.error('saving the browser copy failed', error)
      db = null
      throw storageError()
    }
    return result.detail
  }

  async function openTeacherCopy(): Promise<void> {
    await holdTeacherTab()
    await loaded()
  }

  return {
    login: openTeacherCopy,
    logout: async () => {},
    me: openTeacherCopy,

    ...rulesApi(loaded, change),

    // The student link opened in this browser reads the copy fresh, since the teacher tab may have saved since.
    getPublicClassroom: async (classroomSlug: string) => rules.getPublicClassroom(await readCopy(), classroomSlug),
  }
}

function storageError(): ApiError {
  return new ApiError(500, 'browser_storage_failed', "This browser couldn't read or save QuestRush's classrooms. Check that site storage is allowed (not a private window), then try again.")
}
