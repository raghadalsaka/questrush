import { describe, expect, it, vi } from 'vitest'
import { usePractice } from '../../src/composables/usePractice'
import practiceSource from '../../src/composables/usePractice.ts?raw'
import { makeQuestion, pickFirst } from './helpers'

vi.mock('../../src/services/api', () => {
  throw new Error('practice must never load the API client')
})

describe('usePractice', () => {
  const questions = [makeQuestion('q1', 0), makeQuestion('q2', 1), makeQuestion('q3', 2)]

  it('scores answers, shows feedback and finishes after every question', () => {
    const practice = usePractice(questions, pickFirst)
    const seen: string[] = []
    while (practice.phase.value !== 'finished') {
      const current = practice.current.value!
      seen.push(current.id)
      practice.answer(current.id === 'q2' ? 3 : current.correctIndex)
      expect(practice.phase.value).toBe('answered')
      practice.answer(0)
      practice.next()
    }
    expect(seen.sort()).toEqual(['q1', 'q2', 'q3'])
    expect(practice.correctCount.value).toBe(2)
    expect(practice.answeredCount.value).toBe(3)
  })

  it('replays from a clean score', () => {
    const practice = usePractice(questions, pickFirst)
    practice.answer(practice.current.value!.correctIndex)
    practice.restart()
    expect(practice.correctCount.value).toBe(0)
    expect(practice.answeredCount.value).toBe(0)
    expect(practice.phase.value).toBe('question')
  })

  it('has no path to official results', () => {
    expect(practiceSource).not.toMatch(/services\/api/)
  })
})
