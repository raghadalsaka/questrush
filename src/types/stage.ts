import type { Contest } from './contest.ts'

export interface GameSettings {
  title: string
  levels: number
}

// A stage file is a Quizrush contest plus its place on the map and whether it can be played.
export interface StageFile extends Contest {
  order: number
  description: string
  unlocked: boolean
}

export interface StageInfo {
  slug: string
  order: number
  title: string
  description: string
  unlocked: boolean
  questionCount: number
}

export interface GameCatalog {
  settings: GameSettings
  stages: StageInfo[]
}

export type LevelState = 'open' | 'locked' | 'missing'

export interface Level {
  order: number
  state: LevelState
  stage: StageInfo | null
}

export type StageLoadResult = { ok: true; stage: StageFile } | { ok: false; errors: string[] }
