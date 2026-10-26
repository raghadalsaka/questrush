<script setup lang="ts">
import { injectClassroom } from '../composables/useTeacherClassroom'
import { api } from '../services/api'
import { catalog, levelForSlug, levels } from '../services/game'
import type { Level, StageInfo } from '../types/stage'
import { levelTitle, STAGE_MARKS } from '../utils/progress'
import { eligibleStudents, questionShortage } from '../utils/selection'

const emit = defineEmits<{
  sessionStarted: []
}>()

const teacher = injectClassroom()

// Before the session: unused questions in the stage file against students still without a result.
// A stage every student has played is finished: it can't be opened again or made current (the server agrees).
function readiness(stage: StageInfo): { remaining: number; available: number; shortage: number; played: boolean; finished: boolean } {
  const classroom = teacher.classroom.value
  const remaining = classroom === null ? 0 : eligibleStudents(classroom.students, classroom.results, stage.slug, []).length
  const used = classroom?.usedQuestionIds[stage.slug] ?? []
  const available = Math.max(0, stage.questionCount - used.length)
  const finished = (classroom?.students.length ?? 0) > 0 && remaining === 0
  return { remaining, available, shortage: questionShortage(available, remaining), played: used.length > 0, finished }
}

function stateNote(level: Level): string {
  if (level.state === 'missing') {
    return 'No stage file for this level yet.'
  }
  if (level.state === 'locked') {
    return 'Locked in its stage file. Set "unlocked" to true and publish the site to open it.'
  }
  return ''
}

function isCurrent(stage: StageInfo): boolean {
  return teacher.classroom.value?.progress.currentStageSlug === stage.slug
}

// Starting a stage beyond the class's current one moves the class forward; reopening an earlier stage does not.
async function startSession(stage: StageInfo): Promise<void> {
  const classroom = teacher.classroom.value
  if (classroom === null || !(await teacher.run(() => api.openSession(classroom.slug, stage.slug)))) {
    return
  }
  const current = classroom.progress.currentStageSlug === null ? null : levelForSlug(classroom.progress.currentStageSlug)
  if (current === null || current.order < stage.order) {
    await teacher.run(() => api.setCurrentStage(classroom.slug, stage.slug))
  }
  emit('sessionStarted')
}

async function makeCurrent(stage: StageInfo): Promise<void> {
  const classroom = teacher.classroom.value
  if (classroom !== null) {
    await teacher.run(() => api.setCurrentStage(classroom.slug, stage.slug))
  }
}
</script>

<template>
  <section class="grid gap-4" aria-labelledby="levels-heading">
    <div>
      <h2 id="levels-heading" class="font-display text-2xl font-extrabold">Stages</h2>
      <p class="text-base text-ink-soft">{{ catalog.settings.title }} has {{ levels.length }} levels. Stages come from the site's stage files.</p>
    </div>
    <ol class="grid gap-3">
      <li
        v-for="level in levels"
        :key="level.order"
        class="grid gap-2 rounded-tile border-3 p-4"
        :class="level.state === 'open' ? 'border-ink bg-card' : 'border-dashed border-locked bg-board'"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <h3 class="font-display text-xl font-extrabold" :class="level.state === 'open' ? '' : 'text-ink-soft'">
            {{ level.order }}. {{ levelTitle(level) }}
            <span v-if="level.stage !== null && isCurrent(level.stage)" class="ml-1 text-base font-bold text-warn">🚩 Class is here</span>
          </h3>
          <span
            class="rounded-full border-2 px-2 py-0.5 text-sm font-bold"
            :class="level.state === 'open' ? 'border-good bg-good-soft text-good-deep' : STAGE_MARKS[level.state].badge"
          >
            {{ level.state === 'open' ? 'Open' : `${STAGE_MARKS[level.state].symbol} ${STAGE_MARKS[level.state].label}` }}
          </span>
        </div>
        <template v-if="level.stage !== null">
          <p v-if="level.stage.description !== ''" class="text-lg">{{ level.stage.description }}</p>
          <p class="text-base text-ink-soft">{{ level.stage.questionCount }} questions</p>
        </template>
        <p v-if="level.state !== 'open'" class="text-base text-ink-soft">{{ stateNote(level) }}</p>
        <template v-else-if="level.stage !== null && readiness(level.stage).finished">
          <p class="text-base font-bold text-good-deep">
            ✓ Finished: every student has played this stage.
            <span v-if="teacher.activeSession.value?.stageSlug === level.stage.slug" class="text-warn">Session open</span>
          </p>
        </template>
        <template v-else-if="level.stage !== null">
          <p class="text-base">
            {{ readiness(level.stage).available }} unused questions for {{ readiness(level.stage).remaining }} students without a result.
          </p>
          <p v-if="readiness(level.stage).shortage > 0" class="notice border-warn bg-warn-soft text-base">
            Not enough questions: {{ readiness(level.stage).shortage }} {{ readiness(level.stage).shortage === 1 ? 'student' : 'students' }} can't get a turn unless questions are added to the stage file.
          </p>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="teacher.activeSession.value === null"
              type="button"
              class="btn btn-small btn-primary"
              :disabled="teacher.busy.value"
              @click="startSession(level.stage)"
            >
              {{ readiness(level.stage).played ? 'Reopen Session' : 'Start Session' }}
            </button>
            <span v-else-if="teacher.activeSession.value.stageSlug === level.stage.slug" class="self-center font-bold text-warn">Session open</span>
            <button v-if="!isCurrent(level.stage)" type="button" class="btn btn-small" :disabled="teacher.busy.value" @click="makeCurrent(level.stage)">
              Make Current Stage
            </button>
          </div>
        </template>
      </li>
    </ol>
  </section>
</template>
