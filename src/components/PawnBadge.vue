<script setup lang="ts">
import type { Student } from '../types/api'

type BadgeSize = 'sm' | 'lg'

const SIZES: Record<BadgeSize, string> = {
  sm: 'size-10 text-xl border-2',
  lg: 'size-24 text-6xl border-3',
}

defineProps<{
  student: Pick<Student, 'emoji'>
  size: BadgeSize
}>()
</script>

<template>
  <span class="grid shrink-0 place-items-center overflow-hidden rounded-full border-ink bg-card leading-none" :class="SIZES[size]" aria-hidden="true">
    <span>{{ student.emoji }}</span>
  </span>
</template>
