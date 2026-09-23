/**
 * A tall landmark stands beside the table, never above it.
 *
 * The band above the table is a few tiles deep before the frame's top edge,
 * so anything tall there is a stump with its top cut off: the rune tower was
 * a grey base for months, and sakura's pagoda ran its roofs off the top of
 * every frame until it moved to the left band. Builders declare their
 * landmarks (`k.landmark`) and this reads them back.
 */
import { describe, it, expect } from 'vitest'
import { Kit, LANDMARK_TOP_MAX } from '../components/scene/kit'
import { BUILDERS } from '../components/scene/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'

const MAPS = ['neon', 'rune', 'velvet', 'orbit', 'sakura', 'marina'] as const
const ANCHOR = { sx: 0, sy: -2, a: 27, b: 10 }

describe('a landmark', () => {
  it('over seven tiles tall stands in a side band, clear of the table across the frame', () => {
    const tall: string[] = []
    for (const id of MAPS) {
      const k = new Kit({ rig: lightRig('day', 'clear'), rng: seededRng(`landmark-${id}`), outline: 0.02, anchor: ANCHOR, frame: { w: 96, h: 54 } })
      BUILDERS[id](k)
      for (const l of k.landmarks) {
        if (l.h <= LANDMARK_TOP_MAX) continue
        tall.push(`${id}/${l.name}`)
        expect(Math.abs(l.sx - ANCHOR.sx), `${id}/${l.name}`).toBeGreaterThan(ANCHOR.a)
      }
    }
    // Five rooms have one; a count of zero would pass forever.
    expect(tall.length).toBeGreaterThanOrEqual(5)
  }, 60_000)
})
