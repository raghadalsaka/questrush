<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue'
import { levelForSlug } from '../services/game'
import { loadStage } from '../services/stageService'
import type { StageFile } from '../types/stage'
import { routeHash } from '../utils/route'
import MessagePanel from './MessagePanel.vue'
import PracticeRun from './PracticeRun.vue'

const props = defineProps<{
  classroomSlug: string
  stageSlug: string
}>()

const level = levelForSlug(props.stageSlug)
const stage = shallowRef<StageFile | null>(null)
const loadError = ref('')
const mapLink = computed(() => routeHash({ name: 'public', slug: props.classroomSlug }))

// Practice runs only in the browser and only for stages their file marks as unlocked.
async function start(): Promise<void> {
  loadError.value = ''
  if (level?.state !== 'open') {
    return
  }
  const result = await loadStage(props.stageSlug)
  if (result.ok) {
    stage.value = result.stage
    return
  }
  loadError.value = "The practice questions couldn't be loaded. Check the connection and try again."
}

onMounted(start)
</script>

<template>
  <MessagePanel v-if="level === null || level.state !== 'open'" title="This stage isn't open" message="This stage isn't unlocked yet, so it can't be practised." tone="ink">
    <a :href="mapLink" class="btn btn-primary">Back to the Map</a>
  </MessagePanel>
  <MessagePanel v-else-if="loadError !== ''" title="Practice couldn't start" :message="loadError">
    <div class="flex gap-3">
      <button type="button" class="btn btn-primary" @click="start">Try Again</button>
      <a :href="mapLink" class="btn">Back to the Map</a>
    </div>
  </MessagePanel>
  <p v-else-if="stage === null" class="p-8 text-xl" role="status">Loading the questions…</p>
  <main v-else class="mx-auto grid max-w-5xl gap-4 px-3 py-4 lg:px-6">
    <a :href="mapLink" class="text-lg font-bold text-sea-deep underline">Back to the map</a>
    <PracticeRun :questions="stage.questions" :title="`${stage.order}. ${stage.title}`" :map-link="mapLink" />
  </main>
</template>
