<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { injectAuth } from '../composables/useAuth'
import { errorMessage, listClassroomLinks, preloadSignIn } from '../services/api'
import type { ClassroomLink } from '../types/api'
import { routeHash } from '../utils/route'
import BrandIcon from './BrandIcon.vue'
import ClassroomCard from './ClassroomCard.vue'
import CreatorCredit from './CreatorCredit.vue'

const auth = injectAuth()
const classrooms = shallowRef<ClassroomLink[] | null>(null)
const error = ref('')

async function load(): Promise<void> {
  error.value = ''
  try {
    classrooms.value = await listClassroomLinks()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

onMounted(() => {
  preloadSignIn()
  void load()
})
</script>

<template>
  <main class="mx-auto grid max-w-4xl content-start gap-6 px-4 py-8">
    <header class="flex flex-wrap items-center justify-between gap-4">
      <p class="brand-kicker text-xl"><BrandIcon />QuestRush</p>
      <!-- Google sign-in opens its popup inside this submit, so nothing is awaited before auth.login. -->
      <form class="flex flex-wrap items-center gap-2" @submit.prevent="auth.login()">
        <span class="text-base text-ink-soft">Teacher:</span>
        <button type="submit" class="btn btn-small" :disabled="auth.busy.value">{{ auth.busy.value ? 'Signing In…' : 'Sign In' }}</button>
      </form>
    </header>
    <p v-if="auth.error.value !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ auth.error.value }}</p>

    <div class="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
      <h1 class="font-display text-hero">Pick your class</h1>
      <CreatorCredit />
    </div>
    <div v-if="error !== ''" role="alert" class="notice grid justify-items-start gap-2 border-bad bg-bad-soft">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-small" @click="load">Try Again</button>
    </div>
    <p v-else-if="classrooms === null" role="status" class="text-xl">Loading the classes…</p>
    <p v-else-if="classrooms.length === 0" class="text-xl">No classes yet. Ask your teacher for your class link.</p>
    <ul v-else class="grid gap-3 sm:grid-cols-2">
      <li v-for="classroom in classrooms" :key="classroom.slug">
        <ClassroomCard :href="routeHash({ name: 'public', slug: classroom.slug })" :name="classroom.name" />
      </li>
    </ul>
  </main>
</template>
