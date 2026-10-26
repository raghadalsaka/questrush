import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { useOfficialSession } from '../../src/composables/useOfficialSession'
import { useTeacherClassroom } from '../../src/composables/useTeacherClassroom'
import { api } from '../../src/services/api'
import type { ClassroomDetail, Outcome } from '../../src/types/api'
import type { StageFile } from '../../src/types/stage'
import { makeClassroom, makeLevel, makeQuestion, makeResult, pickFirst, runInScope } from './helpers'

vi.mock('../../src/services/game', () => ({
  levelForSlug: (slug: string) => (slug === 'stage-1' ? makeLevel('stage-1', 1) : makeLevel(slug, 2, 'locked')),
}))

vi.mock('../../src/services/api', () => ({
  api: { recordResult: vi.fn(), getClassroom: vi.fn() },
  onSheetReloaded: () => () => {},
  errorMessage: (error: unknown) => String(error),
}))

const deck: StageFile = {
  title: 'Deck',
  slug: 'stage-1',
  order: 1,
  description: '',
  unlocked: true,
  settings: { secondsPerQuestion: 60, defaultQuestionsPerTeam: 5, allowCrossTeamRepeats: false },
  questions: [makeQuestion('q1', 2), makeQuestion('q2', 1), makeQuestion('q3', 0)],
}

function answered(studentId: string, questionId: string, outcome: Outcome): ClassroomDetail {
  return makeClassroom({ results: [makeResult(studentId, 'stage-1', outcome)], usedQuestionIds: { 'stage-1': [questionId] } })
}

async function setup(classroom: ClassroomDetail) {
  const { value, scope } = runInScope(() => {
    const teacher = useTeacherClassroom(classroom.slug)
    teacher.apply(classroom)
    const session = useOfficialSession(teacher, {
      randomInt: pickFirst,
      pickAnimationMs: () => 0,
      loadStage: async () => ({ ok: true, stage: deck }),
    })
    return { teacher, session }
  })
  await vi.waitFor(() => expect(value.session.deck.value).not.toBeNull())
  return { ...value, scope }
}

