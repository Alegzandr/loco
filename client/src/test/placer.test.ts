/**
 * Nothing in a room may stand inside anything else. The placer is the whole
 * of that rule, and it is arithmetic: two oriented rectangles either overlap
 * or they do not, and a claim that overlaps is refused.
 */
import { describe, it, expect } from 'vitest'
import { Placer, overlaps } from '../components/scene/placer'

describe('overlaps', () => {
  it('sees two boxes side by side as apart, and two boxes crossing as not', () => {
    expect(overlaps({ x: 0, z: 0, w: 2, d: 2, rot: 0 }, { x: 3, z: 0, w: 2, d: 2, rot: 0 })).toBe(false)
    expect(overlaps({ x: 0, z: 0, w: 2, d: 2, rot: 0 }, { x: 1.5, z: 0, w: 2, d: 2, rot: 0 })).toBe(true)
  })

  it('respects the rotation: a long thin box turned away clears what it would hit straight', () => {
    const wall = { x: 0, z: 0, w: 10, d: 0.5, rot: 0 }
    const crate = { x: 4, z: 1.2, w: 1, d: 1, rot: 0 }
    expect(overlaps(wall, crate)).toBe(false)
    // Straight on it reaches x = 5; turned a quarter it reaches z = ±5 and x = ±0.25.
    expect(overlaps({ ...wall, rot: Math.PI / 2 }, crate)).toBe(false)
    expect(overlaps({ ...wall, rot: Math.PI / 2 }, { x: 0, z: 4, w: 1, d: 1, rot: 0 })).toBe(true)
  })

  it('takes a margin: touching is overlapping once one is grown', () => {
    const a = { x: 0, z: 0, w: 2, d: 2, rot: 0 }
    const b = { x: 2.2, z: 0, w: 2, d: 2, rot: 0 }
    expect(overlaps(a, b, 0)).toBe(false)
    expect(overlaps(a, b, 0.3)).toBe(true)
  })

  it('handles a diamond against a square', () => {
    const diamond = { x: 0, z: 0, w: 2, d: 2, rot: Math.PI / 4 }
    // The diamond reaches √2 along the axes; a square starting at 1.5 misses it.
    expect(overlaps(diamond, { x: 2.5, z: 0, w: 2, d: 2, rot: 0 })).toBe(false)
    expect(overlaps(diamond, { x: 2.2, z: 0, w: 2, d: 2, rot: 0 })).toBe(true)
  })
})

describe('Placer', () => {
  it('refuses a second claim on the same ground and accepts one beside it', () => {
    const p = new Placer(0.3)
    expect(p.place({ x: 0, z: 0, w: 4, d: 4, rot: 0 })).toBe(true)
    expect(p.place({ x: 1, z: 1, w: 2, d: 2, rot: 0 })).toBe(false)
    expect(p.place({ x: 5, z: 0, w: 2, d: 2, rot: 0 })).toBe(true)
    expect(p.count).toBe(2)
  })

  it('asks at its own margin unless told another: passing through is not building', () => {
    const p = new Placer(0.3)
    p.claim({ x: 0, z: 0, w: 1, d: 1, rot: 0 })
    // A quarter tile clear of the claim: too close to build beside it, room enough to walk past.
    const past = { x: 0.9, z: 0, w: 0.3, d: 0.3, rot: 0 }
    expect(p.free(past)).toBe(false)
    expect(p.free(past, 0)).toBe(true)
    // Inside it is refused either way.
    expect(p.free({ x: 0.2, z: 0, w: 0.3, d: 0.3, rot: 0 }, 0)).toBe(false)
  })

  it('treats a zone claimed first as ground nothing may take', () => {
    const p = new Placer()
    p.claim({ x: 0, z: 0, w: 40, d: 12, rot: Math.PI / 4 })
    expect(p.free({ x: 0, z: 0, w: 1, d: 1, rot: 0 })).toBe(false)
    expect(p.free({ x: 30, z: -30, w: 1, d: 1, rot: 0 })).toBe(true)
  })

  it('finds a neighbour through the grid whatever the cell it was filed under', () => {
    const p = new Placer(0)
    // A long wall spans many cells; an ask in the middle of it must still hit it.
    p.claim({ x: 0, z: 0, w: 60, d: 1, rot: 0 })
    expect(p.free({ x: 17.5, z: 0.2, w: 1, d: 1, rot: 0 })).toBe(false)
    expect(p.free({ x: 17.5, z: 3, w: 1, d: 1, rot: 0 })).toBe(true)
  })
})
