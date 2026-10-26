<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { OPTION_LABELS } from '../config'
import type { Question } from '../types/contest'

type OptionState = 'open' | 'chosen-open' | 'correct' | 'wrong' | 'other'

interface OptionMark {
  symbol: string
  label: string
  color: string
}

interface OptionStyle {
  tile: string
  letter: string
  mark: OptionMark | null
}

const OPTION_STYLES: Record<OptionState, OptionStyle> = {
  open: { tile: 'border-rule bg-card text-ink enabled:hover:border-ink', letter: 'bg-ink', mark: null },
  'chosen-open': { tile: 'border-ink bg-track text-ink', letter: 'bg-ink', mark: null },
  correct: {
    tile: 'border-good bg-good-soft text-ink',
    letter: 'bg-good',
    mark: { symbol: '✓', label: 'Correct answer', color: 'text-good' },
  },
  wrong: {
    tile: 'border-bad bg-bad-soft text-ink',
    letter: 'bg-bad',
    mark: { symbol: '✗', label: 'Chosen answer', color: 'text-bad' },
  },
  other: { tile: 'border-track bg-card text-ink-soft', letter: 'bg-ink-soft', mark: null },
}

const SPARKLE_OFFSETS: readonly { dx: string; dy: string }[] = [
  { dx: '-7rem', dy: '-2.5rem' },
  { dx: '7rem', dy: '-2.5rem' },
  { dx: '-5rem', dy: '2.5rem' },
  { dx: '5rem', dy: '2.5rem' },
  { dx: '0rem', dy: '-3.5rem' },
]

const props = defineProps<{
  question: Question
  revealed: boolean
  chosenIndex: number | null
  canChoose: boolean
  resultTitle: string | null
  isCorrect: boolean | null
}>()

defineEmits<{
  choose: [optionIndex: number]
}>()

const promptHeading = ref<HTMLHeadingElement | null>(null)
const resultHeading = ref<HTMLParagraphElement | null>(null)

const optionViews = computed(() => props.question.options.map((text, index) => ({ text, index, style: OPTION_STYLES[optionState(index)] })))
const resultStyle = computed(() => OPTION_STYLES[props.isCorrect === false ? 'wrong' : 'correct'])

// The correct index is only read once revealed, so the answer never reaches the DOM early.
function optionState(index: number): OptionState {
  if (!props.revealed) {
    return index === props.chosenIndex ? 'chosen-open' : 'open'
  }
  if (index === props.question.correctIndex) {
    return 'correct'
  }
  if (index === props.chosenIndex) {
    return 'wrong'
  }
  return 'other'
}

watch(
  () => props.question.id,
  async () => {
    await nextTick()
    promptHeading.value?.focus()
  },
  { immediate: true },
)

function focusResult(): void {
  resultHeading.value?.focus()
}
</script>

<template>
  <div class="grid gap-5">
    <h2 ref="promptHeading" tabindex="-1" class="border-b-3 border-margin pb-3 text-3xl leading-tight font-bold lg:text-4xl">
      {{ question.prompt }}
    </h2>
    <div class="grid gap-3 md:grid-cols-2" role="group" aria-label="Answer choices">
      <button
        v-for="option in optionViews"
        :key="option.index"
        type="button"
        class="flex min-h-16 items-center gap-4 rounded-tile border-3 px-4 py-2 text-left text-2xl leading-snug font-semibold transition-[border-color,transform] duration-100 enabled:active:translate-y-0.5 disabled:cursor-default"
        :class="option.style.tile"
        :disabled="!canChoose || revealed"
        :aria-pressed="!revealed && canChoose ? option.index === chosenIndex : undefined"
        @click="$emit('choose', option.index)"
      >
        <span class="grid size-11 shrink-0 place-items-center rounded-full font-display text-xl font-extrabold text-white" :class="option.style.letter">
          {{ OPTION_LABELS[option.index] }}
        </span>
        <span class="flex-1">{{ option.text }}</span>
        <template v-if="option.style.mark !== null">
          <span class="shrink-0 animate-stamp font-display text-3xl font-extrabold" :class="option.style.mark.color" aria-hidden="true">
            {{ option.style.mark.symbol }}
          </span>
          <span class="sr-only">{{ option.style.mark.label }}</span>
        </template>
      </button>
    </div>

    <Transition name="result" @after-enter="focusResult">
      <section v-if="revealed" class="grid grid-cols-[auto_1fr] items-start gap-4 rounded-tile border-3 px-5 py-4" :class="resultStyle.tile">
        <span
          class="grid size-14 animate-stamp place-items-center rounded-full font-display text-3xl font-extrabold text-white"
          :class="resultStyle.letter"
          aria-hidden="true"
        >
          {{ resultStyle.mark?.symbol }}
        </span>
        <div>
          <div class="relative inline-block">
            <p ref="resultHeading" tabindex="-1" class="font-display text-3xl leading-tight font-extrabold" :class="resultStyle.mark?.color">
              {{ resultTitle ?? `Answer: ${OPTION_LABELS[question.correctIndex]}` }}
            </p>
            <template v-if="isCorrect === true">
              <span
                v-for="(offset, index) in SPARKLE_OFFSETS"
                :key="`${question.id}-${index}`"
                class="absolute top-1/2 left-1/2 animate-sparkle text-3xl text-gold motion-reduce:hidden"
                :style="{ '--dx': offset.dx, '--dy': offset.dy }"
                aria-hidden="true"
              >
                ✦
              </span>
            </template>
          </div>
          <p class="mt-1 text-2xl leading-normal"><strong>Explanation:</strong> {{ question.explanation }}</p>
        </div>
      </section>
    </Transition>
    <slot />
  </div>
</template>
