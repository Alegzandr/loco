import { describe, it, expect } from 'vitest'
import { seatLayout, tableRect } from '../components/cards/layout'
import { SEAT_DIMS, BOTTOM_RESERVE } from '../components/cards/cardTheme'

const DESKTOP = { w: 1440, h: 900 }
const PHONE = { w: 390, h: 844 }

/** True when no two pills on the same row overlap horizontally. */
function noHorizontalOverlap(
  positions: { x: number; y: number }[],
  pillW: number,
  pillH: number,
): boolean {
  const rows = new Map<number, number[]>()
  for (const p of positions) {
    // Group by row: pills within half a pill height of each other are one row.
    const key = Math.round(p.y / (pillH / 2))
    const bucket = rows.get(key) ?? []
    bucket.push(p.x)
    rows.set(key, bucket)
  }
  for (const xs of rows.values()) {
    const sorted = [...xs].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < pillW) return false
    }
  }
  return true
}

describe('seatLayout', () => {
  it('returns nothing for a table with no opponents', () => {
    const l = seatLayout(0, DESKTOP.w, DESKTOP.h)
    expect(l.positions).toEqual([])
    expect(l.blockHeight).toBe(0)
  })

  it('uses full-size pills on a desktop table of four', () => {
    const l = seatLayout(3, DESKTOP.w, DESKTOP.h)
    expect(l.size).toBe('full')
    expect(l.pillW).toBe(SEAT_DIMS.full.w)
    expect(l.positions).toHaveLength(3)
  })

  it('never uses full-size pills on a phone, even for one opponent', () => {
    const l = seatLayout(1, PHONE.w, PHONE.h)
    expect(l.size).not.toBe('full')
  })

  it('shrinks rather than overlaps as the table fills up', () => {
    const sizes = [2, 4, 6, 9].map((n) => seatLayout(n, DESKTOP.w, DESKTOP.h))
    for (const l of sizes) {
      expect(noHorizontalOverlap(l.positions, l.pillW, l.pillH)).toBe(true)
    }
  })

  it('keeps nine opponents readable on a phone by wrapping to rows', () => {
    const l = seatLayout(9, PHONE.w, PHONE.h)
    expect(l.size).toBe('mini')
    expect(l.positions).toHaveLength(9)
    expect(noHorizontalOverlap(l.positions, l.pillW, l.pillH)).toBe(true)
    const rows = new Set(l.positions.map((p) => Math.round(p.y)))
    expect(rows.size).toBeGreaterThan(1)
  })

  it('keeps every pill inside the viewport', () => {
    for (const vp of [DESKTOP, PHONE, { w: 320, h: 640 }]) {
      for (const n of [1, 3, 5, 9]) {
        const l = seatLayout(n, vp.w, vp.h)
        for (const p of l.positions) {
          expect(p.x - l.pillW / 2).toBeGreaterThanOrEqual(0)
          expect(p.x + l.pillW / 2).toBeLessThanOrEqual(vp.w)
          expect(p.y - l.pillH / 2).toBeGreaterThan(0)
        }
      }
    }
  })

  it('clears the top chrome so seats never sit under the header controls', () => {
    const l = seatLayout(4, DESKTOP.w, DESKTOP.h)
    const highest = Math.min(...l.positions.map((p) => p.y - l.pillH / 2))
    expect(highest).toBeGreaterThanOrEqual(52)
  })

  it('reports a block height that covers every seat', () => {
    const l = seatLayout(7, PHONE.w, PHONE.h)
    const lowest = Math.max(...l.positions.map((p) => p.y + l.pillH / 2))
    expect(l.blockHeight).toBeGreaterThanOrEqual(lowest)
  })

  it('places the first clockwise opponent left of the last', () => {
    const l = seatLayout(3, DESKTOP.w, DESKTOP.h)
    expect(l.positions[0].x).toBeLessThan(l.positions[2].x)
  })
})

describe('tableRect', () => {
  it('never overflows the viewport width', () => {
    for (const vp of [DESKTOP, PHONE, { w: 320, h: 640 }, { w: 2560, h: 1440 }]) {
      const t = tableRect(vp.w, vp.h, 120)
      expect(t.left).toBeGreaterThanOrEqual(0)
      expect(t.left + t.width).toBeLessThanOrEqual(vp.w)
    }
  })

  it('stays below the seat block', () => {
    const seats = seatLayout(7, PHONE.w, PHONE.h)
    const t = tableRect(PHONE.w, PHONE.h, seats.blockHeight)
    expect(t.top).toBeGreaterThanOrEqual(seats.blockHeight)
  })

  it('stays clear of the action bar at the bottom', () => {
    const t = tableRect(DESKTOP.w, DESKTOP.h, 120)
    expect(t.top + t.height).toBeLessThanOrEqual(DESKTOP.h - BOTTOM_RESERVE)
  })

  it('stays an oval rather than collapsing to a circle', () => {
    for (const vp of [DESKTOP, PHONE]) {
      const t = tableRect(vp.w, vp.h, 120)
      expect(t.height).toBeLessThan(t.width)
    }
  })
})
