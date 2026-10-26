<script setup lang="ts">
import { STAGE_MARKS } from '../utils/progress'

const ENTRIES = [STAGE_MARKS.correct, STAGE_MARKS.incorrect, STAGE_MARKS.none, STAGE_MARKS.locked, STAGE_MARKS.missing]
</script>

<template>
  <ul class="flex flex-wrap gap-2 text-base" aria-label="Map key">
    <li v-for="entry in ENTRIES" :key="entry.kind" class="flex items-center gap-1 rounded-full border-2 px-2 py-0.5 font-bold" :class="entry.badge">
      <span aria-hidden="true">{{ entry.symbol }}</span>
      {{ entry.label }}
    </li>
  </ul>
</template>
