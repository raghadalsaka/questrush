<script setup lang="ts">
import IslandGlyph from './IslandGlyph.vue'

defineProps<{
  href: string
  name: string
}>()
</script>

<template>
  <a :href="href" class="panel flex items-center gap-4 p-5 [--edge:5px] transition-transform duration-150 hover:-translate-y-0.5 hover:bg-parchment">
    <IslandGlyph />
    <span class="grid gap-1">
      <span class="font-display text-3xl leading-tight font-extrabold">{{ name }}</span>
      <slot />
    </span>
  </a>
</template>
