/**
 * A painted room in the render (`plates.ts`): the painting behind everything,
 * and the table's shade on its floor.
 *
 * The painting is a sheet drawn on the far plane before anything else, the
 * way the sky's dome is: it writes no depth, so the finishing passes read it
 * as nothing (no air laid over it, no occlusion), and the bloom still takes
 * its lamps. Each fragment reads the plate where `plateUv` says, so the
 * painting's horizon is the camera's at every frame.
 *
 * Past the painting's edges: its top row is sky and stretches up as sky; past
 * a side it is mirrored (a phone on its side has its lens off the middle of
 * the frame and asks for a few columns more); under its foot the floor is the
 * painting mirrored too, going down into the floor's own darkest note, since a
 * phone's frame looks further down than the plate was painted.
 */
import { CircleGeometry, ClampToEdgeWrapping, Color, LinearFilter, LinearMipmapLinearFilter, Mesh, MirroredRepeatWrapping, PlaneGeometry, ShaderMaterial, SRGBColorSpace, TextureLoader, Vector2, Vector4, type Texture } from 'three'
import { LOOK } from './look'
import type { PlateDef, PlateLens } from './plates'

/** The painting as a texture. Rejects when it cannot be had: the caller builds the block room instead. */
export async function loadPlate(p: PlateDef): Promise<Texture> {
  const tex = await new TextureLoader().loadAsync(p.src)
  tex.colorSpace = SRGBColorSpace
  tex.minFilter = LinearMipmapLinearFilter
  tex.magFilter = LinearFilter
  tex.generateMipmaps = true
  return tex
}

/**
 * The painted strips a table is dressed in (`TableMaterials.paint`), by
 * address. Mirrored end to end along the band, held at its two long edges.
 * One that cannot be had is left out, and the table is dressed in none: half
 * a painted table is worse than a plain one (`vistaTable` asks for both).
 */
export async function loadStrips(addresses: readonly string[], anisotropy: number): Promise<Map<string, Texture>> {
  const out = new Map<string, Texture>()
  await Promise.all(
    addresses.map(async (src) => {
      try {
        const tex = await new TextureLoader().loadAsync(src)
        tex.colorSpace = SRGBColorSpace
        tex.wrapS = MirroredRepeatWrapping
        tex.wrapT = ClampToEdgeWrapping
        tex.minFilter = LinearMipmapLinearFilter
        tex.magFilter = LinearFilter
        tex.generateMipmaps = true
        tex.anisotropy = anisotropy
        out.set(src, tex)
      } catch (err) {
        if (import.meta.env.DEV) console.warn('strip failed, plain table', err)
      }
    }),
  )
  return out
}

