import { ApiError } from './apiError'

// Two teacher tabs would each keep their own copy and overwrite each other's saves, so one browser teaches in one tab.
export function teacherTabLock(name: string, locks: LockManager | undefined = globalThis.navigator?.locks ?? undefined): () => Promise<void> {
  let held: Promise<boolean> | null = null
  return async () => {
    if (locks === undefined) {
      return
    }
    held ??= new Promise<boolean>((resolve) => {
      void locks.request(name, { ifAvailable: true }, (lock) => {
        resolve(lock !== null)
        return lock === null ? undefined : new Promise<void>(() => {})
      })
    })
    if (!(await held)) {
      held = null
      throw new ApiError(409, 'open_in_another_tab', 'QuestRush is already open for teaching in another tab of this browser. Close that tab, then try again.')
    }
  }
}
