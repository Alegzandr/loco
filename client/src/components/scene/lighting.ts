/**
 * The lights of a room, as three.js objects, from the rig's numbers.
 *
 * A sun (`DirectionalLight`, the one shadow in the scene), a sky
 * (`HemisphereLight`, the cool fill in the shade and the ground's bounce) and
 * a rim (a second, dimmer, cooler sun from behind, no shadow: the sky's light
 * on the wall the sun never reaches, so a far façade is a colour rather than
 * a silhouette). Every number they carry is the rig's through `shade.ts`, and
 * the rig's is the look's (`look.ts`): nothing here is a constant.
 *
 * The shadow is one orthographic map fitted to what is on screen
 * (`fitShadow`). Its texel budget is the tier's (`quality.ts`); the extents
 * are exact for what can be seen — a caster only shadows a receiver on its
 * own ray, so the map's x/y is the receivers' region in light space and only
 * its depth range has to reach every caster — which is what keeps a 4096 map
 * over eighty tiles at roughly fifty texels a tile.
 */
import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  NeutralToneMapping,
  NoToneMapping,
  BackSide,
  Mesh,
  PCFShadowMap,
  PMREMGenerator,
  SpotLight,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type Texture,
  type ToneMapping as ThreeToneMapping,
  type WebGLRenderer,
} from 'three'
import type { LightRig } from './sky'
import { lightingFor, skyDome, type Lighting } from './shade'
import { LOOK, type ToneMapping } from './look'
import type { RenderQuality } from './quality'

/** How far the sun sits from the origin: past anything a room builds. */
const SUN_DIST = 400
/** The tallest thing a room builds, tiles, for the shadow map's fit. */
const ROOM_HEIGHT = 28

export interface Lights {
  group: Group
  sun: DirectionalLight
  sky: HemisphereLight
  rim: DirectionalLight | null
  lighting: Lighting
  /**
   * Fits the sun's shadow map to a world-space box of receivers: everything
   * that box holds is shadowed exactly, and every caster along the sun's rays
   * to it is counted, wherever it stands.
   */
  fitShadow(box: Box3): void
  dispose(): void
}

export function toneMappingFor(mapping: ToneMapping): ThreeToneMapping {
  switch (mapping) {
    case 'aces':
      return ACESFilmicToneMapping
    case 'agx':
      return AgXToneMapping
    case 'neutral':
      return NeutralToneMapping
    case 'none':
      return NoToneMapping
  }
}

/**
 * The renderer's shadow settings, once per context. The map is rendered on
 * demand (`needsUpdate`) rather than on every `render()`: the depth pass and
 * every sprite would otherwise render the whole room into the map again.
 */
export function configureShadows(renderer: WebGLRenderer): void {
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFShadowMap
  renderer.shadowMap.autoUpdate = false
}

const _x = new Vector3()
const _y = new Vector3()
const _z = new Vector3()
const _p = new Vector3()

