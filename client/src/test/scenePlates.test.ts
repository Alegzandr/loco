/**
 * A painted room is laid by its lens, never by its edges.
 *
 * A plate (`scene/plates.ts`) is one painting made through one lens, shown in
 * frames that each solve their own (`view.ts`). What these pin: the plate's
 * numbers are the camera's own for the frame it was shot at (a plate whose
 * horizon is a guess slides its floor under the table), its horizon lands on
 * the frame's at every size, no frame the game solves asks for a column the
 * painting does not have, the file is the size its entry says, and a painted
 * room is shown at its painting's hour whatever hour is dealt.
 */
import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import sharp from 'sharp'
import { PLATES, plateHour, plateUv } from '../components/scene/plates'
import { solveView } from '../components/scene/view'
import { feltInViewport } from '../components/cards/layout'
import { LOOK } from '../components/scene/look'
import { MAPS, resolveScene, type MapId } from '../components/cards/maps'
import { TIMES } from '../components/scene/sky'

const IDS = Object.keys(PLATES) as MapId[]
const FRAMES = [[1920, 1080], [1280, 720], [1440, 900], [2560, 1080], [1024, 768], [390, 844], [360, 640], [844, 340]] as const
const lensFor = (w: number, h: number) => solveView(w, h, feltInViewport(w, h, 3), LOOK.vista.camera)

describe('a plate', () => {
  it('exists for at least one room, and only for rooms the game has', () => {
    expect(IDS.length).toBeGreaterThan(0)
    for (const id of IDS) expect(MAPS[id], id).toBeDefined()
  })

  it('carries the lens the camera solves for the frame it was painted at', () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      const v = lensFor(p.w, p.h)
      expect(Math.abs(v.f - p.f), `${id} focal`).toBeLessThan(1)
      expect(Math.abs(v.horizonY - p.horizon), `${id} horizon`).toBeLessThan(1)
      expect(Math.abs(v.px - p.cx), `${id} column`).toBeLessThan(1)
    }
  })

  it('is the file its entry describes', async () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      const meta = await sharp(join(process.cwd(), 'src', 'assets', 'plates', `${id}.webp`)).metadata()
      expect([meta.width, meta.height], id).toEqual([p.w, p.h])
    }
  })

  it('lays its horizon on the frame’s, and its vanishing column on the lens axis, at every size', () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      for (const [w, h] of FRAMES) {
        const v = lensFor(w, h)
        const [u, t] = plateUv(p, v, v.px, v.horizonY)
        expect(u, `${id} ${w}x${h}`).toBeCloseTo(p.cx / p.w, 6)
        expect(t, `${id} ${w}x${h}`).toBeCloseTo(p.horizon / p.h, 6)
      }
    }
  })

  it('is scaled by the ratio of the two focal lengths', () => {
    const p = PLATES[IDS[0]]!
    const lens = { f: p.f * 2, px: 500, horizonY: 100 }
    const [u0] = plateUv(p, lens, 500, 100)
    const [u1, v1] = plateUv(p, lens, 700, 300)
    // 200 frame pixels through a lens twice as long are 100 of the plate's.
    expect((u1 - u0) * p.w).toBeCloseTo(100, 6)
    expect(v1 * p.h - p.horizon).toBeCloseTo(100, 6)
  })

  it('is wide enough for every frame the game solves', () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      for (const [w, h] of FRAMES) {
        const v = lensFor(w, h)
        const [left] = plateUv(p, v, 0, v.horizonY)
        const [right] = plateUv(p, v, w, v.horizonY)
        // Past a side the painting is mirrored. A hundredth of it goes unseen;
        // a phone on its side, whose lens is off the frame's middle, may ask
        // for a twentieth, behind its stack of buttons. More is a second room.
        const slack = v.px === w / 2 ? 0.01 : 0.05
        expect(left, `${id} ${w}x${h}`).toBeGreaterThan(-slack)
        expect(right, `${id} ${w}x${h}`).toBeLessThan(1 + slack)
      }
    }
  })

  it('reaches under the table at a monitor’s frame, where nothing hides its foot', () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      for (const [w, h] of [[1920, 1080], [1280, 720], [2560, 1080]] as const) {
        const v = lensFor(w, h)
        const felt = feltInViewport(w, h, 3)
        const [, foot] = plateUv(p, v, v.px, felt.cy + felt.ry)
        expect(foot, `${id} ${w}x${h}`).toBeLessThan(1)
      }
    }
  })
})

describe('a painted room’s hour', () => {
  it('is its painting’s, whatever hour is dealt, and the weather is still the one dealt', () => {
    for (const id of IDS) {
      const p = PLATES[id]!
      expect(TIMES).toContain(p.time)
      for (const t of TIMES) {
        expect(plateHour(id, t), `${id} ${t}`).toBe(p.time)
        expect(resolveScene(id, t, 'fog')?.time, `${id} ${t}`).toBe(p.time)
      }
      const w = MAPS[id].weathers.find((x) => x !== 'clear')!
      expect(resolveScene(id, 'night', w)?.weather, id).toBe(w)
    }
  })

  it('leaves a room built in blocks the hour it was dealt', () => {
    const blocks = (Object.keys(MAPS) as MapId[]).filter((id) => !PLATES[id])
    for (const id of blocks) for (const t of TIMES) expect(resolveScene(id, t, 'clear')?.time, `${id} ${t}`).toBe(t)
  })
})
