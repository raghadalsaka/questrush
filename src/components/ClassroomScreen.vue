<script setup lang="ts">
import { computed, nextTick, onMounted, provide, ref, watch } from 'vue'
import { useOfficialSession } from '../composables/useOfficialSession'
import { classroomKey, useTeacherClassroom } from '../composables/useTeacherClassroom'
import { api, publicLink } from '../services/api'
import { levels } from '../services/game'
import { routeHash } from '../utils/route'
import AdventureMap from './AdventureMap.vue'
import LevelsPanel from './LevelsPanel.vue'
import MapLegend from './MapLegend.vue'
import MessagePanel from './MessagePanel.vue'
import OfficialTurn from './OfficialTurn.vue'
import SessionPanel from './SessionPanel.vue'
import StudentEditor from './StudentEditor.vue'
import StudentList from './StudentList.vue'
import StudentProgressPanel from './StudentProgressPanel.vue'

type Tab = 'session' | 'stages' | 'students'

const TAB_LABELS: Record<Tab, string> = { session: 'Session', stages: 'Stages', students: 'Students' }

const props = defineProps<{
  classroomSlug: string
}>()

const teacher = useTeacherClassroom(props.classroomSlug)
provide(classroomKey, teacher)
const official = useOfficialSession(teacher)

const selectedId = ref<string | null>(null)
const tab = ref<Tab>('stages')
const studentList = ref<InstanceType<typeof StudentList> | null>(null)

const classroom = computed(() => teacher.classroom.value)
const session = computed(() => teacher.activeSession.value)
const selectedStudent = computed(() => classroom.value?.students.find((student) => student.id === selectedId.value) ?? null)
const tabs = computed<Tab[]>(() => (session.value === null ? ['stages', 'students'] : ['session', 'stages', 'students']))
const shareLink = computed(() => (classroom.value === null ? '' : publicLink(classroom.value.slug)))

watch(
  () => session.value?.id ?? null,
  (id) => {
    tab.value = id === null ? (tab.value === 'session' ? 'stages' : tab.value) : 'session'
  },
)

onMounted(teacher.load)

async function showList(): Promise<void> {
  tab.value = 'students'
  await nextTick()
  studentList.value?.focus()
}

function toggleSelected(studentId: string): void {
  selectedId.value = selectedId.value === studentId ? null : studentId
}

function setAbsent(studentId: string, absent: boolean): void {
  const current = session.value
  if (current !== null) {
    void teacher.run(() => api.setAbsent(current.id, studentId, absent))
  }
}
</script>

<template>
  <MessagePanel v-if="teacher.loadError.value !== ''" title="The classroom couldn't be loaded" :message="teacher.loadError.value">
    <div class="flex gap-3">
      <button type="button" class="btn btn-primary" @click="teacher.load()">Try Again</button>
      <a :href="routeHash({ name: 'classrooms' })" class="btn">All Classrooms</a>
    </div>
  </MessagePanel>
  <p v-else-if="classroom === null" class="p-8 text-xl" role="status">Loading…</p>
  <main v-else class="grid gap-4 px-3 py-4 lg:grid-cols-[minmax(0,1fr)_30rem] lg:px-6">
    <header class="flex flex-wrap items-center gap-x-6 gap-y-2 lg:col-span-2">
      <a :href="routeHash({ name: 'classrooms' })" class="text-lg font-bold text-sea-deep underline">All classrooms</a>
      <h1 class="flex-1 font-display text-4xl leading-tight font-extrabold">{{ classroom.name }}</h1>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base text-ink-soft">Student link:</span>
        <a :href="shareLink" target="_blank" rel="noopener" class="btn btn-small">Open</a>
      </div>
    </header>

    <section class="grid content-start gap-3" aria-label="Adventure map">
      <AdventureMap
        :levels="levels"
        :students="classroom.students"
        :results="classroom.results"
        :classroom-slug="classroom.slug"
        :selected-student-id="selectedId"
        :active-stage-slug="session?.stageSlug ?? null"
        :current-stage-slug="classroom.progress.currentStageSlug"
        :spotlight-id="official.spotlightId.value"
        :turn-student-id="official.pendingTurn.value?.studentId ?? null"
        :celebrate-id="official.celebrateId.value"
        @select-student="toggleSelected"
        @select-level="tab = 'stages'"
        @show-list="showList"
      />
      <div class="flex flex-wrap items-center justify-between gap-2">
        <MapLegend />
        <button v-if="selectedId !== null" type="button" class="btn btn-small" @click="selectedId = null">Show Everyone</button>
      </div>
    </section>

    <aside class="grid content-start gap-4 lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto lg:pr-1">
      <p v-if="teacher.actionError.value !== '' && !official.showCard.value" role="alert" class="notice flex items-start gap-3 border-bad bg-bad-soft">
        <span class="flex-1">{{ teacher.actionError.value }}</span>
        <button type="button" class="btn btn-small" @click="teacher.clearError()">OK</button>
      </p>

      <StudentProgressPanel
        v-if="selectedStudent !== null"
        :student="selectedStudent"
        :levels="levels"
        :results="classroom.results"
        :classroom-slug="classroom.slug"
        @show-everyone="selectedId = null"
      >
        <StudentEditor :student="selectedStudent" @deleted="selectedId = null" />
      </StudentProgressPanel>

      <div class="panel grid gap-4 p-4">
        <div class="flex gap-2" role="tablist" aria-label="Classroom controls">
          <button
            v-for="name in tabs"
            :key="name"
            type="button"
            role="tab"
            class="btn btn-small flex-1"
            :class="tab === name ? 'btn-primary' : ''"
            :aria-selected="tab === name"
            @click="tab = name"
          >
            {{ TAB_LABELS[name] }}
          </button>
        </div>

        <div v-if="tab === 'session' && session !== null" role="tabpanel" class="grid gap-6">
          <SessionPanel :session="official" />
        </div>
        <div v-else-if="tab === 'stages'" role="tabpanel">
          <LevelsPanel @session-started="tab = 'session'" />
        </div>
        <div v-else role="tabpanel" class="grid gap-6">
          <StudentList
            ref="studentList"
            :students="classroom.students"
            :results="classroom.results"
            :classroom-slug="classroom.slug"
            :selected-id="selectedId"
            :stage-slug="session?.stageSlug ?? null"
            :absent-ids="session?.absentStudentIds ?? []"
            :turn-student-id="official.pendingTurn.value?.studentId ?? null"
            :attendance="session !== null"
            :disabled="teacher.busy.value"
            @select="toggleSelected"
            @toggle-absent="setAbsent"
          />
        </div>
      </div>
    </aside>

    <OfficialTurn v-if="official.showCard.value" :session="official" :classroom-slug="classroom.slug" />
  </main>
</template>
