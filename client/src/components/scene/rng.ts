/**
 * A seeded generator for the scene builders.
 *
 * A diorama is placed with a lot of small decisions (which window is lit, where
 * a crate stands, how tall the third tower is) and every one of them has to
 * come out the same for every seat at the table and the same after a reload:
 * the room is a place, and a place that rearranges itself on refresh is not.
 * `Math.random` is refused here for that reason; the seed is the scene's key.
 */
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number
  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number
  /** True with probability p. */
  chance(p: number): boolean
  /** One of the list. */
  pick<T>(list: readonly T[]): T
}

/** mulberry32: small, fast, and good enough to place lamp posts with. */
export function seededRng(seed: string | number): Rng {
  let a = typeof seed === 'number' ? seed >>> 0 : hash(seed)
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    pick: (list) => list[Math.floor(next() * list.length)],
  }
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
