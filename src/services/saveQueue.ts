import { readonly, ref, type Ref } from 'vue'
import { ApiError } from './apiError'
import type { PendingWrite } from './sheetSync'

export type SaveState = 'idle' | 'saving' | 'needs-sign-in' | 'offline' | 'refused' | 'dropped'

export interface SaveStatus {
  state: SaveState
  pending: number
  message: string
}

export interface SaveQueueOptions {
  // Pushes one change and resolves to how many of its rows were dropped because the sheet changed first.
  run: (item: PendingWrite) => Promise<number>
  // Called after Google refused a write; every queued write is dropped, so the caller reloads the sheet.
  onRefused: (error: ApiError) => Promise<void>
  // Called after every change to the queue, so it can be kept in browser storage.
  onChange?: (items: readonly PendingWrite[]) => void
  wait?: (ms: number) => Promise<void>
  attempts?: number
  firstDelayMs?: number
}

const DEFAULT_ATTEMPTS: number = 5
const DEFAULT_FIRST_DELAY_MS: number = 1000
const OFFLINE_MESSAGE: string = "Can't reach Google Sheets. Your changes are kept in this browser and saved when the connection is back."

// Google answered and said no; anything else (offline, rate limit, server error) is worth retrying.
function isRefusal(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status !== 0 && error.status !== 429 && error.status < 500
}

function droppedMessage(count: number): string {
  return count === 1 ? '1 change was dropped because the sheet changed.' : `${count} changes were dropped because the sheet changed.`
}

// Writes reach the sheet one at a time and in order, so a row is always appended before it is updated or deleted.
export function createSaveQueue(options: SaveQueueOptions) {
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const firstDelayMs = options.firstDelayMs ?? DEFAULT_FIRST_DELAY_MS
  const status: Ref<SaveStatus> = ref({ state: 'idle', pending: 0, message: '' })
  let items: PendingWrite[] = []
  let draining: Promise<void> | null = null
  let droppedUnseen = 0

  function setStatus(state: SaveState, message: string = ''): void {
    status.value = { state, pending: items.length, message }
  }

  function changed(): void {
    options.onChange?.(items)
  }

  function paused(): boolean {
    return status.value.state === 'needs-sign-in' || status.value.state === 'offline'
  }

  // A refusal or a dropped change stays on screen until the teacher dismisses it.
  function settle(): void {
    if (status.value.state === 'refused' && items.length === 0) {
      setStatus('refused', status.value.message)
      return
    }
    if (droppedUnseen > 0) {
      setStatus('dropped', droppedMessage(droppedUnseen))
      return
    }
    setStatus(items.length > 0 ? 'saving' : 'idle')
  }

  function enqueue(added: readonly PendingWrite[]): void {
    if (added.length === 0) {
      return
    }
    items.push(...added)
    changed()
    if (paused()) {
      setStatus(status.value.state, status.value.message)
      return
    }
    setStatus('saving')
    void resume()
  }

  // A sync replaces the queue with the changes that still apply to the sheet it just read.
  function replace(next: readonly PendingWrite[], dropped: number): void {
    items = [...next]
    droppedUnseen += dropped
    changed()
    if (paused() && items.length > 0) {
      setStatus(status.value.state, status.value.message)
      return
    }
    settle()
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
    while (items.length > 0) {
      setStatus('saving')
      const item = mergeLeadingAppends()
      const outcome = await attempt(item)
      // A sync or sign-out may have replaced the queue meanwhile; a change no longer queued is no longer counted.
      if (typeof outcome === 'number') {
        if (items.includes(item)) {
          droppedUnseen += outcome
          items = items.filter((queued) => queued !== item)
          changed()
        }
        continue
      }
      const refused = isRefusal(outcome.error) && outcome.error.status !== 401
      if (refused) {
        items = []
        changed()
      }
      fail(outcome.error)
      if (refused) {
        await options.onRefused(outcome.error as ApiError)
      }
      return
    }
    settle()
  }

  // Shows why saving stopped; a sign-in or connection problem keeps the queue for later.
  function fail(error: unknown): void {
    if (isRefusal(error) && error.status === 401) {
      setStatus('needs-sign-in', error.message)
      return
    }
    if (isRefusal(error)) {
      setStatus('refused', error.message)
      return
    }
    setStatus('offline', error instanceof ApiError && error.status !== 0 ? error.message : OFFLINE_MESSAGE)
  }

  // Appends to the same tab that follow each other go to the sheet as one request, still in order.
  function mergeLeadingAppends(): PendingWrite {
    const first = items[0] as PendingWrite
    let count = 1
    while (first.write.kind === 'append' && items[count]?.write.kind === 'append' && items[count]?.write.table === first.write.table) {
      count++
    }
    if (count === 1) {
      return first
    }
    const rows = items.slice(0, count).flatMap((item) => (item.write.kind === 'append' ? item.write.rows : []))
    const merged: PendingWrite = { write: { kind: 'append', table: first.write.table, rows }, before: null }
    items.splice(0, count, merged)
    return merged
  }

  // Resolves to the number of dropped rows once the write is settled, or to the error that stopped it.
  async function attempt(item: PendingWrite): Promise<number | { error: unknown }> {
    let delay = firstDelayMs
    for (let tried = 1; ; tried++) {
      if (!items.includes(item)) {
        return 0
      }
      try {
        return await options.run(item)
      } catch (error) {
        if (isRefusal(error) || tried >= attempts) {
          return { error }
        }
        console.warn(`sheet write failed, retrying in ${delay} ms`, error)
        await wait(delay)
        delay *= 2
      }
    }
  }

  function pendingWrites(): readonly PendingWrite[] {
    return items
  }

  function clear(): void {
    items = []
    droppedUnseen = 0
    setStatus('idle')
  }

  function dismiss(): void {
    if (status.value.state === 'refused' || status.value.state === 'dropped') {
      droppedUnseen = 0
      setStatus(items.length > 0 ? 'saving' : 'idle')
    }
  }

  return { status: readonly(status), enqueue, replace, resume, fail, pendingWrites, clear, dismiss }
}
