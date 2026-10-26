export type Outcome = 'correct' | 'incorrect'

export interface Student {
  id: string
  name: string
  emoji: string
  photoFile: string | null
  position: number
  points: number
}

export interface Result {
  studentId: string
  stageSlug: string
  outcome: Outcome
}

export interface ClassSession {
  id: string
  stageSlug: string
  openedAt: string
  absentStudentIds: string[]
}

export interface ClassroomSummary {
  slug: string
  name: string
  studentCount: number
  createdAt: string
}

// Where the class stands on the map; null until the class starts its first stage.
export interface ClassroomProgress {
  currentStageSlug: string | null
}

export interface ClassroomDetail {
  slug: string
  name: string
  progress: ClassroomProgress
  students: Student[]
  results: Result[]
  // Stage slug to the question ids already answered there.
  usedQuestionIds: Record<string, string[]>
  session: ClassSession | null
}

export interface PublicClassroom {
  name: string
  currentStageSlug: string | null
  students: Student[]
  results: Result[]
}

export interface RosterGrid {
  rows: string[][]
  truncated: boolean
  sheetName: string
}

export interface NewStudent {
  name: string
  emoji: string
}

export interface SignedIn {
  csrfToken: string
}
