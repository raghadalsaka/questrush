import { round, type Point } from './mapLayout'

export type FacetTone = 'lit' | 'mid' | 'shade'

export interface Facet {
  points: string
  tone: FacetTone
}

export interface IslandShape {
  outline: string
  sand: Facet[]
  grass: Facet[]
}

export type LandmarkKind = 'lighthouse' | 'palms' | 'volcano' | 'arch' | 'ruins' | 'crystal'

// The single key light comes from the top left (SVG y points down), so facets facing it are lit.
const KEY_LIGHT_ANGLE: number = Math.atan2(-1, -1)
export const CAST_SHADOW_OFFSET: Point = { x: 12, y: 16 }
export const ISLAND_DEPTH: number = 14

const LANDMARKS: readonly LandmarkKind[] = ['lighthouse', 'palms', 'volcano', 'arch', 'ruins', 'crystal']
const LIT_THRESHOLD: number = 0.35

export function landmarkFor(order: number): LandmarkKind {
  return LANDMARKS[(order - 1 + LANDMARKS.length) % LANDMARKS.length] as LandmarkKind
}

// Deterministic per island, so the archipelago looks the same on every screen and reload.
export function islandShape(seed: number, rx: number, ry: number): IslandShape {
  const random = mulberry32(seed + 1)
  const outline = ring(10, rx, ry, 0.12, { x: 0, y: 0 }, random)
  const grassCenter = { x: -rx * 0.3, y: -ry * 0.22 }
  const grass = ring(7, rx * 0.42, ry * 0.4, 0.18, grassCenter, random)
  return {
    outline: pointList(outline),
    sand: facets(outline, { x: -rx * 0.12, y: -ry * 0.16 }),
    grass: facets(grass, { x: grassCenter.x - rx * 0.05, y: grassCenter.y - ry * 0.06 }),
  }
}

function ring(count: number, rx: number, ry: number, jitter: number, center: Point, random: () => number): Point[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (random() - 0.5) * (Math.PI / count)
    const scale = 1 + (random() - 0.5) * 2 * jitter
    return { x: round(center.x + Math.cos(angle) * rx * scale), y: round(center.y + Math.sin(angle) * ry * scale) }
  })
}

function facets(outline: readonly Point[], peak: Point): Facet[] {
  return outline.map((from, index) => {
    const to = outline[(index + 1) % outline.length] as Point
    const facing = Math.atan2((from.y + to.y) / 2 - peak.y, (from.x + to.x) / 2 - peak.x)
    return { points: pointList([{ x: round(peak.x), y: round(peak.y) }, from, to]), tone: toneFor(Math.cos(facing - KEY_LIGHT_ANGLE)) }
  })
}

function toneFor(light: number): FacetTone {
  if (light > LIT_THRESHOLD) {
    return 'lit'
  }
  if (light < -LIT_THRESHOLD) {
    return 'shade'
  }
  return 'mid'
}

function pointList(points: readonly Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ')
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}
