import { readonly, ref, shallowRef } from 'vue'
import { api, errorMessage } from '../services/api'
import type { PublicClassroom } from '../types/api'

export function usePublicClassroom(classroomSlug: string) {
  const classroom = shallowRef<PublicClassroom | null>(null)
  const error = ref('')

  async function load(): Promise<void> {
    error.value = ''
    try {
      classroom.value = await api.getPublicClassroom(classroomSlug)
    } catch (caught) {
      error.value = errorMessage(caught)
    }
  }

  return { classroom, error: readonly(error), load }
}
