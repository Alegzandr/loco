import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CROSSFADE_S,
  FAMILIES,
  LAPS_PER_LOOP,
  nextFamily,
  resumeOffset,
  SECTION_RELEASE_MS,
  sectionHoldMs,
  PREFETCH_MAX,
  CACHE_BUDGET_BYTES,
  loopsFor,
  nextLoopId,
  SECTION_AT,
  SECTION_HOLD_MS,
  SECTIONS,
  sectionFor,
  shuffledOrder,
  SLEW_PER_SEC,
  type Section,
} from '../audio/music'
import { LOOPS } from '../audio/tracks'

/** Where the encoded loops live, relative to the client package root. */
const MUSIC_DIR = join(process.cwd(), 'public', 'music')

/** Deterministic stand-in for the engine's xorshift. */
const seeded = (seed: number) => {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

/**
 * The registry is data, so it is testable — and this is the layer where a
 * mistake is *silent*. A file that is not there fetches a 404 and the bed keeps
 * whatever was already sounding, which on the first loop of a match is silence
 * that looks like a design choice; a wrong `seconds` puts the loop point in the
 * middle of a bar and every turn of it drifts a little further.
 */
describe('the loop registry', () => {
  it('registers loops with unique ids', () => {
    expect(LOOPS.length).toBeGreaterThanOrEqual(4)
    const ids = LOOPS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const loop of LOOPS) {
    describe(loop.title, () => {
      it('has a file behind it', () => {
        const file = join(MUSIC_DIR, `${loop.id}.mp3`)
        expect(existsSync(file), `${loop.id}.mp3 is missing from public/music/`).toBe(true)
        // A file that exists and is empty is the same silence with a different
        // cause, and an encode that failed leaves exactly that behind.
        expect(statSync(file).size).toBeGreaterThan(50_000)
      })

      it('carries a turn long enough not to read as a loop', () => {
        expect(loop.seconds, loop.id).toBeGreaterThan(30)
        expect(loop.seconds, loop.id).toBeLessThan(180)
      })

      it('declares at least one real section', () => {
        expect(loop.sections.length).toBeGreaterThan(0)
        for (const s of loop.sections) expect(SECTIONS).toContain(s)
      })

      it('belongs to one of the families', () => {
        expect(FAMILIES).toContain(loop.family)
      })

      it('is named once, in English, and described in both languages', () => {
        // A title is a name and a blurb is copy: only the second is translated.
        // A piece whose name changes with the interface language is two pieces
        // to anybody who switches, and neither is the one the composer put out.
        expect(loop.title.trim().length).toBeGreaterThan(0)
        expect(loop.title, loop.id).toMatch(/^[A-Za-z0-9 '-]+$/)
        expect(loop.blurb.fr.trim().length).toBeGreaterThan(0)
        expect(loop.blurb.en.trim().length).toBeGreaterThan(0)
        // A title names the writing. The source files arrive as
        // `Sketchbook 2024-05-29`, which says nothing about this piece that it
        // would not say about the two hundred others in the pack.
        expect(loop.title, loop.id).not.toMatch(/sketchbook|\d{4}-\d{2}/i)
      })
    })
  }

  it('offers the groove enough loops to hold a long match', () => {
    // Where a match actually lives. Two was the floor everywhere and it was not
    // enough here: the first table to run on the recorded bed came back with
    // "it repeats", and an ordinary turn is where it was heard.
    expect(loopsFor('groove').length).toBeGreaterThanOrEqual(5)
  })

  it('keeps the warm set smaller than the library it is drawn from', () => {
    // The bound only means something while there is something to leave out. If
    // the registry ever shrinks to the budget, the sort in `prefetch` is doing
    // nothing and the comment above it is a lie.
    expect(PREFETCH_MAX).toBeLessThan(LOOPS.length)
    expect(PREFETCH_MAX).toBeGreaterThanOrEqual(2)
  })

  it('can hold everything it warms, so the warm-up never feeds the eviction', () => {
    // An AudioBuffer is deinterleaved float32 at the context rate, so a loop
    // costs about `seconds x 44100 x 2 x 4` bytes — a 102s piece is 37 MB, which
    // is 24 times its own MP3. If the budget could not hold `PREFETCH_MAX` of
    // the longest, warming would evict what warming had just decoded: three
    // fetches and three decodes spent to end up holding three buffers anyway.
    const longest = [...LOOPS].sort((a, b) => b.seconds - a.seconds).slice(0, PREFETCH_MAX)
    const worst = longest.reduce((n, l) => n + l.seconds * 44100 * 2 * 4, 0)
    expect(worst).toBeLessThanOrEqual(CACHE_BUDGET_BYTES * 1.6)
    // And the budget must not quietly become "hold everything", which is the
    // state this whole mechanism was added to get out of: 18 loops decoded at
    // once was measured at 418 MB.
    const all = LOOPS.reduce((n, l) => n + l.seconds * 44100 * 2 * 4, 0)
    expect(CACHE_BUDGET_BYTES).toBeLessThan(all / 3)
  })

  it('lets every family carry a whole match', () => {
    // A match is played inside one family, so a family missing a section would
    // send that section to another palette — the genre change the families
    // exist to remove — through `loopsFor`'s fallback. And the groove is where
    // a match lives: with one loop there the lap handover has nothing to hand
    // over to, and with two it alternates, which is the "chorus on repeat" the
    // registry-wide floor of five was raised for.
    for (const family of FAMILIES) {
      for (const section of SECTIONS) {
        const own = loopsFor(section, family).filter((l) => l.family === family)
        expect(own.length, `${family} has nothing for ${section}`).toBeGreaterThanOrEqual(1)
      }
      const groove = loopsFor('groove', family).filter((l) => l.family === family)
      expect(groove.length, `${family} groove`).toBeGreaterThanOrEqual(2)
    }
  })

  it('offers every section at least two loops', () => {
    // The whole anti-repetition argument rests on this. One loop for a section
    // means a table that sits in that section hears one piece of music for as
    // long as it sits there, which is the failure the old part/form design was
    // built to escape and this design has to keep escaping.
    for (const section of SECTIONS) {
      expect(loopsFor(section).length, section).toBeGreaterThanOrEqual(2)
    }
  })

})

describe('the arrangement ladder', () => {
  it('maps intensity onto sections', () => {
    expect(sectionFor(0)).toBe('breakdown')
    expect(sectionFor(0.1)).toBe('breakdown') // round summary
    expect(sectionFor(0.2)).toBe('buildup')
    expect(sectionFor(0.34)).toBe('groove') // an ordinary turn
    expect(sectionFor(0.58)).toBe('drop')
    expect(sectionFor(1)).toBe('drop')
  })

  it('orders the thresholds so sections build and never swap', () => {
    for (let n = 1; n < SECTIONS.length; n++) {
      expect(SECTION_AT[SECTIONS[n]]).toBeGreaterThan(SECTION_AT[SECTIONS[n - 1]])
    }
  })

  it('puts the lobby in a build-up whatever the intensity says', () => {
    expect(sectionFor(1, true)).toBe('buildup')
    expect(sectionFor(0, true)).toBe('buildup')
  })

  it('answers a change in about a bar, not instantly and not eventually', () => {
    // Game events move the intensity in jumps. The slew is what turns a jump
    // into an answer; the hold is what stops a value parked on a threshold from
    // chattering the bed between two loops.
    const fullSwing = 1 / SLEW_PER_SEC
    expect(fullSwing).toBeGreaterThan(1)
    expect(fullSwing).toBeLessThan(4)
    expect(SECTION_HOLD_MS).toBeGreaterThan(0)
    expect(SECTION_HOLD_MS).toBeLessThan(3000)
  })

  it('answers a rise in a bar and believes a fall only after it has held', () => {
    // An endgame hand goes 1 → 3 → 2 → 1 every few turns. Each dip under the
    // drop's threshold was a crossfade out and one back in, so a tense table
    // heard a different piece every ten seconds. A rise is still the moment the
    // drop exists for; a fall has to hold long enough to be the table calming
    // down rather than one seat drawing.
    expect(sectionHoldMs('groove', 'drop')).toBe(SECTION_HOLD_MS)
    expect(sectionHoldMs('breakdown', 'groove')).toBe(SECTION_HOLD_MS)
    expect(sectionHoldMs('drop', 'groove')).toBe(SECTION_RELEASE_MS)
    expect(sectionHoldMs('groove', 'buildup')).toBe(SECTION_RELEASE_MS)
    expect(sectionHoldMs('drop', 'buildup')).toBe(SECTION_RELEASE_MS)
    expect(SECTION_RELEASE_MS).toBeGreaterThanOrEqual(8000)
    expect(SECTION_RELEASE_MS).toBeLessThan(30_000)
    // The breakdown is the round summary — a stop, not a dip — and the one
    // section the ending is meant to sound like.
    expect(sectionHoldMs('drop', 'breakdown')).toBe(SECTION_HOLD_MS)
    expect(sectionHoldMs('groove', 'breakdown')).toBe(SECTION_HOLD_MS)
  })
})

describe('a hidden tab', () => {
  it('resumes the loop where it was, on the same lap', () => {
    // Every alt-tab used to draw another loop: the return went through
    // `start()`, which reshuffles. The pause is a pause, so the position is
    // kept — modulo the loop, since the seconds parked include whole laps.
    expect(resumeOffset(10, 60)).toBe(10)
    expect(resumeOffset(70, 60)).toBeCloseTo(10)
    expect(resumeOffset(0, 60)).toBe(0)
    expect(resumeOffset(-5, 60)).toBe(0)
    expect(resumeOffset(30, 0)).toBe(0)
  })
})

describe('the families', () => {
  const rand = seeded(5)

  it('keeps a match inside the palette it opened on', () => {
    for (const family of FAMILIES) {
      for (const section of SECTIONS) {
        let bag: string[] = []
        let current: string | null = null
        for (let n = 0; n < 30; n++) {
          const pick = nextLoopId(section, current, bag, rand, family)
          bag = pick.bag
          current = pick.id
          expect(LOOPS.find((l) => l.id === pick.id)?.family, `${family}/${section}`).toBe(family)
        }
      }
    }
  })

  it("tours a family's groove rather than alternating two of its loops", () => {
    for (const family of FAMILIES) {
      const all = loopsFor('groove', family).map((l) => l.id)
      let bag: string[] = []
      let current: string | null = null
      const seen = new Set<string>()
      for (let n = 0; n < all.length * 4; n++) {
        const pick = nextLoopId('groove', current, bag, rand, family)
        bag = pick.bag
        current = pick.id
        seen.add(pick.id)
      }
      expect(seen.size, family).toBe(all.length)
    }
  })

  it('moves to another palette when the scene moves', () => {
    for (const family of FAMILIES) {
      for (let n = 0; n < 20; n++) {
        const next = nextFamily(family, rand)
        expect(FAMILIES).toContain(next)
        expect(next).not.toBe(family)
      }
    }
    expect(FAMILIES).toContain(nextFamily(null, rand))
  })
})

describe('shuffled playback', () => {
  it('deals every id exactly once per bag', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (let seed = 1; seed < 60; seed++) {
      const bag = shuffledOrder(ids, null, seeded(seed))
      expect(bag.length).toBe(ids.length)
      expect(new Set(bag)).toEqual(new Set(ids))
    }
  })

  it('never opens on the loop that just played', () => {
    // The point of a bag over `Math.random()`: with two loops carrying a
    // section, pure random replays the outgoing one half the time, which people
    // hear as broken rather than as random.
    const ids = ['a', 'b', 'c']
    for (let seed = 1; seed < 200; seed++) {
      for (const avoid of ids) {
        expect(shuffledOrder(ids, avoid, seeded(seed))[0], `seed ${seed}`).not.toBe(avoid)
      }
    }
  })

  it('terminates on a one-id bag instead of hunting for a different head', () => {
    expect(shuffledOrder(['solo'], 'solo', seeded(7))).toEqual(['solo'])
  })

  it('actually shuffles', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const orders = new Set<string>()
    for (let seed = 1; seed < 40; seed++) orders.add(shuffledOrder(ids, null, seeded(seed)).join())
    expect(orders.size).toBeGreaterThan(5)
  })

  it('gives a loop a turn long enough to be a piece and short enough not to nag', () => {
    // Both ends are the repetition complaint. Under two, a piece is heard once
    // and the bed reads as a shuffle; over about two minutes the same loop is
    // still playing long after the ear has finished with it, which is what
    // three laps of a 44s loop did.
    expect(LAPS_PER_LOOP).toBeGreaterThanOrEqual(2)
    const shortest = Math.min(...LOOPS.map((l) => l.seconds))
    const longest = Math.max(...LOOPS.map((l) => l.seconds))
    expect(shortest * LAPS_PER_LOOP).toBeGreaterThan(60)
    expect(longest * LAPS_PER_LOOP).toBeLessThan(220)
    expect(CROSSFADE_S).toBeGreaterThan(0)
    expect(CROSSFADE_S).toBeLessThan(6)
  })
})

describe('choosing the next loop', () => {
  const rand = seeded(11)

  it('stays inside the section it was asked for', () => {
    for (const section of SECTIONS) {
      let bag: string[] = []
      let current: string | null = null
      for (let n = 0; n < 40; n++) {
        const pick = nextLoopId(section, current, bag, rand)
        bag = pick.bag
        current = pick.id
        expect(loopsFor(section).map((l) => l.id), section).toContain(pick.id)
      }
    }
  })

  it('never hands back the loop already playing', () => {
    // Both reasons for changing loop go through here. Returning `current` would
    // make a handover restart the piece from the top and a section change an
    // audible seam in service of nothing.
    for (const section of SECTIONS) {
      let bag: string[] = []
      let current = loopsFor(section)[0].id
      for (let n = 0; n < 40; n++) {
        const pick = nextLoopId(section, current, bag, rand)
        expect(pick.id, `${section} after ${current}`).not.toBe(current)
        bag = pick.bag
        current = pick.id
      }
    }
  })

  it('tours a section rather than alternating two of its loops', () => {
    const section: Section = 'groove'
    const all = loopsFor(section).map((l) => l.id)
    let bag: string[] = []
    let current: string | null = null
    const seen = new Set<string>()
    for (let n = 0; n < all.length * 4; n++) {
      const pick = nextLoopId(section, current, bag, rand)
      bag = pick.bag
      current = pick.id
      seen.add(pick.id)
    }
    expect(seen.size).toBe(all.length)
  })

  it('answers a section carried by one loop instead of going silent', () => {
    // Not reachable through the registry — the guard above forbids it — but the
    // engine calls this on every tick and must not be able to return undefined.
    const only = LOOPS[0].id
    const pick = nextLoopId(LOOPS[0].sections[0], only, [only], rand)
    expect(typeof pick.id).toBe('string')
    expect(pick.id.length).toBeGreaterThan(0)
  })
})
