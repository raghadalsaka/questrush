<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { MIN_PIN_LENGTH } from '../config'
import { injectAuth } from '../composables/useAuth'
import { googleSignIn } from '../services/api'
import { preloadGoogleSignIn } from '../services/googleAuth'

const auth = injectAuth()
const pin = ref('')

onMounted(() => {
  if (googleSignIn) {
    preloadGoogleSignIn().catch((error: unknown) => console.warn('Google sign-in did not preload', error))
  }
})

// Google sign-in opens its popup inside this submit, so nothing is awaited before auth.login.
async function submit(): Promise<void> {
  await auth.login(pin.value.trim())
  pin.value = ''
}
</script>

<template>
  <main class="mx-auto grid min-h-svh max-w-lg content-center px-4 py-12">
    <form class="panel grid gap-5 p-8" @submit.prevent="submit">
      <div>
        <p class="font-display text-2xl font-extrabold text-sea-deep">QuestRush</p>
        <h1 class="font-display text-4xl leading-tight font-extrabold">Teacher sign in</h1>
      </div>
      <p v-if="googleSignIn" class="text-lg">Sign in with the Google account that can edit the QuestRush sheet.</p>
      <label v-else class="field-label">
        PIN
        <input
          v-model="pin"
          type="password"
          class="field-input font-display text-3xl tracking-widest"
          inputmode="numeric"
          autocomplete="current-password"
          pattern="[0-9]*"
          :minlength="MIN_PIN_LENGTH"
          required
          autofocus
        />
      </label>
      <p v-if="auth.error.value !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ auth.error.value }}</p>
      <button v-if="googleSignIn" type="submit" class="btn btn-primary btn-large" :disabled="auth.busy.value">
        {{ auth.busy.value ? 'Loading the Classrooms…' : 'Sign In with Google' }}
      </button>
      <button v-else type="submit" class="btn btn-primary btn-large" :disabled="auth.busy.value">{{ auth.busy.value ? 'Signing In…' : 'Sign In' }}</button>
      <p class="text-base text-ink-soft">Students don't need {{ googleSignIn ? 'to sign in' : 'a PIN' }}: use the classroom link your teacher shares.</p>
    </form>
  </main>
</template>
