import { MAX_EMOJI_LENGTH, MAX_NAME_LENGTH } from '../config'
import type { NewStudent } from '../types/api'

export const EMOJI_POOL: readonly string[] = [
  '🦊', '🐼', '🐯', '🦁', '🐸', '🐙', '🦉', '🐢', '🐬', '🦄', '🐝', '🦋', '🐧', '🐨', '🦒', '🐘', '🦓', '🐳', '🦜', '🐞',
  '🦀', '🦔', '🐻', '🐰', '🐮', '🐷', '🐵', '🦩', '🦦', '🦥', '🐿️', '🦭', '🐊', '🦚', '🐌', '🦕', '🦖', '🐠', '🦅', '🐺',
]

export interface RosterEntry {
  row: number
  name: string
  duplicateOf: number | null
}

export interface RosterProblem {
  row: number
  value: string
  reason: string
}

export interface RosterExtraction {
  entries: RosterEntry[]
  invalid: RosterProblem[]
  blankRows: number
}

export interface DraftStudent {
  key: number
  name: string
  emoji: string
  note: string
}

export interface ColumnGuess {
  column: number
  hasHeader: boolean
}

const HEADER_PATTERN: RegExp = /^(student\s*)?(full\s*)?names?$|^student$|^pupil$|^الاسم$|^اسم/i

// Same rules as the Go API (roster.NormalizeName), so the preview predicts what the server accepts.
export function normalizeName(raw: string): { ok: true; name: string } | { ok: false; reason: string } {
  const name = raw.trim().split(/\s+/u).join(' ')
  if (name === '') {
    return { ok: false, reason: 'is empty' }
  }
  if ([...name].length > MAX_NAME_LENGTH) {
    return { ok: false, reason: `is longer than ${MAX_NAME_LENGTH} characters` }
  }
  if (/\p{Cc}/u.test(name)) {
    return { ok: false, reason: 'contains control characters' }
  }
  if (!/\p{L}/u.test(name)) {
    return { ok: false, reason: 'has no letters, so it does not look like a name' }
  }
  return { ok: true, name }
}

// The byte cap matches the Go API's roster.NormalizeEmoji, which counts UTF-8 bytes as well as characters.
export function isValidEmoji(raw: string): boolean {
  const emoji = raw.trim()
  return (
    emoji !== '' &&
    [...emoji].length <= MAX_EMOJI_LENGTH &&
    new TextEncoder().encode(emoji).length <= MAX_EMOJI_LENGTH * 4 &&
    !/[\s\p{Cc}]/u.test(emoji)
  )
}

export function columnLabel(index: number): string {
  let label = ''
  let remaining = index + 1
  while (remaining > 0) {
    const digit = (remaining - 1) % 26
    label = String.fromCharCode(65 + digit) + label
    remaining = Math.floor((remaining - 1) / 26)
  }
  return label
}

export function columnCount(rows: readonly (readonly string[])[]): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0)
}

// Prefers a column whose first cell reads like "Name"; otherwise the column with the most letter-filled cells.
export function guessNameColumn(rows: readonly (readonly string[])[]): ColumnGuess {
  const first = rows[0] ?? []
  const headerIndex = first.findIndex((cell) => HEADER_PATTERN.test(cell.trim()))
  if (headerIndex >= 0) {
    return { column: headerIndex, hasHeader: true }
  }
  let best = 0
  let bestScore = -1
  for (let column = 0; column < columnCount(rows); column++) {
    const score = rows.filter((row) => /\p{L}/u.test(row[column] ?? '')).length
    if (score > bestScore) {
      best = column
      bestScore = score
    }
  }
  return { column: best, hasHeader: false }
}

// Blank cells are skipped and counted; invalid cells are reported, not imported. Identical names are kept as separate students.
export function extractNames(rows: readonly (readonly string[])[], column: number, hasHeader: boolean): RosterExtraction {
  const entries: RosterEntry[] = []
  const invalid: RosterProblem[] = []
  const firstRowByName = new Map<string, number>()
  let blankRows = 0
  rows.forEach((row, index) => {
    if (hasHeader && index === 0) {
      return
    }
    const rowNumber = index + 1
    const value = (row[column] ?? '').trim()
    if (value === '') {
      blankRows++
      return
    }
    const result = normalizeName(value)
    if (!result.ok) {
      invalid.push({ row: rowNumber, value, reason: result.reason })
      return
    }
    const key = result.name.toLocaleLowerCase()
    entries.push({ row: rowNumber, name: result.name, duplicateOf: firstRowByName.get(key) ?? null })
    if (!firstRowByName.has(key)) {
      firstRowByName.set(key, rowNumber)
    }
  })
  return { entries, invalid, blankRows }
}

// Hands out pawns not already used in the classroom first, then repeats the pool.
export function assignEmojis(count: number, taken: readonly string[]): string[] {
  const takenSet = new Set(taken)
  const fresh = EMOJI_POOL.filter((emoji) => !takenSet.has(emoji))
  const order = [...fresh, ...EMOJI_POOL.filter((emoji) => takenSet.has(emoji))]
  return Array.from({ length: count }, (_, index) => order[index % order.length] as string)
}

export function validateDrafts(drafts: readonly DraftStudent[]): { students: NewStudent[]; errors: string[] } {
  const students: NewStudent[] = []
  const errors: string[] = []
  drafts.forEach((draft, index) => {
    const result = normalizeName(draft.name)
    if (!result.ok) {
      errors.push(`Student ${index + 1}: the name ${result.reason}.`)
      return
    }
    if (!isValidEmoji(draft.emoji)) {
      errors.push(`Student ${index + 1} (${result.name}): choose one emoji for the pawn.`)
      return
    }
    students.push({ name: result.name, emoji: draft.emoji.trim() })
  })
  return { students, errors }
}
