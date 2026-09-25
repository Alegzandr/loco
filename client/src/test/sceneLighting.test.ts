/**
 * The room is lit, not drawn: a warm sun, a cool sky in the shade, a long soft
 * shadow beside every block. What these pin is the shape of that light as
 * numbers (`scene/shade.ts`, `scene/look.ts`) — the sun warmer than the sky at
 * every daylight hour, and placed for a camera standing at the table looking
 * out (`view.ts`): at the two ends of the day low and ahead of it, so the
 * room is lit from behind and the long shadows come towards the table; at
 * noon high and to the side, out of the frame. A rig that
 * drifts still renders a room, only a flat or a silhouetted one, and nothing
 * errors.
 */
import { describe, it, expect } from 'vitest'
import { lightRig } from '../components/scene/sky'
import { lightingFor, sunDirection, warmth } from '../components/scene/shade'
import { LOOK, WINDOWS_LIT_MAX, applyLookPatch, bumpLook, lookVersion, subscribeLook } from '../components/scene/look'

const HOURS = ['dawn', 'day', 'dusk', 'night'] as const

describe('the sun and the sky', () => {
  it('keep the warm/cool split: the sun warmer than the sky light, at every daylight hour', () => {
    for (const time of ['dawn', 'day', 'dusk'] as const) {
      const l = lightingFor(lightRig(time, 'clear'))
      expect(warmth(l.sun.color), time).toBeGreaterThan(warmth(l.sky.sky))
      // And the sky is on the cool side of neutral.
      expect(warmth(l.sky.sky), time).toBeLessThan(0)
    }
  })

  it("keep the warm/cool split in every room too: a room's own light moves the hour, never undoes it", () => {
    for (const room of Object.keys(LOOK.rooms)) {
      for (const time of ['dawn', 'day', 'dusk'] as const) {
        const l = lightingFor(lightRig(time, 'clear', room))
        expect(warmth(l.sun.color), `${room} ${time}`).toBeGreaterThan(warmth(l.sky.sky))
        expect(warmth(l.sky.sky), `${room} ${time}`).toBeLessThan(0)
      }
      // And the grade still pulls the shade cool and the light warm.
      const g = lightRig('day', 'clear', room).grade
      expect(warmth(g.highlightTint), room).toBeGreaterThan(warmth(g.shadowTint))
    }
  })

  it("give every room a light of its own, and leave a room with none the look's", () => {
    const plain = lightRig('day', 'clear')
    expect(plain.grade.splitStrength).toBe(LOOK.tone.splitStrength)
    expect(plain.shadowSoftness).toBe(1)
    const moon = lightRig('day', 'clear', 'orbit')
    expect(moon.shadowSoftness).toBeLessThan(1)
    expect(moon.ambient.intensity).toBeLessThan(plain.ambient.intensity)
  })

  it('sit low at dawn and dusk and higher at noon, and never under the horizon', () => {
    const el = (t: (typeof HOURS)[number]) => lightRig(t, 'clear').sun.elevation
    expect(el('dawn')).toBeLessThan(el('day'))
    expect(el('dusk')).toBeLessThan(el('day'))
    for (const t of HOURS) {
      expect(el(t), t).toBeGreaterThanOrEqual(3)
      expect(el(t), t).toBeLessThanOrEqual(60)
    }
  })

  it('light the room from behind at the two ends of the day, so the long shadows come towards the table', () => {
    // The camera looks towards -z. A sun ahead of it (dz < 0) casts every
    // shadow towards the viewer, which is what a low sun in the frame does.
    for (const t of ['dawn', 'dusk'] as const) {
      const [, , dz] = sunDirection(lightRig(t, 'clear'))
      expect(dz, t).toBeLessThan(-0.5)
    }
  })

  it('light the room from the side at noon, high, its sun out of the frame', () => {
    // From the side, not from behind the camera: a noon lit from the front is
    // a room with no shadow anybody can see.
    const rig = lightRig('day', 'clear')
    const [dx] = sunDirection(rig)
    expect(Math.abs(dx)).toBeGreaterThan(0.4)
    expect(rig.sun.elevation).toBeGreaterThan(30)
    expect(rig.body).toBeNull()
  })

  it('dim under an overcast and keep the sun the brighter light', () => {
    for (const t of HOURS) {
      const clear = lightingFor(lightRig(t, 'clear'))
      const storm = lightingFor(lightRig(t, 'storm'))
      expect(storm.sun.intensity, t).toBeLessThan(clear.sun.intensity)
      expect(storm.shadowStrength, t).toBeLessThan(clear.shadowStrength)
      expect(clear.sun.intensity, t).toBeGreaterThan(clear.sky.intensity)
    }
  })

  it('lift the exposure with the dark, so a stormy night is still a room', () => {
    expect(lightingFor(lightRig('night', 'storm')).exposure).toBeGreaterThan(lightingFor(lightRig('day', 'clear')).exposure)
  })

  it('soften the shadow as the sun drops', () => {
    expect(lightingFor(lightRig('dusk', 'clear')).shadowRadius).toBeGreaterThan(lightingFor(lightRig('day', 'clear')).shadowRadius)
  })

  it('carry a rim from opposite the sun, cool, dim and without a shadow', () => {
    const l = lightingFor(lightRig('day', 'clear'))
    expect(l.rim).not.toBeNull()
    expect(l.rim!.direction[0] * l.sun.direction[0] + l.rim!.direction[2] * l.sun.direction[2]).toBeLessThan(0)
    expect(l.rim!.intensity).toBeLessThan(l.sun.intensity * 0.5)
    expect(warmth(l.rim!.color)).toBeLessThan(warmth(l.sun.color))
  })
})

