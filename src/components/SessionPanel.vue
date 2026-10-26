<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OfficialSession } from '../composables/useOfficialSession'
import { injectClassroom } from '../composables/useTeacherClassroom'
import { api } from '../services/api'
import ConfirmDialog from './ConfirmDialog.vue'

defineProps<{
  session: OfficialSession
}>()

const teacher = injectClassroom()
const confirmClose = ref(false)

const stage = computed(() => teacher.activeLevel.value?.stage ?? null)
const assessedCount = computed(() => {
  const stageSlug = teacher.activeSession.value?.stageSlug
  return teacher.classroom.value?.results.filter((result) => result.stageSlug === stageSlug).length ?? 0
})
const absentCount = computed(() => teacher.activeSession.value?.absentStudentIds.length ?? 0)
const studentCount = computed(() => teacher.classroom.value?.students.length ?? 0)

async function close(): Promise<void> {
  confirmClose.value = false
  const current = teacher.activeSession.value
  if (current !== null) {
    await teacher.run(() => api.closeSession(current.id))
  }
}
</script>

<template>
  <section v-if="stage !== null" class="grid gap-4" aria-labelledby="session-heading">
    <div>
      <p class="text-lg font-bold text-warn">Official session</p>
      <h2 id="session-heading" class="font-display text-3xl leading-tight font-extrabold">{{ stage.order }}. {{ stage.title }}</h2>
    </div>
    <dl class="grid grid-cols-3 gap-2 text-center">
      <div class="rounded-tile border-3 border-rule p-2">
        <dt class="text-base text-ink-soft">Had a turn</dt>
        <dd class="font-display text-3xl font-extrabold">{{ assessedCount }}/{{ studentCount }}</dd>
      </div>
      <div class="rounded-tile border-3 border-rule p-2">
        <dt class="text-base text-ink-soft">Waiting</dt>
        <dd class="font-display text-3xl font-extrabold">{{ session.eligible.value.length }}</dd>
      </div>
      <div class="rounded-tile border-3 border-rule p-2">
        <dt class="text-base text-ink-soft">Questions left</dt>
        <dd class="font-display text-3xl font-extrabold">{{ session.deck.value === null ? '…' : session.unused.value.length }}</dd>
      </div>
    </dl>
    <p v-if="absentCount > 0" class="text-lg text-ink-soft">{{ absentCount }} marked away for this session.</p>

    <div v-if="session.deckError.value !== ''" role="alert" class="notice grid justify-items-start gap-2 border-bad bg-bad-soft">
      <p>{{ session.deckError.value }}</p>
      <button type="button" class="btn btn-small" @click="session.retryDeck()">Try Again</button>
    </div>
    <p v-if="session.shortage.value > 0 && session.unused.value.length > 0" class="notice border-warn bg-warn-soft">
      Only {{ session.unused.value.length }} questions are left for {{ session.eligible.value.length }} waiting students.
    </p>
    <p v-if="session.missingIds.value.length > 0" class="notice border-warn bg-warn-soft">
      The stage file changed after turns began: {{ session.missingIds.value.length }} used questions are no longer in it.
      Used questions still won't repeat.
    </p>

    <button
      type="button"
      class="btn btn-large btn-primary"
      :disabled="session.pickBlocker.value !== null || session.phase.value !== 'idle' || teacher.busy.value"
      @click="session.pick()"
    >
      {{ session.phase.value === 'picking' ? 'Picking…' : 'Pick a Student' }}
    </button>
    <p v-if="session.pickBlocker.value !== null && session.pendingTurn.value === null" class="text-lg font-bold" role="status">
      {{ session.pickBlocker.value }}
    </p>
    <button type="button" class="btn justify-self-start" :disabled="teacher.busy.value" @click="confirmClose = true">
      Close Session
    </button>

    <ConfirmDialog
      :open="confirmClose"
      title="Close this session?"
      message="Official turns stop. Results are kept, and you can reopen the stage later for students who haven't had a turn."
      confirm-label="Close Session"
      @confirm="close"
      @cancel="confirmClose = false"
    />
  </section>
</template>
