<script setup lang="ts">
import { computed } from 'vue'
import type { Result, Student } from '../types/api'
import type { Level } from '../types/stage'
import { levelTitle, starsLabel, studentHistory } from '../utils/progress'
import PawnBadge from './PawnBadge.vue'

const props = defineProps<{
  student: Student
  levels: readonly Level[]
  results: readonly Result[]
  classroomSlug: string
}>()

defineEmits<{
  showEveryone: []
}>()

const history = computed(() => studentHistory(props.levels, props.results, props.student.id))
</script>

<template>
  <section class="panel grid gap-4 p-5" aria-labelledby="progress-heading">
    <div class="flex items-center gap-4">
      <PawnBadge :student="student" :classroom-slug="classroomSlug" size="lg" />
      <div class="grid flex-1 gap-1">
        <h2 id="progress-heading" class="font-display text-3xl leading-tight font-extrabold">{{ student.name }}</h2>
        <p class="font-display text-2xl font-extrabold text-warn">★ {{ starsLabel(student.points) }}</p>
      </div>
    </div>
    <ol class="grid gap-2" aria-label="Stage history">
      <li v-for="entry in history" :key="entry.level.order" class="flex items-center gap-3 rounded-tile border-3 px-3 py-2" :class="entry.mark.badge">
        <span class="grid size-9 shrink-0 place-items-center rounded-full border-2 border-current font-display text-xl font-extrabold" aria-hidden="true">
          {{ entry.mark.symbol }}
        </span>
        <span class="flex-1 text-lg font-bold text-ink">{{ entry.level.order }}. {{ levelTitle(entry.level) }}</span>
        <span class="text-base font-bold">{{ entry.mark.label }}</span>
      </li>
    </ol>
    <slot />
    <button type="button" class="btn btn-primary justify-self-start" @click="$emit('showEveryone')">Show Everyone</button>
  </section>
</template>
