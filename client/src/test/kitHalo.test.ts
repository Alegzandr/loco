/**
 * The kit's round halo is a lamp head's, never a building's.
 *
 * An additive sphere six tiles across round the lighthouse, three round its
 * lamp, a tile and a half round a hotel's finial: each laid a pale veil over
 * the tower and whatever stood under it, and what a player read was a
 * building they could see through. The kit clamps the radius of a round halo
 * to `HALO_SPHERE_MAX` so that no builder can draw one again.
 */
import { describe, it, expect } from 'vitest'
import { Box3, Mesh } from 'three'
import { Kit, HALO_SPHERE_MAX } from '../components/scene/kit'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'

function kit() {
  return new Kit({ rig: lightRig('night', 'clear'), rng: seededRng('halo'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 10, b: 5 } })
}

/** The bounding box of everything in the halo bucket of a built kit. */
function haloBox(k: Kit): Box3 {
  const group = k.build()
  const box = new Box3()
  group.traverse((obj) => {
    const mesh = obj as Mesh
    const m = mesh.material as { transparent?: boolean } | undefined
    if (!mesh.isMesh || !m?.transparent) return
    mesh.geometry.computeBoundingBox()
    box.union(mesh.geometry.boundingBox!)
  })
  return box
}

describe('a round halo', () => {
  it('is never wider than a lamp head, whatever radius the builder asked for', () => {
    const k = kit()
    k.halo(0, 5, 0, 6, 0xfff0b0, 0.4, false)
    const box = haloBox(k)
    expect(box.isEmpty()).toBe(false)
    expect(box.max.x - box.min.x).toBeLessThanOrEqual(HALO_SPHERE_MAX * 2 + 1e-6)
    expect(box.max.y - box.min.y).toBeLessThanOrEqual(HALO_SPHERE_MAX * 2 + 1e-6)
  })

  it('leaves a pool of light on the ground its full size', () => {
    // The flat halo is what a lamp lays on the paving; it hides nothing.
    const k = kit()
    k.halo(0, 0, 0, 6, 0xfff0b0, 0.2, true)
    const box = haloBox(k)
    expect(box.max.x - box.min.x).toBeCloseTo(12, 5)
  })

  it('is a lamp head, not a landmark', () => {
    expect(HALO_SPHERE_MAX).toBeLessThanOrEqual(1)
  })
})
