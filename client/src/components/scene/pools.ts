/**
 * The light a lamp lays on the ground, as light.
 *
 * A lamp used to leave an additive disc on the paving: the same pale oval
 * under every head, laid over whatever was there, flat to its edge. What a
 * street lamp does is light the ground — the colour of the flagstones comes up
 * warm under it and falls off with the distance, the kerb and the foot of the
 * wall beside it catch some too, and the light is the *ground's* colour lit,
 * never a coat of the lamp's colour painted on top. Hundreds of point lights
 * would do that and cost a forward renderer its life, so the room does it
 * once, on the CPU, into a texture: every pool (`Kit.halo` on the ground, a
 * lit window's spill on the pavement in front of it) is splatted into a map
 * of the ground seen from above, and the lit material reads it at the
 * fragment's world `x, z` and multiplies it into its own diffuse colour
 * (`POOLS_OUT`), fading with the height above the ground so a roof is not lit
 * by the lamp under it.
 *
 * Framework-free arithmetic (`splatPools`) so a test can read the map; the
 * texture and the GLSL are the kit's (`kit.ts: litMaterial`). Every number is
 * `LOOK.pools`'.
 */
import { Color, DataTexture, LinearFilter, RGBAFormat, UnsignedByteType, Vector4, type Texture } from 'three'
import type { Hex } from './sky'
import { LOOK } from './look'

export interface Pool {
  x: number
  z: number
  /** The radius the light reaches, tiles. */
  r: number
  color: Hex
  /** How strong it is at its centre, before `LOOK.pools.strength`. */
  k: number
}

/** The largest value a texel holds: the map is bytes, scaled down by this. */
export const POOL_RANGE = 4

export interface PoolMap {
  /** RGBA bytes, linear light over `POOL_RANGE`, row 0 at `minZ`. */
  data: Uint8Array
  w: number
  h: number
  minX: number
  minZ: number
  /** World tiles the map covers across and along. */
  sizeX: number
  sizeZ: number
}

/**
 * Every pool, splatted into one map of the ground: `(1 − d²/r²)²` from each
 * centre, added in linear light. The map covers the pools' own extent at up
 * to `LOOK.pools.texelsPerTile`, and never more than `LOOK.pools.maxSide`
 * texels a side. Null when there is nothing to light.
 */
export function splatPools(pools: readonly Pool[]): PoolMap | null {
  if (pools.length === 0) return null
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const p of pools) {
    minX = Math.min(minX, p.x - p.r)
    maxX = Math.max(maxX, p.x + p.r)
    minZ = Math.min(minZ, p.z - p.r)
    maxZ = Math.max(maxZ, p.z + p.r)
  }
  const sizeX = Math.max(1, maxX - minX)
  const sizeZ = Math.max(1, maxZ - minZ)
  const tpt = Math.min(LOOK.pools.texelsPerTile, LOOK.pools.maxSide / Math.max(sizeX, sizeZ))
  const w = Math.max(2, Math.ceil(sizeX * tpt))
  const h = Math.max(2, Math.ceil(sizeZ * tpt))
  const acc = new Float32Array(w * h * 3)
  const c = new Color()
  for (const p of pools) {
    c.setHex(p.color)
    const k = p.k * LOOK.pools.strength
    const x0 = Math.max(0, Math.floor(((p.x - p.r - minX) / sizeX) * w))
    const x1 = Math.min(w - 1, Math.ceil(((p.x + p.r - minX) / sizeX) * w))
    const z0 = Math.max(0, Math.floor(((p.z - p.r - minZ) / sizeZ) * h))
    const z1 = Math.min(h - 1, Math.ceil(((p.z + p.r - minZ) / sizeZ) * h))
    for (let j = z0; j <= z1; j++) {
      const wz = minZ + ((j + 0.5) / h) * sizeZ
      for (let i = x0; i <= x1; i++) {
        const wx = minX + ((i + 0.5) / w) * sizeX
        const d2 = ((wx - p.x) ** 2 + (wz - p.z) ** 2) / (p.r * p.r)
        if (d2 >= 1) continue
        const f = (1 - d2) * (1 - d2) * k
        const o = (j * w + i) * 3
        acc[o] += c.r * f
        acc[o + 1] += c.g * f
        acc[o + 2] += c.b * f
      }
    }
  }
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    for (let ch = 0; ch < 3; ch++) data[i * 4 + ch] = Math.min(255, Math.round((acc[i * 3 + ch] / POOL_RANGE) * 255))
    data[i * 4 + 3] = 255
  }
  return { data, w, h, minX, minZ, sizeX, sizeZ }
}

export interface PoolUniforms {
  tPools: { value: Texture | null }
  /** minX, minZ, sizeX, sizeZ. */
  uPoolBox: { value: Vector4 }
  uPoolOn: { value: number }
}

/** The map as a texture and the uniforms the lit material reads it through. */
export function poolUniforms(map: PoolMap | null): PoolUniforms {
  if (!map) return { tPools: { value: null }, uPoolBox: { value: new Vector4(0, 0, 1, 1) }, uPoolOn: { value: 0 } }
  const tex = new DataTexture(map.data, map.w, map.h, RGBAFormat, UnsignedByteType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return { tPools: { value: tex }, uPoolBox: { value: new Vector4(map.minX, map.minZ, map.sizeX, map.sizeZ) }, uPoolOn: { value: 1 } }
}

export const POOLS_FRAG_PARS = /* glsl */ `
  uniform sampler2D tPools;
  uniform vec4 uPoolBox;
  uniform float uPoolOn;
  uniform float uPoolLift;
`

/**
 * Before `opaque_fragment`: the pools light the fragment's own colour, full on
 * anything within `LOOK.pools.lift` of the ground and fading above it, so a
 * wall catches the lamp at its foot and a roof does not catch it at all.
 */
export const POOLS_OUT = /* glsl */ `
  if (uPoolOn > 0.5) {
    vec2 puv = (vMirrorWorld.xz - uPoolBox.xy) / uPoolBox.zw;
    if (puv.x >= 0.0 && puv.x <= 1.0 && puv.y >= 0.0 && puv.y <= 1.0) {
      vec3 pool = texture2D(tPools, puv).rgb * ${POOL_RANGE.toFixed(1)};
      float lift = exp(-max(0.0, vMirrorWorld.y - uPoolLift) / 1.2);
      outgoingLight += diffuseColor.rgb * pool * lift;
    }
  }
`
