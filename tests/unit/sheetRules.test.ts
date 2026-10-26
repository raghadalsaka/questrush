import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from '../../src/services/apiError'
import * as rules from '../../src/services/sheetRules'
import type { RuleClock, SheetDb } from '../../src/services/sheetRules'
import type { ClassroomDetail } from '../../src/types/api'

function testClock(): RuleClock {
  let tick = 0
  let id = 0
  return {
    now: () => new Date(Date.UTC(2026, 9, 1, 8, 0, tick++)).toISOString(),
    newId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
  }
}

function refusal(work: () => unknown): { status: number; code: string } {
  try {
    work()
  } catch (error) {
    if (error instanceof ApiError) {
      return { status: error.status, code: error.code }
    }
    throw error
  }
  throw new Error('expected a refusal')
}

describe('sheet rules', () => {
  let db: SheetDb
  let clock: RuleClock

  function createClass(name: string, names: string[]): ClassroomDetail {
    return rules.createClassroom(db, clock, name, names.map((studentName) => ({ name: studentName, emoji: '🦊' }))).detail
  }

  beforeEach(() => {
    db = rules.emptyDb()
    clock = testClock()
  })

  it('creates classrooms with free slugs, lists the newest first, and appends their rows', () => {
    const first = rules.createClassroom(db, clock, 'Year 3: Explorers', [
      { name: 'Amira  Haddad', emoji: '🦊' },
      { name: 'Ben', emoji: '🐼' },
    ])
    const second = createClass('Year 3 Explorers', ['Chloe'])

    expect(first.detail.slug).toBe('year-3-explorers')
    expect(second.slug).toBe('year-3-explorers-2')
    expect(first.detail.students.map((student) => [student.name, student.position, student.points, student.photoFile])).toEqual([
      ['Amira Haddad', 1, 0, null],
      ['Ben', 2, 0, null],
    ])
    expect(first.writes.map((write) => [write.kind, write.table, write.kind === 'append' ? write.rows.length : 1])).toEqual([
      ['append', 'classrooms', 1],
      ['append', 'students', 2],
    ])
    expect(rules.listClassrooms(db).map((summary) => [summary.slug, summary.studentCount])).toEqual([
      ['year-3-explorers-2', 1],
      ['year-3-explorers', 2],
    ])
  })

  it('validates names and emoji with the Go API messages', () => {
    expect(refusal(() => createClass('Class', ['12345']))).toEqual({ status: 400, code: 'invalid_name' })
    expect(refusal(() => rules.createClassroom(db, clock, 'Class', [{ name: 'Amira', emoji: '' }]))).toEqual({ status: 400, code: 'invalid_emoji' })
    expect(refusal(() => createClass('   ', []))).toEqual({ status: 400, code: 'invalid_classroom name' })
    expect(db.classrooms).toHaveLength(0)
  })

  describe('official results', () => {
    let classroom: ClassroomDetail
    let sessionId: string
    let amira: string
    let ben: string

    beforeEach(() => {
      classroom = createClass('Results Class', ['Amira', 'Ben'])
      amira = classroom.students[0]?.id as string
      ben = classroom.students[1]?.id as string
      sessionId = rules.openSession(db, clock, classroom.slug, 'stage-1').detail.session?.id as string
    })

    it('records a result once, and repeating the same answer writes nothing', () => {
      const first = rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct')
      const repeat = rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct')

      expect(first.detail.students[0]?.points).toBe(1)
      expect(first.detail.usedQuestionIds).toEqual({ 'stage-1': ['q1'] })
      expect(first.writes).toHaveLength(1)
      expect(repeat.writes).toEqual([])
      expect(repeat.detail).toEqual(first.detail)
    })

    it('keeps results final and questions unused within a stage', () => {
      rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct')

      expect(refusal(() => rules.recordResult(db, clock, sessionId, amira, 'q2', 'incorrect'))).toEqual({ status: 409, code: 'student_already_assessed' })
      expect(refusal(() => rules.recordResult(db, clock, sessionId, ben, 'q1', 'correct'))).toEqual({ status: 409, code: 'question_used' })
      expect(db.turns).toHaveLength(1)
    })

    it('refuses absent students and closed sessions', () => {
      const absent = rules.setAbsent(db, clock, sessionId, ben, true)
      expect(absent.detail.session?.absentStudentIds).toEqual([ben])
      expect(refusal(() => rules.recordResult(db, clock, sessionId, ben, 'q1', 'correct'))).toEqual({ status: 409, code: 'student_absent' })

      const present = rules.setAbsent(db, clock, sessionId, ben, false)
      expect(present.writes.map((write) => write.kind)).toEqual(['delete'])

      rules.closeSession(db, clock, sessionId)
      expect(refusal(() => rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct'))).toEqual({ status: 409, code: 'session_closed' })
      expect(refusal(() => rules.setAbsent(db, clock, sessionId, ben, true))).toEqual({ status: 409, code: 'session_closed' })
    })

    it('allows one open session per classroom', () => {
      expect(rules.openSession(db, clock, classroom.slug, 'stage-1')).toMatchObject({ writes: [] })
      expect(refusal(() => rules.openSession(db, clock, classroom.slug, 'stage-2'))).toEqual({ status: 409, code: 'another_session_open' })
    })

    it('refuses to reopen or make current a stage every student has played', () => {
      rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct')
      rules.recordResult(db, clock, sessionId, ben, 'q2', 'incorrect')
      rules.closeSession(db, clock, sessionId)

      expect(refusal(() => rules.openSession(db, clock, classroom.slug, 'stage-1'))).toEqual({ status: 409, code: 'stage_finished' })
      expect(refusal(() => rules.setCurrentStage(db, classroom.slug, 'stage-1'))).toEqual({ status: 409, code: 'stage_finished' })
      expect(rules.setCurrentStage(db, classroom.slug, 'stage-2').detail.progress).toEqual({ currentStageSlug: 'stage-2' })
      expect(rules.setCurrentStage(db, classroom.slug, null).detail.progress).toEqual({ currentStageSlug: null })
    })

    it('keeps students with results and removes the others with their absences', () => {
      rules.recordResult(db, clock, sessionId, amira, 'q1', 'correct')
      rules.setAbsent(db, clock, sessionId, ben, true)

      expect(refusal(() => rules.deleteStudent(db, amira))).toEqual({ status: 409, code: 'student_has_results' })
      const removed = rules.deleteStudent(db, ben)
      expect(removed.detail.students.map((student) => student.name)).toEqual(['Amira'])
      expect(removed.detail.session?.absentStudentIds).toEqual([])
      expect(removed.writes.map((write) => [write.kind, write.table])).toEqual([
        ['delete', 'absences'],
        ['delete', 'students'],
      ])
      expect(rules.updateStudent(db, amira, { name: '  Amira   H ', emoji: '🐼' }).detail.students[0]).toMatchObject({ name: 'Amira H', emoji: '🐼' })
    })
  })

  it('reads ids it does not know as not found', () => {
    expect(refusal(() => rules.getClassroom(db, 'missing'))).toEqual({ status: 404, code: 'classroom_not_found' })
    expect(refusal(() => rules.getClassroom(db, 'Not A Slug'))).toEqual({ status: 404, code: 'classroom_not_found' })
    expect(refusal(() => rules.closeSession(db, clock, 'not-a-uuid'))).toEqual({ status: 404, code: 'session_not_found' })
  })

  it('turns rows into cells in tab order and back', () => {
    const row = rules.rowFrom('turns', 7, ['year-3', 'stage-1', 'x', 's1', 7, 'correct'])

    expect(row).toEqual({ rowNumber: 7, classroom_slug: 'year-3', stage_slug: 'stage-1', session_id: 'x', student_id: 's1', question_id: '7', status: 'correct', created_at: '' })
    expect(rules.cellsOf('turns', row)).toEqual(['year-3', 'stage-1', 'x', 's1', '7', 'correct', ''])
  })
})
