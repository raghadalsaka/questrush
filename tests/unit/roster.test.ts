import { describe, expect, it } from 'vitest'
import { assignEmojis, columnLabel, EMOJI_POOL, extractNames, guessNameColumn, normalizeName, validateDrafts } from '../../src/utils/roster'

const SHEET: string[][] = [
  ['Name', 'Class'],
  ['  Amira   Haddad ', '3B'],
  [],
  ['Sam Lee', '3B'],
  ['', '3B'],
  ['sam lee', '3A'],
  ['12345', '3A'],
  ['Zoë O’Brien', '3A'],
  ['---'],
]

describe('extractNames', () => {
  it('skips blank rows, reports invalid entries and keeps identical names as separate students', () => {
    const result = extractNames(SHEET, 0, true)
    expect(result.entries.map((entry) => entry.name)).toEqual(['Amira Haddad', 'Sam Lee', 'sam lee', 'Zoë O’Brien'])
    expect(result.blankRows).toBe(2)
    expect(result.invalid).toEqual([
      { row: 7, value: '12345', reason: 'has no letters, so it does not look like a name' },
      { row: 9, value: '---', reason: 'has no letters, so it does not look like a name' },
    ])
    expect(result.entries[2]).toMatchObject({ row: 6, duplicateOf: 4 })
    expect(result.entries[1]).toMatchObject({ row: 4, duplicateOf: null })
  })

  it('treats the first row as a name when there is no header', () => {
    const result = extractNames([['Amira'], ['Ben']], 0, false)
    expect(result.entries.map((entry) => entry.name)).toEqual(['Amira', 'Ben'])
  })

  it('reads whichever column the teacher chooses', () => {
    const result = extractNames(SHEET, 1, true)
    expect(result.entries.map((entry) => entry.name)).toEqual(['3B', '3B', '3B', '3A', '3A', '3A'])
    expect(result.blankRows).toBe(2)
  })
})

describe('guessNameColumn', () => {
  it('finds a "Name" header', () => {
    expect(guessNameColumn([['Class', 'Student name'], ['3B', 'Amira']])).toEqual({ column: 1, hasHeader: true })
  })

  it('falls back to the column with the most letters', () => {
    expect(guessNameColumn([['1', 'Amira'], ['2', 'Ben']])).toEqual({ column: 1, hasHeader: false })
  })
})

describe('normalizeName', () => {
  it('matches the server rules', () => {
    expect(normalizeName('  Sam   Lee ')).toEqual({ ok: true, name: 'Sam Lee' })
    expect(normalizeName('رغد')).toEqual({ ok: true, name: 'رغد' })
    expect(normalizeName('')).toMatchObject({ ok: false })
    expect(normalizeName('12345')).toMatchObject({ ok: false })
    expect(normalizeName('Bad\u0007Name')).toMatchObject({ ok: false })
    expect(normalizeName('a'.repeat(61))).toMatchObject({ ok: false })
  })
})

describe('assignEmojis', () => {
  it('prefers pawns not yet used in the classroom, then repeats', () => {
    const taken = [EMOJI_POOL[0] as string]
    const emojis = assignEmojis(EMOJI_POOL.length + 1, taken)
    expect(emojis[0]).toBe(EMOJI_POOL[1])
    expect(new Set(emojis.slice(0, EMOJI_POOL.length)).size).toBe(EMOJI_POOL.length)
    expect(emojis[EMOJI_POOL.length - 1]).toBe(EMOJI_POOL[0])
  })
})

describe('validateDrafts', () => {
  it('returns clean students and lists problems by position', () => {
    const result = validateDrafts([
      { key: 1, name: ' Amira ', emoji: '🦊', note: '' },
      { key: 2, name: '', emoji: '🐼', note: '' },
      { key: 3, name: 'Ben', emoji: '', note: '' },
    ])
    expect(result.students).toEqual([{ name: 'Amira', emoji: '🦊' }])
    expect(result.errors).toEqual(['Student 2: the name is empty.', 'Student 3 (Ben): choose one emoji for the pawn.'])
  })
})

describe('columnLabel', () => {
  it('uses spreadsheet letters', () => {
    expect([0, 1, 25, 26, 27].map(columnLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })
})