describe('useOfficialSession', () => {
  beforeEach(() => {
    vi.mocked(api.recordResult).mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('picks an eligible student and an unused question without calling the server', async () => {
    const classroom = makeClassroom({
      usedQuestionIds: { 'stage-1': ['q1'] },
      results: [makeResult('s1', 'stage-1', 'correct')],
      session: { id: 'session-1', stageSlug: 'stage-1', openedAt: '', absentStudentIds: ['s2'] },
    })
    const { session, scope } = await setup(classroom)
    expect(session.eligible.value.map((student) => student.id)).toEqual(['s3'])

    await session.pick()

    expect(session.pendingTurn.value).toEqual({ studentId: 's3', questionId: 'q2' })
    expect(session.showCard.value).toBe(true)
    expect(session.shownQuestion.value?.id).toBe('q2')
    expect(session.pickBlocker.value).toBe('Finish the current turn first.')
    expect(api.recordResult).not.toHaveBeenCalled()
    scope.stop()
  })

  it('pauses official turns when the stage file is locked', async () => {
    const classroom = makeClassroom({ session: { id: 'session-1', stageSlug: 'stage-2', openedAt: '', absentStudentIds: [] } })
    const { session, scope } = await setup(classroom)
    expect(session.pickBlocker.value).toMatch(/isn't unlocked in its stage file/)
    await session.pick()
    expect(session.pendingTurn.value).toBeNull()
    scope.stop()
  })

  it('stops picking with a clear message when the deck runs out', async () => {
    const classroom = makeClassroom({ usedQuestionIds: { 'stage-1': ['q1', 'q2', 'q3'] } })
    const { session, scope } = await setup(classroom)
    expect(session.pickBlocker.value).toMatch(/run out of questions/)
    await session.pick()
    expect(session.pendingTurn.value).toBeNull()
    scope.stop()
  })

  it('warns when fewer questions remain than waiting students', async () => {
    const classroom = makeClassroom({ usedQuestionIds: { 'stage-1': ['q1', 'q2'] } })
    const { session, scope } = await setup(classroom)
    expect(session.unused.value).toHaveLength(1)
    expect(session.shortage.value).toBe(2)
    scope.stop()
  })

  it('grades the tapped option and saves only the first tap', async () => {
    const { session, scope } = await setup(makeClassroom())
    await session.pick()
    let finish: (detail: ClassroomDetail) => void = () => {}
    vi.mocked(api.recordResult).mockImplementation(() => new Promise((resolve) => (finish = resolve)))

    const first = session.answer(2)
    const second = session.answer(0)
    expect(session.revealed.value).toBe(true)
    finish(answered('s1', 'q1', 'correct'))
    await Promise.all([first, second])
    await nextTick()

    expect(api.recordResult).toHaveBeenCalledTimes(1)
    expect(api.recordResult).toHaveBeenCalledWith('session-1', 's1', 'q1', 'correct')
    expect(session.finished.value?.outcome).toBe('correct')
    expect(session.showCard.value).toBe(true)
    expect(session.celebrateId.value).toBeNull()
    scope.stop()
  })

  it('keeps the answered turn on the card until the teacher moves on', async () => {
    const { session, scope } = await setup(makeClassroom())
    vi.mocked(api.recordResult).mockResolvedValue(answered('s1', 'q1', 'correct'))
    await session.pick()

    await session.answer(2)
    await nextTick()

    expect(session.pendingTurn.value).toBeNull()
    expect(session.shownStudent.value?.id).toBe('s1')
    expect(session.finished.value?.chosenIndex).toBe(2)
    expect(session.pickBlocker.value).toBeNull()

    session.dismiss()
    expect(session.showCard.value).toBe(false)
    expect(session.celebrateId.value).toBe('s1')
    scope.stop()
  })

  it('picks the next student straight from the answered card', async () => {
    const { session, scope } = await setup(makeClassroom())
    vi.mocked(api.recordResult).mockResolvedValue(answered('s1', 'q1', 'incorrect'))
    await session.pick()
    await session.answer(0)
    expect(api.recordResult).toHaveBeenCalledWith('session-1', 's1', 'q1', 'incorrect')

    await session.pickNext()

    expect(session.finished.value).toBeNull()
    expect(session.pendingTurn.value).toEqual({ studentId: 's2', questionId: 'q2' })
    expect(session.revealed.value).toBe(false)
    expect(session.chosenIndex.value).toBeNull()
    scope.stop()
  })

  it('keeps the answer on screen when saving fails and retries the same answer', async () => {
    const { teacher, session, scope } = await setup(makeClassroom())
    vi.mocked(api.recordResult).mockRejectedValueOnce(new Error('offline'))
    await session.pick()

    await session.answer(1)
    expect(teacher.actionError.value).toMatch(/offline/)
    expect(session.revealed.value).toBe(true)
    expect(session.chosenIndex.value).toBe(1)
    expect(session.finished.value).toBeNull()

    vi.mocked(api.recordResult).mockResolvedValueOnce(answered('s1', 'q1', 'incorrect'))
    await session.saveAgain()
    expect(api.recordResult).toHaveBeenLastCalledWith('session-1', 's1', 'q1', 'incorrect')
    expect(session.finished.value?.chosenIndex).toBe(1)
    scope.stop()
  })

  it('draws a different question for the same student and never offers a set-aside one again', async () => {
    const { session, scope } = await setup(makeClassroom())
    await session.pick()
    expect(session.pendingTurn.value).toEqual({ studentId: 's1', questionId: 'q1' })

    session.swapQuestion()
    expect(session.pendingTurn.value).toEqual({ studentId: 's1', questionId: 'q2' })
    session.swapQuestion()
    expect(session.pendingTurn.value).toEqual({ studentId: 's1', questionId: 'q3' })
    expect(session.canSwapQuestion.value).toBe(false)
    session.swapQuestion()
    expect(session.pendingTurn.value?.questionId).toBe('q3')
    expect(session.unused.value.map((question) => question.id)).toEqual(['q1', 'q2', 'q3'])
    expect(api.recordResult).not.toHaveBeenCalled()
    scope.stop()
  })

  it('locks the question once the answer is shown', async () => {
    const { session, scope } = await setup(makeClassroom())
    vi.mocked(api.recordResult).mockImplementation(() => new Promise(() => {}))
    await session.pick()
    void session.answer(2)
    expect(session.canSwapQuestion.value).toBe(false)
    session.swapQuestion()
    expect(session.pendingTurn.value?.questionId).toBe('q1')
    scope.stop()
  })

  it('forgets the turn when the session closes', async () => {
    const { teacher, session, scope } = await setup(makeClassroom())
    await session.pick()
    expect(session.showCard.value).toBe(true)
    teacher.apply(makeClassroom({ session: null }))
    await nextTick()
    expect(session.pendingTurn.value).toBeNull()
    expect(session.showCard.value).toBe(false)
    scope.stop()
  })

  it('Back to Map drops an unanswered turn so the next pick starts fresh', async () => {
    const { session, scope } = await setup(makeClassroom())
    await session.pick()
    session.swapQuestion()
    session.leaveTurn()
    expect(session.showCard.value).toBe(false)
    expect(session.pendingTurn.value).toBeNull()
    expect(session.pickBlocker.value).toBeNull()
    expect(api.recordResult).not.toHaveBeenCalled()

    await session.pick()
    expect(session.pendingTurn.value).toEqual({ studentId: 's1', questionId: 'q1' })
    expect(session.canSwapQuestion.value).toBe(true)
    scope.stop()
  })
})
