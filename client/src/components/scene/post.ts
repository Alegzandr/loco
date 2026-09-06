/**
 * The finishing passes over one rendered room.
 *
 * The room is lit in the scene — a sun, a sky, one shadow map — and what
 * these passes add is the rest of the renderer a low-poly diorama is judged
 * against: the occlusion in the creases the shadow map cannot see (SSAO from
 * the frame's own depth), the light off a lamp spilling past its glass
 * (bloom), a filmic tone curve over the linear frame, a grade that keeps the
 * shade cool and the light warm, the focus held on the table's band and
 * easing off towards the top and bottom of the frame (a tilt-shift, which is
 * how a diorama is photographed), the corners a touch darker and a touch
 * fringed, a fine grain, and a last pass of edge anti-aliasing over the
 * supersampling. Every one is a full-screen shader over a texture the scene
 * was rendered into, every number in them is the look's (`look.ts`), and
 * every one runs exactly once per match: the result is copied out and the
 * targets are released with the context.
 *
 * The pipeline, at the supersampled size unless said otherwise:
 *
 *   scene ──▶ sceneRT (half-float linear, with a depth texture)
 *     ├─▶ occlusion ½ (depth → normals → hemisphere samples) ──▶ blur H ──▶ blur V ──▶ aoRT
 *     └─▶ lit = scene × occlusion ──▶ litRT
 *           ├─▶ bright pass ¼ ──▶ blur ×2 ──▶ bloomRT
 *           ├─▶ copy ½ ──▶ blur ──▶ blurRT                     (the out-of-focus copy)
 *           └─▶ composite (FXAA · fringe · focus · bloom · tone · grade · vignette · grain) ──▶ canvas
 *
 * Colour: the scene renders into the target in linear light, the passes work
 * in linear, the tone curve is applied in the composite exactly as the plain
 * path applies it (`renderer.toneMapping`, same functions from three's own
 * chunk), and the composite ends on `colorspace_fragment`, the same sRGB
 * encoding `outputColorSpace` gives the direct render — so a room with every
 * pass off comes out the colour the plain frame does. Everything a pass may
 * throw is left to the caller: a GPU that refuses a target gets the plain
 * render, never no room.
 */
import {
  DepthTexture,
  FloatType,
  HalfFloatType,
  LinearFilter,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Camera,
  type Texture,
} from 'three'
import type { LightRig } from './sky'
import type { PostOptions } from './quality'
import { DEBUG_VIEWS, LOOK, type ToneMapping } from './look'
import { channels, lightingFor } from './shade'

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

/**
 * Ambient occlusion from the depth of an orthographic frame.
 *
 * Under an orthographic camera the depth buffer is linear in view depth and
 * a pixel's view-space x/y are its uv across the camera's frame, so a
 * position is reconstructed exactly and a sample point projects back to a
 * uv with a divide by nothing. The normal is taken from the depth's own
 * differences, the smaller of each pair so an edge does not smear it. Two
 * radii: a wide one for the foot of a wall and the well of a courtyard, a
 * tight one for the crease between two blocks. The per-pixel rotation is a
 * hash, and the blur that follows takes the noise out.
 */
