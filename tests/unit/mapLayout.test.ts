import { describe, expect, it } from 'vitest'
import { MAP_HEIGHT, MAP_WIDTH, checkpointPositions, clusterLayout, trailPath } from '../../src/utils/mapLayout'

describe('checkpointPositions', () => {
  it.each([0, 1, 4, 8, 12, 20])('places the harbour plus %i stages inside the map', (stageCount) => {
    const points = checkpointPositions(stageCount)
    expect(points).toHaveLength(stageCount + 1)
    for (const point of points) {
      expect(point.x).toBeGreaterThan(0)
      expect(point.x).toBeLessThan(MAP_WIDTH)
      expect(point.y).toBeGreaterThan(0)
      expect(point.y).toBeLessThan(MAP_HEIGHT)
    }
  })

  it('draws one trail segment per step', () => {
    const path = trailPath(checkpointPositions(4))
    expect(path.startsWith('M ')).toBe(true)
    expect(path.match(/ C /g)).toHaveLength(4)
  })
})

describe('clusterLayout', () => {
  it('fits a whole class of 30 into a readable group with a "+N" overflow', () => {
    const layout = clusterLayout(30, 12, { x: 300, y: 300 }, true)
    expect(layout.slots).toHaveLength(12)
    expect(layout.overflow).toBe(19)
    expect(layout.slots.every((slot) => slot.y < 300)).toBe(true)
  })

  it.each([0, 1, 4, 8])('keeps every pawn inside the map for %i stages', (stageCount) => {
    for (const anchor of checkpointPositions(stageCount)) {
      const layout = clusterLayout(30, 12, anchor, anchor.y < MAP_HEIGHT / 2)
      for (const slot of layout.slots) {
        expect(slot.x - layout.pawnSize / 2).toBeGreaterThanOrEqual(0)
        expect(slot.x + layout.pawnSize / 2).toBeLessThanOrEqual(MAP_WIDTH)
      }
    }
  })

  it('shows small groups without overflow', () => {
    const layout = clusterLayout(3, 12, { x: 300, y: 300 }, false)
    expect(layout.slots).toHaveLength(3)
    expect(layout.overflow).toBe(0)
    expect(layout.slots.every((slot) => slot.y > 300)).toBe(true)
  })
})
