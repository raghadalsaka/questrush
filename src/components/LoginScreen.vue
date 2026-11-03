<script setup lang="ts">
import { onMounted } from 'vue'
import { injectAuth } from '../composables/useAuth'
import { googleSignIn, preloadSignIn } from '../services/api'
import BrandIcon from './BrandIcon.vue'
import CreatorCredit from './CreatorCredit.vue'

const auth = injectAuth()

onMounted(preloadSignIn)
</script>

<template>
  <main class="mx-auto grid min-h-svh max-w-lg content-center px-4 py-12">
    <!-- Google sign-in opens its popup inside this submit, so nothing is awaited before auth.login. -->
    <form v-if="googleSignIn" class="panel grid gap-5 p-8" @submit.prevent="auth.login()">
      <div>
        <p class="brand-kicker"><BrandIcon />QuestRush</p>
        <h1 class="font-display text-4xl leading-tight font-extrabold">Teacher sign in</h1>
      </div>
      <p class="text-lg">Sign in with the Google account that can edit the QuestRush sheet.</p>
      <p v-if="auth.error.value !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ auth.error.value }}</p>
      <button type="submit" class="btn btn-primary btn-large" :disabled="auth.busy.value">
        {{ auth.busy.value ? 'Loading the Classrooms…' : 'Sign In with Google' }}
      </button>
      <p class="text-base text-ink-soft">Students don't need to sign in: use the classroom link your teacher shares.</p>
      <CreatorCredit />
    </form>
    <section v-else class="panel grid gap-5 p-8">
      <div>
        <p class="brand-kicker"><BrandIcon />QuestRush</p>
        <h1 class="font-display text-4xl leading-tight font-extrabold">The classrooms couldn't open</h1>
      </div>
      <p v-if="auth.error.value !== ''" role="alert" class="notice border-bad bg-bad-soft">{{ auth.error.value }}</p>
      <button type="button" class="btn btn-primary btn-large" @click="auth.check()">Try Again</button>
    </section>
  </main>
</template>
