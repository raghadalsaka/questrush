import type { SheetDb } from './sheetRules'

const DATABASE_NAME: string = 'questrush'
const DATABASE_VERSION: number = 1
const COPIES_STORE: string = 'copies'

export interface BrowserStore {
  load: (key: string) => Promise<SheetDb | null>
  save: (key: string, db: SheetDb) => Promise<void>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is not available in this browser'))
  }
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(COPIES_STORE)) {
      request.result.createObjectStore(COPIES_STORE)
    }
  }
  return requestResult(request)
}

export function indexedDbStore(): BrowserStore {
  let database: Promise<IDBDatabase> | null = null

  function connection(): Promise<IDBDatabase> {
    database ??= openDatabase().catch((error: unknown) => {
      database = null
      throw error
    })
    return database
  }

  return {
    load: async (key) => {
      const store = (await connection()).transaction(COPIES_STORE, 'readonly').objectStore(COPIES_STORE)
      return ((await requestResult(store.get(key))) as SheetDb | undefined) ?? null
    },
    save: async (key, db) => {
      const transaction = (await connection()).transaction(COPIES_STORE, 'readwrite')
      transaction.objectStore(COPIES_STORE).put(db, key)
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'))
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write was aborted'))
      })
    },
  }
}
