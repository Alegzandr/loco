import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { feltInViewport } from '../components/cards/layout'
import { MAP_IDS } from '../components/cards/maps'
import { LOOK } from '../components/scene/look'
import { TIMES, lightRig } from '../components/scene/sky'
import { solveView } from '../components/scene/view'
import { routeKeyframes, type Actor } from '../components/scene/life'
import { BUILDERS } from '../components/scene/maps'

const src = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 }

/** Where a direction in the sky lands in a frame, pixels, `y` down. */
function skyPoint(azimuth: number, elevation: number, w: number, h: number) {
  const felt = feltInViewport(w, h, 3, NO_INSETS)
  const v = solveView(w, h, felt, LOOK.vista.camera)
  const az = (azimuth * Math.PI) / 180
  const el = (elevation * Math.PI) / 180
  const far = 1e5
  const p = v.project([v.eye[0] + Math.sin(az) * Math.cos(el) * far, v.eye[1] + Math.sin(el) * far, v.eye[2] + Math.cos(az) * Math.cos(el) * far])
  return { p, v }
}

describe('the rooms seen from the table', () => {
  test('every room has a builder, and a light of its own', () => {
    for (const id of MAP_IDS) {
      expect(BUILDERS[id], id).toBeTypeOf('function')
      expect(LOOK.rooms[id], id).toBeDefined()
    }
  })

  test('the body in the sky is in the frame, between its top edge and the horizon, at 16:9', () => {
    // A light the viewer sees is the point of the view: a sun or a moon put
    // above the frame's top edge left only its road on the water.
    for (const id of MAP_IDS) {
      for (const t of TIMES) {
        const rig = lightRig(t, 'clear', id)
        if (!rig.body) continue
        const { p, v } = skyPoint(rig.body.azimuth, rig.body.elevation, 1600, 900)
        expect(p, `${id} ${t}`).not.toBeNull()
        const [x, y] = p!
        expect(x, `${id} ${t} x`).toBeGreaterThan(0)
        expect(x, `${id} ${t} x`).toBeLessThan(1600)
        expect(y, `${id} ${t} y`).toBeGreaterThan(0)
        expect(y, `${id} ${t} y`).toBeLessThan(v.horizonY)
      }
    }
  })

  test('the weather takes the body down: none in rain, a veil in cloud', () => {
    expect(lightRig('dawn', 'rain', 'marina').body).toBeNull()
    expect(lightRig('dawn', 'cloudy', 'marina').body!.visibility).toBeLessThan(1)
    expect(lightRig('dawn', 'clear', 'marina').body!.visibility).toBe(1)
  })

  test('a room in space has a black sky, a planet, stars at every hour, no cloud and no moon over the moon', () => {
    for (const t of TIMES) {
      const rig = lightRig(t, 'clear', 'orbit')
      expect(rig.space).not.toBeNull()
      expect(rig.stars).toBe(1)
      expect(rig.cloud).toBe(0)
      const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)
      expect(lum(rig.sky.top)).toBeLessThan(12)
    }
    expect(lightRig('night', 'clear', 'orbit').body).toBeNull()
    expect(lightRig('night', 'clear', 'orbit').haze).toBeLessThan(0.2)
  })

  test('a route projected from the world carries its scale into the keyframes', () => {
    const actor: Actor = { id: 'a', build: () => {}, path: [[0, 0], [10, 0]], world: [[0, 0, -10], [0, 0, -20]], scales: [1, 0.5], duration: 1000, motion: 'bounce' }
    const frames = routeKeyframes(actor, 800, 450, 10)
    expect(frames[0].transform).not.toMatch(/scale\(/)
    expect(frames[1].transform).toMatch(/scale\(0\.5000\)/)
  })

  test('the finishing passes reconstruct a position through the projection, under either camera', () => {
    const post = src('components/scene/post.ts')
    expect(post).toMatch(/uProjInv/)
    expect(post).not.toMatch(/uniform vec4 uFrame/)
  })

  test('the room is shadowed with PCF, not the half-float VSM, at a bias sized for a metre a tile', () => {
    const lighting = src('components/scene/lighting.ts')
    expect(lighting).toMatch(/renderer\.shadowMap\.type = PCFShadowMap/)
    expect(lighting).not.toMatch(/VSMShadowMap/)
    expect(LOOK.shadow.normalBias).toBeLessThan(0.1)
  })
})
