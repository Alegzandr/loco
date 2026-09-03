/**
 * The finishing passes over one rendered room.
 *
 * The room is drawn flat on purpose — three tones, an ink line, a hard shadow
 * — and what these passes add is the *camera* that photographed the drawing:
 * the light off a lamp spilling a little past its glass (bloom), the focus
 * held on the table's band and easing off towards the top and bottom of the
 * frame (a tilt-shift, which is how a diorama is photographed), the corners a
 * touch darker and a touch fringed (vignette, chromatic aberration), a fine
 * grain so a wall is a surface, and a last pass of edge anti-aliasing over
 * the supersampling. Every one is a full-screen shader over a texture the
 * scene was rendered into, and every one runs exactly once per match: the
 * result is copied out and the targets are released with the context.
 *
 * The pipeline, at the supersampled size unless said otherwise:
 *
 *   scene ──▶ sceneRT (half-float, so a night's darks do not band)
 *     ├─▶ bright pass ¼ ──▶ blur H ──▶ blur V ──▶ blur H ──▶ blur V ──▶ bloomRT
 *     ├─▶ copy ½ ──▶ blur H ──▶ blur V ──▶ blurRT          (the out-of-focus copy)
 *     └─▶ composite (FXAA · focus · bloom · grade · vignette · fringe · grain) ──▶ canvas
 *
 * Colour: the scene renders into the target in linear light, the passes work
 * in linear, and the composite ends on `colorspace_fragment`, which is the
 * same sRGB encoding the plain path gets from `outputColorSpace` — so a room
 * with every pass off comes out the colour it came out before there were
 * passes. Everything a pass may throw is left to the caller: a GPU that
 * refuses a half-float target gets the plain render, never no room.
 */
import {
  HalfFloatType,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
  type Texture,
} from 'three'
import type { LightRig } from './sky'
import type { PostOptions } from './quality'

/** The felt's ellipse in the render's own pixels: where the focus is held. */
export interface FocusBand {
  cx: number
  cy: number
  rx: number
  ry: number
}

const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

const COPY_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tDiffuse, vUv);
  }
`

/** What is bright enough to bleed: the lamps, the neon, the lit windows, a low sun on glass. */
const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(uThreshold, uThreshold + 0.4, l);
    gl_FragColor = vec4(c * k, 1.0);
  }
`

/** One direction of a 9-tap gaussian; run twice with `uDir` turned. */
const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    float w0 = 0.227027;
    float w1 = 0.1945946;
    float w2 = 0.1216216;
    float w3 = 0.054054;
    float w4 = 0.016216;
    vec4 c = texture2D(tDiffuse, vUv) * w0;
    c += (texture2D(tDiffuse, vUv + uDir) + texture2D(tDiffuse, vUv - uDir)) * w1;
    c += (texture2D(tDiffuse, vUv + uDir * 2.0) + texture2D(tDiffuse, vUv - uDir * 2.0)) * w2;
    c += (texture2D(tDiffuse, vUv + uDir * 3.0) + texture2D(tDiffuse, vUv - uDir * 3.0)) * w3;
    c += (texture2D(tDiffuse, vUv + uDir * 4.0) + texture2D(tDiffuse, vUv - uDir * 4.0)) * w4;
    gl_FragColor = c;
  }
