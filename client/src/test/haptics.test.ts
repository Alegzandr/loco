import { describe, it, expect } from 'vitest'
import { hapticsFor, hapticsSupported } from '../hooks/haptics'
import { humanVariation, HUMAN_CENTS, HUMAN_GAIN_FLOOR } from '../audio/sfx'

// The phone answers the same list the speakers do: one pattern per moment, the
// strongest cue's, never a chain.
describe('hapticsFor', () => {
  it('is silent for a transition with no cue that buzzes', () => {
    expect(hapticsFor([])).toBeNull()
    expect(hapticsFor(['playerJoin'])).toBeNull()
  })

  it('answers a card with a tick', () => {
    expect(hapticsFor(['cardPlay'])).toBe(12)
  })

  it('lets the loudest moment win over the card under it', () => {
    expect(hapticsFor(['interrupt', 'cardPlay'])).toBe(45)
    expect(hapticsFor(['cardPlay', 'unoCaught'])).toEqual([40, 40, 70])
  })
})

// Chrome on a desktop has `navigator.vibrate` and no motor: the switch is for a
// touch screen, and the API alone is not enough to offer it.
describe('hapticsSupported', () => {
  const buzzing = { vibrate: () => true }

  it('is offered on a touch screen that can vibrate', () => {
    expect(hapticsSupported(buzzing, true)).toBe(true)
  })

  it('is not offered on a desktop that exposes the API', () => {
    expect(hapticsSupported(buzzing, false)).toBe(false)
  })

  it('is not offered where the API is missing', () => {
    expect(hapticsSupported({} as Pick<Navigator, 'vibrate'>, true)).toBe(false)
    expect(hapticsSupported(undefined, true)).toBe(false)
  })
})

// Fifty copies of one sample is the sound of a machine: the handling is
// pitched a few cents off and a shade softer or louder per hit, inside a range
// that still reads as the same sound.
describe('humanVariation', () => {
  it('stays inside its stated range', () => {
    for (let i = 0; i < 200; i++) {
      const v = humanVariation()
      const cents = Math.abs(1200 * Math.log2(v.pitch))
      expect(cents).toBeLessThanOrEqual(HUMAN_CENTS + 1e-9)
      expect(v.gain).toBeGreaterThanOrEqual(HUMAN_GAIN_FLOOR)
      expect(v.gain).toBeLessThanOrEqual(1)
    }
  })

  it('is exact at the middle of the dice', () => {
    const v = humanVariation(() => 0.5)
    expect(v.pitch).toBeCloseTo(1, 6)
    expect(v.gain).toBeCloseTo((1 + HUMAN_GAIN_FLOOR) / 2, 6)
  })
})
