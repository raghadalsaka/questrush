import type { Outcome, Result, Student } from '../types/api'
import type { Level } from '../types/stage'

export type StageMarkKind = 'correct' | 'incorrect' | 'none' | 'locked' | 'missing'

export interface StageMark {
  kind: StageMarkKind
  symbol: string
  label: string
  fill: string
  text: string
  badge: string
}

// Every state has its own symbol and word, so the map never relies on colour alone.
export const STAGE_MARKS: Record<StageMarkKind, StageMark> = {
  correct: { kind: 'correct', symbol: '✓', label: 'Correct', fill: 'fill-good', text: 'fill-white', badge: 'border-good bg-good-soft text-good-deep' },
  incorrect: { kind: 'incorrect', symbol: '✗', label: 'Incorrect', fill: 'fill-bad', text: 'fill-white', badge: 'border-bad bg-bad-soft text-bad' },
  none: { kind: 'none', symbol: '–', label: 'No result yet', fill: 'fill-card', text: 'fill-ink', badge: 'border-rule bg-card text-ink-soft' },
  locked: { kind: 'locked', symbol: '🔒', label: 'Locked', fill: 'fill-locked-soft', text: 'fill-ink', badge: 'border-locked bg-locked-soft text-ink-soft' },
  missing: { kind: 'missing', symbol: '?', label: 'Coming soon', fill: 'fill-locked-soft', text: 'fill-ink-soft', badge: 'border-dashed border-locked bg-board text-ink-soft' },
}

export function outcomeFor(results: readonly Result[], studentId: string, stageSlug: string): Outcome | null {
  return results.find((result) => result.studentId === studentId && result.stageSlug === stageSlug)?.outcome ?? null
}

// A saved result always shows, even if its stage file was later locked again.
export function levelMark(level: Level, outcome: Outcome | null): StageMark {
  if (outcome !== null) {
    return STAGE_MARKS[outcome]
  }
  if (level.state === 'missing') {
    return STAGE_MARKS.missing
  }
  if (level.state === 'locked') {
    return STAGE_MARKS.locked
  }
  return STAGE_MARKS.none
}

export function levelTitle(level: Level): string {
  return level.stage?.title ?? 'Mystery island'
}

export function studentHistory(levels: readonly Level[], results: readonly Result[], studentId: string): { level: Level; mark: StageMark }[] {
  return levels.map((level) => ({ level, mark: levelMark(level, level.stage === null ? null : outcomeFor(results, studentId, level.stage.slug)) }))
}

// 0 is the starting harbour; otherwise the order of the furthest level with any official result.
export function pawnCheckpoint(levels: readonly Level[], results: readonly Result[], studentId: string): number {
  let checkpoint = 0
  for (const level of levels) {
    if (level.stage !== null && outcomeFor(results, studentId, level.stage.slug) !== null) {
      checkpoint = level.order
    }
  }
  return checkpoint
}

// One pass over the results, giving each student the same checkpoint pawnCheckpoint would.
export function groupByCheckpoint(levels: readonly Level[], students: readonly Student[], results: readonly Result[]): Student[][] {
  const levelIndex = new Map<string, number>()
  levels.forEach((level, index) => {
    if (level.stage !== null) {
      levelIndex.set(level.stage.slug, index)
    }
  })
  const furthest = new Map<string, number>()
  for (const result of results) {
    const index = levelIndex.get(result.stageSlug)
    if (index !== undefined && index > (furthest.get(result.studentId) ?? -1)) {
      furthest.set(result.studentId, index)
    }
  }
  const groups: Student[][] = Array.from({ length: levels.length + 1 }, () => [])
  for (const student of students) {
    const index = furthest.get(student.id)
    groups[index === undefined ? 0 : (levels[index] as Level).order]?.push(student)
  }
  return groups
}

export function starsLabel(points: number): string {
  return points === 1 ? '1 star' : `${points} stars`
}
