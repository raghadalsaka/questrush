import type { Question } from '../types/contest'
import type { Result, Student } from '../types/api'

// Eligible: no official result on this stage yet and not marked absent in the open session.
export function eligibleStudents(
  students: readonly Student[],
  results: readonly Result[],
  stageSlug: string,
  absentIds: readonly string[],
): Student[] {
  const assessed = new Set(results.filter((result) => result.stageSlug === stageSlug).map((result) => result.studentId))
  const absent = new Set(absentIds)
  return students.filter((student) => !assessed.has(student.id) && !absent.has(student.id))
}

export function unusedQuestions(questions: readonly Question[], usedIds: readonly string[]): Question[] {
  const used = new Set(usedIds)
  return questions.filter((question) => !used.has(question.id))
}

// Used ids the stage file no longer contains mean it was edited after official turns began.
export function missingQuestionIds(questions: readonly Question[], usedIds: readonly string[]): string[] {
  const present = new Set(questions.map((question) => question.id))
  return usedIds.filter((id) => !present.has(id))
}

export function questionShortage(unusedCount: number, eligibleCount: number): number {
  return Math.max(0, eligibleCount - unusedCount)
}
