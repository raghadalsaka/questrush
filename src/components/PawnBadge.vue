<script setup lang="ts">
import { ref, watch } from 'vue'
import { photoUrl } from '../services/api'
import type { Student } from '../types/api'

type BadgeSize = 'sm' | 'md' | 'lg'

const SIZES: Record<BadgeSize, string> = {
  sm: 'size-10 text-xl border-2',
  md: 'size-14 text-3xl border-3',
  lg: 'size-24 text-6xl border-3',
}

const props = defineProps<{
  student: Pick<Student, 'emoji' | 'photoFile'>
  classroomSlug: string
  size?: BadgeSize
}>()

const imageFailed = ref(false)

watch(
  () => props.student.photoFile,
  () => {
    imageFailed.value = false
  },
)
</script>

<template>
  <span class="grid shrink-0 place-items-center overflow-hidden rounded-full border-ink bg-card leading-none" :class="SIZES[size ?? 'md']" aria-hidden="true">
    <img
      v-if="student.photoFile !== null && !imageFailed"
      :src="photoUrl(classroomSlug, student.photoFile)"
      alt=""
      class="size-full object-cover"
      @error="imageFailed = true"
    />
    <span v-else>{{ student.emoji }}</span>
  </span>
</template>
