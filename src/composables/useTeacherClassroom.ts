import { computed, inject, onScopeDispose, readonly, ref, shallowRef, type InjectionKey } from 'vue'
import { api, errorMessage, onSheetReloaded } from '../services/api'
import { levelForSlug } from '../services/game'
import type { ClassroomDetail } from '../types/api'

// Every teacher mutation returns the whole classroom, so the screen always shows what the backend now holds.
export function useTeacherClassroom(classroomSlug: string) {
  const classroom = shallowRef<ClassroomDetail | null>(null)
  const loadError = ref('')
  const actionError = ref('')
  const busy = ref(false)

  const activeSession = computed(() => classroom.value?.session ?? null)
  const activeLevel = computed(() => {
    const session = activeSession.value
    return session === null ? null : levelForSlug(session.stageSlug)
  })

  async function load(): Promise<void> {
    loadError.value = ''
    try {
      classroom.value = await api.getClassroom(classroomSlug)
    } catch (caught) {
      loadError.value = errorMessage(caught)
    }
  }

  function apply(detail: ClassroomDetail): void {
    classroom.value = detail
  }

  onScopeDispose(onSheetReloaded(() => void load()))

  // Runs one change at a time; a second click while a request is in flight is ignored.
  async function run(action: () => Promise<ClassroomDetail>): Promise<boolean> {
    if (busy.value) {
      return false
    }
    busy.value = true
    actionError.value = ''
    try {
      apply(await action())
      return true
    } catch (caught) {
      actionError.value = errorMessage(caught)
      return false
    } finally {
      busy.value = false
    }
  }

  function clearError(): void {
    actionError.value = ''
  }

  return {
    classroom,
    activeSession,
    activeLevel,
    loadError: readonly(loadError),
    actionError,
    busy,
    load,
    apply,
    run,
    clearError,
  }
}

export type TeacherClassroom = ReturnType<typeof useTeacherClassroom>

export const classroomKey: InjectionKey<TeacherClassroom> = Symbol('teacher-classroom')

export function injectClassroom(): TeacherClassroom {
  const classroom = inject(classroomKey)
  if (classroom === undefined) {
    throw new Error('injectClassroom() must be used below ClassroomScreen, which provides classroomKey.')
  }
  return classroom
}
