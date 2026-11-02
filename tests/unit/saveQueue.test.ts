import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/services/apiError'
import { createSaveQueue } from '../../src/services/saveQueue'
import type { AbsenceRow } from '../../src/services/sheetRules'
import type { PendingWrite } from '../../src/services/sheetSync'

function write(studentId: string): PendingWrite {
  const row: AbsenceRow = { rowNumber: null, session_id: 'session', student_id: studentId, created_at: '' }
  return { write: { kind: 'append', table: 'absences', rows: [row] }, before: null }
}

function studentsOf(saved: PendingWrite): string[] {
  return saved.write.kind === 'append' ? saved.write.rows.map((row) => (row as AbsenceRow).student_id) : []
}

describe('createSaveQueue', () => {
  const saved: string[] = []
  const onRefused = vi.fn(async () => {})
  const wait = vi.fn(async () => {})

  beforeEach(() => {
    saved.length = 0
    onRefused.mockClear()
    wait.mockClear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('saves writes one at a time, in the order they were made', async () => {
    let release: () => void = () => {}
    const run = vi.fn(async (item: PendingWrite) => {
      if (studentsOf(item)[0] === 'a') {
        await new Promise<void>((resolve) => (release = resolve))
      }
      saved.push(...studentsOf(item))
    })
    const queue = createSaveQueue({ run, onRefused, wait })

    queue.enqueue([write('a')])
    queue.enqueue([write('b'), write('c')])
    expect(queue.status.value).toMatchObject({ state: 'saving', pending: 3 })
    release()
    await queue.resume()

    expect(saved).toEqual(['a', 'b', 'c'])
    expect(queue.status.value).toEqual({ state: 'idle', pending: 0, message: '' })
  })

  it('sends waiting appends to the same tab as one write, in order', async () => {
    let release: () => void = () => {}
    const sent: string[][] = []
    const run = vi.fn(async (item: PendingWrite) => {
      sent.push(studentsOf(item))
      if (sent.length === 1) {
        await new Promise<void>((resolve) => (release = resolve))
      }
    })
    const queue = createSaveQueue({ run, onRefused, wait })

    queue.enqueue([write('a')])
    queue.enqueue([write('b')])
    queue.enqueue([write('c')])
    release()
    await queue.resume()

    expect(sent).toEqual([['a'], ['b', 'c']])
  })

  it('retries network failures with growing waits', async () => {
    let failures = 2
    const run = vi.fn(async (item: PendingWrite) => {
      if (failures-- > 0) {
        throw new ApiError(0, 'network', 'offline')
      }
      saved.push(...studentsOf(item))
    })
    const queue = createSaveQueue({ run, onRefused, wait, firstDelayMs: 100 })

    queue.enqueue([write('a')])
    await queue.resume()

    expect(saved).toEqual(['a'])
    expect(wait.mock.calls).toEqual([[100], [200]])
  })

  it('keeps the writes when Google stays unreachable, and saves them on retry', async () => {
    let online = false
    const run = vi.fn(async (item: PendingWrite) => {
      if (!online) {
        throw new ApiError(503, 'sheet_error', 'Google Sheets is unavailable.')
      }
      saved.push(...studentsOf(item))
    })
    const queue = createSaveQueue({ run, onRefused, wait, attempts: 2 })

    queue.enqueue([write('a'), write('b')])
    await queue.resume()
    expect(queue.status.value).toEqual({ state: 'offline', pending: 1, message: 'Google Sheets is unavailable.' })

    online = true
    await queue.resume()
    expect(saved).toEqual(['a', 'b'])
  })

  it('pauses on an expired sign-in and keeps queueing until resumed', async () => {
    let signedIn = false
    const run = vi.fn(async (item: PendingWrite) => {
      if (!signedIn) {
        throw new ApiError(401, 'google_sign_in_expired', 'Sign in again.')
      }
      saved.push(...studentsOf(item))
    })
    const queue = createSaveQueue({ run, onRefused, wait })

    queue.enqueue([write('a')])
    await queue.resume()
    queue.enqueue([write('b')])
    expect(queue.status.value).toEqual({ state: 'needs-sign-in', pending: 2, message: 'Sign in again.' })
    expect(run).toHaveBeenCalledTimes(1)

    signedIn = true
    await queue.resume()
    expect(saved).toEqual(['a', 'b'])
  })

  it('drops every queued write when Google refuses one, so the sheet can be reloaded', async () => {
    const run = vi.fn(async () => {
      throw new ApiError(409, 'sheet_changed', 'The sheet was changed somewhere else.')
    })
    const queue = createSaveQueue({ run, onRefused, wait })

    queue.enqueue([write('a'), write('b')])
    await queue.resume()

    expect(onRefused).toHaveBeenCalledWith(expect.objectContaining({ code: 'sheet_changed' }))
    expect(queue.status.value).toEqual({ state: 'refused', pending: 0, message: 'The sheet was changed somewhere else.' })
    expect(run).toHaveBeenCalledTimes(1)
    queue.dismiss()
    expect(queue.status.value.state).toBe('idle')
  })

  it('keeps every change in browser storage as the queue moves', async () => {
    const kept: number[] = []
    const queue = createSaveQueue({ run: async () => {}, onRefused, wait, onChange: (items) => kept.push(items.length) })

    queue.enqueue([write('a'), write('b')])
    await queue.resume()

    expect(kept).toEqual([2, 0])
  })

  it('reports changes the sheet made it drop until the teacher dismisses the notice', async () => {
    const queue = createSaveQueue({ run: async () => {}, onRefused, wait })

    queue.enqueue([write('a')])
    await queue.resume()
    queue.replace([write('b')], 2)
    queue.replace([write('c')], 1)
    await queue.resume()

    expect(queue.status.value).toEqual({ state: 'dropped', pending: 0, message: '3 changes were dropped because the sheet changed.' })
    queue.dismiss()
    expect(queue.status.value.state).toBe('idle')
  })
})
