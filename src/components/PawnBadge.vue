<script setup lang="ts">
import { computed } from 'vue'
import type { Student } from '../types/api'
import { isPhotoUrl } from '../utils/photo'

type BadgeSize = 'sm' | 'lg'

const SIZES: Record<BadgeSize, string> = {
  sm: 'size-10 text-xl border-2',
  lg: 'size-24 text-6xl border-3',
}

const props = defineProps<{
  student: Pick<Student, 'emoji' | 'photo'>
  size: BadgeSize
}>()

const photo = computed(() => (isPhotoUrl(props.student.photo) ? props.student.photo : null))
</script>

<template>
  <span class="grid shrink-0 place-items-center overflow-hidden rounded-full border-ink bg-card leading-none" :class="SIZES[size]" aria-hidden="true">
    <img v-if="photo !== null" :src="photo" alt="" class="size-full object-cover" />
    <span v-else>{{ student.emoji }}</span>
  </span>
</template>
