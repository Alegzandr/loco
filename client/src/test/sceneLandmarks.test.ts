/**
 * A landmark is in the frame, whole, and large enough to be one.
 *
 * Three rooms had a landmark written into their builder that no frame showed:
 * sakura's mountain was 360 pixels tall over 140 pixels of sky (its foot
 * filled the frame and the air turned the rest into sky), its pagoda stood
 * behind the near cherry, and marina's lighthouse was five pixels wide behind
 * the jetty's lamps. And a skyline's crowns must not move the room: a draw
 * taken from the room's own sequence inside `skyline` would shift every palm
 * and lamp planted after it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { Kit } from '../components/scene/kit'
import { BUILDERS } from '../components/scene/maps'
import { skyline } from '../components/scene/maps/vista'
import type { MapId } from '../components/cards/maps'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import type { Baked } from '../components/scene/models/bake'

const fake: Baked = { position: new Float32Array(9), normal: new Float32Array(9), color: new Float32Array(9), glow: new Uint8Array(3), index: Uint32Array.from([0, 1, 2]), smooth: new Float32Array(9), w: 0.01, h: 0.01, d: 0.01 }
const FRAMES = [[1920, 1080], [1280, 720], [1600, 900]] as const

function kitFor(id: MapId, w: number, h: number, seed = `landmarks-${id}`) {
  const view = solveView(w, h, feltInViewport(w, h, 3), LOOK.vista.camera)
  return new Kit({ rig: lightRig('dusk', 'clear', id), rng: seededRng(seed), outline: 0.02, view, models: { has: () => true, get: () => fake } })
}

afterEach(() => vi.restoreAllMocks())

describe('a landmark', () => {
  it("sakura's mountain stands whole in the band of sky", () => {
    for (const [w, h] of FRAMES) {
      const cone = vi.spyOn(Kit.prototype, 'cone')
      const k = kitFor('sakura', w, h)
      BUILDERS.sakura(k)
      // The mountain is the one cone a kilometre across; its snow is the next.
      const [x, y, z, , tall] = cone.mock.calls.filter(([, , , r]) => r > 1000)[0]
      const snow = cone.mock.calls.filter(([, , , r]) => r > 400 && r <= 1000)[0]
      const peak = k.view!.project([x, y + tall, z])!
      const cap = k.view!.project([snow[0], snow[1] + snow[4], snow[2]])!
      expect(peak[1], `${w}x${h}`).toBeGreaterThan(0)
      expect(peak[1], `${w}x${h}`).toBeLessThan(k.view!.horizonY)
      expect(peak[0], `${w}x${h}`).toBeGreaterThan(0)
      expect(peak[0], `${w}x${h}`).toBeLessThan(w)
      expect(cap[1], `${w}x${h}`).toBeGreaterThan(0)
      cone.mockRestore()
    }
  }, 120_000)

  it("marina's lighthouse is a tower, not a post: wide enough to read and wholly in the frame", () => {
    for (const [w, h] of FRAMES) {
      const cyl = vi.spyOn(Kit.prototype, 'cyl')
      const k = kitFor('marina', w, h)
      BUILDERS.marina(k)
      // Its shaft: the one white cylinder 24 tiles tall.
      const [x, y, z, r, tall] = cyl.mock.calls.filter(([, , , r, hh]) => hh === 24 && r > 4)[0]
      const foot = k.view!.project([x, y, z])!
      const head = k.view!.project([x, y + tall + 8, z])!
      const px = (2 * r) / k.view!.tileAt(foot[2])
      // Twelve pixels at 720p is the least a shaft is read at; it was five at 1080p.
      expect(px, `${w}x${h}`).toBeGreaterThan(12)
      expect(head[1], `${w}x${h}`).toBeGreaterThan(0)
      expect(foot[0], `${w}x${h}`).toBeGreaterThan(0)
      expect(foot[0], `${w}x${h}`).toBeLessThan(w)
      cyl.mockRestore()
    }
  }, 120_000)
})

describe("a skyline's crowns", () => {
  it('are drawn from each tower’s own place, and take nothing from the room’s sequence', () => {
    const after = (crowns: boolean) => {
      const k = kitFor('velvet', 1600, 900, 'crowns')
      skyline(k, { x0: -400, x1: 400, z0: -200, z1: -380, h: [20, 60], w: [18, 30], count: 30, colors: [0xe9dcc2], crowns })
      return k.rng.next()
    }
    expect(after(true)).toBe(after(false))
  })

  it('stand on some towers and not on all of them', () => {
    const boxes = (crowns: boolean) => {
      const box = vi.spyOn(Kit.prototype, 'box')
      const k = kitFor('velvet', 1600, 900, 'crowns')
      skyline(k, { x0: -400, x1: 400, z0: -200, z1: -380, h: [20, 60], w: [18, 30], count: 30, colors: [0xe9dcc2], crowns })
      const n = box.mock.calls.length
      box.mockRestore()
      return n
    }
    const extra = boxes(true) - boxes(false)
    expect(extra).toBeGreaterThan(0)
    // Fewer than two apiece: a setback on most, a second on some.
    expect(extra).toBeLessThan(30 * 2)
  })
})