describe('the windows after dark', () => {
  it('are mostly dark, at every hour: a district four fifths lit is a wall of light', () => {
    // What made the lit ones read, and what let the eye rest between them.
    expect(WINDOWS_LIT_MAX).toBeLessThanOrEqual(0.5)
    for (const t of HOURS) expect(LOOK.hours[t].windowsLit, t).toBeLessThanOrEqual(WINDOWS_LIT_MAX)
    // Still lit at all after dark, or the rule is free.
    expect(LOOK.hours.night.windowsLit).toBeGreaterThan(0)
  })

  it('stay under the cap whatever the weather does to the hour', () => {
    // A storm used to light three windows in four; the hours alone were checked.
    for (const t of HOURS) for (const w of ['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'] as const) expect(lightRig(t, w).windowsLit, `${t}/${w}`).toBeLessThanOrEqual(WINDOWS_LIT_MAX)
  })
})

describe('the hour under the weather', () => {
  it('still reads: a storm at noon is lighter than a storm at midnight', () => {
    // At +0.4 a storm made noon read as dusk and orbit's day as its night.
    for (const w of ['storm', 'rain', 'fog'] as const) {
      expect(lightRig('day', w).dark, w).toBeLessThanOrEqual(0.3)
      expect(lightRig('day', w).dark, w).toBeLessThan(lightRig('night', w).dark - 0.5)
    }
  })

  it('a snowy night stays a night: its sky and its ground light stay dark', () => {
    const lum = (c: number) => 0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)
    const night = lightRig('night', 'snow')
    const day = lightRig('day', 'snow')
    expect(night.dark).toBeGreaterThan(0.8)
    expect(lum(night.sky.horizon)).toBeLessThan(lum(day.sky.horizon) * 0.6)
    expect(lum(night.ambient.ground)).toBeLessThan(lum(day.ambient.ground) * 0.6)
  })
})

describe('the look', () => {
  it('ships with every debug view off', () => {
    expect(LOOK.debug).toBe('off')
  })

  it('keeps the occlusion, the shadow and the tone curve on', () => {
    expect(LOOK.ao.intensity).toBeGreaterThan(0)
    expect(LOOK.shadow.radius).toBeGreaterThan(0)
    expect(LOOK.tone.mapping).not.toBe('none')
  })

  it('publishes an edition on every change, and the rig reads the change', () => {
    const before = lookVersion()
    let heard = 0
    const off = subscribeLook(() => heard++)
    const day = LOOK.hours.day.sun.intensity
    applyLookPatch({ sun: { intensity: 2 } })
    expect(lookVersion()).toBe(before + 1)
    expect(heard).toBe(1)
    expect(lightRig('day', 'clear').sun.intensity).toBeCloseTo(day * 2)
    applyLookPatch({ sun: { intensity: 1 } })
    bumpLook()
    expect(lookVersion()).toBe(before + 3)
    off()
  })
})
