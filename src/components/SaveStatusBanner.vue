<script setup lang="ts">
import { ref } from 'vue'
import { dismissSaveMessage, errorMessage, retrySaving, saveStatus, signInAgain } from '../services/api'

const signInError = ref('')

// No await before signInAgain: the Google popup must open inside this click.
function signIn(): void {
  signInError.value = ''
  signInAgain().catch((error: unknown) => {
    signInError.value = errorMessage(error)
  })
}
</script>

<template>
  <div v-if="saveStatus.state !== 'idle'" class="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-4" aria-live="polite">
    <p v-if="saveStatus.state === 'saving'" role="status" class="notice border-rule bg-track text-base">
      Saving to the sheet… ({{ saveStatus.pending }} left)
    </p>
    <div v-else role="alert" class="notice flex max-w-2xl flex-wrap items-center gap-3 border-warn bg-warn-soft">
      <p class="flex-1">{{ signInError || saveStatus.message }}</p>
      <button v-if="saveStatus.state === 'needs-sign-in'" type="button" class="btn btn-small btn-primary" @click="signIn">Sign In Again</button>
      <button v-if="saveStatus.state === 'offline'" type="button" class="btn btn-small" @click="retrySaving()">Try Again</button>
      <button v-if="saveStatus.state === 'refused'" type="button" class="btn btn-small" @click="dismissSaveMessage()">OK</button>
    </div>
  </div>
</template>
