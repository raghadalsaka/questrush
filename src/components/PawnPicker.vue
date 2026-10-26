<script setup lang="ts">
import type { Student } from '../types/api'
import ModalDialog from './ModalDialog.vue'
import PawnBadge from './PawnBadge.vue'

defineProps<{
  students: readonly Student[]
  classroomSlug: string
}>()

const emit = defineEmits<{
  select: [studentId: string]
  close: []
}>()
</script>

<template>
  <ModalDialog
    :open="students.length > 0"
    labelled-by="pawn-picker-title"
    class="w-[min(40rem,calc(100vw-2rem))] p-6"
    @cancel="emit('close')"
  >
    <div class="flex items-center justify-between gap-3">
      <h2 id="pawn-picker-title" class="font-display text-3xl leading-tight font-extrabold">Find your pawn</h2>
      <button type="button" class="btn btn-small" @click="emit('close')">Close</button>
    </div>
    <ul class="mt-4 grid max-h-[60dvh] gap-2 overflow-y-auto sm:grid-cols-2">
      <li v-for="student in students" :key="student.id">
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 rounded-tile border-3 border-rule bg-card px-3 py-1 text-left hover:border-ink"
          @click="emit('select', student.id)"
        >
          <PawnBadge :student="student" :classroom-slug="classroomSlug" size="sm" />
          <span class="flex-1 text-lg leading-tight font-bold">{{ student.name }}</span>
        </button>
      </li>
    </ul>
  </ModalDialog>
</template>
