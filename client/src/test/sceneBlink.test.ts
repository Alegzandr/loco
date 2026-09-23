/**
 * The evening goes on behind the table: a few dark windows are lit and put
 * out during a match, and a neon tube stutters now and then (`Actor.blink`,
 * `maps/actors.ts: blinkActors`). What these pin: only dark windows after dark
 * are candidates, only what the camera can see is picked and never more than
 * the caps, the keyframes are a valid, quiet cycle that rests at nothing, and
 * reduced motion shows none of it — the room as it was rendered.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Kit } from '../components/scene/kit'
import { lightRig } from '../components/scene/sky'
import { seededRng } from '../components/scene/rng'
import { blinkKeyframes, pointHidden, type DepthMap } from '../components/scene/life'
import { BLINK_NEON, BLINK_WINDOWS, blinkActors } from '../components/scene/maps/actors'

function roomKit(time: 'day' | 'night') {
  return new Kit({ rig: lightRig(time, 'clear'), rng: seededRng('blink'), outline: 0.02, anchor: { sx: 0, sy: 0, a: 10, b: 5 }, frame: { w: 80, h: 45 } })
}

describe('what comes and goes', () => {
  it('only after dark, and only from windows that are dark', () => {
    const day = roomKit('day')
    day.tower(0, 0, 4, 8, 4, 0xccbbaa)
    expect(day.blinkers).toHaveLength(0)
    const night = roomKit('night')
    night.tower(0, 0, 4, 8, 4, 0xccbbaa)
    expect(night.blinkers.length).toBeGreaterThan(0)
    expect(night.blinkers.every((b) => b.kind === 'window')).toBe(true)
  })

  it('picks only what the camera can see, and never more than the caps', () => {
    const k = roomKit('night')
    for (let i = 0; i < 6; i++) k.tower(i * 6, 0, 4, 8, 4, 0xccbbaa)
    for (let i = 0; i < 6; i++) k.flicker(i * 5, 3, 8, 1, 2, 0.1, 0x333344)
    expect(blinkActors(k, () => false, seededRng('x'))).toHaveLength(0)
    const all = blinkActors(k, () => true, seededRng('x'))
    expect(all.filter((a) => a.id.startsWith('blink-window'))).toHaveLength(BLINK_WINDOWS)
    expect(all.filter((a) => a.id.startsWith('blink-neon'))).toHaveLength(BLINK_NEON)
    for (const a of all) {
      expect(a.flying).toBe(true)
      expect(a.minLen).toBe(0)
      expect(a.path).toHaveLength(1)
    }
  })

  it('is seeded on the room: every seat has the same street', () => {
    const k = roomKit('night')
    for (let i = 0; i < 6; i++) k.tower(i * 6, 0, 4, 8, 4, 0xccbbaa)
    const a = blinkActors(k, () => true, seededRng('room'))
    const b = blinkActors(k, () => true, seededRng('room'))
    expect(a.map((x) => [x.path[0], x.blink])).toEqual(b.map((x) => [x.path[0], x.blink]))
  })

  it('cycles once per period, rests at nothing, and never runs backwards', () => {
    for (const blink of [
      { period: 60_000, on: [0.2, 0.6] as [number, number], fade: 900 },
      { period: 30_000, on: [0.7, 0.78] as [number, number], flicker: true },
    ]) {
      const f = blinkKeyframes(blink)
      expect(f[0]).toEqual({ offset: 0, opacity: 0 })
      expect(f[f.length - 1]).toEqual({ offset: 1, opacity: 0 })
      for (let i = 1; i < f.length; i++) expect(f[i].offset).toBeGreaterThanOrEqual(f[i - 1].offset)
      expect(Math.max(...f.map((x) => x.opacity))).toBe(1)
    }
  })

  it('shows nothing under reduced motion: the room as it was rendered', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'components', 'scene', 'LifeLayer.svelte'), 'utf8')
    expect(src).toMatch(/face\.style\.opacity = actor\.blink \? '0' : ''/)
  })
})

describe('a point hidden behind the room', () => {
  const map = (value: number): DepthMap => ({ data: new Float32Array(100 * 100).fill(value), w: 100, h: 100, scale: 1, fw: 100, fh: 100, ppu: 2, origin: 0.5, perTile: 0.01 })

  it('is hidden when the room stands nearer, and seen when it does not', () => {
    expect(pointHidden(map(0), [0, 0], 1)).toBe(true)
    expect(pointHidden(map(1), [0, 0], 1)).toBe(false)
  })

  it('is hidden off the map: what nobody can see is not picked', () => {
    expect(pointHidden(map(1), [200, 0], 1)).toBe(true)
  })
})
