import { effectScope, type EffectScope } from 'vue'
import type { ClassroomDetail, Result, Student } from '../../src/types/api'
import type { Level, LevelState } from '../../src/types/stage'
import type { Question } from '../../src/types/contest'
import type { RandomInt } from '../../src/utils/random'

export function seededRandomInt(seed: number): RandomInt {
  let state = seed >>> 0
  return (exclusiveMax) => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    const unit = ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
    return Math.floor(unit * exclusiveMax)
  }
}

export const pickFirst: RandomInt = () => 0

export function makeQuestion(id: string, correctIndex: number = 0): Question {
  return {
    id,
    prompt: `Prompt for ${id}`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctIndex,
    explanation: `Explanation for ${id}`,
  }
}

export function makeStudent(id: string, points: number = 0): Student {
  return { id, name: `Student ${id}`, emoji: '🦊', photoFile: null, position: 1, points }
}

export function makeLevel(slug: string, order: number, state: LevelState = 'open'): Level {
  if (state === 'missing') {
    return { order, state, stage: null }
  }
  return { order, state, stage: { slug, order, title: `Stage ${order}`, description: '', unlocked: state === 'open', questionCount: 3 } }
}

export function makeResult(studentId: string, stageSlug: string, outcome: Result['outcome']): Result {
  return { studentId, stageSlug, outcome }
}

export function makeClassroom(overrides: Partial<ClassroomDetail> = {}): ClassroomDetail {
  return {
    slug: 'classroom-1',
    name: 'Test class',
    progress: { currentStageSlug: null },
    students: [makeStudent('s1'), makeStudent('s2'), makeStudent('s3')],
    results: [],
    usedQuestionIds: {},
    session: { id: 'session-1', stageSlug: 'stage-1', openedAt: '2026-10-13T08:00:00Z', absentStudentIds: [] },
    ...overrides,
  }
}

export function runInScope<T>(create: () => T): { value: T; scope: EffectScope } {
  const scope = effectScope()
  const value = scope.run(create)
  if (value === undefined) {
    throw new Error('effect scope did not run')
  }
  return { value, scope }
}

export function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
