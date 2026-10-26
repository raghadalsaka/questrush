<script setup lang="ts">
import { ref } from 'vue'
import { MAX_CLASSROOM_NAME_LENGTH, MAX_STUDENTS } from '../config'
import { navigateTo } from '../composables/useHashRoute'
import { api, errorMessage } from '../services/api'
import { routeHash } from '../utils/route'
import { validateDrafts, type DraftStudent } from '../utils/roster'
import RosterImport from './RosterImport.vue'

const name = ref('')
const drafts = ref<DraftStudent[]>([])
const errors = ref<string[]>([])
const saving = ref(false)

async function create(): Promise<void> {
  if (saving.value) {
    return
  }
  const { students, errors: problems } = validateDrafts(drafts.value)
  if (name.value.trim() === '') {
    problems.unshift('Give the classroom a name.')
  }
  if (students.length > MAX_STUDENTS) {
    problems.push(`A classroom can have at most ${MAX_STUDENTS} students.`)
  }
  errors.value = problems
  if (problems.length > 0) {
    return
  }
  saving.value = true
  try {
    const classroom = await api.createClassroom(name.value.trim(), students)
    navigateTo({ name: 'classroom', slug: classroom.slug })
  } catch (caught) {
    errors.value = [errorMessage(caught)]
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <main class="mx-auto grid max-w-4xl gap-6 px-4 py-8">
    <a :href="routeHash({ name: 'classrooms' })" class="text-lg font-bold text-sea-deep underline">All classrooms</a>
    <h1 class="font-display text-5xl leading-tight font-extrabold">New classroom</h1>
    <form class="panel grid gap-6 p-6" @submit.prevent="create">
      <label class="field-label">
        Classroom name
        <input v-model="name" class="field-input" :maxlength="MAX_CLASSROOM_NAME_LENGTH" placeholder="For example, Year 3 Explorers" required />
      </label>
      <RosterImport v-model:students="drafts" :taken-emojis="[]" />
      <p class="text-base text-ink-soft">The Excel file is only read once. The students are saved with the classroom, so check the list now: students can't be added later.</p>
      <div v-if="errors.length > 0" role="alert" class="notice border-bad bg-bad-soft">
        <ul class="list-disc pl-6">
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>
      </div>
      <button type="submit" class="btn btn-primary btn-large justify-self-start" :disabled="saving">
        {{ saving ? 'Saving…' : drafts.length === 0 ? 'Create Classroom' : `Create Classroom with ${drafts.length} Students` }}
      </button>
    </form>
  </main>
</template>
