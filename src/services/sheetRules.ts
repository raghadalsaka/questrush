import { MAX_CLASSROOM_NAME_LENGTH, MAX_NAME_LENGTH, MAX_STUDENTS } from '../config'
import type { ClassroomDetail, ClassroomSummary, NewStudent, Outcome, Result, Student } from '../types/api'
import { isValidEmoji } from '../utils/roster'
import { ApiError } from './apiError'

// Same tabs and column order as apps-script/Code.js, which reads them for the student link.
export const TABLES = {
  classrooms: ['slug', 'name', 'current_stage_slug', 'created_at'],
  students: ['id', 'classroom_slug', 'name', 'emoji', 'position', 'created_at'],
  turns: ['classroom_slug', 'stage_slug', 'session_id', 'student_id', 'question_id', 'status', 'created_at'],
  sessions: ['id', 'classroom_slug', 'stage_slug', 'opened_at', 'closed_at'],
  absences: ['session_id', 'student_id', 'created_at'],
} as const

export type TableName = keyof typeof TABLES

export type ColumnOf<T extends TableName> = (typeof TABLES)[T][number]

// rowNumber is the row on the sheet, null until the row has been appended there.
export type RowOf<T extends TableName> = { rowNumber: number | null } & Record<ColumnOf<T>, string>

export type ClassroomRow = RowOf<'classrooms'>
export type StudentRow = RowOf<'students'>
export type TurnRow = RowOf<'turns'>
export type SessionRow = RowOf<'sessions'>
export type AbsenceRow = RowOf<'absences'>

export type SheetDb = { [T in TableName]: RowOf<T>[] }

export type SheetRow = { [T in TableName]: RowOf<T> }[TableName]


export type SheetWrite =
  | { kind: 'append'; table: TableName; rows: SheetRow[] }
  | { kind: 'update'; table: TableName; row: SheetRow }
  | { kind: 'delete'; table: TableName; row: SheetRow }

export interface Change {
  detail: ClassroomDetail
  writes: SheetWrite[]
}

export interface RuleClock {
  now: () => string
  newId: () => string
}

const MAX_CLASSROOM_SLUG_LENGTH: number = 90
const MAX_STAGE_SLUG_LENGTH: number = 80
const MAX_QUESTION_ID_LENGTH: number = 200

const UUID_PATTERN: RegExp = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const SLUG_PATTERN: RegExp = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const systemClock: RuleClock = { now: () => new Date().toISOString(), newId: () => crypto.randomUUID() }

export function emptyDb(): SheetDb {
  return { classrooms: [], students: [], turns: [], sessions: [], absences: [] }
}

// A row of one tab arrives typed as any tab's row, so its columns are read by name.
export function cellsOf(table: TableName, row: SheetRow): string[] {
  const record = row as Record<string, unknown>
  return TABLES[table].map((column) => String(record[column] ?? ''))
}

export function rowFrom(table: TableName, rowNumber: number, cells: readonly unknown[]): SheetRow {
  const row: Record<string, unknown> = { rowNumber }
  TABLES[table].forEach((column, index) => {
    const cell = cells[index]
    row[column] = cell === null || cell === undefined ? '' : String(cell)
  })
  return row as SheetRow
}

export function listClassrooms(db: SheetDb): ClassroomSummary[] {
  return db.classrooms
    .slice()
    .sort((a, b) => compareText(b.created_at, a.created_at))
    .map((classroom) => ({
      slug: classroom.slug,
      name: classroom.name,
      studentCount: db.students.filter((student) => student.classroom_slug === classroom.slug).length,
      createdAt: classroom.created_at,
    }))
}

export function getClassroom(db: SheetDb, classroomSlug: string): ClassroomDetail {
  requireClassroomSlug(classroomSlug)
  return classroomDetail(db, classroomSlug)
}

