import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../src/services/apiError'
import { createSaveQueue } from '../../src/services/saveQueue'
import type { AbsenceRow, SheetWrite } from '../../src/services/sheetRules'

function write(studentId: string): SheetWrite {
  const row: AbsenceRow = { rowNumber: null, session_id: 'session', student_id: studentId, created_at: '' }
  return { kind: 'append', table: 'absences', rows: [row] }
}

function studentsOf(saved: SheetWrite): string[] {
  return saved.kind === 'append' ? saved.rows.map((row) => (row as AbsenceRow).student_id) : []
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
    const run = vi.fn(async (item: SheetWrite) => {
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
    const run = vi.fn(async (item: SheetWrite) => {
      sent.push(item.kind === 'append' ? item.rows.map((row) => (row as AbsenceRow).student_id) : [])
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
    const run = vi.fn(async (item: SheetWrite) => {
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
    const run = vi.fn(async (item: SheetWrite) => {
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
    const run = vi.fn(async (item: SheetWrite) => {
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
})
