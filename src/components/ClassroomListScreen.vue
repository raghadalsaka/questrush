<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import { injectAuth } from '../composables/useAuth'
import { api, errorMessage } from '../services/api'
import type { ClassroomSummary } from '../types/api'
import { routeHash } from '../utils/route'

const auth = injectAuth()
const classrooms = shallowRef<ClassroomSummary[] | null>(null)
const error = ref('')

async function load(): Promise<void> {
  error.value = ''
  try {
    classrooms.value = await api.listClassrooms()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

onMounted(load)
</script>

<template>
  <main class="mx-auto grid max-w-4xl gap-6 px-4 py-8">
    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p class="font-display text-2xl font-extrabold text-sea-deep">QuestRush</p>
        <h1 class="font-display text-5xl leading-tight font-extrabold">Your classrooms</h1>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="button" class="btn btn-small" @click="auth.logout()">Sign Out</button>
      </div>
    </header>

    <a :href="routeHash({ name: 'new-classroom' })" class="btn btn-primary btn-large justify-self-start">New Classroom</a>

    <div v-if="error !== ''" role="alert" class="notice grid justify-items-start gap-2 border-bad bg-bad-soft">
      <p>{{ error }}</p>
      <button type="button" class="btn btn-small" @click="load">Try Again</button>
    </div>
    <p v-else-if="classrooms === null" role="status" class="text-xl">Loading…</p>
    <p v-else-if="classrooms.length === 0" class="text-xl">No classrooms yet. Create one to start the adventure.</p>
    <ul v-else class="grid gap-3 sm:grid-cols-2">
      <li v-for="classroom in classrooms" :key="classroom.slug">
        <a :href="routeHash({ name: 'classroom', slug: classroom.slug })" class="panel grid gap-1 p-5 [--edge:5px] hover:bg-sea-foam">
          <span class="font-display text-3xl leading-tight font-extrabold">{{ classroom.name }}</span>
          <span class="text-lg text-ink-soft">{{ classroom.studentCount }} students</span>
        </a>
      </li>
    </ul>
  </main>
</template>
