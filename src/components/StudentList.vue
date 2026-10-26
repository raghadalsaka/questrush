<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Outcome, Result, Student } from '../types/api'
import { starsLabel, STAGE_MARKS } from '../utils/progress'
import PawnBadge from './PawnBadge.vue'

type RowStatus = 'correct' | 'incorrect' | 'turn' | 'away' | 'waiting'

const STATUS_STYLES: Record<RowStatus, { label: string; badge: string }> = {
  correct: { label: `${STAGE_MARKS.correct.symbol} Correct`, badge: STAGE_MARKS.correct.badge },
  incorrect: { label: `${STAGE_MARKS.incorrect.symbol} Incorrect`, badge: STAGE_MARKS.incorrect.badge },
  turn: { label: 'On turn', badge: 'border-gold-deep bg-warn-soft text-warn' },
  away: { label: 'Away', badge: 'border-locked bg-locked-soft text-ink-soft' },
  waiting: { label: 'Waiting', badge: 'border-rule bg-card text-ink-soft' },
}

const FILTER_THRESHOLD: number = 10

const props = defineProps<{
  students: readonly Student[]
  results: readonly Result[]
  classroomSlug: string
  selectedId: string | null
  stageSlug?: string | null
  absentIds?: readonly string[]
  turnStudentId?: string | null
  attendance?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [studentId: string]
  toggleAbsent: [studentId: string, absent: boolean]
}>()

const filter = ref('')
const listHeading = ref<HTMLHeadingElement | null>(null)

const visible = computed(() => {
  const query = filter.value.trim().toLocaleLowerCase()
  return query === '' ? props.students : props.students.filter((student) => student.name.toLocaleLowerCase().includes(query))
})

// Each row asks for its status and absence several times, so both are looked up once per change.
const stageOutcomes = computed<Map<string, Outcome>>(() => {
  const stageSlug = props.stageSlug ?? null
  return new Map(props.results.filter((result) => result.stageSlug === stageSlug).map((result) => [result.studentId, result.outcome]))
})
const absent = computed<Set<string>>(() => new Set(props.absentIds ?? []))

function status(student: Student): RowStatus | null {
  if ((props.stageSlug ?? null) === null) {
    return null
  }
  const outcome = stageOutcomes.value.get(student.id)
  if (outcome !== undefined) {
    return outcome
  }
  if (student.id === props.turnStudentId) {
    return 'turn'
  }
  if (absent.value.has(student.id)) {
    return 'away'
  }
  return 'waiting'
}

function isAbsent(student: Student): boolean {
  return absent.value.has(student.id)
}

function focus(): void {
  listHeading.value?.focus()
}

defineExpose({ focus })
</script>

<template>
  <section class="grid gap-3" aria-labelledby="student-list-heading">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 id="student-list-heading" ref="listHeading" tabindex="-1" class="font-display text-2xl font-extrabold">
        Students <span class="text-ink-soft">({{ students.length }})</span>
      </h2>
      <label v-if="students.length > FILTER_THRESHOLD" class="w-full sm:w-56">
        <span class="sr-only">Find a student</span>
        <input v-model="filter" type="search" class="field-input py-1 text-lg" placeholder="Find a student" />
      </label>
    </div>
    <p v-if="students.length === 0" class="text-lg text-ink-soft">No students yet.</p>
    <ul class="grid gap-2">
      <li v-for="student in visible" :key="student.id" class="flex items-center gap-2">
        <button
          type="button"
          class="flex min-h-14 flex-1 items-center gap-3 rounded-tile border-3 px-3 py-1 text-left transition-colors"
          :class="student.id === selectedId ? 'border-sea-deep bg-sea-foam' : 'border-rule bg-card hover:border-ink'"
          :aria-pressed="student.id === selectedId"
          @click="emit('select', student.id)"
        >
          <PawnBadge :student="student" :classroom-slug="classroomSlug" size="sm" />
          <span class="flex-1 text-lg leading-tight font-bold">{{ student.name }}</span>
          <span class="font-display text-lg font-extrabold whitespace-nowrap text-warn" :aria-label="starsLabel(student.points)">★ {{ student.points }}</span>
        </button>
        <span
          v-if="status(student) !== null"
          class="hidden rounded-full border-2 px-2 py-0.5 text-sm font-bold whitespace-nowrap sm:inline-block"
          :class="STATUS_STYLES[status(student) as RowStatus].badge"
        >
          {{ STATUS_STYLES[status(student) as RowStatus].label }}
        </span>
        <button
          v-if="attendance"
          type="button"
          class="btn btn-small w-24"
          :disabled="disabled || student.id === turnStudentId"
          :aria-pressed="isAbsent(student)"
          :aria-label="isAbsent(student) ? `${student.name} is away. Mark as here.` : `${student.name} is here. Mark as away.`"
          @click="emit('toggleAbsent', student.id, !isAbsent(student))"
        >
          {{ isAbsent(student) ? 'Away' : 'Here' }}
        </button>
      </li>
    </ul>
    <p v-if="visible.length === 0 && students.length > 0" class="text-lg text-ink-soft">No student matches “{{ filter }}”.</p>
  </section>
</template>