const AO_FRAG = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec2 uRes;
  uniform vec4 uFrame;   // left, right, bottom, top
  uniform vec2 uRange;   // near, far
  uniform float uRadius;
  uniform float uRadiusSmall;
  uniform float uPower;
  uniform float uSeed;
  varying vec2 vUv;

  float viewZ(vec2 uv) {
    float d = texture2D(tDepth, uv).x;
    return -(uRange.x + d * (uRange.y - uRange.x));
  }
  vec3 viewPos(vec2 uv) {
    return vec3(uFrame.x + uv.x * (uFrame.y - uFrame.x), uFrame.z + uv.y * (uFrame.w - uFrame.z), viewZ(uv));
  }
  vec2 uvOf(vec3 p) {
    return vec2((p.x - uFrame.x) / (uFrame.y - uFrame.x), (p.y - uFrame.z) / (uFrame.w - uFrame.z));
  }
  // Interleaved gradient noise: no diagonal streaks, unlike the sine hash.
  float hash(vec2 p) {
    p += uSeed;
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
  }

  void main() {
    vec2 px = 1.0 / uRes;
    vec3 P = viewPos(vUv);
    // The normal: the smaller difference on each axis, so a pixel on an edge
    // takes the surface it is on and not the one behind it.
    vec3 dxA = viewPos(vUv + vec2(px.x, 0.0)) - P;
    vec3 dxB = P - viewPos(vUv - vec2(px.x, 0.0));
    vec3 dyA = viewPos(vUv + vec2(0.0, px.y)) - P;
    vec3 dyB = P - viewPos(vUv - vec2(0.0, px.y));
    vec3 dx = abs(dxA.z) < abs(dxB.z) ? dxA : dxB;
    vec3 dy = abs(dyA.z) < abs(dyB.z) ? dyA : dyB;
    vec3 N = normalize(cross(dx, dy));

    // A tangent frame around N, rotated per pixel.
    float a = hash(gl_FragCoord.xy) * 6.2831853;
    vec3 rnd = vec3(cos(a), sin(a), hash(gl_FragCoord.yx + 3.7));
    vec3 T = normalize(rnd - N * dot(rnd, N));
    vec3 B = cross(N, T);

    float occ = 0.0;
    float total = 0.0;
    for (int i = 0; i < AO_SAMPLES; i++) {
      float fi = float(i);
      // A uniform hemisphere, spread over the sequence: the grazing directions
      // are the ones that find a wall beside a paving stone, and a cosine
      // weighting spends most of its samples looking up at nothing.
      float u = (fi + 0.5) / float(AO_SAMPLES);
      float v = fract(u * 7.0 + hash(gl_FragCoord.xy + fi));
      float phi = v * 6.2831853;
      float ct = mix(0.08, 1.0, u);
      float st = sqrt(1.0 - ct * ct);
      vec3 dir = T * (cos(phi) * st) + B * (sin(phi) * st) + N * ct;
      // The distance along it, on its own sequence: nearer more often.
      float q = fract(u * 3.0 + hash(gl_FragCoord.yx + fi * 1.7));
      float scale = mix(0.15, 1.0, q);
      for (int r = 0; r < 2; r++) {
        float radius = r == 0 ? uRadius : uRadiusSmall;
        vec3 S = P + dir * radius * scale;
        vec2 suv = uvOf(S);
        if (suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) { total += 1.0; continue; }
        float sceneZ = viewZ(suv);
        // Occluded when the surface there is nearer the camera than the sample
        // point by more than a hair — and by less than the radius or so: a
        // tree top four tiles over a paving stone is not a crease, and
        // counting it draws a dark halo round every silhouette.
        float dz = sceneZ - S.z;
        occ += dz > 0.02 ? 1.0 - smoothstep(radius * 0.7, radius * 1.6, dz) : 0.0;
        total += 1.0;
      }
    }
    float ao = 1.0 - occ / max(1.0, total);
    ao = pow(clamp(ao, 0.0, 1.0), uPower);
    gl_FragColor = vec4(vec3(ao), 1.0);
  }
`

/** A depth-aware box blur of the occlusion, one direction; run twice. */
const AO_BLUR_FRAG = /* glsl */ `
  uniform sampler2D tAo;
  uniform sampler2D tDepth;
  uniform vec2 uDir;
  uniform float uDepthScale;
  varying vec2 vUv;
  void main() {
    float d0 = texture2D(tDepth, vUv).x;
    float sum = 0.0;
    float wsum = 0.0;
    for (int i = -AO_BLUR; i <= AO_BLUR; i++) {
      vec2 uv = vUv + uDir * float(i);
      float d = texture2D(tDepth, uv).x;
      float w = exp(-abs(d - d0) * uDepthScale);
      sum += texture2D(tAo, uv).x * w;
      wsum += w;
    }
    gl_FragColor = vec4(vec3(sum / max(1e-4, wsum)), 1.0);
  }
`

/** The scene with its occlusion multiplied in. */
const LIT_FRAG = /* glsl */ `
  uniform sampler2D tScene;
  uniform sampler2D tAo;
  uniform float uIntensity;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tScene, vUv);
    float ao = texture2D(tAo, vUv).x;
    c.rgb *= mix(1.0, ao, uIntensity);
    gl_FragColor = c;
  }
