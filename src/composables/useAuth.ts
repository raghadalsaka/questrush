import { inject, readonly, ref, type InjectionKey } from 'vue'
import { ApiError, api, errorMessage, setSignedOutHandler } from '../services/api'

export type AuthState = 'unknown' | 'signed-out' | 'signed-in'

export function useAuth() {
  const state = ref<AuthState>('unknown')
  const error = ref('')
  const busy = ref(false)

  function signedOut(): void {
    state.value = 'signed-out'
  }

  setSignedOutHandler(signedOut)

  async function check(): Promise<void> {
    try {
      await api.me()
      state.value = 'signed-in'
      error.value = ''
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        signedOut()
        return
      }
      error.value = errorMessage(caught)
      state.value = 'signed-out'
    }
  }

  async function login(pin: string): Promise<void> {
    if (busy.value) {
      return
    }
    busy.value = true
    error.value = ''
    try {
      await api.login(pin)
      state.value = 'signed-in'
    } catch (caught) {
      error.value = errorMessage(caught)
    } finally {
      busy.value = false
    }
  }

  async function logout(): Promise<void> {
    try {
      await api.logout()
    } catch (caught) {
      console.error('Sign out failed', caught)
    }
    signedOut()
  }

  return { state: readonly(state), error: readonly(error), busy: readonly(busy), check, login, logout }
}

export type Auth = ReturnType<typeof useAuth>

export const authKey: InjectionKey<Auth> = Symbol('auth')

export function injectAuth(): Auth {
  const auth = inject(authKey)
  if (auth === undefined) {
    throw new Error('injectAuth() must be used below App, which provides authKey.')
  }
  return auth
}
