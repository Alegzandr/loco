/**
 * A sprite is drawn over the whole frame (`life.ts`), so a route that passes
 * behind a lamp post is drawn in front of it: the boat sailing through the
 * jetty's lamps on the marina. `docs/notes/visual.md`, "Keep a route clear of
 * the near props" — this is the test that fails without it, for the one prop
 * the rooms plant everywhere and that stands up into the sky and the water.
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
interface Post { x: number; z: number; h: number }

/** Every lamp post a room plants, and what moves in it. */
function build(id: (typeof MAP_IDS)[number], view: View) {
  const posts: Post[] = []
  const spy = vi.spyOn(Kit.prototype, 'lamp').mockImplementation(function (this: Kit, x: number, z: number, o: { h?: number } = {}) {
    posts.push({ x, z, h: o.h ?? 2.6 })
  })
  try {
    const actors = BUILDERS[id](new Kit({ rig: lightRig('night', 'clear', id), rng: seededRng(`occlusion-${id}`), outline: 0.02, view })) ?? []
    return { posts, actors }
  } finally {
    spy.mockRestore()
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
  // It turns along its route: its reach across the frame is its longest side.
  const reach = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2
  box.min.x = box.min.z = -reach
  box.max.x = box.max.z = reach
  return box
}

function samples(route: V3[]): V3[] {
  const out: V3[] = []
  for (let i = 0; i + 1 < route.length; i++) {
    for (let s = 0; s < 24; s++) {
      const t = s / 24
      out.push(route[i].map((a, j) => a + (route[i + 1][j] - a) * t) as V3)
    }
  }
  out.push(route[route.length - 1])
  return out
}

const dist = (v: View, p: V3) => Math.hypot(p[0] - v.eye[0], p[2] - v.eye[2])

describe('what moves in a room', () => {
  for (const [w, h] of [[1600, 900], [1280, 720], [844, 390], [390, 844]] as const) {
    test(`never crosses a lamp post nearer than itself, ${w}×${h}`, () => {
      const view = solveView(w, h, feltInViewport(w, h, 3), LOOK.vista.camera)
      const crossings: string[] = []
      for (const id of MAP_IDS) {
        const { posts, actors } = build(id, view)
        for (const a of actors) {
          if (!a.world) continue
          const b = bounds(a)
          for (const p of samples(a.world as V3[])) {
            const lo = view.project([p[0] + b.min.x, p[1] + b.min.y, p[2]])
            const hi = view.project([p[0] + b.max.x, p[1] + b.max.y, p[2]])
            if (!lo || !hi) continue
            const [x0, x1] = [Math.min(lo[0], hi[0]), Math.max(lo[0], hi[0])]
            const [y0, y1] = [Math.min(lo[1], hi[1]), Math.max(lo[1], hi[1])]
            if (x1 < 0 || x0 > w || y1 < 0 || y0 > h) continue
            for (const q of posts) {
              if (dist(view, [q.x, 0, q.z]) >= dist(view, p)) continue
              const foot = view.project([q.x, 0, q.z])
              const top = view.project([q.x, q.h + 0.5, q.z])
              const side = view.project([q.x + 0.25, 0, q.z])
              if (!foot || !top || !side) continue
              const half = Math.abs(side[0] - foot[0])
              if (x1 < foot[0] - half || x0 > foot[0] + half) continue
              if (y1 < top[1] || y0 > foot[1]) continue
              crossings.push(`${id}: ${a.id} at [${p.map((n) => n.toFixed(0))}] behind the lamp at [${q.x}, ${q.z}]`)
              break
            }
          }
        }
      }
      expect([...new Set(crossings.map((s) => s.replace(/ at \[.*?\] behind/, ' behind')))]).toEqual([])
    })
  }
})