const VERT = /* glsl */ `
  varying vec2 vFrame;
  void main() {
    vFrame = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 1.0, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform sampler2D tPlate;
  uniform vec2 uFrame;
  uniform vec4 uPlate;
  uniform vec3 uLens;
  uniform float uPlateF;
  uniform vec3 uFloor;
  uniform float uGain;
  uniform float uLift;
  uniform float uExposure;
  uniform float uAces;
  uniform vec3 uVeilColor;
  uniform float uVeil;
  varying vec2 vFrame;

  // The frame's tone curve, backwards (three's ACES fit: its two matrices and
  // its rational curve, each inverted). A painting is finished colour: sent
  // through the curve as if it were light, its marble came out black and its
  // lamps white. What goes into the frame is the light that the curve turns
  // back into the painting.
  const mat3 ACES_IN_INV = mat3(vec3(1.764741, -0.147028, -0.036337), vec3(-0.675778, 1.160252, -0.162436), vec3(-0.088963, -0.013224, 1.198773));
  const mat3 ACES_OUT_INV = mat3(vec3(0.643038, 0.059269, 0.005962), vec3(0.311187, 0.931436, 0.063929), vec3(0.045775, 0.009295, 0.930118));
  vec3 untone(vec3 d) {
    vec3 y = clamp(ACES_OUT_INV * clamp(d, 0.0, 0.94), 0.0, 0.94);
    vec3 a = 0.983729 * y - 1.0;
    vec3 b = 0.432951 * y - 0.0245786;
    vec3 c = 0.238081 * y + 0.000090537;
    vec3 v = (-b - sqrt(max(b * b - 4.0 * a * c, 0.0))) / (2.0 * a);
    return max(ACES_IN_INV * v, 0.0) * (0.6 / uExposure);
  }

  void main() {
    vec2 px = vec2(vFrame.x, 1.0 - vFrame.y) * uFrame;
    float s = uLens.x / uPlateF;
    vec2 uv = vec2((uPlate.z + (px.x - uLens.y) / s) / uPlate.x, (uPlate.w + (px.y - uLens.z) / s) / uPlate.y);
    // Under the foot: the floor carried on, mirrored, and going dark.
    float under = max(0.0, uv.y - 1.0);
    float ux = uv.x < 0.0 ? -uv.x : (uv.x > 1.0 ? 2.0 - uv.x : uv.x);
    vec2 at = vec2(clamp(ux, 0.0, 1.0), clamp(uv.y > 1.0 ? 2.0 - uv.y : uv.y, 0.0, 1.0));
    vec3 col = texture2D(tPlate, vec2(at.x, 1.0 - at.y)).rgb;
    col = mix(col, uFloor, smoothstep(0.0, 0.5, under));
    // The weather's air, as a veil in the sky's own low colour, thickest along
    // the horizon where the air is deepest: a painting has no depth for the
    // frame's air and mist to be laid by.
    float deep = exp(-abs(px.y - uLens.z) / (0.22 * uFrame.y));
    col = mix(col, uVeilColor, uVeil * (0.45 + 0.55 * deep));
    // A trim on the painting itself (LOOK.plate), then out through the curve
    // backwards, where the frame has that curve.
    col = pow(col, vec3(uLift)) * uGain;
    if (uAces > 0.5) col = untone(col);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** The painting, laid by its horizon and its lens under the frame's. The caller adds it and disposes of it. */
export function makePlate(tex: Texture, p: PlateDef, lens: PlateLens, w: number, h: number, exposure: number, veil: { color: number; amount: number }): Mesh {
  const material = new ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      tPlate: { value: tex },
      uFrame: { value: new Vector2(w, h) },
      uPlate: { value: new Vector4(p.w, p.h, p.cx, p.horizon) },
      uLens: { value: [lens.f, lens.px, lens.horizonY] },
      uPlateF: { value: p.f },
      uFloor: { value: new Color(p.floor) },
      uGain: { value: LOOK.plate.gain },
      uLift: { value: LOOK.plate.lift },
      uExposure: { value: exposure },
      uAces: { value: LOOK.tone.mapping === 'aces' ? 1 : 0 },
      uVeilColor: { value: new Color(veil.color) },
      uVeil: { value: veil.amount },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.renderOrder = -1000
  mesh.frustumCulled = false
  return mesh
}

/**
 * The table's shade on a painted floor: a dark ellipse lying on the ground,
 * densest under the table and gone at its rim. A block room carries it in
 * its floor's own material (`pools.ts: Shade`); a painting has no floor to
 * shade, so the shade is a sheet of its own over it.
 */
export function makePlateShade(cx: number, cz: number, rx: number, rz: number): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uDark: { value: LOOK.plate.shade } },
    vertexShader: /* glsl */ `
      varying vec2 vAt;
      void main() {
        vAt = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uDark;
      varying vec2 vAt;
      void main() {
        float d2 = dot(vAt, vAt);
        float k = 1.0 - d2 * d2;
        gl_FragColor = vec4(0.0, 0.0, 0.0, uDark * clamp(k, 0.0, 1.0));
      }
    `,
  })
  const mesh = new Mesh(new CircleGeometry(1, 64), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.scale.set(rx, rz, 1)
  mesh.position.set(cx, 0.01, cz)
  mesh.renderOrder = -900
  mesh.frustumCulled = false
  return mesh
}
