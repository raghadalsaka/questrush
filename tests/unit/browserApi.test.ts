import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBrowserApi } from '../../src/services/browserApi'
import type { BrowserStore } from '../../src/services/browserStore'
import type { SheetDb } from '../../src/services/sheetRules'

// Copies on the way in and out, as IndexedDB's structured clone does.
function memoryStore(): BrowserStore<SheetDb> & { copies: Map<string, SheetDb>; failSaves: boolean } {
  const copies = new Map<string, SheetDb>()
  const store = {
    copies,
    failSaves: false,
    load: async (key: string) => {
      const stored = copies.get(key)
      return stored === undefined ? null : structuredClone(stored)
    },
    save: async (key: string, db: SheetDb) => {
      if (store.failSaves) {
        throw new Error('QuotaExceededError')
      }
      copies.set(key, structuredClone(db))
    },
    remove: async (key: string) => {
      copies.delete(key)
    },
  }
  return store
}

// Grants each lock name to the first caller only and never releases it, like a tab that stays open.
function fakeLocks(): LockManager {
  const held = new Set<string>()
  return {
    request: (async (name: string, _options: LockOptions, callback: (lock: Lock | null) => unknown) => {
      if (held.has(name)) {
        return callback(null)
      }
      held.add(name)
      return callback({ name, mode: 'exclusive' } as Lock)
    }) as LockManager['request'],
    query: async () => ({ held: [], pending: [] }),
  }
}

describe('browserApi', () => {
  let store: ReturnType<typeof memoryStore>
  let locks: LockManager

  beforeEach(() => {
    store = memoryStore()
    locks = fakeLocks()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('starts empty, needs no sign-in and keeps classrooms after a reload', async () => {
    const api = createBrowserApi(store, locks)
    await api.me()
    expect(await api.listClassrooms()).toEqual([])

    const created = await api.createClassroom('Year 3', [{ name: 'Amira', emoji: '🦊' }])
    const session = await api.openSession(created.slug, 'harbour')
    await api.recordResult(session.session?.id ?? '', created.students[0]?.id ?? '', 'q1', 'correct')

    const reloaded = createBrowserApi(store, fakeLocks())
    await reloaded.me()
    const detail = await reloaded.getClassroom('year-3')
    expect(detail.students.map((student) => [student.name, student.points])).toEqual([['Amira', 1]])
    expect(detail.usedQuestionIds).toEqual({ harbour: ['q1'] })
  })

  it('refuses a change the browser could not save and shows the saved copy again', async () => {
    const api = createBrowserApi(store, locks)
    await api.createClassroom('Year 3', [{ name: 'Amira', emoji: '🦊' }])
    store.failSaves = true

    await expect(api.createClassroom('Year 4', [])).rejects.toMatchObject({ code: 'browser_storage_failed' })

    store.failSaves = false
    expect((await api.listClassrooms()).map((classroom) => classroom.slug)).toEqual(['year-3'])
  })

  it('keeps a second teacher tab out while the first is open', async () => {
    await createBrowserApi(store, locks).me()

    await expect(createBrowserApi(store, locks).me()).rejects.toMatchObject({ code: 'open_in_another_tab' })
  })

  it('serves the student link from the saved copy, including changes another tab saved', async () => {
    const teacher = createBrowserApi(store, locks)
    const student = createBrowserApi(store, locks)
    await expect(student.getPublicClassroom('year-3')).rejects.toMatchObject({ code: 'classroom_not_found' })

    await teacher.createClassroom('Year 3', [{ name: 'Amira', emoji: '🦊' }])

    const view = await student.getPublicClassroom('year-3')
    expect(view).toMatchObject({ name: 'Year 3', currentStageSlug: null, results: [] })
    expect(view.students.map((pawn) => pawn.name)).toEqual(['Amira'])
  })
})
