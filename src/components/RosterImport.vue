<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { MAX_NAME_LENGTH, ROSTER_PREVIEW_ROWS } from '../config'
import { api, errorMessage } from '../services/api'
import type { RosterGrid } from '../types/api'
import { assignEmojis, columnCount, columnLabel, EMOJI_POOL, extractNames, guessNameColumn, type DraftStudent } from '../utils/roster'

const props = defineProps<{
  takenEmojis: readonly string[]
}>()

const students = defineModel<DraftStudent[]>('students', { required: true })

const grid = shallowRef<RosterGrid | null>(null)
const fileName = ref('')
const column = ref(0)
const hasHeader = ref(false)
const uploadError = ref('')
const uploading = ref(false)
let nextKey = 1

const columns = computed(() => {
  const rows = grid.value?.rows ?? []
  return Array.from({ length: columnCount(rows) }, (_, index) => {
    const header = hasHeader.value ? (rows[0]?.[index] ?? '') : ''
    return { index, label: header === '' ? `Column ${columnLabel(index)}` : `Column ${columnLabel(index)}: ${header}` }
  })
})
const previewRows = computed(() => (grid.value?.rows ?? []).slice(0, ROSTER_PREVIEW_ROWS))
const extraction = computed(() => (grid.value === null ? null : extractNames(grid.value.rows, column.value, hasHeader.value)))

watch(extraction, (result) => {
  if (result === null) {
    return
  }
  const emojis = assignEmojis(result.entries.length, props.takenEmojis)
  students.value = result.entries.map((entry, index) => ({
    key: nextKey++,
    name: entry.name,
    emoji: emojis[index] as string,
    note:
      entry.duplicateOf === null
        ? ''
        : `Same name as student ${result.entries.findIndex((other) => other.row === entry.duplicateOf) + 1}; kept as a separate student.`,
  }))
})

async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined) {
    return
  }
  if (!file.name.toLowerCase().endsWith('.xlsx')) {
    uploadError.value = 'Choose an Excel workbook saved as .xlsx.'
    return
  }
  uploading.value = true
  uploadError.value = ''
  try {
    const result = await api.previewRoster(file)
    const guess = guessNameColumn(result.rows)
    fileName.value = file.name
    column.value = guess.column
    hasHeader.value = guess.hasHeader
    grid.value = result
  } catch (caught) {
    uploadError.value = errorMessage(caught)
  } finally {
    uploading.value = false
  }
}

function addByHand(): void {
  const [emoji] = assignEmojis(1, [...props.takenEmojis, ...students.value.map((student) => student.emoji)])
  students.value = [...students.value, { key: nextKey++, name: '', emoji: emoji as string, note: '' }]
}

function remove(key: number): void {
  students.value = students.value.filter((student) => student.key !== key)
}
</script>

<template>
  <section class="grid gap-4" aria-labelledby="roster-heading">
    <h2 id="roster-heading" class="font-display text-2xl font-extrabold">Students</h2>
    <div class="flex flex-wrap items-center gap-3">
      <label class="btn cursor-pointer" :class="uploading ? 'opacity-45' : ''">
        {{ uploading ? 'Reading…' : 'Upload Excel File' }}
        <input type="file" class="sr-only" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" :disabled="uploading" @change="upload" />
      </label>
      <button type="button" class="btn" @click="addByHand">Add a Student by Hand</button>
      <span v-if="fileName !== ''" class="text-lg text-ink-soft">{{ fileName }}</span>
    </div>
    <p v-if="uploadError !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ uploadError }}</p>

    <template v-if="grid !== null">
      <p v-if="grid.rows.length === 0" class="notice border-warn bg-warn-soft">The first sheet is empty.</p>
      <template v-else>
        <div class="flex flex-wrap items-end gap-4">
          <label class="field-label">
            Which column has the names?
            <select v-model.number="column" class="field-input" aria-label="Which column has the names?">
              <option v-for="option in columns" :key="option.index" :value="option.index">{{ option.label }}</option>
            </select>
          </label>
          <label class="flex min-h-12 items-center gap-2 text-lg font-bold">
            <input v-model="hasHeader" type="checkbox" class="size-5" />
            The first row is a header
          </label>
        </div>
        <div class="overflow-x-auto rounded-tile border-3 border-rule">
          <table class="w-full text-left text-base">
            <caption class="sr-only">First rows of {{ grid.sheetName }}</caption>
            <thead class="bg-track">
              <tr>
                <th class="px-2 py-1">Row</th>
                <th v-for="option in columns" :key="option.index" class="px-2 py-1" :class="option.index === column ? 'bg-sea-foam' : ''">
                  {{ columnLabel(option.index) }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in previewRows" :key="rowIndex" class="border-t border-rule" :class="hasHeader && rowIndex === 0 ? 'font-bold' : ''">
                <td class="px-2 py-1 text-ink-soft">{{ rowIndex + 1 }}</td>
                <td v-for="option in columns" :key="option.index" class="px-2 py-1" :class="option.index === column ? 'bg-sea-foam' : ''">
                  {{ row[option.index] ?? '' }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="text-base text-ink-soft">
          Showing {{ previewRows.length }} of {{ grid.rows.length }} rows<span v-if="grid.truncated">. Only the first rows and columns of a very large sheet were read</span>.
        </p>
        <div v-if="extraction !== null" class="grid gap-2" aria-live="polite">
          <p class="text-lg font-bold">
            Found {{ extraction.entries.length }} {{ extraction.entries.length === 1 ? 'name' : 'names' }}<span v-if="extraction.blankRows > 0">; skipped {{ extraction.blankRows }} empty {{ extraction.blankRows === 1 ? 'row' : 'rows' }}</span>.
          </p>
          <div v-if="extraction.invalid.length > 0" class="notice border-warn bg-warn-soft">
            <p class="font-bold">These entries were not imported:</p>
            <ul class="list-disc pl-6">
              <li v-for="problem in extraction.invalid" :key="problem.row">Row {{ problem.row }}: “{{ problem.value }}” {{ problem.reason }}.</li>
            </ul>
          </div>
        </div>
      </template>
    </template>

    <ol v-if="students.length > 0" class="grid gap-2" aria-label="Students to save">
      <li v-for="(student, index) in students" :key="student.key" class="grid gap-1">
        <div class="flex items-center gap-2">
          <span class="w-8 text-right text-ink-soft">{{ index + 1 }}</span>
          <label class="w-20 shrink-0">
            <select v-model="student.emoji" class="field-input px-2 text-2xl" :aria-label="`Pawn for student ${index + 1}`">
              <option v-for="choice in EMOJI_POOL.includes(student.emoji) ? EMOJI_POOL : [student.emoji, ...EMOJI_POOL]" :key="choice" :value="choice">{{ choice }}</option>
            </select>
          </label>
          <label class="flex-1">
            <span class="sr-only">Name of student {{ index + 1 }}</span>
            <input v-model="student.name" class="field-input" :maxlength="MAX_NAME_LENGTH" placeholder="Student name" />
          </label>
          <button type="button" class="btn btn-small" :aria-label="`Remove ${student.name || `student ${index + 1}`}`" @click="remove(student.key)">Remove</button>
        </div>
        <p v-if="student.note !== ''" class="pl-30 text-base text-warn">{{ student.note }}</p>
      </li>
    </ol>
  </section>
</template>
