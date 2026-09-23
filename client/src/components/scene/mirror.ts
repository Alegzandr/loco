/**
 * What the water and a wet street reflect: the room itself, mirrored.
 *
 * Under an orthographic camera a planar reflection is exact and cheap. The
 * reflection of a point `(x, y, z)` in the plane `y = 0` is `(x, −y, z)`, and
 * the camera sees it along the same ray that meets the plane where the eye
 * would see the reflection — so the room rendered once more with its world
 * flipped upside down (`scene.scale.y = −1`), from the same camera, is the
 * reflection, pixel for pixel, of everything standing on the plane. A surface
 * reads it at its own screen position (`gl_FragCoord`). A surface that is not
 * at `y = 0` — the harbour's sea is seven tenths of a tile under the quay —
 * reads it shifted: its plane's reflection of a point lies `2 · p · cos(pitch)`
 * tiles higher up the frame than the plane `0`'s does, and the shift is one
 * uniform (`uLevelUv`) times the fragment's own height. Everything under the
 * lowest water is clipped out of that pass, or the ground would reflect the
 * floor it stands on.
 *
 * The mirror pass lights the flipped room with the flipped sun, so a lit roof
 * is a lit roof in the water; its shadow map is rendered again for it and
 * then once more for the room. It runs once per match, like everything here,
 * at a half of the frame (a reflection is broken up by the ripples anyway),
 * and only where the tier allows it (`QUALITY[tier].reflections`) and the room
 * has something to reflect in (`Kit.reflective`).
 *
 * The material side is `kit.ts: litMaterial`, which reads these uniforms and
 * the GLSL below. Every number is the look's (`LOOK.water`).
 */
import { Color, HalfFloatType, LinearFilter, Mesh, Plane, UnsignedByteType, Vector2, Vector3, WebGLRenderTarget, type Camera, type Scene, type Texture, type WebGLRenderer } from 'three'
import type { LightRig } from './sky'
import { skyDome } from './shade'
import { LOOK } from './look'

export interface MirrorUniforms {
  /** The mirrored room, or null before it is rendered (and in the mirror pass itself). */
  tReflect: { value: Texture | null }
  uReflectOn: { value: number }
  /** The size of the target being rendered into, pixels: `gl_FragCoord` over this is the frame's uv. */
  uRes: { value: Vector2 }
  /** How far up the frame, in uv, a surface one tile high reads the reflection: `2 · cos(pitch) / frame height in tiles`. */
  uLevelUv: { value: number }
  uSkyTop: { value: Color }
  uSkyHorizon: { value: Color }
  uWaterReflect: { value: number }
  uWetMirror: { value: number }
  uRipple: { value: number }
  uWaveAmp: { value: number }
  uWaveScale: { value: number }
  uStreak: { value: number }
  uWaterRoughness: { value: number }
  uWaterSky: { value: number }
  /** 1 while the mirrored room is being drawn. */
  uMirrorPass: { value: number }
}

export interface Mirror {
  uniforms: MirrorUniforms
}

/**
 * The uniforms, for a room (`frame` in screen tiles, `pitchCos` the camera's)
 * or, with neither, for a sprite, which reflects nothing and still shades its
 * water the same way.
 */
export function makeMirror(rig: LightRig, frame?: { h: number }, pitchCos = 0): Mirror {
  const dome = skyDome(rig)
  return {
    uniforms: {
      tReflect: { value: null },
      uReflectOn: { value: 0 },
      uRes: { value: new Vector2(1, 1) },
      uLevelUv: { value: frame ? (2 * pitchCos) / frame.h : 0 },
      // `Color` takes sRGB hex into the linear working space, which is what the
      // lit material's output is in.
      uSkyTop: { value: new Color(dome.top) },
      uSkyHorizon: { value: new Color(dome.horizon) },
      uWaterReflect: { value: LOOK.water.reflect },
      uWetMirror: { value: rig.wet ? LOOK.water.wetMirror : 0 },
      uRipple: { value: LOOK.water.ripple },
      uWaveAmp: { value: LOOK.water.waveAmp * (rig.weather === 'storm' ? 1.8 : rig.weather === 'rain' ? 1.3 : 1) },
      uWaveScale: { value: LOOK.water.waveScale },
      uStreak: { value: LOOK.water.streak },
      uWaterRoughness: { value: LOOK.water.roughness },
      uWaterSky: { value: LOOK.water.sky },
      uMirrorPass: { value: 0 },
    },
  }
}

