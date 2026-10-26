export interface Point {
  x: number
  y: number
}

export const MAP_WIDTH: number = 1200
export const MAP_HEIGHT: number = 700
const MARGIN_X: number = 110
const ROW_GAP: number = 250
const WAVE: number = 85
const CLUSTER_COLUMNS: number = 6
const CLUSTER_EDGE_GAP: number = 10

// Checkpoint 0 is the starting harbour; the rest follow a winding trail, wrapping into a second row past 8 stages.
export function checkpointPositions(stageCount: number): Point[] {
  const total = stageCount + 1
  const rows = total > 9 ? 2 : 1
  const perRow = Math.ceil(total / rows)
  const points: Point[] = []
  for (let index = 0; index < total; index++) {
    const row = Math.floor(index / perRow)
    const column = index % perRow
    const span = MAP_WIDTH - MARGIN_X * 2
    const step = perRow > 1 ? span / (perRow - 1) : 0
    const leftToRight = row % 2 === 0
    const x = MARGIN_X + (leftToRight ? column : perRow - 1 - column) * step
    const baseY = rows === 1 ? MAP_HEIGHT / 2 + 20 : 230 + row * ROW_GAP
    const y = baseY + (column % 2 === 0 ? WAVE : -WAVE) * (rows === 1 ? 1 : 0.55)
    points.push({ x: round(x), y: round(y) })
  }
  return points
}

// A smooth trail through the checkpoints (Catmull-Rom converted to cubic Bezier segments).
export function trailPath(points: readonly Point[]): string {
  if (points.length === 0) {
    return ''
  }
  const first = points[0] as Point
  let path = `M ${first.x} ${first.y}`
  for (let index = 0; index < points.length - 1; index++) {
    const p0 = points[index - 1] ?? points[index] as Point
    const p1 = points[index] as Point
    const p2 = points[index + 1] as Point
    const p3 = points[index + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    path += ` C ${round(c1.x)} ${round(c1.y)}, ${round(c2.x)} ${round(c2.y)}, ${p2.x} ${p2.y}`
  }
  return path
}

export interface ClusterLayout {
  slots: Point[]
  overflow: number
  pawnSize: number
}

// Pawns sit in a small grid beside the checkpoint; past `max` the last slot becomes a "+N" bubble.
export function clusterLayout(count: number, max: number, anchor: Point, above: boolean): ClusterLayout {
  const shown = count > max ? max - 1 : count
  const slotCount = count > max ? max : count
  const columns = Math.max(1, Math.min(slotCount, CLUSTER_COLUMNS))
  const pawnSize = slotCount > CLUSTER_COLUMNS ? 34 : 42
  const gap = pawnSize + 4
  const slots: Point[] = []
  for (let index = 0; index < slotCount; index++) {
    const row = Math.floor(index / columns)
    const column = index % columns
    const rowWidth = Math.min(columns, slotCount - row * columns)
    const x = anchor.x + (column - (rowWidth - 1) / 2) * gap
    const offset = 62 + row * gap
    const y = above ? anchor.y - offset : anchor.y + offset
    slots.push({ x, y })
  }
  // Shift the whole group sideways so pawns beside an edge checkpoint stay inside the map.
  const edge = pawnSize / 2 + CLUSTER_EDGE_GAP
  const left = Math.min(...slots.map((slot) => slot.x), edge)
  const right = Math.max(...slots.map((slot) => slot.x), MAP_WIDTH - edge)
  const shift = left < edge ? edge - left : MAP_WIDTH - edge - right
  return { slots: slots.map((slot) => ({ x: round(slot.x + shift), y: round(slot.y) })), overflow: count - shown, pawnSize }
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
