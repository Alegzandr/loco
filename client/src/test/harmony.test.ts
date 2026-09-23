import { describe, expect, it } from 'vitest'
import {
  BLEND_MAX_KEY_STEPS,
  BLEND_MAX_TEMPO_GAP,
  CUT_COST,
  cueShiftFor,
  followCost,
  handoverFor,
  KEY_NAMES,
  keyDistance,
  parseKey,
  tempoGap,
} from '../audio/harmony'

describe('the key wheel', () => {
  it('reads a key name as a tonic and a mode', () => {
    expect(parseKey('C')).toEqual({ tonic: 0, minor: false })
    expect(parseKey('Cm')).toEqual({ tonic: 0, minor: true })
    expect(parseKey('F#m')).toEqual({ tonic: 6, minor: true })
    expect(parseKey('Bb')).toEqual({ tonic: 10, minor: false })
    for (const k of KEY_NAMES) expect(parseKey(k).tonic, k).toBeGreaterThanOrEqual(0)
  })

  it('measures what a DJ key wheel measures', () => {
    expect(keyDistance('Cm', 'Cm')).toBe(0)
    // Neighbours on the circle, and the relative: one step.
    expect(keyDistance('Cm', 'Gm')).toBe(1)
    expect(keyDistance('Cm', 'Fm')).toBe(1)
    expect(keyDistance('Cm', 'Eb')).toBe(1)
    // One chord in common: two.
    expect(keyDistance('Cm', 'Bb')).toBe(2)
    expect(keyDistance('Gm', 'Fm')).toBe(2)
    // The pair the lounge used to crossfade: A major under C minor.
    expect(keyDistance('A', 'Cm')).toBe(7)
    // Symmetric, and never more than half the wheel plus the mode.
    for (const a of KEY_NAMES) {
      for (const b of KEY_NAMES) {
        expect(keyDistance(a, b)).toBe(keyDistance(b, a))
        expect(keyDistance(a, b)).toBeLessThanOrEqual(7)
      }
    }
  })

  it('counts a tempo and its double as one pulse', () => {
    expect(tempoGap(85, 85)).toBe(0)
    expect(tempoGap(85, 170)).toBe(0)
    expect(tempoGap(120, 115)).toBeCloseTo(0.0435, 3)
    expect(tempoGap(0, 85)).toBe(Infinity)
  })
})

describe('how two loops meet', () => {
  it('overlaps only a pair that agrees in key and in tempo', () => {
    expect(handoverFor({ key: 'Gm', bpm: 85 }, { key: 'Fm', bpm: 85 })).toBe('blend')
    expect(handoverFor({ key: 'Gm', bpm: 85 }, { key: 'Cm', bpm: 90 })).toBe('cut')
    expect(handoverFor({ key: 'A', bpm: 88 }, { key: 'Cm', bpm: 88 })).toBe('cut')
    expect(BLEND_MAX_KEY_STEPS).toBeLessThanOrEqual(2)
    // Over the longest table crossfade (4 s) the drift must stay under a
    // quarter of a beat at the registry's fastest tempo.
    expect(BLEND_MAX_TEMPO_GAP * 4 * (130 / 60)).toBeLessThan(0.3)
  })

  it('ranks every pair that can be overlapped before every pair that cannot', () => {
    const from = { key: 'Gm' as const, bpm: 85 }
    const blend = followCost(from, { key: 'Fm', bpm: 85 })
    const nearCut = followCost(from, { key: 'Gm', bpm: 100 })
    expect(blend).toBeLessThan(nearCut)
    expect(CUT_COST).toBeGreaterThan(7 + 1)
    // Inside a group, the nearer key first.
    expect(followCost(from, { key: 'Cm', bpm: 110 })).toBeLessThan(followCost(from, { key: 'A', bpm: 110 }))
  })
})

describe('the effects in the bed\'s key', () => {
  it('leaves the cues where they were written without a bed', () => {
    expect(cueShiftFor(null)).toBe(0)
    expect(cueShiftFor('C')).toBe(0)
    expect(cueShiftFor('Am')).toBe(0)
  })

  it('never moves a cue more than three semitones, so it is still the cue', () => {
    for (const k of KEY_NAMES) expect(Math.abs(cueShiftFor(k)), k).toBeLessThanOrEqual(3)
  })

  it('puts C on the home chord of the bed or on one next to it', () => {
    for (const k of KEY_NAMES) {
      const { tonic, minor } = parseKey(k)
      const home = minor ? (tonic + 3) % 12 : tonic
      const lands = (((0 + cueShiftFor(k)) % 12) + 12) % 12
      expect([home, (home + 7) % 12, (home + 5) % 12], k).toContain(lands)
    }
  })
})
