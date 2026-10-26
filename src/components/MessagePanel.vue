<script setup lang="ts">
defineProps<{
  title: string
  message: string
  tone?: 'bad' | 'ink'
}>()
</script>

<template>
  <main class="mx-auto max-w-3xl px-4 py-12">
    <section role="alert" class="panel grid justify-items-start gap-4 p-8">
      <h1 class="font-display text-4xl leading-tight font-extrabold" :class="tone === 'ink' ? 'text-ink' : 'text-bad'">{{ title }}</h1>
      <p class="text-xl">{{ message }}</p>
      <slot />
    </section>
  </main>
</template>
