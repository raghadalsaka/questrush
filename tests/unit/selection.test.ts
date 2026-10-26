import { describe, expect, it } from 'vitest'
import { eligibleStudents, missingQuestionIds, planPick, questionShortage, unusedQuestions } from '../../src/utils/selection'
import { makeQuestion, makeResult, makeStudent, seededRandomInt } from './helpers'

const students = [makeStudent('s1'), makeStudent('s2'), makeStudent('s3'), makeStudent('s4')]

describe('eligibleStudents', () => {
  it('excludes absent students and students already assessed on this stage only', () => {
    const results = [makeResult('s1', 'stage-1', 'correct'), makeResult('s2', 'stage-2', 'incorrect')]
    const eligible = eligibleStudents(students, results, 'stage-1', ['s3'])
    expect(eligible.map((student) => student.id)).toEqual(['s2', 's4'])
  })

  it('lets a student with an incorrect answer play later stages', () => {
    const results = [makeResult('s1', 'stage-1', 'incorrect')]
    expect(eligibleStudents(students, results, 'stage-2', []).map((student) => student.id)).toContain('s1')
  })
})

describe('official question draws', () => {
  it('never repeats a question until the deck is exhausted', () => {
    const questions = Array.from({ length: 6 }, (_, index) => makeQuestion(`q${index + 1}`))
    const randomInt = seededRandomInt(7)
    const used: string[] = []
    let waiting = Array.from({ length: 10 }, (_, index) => makeStudent(`s${index + 1}`))
    for (;;) {
      const plan = planPick(waiting, unusedQuestions(questions, used), randomInt)
      if (!plan.ok) {
        expect(plan.reason).toBe('deck-exhausted')
        break
      }
      expect(used).not.toContain(plan.pick.question.id)
      used.push(plan.pick.question.id)
      waiting = waiting.filter((student) => student.id !== plan.pick.student.id)
    }
    expect(used.sort()).toEqual(questions.map((question) => question.id).sort())
    expect(waiting).toHaveLength(4)
  })

  it('reports when nobody is left before checking the deck', () => {
    expect(planPick([], [makeQuestion('q1')], seededRandomInt(1))).toEqual({ ok: false, reason: 'no-students' })
  })
})

describe('deck warnings', () => {
  it('counts the shortfall of questions against waiting students', () => {
    expect(questionShortage(3, 5)).toBe(2)
    expect(questionShortage(5, 3)).toBe(0)
  })

  it('lists used ids missing from an edited deck', () => {
    expect(missingQuestionIds([makeQuestion('q1')], ['q1', 'q9'])).toEqual(['q9'])
  })
})
