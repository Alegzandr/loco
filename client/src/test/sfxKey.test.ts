/**
 * The effects land in the bed's key.
 *
 * `harmony.test.ts` pins how far a cue is moved for each key; this pins that
 * the move reaches the oscillators — every pitched primitive, and nothing
 * that is paper or felt — by playing real cues over a fake context and
 * reading the frequencies they asked for.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audio } from '../audio/engine'
import { cueShiftFor } from '../audio/harmony'
import { playSfx, setTonalitySource } from '../audio/sfx'

class Param {
  value = 0
  setValueAtTime(v: number) {
    this.value = v
  }
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}

class Node {
  connect() {}
  disconnect() {}
}

/** The first frequency every oscillator was given, in creation order. */
let pitches: number[] = []

class Osc extends Node {
  type = 'sine'
  frequency = new Param()
  detune = new Param()
  start() {
    pitches.push(this.frequency.value)
  }
  stop() {}
}

class FakeContext {
  state = 'running'
  currentTime = 0
  sampleRate = 48_000
  destination = new Node()
  createGain() {
    return Object.assign(new Node(), { gain: new Param() })
  }
  createOscillator() {
    return new Osc()
  }
  createBiquadFilter() {
    return Object.assign(new Node(), { type: '', frequency: new Param(), Q: new Param() })
  }
  createStereoPanner() {
    return Object.assign(new Node(), { pan: new Param() })
  }
  createDelay() {
    return Object.assign(new Node(), { delayTime: new Param() })
  }
  createBufferSource() {
    return Object.assign(new Node(), { buffer: null, start() {}, stop() {} })
  }
  createConvolver() {
    return Object.assign(new Node(), { buffer: null })
  }
  createBuffer(_c: number, length: number) {
    return { getChannelData: () => new Float32Array(length), sampleRate: 48_000 }
  }
  resume() {
    return Promise.resolve()
  }
  addEventListener() {}
  removeEventListener() {}
}

function play(name: Parameters<typeof playSfx>[0]): number[] {
  pitches = []
  playSfx(name)
  return pitches
}

describe('a cue struck over the bed', () => {
  beforeEach(async () => {
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    await audio.unlock()
  })

  afterEach(() => {
    setTonalitySource(() => null)
    vi.restoreAllMocks()
  })

  it('moves every pitched note of the match fanfare into the key, together', () => {
    setTonalitySource(() => null)
    const written = play('matchWin')
    expect(written.length).toBeGreaterThan(0)
    setTonalitySource(() => 'A')
    const moved = play('matchWin')
    const ratio = Math.pow(2, cueShiftFor('A') / 12)
    expect(cueShiftFor('A')).not.toBe(0)
    expect(moved).toHaveLength(written.length)
    // Every note moves by the same interval, so each chord is still the chord
    // it was written as; the thud under it is a body written in Hz and stays.
    const ratios = moved.map((f, i) => f / written[i])
    for (const r of ratios) expect(Math.abs(r - 1) < 1e-9 || Math.abs(r - ratio) < 1e-9, `${r}`).toBe(true)
    // Two chords of four and five notes, four voices each, and their bells.
    expect(ratios.filter((r) => Math.abs(r - ratio) < 1e-9).length).toBeGreaterThanOrEqual(36)
  })

  it('moves the interface too, so the turn cue sits in the music', () => {
    setTonalitySource(() => null)
    const written = play('yourTurn')
    setTonalitySource(() => 'Gm')
    const moved = play('yourTurn')
    const ratio = Math.pow(2, cueShiftFor('Gm') / 12)
    moved.forEach((f, i) => expect(f / written[i]).toBeCloseTo(ratio, 6))
  })

  it('leaves the card handling alone: paper has no key', () => {
    // The handling is humanised on purpose; hold the hand still to compare.
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    setTonalitySource(() => 'A')
    // A card played is a snap and a thud: noise and a falling sine, neither
    // of which is a note. The thud's body is written in Hz, not in a key.
    const moved = play('cardPlay')
    setTonalitySource(() => null)
    const written = play('cardPlay')
    expect(moved).toEqual(written)
  })
})
