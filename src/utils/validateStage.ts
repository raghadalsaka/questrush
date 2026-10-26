import { MAX_DESCRIPTION_LENGTH, MAX_LEVELS } from '../config.ts'
import type { GameSettings, StageLoadResult } from '../types/stage.ts'
import { isIntegerInRange } from './numbers.ts'
import { validateContest } from './validateContest.ts'

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// The Quizrush rules apply unchanged; a stage adds order, unlocked and an optional description.
export function validateStage(data: unknown): StageLoadResult {
  const contest = validateContest(data)
  const errors = contest.ok ? [] : [...contest.errors]
  if (!isObject(data)) {
    return { ok: false, errors }
  }
  if (!isIntegerInRange(data.order, 1, MAX_LEVELS)) {
    errors.push(`order must be a whole number from 1 to ${MAX_LEVELS}.`)
  }
  if (typeof data.unlocked !== 'boolean') {
    errors.push('unlocked must be true or false (without quotes).')
  }
  const description = data.description ?? ''
  if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description must be text of at most ${MAX_DESCRIPTION_LENGTH} characters.`)
  }
  if (errors.length > 0 || !contest.ok) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    stage: { ...contest.contest, order: data.order as number, unlocked: data.unlocked as boolean, description: (description as string).trim() },
  }
}

export function validateGameSettings(data: unknown): { ok: true; settings: GameSettings } | { ok: false; errors: string[] } {
  if (!isObject(data)) {
    return { ok: false, errors: ['game.json must contain one JSON object with title and levels.'] }
  }
  const errors: string[] = []
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    errors.push('title must be non-blank text.')
  }
  if (!isIntegerInRange(data.levels, 1, MAX_LEVELS)) {
    errors.push(`levels must be a whole number from 1 to ${MAX_LEVELS}.`)
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, settings: { title: (data.title as string).trim(), levels: data.levels as number } }
}
