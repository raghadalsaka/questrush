<script setup lang="ts">
import { computed } from 'vue'
import type { OfficialSession } from '../composables/useOfficialSession'
import { injectClassroom } from '../composables/useTeacherClassroom'
import PawnBadge from './PawnBadge.vue'
import QuestionCard from './QuestionCard.vue'

const props = defineProps<{
  session: OfficialSession
  classroomSlug: string
}>()

const teacher = injectClassroom()
const stage = computed(() => teacher.activeLevel.value?.stage ?? null)
const student = computed(() => props.session.shownStudent.value)
const question = computed(() => props.session.shownQuestion.value)
const finished = computed(() => props.session.finished.value)
</script>

<template>
  <div class="fixed inset-0 z-20 overflow-y-auto bg-ink/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="turn-heading">
    <div class="panel mx-auto grid max-w-5xl gap-5 p-5 lg:p-8">
      <header class="flex flex-wrap items-center gap-4">
        <PawnBadge v-if="student !== null" :student="student" :classroom-slug="classroomSlug" size="lg" />
        <div class="flex-1">
          <p class="text-lg font-bold text-warn">Official turn · {{ stage?.order }}. {{ stage?.title }}</p>
          <h1 id="turn-heading" class="font-display text-4xl leading-tight font-extrabold">{{ student?.name ?? 'A student' }}'s turn</h1>
        </div>
      </header>

      <p v-if="teacher.actionError.value !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ teacher.actionError.value }}</p>

      <div v-if="session.deckLoading.value" class="text-2xl">Loading the question…</div>
      <div v-else-if="question === null" role="alert" class="notice grid justify-items-start gap-3 border-bad bg-bad-soft">
        <p v-if="session.deckError.value !== ''">{{ session.deckError.value }}</p>
        <p v-else>This turn's question is no longer in the stage file. Draw a different question.</p>
        <button v-if="session.deckError.value !== ''" type="button" class="btn btn-small" @click="session.retryDeck()">Try Again</button>
      </div>
      <QuestionCard
        v-else
        :question="question"
        :revealed="session.revealed.value"
        :chosen-index="finished?.chosenIndex ?? session.chosenIndex.value"
        :can-choose="finished === null && !teacher.busy.value"
        :result-title="null"
        :is-correct="finished === null ? null : finished.outcome === 'correct'"
        @choose="session.answer"
      />

      <div v-if="finished !== null" class="grid gap-3">
        <p class="font-display text-2xl font-extrabold" :class="finished.outcome === 'correct' ? 'text-good' : 'text-bad'" role="status">
          {{ finished.outcome === 'correct' ? `✓ Marked correct · +1 star for ${student?.name ?? 'the student'}` : '✗ Marked incorrect' }}
        </p>
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="btn btn-large btn-primary"
            :disabled="session.pickBlocker.value !== null || teacher.busy.value"
            @click="session.pickNext()"
          >
            Pick Next Student
          </button>
          <button type="button" class="btn btn-large" :disabled="teacher.busy.value" @click="session.dismiss()">Back to Map</button>
          <p v-if="session.pickBlocker.value !== null" class="flex-1 text-lg font-bold">{{ session.pickBlocker.value }}</p>
        </div>
      </div>
      <div v-else class="flex flex-wrap items-center gap-3">
        <p v-if="!session.revealed.value" class="flex-1 text-lg text-ink-soft">
          Tap the option the student chooses. It is marked straight away, and a correct answer earns one star.
        </p>
        <p v-else-if="teacher.busy.value" class="text-lg font-bold" role="status">Saving…</p>
        <button v-else type="button" class="btn btn-large btn-primary" @click="session.saveAgain()">Save Again</button>
      </div>
      <button
        v-if="finished === null && !session.revealed.value"
        type="button"
        class="btn btn-small justify-self-start"
        :disabled="!session.canSwapQuestion.value"
        @click="session.swapQuestion()"
      >
        Different Question
      </button>
      <button v-if="finished === null" type="button" class="btn btn-small justify-self-start" :disabled="teacher.busy.value" @click="session.leaveTurn()">
        Back to Map
      </button>
    </div>
  </div>
</template>