export function createClassroom(db: SheetDb, clock: RuleClock, rawName: string, rawStudents: readonly NewStudent[]): Change {
  const name = normalizeClassroomName(rawName)
  const students = normalizeStudents(rawStudents)
  const classroomSlug = freeClassroomSlug(db, name)
  const now = clock.now()
  const classroom: ClassroomRow = { rowNumber: null, slug: classroomSlug, name, current_stage_slug: '', created_at: now }
  const studentRows: StudentRow[] = students.map((student, index) => ({
    rowNumber: null,
    id: clock.newId(),
    classroom_slug: classroomSlug,
    name: student.name,
    emoji: student.emoji,
    position: String(index + 1),
    created_at: now,
  }))
  db.classrooms.push(classroom)
  db.students.push(...studentRows)
  const writes: SheetWrite[] = [{ kind: 'append', table: 'classrooms', rows: [classroom] }]
  if (studentRows.length > 0) {
    writes.push({ kind: 'append', table: 'students', rows: studentRows })
  }
  return { detail: classroomDetail(db, classroomSlug), writes }
}

export function updateStudent(db: SheetDb, studentId: string, update: NewStudent): Change {
  requireId(studentId, studentNotFound)
  const name = normalizeName(update.name)
  const emoji = normalizeEmoji(update.emoji)
  const student = findStudent(db, studentId)
  student.name = name
  student.emoji = emoji
  return { detail: classroomDetail(db, student.classroom_slug), writes: [{ kind: 'update', table: 'students', row: student }] }
}

// For import mistakes; a student with any official turn keeps their history and can't be deleted.
export function deleteStudent(db: SheetDb, studentId: string): Change {
  requireId(studentId, studentNotFound)
  const student = findStudent(db, studentId)
  if (db.turns.some((turn) => turn.student_id === studentId)) {
    throw new ApiError(409, 'student_has_results', "This student already has classroom results, so they can't be removed.")
  }
  const absences = db.absences.filter((absence) => absence.student_id === studentId)
  db.absences = db.absences.filter((absence) => absence.student_id !== studentId)
  db.students = db.students.filter((row) => row !== student)
  const writes: SheetWrite[] = absences.map((absence) => ({ kind: 'delete', table: 'absences', row: absence }))
  writes.push({ kind: 'delete', table: 'students', row: student })
  return { detail: classroomDetail(db, student.classroom_slug), writes }
}

// The browser decides when to move the class, because only the stage files know each stage's order.
export function setCurrentStage(db: SheetDb, classroomSlug: string, rawStageSlug: string | null): Change {
  requireClassroomSlug(classroomSlug)
  const stageSlug = rawStageSlug === null ? null : normalizeStageSlug(rawStageSlug)
  const classroom = findClassroom(db, classroomSlug)
  if (stageSlug !== null && stageFinished(db, classroomSlug, stageSlug)) {
    throw new ApiError(409, 'stage_finished', "Every student has played this stage, so it can't be made the current stage.")
  }
  classroom.current_stage_slug = stageSlug ?? ''
  return { detail: classroomDetail(db, classroomSlug), writes: [{ kind: 'update', table: 'classrooms', row: classroom }] }
}

// One session per classroom is open at a time. Reopening a stage is a new session, so absences start fresh while
// results and used questions carry over. A stage every student has played can't be opened again.
export function openSession(db: SheetDb, clock: RuleClock, classroomSlug: string, rawStageSlug: string): Change {
  requireClassroomSlug(classroomSlug)
  const stageSlug = normalizeStageSlug(rawStageSlug)
  findClassroom(db, classroomSlug)
  const open = openSessionRow(db, classroomSlug)
  if (open !== null) {
    if (open.stage_slug === stageSlug) {
      return { detail: classroomDetail(db, classroomSlug), writes: [] }
    }
    throw new ApiError(409, 'another_session_open', "Another stage's session is open. Close it first.")
  }
  if (stageFinished(db, classroomSlug, stageSlug)) {
    throw new ApiError(409, 'stage_finished', "Every student has played this stage, so it can't be opened again.")
  }
  const session: SessionRow = { rowNumber: null, id: clock.newId(), classroom_slug: classroomSlug, stage_slug: stageSlug, opened_at: clock.now(), closed_at: '' }
  db.sessions.push(session)
  return { detail: classroomDetail(db, classroomSlug), writes: [{ kind: 'append', table: 'sessions', rows: [session] }] }
}

