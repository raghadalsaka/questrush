<script setup lang="ts">
import { computed } from 'vue'
import { usePractice } from '../composables/usePractice'
import type { Question } from '../types/contest'
import QuestionCard from './QuestionCard.vue'

const props = defineProps<{
  questions: readonly Question[]
  title: string
  mapLink: string
}>()

const practice = usePractice(props.questions)
const resultTitle = computed(() => (practice.isCorrect.value ? 'Correct!' : 'Not quite'))
</script>

<template>
  <section class="panel grid gap-5 p-5 lg:p-8" aria-labelledby="practice-title">
    <header class="flex flex-wrap items-baseline justify-between gap-2">
      <h1 id="practice-title" class="font-display text-3xl leading-tight font-extrabold">{{ title }}</h1>
      <p class="font-display text-xl font-extrabold" aria-live="polite">
        Practice score: {{ practice.correctCount.value }} of {{ practice.answeredCount.value }}
      </p>
    </header>

    <template v-if="practice.phase.value !== 'finished' && practice.current.value !== null">
      <p class="text-lg text-ink-soft">Question {{ practice.index.value + 1 }} of {{ practice.total.value }}</p>
      <QuestionCard
        :question="practice.current.value"
        :revealed="practice.phase.value === 'answered'"
        :chosen-index="practice.selectedIndex.value"
        :can-choose="practice.phase.value === 'question'"
        :result-title="resultTitle"
        :is-correct="practice.phase.value === 'answered' ? practice.isCorrect.value : null"
        @choose="practice.answer"
      >
        <button v-if="practice.phase.value === 'answered'" type="button" class="btn btn-primary btn-large justify-self-start" @click="practice.next()">
          {{ practice.index.value + 1 >= practice.total.value ? 'See My Score' : 'Next Question' }}
        </button>
      </QuestionCard>
    </template>

    <div v-else class="grid justify-items-start gap-4" role="status">
      <p class="font-display text-4xl font-extrabold">You got {{ practice.correctCount.value }} of {{ practice.total.value }} right.</p>
      <div class="flex flex-wrap gap-3">
        <button type="button" class="btn btn-primary btn-large" @click="practice.restart()">Practise Again</button>
        <a :href="mapLink" class="btn btn-large">Back to the Map</a>
      </div>
    </div>
  </section>
</template>
