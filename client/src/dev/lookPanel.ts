/**
 * The look panel: every number in `scene/look.ts`, as sliders, in dev.
 *
 * `?look=1` on any page of the app mounts it (`entry.ts`), the showcase
 * included, so a room can be tuned live over a real board or over a still.
 * Moving a control edits `LOOK` in place and publishes the change
 * (`bumpLook`), which the backdrop answers by rendering the room again and
 * fading it in over the old one — a second or so per move, since the room is
 * built once and this is that once.
 *
 * Nothing here is persisted: the panel is the way to *find* the numbers, and
 * `look.ts` is where they live. "Copy JSON" puts the whole look on the
 * clipboard to paste into it; "Reset" puts the file's numbers back.
 *
 * Dev-only by construction: `entry.ts` imports it behind
 * `import.meta.env.DEV`, so neither this module nor lil-gui reaches a build.
 */
import GUI from 'lil-gui'
import { DEBUG_VIEWS, LOOK, SHADOW_TYPES, TONE_MAPPINGS, applyLookPatch, bumpLook, type Look, type LookPatch } from '../components/scene/look'

/** How long the last move has to hold before the room is rendered again. */
const SETTLE_MS = 180

const defaults: Look = structuredClone(LOOK)

export function mountLookPanel(): GUI {
  const gui = new GUI({ title: 'Look', width: 300 })
  let settle: ReturnType<typeof setTimeout> | null = null
  const changed = () => {
    if (settle) clearTimeout(settle)
    settle = setTimeout(() => {
      settle = null
      bumpLook()
    }, SETTLE_MS)
  }
  gui.onChange(changed)

  const hours = gui.addFolder('Hours').close()
  for (const t of ['dawn', 'day', 'dusk', 'night'] as const) {
    const h = LOOK.hours[t]
    const f = hours.addFolder(t).close()
    f.addColor(h.sky, 'top').name('sky top')
    f.addColor(h.sky, 'horizon').name('sky horizon')
    f.addColor(h.sun, 'color').name('sun colour')
    f.add(h.sun, 'intensity', 0, 8, 0.05).name('sun intensity')
    f.add(h.sun, 'elevation', 6, 85, 1).name('sun elevation °')
    f.add(h.sun, 'azimuth', -180, 180, 1).name('sun azimuth °')
    f.addColor(h.ambient, 'sky').name('sky light')
    f.addColor(h.ambient, 'ground').name('ground light')
    f.add(h.ambient, 'intensity', 0, 3, 0.05).name('sky intensity')
    f.add(h, 'windowsLit', 0, 1, 0.05).name('windows lit')
    f.add(h, 'dark', 0, 1, 0.05)
    f.add(h, 'lampsOn').name('lamps on')
  }

  const sun = gui.addFolder('Sun')
  sun.add(LOOK.sun, 'intensity', 0, 3, 0.05).name('× intensity')
  sun.add(LOOK.sun, 'elevationOffset', -30, 30, 1).name('+ elevation °')

  const ambient = gui.addFolder('Ambient')
  ambient.add(LOOK.ambient, 'intensity', 0, 3, 0.05).name('× intensity')
  ambient.add(LOOK.ambient, 'rim', 0, 1, 0.05).name('rim from behind')

  const shadow = gui.addFolder('Shadow')
  shadow.add(LOOK.shadow, 'type', SHADOW_TYPES)
  shadow.add(LOOK.shadow, 'radius', 0, 20, 0.5).name('softness')
  shadow.add(LOOK.shadow, 'blurSamples', 2, 32, 1).name('VSM taps')
  shadow.add(LOOK.shadow, 'bias', -0.005, 0.005, 0.0001)
  shadow.add(LOOK.shadow, 'normalBias', 0, 0.5, 0.01).name('normal bias')
  shadow.add(LOOK.shadow, 'spriteOpacity', 0, 1, 0.05).name('sprite shadow')

  const material = gui.addFolder('Material')
  material.add(LOOK.material, 'roughness', 0, 1, 0.01)
  material.add(LOOK.material, 'metalness', 0, 1, 0.01)
  material.add(LOOK.material, 'glowIntensity', 0, 6, 0.1).name('glow')
  material.add(LOOK.material, 'haloIntensity', 0, 2, 0.05).name('halos')
  material.add(LOOK.material, 'footShade', 0, 0.5, 0.01).name('foot shade')

  const outline = gui.addFolder('Outline')
  outline.add(LOOK.outline, 'px', 0, 4, 0.1).name('weight (CSS px)')
  outline.add(LOOK.outline, 'darken', 0, 1, 0.01)
  outline.add(LOOK.outline, 'inkMix', 0, 1, 0.01).name('towards ink')

  const ao = gui.addFolder('Occlusion')
  ao.add(LOOK.ao, 'intensity', 0, 1, 0.05)
  ao.add(LOOK.ao, 'radius', 0.2, 6, 0.1).name('radius (tiles)')
  ao.add(LOOK.ao, 'radiusSmall', 0.05, 2, 0.05).name('tight radius')
  ao.add(LOOK.ao, 'power', 0.5, 4, 0.1)
  ao.add(LOOK.ao, 'samples', 4, 32, 1)
  ao.add(LOOK.ao, 'blur', 1, 8, 1)

  const tone = gui.addFolder('Tone')
  tone.add(LOOK.tone, 'mapping', TONE_MAPPINGS)
  tone.add(LOOK.tone, 'exposure', 0.2, 3, 0.05)
  tone.add(LOOK.tone, 'nightLift', 0, 2, 0.05).name('night lift')
  tone.add(LOOK.tone, 'contrast', 0.5, 1.6, 0.01)
  tone.add(LOOK.tone, 'saturation', 0, 2, 0.01)
  tone.addColor(LOOK.tone, 'shadowTint').name('shade tint')
  tone.addColor(LOOK.tone, 'highlightTint').name('light tint')
  tone.add(LOOK.tone, 'splitStrength', 0, 0.6, 0.01).name('split strength')

  const post = gui.addFolder('Post')
  post.add(LOOK.post, 'bloomThreshold', 0, 2, 0.05).name('bloom threshold')
  post.add(LOOK.post, 'bloomStrength', 0, 1.5, 0.05).name('bloom (noon)')
  post.add(LOOK.post, 'bloomDark', 0, 1.5, 0.05).name('bloom (+ at night)')
  post.add(LOOK.post, 'dofBand', 0.5, 4, 0.1).name('focus band')
  post.add(LOOK.post, 'dofEase', 0.05, 1, 0.01).name('focus ease')
  post.add(LOOK.post, 'dofMax', 0, 1, 0.05).name('blur max')
  post.add(LOOK.post, 'grain', 0, 0.1, 0.002)
  post.add(LOOK.post, 'aberration', 0, 6, 0.1).name('fringe')
  post.add(LOOK.fog, 'strength', 0, 2, 0.05).name('fog')

  gui.add(LOOK, 'debug', DEBUG_VIEWS).name('show')

  const actions = {
    copy: () => {
      const json = JSON.stringify(LOOK, (_, v) => (typeof v === 'number' && !Number.isInteger(v) ? Number(v.toFixed(4)) : v), 2)
      void navigator.clipboard?.writeText(json)
      console.info('look:\n' + json)
    },
    reset: () => {
      applyLookPatch(structuredClone(defaults) as LookPatch)
      gui.controllersRecursive().forEach((c) => c.updateDisplay())
    },
  }
  gui.add(actions, 'copy').name('Copy JSON')
  gui.add(actions, 'reset').name('Reset')
  return gui
}
