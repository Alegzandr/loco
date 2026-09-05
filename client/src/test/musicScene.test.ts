/**
 * What the bed does when the player changes screen.
 *
 * The rest of `music.test.ts` is pure functions, which is where most of this
 * engine can be pinned. This one cannot be: the defect was an *ordering*
 * between `start()` and the tick, and both halves were individually correct.
 * Leaving the table lowers the section, `sectionHoldMs` makes a fall wait
 * twelve seconds before it is believed, and a player who quits a match and
 * starts another one is back inside a game before that wait is up — so the
 * hold was never crossed, the loop never changed, and the menu, the second
 * deal and everything between them were one unbroken piece of music.
 *
 * So it is asserted against a real `MusicBed` over a fake AudioContext: the
 * claim is "the piece changes when the scene does", and nothing shorter than
 * driving the bed says that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audio } from '../audio/engine'
import { music } from '../audio/music'

class FakeParam {
  value = 1
  cancelScheduledValues() {}
  setValueAtTime() {}
  setTargetAtTime() {}
  linearRampToValueAtTime() {}
  exponentialRampToValueAtTime() {}
  setValueCurveAtTime() {}
}

class FakeGain {
  gain = new FakeParam()
  connect() {}
  disconnect() {}
}

class FakeSource {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  onended: (() => void) | null = null
  connect() {}
  disconnect() {}
  start() {}
  stop() {}
}

class FakeBuffer {
  constructor(
    readonly length: number,
    readonly numberOfChannels: number,
    readonly sampleRate: number,
  ) {}
  get duration() {
    return this.length / this.sampleRate
  }
  getChannelData() {
    // Audible from the first sample, so the measured loop start is zero and
    // the loop points are the registry's own `seconds`.
    return new Float32Array(this.length).fill(0.5)
  }
}

class FakeContext {
  state = 'running'
  currentTime = 0
  sampleRate = 48_000
  destination = {}
  createGain() {
    return new FakeGain()
  }
  createBufferSource() {
    return new FakeSource()
  }
  createConvolver() {
    return { buffer: null, connect() {} }
  }
  createBuffer(channels: number, length: number, rate: number) {
    return new FakeBuffer(length, channels, rate)
  }
  decodeAudioData() {
    // Longer than the longest loop in the registry, so no loop point is
    // clamped by the buffer's own length.
    return Promise.resolve(new FakeBuffer(48_000 * 180, 2, 48_000))
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  addEventListener() {}
  removeEventListener() {}
}

/** Lets the fetch, the decode and the crossfade behind a `start()` finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0))
}

describe('a scene move', () => {
  beforeEach(async () => {
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    )
    await audio.unlock()
  })

  afterEach(() => {
    music.stop()
    vi.unstubAllGlobals()
  })

  it('changes the piece when the player leaves the table, and again when they sit back down', async () => {
    // A tense match: the drop, which is the section furthest from the menu's
    // build-up and therefore the one the release hold makes slowest to leave.
    music.setIntensity(0.7)
    music.start('game')
    await settle()
    expect(music.isPlaying()).toBe(true)
    const inMatch = music.getLoopId()

    // Quit. The menu is a build-up in another palette, and it is heard now —
    // not twelve seconds from now, which is longer than it takes to press
    // "play" again.
    music.setIntensity(0.2)
    music.start('lobby')
    await settle()
    expect(music.getScene()).toBe('lobby')
    expect(music.getLoopId(), 'the menu kept the match music').not.toBe(inMatch)
    const inMenu = music.getLoopId()

    // Start another one. Same rule the other way round: the deal is a move,
    // so it sounds like one.
    music.setIntensity(0.34)
    music.start('game')
    await settle()
    expect(music.getScene()).toBe('game')
    expect(music.getLoopId(), 'the second match kept the menu music').not.toBe(inMenu)
  })

  it('draws another palette on every move, so a piece is never picked from the one just left', async () => {
    music.setIntensity(0.34)
    music.start('game')
    await settle()

    let family = music.getFamily()
    for (const scene of ['lobby', 'game', 'lobby'] as const) {
      music.start(scene)
      await settle()
      expect(music.getFamily()).not.toBe(family)
      family = music.getFamily()
    }
  })

  it('answers the screen it lands on rather than the tension it left', async () => {
    // The slew is there so a spike inside a round is not heard. A scene move
    // is not a spike: it is where the player is, so it is snapped.
    music.setIntensity(0.9)
    music.start('game')
    await settle()

    music.setIntensity(0.2)
    music.start('lobby')
    expect(music.getIntensity()).toBeCloseTo(0.2, 5)
  })
})
