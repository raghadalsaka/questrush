<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MAX_NAME_LENGTH } from '../config'
import { injectClassroom } from '../composables/useTeacherClassroom'
import { api, studentLinkThisDeviceOnly } from '../services/api'
import type { Student } from '../types/api'
import { photoFromFile } from '../utils/photo'
import { emojiChoices, isValidEmoji, normalizeName } from '../utils/roster'
import ConfirmDialog from './ConfirmDialog.vue'
import PawnBadge from './PawnBadge.vue'

const props = defineProps<{
  student: Student
}>()

const emit = defineEmits<{
  deleted: []
}>()

const teacher = injectClassroom()
const name = ref(props.student.name)
const emoji = ref(props.student.emoji)
const photo = ref(props.student.photo)
const readingPhoto = ref(false)
const localError = ref('')
const confirmDelete = ref(false)

const hasResults = computed(() => teacher.classroom.value?.results.some((result) => result.studentId === props.student.id) ?? false)
const changed = computed(() => name.value !== props.student.name || emoji.value !== props.student.emoji || photo.value !== props.student.photo)

watch(
  () => props.student,
  (student) => {
    name.value = student.name
    emoji.value = student.emoji
    photo.value = student.photo
    localError.value = ''
  },
)

async function save(): Promise<void> {
  const normalized = normalizeName(name.value)
  if (!normalized.ok) {
    localError.value = `The name ${normalized.reason}.`
    return
  }
  if (!isValidEmoji(emoji.value)) {
    localError.value = 'Choose one emoji for the pawn.'
    return
  }
  localError.value = ''
  await teacher.run(() => api.updateStudent(props.student.id, { name: normalized.name, emoji: emoji.value, photo: photo.value }))
}

async function pickPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) {
    return
  }
  readingPhoto.value = true
  try {
    photo.value = await photoFromFile(file)
    localError.value = ''
  } catch (error) {
    console.warn('reading the photo failed', error)
    localError.value = "This photo couldn't be read. Try a JPEG or PNG picture."
  } finally {
    readingPhoto.value = false
  }
}

async function removeStudent(): Promise<void> {
  confirmDelete.value = false
  if (await teacher.run(() => api.deleteStudent(props.student.id))) {
    emit('deleted')
  }
}
</script>

<template>
  <form class="grid gap-3 border-t-3 border-track pt-4" @submit.prevent="save">
    <h3 class="font-display text-xl font-extrabold">Edit student</h3>
    <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
      <label class="field-label">
        Name
        <input v-model="name" class="field-input" :maxlength="MAX_NAME_LENGTH" required />
      </label>
      <label class="field-label">
        Pawn
        <select v-model="emoji" class="field-input text-2xl" aria-label="Pawn">
          <option v-for="choice in emojiChoices(emoji)" :key="choice" :value="choice">{{ choice }}</option>
        </select>
      </label>
    </div>
    <div class="flex flex-wrap items-center gap-3">
      <PawnBadge :student="{ emoji, photo }" size="lg" />
      <div class="grid gap-2">
        <div class="flex flex-wrap gap-2">
          <label class="btn btn-small cursor-pointer has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-ink">
            {{ photo === null ? 'Add Photo' : 'Change Photo' }}
            <input type="file" accept="image/*" class="sr-only" :disabled="readingPhoto" @change="pickPhoto" />
          </label>
          <button v-if="photo !== null" type="button" class="btn btn-small" :disabled="readingPhoto" @click="photo = null">Remove Photo</button>
        </div>
        <p class="text-base text-ink-soft">
          The photo shows instead of the emoji.<template v-if="!studentLinkThisDeviceOnly"> Anyone with the student link can see it.</template>
        </p>
      </div>
    </div>
    <p v-if="localError !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ localError }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="btn btn-small btn-primary" :disabled="!changed || readingPhoto || teacher.busy.value">Save</button>
      <button v-if="!hasResults" type="button" class="btn btn-small" :disabled="teacher.busy.value" @click="confirmDelete = true">Remove Student</button>
    </div>
    <p v-if="hasResults" class="text-base text-ink-soft">Students with classroom results can't be removed.</p>
    <ConfirmDialog
      :open="confirmDelete"
      title="Remove this student?"
      :message="`${student.name} will be removed from this classroom.`"
      confirm-label="Remove"
      @confirm="removeStudent"
      @cancel="confirmDelete = false"
    />
  </form>
</template>