export function closeSession(db: SheetDb, clock: RuleClock, sessionId: string): Change {
  requireId(sessionId, sessionNotFound)
  const session = findSession(db, sessionId)
  if (session.closed_at !== '') {
    return { detail: classroomDetail(db, session.classroom_slug), writes: [] }
  }
  session.closed_at = clock.now()
  return { detail: classroomDetail(db, session.classroom_slug), writes: [{ kind: 'update', table: 'sessions', row: session }] }
}

export function setAbsent(db: SheetDb, clock: RuleClock, sessionId: string, studentId: string, absent: boolean): Change {
  requireId(sessionId, sessionNotFound)
  requireId(studentId, studentNotFound)
  const session = findSession(db, sessionId)
  if (session.closed_at !== '') {
    throw new ApiError(409, 'session_closed', 'This session is closed.')
  }
  requireStudentInClassroom(db, session.classroom_slug, studentId)
  const existing = db.absences.find((absence) => absence.session_id === sessionId && absence.student_id === studentId)
  const writes: SheetWrite[] = []
  if (absent && existing === undefined) {
    const row: AbsenceRow = { rowNumber: null, session_id: sessionId, student_id: studentId, created_at: clock.now() }
    db.absences.push(row)
    writes.push({ kind: 'append', table: 'absences', rows: [row] })
  }
  if (!absent && existing !== undefined) {
    db.absences = db.absences.filter((row) => row !== existing)
    writes.push({ kind: 'delete', table: 'absences', row: existing })
  }
  return { detail: classroomDetail(db, session.classroom_slug), writes }
}

// The browser picked the student and question. Repeating the same answer is a no-op, and any other answer for a
// student who already has a result on this stage is refused.
export function recordResult(db: SheetDb, clock: RuleClock, sessionId: string, studentId: string, rawQuestionId: string, outcome: Outcome): Change {
  if (outcome !== 'correct' && outcome !== 'incorrect') {
    throw new ApiError(400, 'invalid_outcome', 'The outcome must be correct or incorrect.')
  }
  requireId(sessionId, sessionNotFound)
  requireId(studentId, studentNotFound)
  const questionId = normalizeQuestionId(rawQuestionId)
  const session = findSession(db, sessionId)
  const stageTurns = db.turns.filter((turn) => turn.classroom_slug === session.classroom_slug && turn.stage_slug === session.stage_slug)
  const recorded = stageTurns.find((turn) => turn.student_id === studentId)
  if (recorded !== undefined) {
    if (recorded.question_id === questionId && recorded.status === outcome) {
      return { detail: classroomDetail(db, session.classroom_slug), writes: [] }
    }
    throw new ApiError(409, 'student_already_assessed', 'This student already has a result for this stage, and results are final.')
  }
  if (session.closed_at !== '') {
    throw new ApiError(409, 'session_closed', "This session is closed, so it can't take official results.")
  }
  requireStudentInClassroom(db, session.classroom_slug, studentId)
  if (db.absences.some((absence) => absence.session_id === sessionId && absence.student_id === studentId)) {
    throw new ApiError(409, 'student_absent', 'This student is marked absent.')
  }
  if (stageTurns.some((turn) => turn.question_id === questionId)) {
    throw new ApiError(409, 'question_used', 'This question was already used in this stage.')
  }
  const turn: TurnRow = {
    rowNumber: null,
    classroom_slug: session.classroom_slug,
    stage_slug: session.stage_slug,
    session_id: sessionId,
    student_id: studentId,
    question_id: questionId,
    status: outcome,
    created_at: clock.now(),
  }
  db.turns.push(turn)
  return { detail: classroomDetail(db, session.classroom_slug), writes: [{ kind: 'append', table: 'turns', rows: [turn] }] }
}

