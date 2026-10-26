import { computed, readonly, ref, shallowRef } from 'vue'
import type { Question } from '../types/contest'
import { cryptoRandomInt, type RandomInt } from '../utils/random'
import { shuffled } from '../utils/shuffle'

export type PracticePhase = 'question' | 'answered' | 'finished'

// Home practice lives entirely in the browser: it never imports the API, so it can't change official results.
export function usePractice(questions: readonly Question[], randomInt: RandomInt = cryptoRandomInt) {
  const order = shallowRef<Question[]>(shuffled(questions, randomInt))
  const index = ref(0)
  const phase = ref<PracticePhase>(questions.length === 0 ? 'finished' : 'question')
  const selectedIndex = ref<number | null>(null)
  const correctCount = ref(0)
  const answeredCount = ref(0)

  const current = computed(() => order.value[index.value] ?? null)
  const isCorrect = computed(() => current.value !== null && selectedIndex.value === current.value.correctIndex)
  const total = computed(() => order.value.length)

  function answer(optionIndex: number): void {
    if (phase.value !== 'question' || current.value === null) {
      return
    }
    selectedIndex.value = optionIndex
    answeredCount.value++
    if (optionIndex === current.value.correctIndex) {
      correctCount.value++
    }
    phase.value = 'answered'
  }

  function next(): void {
    if (phase.value !== 'answered') {
      return
    }
    if (index.value + 1 >= order.value.length) {
      phase.value = 'finished'
      return
    }
    index.value++
    selectedIndex.value = null
    phase.value = 'question'
  }

  function restart(): void {
    order.value = shuffled(questions, randomInt)
    index.value = 0
    selectedIndex.value = null
    correctCount.value = 0
    answeredCount.value = 0
    phase.value = questions.length === 0 ? 'finished' : 'question'
  }

  return {
    current,
    index: readonly(index),
    total,
    phase: readonly(phase),
    selectedIndex: readonly(selectedIndex),
    isCorrect,
    correctCount: readonly(correctCount),
    answeredCount: readonly(answeredCount),
    answer,
    next,
    restart,
  }
}