`

/** What is bright enough to bleed: the lamps, the neon, the lit windows, a low sun on glass. */
const BRIGHT_FRAG = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uExposure;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float k = smoothstep(uThreshold, uThreshold + 0.5, l);
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
 * the last quarter-pixel of stair a diagonal ink line still shows. The tone
 * curve is three's own (`tonemapping_pars_fragment`), picked by `uTone`
 * (`TONE_INDEX`), so the plain path and this one agree.
 */
const COMPOSITE_FRAG = /* glsl */ `
  // Rendering to the canvas, three prefixes its own tone-mapping functions
  // (and defines TONE_MAPPING) whenever the renderer's curve is on; the
  // include is for the one case it is not.
  #ifndef TONE_MAPPING
  #include <tonemapping_pars_fragment>
  #endif
  uniform float uExposure;
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
  uniform int uTone;
  uniform float uContrast;
  uniform float uSaturation;
  uniform vec3 uShadowTint;
  uniform vec3 uHighlightTint;
  uniform float uSplit;
  uniform int uDebug;
  uniform sampler2D tAo;
  uniform sampler2D tDepth;
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

  vec3 tone(vec3 c) {
    if (uTone == 1) return ACESFilmicToneMapping(c);
    if (uTone == 2) return AgXToneMapping(c);
    if (uTone == 3) return NeutralToneMapping(c);
    return saturate(c * uExposure);
  }

  void main() {
    vec2 px = 1.0 / uRes;
    vec2 uv = vUv;
    vec2 fromC = uv - 0.5;
    float r2 = dot(fromC, fromC);
    if (uDebug == 1) { gl_FragColor = vec4(vec3(texture2D(tAo, uv).x), 1.0); return; }
    if (uDebug == 3) { float d = texture2D(tDepth, uv).x; gl_FragColor = vec4(vec3(fract(d * 40.0)), 1.0); return; }

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

    // The tone curve, with the exposure, in linear light: the same function
    // the plain path applies through the renderer.
    col = tone(col);
    if (uDebug == 2) { gl_FragColor = vec4(col, 1.0); return; }

    // The grade, on the display range: the shade pulled towards a cool note,
    // the light towards a warm one, a touch of saturation and of contrast
    // about mid-grey.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += ((uShadowTint - 0.5) * (1.0 - l) + (uHighlightTint - 0.5) * l) * uSplit;
    col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, uSaturation);
    col = max((col - 0.18) * uContrast + 0.18, 0.0);

    // The vignette, elliptical with the frame.
    float v = smoothstep(0.42, 1.15, length(fromC * vec2(1.0, 1.15)) * 1.41);
    col *= 1.0 - v * uVignette;

    col += (hash(gl_FragCoord.xy) - 0.5) * uGrain;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`

/** `uTone` in the composite: 0 is exposure alone, the rest are three's curves. */
const TONE_INDEX: Record<ToneMapping, number> = { none: 0, aces: 1, agx: 2, neutral: 3 }

function quadCamera(): Camera {
  return new OrthographicCamera(-1, 1, 1, -1, 0, 1)
}

function target(w: number, h: number, o: { half?: boolean; depth?: boolean; depthTexture?: DepthTexture; nearest?: boolean } = {}): WebGLRenderTarget {
  return new WebGLRenderTarget(Math.max(1, w), Math.max(1, h), {
    type: o.half ? HalfFloatType : UnsignedByteType,
    minFilter: o.nearest ? NearestFilter : LinearFilter,
    magFilter: o.nearest ? NearestFilter : LinearFilter,
    depthBuffer: !!o.depth,
    stencilBuffer: false,
    generateMipmaps: false,
    ...(o.depthTexture ? { depthTexture: o.depthTexture } : {}),
  })
}

function rgb(hex: number): Vector3 {
  const [r, g, b] = channels(hex)
  return new Vector3(r, g, b)
}

/**
 * Renders `scene` through the passes `opts` asks for and leaves the result
 * on the renderer's canvas, at its current size. `focus` is in the canvas's
 * own pixels, y down. The camera has to be orthographic: the occlusion pass
 * reconstructs positions from its frame.
 *
 * Throws on a GPU that cannot hold a target this size; the caller falls back
 * to the plain render.
 */
export function renderWithPost(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: OrthographicCamera,
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
  const shader = (frag: string, uniforms: Record<string, { value: unknown }>, defines: Record<string, number> = {}): ShaderMaterial => {
    const m = new ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, defines, depthTest: false, depthWrite: false })
    materials.push(m)
    return m
  }
  const pass = (material: ShaderMaterial, into: WebGLRenderTarget | null) => {
    quad.material = material
    renderer.setRenderTarget(into)
    renderer.render(quadScene, cam)
  }
  const exposure = lightingFor(rig).exposure

  try {
    // ─── The scene, into a texture ─────────────────────────────────────────
    // Half-float first: eight bits of linear light band in the darks of a
    // night room. A GPU that will not render to it gets bytes. The depth
    // rides along as a texture for the occlusion pass.
    const depthTexture = new DepthTexture(width, height, FloatType)
    let sceneRT = keep(target(width, height, { half: true, depth: true, depthTexture }))
    renderer.setRenderTarget(sceneRT)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      renderer.setRenderTarget(null)
      sceneRT.dispose()
      targets.pop()
      sceneRT = keep(target(width, height, { half: false, depth: true, depthTexture }))
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

    // ─── The occlusion, at a half ──────────────────────────────────────────
    const aw = Math.ceil(width / 2)
    const ah = Math.ceil(height / 2)
    const aoA = keep(target(aw, ah, { half: false }))
    if (opts.ao && LOOK.ao.intensity > 0) {
      const aoB = keep(target(aw, ah, { half: false }))
      const ao = shader(
        AO_FRAG,
        {
          tDepth: { value: depthTexture },
          uRes: { value: new Vector2(aw, ah) },
          uFrame: { value: [camera.left, camera.right, camera.bottom, camera.top] },
          uRange: { value: new Vector2(camera.near, camera.far) },
          uRadius: { value: LOOK.ao.radius },
          uRadiusSmall: { value: LOOK.ao.radiusSmall },
          uPower: { value: LOOK.ao.power },
          uSeed: { value: seed },
        },
        { AO_SAMPLES: Math.max(4, Math.round(LOOK.ao.samples)) },
      )
      pass(ao, aoA)
      const aoBlur = shader(
        AO_BLUR_FRAG,
        {
          tAo: { value: null },
          tDepth: { value: depthTexture },
          uDir: { value: new Vector2() },
          // A difference of a tile of depth halves the weight.
          uDepthScale: { value: (camera.far - camera.near) * 0.7 },
        },
        { AO_BLUR: Math.max(1, Math.round(LOOK.ao.blur)) },
      )
      aoBlur.uniforms.tAo.value = aoA.texture
      aoBlur.uniforms.uDir.value.set(1 / aw, 0)
      pass(aoBlur, aoB)
      aoBlur.uniforms.tAo.value = aoB.texture
      aoBlur.uniforms.uDir.value.set(0, 1 / ah)
      pass(aoBlur, aoA)
    } else {
      renderer.setRenderTarget(aoA)
      renderer.setClearColor(0xffffff, 1)
      renderer.clear()
    }

    // ─── The lit frame: scene × occlusion ──────────────────────────────────
    const litRT = keep(target(width, height, { half: sceneRT.texture.type === HalfFloatType }))
    const lit = shader(LIT_FRAG, { tScene: { value: sceneRT.texture }, tAo: { value: aoA.texture }, uIntensity: { value: opts.ao ? LOOK.ao.intensity : 0 } })
    pass(lit, litRT)

    // ─── Bloom, at a quarter ───────────────────────────────────────────────
    const bw = Math.ceil(width / 4)
    const bh = Math.ceil(height / 4)
    const bloomA = keep(target(bw, bh, { half: true }))
    const bloomB = keep(target(bw, bh, { half: true }))
    if (opts.bloom) {
      const bright = shader(BRIGHT_FRAG, { tDiffuse: { value: litRT.texture }, uThreshold: { value: LOOK.post.bloomThreshold }, uExposure: { value: exposure } })
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
      copy.uniforms.tDiffuse.value = litRT.texture
      pass(copy, blurA)
      blurPass(blurA.texture, blurB, 1.4 / hw, 0)
      blurPass(blurB.texture, blurA, 0, 1.4 / hh)
    }

    // ─── The composite, onto the canvas ────────────────────────────────────
    // A darker room blooms more: at noon the lamps are off and what is bright
    // is the sky and the snow, which must not glow; at midnight the lamps are
    // the light.
    const bloomStrength = opts.bloom ? LOOK.post.bloomStrength + rig.dark * LOOK.post.bloomDark : 0
    const focusY = 1 - focus.cy / height
    const dofFrom = (focus.ry / height) * LOOK.post.dofBand
    const composite = shader(COMPOSITE_FRAG, {
      tScene: { value: litRT.texture },
      tBlur: { value: blurA.texture },
      tBloom: { value: bloomA.texture },
      uRes: { value: new Vector2(width, height) },
      uFxaa: { value: opts.fxaa ? 1 : 0 },
      uFocusY: { value: focusY },
      uDofFrom: { value: dofFrom },
      uDofTo: { value: dofFrom + LOOK.post.dofEase },
      uDofMax: { value: opts.dof ? LOOK.post.dofMax : 0 },
      uBloom: { value: bloomStrength },
      uVignette: { value: opts.vignette },
      uGrain: { value: opts.grain ? LOOK.post.grain : 0 },
      uAberration: { value: opts.aberration ? LOOK.post.aberration : 0 },
      uSeed: { value: seed },
      uTone: { value: TONE_INDEX[LOOK.tone.mapping] },
      uExposure: { value: exposure },
      uContrast: { value: LOOK.tone.contrast },
      uSaturation: { value: LOOK.tone.saturation },
      uShadowTint: { value: rgb(LOOK.tone.shadowTint) },
      uHighlightTint: { value: rgb(LOOK.tone.highlightTint) },
      uSplit: { value: LOOK.tone.splitStrength },
      uDebug: { value: import.meta.env.DEV ? DEBUG_VIEWS.indexOf(LOOK.debug) : 0 },
      tAo: { value: aoA.texture },
      tDepth: { value: depthTexture },
    })
    pass(composite, null)
  } finally {
    renderer.setRenderTarget(null)
    for (const t of targets) t.dispose()
    for (const m of materials) m.dispose()
    quad.geometry.dispose()
  }
}