`

/**
 * The composite. FXAA is the compact form of 3.11 — five taps to find the
 * edge's direction, four along it — which on a frame already supersampled is
 * the last quarter-pixel of stair a diagonal ink line still shows.
 */
const COMPOSITE_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tBlur;
  uniform sampler2D tBloom;
  uniform vec2 uRes;
  uniform float uFxaa;
  uniform float uFocusY;
  uniform float uDofFrom;
  uniform float uDofTo;
  uniform float uDofMax;
  uniform float uBloom;
  uniform float uVignette;
  uniform float uGrain;
  uniform float uAberration;
  uniform float uSeed;
  varying vec2 vUv;

  #define FXAA_REDUCE_MIN (1.0 / 128.0)
  #define FXAA_REDUCE_MUL (1.0 / 8.0)
  #define FXAA_SPAN_MAX 8.0

  vec3 fxaa(sampler2D tex, vec2 uv, vec2 px) {
    vec3 rgbNW = texture2D(tex, uv + vec2(-1.0, -1.0) * px).rgb;
    vec3 rgbNE = texture2D(tex, uv + vec2(1.0, -1.0) * px).rgb;
    vec3 rgbSW = texture2D(tex, uv + vec2(-1.0, 1.0) * px).rgb;
    vec3 rgbSE = texture2D(tex, uv + vec2(1.0, 1.0) * px).rgb;
    vec3 rgbM = texture2D(tex, uv).rgb;
    vec3 luma = vec3(0.299, 0.587, 0.114);
    float lumaNW = dot(rgbNW, luma);
    float lumaNE = dot(rgbNE, luma);
    float lumaSW = dot(rgbSW, luma);
    float lumaSE = dot(rgbSE, luma);
    float lumaM = dot(rgbM, luma);
    float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
    float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
    vec2 dir;
    dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
    dir.y = ((lumaNW + lumaSW) - (lumaNE + lumaSE));
    float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * FXAA_REDUCE_MUL), FXAA_REDUCE_MIN);
    float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
    dir = min(vec2(FXAA_SPAN_MAX), max(vec2(-FXAA_SPAN_MAX), dir * rcpDirMin)) * px;
    vec3 rgbA = 0.5 * (texture2D(tex, uv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tex, uv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 rgbB = rgbA * 0.5 + 0.25 * (texture2D(tex, uv + dir * -0.5).rgb + texture2D(tex, uv + dir * 0.5).rgb);
    float lumaB = dot(rgbB, luma);
    if (lumaB < lumaMin || lumaB > lumaMax) return rgbA;
    return rgbB;
  }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
  }

  void main() {
    vec2 px = 1.0 / uRes;
    vec2 uv = vUv;
    vec2 fromC = uv - 0.5;
    float r2 = dot(fromC, fromC);

    vec3 sharp = uFxaa > 0.5 ? fxaa(tScene, uv, px) : texture2D(tScene, uv).rgb;

    // The fringe: red and blue pulled apart along the radius, only out in the
    // corners where a lens does it, and never across the table.
    float ab = smoothstep(0.09, 0.5, r2) * uAberration;
    if (ab > 0.0) {
      vec2 off = normalize(fromC) * ab * px;
      sharp.r = texture2D(tScene, uv + off).r;
      sharp.b = texture2D(tScene, uv - off).b;
    }

    // The focus: a band across the frame at the table's height, everything
    // above and below it easing into the blurred copy.
    float d = abs(uv.y - uFocusY);
    float blurAmt = smoothstep(uDofFrom, uDofTo, d) * uDofMax;
    vec3 col = mix(sharp, texture2D(tBlur, uv).rgb, blurAmt);

    col += texture2D(tBloom, uv).rgb * uBloom;

    // The grade: a touch more saturation, a touch more contrast about
    // mid-grey, in linear light. Small, because the tones were chosen by
    // hand and this is a photograph of them, not a repaint.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(l), col, 1.08);
    col = max((col - 0.18) * 1.05 + 0.18, 0.0);

    // The vignette, elliptical with the frame.
    float v = smoothstep(0.42, 1.15, length(fromC * vec2(1.0, 1.15)) * 1.41);
    col *= 1.0 - v * uVignette;

    col += (hash(gl_FragCoord.xy) - 0.5) * uGrain;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

function quadCamera(): Camera {
  return new OrthographicCamera(-1, 1, 1, -1, 0, 1)
}

function target(w: number, h: number, o: { half?: boolean; depth?: boolean; samples?: number } = {}): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: o.half ? HalfFloatType : UnsignedByteType,
    minFilter: LinearFilter,
    magFilter: LinearFilter,
    depthBuffer: !!o.depth,
    stencilBuffer: !!o.depth,
    samples: o.samples ?? 0,
    generateMipmaps: false,
  })
}

/**
 * Renders `scene` through the passes `opts` asks for and leaves the result
 * on the renderer's canvas, at its current size. `focus` is in the canvas's
 * own pixels, y down.
 *
 * Throws on a GPU that cannot hold a target this size; the caller falls back
 * to the plain render.
 */
export function renderWithPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  width: number,
  height: number,
  rig: LightRig,
  focus: FocusBand,
  opts: PostOptions,
  seed: number,
): void {
  const gl = renderer.getContext()
  const targets: WebGLRenderTarget[] = []
  const materials: ShaderMaterial[] = []
  const quad = new Mesh(new PlaneGeometry(2, 2))
  const quadScene = new Scene()
  quadScene.add(quad)
  const cam = quadCamera()

  const keep = <T extends WebGLRenderTarget>(t: T): T => {
    targets.push(t)
    return t
  }
  const shader = (frag: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial => {
    const m = new ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false })
    materials.push(m)
    return m
  }
  const pass = (material: ShaderMaterial, into: WebGLRenderTarget | null) => {
    quad.material = material
    renderer.setRenderTarget(into)
    renderer.render(quadScene, cam)
  }

  try {
    // ─── The scene, into a texture ─────────────────────────────────────────
    // Half-float first: eight bits of linear light band in the darks of a
    // night room. A GPU that will not render to it gets bytes.
    let sceneRT = keep(target(width, height, { half: true, depth: true }))
    renderer.setRenderTarget(sceneRT)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      renderer.setRenderTarget(null)
      sceneRT.dispose()
      targets.pop()
      sceneRT = keep(target(width, height, { half: false, depth: true }))
      renderer.setRenderTarget(sceneRT)
    }
    renderer.render(scene, camera)

    const copy = shader(COPY_FRAG, { tDiffuse: { value: null } })
    const blur = shader(BLUR_FRAG, { tDiffuse: { value: null }, uDir: { value: new Vector2() } })
    const blurPass = (from: Texture, into: WebGLRenderTarget, dx: number, dy: number) => {
      blur.uniforms.tDiffuse.value = from
      blur.uniforms.uDir.value.set(dx, dy)
      pass(blur, into)
    }

    // ─── Bloom, at a quarter ───────────────────────────────────────────────
    const bw = Math.ceil(width / 4)
    const bh = Math.ceil(height / 4)
    const bloomA = keep(target(bw, bh, { half: true }))
    const bloomB = keep(target(bw, bh, { half: true }))
    if (opts.bloom) {
      const bright = shader(BRIGHT_FRAG, { tDiffuse: { value: sceneRT.texture }, uThreshold: { value: 0.55 } })
      pass(bright, bloomA)
      for (let i = 0; i < 2; i++) {
        blurPass(bloomA.texture, bloomB, 1 / bw, 0)
        blurPass(bloomB.texture, bloomA, 0, 1 / bh)
      }
    } else {
      renderer.setRenderTarget(bloomA)
      renderer.setClearColor(0x000000, 1)
      renderer.clear()
    }

    // ─── The out-of-focus copy, at a half ──────────────────────────────────
    const hw = Math.ceil(width / 2)
    const hh = Math.ceil(height / 2)
    const blurA = keep(target(hw, hh, { half: true }))
    if (opts.dof) {
      const blurB = keep(target(hw, hh, { half: true }))
      copy.uniforms.tDiffuse.value = sceneRT.texture
      pass(copy, blurA)
      blurPass(blurA.texture, blurB, 1.4 / hw, 0)
      blurPass(blurB.texture, blurA, 0, 1.4 / hh)
    }

    // ─── The composite, onto the canvas ────────────────────────────────────
    // A darker room blooms more: at noon the lamps are off and what is bright
    // is the sky and the snow, which must not glow; at midnight the lamps are
    // the light.
    const bloomStrength = opts.bloom ? 0.12 + rig.dark * 0.5 : 0
    const focusY = 1 - focus.cy / height
    const dofFrom = (focus.ry / height) * 1.6
    const composite = shader(COMPOSITE_FRAG, {
      tScene: { value: sceneRT.texture },
      tBlur: { value: blurA.texture },
      tBloom: { value: bloomA.texture },
      uRes: { value: new Vector2(width, height) },
      uFxaa: { value: opts.fxaa ? 1 : 0 },
      uFocusY: { value: focusY },
      uDofFrom: { value: dofFrom },
      uDofTo: { value: dofFrom + 0.34 },
      uDofMax: { value: opts.dof ? 0.85 : 0 },
      uBloom: { value: bloomStrength },
      uVignette: { value: opts.vignette },
      uGrain: { value: opts.grain ? 0.028 : 0 },
      uAberration: { value: opts.aberration ? 1.6 : 0 },
      uSeed: { value: seed },
    })
    pass(composite, null)
  } finally {
    renderer.setRenderTarget(null)
    for (const t of targets) t.dispose()
    for (const m of materials) m.dispose()
    quad.geometry.dispose()
  }
}
