import type { GameCatalog, Level, StageInfo } from '../types/stage.ts'
import { describeError } from './errors.ts'
import { validateGameSettings, validateStage } from './validateStage.ts'

export interface JsonFile {
  name: string
  text: string
}

export type GameCatalogResult = { ok: true; catalog: GameCatalog } | { ok: false; errors: string[] }

function parse(file: JsonFile, errors: string[]): unknown {
  try {
    return JSON.parse(file.text)
  } catch (error) {
    errors.push(`${file.name}: not valid JSON: ${describeError(error)}`)
    return undefined
  }
}

// Checks game.json and every stage file together: each stage is <slug>.json, and orders are unique and within the level count.
export function buildGameCatalog(settingsFile: JsonFile, stageFiles: readonly JsonFile[]): GameCatalogResult {
  const errors: string[] = []
  const settingsData = parse(settingsFile, errors)
  const settings = settingsData === undefined ? null : validateGameSettings(settingsData)
  if (settings !== null && !settings.ok) {
    errors.push(...settings.errors.map((error) => `${settingsFile.name}: ${error}`))
  }
  const stages: StageInfo[] = []
  for (const file of stageFiles) {
    const data = parse(file, errors)
    if (data === undefined) {
      continue
    }
    const result = validateStage(data)
    if (!result.ok) {
      errors.push(...result.errors.map((error) => `${file.name}: ${error}`))
      continue
    }
    const { slug, order, title, description, unlocked, questions } = result.stage
    if (file.name !== `${slug}.json`) {
      errors.push(`${file.name}: the file must be named after its slug, ${slug}.json.`)
      continue
    }
    const earlier = stages.find((stage) => stage.order === order)
    if (earlier !== undefined) {
      errors.push(`${file.name}: order ${order} is already used by ${earlier.slug}.json.`)
      continue
    }
    if (settings?.ok && order > settings.settings.levels) {
      errors.push(`${file.name}: order ${order} is past the ${settings.settings.levels} levels in ${settingsFile.name}.`)
      continue
    }
    stages.push({ slug, order, title, description, unlocked, questionCount: questions.length })
  }
  if (errors.length > 0 || settings === null || !settings.ok) {
    return { ok: false, errors }
  }
  stages.sort((a, b) => a.order - b.order)
  return { ok: true, catalog: { settings: settings.settings, stages } }
}

// Every level the game promises, in order; a level with no stage file yet is "missing".
export function buildLevels(catalog: GameCatalog): Level[] {
  return Array.from({ length: catalog.settings.levels }, (_, index) => {
    const order = index + 1
    const stage = catalog.stages.find((candidate) => candidate.order === order) ?? null
    if (stage === null) {
      return { order, state: 'missing', stage }
    }
    return { order, state: stage.unlocked ? 'open' : 'locked', stage }
  })
}
