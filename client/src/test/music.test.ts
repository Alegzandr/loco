import { describe, expect, it } from 'vitest'
import {
  LAYERS,
  nextFormIndex,
  noteLength,
  partById,
  PASSES_PER_TRACK,
  SECTION_AT,
  sectionFor,
  shuffledOrder,
  type Section,
} from '../audio/music'
import { TRACKS } from '../audio/tracks'
import { ressac } from '../audio/tracks/ressac'
import type { PartDef, TrackDef } from '../audio/tracks/types'

const SECTIONS: Section[] = ['breakdown', 'buildup', 'groove', 'drop']

/**
 * Tracks are data, so they are testable — and this is the layer where a mistake
 * is *silent*. A row one slot short does not throw, it just drifts the melody
 * against the harmony a little further on every pass; an unreachable part id
 * plays nothing and looks like a design choice.
 */
describe('tracks — structural integrity', () => {
  it('registers at least three, with unique ids', () => {
    expect(TRACKS.length).toBeGreaterThanOrEqual(3)
    const ids = TRACKS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const track of TRACKS) {
    describe(track.title, () => {
      const parts = new Map(track.parts.map((p) => [p.id, p]))

      it('has a tempo and a pump shape', () => {
        expect(track.bpm).toBeGreaterThan(90)
        expect(track.bpm).toBeLessThan(200)
        expect(track.pump.length).toBeGreaterThan(0)
      })

      it('names only parts that exist in its form', () => {
        for (const id of track.form) expect(parts.has(id), id).toBe(true)
      })

      it('is long enough that a part does not come round every few seconds', () => {
        // The whole complaint that produced this design was "it's just a chorus
        // on repeat". Four bars at 138 BPM is 7s; a form has to be minutes.
        const bars = track.form.reduce((n, id) => n + (parts.get(id)?.bars.length ?? 0), 0)
        const seconds = (bars * 4 * 60) / track.bpm
        expect(seconds).toBeGreaterThan(45)
      })

      it('offers every role the arrangement can ask for', () => {
        // `nextFormIndex` falls through when a role is missing, so this is a
        // quality bar rather than a crash: without a break part, a round summary
        // gets a chorus played quietly instead of an actual breakdown.
        const roles = new Set(track.form.map((id) => parts.get(id)?.role))
        for (const role of ['intro', 'verse', 'chorus', 'break'] as const) {
          expect(roles.has(role), role).toBe(true)
        }
      })

      it('fills every melodic row exactly, so lines never drift against harmony', () => {
        for (const part of track.parts) {
          for (const [name, rows] of [['lead', part.lead], ['counter', part.counter]] as const) {
            if (!rows) continue
            expect(rows.length, `${part.id}.${name} bars`).toBe(part.bars.length)
            for (const row of rows) {
              expect(row.length, `${part.id}.${name} row`).toBe(part.div)
            }
          }
          expect(part.bass.length, `${part.id}.bass`).toBe(16)
        }
      })

      it('never opens a row with a tie', () => {
        // A leading `-1` extends a note that does not exist; it would silently
        // swallow the first slot of the bar.
        for (const part of track.parts) {
          for (const rows of [part.lead, part.counter]) {
            for (const row of rows ?? []) expect(row[0], part.id).not.toBe(-1)
          }
        }
      })

      it('keeps every melodic note in a register that reads over the game', () => {
        for (const part of track.parts) {
          for (const row of part.lead ?? []) {
            for (const midi of row) {
              if (midi <= 0) continue
              expect(midi, `${part.id}`).toBeGreaterThanOrEqual(60) // C4
              expect(midi, `${part.id}`).toBeLessThanOrEqual(88) // E6
            }
          }
        }
      })

      it('keeps the counter-line under the lead so the tune stays on top', () => {
        for (const part of track.parts) {
          if (!part.counter || !part.lead) continue
          const top = (rows: number[][]) => Math.max(...rows.flat())
          expect(top(part.counter), part.id).toBeLessThan(top(part.lead))
        }
      })

      it('builds arp figures from the chord of their own bar', () => {
        for (const part of track.parts) {
          for (const bar of part.bars) {
            const tones = new Set(bar.chord.map((m) => m % 12))
            for (const midi of bar.arp) expect(tones.has(midi % 12)).toBe(true)
          }
        }
      })

      it('places stabs off the beat, where a stab belongs', () => {
        for (const part of track.parts) {
          for (const step of part.stabs ?? []) expect(step % 4).not.toBe(0)
        }
      })

      it('moves harmonically instead of circling one chord', () => {
        const roots = new Set(track.parts.flatMap((p) => p.bars.map((b) => b.root)))
        expect(roots.size).toBeGreaterThanOrEqual(5)
      })
    })
  }
})

describe('ressac: the hook is the user\'s own', () => {
  it('keeps the sketch lead note for note', () => {
    // Transcribed from `F:\dev\strudel-test\neon-horizon.strudel`:
    //   [e5 ~ c5 e5 ~ a4 ~ c5] [~ e5 ~ a5 g5 ~ e5 ~]
    //   [f5 ~ c5 f5 ~ a4 ~ c5] [~ f5 ~ a5 g5 ~ e5 ~]
    const chorus = partById(ressac, 'chorus') as PartDef
    expect(chorus.lead).toEqual([
      [76, 0, 72, 76, 0, 69, 0, 72],
      [0, 76, 0, 81, 79, 0, 76, 0],
      [77, 0, 72, 77, 0, 69, 0, 72],
      [0, 77, 0, 81, 79, 0, 76, 0],
    ])
  })

  it('keeps the sketch tempo, arp figures and voicings', () => {
    expect(ressac.bpm).toBe(138) // setcpm(138/4)
    const verse = partById(ressac, 'verse') as PartDef
    expect(verse.bars.map((b) => b.arp)).toEqual([
      [57, 60, 64, 69, 72, 69, 64, 60], // a3 c4 e4 a4 c5 a4 e4 c4
      [53, 57, 60, 65, 69, 65, 60, 57],
      [60, 64, 67, 72, 76, 72, 67, 64],
      [55, 59, 62, 67, 71, 67, 62, 59],
    ])
    expect(verse.bars.map((b) => b.chord)).toEqual([
      [57, 60, 64, 69], // [a3,c4,e4,a4]
      [53, 57, 60, 65],
      [60, 64, 67, 72],
      [55, 59, 62, 67],
    ])
  })

  it('keeps the bass off the downbeat, as the sketch does', () => {
    // `struct("[~ x x x]*4")` — which is also why it never collides with a kick.
    const chorus = partById(ressac, 'chorus') as PartDef
    for (const beat of [0, 4, 8, 12]) expect(chorus.bass[beat]).toBeNull()
  })
})

describe('noteLength', () => {
  it('counts ties', () => {
    expect(noteLength([72, -1, -1, 0], 0)).toBe(3)
    expect(noteLength([72, 0, 74, -1], 0)).toBe(1)
    expect(noteLength([72, 0, 74, -1], 2)).toBe(2)
  })

  it('stops at the end of the row rather than running off it', () => {
    expect(noteLength([72, -1, -1, -1], 0)).toBe(4)
    expect(noteLength([0, 0, 0, 72], 3)).toBe(1)
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

  it('orders the thresholds so stacks build and never swap', () => {
    for (let n = 1; n < SECTIONS.length; n++) {
      expect(SECTION_AT[SECTIONS[n]]).toBeGreaterThan(SECTION_AT[SECTIONS[n - 1]])
    }
  })

  it('puts the lobby in a build-up: the tune, without the drums', () => {
    expect(sectionFor(1, true)).toBe('buildup')
    expect(LAYERS.buildup.lead).toBe(true)
    expect(LAYERS.buildup.kick).toBe(false)
  })

  it('never drops the tune as the table gets tense', () => {
    // The mistake a previous bed made: a theme gated above where the game
    // actually lives is a theme nobody hears.
    for (const section of SECTIONS) expect(LAYERS[section].lead, section).toBe(true)
  })

  it('stacks rhythm layers monotonically across the ladder', () => {
    const count = (s: Section) => {
      const l = LAYERS[s]
      return [l.kick, l.hats, l.ride, l.bass, l.stabs, l.counter].filter(Boolean).length
    }
    for (let n = 1; n < SECTIONS.length; n++) {
      expect(count(SECTIONS[n])).toBeGreaterThanOrEqual(count(SECTIONS[n - 1]))
    }
  })
})

describe('shuffled playback', () => {
  /** Deterministic stand-in for the engine's xorshift. */
  const seeded = (seed: number) => {
    let s = seed
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0
      return s / 0x100000000
    }
  }

  it('deals every track exactly once per bag', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    for (let seed = 1; seed < 60; seed++) {
      const bag = shuffledOrder(ids, null, seeded(seed))
      expect(bag.length).toBe(ids.length)
      expect(new Set(bag)).toEqual(new Set(ids))
    }
  })

  it('never opens on the track that just played', () => {
    // The point of a bag over `Math.random()`: pure random would repeat roughly
    // one handover in three, which people hear as broken rather than as random.
    const ids = ['a', 'b', 'c']
    for (let seed = 1; seed < 200; seed++) {
      for (const avoid of ids) {
        expect(shuffledOrder(ids, avoid, seeded(seed))[0], `seed ${seed}`).not.toBe(avoid)
      }
    }
  })

  it('terminates on a one-track bag instead of hunting for a different head', () => {
    expect(shuffledOrder(['solo'], 'solo', seeded(7))).toEqual(['solo'])
  })

  it('actually shuffles', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const orders = new Set<string>()
    for (let seed = 1; seed < 40; seed++) orders.add(shuffledOrder(ids, null, seeded(seed)).join())
    expect(orders.size).toBeGreaterThan(5)
  })

  it('gives every track a song-length turn before handing over', () => {
    // Two passes of a form. One pass is about a minute, which is short for
    // something presented as a song and makes the handover feel like a carousel.
    expect(PASSES_PER_TRACK).toBeGreaterThanOrEqual(2)
    for (const track of TRACKS) {
      const bars = track.form.reduce(
        (n, id) => n + (partById(track, id)?.bars.length ?? 0), 0,
      ) * PASSES_PER_TRACK
      const seconds = (bars * 4 * 60) / track.bpm
      expect(seconds, track.id).toBeGreaterThan(100)
      expect(seconds, track.id).toBeLessThan(240)
    }
  })
})

