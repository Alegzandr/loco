/**
 * What turns a loaded model into a thing the kit can place, on buffers alone.
 */
import { describe, it, expect } from 'vitest'
import { bounds, hullFor, matchesKey, smoothNormals, splitGlow, type Baked } from '../components/scene/models/bake'

/** A unit cube as unshared triangles, the way a flat-shaded model arrives. */
function cube(): { position: Float32Array; index: Uint32Array } {
  const faces: [number[], number[]][] = [
    [[0, 0, 1], [1, 0, 0]], // +z: origin, u
    [[0, 0, -1], [-1, 0, 0]],
    [[1, 0, 0], [0, 0, -1]],
    [[-1, 0, 0], [0, 0, 1]],
    [[0, 1, 0], [1, 0, 0]],
    [[0, -1, 0], [-1, 0, 0]],
  ]
  const pos: number[] = []
  const idx: number[] = []
  for (const [n, u] of faces) {
    const v = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
    const c = n.map((x) => x * 0.5)
    const corner = (a: number, b: number) => [c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b, c[2] + u[2] * a + v[2] * b]
    const base = pos.length / 3
    for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) pos.push(...corner(a, b))
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return { position: Float32Array.from(pos), index: Uint32Array.from(idx) }
}

describe('smoothNormals', () => {
  it('points a cube corner along its diagonal, whichever face the vertex belongs to', () => {
    const { position, index } = cube()
    const smooth = smoothNormals(position, index)
    for (let i = 0; i < position.length; i += 3) {
      const [x, y, z] = [position[i], position[i + 1], position[i + 2]]
      const len = Math.hypot(smooth[i], smooth[i + 1], smooth[i + 2])
      expect(len).toBeCloseTo(1, 5)
      expect(Math.sign(smooth[i])).toBe(Math.sign(x))
      expect(Math.sign(smooth[i + 1])).toBe(Math.sign(y))
      expect(Math.sign(smooth[i + 2])).toBe(Math.sign(z))
    }
  })

  it('so the hull is a bigger cube with its corners closed', () => {
    const { position, index } = cube()
    const b: Baked = { position, normal: position, color: new Float32Array(), glow: new Uint8Array(24), index, smooth: smoothNormals(position, index), w: 1, h: 1, d: 1 }
    const hull = hullFor(b, 0.1)
    const { min, max } = bounds(hull)
    // Every corner moved out along the diagonal by 0.1: the cube grew by 0.1/√3 per axis.
    expect(max[0] - min[0]).toBeCloseTo(1 + (2 * 0.1) / Math.sqrt(3), 5)
    // And the two vertices at one corner (from two faces) agree on where the corner went.
    const seen = new Map<string, string>()
    for (let i = 0; i < position.length; i += 3) {
      const key = `${position[i]},${position[i + 1]},${position[i + 2]}`
      const to = `${hull[i].toFixed(6)},${hull[i + 1].toFixed(6)},${hull[i + 2].toFixed(6)}`
      const prev = seen.get(key)
      if (prev) expect(prev).toBe(to)
      seen.set(key, to)
    }
  })
})

describe('glow', () => {
  it('matches a palette colour within a tolerance and nothing far from it', () => {
    expect(matchesKey(170 / 255, 215 / 255, 255 / 255, [0xaad7ff])).toBe(true)
    expect(matchesKey(160 / 255, 210 / 255, 250 / 255, [0xaad7ff])).toBe(true)
    expect(matchesKey(0.9, 0.2, 0.2, [0xaad7ff])).toBe(false)
  })

  it('splits faces by their first vertex and keeps every triangle', () => {
    const { position, index } = cube()
    const glow = new Uint8Array(24)
    for (let i = 0; i < 4; i++) glow[i] = 1 // the first face glows
    const b: Baked = { position, normal: position, color: new Float32Array(), glow, index, smooth: position, w: 1, h: 1, d: 1 }
    const s = splitGlow(b)
    expect(s.glow.length).toBe(6)
    expect(s.lit.length).toBe(index.length - 6)
  })
})
