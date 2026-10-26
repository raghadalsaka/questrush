import { gameCatalog } from 'virtual:game-catalog'
import type { GameCatalog, Level } from '../types/stage'
import { buildLevels } from '../utils/gameCatalog'

// The game's settings and stages are fixed at build time, so every screen shares one catalog and one level list.
export const catalog: GameCatalog = gameCatalog
export const levels: readonly Level[] = buildLevels(gameCatalog)

export function levelForSlug(slug: string): Level | null {
  return levels.find((level) => level.stage?.slug === slug) ?? null
}
