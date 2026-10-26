<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { navigateTo } from '../composables/useHashRoute'
import { usePublicClassroom } from '../composables/usePublicClassroom'
import { levels } from '../services/game'
import type { Student } from '../types/api'
import { levelTitle } from '../utils/progress'
import AdventureMap from './AdventureMap.vue'
import MapLegend from './MapLegend.vue'
import MessagePanel from './MessagePanel.vue'
import PawnPicker from './PawnPicker.vue'
import StudentProgressPanel from './StudentProgressPanel.vue'

const props = defineProps<{
  classroomSlug: string
}>()

const { classroom, error, load } = usePublicClassroom(props.classroomSlug)
const selectedId = ref<string | null>(null)
const lockedNotice = ref('')
const hiddenStudents = ref<readonly Student[]>([])
const progressPanel = ref<InstanceType<typeof StudentProgressPanel> | null>(null)

const selectedStudent = computed(() => classroom.value?.students.find((student) => student.id === selectedId.value) ?? null)

onMounted(load)

// On a phone the panel sits below the map, so bring the chosen student's progress into view.
watch(selectedId, async (id) => {
  if (id === null) {
    return
  }
  await nextTick()
  const element: unknown = progressPanel.value?.$el
  if (element instanceof HTMLElement) {
    element.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
})

function selectLevel(order: number): void {
  const level = levels.find((candidate) => candidate.order === order)
  if (level === undefined) {
    return
  }
  if (level.stage === null || level.state !== 'open') {
    lockedNotice.value = level.state === 'missing' ? '' : `${levelTitle(level)} is still locked.`
    return
  }
  navigateTo({ name: 'practice', slug: props.classroomSlug, stageSlug: level.stage.slug })
}

function toggleSelected(studentId: string): void {
  selectedId.value = selectedId.value === studentId ? null : studentId
}

function pickHidden(studentId: string): void {
  selectedId.value = studentId
  hiddenStudents.value = []
}
</script>

<template>
  <MessagePanel v-if="error !== ''" title="This classroom couldn't be opened" :message="error">
    <button type="button" class="btn btn-primary" @click="load()">Try Again</button>
  </MessagePanel>
  <p v-else-if="classroom === null" class="p-8 text-xl" role="status">Loading…</p>
  <main v-else class="grid gap-4 px-3 py-4 lg:grid-cols-[minmax(0,1fr)_28rem] lg:px-6">
    <header class="lg:col-span-2">
      <h1 class="font-display text-xl font-extrabold text-sea-deep">QuestRush</h1>
      <p class="text-lg">Tap your pawn to see your progress. Tap an open stage to practise at home.</p>
    </header>

    <section class="grid content-start gap-3" aria-label="Adventure map">
      <AdventureMap
        :levels="levels"
        :current-stage-slug="classroom.currentStageSlug"
        :students="classroom.students"
        :results="classroom.results"
        :classroom-slug="classroomSlug"
        :selected-student-id="selectedId"
        @select-student="toggleSelected"
        @select-level="selectLevel"
        @show-list="hiddenStudents = $event"
      />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <MapLegend />
        <button v-if="selectedId !== null" type="button" class="btn btn-small" @click="selectedId = null">Show Everyone</button>
      </div>
      <p v-if="lockedNotice !== ''" role="status" class="notice border-locked bg-locked-soft">{{ lockedNotice }}</p>
    </section>

    <aside class="grid content-start gap-4">
      <section class="panel p-4" aria-labelledby="classroom-name">
        <p class="text-base font-bold text-ink-soft">Classroom</p>
        <h2 id="classroom-name" class="font-display text-3xl leading-tight font-extrabold">{{ classroom.name }}</h2>
      </section>
      <StudentProgressPanel
        v-if="selectedStudent !== null"
        ref="progressPanel"
        :student="selectedStudent"
        :levels="levels"
        :results="classroom.results"
        :classroom-slug="classroomSlug"
        @show-everyone="selectedId = null"
      />
    </aside>
    <PawnPicker :students="hiddenStudents" :classroom-slug="classroomSlug" @select="pickHidden" @close="hiddenStudents = []" />
  </main>
</template>
