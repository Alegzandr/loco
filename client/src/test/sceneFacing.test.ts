/**
 * Everything that moves on the ground goes the way it faces.
 *
 * A sprite with `turn` is drawn side-on, heading screen-right, and mirrored on
 * a leg that heads left. That is only true of a leg that runs level across the
 * frame: the rover and the cat were sent up a diagonal and slid along it
 * crabwise, facing thirty degrees off the way they went. What follows a street
 * is built facing its heading instead, and never mirrored.
 */
import { describe, it, expect } from 'vitest'
import { Kit } from '../components/scene/kit'
import { BUILDERS } from '../components/scene/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { DEFAULT_BODY, trimRoute, type Actor, type ScreenPt } from '../components/scene/life'
import { at } from '../components/scene/maps/common'

/** How far off level a mirrored sprite's leg may run on the ground, in radians. */
const MAX_OFF = (30 * Math.PI) / 180
const PITCH_SIN = Math.sin((32 * Math.PI) / 180)
const MAPS = ['neon', 'rune', 'velvet', 'orbit', 'sakura', 'marina'] as const

function actorsOf(id: (typeof MAPS)[number]): Actor[] {
  const k = new Kit({ rig: lightRig('day', 'clear'), rng: seededRng(`facing-${id}`), outline: 0.02, anchor: { sx: 0, sy: -2, a: 27, b: 10 }, frame: { w: 96, h: 54 } })
  return BUILDERS[id](k) ?? []
}

describe('a mirrored sprite on the ground', () => {
  it('only ever runs (near enough) level across the frame', () => {
    let seen = 0
    for (const id of MAPS) {
      for (const a of actorsOf(id)) {
        if (a.flying || !a.turn || a.path.length < 2) continue
        seen++
        for (let i = 1; i < a.path.length; i++) {
          // Measured on the ground, where a screen tile up is 1/sin(pitch) tiles:
          // the ferry following the shore stays inside it; the old rover, at 47°, did not.
          const dx = Math.abs(a.path[i][0] - a.path[i - 1][0])
          const dy = Math.abs(a.path[i][1] - a.path[i - 1][1]) / PITCH_SIN
          expect(Math.atan2(dy, dx), `${id}/${a.id}`).toBeLessThan(MAX_OFF)
        }
      }
    }
    // The rover and the cat, at least: a count of zero would pass forever.
    expect(seen).toBeGreaterThanOrEqual(2)
  }, 60_000)
})

describe('a lone actor on the ground', () => {
  it('has somewhere to stand in a 16:9 frame, or it is a route nobody will ever see', () => {
    // Sakura's cat was handed three routes across ground a block of the grid
    // had claimed, and the render dropped it every time: it was never seen.
    // The anchor and frame are a 1920×1080 board's.
    const anchor = { sx: 0, sy: 0.11, a: 27.34, b: 11.15 }
    const frame = { w: 80, h: 45 }
    let lone = 0
    for (const id of MAPS) {
      const k = new Kit({ rig: lightRig('day', 'clear'), rng: seededRng(`lone-${id}`), outline: 0.02, anchor, frame })
      const actors = BUILDERS[id](k) ?? []
      const standable = (pt: ScreenPt, actor: Actor) => {
        if (Math.abs(pt[0]) > frame.w / 2 + 3 || Math.abs(pt[1]) > frame.h / 2 + 3) return false
        const body = actor.body ?? DEFAULT_BODY
        const foot = body.foot ?? body.w
        const [x, z] = at(pt[0], pt[1])
        return k.free(x, z, foot, foot, 0, 0)
      }
      for (const a of actors) {
        if (a.flying || a.pick || a.path.length < 2) continue
        lone++
        expect(trimRoute(a, standable), `${id}/${a.id}`).not.toBeNull()
      }
    }
    expect(lone).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
