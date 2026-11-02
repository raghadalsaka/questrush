import { describe, expect, it } from 'vitest'
import { emptyDb, type AbsenceRow, type ClassroomRow, type SessionRow, type SheetDb, type SheetRow, type StudentRow, type TableName, type TurnRow } from '../../src/services/sheetRules'
import { pendingFrom, reconcile, type PendingWrite } from '../../src/services/sheetSync'

const AMIRA: string = '00000000-0000-4000-8000-000000000001'
const BEN: string = '00000000-0000-4000-8000-000000000002'

function classroom(slug: string, name: string = 'Year 3'): ClassroomRow {
  return { rowNumber: null, slug, name, current_stage_slug: '', created_at: 't' }
}

function student(id: string, name: string, classroomSlug: string = 'year-3'): StudentRow {
  return { rowNumber: null, id, classroom_slug: classroomSlug, name, emoji: '🦊', position: '1', created_at: 't' }
}

function session(id: string, closedAt: string = ''): SessionRow {
  return { rowNumber: null, id, classroom_slug: 'year-3', stage_slug: 'stage-1', opened_at: 't', closed_at: closedAt }
}

function turn(studentId: string, questionId: string, sessionId: string = 'session-1'): TurnRow {
  return { rowNumber: null, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: sessionId, student_id: studentId, question_id: questionId, status: 'correct', created_at: 't' }
}

function sheet(): SheetDb {
  const db = emptyDb()
  db.classrooms.push(classroom('year-3'))
  db.students.push(student(AMIRA, 'Amira'), student(BEN, 'Ben'))
  db.sessions.push(session('session-1'))
  return db
}

function append(table: TableName, ...rows: SheetRow[]): PendingWrite {
  return { write: { kind: 'append', table, rows }, before: null }
}

describe('reconcile', () => {
  it('replays unsaved changes on top of the sheet, in order, including a change built on an earlier one', () => {
    const renamed = { ...student(AMIRA, 'Amira H') }
    const again = { ...student(AMIRA, 'Amira Haddad') }
    const pending: PendingWrite[] = [
      append('turns', turn(AMIRA, 'q1')),
      { write: { kind: 'update', table: 'students', row: renamed }, before: student(AMIRA, 'Amira') },
      { write: { kind: 'update', table: 'students', row: again }, before: renamed },
    ]

    const merged = reconcile(sheet(), pending)

    expect(merged.push).toHaveLength(3)
    expect(merged.dropped).toBe(0)
    expect(merged.projected.turns.map((row) => row.question_id)).toEqual(['q1'])
    expect(merged.projected.students.find((row) => row.id === AMIRA)?.name).toBe('Amira Haddad')
  })

  it('lets the sheet win when it changed the same row first, and counts the dropped change', () => {
    const db = sheet()
    ;(db.students[0] as StudentRow).name = 'Amira (edited on the sheet)'
    const pending: PendingWrite[] = [
      { write: { kind: 'update', table: 'students', row: student(AMIRA, 'Amira H') }, before: student(AMIRA, 'Amira') },
      { write: { kind: 'delete', table: 'students', row: student(BEN, 'Ben') }, before: student(BEN, 'Ben') },
    ]

    const merged = reconcile(db, pending)

    expect(merged.dropped).toBe(1)
    expect(merged.push.map((item) => item.write.kind)).toEqual(['delete'])
    expect(merged.projected.students.map((row) => row.name)).toEqual(['Amira (edited on the sheet)'])
  })

  it('treats changes the sheet already has as done, so a push repeated after a lost answer is harmless', () => {
    const db = sheet()
    db.turns.push(turn(AMIRA, 'q1'))
    const pending: PendingWrite[] = [append('turns', turn(AMIRA, 'q1'))]

    expect(reconcile(db, pending)).toMatchObject({ push: [], dropped: 0 })
  })

  it('drops a result when the student already has one on that stage or its question was used, keeping one result per student', () => {
    const db = sheet()
    db.turns.push(turn(BEN, 'q2'))
    const pending: PendingWrite[] = [append('turns', turn(BEN, 'q7')), append('turns', turn(AMIRA, 'q2'))]

    const merged = reconcile(db, pending)

    expect(merged.dropped).toBe(2)
    expect(merged.projected.turns).toHaveLength(1)
  })

  it('drops a session opened offline when the sheet already has another one open, and everything recorded in it', () => {
    const absence: AbsenceRow = { rowNumber: null, session_id: 'session-2', student_id: BEN, created_at: 't' }
    const pending: PendingWrite[] = [append('sessions', session('session-2')), append('turns', turn(AMIRA, 'q1', 'session-2')), append('absences', absence)]

    const merged = reconcile(sheet(), pending)

    expect(merged.dropped).toBe(3)
    expect(merged.push).toEqual([])
  })

  it("keeps a student's history: a removal is dropped when the sheet already has a result for them", () => {
    const db = sheet()
    db.turns.push(turn(BEN, 'q1'))

    const merged = reconcile(db, [{ write: { kind: 'delete', table: 'students', row: student(BEN, 'Ben') }, before: student(BEN, 'Ben') }])

    expect(merged.dropped).toBe(1)
    expect(merged.projected.students).toHaveLength(2)
  })

  it('saves a classroom made offline under a free slug when its slug was taken on the sheet meanwhile', () => {
    const pending: PendingWrite[] = [append('classrooms', classroom('year-3', 'Year 3 (offline)')), append('students', student('00000000-0000-4000-8000-000000000003', 'Cleo'))]

    const merged = reconcile(sheet(), pending)

    expect(merged.dropped).toBe(0)
    expect(merged.projected.classrooms.map((row) => row.slug)).toEqual(['year-3', 'year-3-2'])
    expect(merged.projected.students.find((row) => row.name === 'Cleo')?.classroom_slug).toBe('year-3-2')
  })

  it('never changes the pending changes it was given', () => {
    const pending: PendingWrite[] = [append('classrooms', classroom('year-3', 'Other'))]

    reconcile(sheet(), pending)

    expect((pending[0]?.write as { rows: ClassroomRow[] }).rows[0]?.slug).toBe('year-3')
  })
})

describe('pendingFrom', () => {
  it('keeps detached copies of each row and the row as it was before', () => {
    const before = sheet()
    const live = student(AMIRA, 'Amira H')

    const [item] = pendingFrom([{ kind: 'update', table: 'students', row: live }], before)
    live.name = 'changed later'

    expect(item?.write).toMatchObject({ kind: 'update', row: { name: 'Amira H' } })
    expect(item?.before).toMatchObject({ name: 'Amira' })
  })
})
