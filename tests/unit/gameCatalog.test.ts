import { describe, expect, it } from 'vitest'
import settingsText from '../../public/game.json?raw'
import { buildGameCatalog, buildLevels } from '../../src/utils/gameCatalog'

const STAGE_FILES: Record<string, string> = import.meta.glob('../../public/stages/*.json', { query: '?raw', import: 'default', eager: true })

function stage(slug: string, order: number, unlocked: boolean = true): { name: string; text: string } {
  return {
    name: `${slug}.json`,
    text: JSON.stringify({
      title: `Stage ${slug}`,
      slug,
      order,
      unlocked,
      settings: { secondsPerQuestion: 60, defaultQuestionsPerTeam: 5, allowCrossTeamRepeats: false },
      questions: [{ id: `${slug}-1`, prompt: 'Pick one', options: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: 'Because a.' }],
    }),
  }
}

const settings = (levels: number) => ({ name: 'game.json', text: JSON.stringify({ title: 'Test game', levels }) })

describe('buildGameCatalog', () => {
  it('accepts the game settings and every stage file shipped with the site', () => {
    const files = Object.entries(STAGE_FILES).map(([file, text]) => ({ name: file.split('/').pop() as string, text }))
    expect(files.length).toBeGreaterThan(0)
    const result = buildGameCatalog({ name: 'game.json', text: settingsText }, files)
    expect(result.ok, result.ok ? '' : result.errors.join('\n')).toBe(true)
  })

  it('sorts stages by order and keeps their lock state', () => {
    const result = buildGameCatalog(settings(3), [stage('jungle', 2, false), stage('harbour', 1)])
    expect(result.ok && result.catalog.stages.map((entry) => [entry.slug, entry.order, entry.unlocked, entry.questionCount])).toEqual([
      ['harbour', 1, true, 1],
      ['jungle', 2, false, 1],
    ])
  })

  it('reports every file problem with its file name', () => {
    const badUnlocked = JSON.parse(stage('volcano', 3).text) as Record<string, unknown>
    badUnlocked.unlocked = 'yes'
    const result = buildGameCatalog(settings(3), [
      stage('harbour', 1),
      { ...stage('jungle', 2), name: 'renamed.json' },
      stage('cove', 1),
      stage('far', 9),
      { name: 'volcano.json', text: JSON.stringify(badUnlocked) },
      { name: 'broken.json', text: '{' },
    ])
    const errors = result.ok ? [] : result.errors
    expect(errors).toEqual([
      'renamed.json: the file must be named after its slug, jungle.json.',
      'cove.json: order 1 is already used by harbour.json.',
      'far.json: order 9 is past the 3 levels in game.json.',
      'volcano.json: unlocked must be true or false (without quotes).',
      expect.stringMatching(/^broken\.json: not valid JSON/),
    ])
  })

  it('rejects invalid settings', () => {
    const result = buildGameCatalog({ name: 'game.json', text: JSON.stringify({ title: '', levels: 0 }) }, [])
    expect(result.ok ? [] : result.errors).toEqual(['game.json: title must be non-blank text.', 'game.json: levels must be a whole number from 1 to 50.'])
  })
})

describe('buildLevels', () => {
  it('lists every level, marking stages without a file as missing and locked files as locked', () => {
    const result = buildGameCatalog(settings(4), [stage('harbour', 1), stage('volcano', 3, false)])
    if (!result.ok) {
      throw new Error(result.errors.join('\n'))
    }
    expect(buildLevels(result.catalog).map((level) => [level.order, level.state, level.stage?.slug ?? null])).toEqual([
      [1, 'open', 'harbour'],
      [2, 'missing', null],
      [3, 'locked', 'volcano'],
      [4, 'missing', null],
    ])
  })
})
