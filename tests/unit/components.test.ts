import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AdventureMap from '../../src/components/AdventureMap.vue'
import QuestionCard from '../../src/components/QuestionCard.vue'
import StudentProgressPanel from '../../src/components/StudentProgressPanel.vue'
import { makeLevel, makeQuestion, makeResult, makeStudent } from './helpers'

const levels = [makeLevel('a', 1), makeLevel('b', 2), makeLevel('c', 3, 'locked'), makeLevel('', 4, 'missing')]
const students = Array.from({ length: 30 }, (_, index) => makeStudent(`s${index + 1}`))

describe('AdventureMap', () => {
  it('groups a class of 30 at the harbour with a "+N" bubble that names the hidden pawns', async () => {
    const wrapper = mount(AdventureMap, {
      props: { levels, students, results: [], classroomSlug: 't', selectedStudentId: null },
    })
    expect(wrapper.findAll('[aria-label^="Student s"]')).toHaveLength(11)
    const bubble = wrapper.find('[aria-label="19 more pawns here. Show them."]')
    expect(bubble.exists()).toBe(true)
    await bubble.trigger('click')
    expect(wrapper.emitted('showList')?.[0]).toEqual([students.slice(11)])
    expect(wrapper.find('[aria-label="Stage 3: Stage 3. Locked"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Stage 4: Mystery island. Coming soon"]').exists()).toBe(true)
  })

  it('keeps the student on turn visible even in a crowded group', () => {
    const wrapper = mount(AdventureMap, {
      props: { levels, students, results: [], classroomSlug: 't', selectedStudentId: null, turnStudentId: 's30' },
    })
    expect(wrapper.find('[aria-label="Student s30, 0 stars, on turn"]').exists()).toBe(true)
    expect(wrapper.findAll('[aria-label^="Student s"]')).toHaveLength(11)
  })

  it('marks every stage for the selected student with a symbol and a word', () => {
    const results = [makeResult('s1', 'a', 'correct'), makeResult('s1', 'b', 'incorrect')]
    const wrapper = mount(AdventureMap, {
      props: { levels, students, results, classroomSlug: 't', selectedStudentId: 's1' },
    })
    const labels = wrapper.findAll('[aria-label^="Stage "]').map((marker) => marker.attributes('aria-label'))
    expect(labels).toEqual(['Stage 1: Stage 1. Correct', 'Stage 2: Stage 2. Incorrect', 'Stage 3: Stage 3. Locked', 'Stage 4: Mystery island. Coming soon'])
    expect(wrapper.text()).toContain('✓')
    expect(wrapper.text()).toContain('✗')
  })

  it('flags the stage where the class is', () => {
    const wrapper = mount(AdventureMap, {
      props: { levels, students, results: [], classroomSlug: 't', selectedStudentId: null, currentStageSlug: 'b' },
    })
    expect(wrapper.find('[aria-label="Stage 2: Stage 2. Open. The class is here"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('🚩')
  })

  it('emits selection for pawns and stages', async () => {
    const wrapper = mount(AdventureMap, {
      props: { levels, students: students.slice(0, 2), results: [], classroomSlug: 't', selectedStudentId: null },
    })
    await wrapper.find('[aria-label="Student s1, 0 stars"]').trigger('click')
    await wrapper.find('[aria-label="Stage 2: Stage 2. Open"]').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('selectStudent')).toEqual([['s1']])
    expect(wrapper.emitted('selectLevel')).toEqual([[2]])
  })
})

describe('QuestionCard', () => {
  it('keeps the answer out of the page until it is revealed', async () => {
    const question = makeQuestion('q1', 2)
    const wrapper = mount(QuestionCard, {
      props: { question, revealed: false, chosenIndex: 1, canChoose: true, resultTitle: null, isCorrect: null },
    })
    expect(wrapper.text()).not.toContain('Correct answer')
    expect(wrapper.text()).not.toContain(question.explanation)
    await wrapper.setProps({ revealed: true })
    expect(wrapper.text()).toContain('Correct answer')
    expect(wrapper.text()).toContain('Chosen answer')
    expect(wrapper.text()).toContain(question.explanation)
  })
})

describe('StudentProgressPanel', () => {
  it('shows points and stage history and returns to everyone', async () => {
    const wrapper = mount(StudentProgressPanel, {
      props: { student: makeStudent('s1', 1), levels, results: [makeResult('s1', 'a', 'correct')], classroomSlug: 't' },
    })
    expect(wrapper.text()).toContain('1 star')
    expect(wrapper.findAll('li').map((item) => item.text())).toEqual([
      expect.stringContaining('Correct'),
      expect.stringContaining('No result yet'),
      expect.stringContaining('Locked'),
      expect.stringContaining('Coming soon'),
    ])
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('showEveryone')).toHaveLength(1)
  })
})
