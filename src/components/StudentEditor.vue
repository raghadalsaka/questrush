<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { MAX_NAME_LENGTH, MAX_PHOTO_BYTES } from '../config'
import { injectClassroom } from '../composables/useTeacherClassroom'
import { api, photosEnabled } from '../services/api'
import type { Student } from '../types/api'
import { EMOJI_POOL, isValidEmoji, normalizeName } from '../utils/roster'
import ConfirmDialog from './ConfirmDialog.vue'

const ACCEPTED_PHOTO_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp']

const props = defineProps<{
  student: Student
}>()

const emit = defineEmits<{
  deleted: []
}>()

const teacher = injectClassroom()
const name = ref(props.student.name)
const emoji = ref(props.student.emoji)
const localError = ref('')
const confirmDelete = ref(false)
const photoInput = ref<HTMLInputElement | null>(null)

const hasResults = computed(() => teacher.classroom.value?.results.some((result) => result.studentId === props.student.id) ?? false)
const emojiChoices = computed(() => (EMOJI_POOL.includes(emoji.value) ? EMOJI_POOL : [emoji.value, ...EMOJI_POOL]))
const changed = computed(() => name.value !== props.student.name || emoji.value !== props.student.emoji)

watch(
  () => props.student,
  (student) => {
    name.value = student.name
    emoji.value = student.emoji
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
  await teacher.run(() => api.updateStudent(props.student.id, { name: normalized.name, emoji: emoji.value }))
}

async function uploadPhoto(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) {
    return
  }
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) {
    localError.value = 'Choose a JPEG, PNG or WebP photo up to 3 MB.'
    return
  }
  localError.value = ''
  await teacher.run(() => api.setPhoto(props.student.id, file))
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
          <option v-for="choice in emojiChoices" :key="choice" :value="choice">{{ choice }}</option>
        </select>
      </label>
    </div>
    <p v-if="localError !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ localError }}</p>
    <div class="flex flex-wrap gap-2">
      <button type="submit" class="btn btn-small btn-primary" :disabled="!changed || teacher.busy.value">Save</button>
      <button v-if="photosEnabled" type="button" class="btn btn-small" :disabled="teacher.busy.value" @click="photoInput?.click()">
        {{ student.photoFile === null ? 'Add Photo' : 'Change Photo' }}
      </button>
      <button
        v-if="student.photoFile !== null"
        type="button"
        class="btn btn-small"
        :disabled="teacher.busy.value"
        @click="teacher.run(() => api.removePhoto(student.id))"
      >
        Remove Photo
      </button>
      <button v-if="!hasResults" type="button" class="btn btn-small" :disabled="teacher.busy.value" @click="confirmDelete = true">Remove Student</button>
      <input ref="photoInput" type="file" class="hidden" accept="image/jpeg,image/png,image/webp" @change="uploadPhoto" />
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