function classroomDetail(db: SheetDb, classroomSlug: string): ClassroomDetail {
  const classroom = findClassroom(db, classroomSlug)
  const turns = db.turns
    .filter((turn) => turn.classroom_slug === classroomSlug)
    .sort((a, b) => compareText(a.stage_slug, b.stage_slug) || compareText(a.question_id, b.question_id))
  const points = new Map<string, number>()
  const usedQuestionIds: Record<string, string[]> = {}
  const results: Result[] = turns.map((turn) => {
    const used = (usedQuestionIds[turn.stage_slug] ??= [])
    used.push(turn.question_id)
    if (turn.status === 'correct') {
      points.set(turn.student_id, (points.get(turn.student_id) ?? 0) + 1)
    }
    return { studentId: turn.student_id, stageSlug: turn.stage_slug, outcome: turn.status as Outcome }
  })
  const students: Student[] = db.students
    .filter((student) => student.classroom_slug === classroomSlug)
    .sort((a, b) => Number(a.position) - Number(b.position) || compareText(a.created_at, b.created_at))
    .map((student) => ({
      id: student.id,
      name: student.name,
      emoji: student.emoji,
      photoFile: null,
      position: Number(student.position),
      points: points.get(student.id) ?? 0,
    }))
  const open = openSessionRow(db, classroomSlug)
  return {
    slug: classroom.slug,
    name: classroom.name,
    progress: { currentStageSlug: classroom.current_stage_slug === '' ? null : classroom.current_stage_slug },
    students,
    results,
    usedQuestionIds,
    session:
      open === null
        ? null
        : {
            id: open.id,
            stageSlug: open.stage_slug,
            openedAt: open.opened_at,
            absentStudentIds: db.absences.filter((absence) => absence.session_id === open.id).map((absence) => absence.student_id),
          },
  }
}

function stageFinished(db: SheetDb, classroomSlug: string, stageSlug: string): boolean {
  const students = db.students.filter((student) => student.classroom_slug === classroomSlug)
  const played = new Set(db.turns.filter((turn) => turn.classroom_slug === classroomSlug && turn.stage_slug === stageSlug).map((turn) => turn.student_id))
  return students.length > 0 && students.every((student) => played.has(student.id))
}

function openSessionRow(db: SheetDb, classroomSlug: string): SessionRow | null {
  return db.sessions.find((session) => session.classroom_slug === classroomSlug && session.closed_at === '') ?? null
}

function findClassroom(db: SheetDb, classroomSlug: string): ClassroomRow {
  const classroom = db.classrooms.find((row) => row.slug === classroomSlug)
  if (classroom === undefined) {
    throw classroomNotFound()
  }
  return classroom
}

function findStudent(db: SheetDb, studentId: string): StudentRow {
  const student = db.students.find((row) => row.id === studentId)
  if (student === undefined) {
    throw studentNotFound()
  }
  return student
}

function findSession(db: SheetDb, sessionId: string): SessionRow {
  const session = db.sessions.find((row) => row.id === sessionId)
  if (session === undefined) {
    throw sessionNotFound()
  }
  return session
}

function requireStudentInClassroom(db: SheetDb, classroomSlug: string, studentId: string): void {
  if (!db.students.some((student) => student.id === studentId && student.classroom_slug === classroomSlug)) {
    throw new ApiError(400, 'student_not_in_classroom', "This student isn't in this classroom.")
  }
}

// Keeps a-z and 0-9 from the name and adds -2, -3... when taken, the same rule as the Go API.
function freeClassroomSlug(db: SheetDb, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'classroom'
  const used = new Set(db.classrooms.map((classroom) => classroom.slug))
  let candidate = base
  for (let suffix = 2; used.has(candidate); suffix++) {
    candidate = `${base}-${suffix}`
  }
  return candidate
}