/** The declarations the lit material's vertex shader gains. */
export const MIRROR_VERT_PARS = /* glsl */ `
  attribute float gloss;
  attribute float water;
  varying float vGloss;
  varying float vWater;
  varying vec3 vMirrorWorld;
  varying float vUp;
`

/** After `begin_vertex`: the gloss, the water and where the vertex stands. */
export const MIRROR_VERT = /* glsl */ `
  vGloss = gloss;
  vWater = water;
  vMirrorWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vUp = normalize(mat3(modelMatrix) * objectNormal).y;
`

export const MIRROR_FRAG_PARS = /* glsl */ `
  varying float vGloss;
  varying float vWater;
  varying vec3 vMirrorWorld;
  varying float vUp;
  uniform float uGlossRoughness;
  uniform sampler2D tReflect;
  uniform float uReflectOn;
  uniform vec2 uRes;
  uniform float uLevelUv;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyHorizon;
  uniform float uWaterReflect;
  uniform float uWetMirror;
  uniform float uRipple;
  uniform float uWaveAmp;
  uniform float uWaveScale;
  uniform float uStreak;
  uniform float uWaterRoughness;
  uniform float uWaterSky;
  uniform float uMirrorPass;

  // The water's surface, as the slope of a few crossed swells: enough that the
  // sun catches a glint here and not there, and the reflection breaks.
  vec2 waveSlope(vec2 p) {
    p *= uWaveScale;
    vec2 s = vec2(0.0);
    s += vec2(0.8, 0.6) * cos(dot(p, vec2(0.8, 0.6)) * 1.0 + 0.3);
    s += vec2(-0.5, 0.86) * 0.7 * cos(dot(p, vec2(-0.5, 0.86)) * 1.7 + 1.9);
    s += vec2(0.2, -0.98) * 0.45 * cos(dot(p, vec2(0.2, -0.98)) * 2.9 + 4.1);
    s += vec2(0.95, -0.3) * 0.3 * cos(dot(p, vec2(0.95, -0.3)) * 4.3 + 0.7);
    return s * uWaveAmp;
  }

  // The sky a water surface sees, which is the upper half of it: seen from
  // this height a reflection looks a third of the way up, where the sky is
  // already its own colour and not the pale band at the horizon.
  vec3 skyAlong(vec3 r) {
    float y = clamp(r.y, 0.0, 1.0);
    return mix(uSkyHorizon, uSkyTop, pow(y, 0.3)) * 0.85;
  }

  // The mirrored room at this fragment, read at the height of its own plane.
  vec4 mirrored(vec2 offset) {
    vec2 uv = gl_FragCoord.xy / uRes + offset;
    uv.y -= vMirrorWorld.y * uLevelUv;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
    return texture2D(tReflect, uv);
  }
`

/** After `normal_fragment_maps`: the water's swell tilts its normal, which is where the glints come from. */
export const MIRROR_NORMAL = /* glsl */ `
  // In the mirror pass a face turned up is one that faced the ground: the
  // underside of every paving slab and kerb, which no reflection shows and
  // which, mirrored, lay across a wet plaza as bright shards.
  if (uMirrorPass > 0.5 && vUp > 0.5) discard;
  if (vWater > 0.5) {
    vec2 sl = waveSlope(vMirrorWorld.xz);
    vec3 nw = normalize(vec3(-sl.x, 1.0, -sl.y));
    normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
  }
`

/**
 * Before `opaque_fragment`: the water takes the sky and the room over its own
 * colour, and a wet street takes the room's lights (only the lights: the sky
 * it already has, through the gloss).
 */
