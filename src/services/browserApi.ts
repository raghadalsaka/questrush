import type { ClassroomDetail, NewStudent, Outcome } from '../types/api'
import type { Api } from './api'
import { ApiError } from './apiError'
import type { BrowserStore } from './browserStore'
import { previewRosterFile } from './rosterFile'
import * as rules from './sheetRules'
import type { Change, SheetDb } from './sheetRules'

const LOCAL_COPY_KEY: string = 'local'
const TEACHER_TAB_LOCK: string = 'questrush-teacher-local'

// Classrooms kept only in this browser: no sign-in, every change saved to IndexedDB before it is shown.
export function createBrowserApi(store: BrowserStore, locks: LockManager | undefined = globalThis.navigator?.locks): Api {
  let db: Promise<SheetDb> | null = null
  let tabHeld: Promise<boolean> | null = null

  function loaded(): Promise<SheetDb> {
    db ??= store.load(LOCAL_COPY_KEY).then(
      (stored) => stored ?? rules.emptyDb(),
      (error: unknown) => {
        db = null
        console.error('reading the browser copy failed', error)
        throw storageError()
      },
    )
    return db
  }

  // Two teacher tabs would each keep their own copy and overwrite each other's saves.
  async function holdTeacherTab(): Promise<void> {
    if (locks === undefined) {
      return
    }
    tabHeld ??= new Promise<boolean>((resolve) => {
      void locks.request(TEACHER_TAB_LOCK, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock === null ? undefined : new Promise<void>(() => {})
      })
    })
    if (!(await tabHeld)) {
      tabHeld = null
      throw new ApiError(409, 'open_in_another_tab', 'QuestRush is already open for teaching in another tab of this browser. Close that tab, then try again.')
    }
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

  return {
    login: async () => {
      await holdTeacherTab()
      await loaded()
    },
    logout: async () => {},
    me: async () => {
      await holdTeacherTab()
      await loaded()
    },

    listClassrooms: async () => rules.listClassrooms(await loaded()),
    createClassroom: (name: string, students: NewStudent[]) => change((current) => rules.createClassroom(current, rules.systemClock, name, students)),
    getClassroom: async (id: string) => rules.getClassroom(await loaded(), id),
    previewRoster: previewRosterFile,

    updateStudent: (id: string, student: NewStudent) => change((current) => rules.updateStudent(current, id, student)),
    deleteStudent: (id: string) => change((current) => rules.deleteStudent(current, id)),

    setCurrentStage: (classroomSlug: string, currentStageSlug: string | null) => change((current) => rules.setCurrentStage(current, classroomSlug, currentStageSlug)),
    openSession: (classroomSlug: string, stageSlug: string) => change((current) => rules.openSession(current, rules.systemClock, classroomSlug, stageSlug)),

    closeSession: (id: string) => change((current) => rules.closeSession(current, rules.systemClock, id)),
    setAbsent: (sessionId: string, studentId: string, absent: boolean) => change((current) => rules.setAbsent(current, rules.systemClock, sessionId, studentId, absent)),
    recordResult: (sessionId: string, studentId: string, questionId: string, outcome: Outcome) =>
      change((current) => rules.recordResult(current, rules.systemClock, sessionId, studentId, questionId, outcome)),

    // The student link opened in this browser reads the copy fresh, since the teacher tab may have saved since.
    getPublicClassroom: async (classroomSlug: string) => {
      let stored: SheetDb | null
      try {
        stored = await store.load(LOCAL_COPY_KEY)
      } catch (error) {
        console.error('reading the browser copy failed', error)
        throw storageError()
      }
      return rules.getPublicClassroom(stored ?? rules.emptyDb(), classroomSlug)
    },
  }
}

function storageError(): ApiError {
  return new ApiError(500, 'browser_storage_failed', "This browser couldn't read or save QuestRush's classrooms. Check that site storage is allowed (not a private window), then try again.")
}
