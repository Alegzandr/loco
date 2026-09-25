/**
 * The sky of a room seen from the table: a dome round the camera, drawn by
 * one shader.
 *
 * A room photographed from above had no sky, only a gradient painted behind
 * the render in CSS. Seen from the table the sky is a third of what makes the
 * picture: the gradient climbing from the horizon, the body the light comes
 * from, standing in the frame with the glow round it, the clouds lit from the
 * side it is on, and after dark the stars. It is a mesh in the scene rather
 * than a pass over the frame because the water has to reflect it — the sun's
 * road across the bay is the dome, mirrored (`mirror.ts`) — and because the
 * bloom has to see the sun's disc to spill it.
 *
 * It writes no depth and is drawn first, so the finishing passes read the sky
 * as "nothing here" (a depth of 1) and leave it out of the occlusion and the
 * haze. Every number is the look's (`LOOK.vista.sky`) or the rig's.
 */
import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three'
import type { LightRig } from './sky'
import { mix } from './sky'
import { skyDome } from './shade'
import { LOOK } from './look'

const deg = (d: number) => (d * Math.PI) / 180

/** Towards a point of the sky at an azimuth and an elevation, the sun's convention. */
export function skyDirection(azimuth: number, elevation: number): Vector3 {
  const az = deg(azimuth)
  const el = deg(elevation)
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el))
}

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform float uCurve;
  uniform vec3 uBodyDir;
  uniform vec3 uBodyColor;
  uniform float uBodySize;
  uniform float uBodyGlow;
  uniform float uBodyOn;
  uniform float uMoon;
  uniform float uHalo;
  uniform float uHaloSize;
  uniform float uAureole;
  uniform vec3 uLightDir;
  uniform vec3 uLightColor;
  uniform float uCloud;
  uniform float uCloudScale;
  uniform vec3 uCloudShade;
  uniform float uStars;
  uniform float uSeed;
  uniform float uPlanetOn;
  uniform vec3 uPlanetDir;
  uniform float uPlanetSize;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * vnoise(p);
      p = mat2(1.6, 1.2, -1.2, 1.6) * p + vec2(7.3, 2.1);
      a *= 0.5;
    }
    return v / 0.97;
  }

  void main() {
    vec3 d = normalize(vDir);
    float up = d.y;
    // The gradient: pale at the horizon, the hour's own colour overhead, and
    // below the horizon (which only the water's mirror of it ever shows past
    // the sea's edge) the horizon going down into the ground's.
    vec3 col = up >= 0.0 ? mix(uHorizon, uTop, pow(up, uCurve)) : mix(uHorizon, uGround, smoothstep(0.0, 0.3, -up));

    // The light's side of the sky is brighter and warmer, widest at the
    // horizon: the aureole a low sun spreads.
    float toLight = max(dot(d, uLightDir), 0.0);
    col += uLightColor * uAureole * pow(toLight, 12.0) * exp(-max(up, 0.0) * 6.0);

    // The body and its halo.
    float cosB = dot(d, uBodyDir);
    float ang = degrees(acos(clamp(cosB, -1.0, 1.0)));
    if (uBodyOn > 0.0) {
      col += uBodyColor * uHalo * exp(-ang / uHaloSize) * uBodyOn;
      col += uBodyColor * uHalo * 0.1 * exp(-ang / (uHaloSize * 3.0)) * uBodyOn;
    }

    // Stars, thinned towards the horizon where the air drowns them.
    if (uStars > 0.0 && up > 0.0) {
      vec2 g = vec2(atan(d.x, -d.z), asin(up)) * 260.0;
      vec2 id = floor(g);
      float h = hash(id + uSeed);
      vec2 f = fract(g) - 0.5;
      float star = step(0.985, h) * (1.0 - smoothstep(0.05, 0.22, length(f))) * (h - 0.985) / 0.015;
      col += vec3(0.8, 0.86, 1.0) * star * uStars * 1.6 * smoothstep(0.02, 0.25, up);
    }

    // The clouds: a layer overhead seen in perspective, thin near the
    // horizon, lit on the side the light is on and warmest where it is
    // nearest. Drawn over the stars and under nothing.
    if (uCloud > 0.0 && up > 0.0) {
      // Softened towards the horizon: a hard floor on the divisor leaves the
      // noise varying with the azimuth alone there, in vertical bars.
      vec2 p = d.xz / (up + 0.05) * uCloudScale * 12.0;
      p.x *= 0.45;
      float n = fbm(p + uSeed);
      float cover = smoothstep(1.0 - uCloud, 1.0 - uCloud + 0.28, n);
      cover *= smoothstep(0.01, 0.05, up);
      // Lit from the light's side: the edge towards it catches, the rest is the sky's own shade.
      float lit = 0.35 + 0.65 * pow(toLight, 2.0);
      float edge = smoothstep(0.0, 0.5, cover) * (1.0 - smoothstep(0.5, 1.0, cover));
      vec3 cloud = mix(uCloudShade, mix(uHorizon, uLightColor, 0.55), lit * 0.8);
      cloud += uLightColor * edge * pow(toLight, 8.0) * 2.5;
      col = mix(col, cloud, cover * 0.92);
    }

    // A planet in a sky with no air: oceans, land and weather, lit on the
    // side the sun is, with the blue of its own air round its rim.
    if (uPlanetOn > 0.0) {
      float pa = acos(clamp(dot(d, uPlanetDir), -1.0, 1.0));
      float pr = radians(uPlanetSize);
      vec3 T = normalize(cross(uPlanetDir, vec3(0.0, 1.0, 0.0)));
      vec3 B = cross(T, uPlanetDir);
      vec3 off = d - uPlanetDir * dot(d, uPlanetDir);
      vec2 q = vec2(dot(off, T), dot(off, B)) / sin(pr);
      float r2 = dot(q, q);
      if (r2 < 1.0) {
        vec3 n = normalize(T * q.x + B * q.y - uPlanetDir * sqrt(1.0 - r2));
        float lambert = clamp(dot(n, uSunDir) * 1.2 + 0.08, 0.0, 1.0);
        vec2 uvp = q * 2.2 + vec2(1.7, 0.4);
        float land = smoothstep(0.52, 0.58, fbm(uvp * 1.3));
        float cloudP = smoothstep(0.55, 0.75, fbm(uvp * 2.1 + 9.0));
        vec3 surface = mix(vec3(0.05, 0.22, 0.55), mix(vec3(0.18, 0.42, 0.18), vec3(0.55, 0.45, 0.3), fbm(uvp * 3.0)), land);
        surface = mix(surface, vec3(0.95), cloudP * 0.85);
        vec3 pcol = surface * lambert * 1.6;
        pcol += vec3(0.25, 0.5, 1.0) * pow(r2, 3.0) * 0.8 * (0.3 + lambert);
        float edge = 1.0 - smoothstep(0.96, 1.0, r2);
        col = mix(col, pcol, edge * uPlanetOn);
      }
      col += vec3(0.2, 0.45, 1.0) * 0.35 * exp(-max(0.0, pa - pr) / radians(uPlanetSize * 0.12)) * step(pr, pa) * uPlanetOn;
    }

    // The body is drawn last, over the cloud's thin edge but dimmed by its body.
    if (uBodyOn > 0.0) {
      float disc = 1.0 - smoothstep(uBodySize - 0.12, uBodySize + 0.12, ang);
      vec3 bodyCol = uBodyColor * uBodyGlow;
      if (uMoon > 0.5) {
        // The moon: pale, a few seas on it, no glare of its own.
        vec2 q = vec2(atan(d.x, -d.z), asin(up)) * 90.0;
        float seas = fbm(q * 0.6 + 3.0);
        bodyCol = mix(vec3(0.95, 0.96, 1.0), vec3(0.72, 0.76, 0.86), smoothstep(0.45, 0.7, seas)) * uBodyGlow * 0.2;
      }
      col = mix(col, bodyCol, disc * uBodyOn);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** The dome, radius `r` round the camera at `eye`. The caller adds it to the scene and disposes of it with the room. */
export function makeDome(rig: LightRig, eye: Vector3, r: number, seed: number): Mesh {
  const dome = skyDome(rig)
  const sky = LOOK.vista.sky
  const body = rig.body
  const bodyDir = body ? skyDirection(body.azimuth, body.elevation) : new Vector3(0, 1, 0)
  const lightDir = skyDirection(rig.sun.azimuth, rig.sun.elevation)
  // The sun is its own colour, whitened at its heart; the moon a cool white.
  const bodyHex = body?.kind === 'moon' ? 0xc9d6ff : mix(rig.sun.color, 0xfff4d6, 0.2)
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uTop: { value: new Color(dome.top) },
      uHorizon: { value: new Color(dome.horizon) },
      uGround: { value: new Color(dome.ground) },
      uCurve: { value: sky.curve },
      uBodyDir: { value: bodyDir },
      uBodyColor: { value: new Color(bodyHex) },
      uBodySize: { value: body?.size ?? 0 },
      uBodyGlow: { value: sky.bodyGlow },
      uBodyOn: { value: body ? body.visibility : 0 },
      uMoon: { value: body?.kind === 'moon' ? 1 : 0 },
      uHalo: { value: sky.halo * (body?.kind === 'moon' ? 0.35 : 1) },
      uHaloSize: { value: sky.haloSize },
      uAureole: { value: sky.aureole * (1 - rig.dark * 0.6) * (rig.sun.elevation < 20 ? 1 : 0.3) },
      uLightDir: { value: lightDir },
      uLightColor: { value: new Color(rig.sun.color) },
      uCloud: { value: rig.cloud },
      uCloudScale: { value: sky.cloudScale },
      uCloudShade: { value: new Color(mix(dome.top, dome.horizon, 0.45)).multiplyScalar(0.8) },
      uStars: { value: rig.stars },
      uSeed: { value: seed % 97 },
      uPlanetOn: { value: rig.space ? 1 : 0 },
      uPlanetDir: { value: rig.space ? skyDirection(rig.space.planet.azimuth, rig.space.planet.elevation) : new Vector3(0, 1, 0) },
      uPlanetSize: { value: rig.space?.planet.size ?? 1 },
      // The planet is lit by the sun, which is not the room's key light on a moon's night.
      uSunDir: { value: rig.space ? skyDirection(rig.space.planet.lit.azimuth, rig.space.planet.lit.elevation) : lightDir },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  })
  const mesh = new Mesh(new SphereGeometry(r, 64, 32), material)
  mesh.position.copy(eye)
  mesh.renderOrder = -1000
  mesh.frustumCulled = false
  return mesh
}
