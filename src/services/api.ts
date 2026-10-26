import type {
  ClassroomDetail,
  ClassroomSummary,
  NewStudent,
  Outcome,
  PublicClassroom,
  RosterGrid,
  SignedIn,
} from '../types/api'
import { ApiError, GENERIC_ERROR_MESSAGE, networkError } from './apiError'
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

const API_BASE: string = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

// The Go API's CSRF token lives only in memory here: set by sign-in, cleared when the session ends.
let csrfToken = ''
let onSignedOut: () => void = () => {}

// useAuth registers this, so any teacher call that finds the session gone returns to the sign-in screen.
export function setSignedOutHandler(handler: () => void): void {
  onSignedOut = handler
  setGoogleSignedOutHandler(handler)
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (body instanceof FormData) {
    payload = body
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken
  }
  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, { method, headers, body: payload, credentials: 'include', cache: 'no-store' })
  } catch (error) {
    console.error(`${method} ${path} failed`, error)
    throw networkError(error)
  }
  if (response.status === 204) {
    return undefined as T
  }
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const problem = (data as { error?: { code?: string; message?: string } } | null)?.error
    if (response.status === 401 && !path.startsWith('/api/public/') && path !== '/api/auth/login') {
      csrfToken = ''
      onSignedOut()
    }
    throw new ApiError(response.status, problem?.code ?? 'http_error', problem?.message ?? GENERIC_ERROR_MESSAGE)
  }
  return data as T
}

function segment(value: string): string {
  return encodeURIComponent(value)
}

const httpApi = {
  login: async (pin: string): Promise<void> => {
    csrfToken = (await request<SignedIn>('POST', '/api/auth/login', { pin })).csrfToken
  },
  logout: async (): Promise<void> => {
    try {
      await request<void>('POST', '/api/auth/logout')
    } finally {
      csrfToken = ''
    }
  },
  me: async (): Promise<void> => {
    csrfToken = (await request<SignedIn>('GET', '/api/auth/me')).csrfToken
  },

  listClassrooms: () => request<ClassroomSummary[]>('GET', '/api/classrooms'),
  createClassroom: (name: string, students: NewStudent[]) => request<ClassroomDetail>('POST', '/api/classrooms', { name, students }),
  getClassroom: (id: string) => request<ClassroomDetail>('GET', `/api/classrooms/${segment(id)}`),
  previewRoster: (file: File) => {
    const form = new FormData()
    form.append('file', file)
    return request<RosterGrid>('POST', '/api/roster/preview', form)
  },

  updateStudent: (id: string, student: NewStudent) => request<ClassroomDetail>('PUT', `/api/students/${segment(id)}`, student),
  deleteStudent: (id: string) => request<ClassroomDetail>('DELETE', `/api/students/${segment(id)}`),
  setPhoto: (id: string, file: File) => {
    const form = new FormData()
    form.append('photo', file)
    return request<ClassroomDetail>('PUT', `/api/students/${segment(id)}/photo`, form)
  },
  removePhoto: (id: string) => request<ClassroomDetail>('DELETE', `/api/students/${segment(id)}/photo`),

  setCurrentStage: (classroomSlug: string, currentStageSlug: string | null) =>
    request<ClassroomDetail>('PUT', `/api/classrooms/${segment(classroomSlug)}/progress`, { currentStageSlug }),
  openSession: (classroomSlug: string, stageSlug: string) =>
    request<ClassroomDetail>('POST', `/api/classrooms/${segment(classroomSlug)}/sessions`, { stageSlug }),

  closeSession: (id: string) => request<ClassroomDetail>('POST', `/api/sessions/${segment(id)}/close`),
  setAbsent: (sessionId: string, studentId: string, absent: boolean) =>
    request<ClassroomDetail>('PUT', `/api/sessions/${segment(sessionId)}/absences/${segment(studentId)}`, { absent }),
  recordResult: (sessionId: string, studentId: string, questionId: string, outcome: Outcome) =>
    request<ClassroomDetail>('POST', `/api/sessions/${segment(sessionId)}/results`, { studentId, questionId, outcome }),

  getPublicClassroom: (classroomSlug: string) => request<PublicClassroom>('GET', `/api/public/${segment(classroomSlug)}`),
}

export type Api = typeof httpApi

export const api: Api = usesGoogleSheet() ? googleSheetApi : httpApi

// The teacher signs in with the Google account that can edit the sheet instead of a PIN.
export const googleSignIn: boolean = usesGoogleSheet()

// The Google Sheet backend stores no files, so pawns are emoji only there.
export const photosEnabled: boolean = !usesGoogleSheet()

export function photoUrl(classroomSlug: string, photoFile: string): string {
  return `${API_BASE}/api/public/${segment(classroomSlug)}/photos/${segment(photoFile)}`
}

export function publicLink(classroomSlug: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}#/p/${segment(classroomSlug)}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return error.message
  }
  console.error(error)
  return GENERIC_ERROR_MESSAGE
}
