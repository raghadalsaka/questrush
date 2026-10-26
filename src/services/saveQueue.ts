import { readonly, ref, type Ref } from 'vue'
import { ApiError } from './apiError'
import type { SheetWrite } from './sheetRules'

export type SaveState = 'idle' | 'saving' | 'needs-sign-in' | 'offline' | 'refused'

export interface SaveStatus {
  state: SaveState
  pending: number
  message: string
}

export interface SaveQueueOptions {
  run: (write: SheetWrite) => Promise<void>
  // Called after Google refused a write; every queued write is dropped, so the caller reloads the sheet.
  onRefused: (error: ApiError) => Promise<void>
  wait?: (ms: number) => Promise<void>
  attempts?: number
  firstDelayMs?: number
}

const DEFAULT_ATTEMPTS: number = 5
const DEFAULT_FIRST_DELAY_MS: number = 1000

// Google answered and said no; anything else (offline, rate limit, server error) is worth retrying.
function isRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status !== 0 && error.status !== 429 && error.status < 500
}

// Writes reach the sheet one at a time and in order, so a row is always appended before it is updated or deleted.
export function createSaveQueue(options: SaveQueueOptions) {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const firstDelayMs = options.firstDelayMs ?? DEFAULT_FIRST_DELAY_MS
  const status: Ref<SaveStatus> = ref({ state: 'idle', pending: 0, message: '' })
  let writes: SheetWrite[] = []
  let draining: Promise<void> | null = null

  function setStatus(state: SaveState, message: string = ''): void {
    status.value = { state, pending: writes.length, message }
  }

  function enqueue(added: readonly SheetWrite[]): void {
    if (added.length === 0) {
      return
    }
    writes.push(...added)
    const { state, message } = status.value
    if (state === 'needs-sign-in' || state === 'offline') {
      setStatus(state, message)
      return
    }
    setStatus('saving')
    void resume()
  }

  function resume(): Promise<void> {
    if (draining === null) {
      draining = drain().finally(() => {
        draining = null
      })
    }
    return draining
  }

  async function drain(): Promise<void> {
    while (writes.length > 0) {
      setStatus('saving')
      const failure = await attempt(mergeLeadingAppends())
      if (failure === null) {
        writes.shift()
        continue
      }
      if (isRefusal(failure) && failure.status === 401) {
        setStatus('needs-sign-in', failure.message)
        return
      }
      if (isRefusal(failure)) {
        writes = []
        setStatus('refused', failure.message)
        await options.onRefused(failure)
        return
      }
      setStatus('offline', failure instanceof ApiError ? failure.message : "Can't reach Google Sheets. Your changes are kept in this tab.")
      return
    }
    setStatus('idle')
  }

  // Appends to the same tab that follow each other go to the sheet as one request, still in order.
  function mergeLeadingAppends(): SheetWrite {
    const first = writes[0] as SheetWrite
    let count = 1
    while (first.kind === 'append' && writes[count]?.kind === 'append' && writes[count]?.table === first.table) {
      count++
    }
    if (count === 1) {
      return first
    }
    const merged: SheetWrite = { kind: 'append', table: first.table, rows: writes.slice(0, count).flatMap((write) => (write.kind === 'append' ? write.rows : [])) }
    writes.splice(0, count, merged)
    return merged
  }

  // Resolves to null once the write is saved, or to the error that stopped it.
  async function attempt(write: SheetWrite): Promise<unknown> {
    let delay = firstDelayMs
    for (let tried = 1; ; tried++) {
      try {
        await options.run(write)
        return null
      } catch (error) {
        if (isRefusal(error) || tried >= attempts) {
          return error
        }
        console.warn(`sheet write failed, retrying in ${delay} ms`, error)
        await wait(delay)
        delay *= 2
      }
    }
  }

  function pendingWrites(): readonly SheetWrite[] {
    return writes
  }

  function clear(): void {
    writes = []
    setStatus('idle')
  }

  function dismiss(): void {
    if (status.value.state === 'refused') {
      setStatus('idle')
    }
  }

  return { status: readonly(status), enqueue, resume, pendingWrites, clear, dismiss }
}
