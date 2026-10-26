import { describe, expect, it } from 'vitest'
import { groupByCheckpoint, levelMark, pawnCheckpoint, studentHistory } from '../../src/utils/progress'
import { makeLevel, makeResult, makeStudent } from './helpers'

const stages = [makeLevel('a', 1), makeLevel('b', 2), makeLevel('c', 3, 'locked'), makeLevel('', 4, 'missing')]

describe('stage marks', () => {
  it('gives every state a symbol and a word, not just a colour', () => {
    expect(levelMark(stages[0]!, 'correct')).toMatchObject({ kind: 'correct', symbol: '✓', label: 'Correct' })
    expect(levelMark(stages[0]!, 'incorrect')).toMatchObject({ kind: 'incorrect', symbol: '✗', label: 'Incorrect' })
    expect(levelMark(stages[1]!, null)).toMatchObject({ kind: 'none', label: 'No result yet' })
    expect(levelMark(stages[2]!, null)).toMatchObject({ kind: 'locked', symbol: '🔒', label: 'Locked' })
    expect(levelMark(stages[3]!, null)).toMatchObject({ kind: 'missing', symbol: '?', label: 'Coming soon' })
    expect(levelMark(stages[2]!, 'correct')).toMatchObject({ kind: 'correct' })
  })

  it('rebuilds the same history from saved results after a reload', () => {
    const results = [makeResult('s1', 'a', 'correct'), makeResult('s1', 'b', 'incorrect'), makeResult('s2', 'a', 'incorrect')]
    const reloaded = JSON.parse(JSON.stringify(results)) as typeof results
    const kinds = studentHistory(stages, reloaded, 's1').map((entry) => entry.mark.kind)
    expect(kinds).toEqual(['correct', 'incorrect', 'locked', 'missing'])
    expect(studentHistory(stages, reloaded, 's2').map((entry) => entry.mark.kind)).toEqual(['incorrect', 'none', 'locked', 'missing'])
  })
})

describe('pawn checkpoints', () => {
  it('moves a pawn to the furthest stage with any result, including an incorrect one', () => {
    const results = [makeResult('s1', 'a', 'incorrect'), makeResult('s1', 'b', 'correct'), makeResult('s2', 'a', 'correct')]
    expect(pawnCheckpoint(stages, results, 's1')).toBe(2)
    expect(pawnCheckpoint(stages, results, 's2')).toBe(1)
    expect(pawnCheckpoint(stages, results, 's3')).toBe(0)
  })

  it('groups every student at exactly one checkpoint', () => {
    const students = [makeStudent('s1'), makeStudent('s2'), makeStudent('s3')]
    const groups = groupByCheckpoint(stages, students, [makeResult('s1', 'a', 'correct')])
    expect(groups.map((group) => group.map((student) => student.id))).toEqual([['s2', 's3'], ['s1'], [], [], []])
  })
})