describe('the song form', () => {
  const roleAt = (track: TrackDef, index: number) => partById(track, track.form[index])?.role

  it('always moves — it can never return the index it was given', () => {
    // A form that stalls is the loop this whole design exists to escape.
    for (const track of TRACKS) {
      for (const section of SECTIONS) {
        for (let i = 0; i < track.form.length; i++) {
          expect(nextFormIndex(track, i, section), `${track.id} ${section} ${i}`).not.toBe(i)
        }
      }
    }
  })

  it('stays inside the form', () => {
    for (const track of TRACKS) {
      for (const section of SECTIONS) {
        for (let i = 0; i < track.form.length; i++) {
          const next = nextFormIndex(track, i, section)
          expect(next).toBeGreaterThanOrEqual(0)
          expect(next).toBeLessThan(track.form.length)
        }
      }
    }
  })

  it('never answers a drop with a break, or a round summary with a chorus', () => {
    for (const track of TRACKS) {
      for (let i = 0; i < track.form.length; i++) {
        expect(['chorus', 'bridge'], track.id)
          .toContain(roleAt(track, nextFormIndex(track, i, 'drop')))
        expect(['break', 'intro'], track.id)
          .toContain(roleAt(track, nextFormIndex(track, i, 'breakdown')))
      }
    }
  })

  it('tours the track when the section holds still', () => {
    // Sitting in one section for a whole match must still walk the form. This is
    // the test that caught the first implementation ping-ponging between two
    // verses forever — technically "moving", musically still a loop.
    for (const track of TRACKS) {
      for (const section of ['groove', 'drop'] as const) {
        const seen = new Set<number>()
        let i = 0
        for (let n = 0; n < track.form.length * 3; n++) {
          i = nextFormIndex(track, i, section)
          seen.add(i)
        }
        expect(seen.size, `${track.id} ${section}`).toBeGreaterThanOrEqual(4)
      }
    }
  })
})
