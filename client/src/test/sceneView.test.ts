import { describe, expect, test } from 'vitest'
import { feltInViewport } from '../components/cards/layout'
import { solveView, cameraSpec, type VistaParams } from '../components/scene/view'

const PARAMS: VistaParams = { horizon: 0.13, horizonMin: 0.05, aspect: 1.5, aspectMax: 2.4, fov: [58, 84], tilt: 0.3, tableHalfWidth: 2.2, tableTop: 0.9 }
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 }
const VIEWPORTS: [number, number][] = [
  [1600, 900],
  [1920, 1080],
  [1280, 800],
  [390, 844],
  [844, 390],
  [768, 1024],
  [2560, 1080],
]

describe('the view from the table', () => {
  for (const [w, h] of VIEWPORTS) {
    const felt = feltInViewport(w, h, 3, NO_INSETS)
    const v = solveView(w, h, felt, PARAMS)

    test(`${w}×${h}: the table top projects back onto the felt`, () => {
      // Every point of the outline, cast on the plane and projected again,
      // lands on the felt's ellipse.
      const outline = v.tableOutline(48)
      expect(outline.length).toBe(48)
      for (const p of outline) {
        const s = v.project(p)
        expect(s).not.toBeNull()
        const [x, y] = s!
        const e = ((x - felt.cx) / felt.rx) ** 2 + ((y - felt.cy) / felt.ry) ** 2
        expect(e).toBeCloseTo(1, 4)
      }
    })

    test(`${w}×${h}: the table is centred on the origin, its width as asked`, () => {
      const xs = v.tableOutline(96).map((p) => p[0])
      const zs = v.tableOutline(96).map((p) => p[2])
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 3)
      expect((Math.max(...zs) + Math.min(...zs)) / 2).toBeCloseTo(0, 3)
      expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeCloseTo(PARAMS.tableHalfWidth, 1)
    })

    test(`${w}×${h}: the horizon is above the felt, the lens honest`, () => {
      expect(v.horizonY).toBeLessThan(felt.cy - felt.ry)
      const fov = (2 * Math.atan(w / 2 / v.f) * 180) / Math.PI
      expect(fov).toBeGreaterThanOrEqual(PARAMS.fov[0] - 0.01)
      expect(fov).toBeLessThanOrEqual(PARAMS.fov[1] + 0.01)
      const spec = cameraSpec(v)
      expect(spec.fov).toBeGreaterThan(0)
      expect(spec.fov).toBeLessThan(170)
    })
  }

  test('where the range allows it, both the horizon and the shape are met', () => {
    const felt = feltInViewport(1600, 900, 3, NO_INSETS)
    const v = solveView(1600, 900, felt, PARAMS)
    expect(v.horizonY / 900).toBeCloseTo(PARAMS.horizon, 2)
    const xs = v.tableOutline(96).map((p) => p[0])
    const zs = v.tableOutline(96).map((p) => p[2])
    expect((Math.max(...zs) - Math.min(...zs)) / (Math.max(...xs) - Math.min(...xs))).toBeCloseTo(PARAMS.aspect, 2)
  })
})

test('a phone on its side keeps a strip of sky by deepening the table', () => {
  const felt = feltInViewport(844, 390, 3, NO_INSETS)
  const v = solveView(844, 390, felt, PARAMS)
  expect(v.horizonY / 390).toBeGreaterThanOrEqual(PARAMS.horizonMin - 0.005)
})