export const MIRROR_OUT = /* glsl */ `
  float flatness = smoothstep(0.9, 0.99, vUp);
  if (vWater > 0.5) {
    vec2 sl = waveSlope(vMirrorWorld.xz);
    vec3 nw = normalize(vec3(-sl.x, 1.0, -sl.y));
    vec3 V = normalize(cameraPosition - vMirrorWorld);
    vec3 sky = skyAlong(reflect(-V, nw));
    vec4 room = uReflectOn > 0.5 ? mirrored(sl * uRipple) : vec4(0.0);
    // The sky only tints the water — a bright sky mixed in at the weight of a
    // mirror turned the harbour into a pale grey sheet — and the room stands
    // in it at the weight of a reflection.
    outgoingLight = mix(outgoingLight, sky, uWaterSky * flatness);
    outgoingLight = mix(outgoingLight, room.rgb / max(room.a, 1e-3), uWaterReflect * clamp(room.a, 0.0, 1.0) * flatness);
  } else if (uReflectOn > 0.5 && uWetMirror > 0.0 && vGloss > 0.0) {
    // A lamp in a wet street is a streak towards the viewer, not a spot: the
    // reflection is averaged down the frame from where it would be sharp.
    // Spread a little across as well, so a lit window is a smear of its
    // colour and never a sharp shard of glass lying on the paving.
    // The taps are jittered per pixel (interleaved gradient noise), so a row
    // of lit windows comes out as a glow and not as a second row of windows.
    vec3 acc = vec3(0.0);
    float n0 = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    for (int i = 0; i < 12; i++) {
      float fi = float(i);
      float n = fract(n0 + fi * 0.618034);
      vec4 m = mirrored(vec2((n - 0.5) * uStreak * 2.5, -(fi + n) * uStreak));
      acc += m.rgb;
    }
    outgoingLight += acc / 12.0 * uWetMirror * vGloss * flatness;
  }
`

/**
 * Renders the room mirrored in `y = level` into a target at `scale` of
 * `width × height` and returns it (the caller disposes of it). The scene is
 * flipped in place and put back, the clipping plane is the renderer's for the
 * length of the pass, and the sun's shadow map is rendered for the flipped
 * room and flagged again for the real one.
 */
export function renderReflection(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  mirror: Mirror,
  level: number,
  width: number,
  height: number,
  half: boolean,
): WebGLRenderTarget {
  const w = Math.max(1, Math.round(width * LOOK.water.scale))
  const h = Math.max(1, Math.round(height * LOOK.water.scale))
  const target = new WebGLRenderTarget(w, h, { type: half ? HalfFloatType : UnsignedByteType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true, stencilBuffer: false, generateMipmaps: false })
  const prevClear = new Color()
  renderer.getClearColor(prevClear)
  const prevAlpha = renderer.getClearAlpha()
  const prevPlanes = renderer.clippingPlanes
  mirror.uniforms.uReflectOn.value = 0
  mirror.uniforms.uMirrorPass.value = 1
  mirror.uniforms.uRes.value.set(w, h)
  scene.scale.y = -1
  scene.updateMatrixWorld(true)
  // The halos sit this pass out: they are light lying on the ground, flat
  // discs whose undersides, flipped, lay a pale band over every wet plaza.
  // What glows is still in it, so a lamp is still a lamp in the water.
  const hidden: Mesh[] = []
  scene.traverse((obj) => {
    const mesh = obj as Mesh
    const m = mesh.material as { transparent?: boolean } | undefined
    if (mesh.isMesh && mesh.visible && m?.transparent) {
      mesh.visible = false
      hidden.push(mesh)
    }
  })
  try {
    // Only what stands above the water: flipped, that is what lies below
    // `−level`.
    renderer.clippingPlanes = [new Plane(new Vector3(0, -1, 0), -(level + 0.02))]
    renderer.shadowMap.needsUpdate = true
    renderer.setRenderTarget(target)
    const gl = renderer.getContext()
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('reflection target incomplete')
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.render(scene, camera)
  } catch (err) {
    target.dispose()
    throw err
  } finally {
    renderer.setRenderTarget(null)
    renderer.clippingPlanes = prevPlanes
    renderer.setClearColor(prevClear, prevAlpha)
    mirror.uniforms.uMirrorPass.value = 0
    for (const m of hidden) m.visible = true
    scene.scale.y = 1
    scene.updateMatrixWorld(true)
    renderer.shadowMap.needsUpdate = true
  }
  mirror.uniforms.tReflect.value = target.texture
  mirror.uniforms.uReflectOn.value = 1
  return target
}
