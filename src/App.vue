<script setup lang="ts">
import { computed, provide, watch } from 'vue'
import ClassroomListScreen from './components/ClassroomListScreen.vue'
import ClassroomScreen from './components/ClassroomScreen.vue'
import LoginScreen from './components/LoginScreen.vue'
import MessagePanel from './components/MessagePanel.vue'
import NewClassroomScreen from './components/NewClassroomScreen.vue'
import PracticeScreen from './components/PracticeScreen.vue'
import PublicClassroomScreen from './components/PublicClassroomScreen.vue'
import SaveStatusBanner from './components/SaveStatusBanner.vue'
import { authKey, useAuth } from './composables/useAuth'
import { useHashRoute } from './composables/useHashRoute'
import { isTeacherRoute } from './utils/route'

const { route } = useHashRoute()
const auth = useAuth()
provide(authKey, auth)

const needsTeacher = computed(() => isTeacherRoute(route.value))
const classroomSlug = computed(() =>
  route.value.name === 'classroom' || route.value.name === 'public' || route.value.name === 'practice' ? route.value.slug : '',
)
const practiceStageSlug = computed(() => (route.value.name === 'practice' ? route.value.stageSlug : ''))

watch(
  needsTeacher,
  (needed) => {
    if (needed && auth.state.value === 'unknown') {
      void auth.check()
    }
  },
  { immediate: true },
)
</script>

<template>
  <template v-if="needsTeacher">
    <p v-if="auth.state.value === 'unknown'" class="p-8 text-xl" role="status">Loading…</p>
    <LoginScreen v-else-if="auth.state.value === 'signed-out'" />
    <ClassroomListScreen v-else-if="route.name === 'classrooms'" />
    <NewClassroomScreen v-else-if="route.name === 'new-classroom'" />
    <ClassroomScreen v-else :key="classroomSlug" :classroom-slug="classroomSlug" />
    <SaveStatusBanner v-if="auth.state.value === 'signed-in'" />
  </template>
  <PublicClassroomScreen v-else-if="route.name === 'public'" :key="classroomSlug" :classroom-slug="classroomSlug" />
  <PracticeScreen v-else-if="route.name === 'practice'" :key="`${classroomSlug}/${practiceStageSlug}`" :classroom-slug="classroomSlug" :stage-slug="practiceStageSlug" />
  <MessagePanel v-else title="Page not found" message="This link doesn't lead anywhere in QuestRush. Check the address and try again." />
</template>
