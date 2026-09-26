/**
 * What flies in a room's sky band is a sprite, and a sprite is drawn over the
 * whole frame (`life.ts`). Two ways that goes wrong, and neon's blimp did both
 * at once, reading as a piece of an unfinished building hung in the air:
 *
 * - it flew out past the spires, so every tower nearer than it that stood up
 *   into the sky was drawn *under* it;
 * - it flew at a height in tiles, and on a wide frame the band of sky is a
 *   sliver: the top edge cut it in half.
 *
 * `docs/notes/visual.md`, "Keep a route clear of the near props" is the same
 * rule for the lamp posts (`sceneLifeOcclusion.test.ts`).
 */
import { describe, expect, test, vi } from 'vitest'
import { Box3, Vector3 } from 'three'
import { feltInViewport } from '../components/cards/layout'
import { MAP_IDS } from '../components/cards/maps'
import { Kit } from '../components/scene/kit'
import type { Actor } from '../components/scene/life'
import { LOOK } from '../components/scene/look'
import { BUILDERS } from '../components/scene/maps'
import { seededRng } from '../components/scene/rng'
import { lightRig } from '../components/scene/sky'
import { solveView, type View } from '../components/scene/view'

type V3 = [number, number, number]
/** A block's axis-aligned bounds, world. */
type Block = [V3, V3]

function build(id: (typeof MAP_IDS)[number], view: View) {
  const blocks: Block[] = []
  const box = vi.spyOn(Kit.prototype, 'box')
  const cyl = vi.spyOn(Kit.prototype, 'cyl')
  try {
    const actors = BUILDERS[id](new Kit({ rig: lightRig('dusk', 'clear', id), rng: seededRng(`sky-${id}`), outline: 0.02, view })) ?? []
    for (const [x, y, z, w, h, d, , o] of box.mock.calls) {
      if (o?.tilt || o?.rot) continue
      blocks.push([[x - w / 2, y, z - d / 2], [x + w / 2, y + h, z + d / 2]])
    }
    for (const [x, y, z, r, h, , o] of cyl.mock.calls) {
      if (o?.axis) continue
      blocks.push([[x - r, y, z - r], [x + r, y + h, z + r]])
    }
    return { blocks, actors }
  } finally {
    box.mockRestore()
    cyl.mockRestore()
  }
}

/** The actor's own bounds, tiles, off what it builds at the origin. */
function bounds(actor: Actor): Box3 {
  const k = new Kit({ rig: lightRig('day', 'clear'), rng: seededRng(actor.id), outline: 0.02, shadows: false })
  actor.build(k)
  const box = new Box3()
  for (const g of (k as unknown as { buckets: Record<string, { computeBoundingBox(): void; boundingBox: Box3 }[]> }).buckets.lit) {
    g.computeBoundingBox()
    box.union(g.boundingBox)
  }
  if (box.isEmpty()) box.setFromCenterAndSize(new Vector3(), new Vector3(1, 1, 1))
  const reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2
  box.min.x = box.min.z = -reach
  box.max.x = box.max.z = reach
  return box
}

/** A world box on the frame: its rectangle and its farthest depth. */
function onFrame(view: View, [lo, hi]: Block) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, far = -Infinity
  for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
    const p = view.project([x, y, z])
    if (!p) return null
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); far = Math.max(far, p[2])
  }
  return { x0, x1, y0, y1, far }
}

/** A route this slow is furniture of the sky, not something flying past. */
const HANGS_MS = 120_000

function samples(route: V3[]): V3[] {
  const out: V3[] = []
  for (let i = 0; i + 1 < route.length; i++) for (let s = 0; s < 12; s++) out.push(route[i].map((a, j) => a + (route[i + 1][j] - a) * (s / 12)) as V3)
  out.push(route[route.length - 1])
  return out
}

describe('what flies in the sky band', () => {
  for (const [w, h] of [[1996, 1000], [1600, 900], [2560, 1080], [1280, 720]] as const) {
    test(`stays inside the band and in front of every tower there, ${w}×${h}`, () => {
      const view = solveView(w, h, feltInViewport(w, h, 3), LOOK.vista.camera)
      const faults: string[] = []
      for (const id of MAP_IDS) {
        const { blocks, actors } = build(id, view)
        const tall = blocks.map((b) => onFrame(view, b)).filter((r): r is NonNullable<typeof r> => !!r && r.y0 < view.horizonY)
        for (const a of actors) {
          // What hangs in the sky long enough to be read as part of it: a gull
          // or a bat crossing the top edge in a few seconds is flying past.
          if (!a.world || !a.flying || a.duration < HANGS_MS) continue
          const b = bounds(a)
          const route = samples(a.world as V3[])
          const rects = route.map((p) => onFrame(view, [[p[0] + b.min.x, p[1] + b.min.y, p[2] + b.min.z], [p[0] + b.max.x, p[1] + b.max.y, p[2] + b.max.z]]))
          // Only what flies wholly above the horizon: a gull over the water is
          // the lamp posts' test.
          if (rects.some((r) => !r || r.y1 > view.horizonY)) continue
          for (const [i, r] of (rects as NonNullable<(typeof rects)[number]>[]).entries()) {
            if (r.x1 < 0 || r.x0 > w) continue
            if (r.y0 < 0) faults.push(`${id}: ${a.id} cut by the top edge`)
            // A tower wholly nearer than the sprite, under it on the frame.
            const depth = view.project(route[i])![2]
            for (const t of tall) {
              if (t.far >= depth) continue
              if (t.x1 <= r.x0 + 1 || t.x0 >= r.x1 - 1 || t.y1 <= r.y0 + 1 || t.y0 >= r.y1 - 1) continue
              faults.push(`${id}: ${a.id} drawn over a tower nearer than itself`)
              break
            }
          }
        }
      }
      expect([...new Set(faults)]).toEqual([])
    })
  }
})
