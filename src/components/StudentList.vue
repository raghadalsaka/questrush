<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Outcome, Result, Student } from '../types/api'
import { starsLabel, STAGE_MARKS } from '../utils/progress'
import PawnBadge from './PawnBadge.vue'

type RowStatus = 'correct' | 'incorrect' | 'turn' | 'away' | 'waiting'

const STATUS_STYLES: Record<RowStatus, { label: string; badge: string }> = {
  correct: { label: `${STAGE_MARKS.correct.symbol} ${STAGE_MARKS.correct.label}`, badge: STAGE_MARKS.correct.badge },
  incorrect: { label: `${STAGE_MARKS.incorrect.symbol} ${STAGE_MARKS.incorrect.label}`, badge: STAGE_MARKS.incorrect.badge },
  turn: { label: 'On turn', badge: 'border-gold-deep bg-warn-soft text-warn' },
  away: { label: 'Away', badge: 'border-locked bg-locked-soft text-ink-soft' },
  waiting: { label: 'Waiting', badge: 'border-rule bg-card text-ink-soft' },
}

const FILTER_THRESHOLD: number = 10

const props = defineProps<{
  students: readonly Student[]
  results: readonly Result[]
  selectedId: string | null
  stageSlug: string | null
  absentIds: readonly string[]
  turnStudentId: string | null
  attendance: boolean
  disabled: boolean
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

const rows = computed<{ student: Student; status: RowStatus | null; absent: boolean }[]>(() => {
  const outcomes = new Map<string, Outcome>(props.results.filter((result) => result.stageSlug === props.stageSlug).map((result) => [result.studentId, result.outcome]))
  const absent = new Set(props.absentIds)
  return visible.value.map((student) => ({ student, status: rowStatus(student, outcomes, absent), absent: absent.has(student.id) }))
})

function rowStatus(student: Student, outcomes: ReadonlyMap<string, Outcome>, absent: ReadonlySet<string>): RowStatus | null {
  if (props.stageSlug === null) {
    return null
  }
  const outcome = outcomes.get(student.id)
  if (outcome !== undefined) {
    return outcome
  }
  if (student.id === props.turnStudentId) {
    return 'turn'
  }
  if (absent.has(student.id)) {
    return 'away'
  }
  return 'waiting'
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
      <li v-for="{ student, status, absent } in rows" :key="student.id" class="flex items-center gap-2">
        <button
          type="button"
          class="flex min-h-14 flex-1 items-center gap-3 rounded-tile border-3 px-3 py-1 text-left transition-colors"
          :class="student.id === selectedId ? 'border-sea-deep bg-sea-foam' : 'border-rule bg-card hover:border-ink'"
          :aria-pressed="student.id === selectedId"
          @click="emit('select', student.id)"
        >
          <PawnBadge :student="student" size="sm" />
          <span class="flex-1 text-lg leading-tight font-bold">{{ student.name }}</span>
          <span class="font-display text-lg font-extrabold whitespace-nowrap text-warn" :aria-label="starsLabel(student.points)">★ {{ student.points }}</span>
        </button>
        <span
          v-if="status !== null"
          class="hidden rounded-full border-2 px-2 py-0.5 text-sm font-bold whitespace-nowrap sm:inline-block"
          :class="STATUS_STYLES[status].badge"
        >
          {{ STATUS_STYLES[status].label }}
        </span>
        <button
          v-if="attendance"
          type="button"
          class="btn btn-small w-24"
          :disabled="disabled || student.id === turnStudentId"
          :aria-pressed="absent"
          :aria-label="absent ? `${student.name} is away. Mark as here.` : `${student.name} is here. Mark as away.`"
          @click="emit('toggleAbsent', student.id, !absent)"
        >
          {{ absent ? 'Away' : 'Here' }}
        </button>
      </li>
    </ul>
    <p v-if="visible.length === 0 && students.length > 0" class="text-lg text-ink-soft">No student matches “{{ filter }}”.</p>
  </section>
</template>