function classroomNotFound(): ApiError {
  return new ApiError(404, 'classroom_not_found', "This classroom doesn't exist.")
}

function studentNotFound(): ApiError {
  return new ApiError(404, 'student_not_found', "This student doesn't exist.")
}

function sessionNotFound(): ApiError {
  return new ApiError(404, 'session_not_found', "This classroom session doesn't exist.")
}

function requireId(id: string, notFound: () => ApiError): void {
  if (!UUID_PATTERN.test(id)) {
    throw notFound()
  }
}

// Classroom links are the slug itself, so anything that couldn't be one is simply not found.
function requireClassroomSlug(slug: string): void {
  if (slug.length > MAX_CLASSROOM_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw classroomNotFound()
  }
}

function normalizeStageSlug(raw: string): string {
  if (raw.length > MAX_STAGE_SLUG_LENGTH || !SLUG_PATTERN.test(raw)) {
    throw new ApiError(400, 'invalid_stage', "This stage isn't valid.")
  }
  return raw
}

function normalizeQuestionId(raw: string): string {
  const id = raw.trim()
  if (id === '' || id !== raw || [...id].length > MAX_QUESTION_ID_LENGTH || /\p{Cc}/u.test(id)) {
    throw new ApiError(400, 'invalid_question_id', 'The question id is not valid.')
  }
  return id
}

// The code keeps the Go API's spelling, which builds it from the field name.
function normalizeClassroomName(raw: string): string {
  const name = collapseSpaces(raw)
  const length = [...name].length
  if (length < 1 || length > MAX_CLASSROOM_NAME_LENGTH) {
    throw new ApiError(400, 'invalid_classroom name', `The classroom name must be 1 to ${MAX_CLASSROOM_NAME_LENGTH} characters.`)
  }
  if (/\p{Cc}/u.test(name)) {
    throw new ApiError(400, 'invalid_classroom name', "The classroom name can't contain control characters.")
  }
  return name
}

function normalizeStudents(students: readonly NewStudent[]): NewStudent[] {
  if (students.length > MAX_STUDENTS) {
    throw new ApiError(400, 'too_many_students', `A classroom can have at most ${MAX_STUDENTS} students.`)
  }
  return students.map((student, index) => {
    const name = withPrefix(`Student ${index + 1}: `, () => normalizeName(student.name))
    const emoji = withPrefix(`Student ${index + 1} (${name}): `, () => normalizeEmoji(student.emoji))
    return { name, emoji }
  })
}

function withPrefix<T>(prefix: string, work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (error instanceof ApiError) {
      throw new ApiError(error.status, error.code, prefix + error.message)
    }
    throw error
  }
}

// Same rules and messages as the Go API's roster.NormalizeName.
function normalizeName(raw: string): string {
  const name = collapseSpaces(raw)
  if (name === '') {
    throw new ApiError(400, 'invalid_name', "A student name can't be empty.")
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    throw new ApiError(400, 'invalid_name', `A student name can be at most ${MAX_NAME_LENGTH} characters.`)
  }
  if (/\p{Cc}/u.test(name)) {
    throw new ApiError(400, 'invalid_name', "A student name can't contain control characters.")
  }
  if (!/\p{L}/u.test(name)) {
    throw new ApiError(400, 'invalid_name', `${JSON.stringify(name)} doesn't look like a name; it has no letters.`)
  }
  return name
}

function normalizeEmoji(raw: string): string {
  if (!isValidEmoji(raw)) {
    throw new ApiError(400, 'invalid_emoji', 'Choose one emoji for the pawn.')
  }
  return raw.trim()
}

function collapseSpaces(raw: string): string {
  return raw
    .trim()
    .split(/\s+/u)
    .filter((part) => part !== '')
    .join(' ')
}

function compareText(a: string, b: string): number {
  if (a < b) {
    return -1
  }
  if (a > b) {
    return 1
  }
  return 0
}
