import type { ClassroomDetail, ClassroomSummary, NewStudent, Outcome, PublicClassroom } from '../types/api'
import { routeHash } from '../utils/route'
import { ApiError, GENERIC_ERROR_MESSAGE } from './apiError'
import { createBrowserApi } from './browserApi'
import { indexedDbStore } from './browserStore'
import { preloadGoogleSignIn } from './googleAuth'
import {
  dismissSaveMessage,
  googleSheetApi,
  onSheetReloaded,
  retrySaving,
  saveStatus,
  setGoogleSignedOutHandler,
  signInAgain,
  usesGoogleSheet,
} from './googleSheetApi'

export { ApiError, dismissSaveMessage, onSheetReloaded, retrySaving, saveStatus, signInAgain }

export interface Api {
  login: () => Promise<void>
  logout: () => Promise<void>
  me: () => Promise<void>

  listClassrooms: () => Promise<ClassroomSummary[]>
  createClassroom: (name: string, students: NewStudent[]) => Promise<ClassroomDetail>
  getClassroom: (id: string) => Promise<ClassroomDetail>

  updateStudent: (id: string, student: NewStudent) => Promise<ClassroomDetail>
  deleteStudent: (id: string) => Promise<ClassroomDetail>

  setCurrentStage: (classroomSlug: string, currentStageSlug: string | null) => Promise<ClassroomDetail>
  openSession: (classroomSlug: string, stageSlug: string) => Promise<ClassroomDetail>

  closeSession: (id: string) => Promise<ClassroomDetail>
  setAbsent: (sessionId: string, studentId: string, absent: boolean) => Promise<ClassroomDetail>
  recordResult: (sessionId: string, studentId: string, questionId: string, outcome: Outcome) => Promise<ClassroomDetail>

  getPublicClassroom: (classroomSlug: string) => Promise<PublicClassroom>
}

// useAuth registers this, so any teacher call that finds the session gone returns to the sign-in screen.
export function setSignedOutHandler(handler: () => void): void {
  setGoogleSignedOutHandler(handler)
}

export const api: Api = usesGoogleSheet() ? googleSheetApi : createBrowserApi(indexedDbStore())

// The teacher signs in with the Google account that can edit the sheet; without a sheet there is no sign-in.
export const googleSignIn: boolean = usesGoogleSheet()

// Without the sheet, classrooms live in this browser only, so the student link opens nowhere else.
export const studentLinkThisDeviceOnly: boolean = !usesGoogleSheet()

export function preloadSignIn(): void {
  if (googleSignIn) {
    preloadGoogleSignIn().catch((error: unknown) => console.warn('Google sign-in did not preload', error))
  }
}

export function publicLink(classroomSlug: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${routeHash({ name: 'public', slug: classroomSlug })}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  console.error(error)
  return GENERIC_ERROR_MESSAGE
}
