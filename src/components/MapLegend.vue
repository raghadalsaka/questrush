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
    <li class="flex items-center gap-1.5 rounded-full border-2 border-gold-deep bg-warn-soft px-2 py-0.5 font-bold text-ink">
      <svg viewBox="-16 -16 32 32" class="size-5" aria-hidden="true">
        <circle r="13" class="fill-gold stroke-ink" stroke-width="3" />
        <path d="M-6 0 L-1.5 5 L7 -5" class="fill-none stroke-ink" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      Everyone played
    </li>
    <li class="flex items-center gap-1.5 rounded-full border-2 border-coral-deep bg-card px-2 py-0.5 font-bold text-ink">
      <svg viewBox="-2 -48 32 54" class="h-5 w-4" aria-hidden="true">
        <path d="M0 4 V-44" class="stroke-wood-shade" stroke-width="4.5" stroke-linecap="round" />
        <path d="M2 -42 Q14 -47 28 -40 Q18 -34 28 -27 Q14 -32 2 -27 Z" class="fill-coral stroke-ink" stroke-width="2.5" stroke-linejoin="round" />
      </svg>
      Class is here
    </li>
  </ul>
</template>
