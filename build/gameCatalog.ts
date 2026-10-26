import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { Plugin } from 'vite'
import { GAME_SETTINGS_FILE, STAGES_DIR } from '../src/config.ts'
import type { GameCatalog } from '../src/types/stage.ts'
import { buildGameCatalog } from '../src/utils/gameCatalog.ts'

const VIRTUAL_ID: string = 'virtual:game-catalog'
const RESOLVED_ID: string = `\0${VIRTUAL_ID}`

// Reads public/game.json and public/stages/*.json at build time; any invalid file fails the build, like Quizrush's catalog.
export function gameCatalog(): Plugin {
  let publicDir = ''

  async function readCatalog(): Promise<GameCatalog> {
    const stagesDir = path.join(publicDir, STAGES_DIR)
    const names = (await readdir(stagesDir)).filter((name) => name.endsWith('.json')).sort()
    const stageFiles = await Promise.all(names.map(async (name) => ({ name, text: await readFile(path.join(stagesDir, name), 'utf8') })))
    const settingsFile = { name: GAME_SETTINGS_FILE, text: await readFile(path.join(publicDir, GAME_SETTINGS_FILE), 'utf8') }
    const result = buildGameCatalog(settingsFile, stageFiles)
    if (!result.ok) {
      throw new Error(`Invalid game files in ${publicDir}:\n${result.errors.join('\n')}`)
    }
    return result.catalog
  }

  return {
    name: 'questrush:game-catalog',
    configResolved(config) {
      publicDir = path.resolve(config.publicDir)
    },
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    async load(id) {
      if (id !== RESOLVED_ID) {
        return undefined
      }
      return `export const gameCatalog = ${JSON.stringify(await readCatalog())}`
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        const resolved = path.resolve(file)
        const isSettings = resolved === path.join(publicDir, GAME_SETTINGS_FILE)
        const isStage = resolved.endsWith('.json') && path.dirname(resolved) === path.join(publicDir, STAGES_DIR)
        if (!isSettings && !isStage) {
          return
        }
        const catalogModule = server.moduleGraph.getModuleById(RESOLVED_ID)
        if (catalogModule !== undefined) {
          server.moduleGraph.invalidateModule(catalogModule)
        }
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}
