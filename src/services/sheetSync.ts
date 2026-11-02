import { breaksRules, cellsOf, firstFreeSlug, TABLE_NAMES, type ColumnOf, type SheetDb, type SheetRow, type SheetWrite, type TableName } from './sheetRules'

// The cells that identify a row on the sheet; row numbers move when rows are deleted elsewhere, keys don't.
const ROW_KEYS: { [T in TableName]: readonly ColumnOf<T>[] } = {
  classrooms: ['slug'],
  students: ['id'],
  turns: ['classroom_slug', 'stage_slug', 'student_id'],
  sessions: ['id'],
  absences: ['session_id', 'student_id'],
}

// A change not yet on the sheet, with its row as it was before, so a sync can tell whether the sheet moved on since.
export interface PendingWrite {
  write: SheetWrite
  before: SheetRow | null
}

type PushDecision = 'push' | 'done' | 'drop'

export interface Reconciled {
  projected: SheetDb
  push: PendingWrite[]
  dropped: number
}

export function rowKey(table: TableName, row: SheetRow): string {
  const record = row as Record<string, unknown>
  return (ROW_KEYS[table] as readonly string[]).map((column) => String(record[column] ?? '')).join('\u0000')
}

function findRow<T extends SheetRow>(rows: readonly T[], table: TableName, key: string): T | null {
  return rows.find((row) => rowKey(table, row) === key) ?? null
}

export function cloneDb(db: SheetDb): SheetDb {
  const copy = {} as Record<TableName, SheetRow[]>
  for (const table of TABLE_NAMES) {
    copy[table] = (db[table] as SheetRow[]).map((row) => ({ ...row }))
  }
  return copy as SheetDb
}

// The rules hand back live rows; the pending log keeps copies so later edits and storage can't change them.
export function pendingFrom(writes: readonly SheetWrite[], before: SheetDb): PendingWrite[] {
  return writes.map((write) =>
    clonePending({ write, before: write.kind === 'append' ? null : findRow(before[write.table] as SheetRow[], write.table, rowKey(write.table, write.row)) }),
  )
}

// Every row a waiting change holds, its earlier copy included.
export function rowsOf(item: PendingWrite): SheetRow[] {
  const rows = item.write.kind === 'append' ? item.write.rows : [item.write.row]
  return item.before === null ? rows : [...rows, item.before]
}

// The sheet wins: a change goes through only while its row on the sheet is still what this browser last saw.
function decideRow(current: readonly SheetRow[], table: TableName, kind: SheetWrite['kind'], row: SheetRow, before: SheetRow | null): PushDecision {
  const onSheet = findRow(current, table, rowKey(table, row))
  if (kind === 'append') {
    if (onSheet === null) {
      return 'push'
    }
    return sameCells(table, onSheet, row) ? 'done' : 'drop'
  }
  if (onSheet === null) {
    return kind === 'update' ? 'drop' : 'done'
  }
  if (kind === 'update' && sameCells(table, onSheet, row)) {
    return 'done'
  }
  return before !== null && sameCells(table, onSheet, before) ? 'push' : 'drop'
}

// Replays this browser's unsaved changes, in order, on top of a freshly read sheet. Each accepted change is applied to
// the projection before the next is judged, so a later change can depend on an earlier one; a dropped change takes
// every change that depends on it with it, because its parent row never reaches the projection.
export function reconcile(sheet: SheetDb, pending: readonly PendingWrite[]): Reconciled {
  const projected = cloneDb(sheet)
  const queue = pending.map(clonePending)
  const push: PendingWrite[] = []
  let dropped = 0
  queue.forEach((item, index) => {
    const { write } = item
    if (write.kind === 'append') {
      const kept: SheetRow[] = []
      for (const row of write.rows) {
        let decision = decideRow(projected[write.table] as SheetRow[], write.table, 'append', row, null)
        if (decision === 'drop' && write.table === 'classrooms') {
          renameClassroom(queue.slice(index), (row as Record<string, string>).slug ?? '', freeSlug(projected, queue, (row as Record<string, string>).slug ?? ''))
          decision = decideRow(projected.classrooms as SheetRow[], 'classrooms', 'append', row, null)
        }
        if (decision === 'push' && breaksRules(projected, write.table, 'append', row)) {
          decision = 'drop'
        }
        if (decision === 'push') {
          kept.push(row)
          ;(projected[write.table] as SheetRow[]).push({ ...row })
        }
        if (decision === 'drop') {
          dropped++
        }
      }
      if (kept.length > 0) {
        push.push({ write: { kind: 'append', table: write.table, rows: kept }, before: null })
      }
      return
    }
    let decision = decideRow(projected[write.table] as SheetRow[], write.table, write.kind, write.row, item.before)
    if (decision === 'push' && breaksRules(projected, write.table, write.kind, write.row)) {
      decision = 'drop'
    }
    if (decision === 'push') {
      // Saves don't read first, so the row number comes from the sheet just read (null while its append still waits).
      write.row.rowNumber = findRow(projected[write.table] as SheetRow[], write.table, rowKey(write.table, write.row))?.rowNumber ?? null
      applyTo(projected, write)
      push.push(item)
    }
    if (decision === 'drop') {
      dropped++
    }
  })
  return { projected, push, dropped }
}

function applyTo(db: SheetDb, write: SheetWrite): void {
  const rows = db[write.table] as SheetRow[]
  if (write.kind === 'append') {
    rows.push(...write.rows.map((row) => ({ ...row })))
    return
  }
  const key = rowKey(write.table, write.row)
  const index = rows.findIndex((row) => rowKey(write.table, row) === key)
  if (write.kind === 'update') {
    rows[index] = { ...write.row }
    return
  }
  rows.splice(index, 1)
}

// A classroom made offline whose name was taken on the sheet meanwhile keeps its students under a free slug.
function freeSlug(db: SheetDb, queue: readonly PendingWrite[], slug: string): string {
  const taken = new Set(db.classrooms.map((classroom) => classroom.slug))
  for (const item of queue) {
    if (item.write.kind === 'append' && item.write.table === 'classrooms') {
      item.write.rows.forEach((row) => taken.add((row as Record<string, string>).slug ?? ''))
    }
  }
  return firstFreeSlug(slug, taken)
}

function renameClassroom(queue: readonly PendingWrite[], from: string, to: string): void {
  console.warn('classroom slug taken on the sheet; saving it under a new one', from, to)
  for (const item of queue) {
    for (const row of rowsOf(item)) {
      const record = row as Record<string, string>
      if (item.write.table === 'classrooms' && record.slug === from) {
        record.slug = to
      }
      if (record.classroom_slug === from) {
        record.classroom_slug = to
      }
    }
  }
}

function clonePending(item: PendingWrite): PendingWrite {
  const write: SheetWrite =
    item.write.kind === 'append' ? { ...item.write, rows: item.write.rows.map((row) => ({ ...row })) } : { ...item.write, row: { ...item.write.row } }
  return { write, before: item.before === null ? null : { ...item.before } }
}

function sameCells(table: TableName, a: SheetRow, b: SheetRow): boolean {
  return cellsOf(table, a).join('\u0001') === cellsOf(table, b).join('\u0001')
}
