import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import LevelsPanel from '../../src/components/LevelsPanel.vue'
import { classroomKey, useTeacherClassroom } from '../../src/composables/useTeacherClassroom'
import { makeClassroom, makeResult, runInScope } from './helpers'

vi.mock('../../src/services/game', async () => {
  const { makeLevel } = await import('./helpers')
  const levels = [makeLevel('stage-1', 1), makeLevel('stage-2', 2)]
  return {
    catalog: { settings: { title: 'Test game', levels: 2 }, stages: [] },
    levels,
    levelForSlug: (slug: string) => levels.find((level) => level.stage?.slug === slug) ?? null,
  }
})

function mountPanel(results: ReturnType<typeof makeResult>[]) {
  const { value: teacher } = runInScope(() => useTeacherClassroom('classroom-1'))
  const usedQuestionIds: Record<string, string[]> = {}
  results.forEach((result, index) => (usedQuestionIds[result.stageSlug] = [...(usedQuestionIds[result.stageSlug] ?? []), `q${index}`]))
  teacher.classroom.value = makeClassroom({ results, usedQuestionIds, session: null })
  return mount(LevelsPanel, { global: { provide: { [classroomKey as symbol]: teacher } } })
}

function card(wrapper: ReturnType<typeof mountPanel>, order: number) {
  const found = wrapper.findAll('li').find((item) => item.find('h3').text().startsWith(`${order}.`))
  if (found === undefined) {
    throw new Error(`no card for level ${order}`)
  }
  return found
}

describe('LevelsPanel', () => {
  it('locks a stage every student has played, but not one with students still to play', () => {
    const wrapper = mountPanel([
      makeResult('s1', 'stage-1', 'correct'),
      makeResult('s2', 'stage-1', 'incorrect'),
      makeResult('s3', 'stage-1', 'correct'),
      makeResult('s1', 'stage-2', 'correct'),
    ])
    const finished = card(wrapper, 1)
    expect(finished.text()).toContain('Finished: every student has played this stage.')
    expect(finished.findAll('button')).toHaveLength(0)

    const partial = card(wrapper, 2)
    const labels = partial.findAll('button').map((button) => button.text())
    expect(labels).toEqual(['Reopen Session', 'Make Current Stage'])
  })
})