export function makeLights(rig: LightRig, q: RenderQuality): Lights {
  const lighting = lightingFor(rig)
  const group = new Group()

  const sun = new DirectionalLight(new Color(lighting.sun.color), lighting.sun.intensity)
  const [dx, dy, dz] = lighting.sun.direction
  sun.position.set(dx * SUN_DIST, dy * SUN_DIST, dz * SUN_DIST)
  sun.target.position.set(0, 0, 0)
  sun.castShadow = true
  sun.shadow.mapSize.set(q.shadowMap, q.shadowMap)
  sun.shadow.radius = lighting.shadowRadius * (q.shadowMap / 4096)
  sun.shadow.bias = LOOK.shadow.bias
  sun.shadow.normalBias = LOOK.shadow.normalBias
  // Under an overcast the sun is dimmer already (the rig scales it); what is
  // left of its shadow is the difference between it and the fill.
  group.add(sun, sun.target)

  const sky = new HemisphereLight(new Color(lighting.sky.sky), new Color(lighting.sky.ground), lighting.sky.intensity)
  group.add(sky)

  let rim: DirectionalLight | null = null
  if (lighting.rim) {
    rim = new DirectionalLight(new Color(lighting.rim.color), lighting.rim.intensity)
    const [rx, ry, rz] = lighting.rim.direction
    rim.position.set(rx * SUN_DIST, ry * SUN_DIST, rz * SUN_DIST)
    rim.target.position.set(0, 0, 0)
    group.add(rim, rim.target)
  }

  const fitShadow = (box: Box3) => {
    // Light space: z towards the sun, x across, y up-ish — the frame three's
    // own `lookAt` gives the shadow camera, so the extents land in it.
    _z.set(dx, dy, dz).normalize()
    _x.set(0, 1, 0).cross(_z).normalize()
    _y.copy(_z).cross(_x)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      _p.set(x, y, z)
      const lx = _p.dot(_x), ly = _p.dot(_y), lz = _p.dot(_z)
      minX = Math.min(minX, lx); maxX = Math.max(maxX, lx)
      minY = Math.min(minY, ly); maxY = Math.max(maxY, ly)
      minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz)
    }
    const pad = 1
    const cam = sun.shadow.camera
    cam.left = minX - pad
    cam.right = maxX + pad
    cam.bottom = minY - pad
    cam.top = maxY + pad
    // Casters between the sun and the box: anything up to the sun itself.
    cam.near = 1
    cam.far = SUN_DIST - minZ + ROOM_HEIGHT * 2
    cam.updateProjectionMatrix()
  }

  return {
    group,
    sun,
    sky,
    rim,
    lighting,
    fitShadow,
    dispose() {
      sun.shadow.dispose()
      sun.dispose()
      sky.dispose()
      rim?.dispose()
    },
  }
}

/**
 * The lamp over the table (`LOOK.table.lamp`): a warm cone straight down onto
 * the cloth from above its middle, the one light in the room that is the
 * table's. No shadow — the sun's is the one map — and the corner where the
 * rail meets the cloth is the occlusion's.
 */
export function makeTableLamp(rig: LightRig, centre: [number, number, number]): SpotLight {
  const l = LOOK.table.lamp
  const lamp = new SpotLight(new Color(l.color), l.day + (l.night - l.day) * rig.dark, 0, (l.angle * Math.PI) / 180, l.penumbra, 0)
  lamp.position.set(centre[0], centre[1] + l.height, centre[2])
  lamp.target.position.set(centre[0], centre[1], centre[2])
  lamp.castShadow = false
  return lamp
}

/**
 * The sky as an environment, for what is glossy to mirror: the rig's gradient
 * from the horizon up to the zenith, the ground's own bounce below it, filtered
 * once (`PMREMGenerator`) so a rough surface sees a soft sky and a smooth one a
 * sharp one. Only the reflection is taken from it (`kit.ts: litMaterial`) — the
 * diffuse sky is the hemisphere's.
 *
 * Null where it cannot be had (a GPU with no float targets filters it into
 * nothing): the glossy surfaces are then only shinier under the sun, which is
 * a room, not a failure. The caller disposes of it with the context.
 */
export function skyEnvironment(renderer: WebGLRenderer, rig: LightRig): Texture | null {
  const dome = skyDome(rig)
  const scene = new Scene()
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new Color(dome.top) },
      uHorizon: { value: new Color(dome.horizon) },
      uGround: { value: new Color(dome.ground) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      varying vec3 vDir;
      void main() {
        float y = vDir.y;
        vec3 c = y >= 0.0 ? mix(uHorizon, uTop, pow(y, 0.55)) : mix(uHorizon, uGround, smoothstep(0.0, 0.25, -y));
        gl_FragColor = vec4(c, 1.0);
      }`,
  })
  const sphere = new Mesh(new SphereGeometry(10, 32, 16), material)
  scene.add(sphere)
  const pmrem = new PMREMGenerator(renderer)
  try {
    return pmrem.fromScene(scene, 0).texture
  } catch {
    return null
  } finally {
    pmrem.dispose()
    sphere.geometry.dispose()
    material.dispose()
  }
}
