/**
 * When a change of loop lands.
 *
 * `music.test.ts` pins the pure half (`untilNextBar`, `untilNextWrap`,
 * `fadeFor`). This drives a real `MusicBed` over a fake AudioContext whose
 * clock the test moves, and reads the times the bed *scheduled* — because the
 * claim is not "the loop changes" but "the loop changes on the beat": a lap
 * handover lands on the wrap the outgoing loop would have restarted from, a
 * section change lands on the outgoing loop's next bar line, and a scene going
 * `off` fades instead of cutting. None of that is visible in what plays, only
 * in when.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { audio } from '../audio/engine'
import {
  barSeconds,
  HANDOVER_LOOKAHEAD_S,
  HANDOVER_TAIL_S,
  LAPS_PER_LOOP,
  music,
  STOP_FADE_S,
} from '../audio/music'
import { getLoop } from '../audio/tracks'

interface Scheduled {
  curves: { at: number; dur: number; up: boolean }[]
  ramps: { at: number; value: number }[]
  sets: { at: number; value: number }[]
}

class FakeParam {
  value = 1
  log: Scheduled = { curves: [], ramps: [], sets: [] }
  cancelScheduledValues() {}
  setValueAtTime(value: number, at: number) {
    this.log.sets.push({ at, value })
  }
  setTargetAtTime() {}
  linearRampToValueAtTime(value: number, at: number) {
    this.log.ramps.push({ at, value })
  }
  exponentialRampToValueAtTime() {}
  setValueCurveAtTime(curve: Float32Array, at: number, dur: number) {
    this.log.curves.push({ at, dur, up: curve[0] < curve[curve.length - 1] })
  }
}

class FakeGain {
  gain = new FakeParam()
  connect() {}
  disconnect() {}
}

/** Every source the bed made, in order, with what it was told. */
const sources: FakeSource[] = []
const gains: FakeGain[] = []

class FakeSource {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  onended: (() => void) | null = null
  startedAt: number | null = null
  startOffset = 0
  stoppedAt: number | null = null
  gain: FakeGain | null = null
  constructor() {
    sources.push(this)
  }
  connect(node: FakeGain) {
    this.gain = node
  }
  disconnect() {}
  start(at: number, offset: number) {
    this.startedAt = at
    this.startOffset = offset
  }
  stop(at?: number) {
    this.stoppedAt = at ?? -1
  }
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
    return new Float32Array(this.length).fill(0.5)
  }
}

class FakeContext {
  state = 'running'
  currentTime = 0
  sampleRate = 48_000
  destination = {}
  createGain() {
    const g = new FakeGain()
    gains.push(g)
    return g
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
    return Promise.resolve(new FakeBuffer(48_000 * 180, 2, 48_000))
  }
  resume() {
    this.state = 'running'
    return Promise.resolve()
  }
  addEventListener() {}
  removeEventListener() {}
}

let ctx: FakeContext

/** Moves both clocks — the context's and the wall's the tick reads — by `s` seconds. */
async function advance(s: number): Promise<void> {
  const steps = Math.max(1, Math.round(s / 0.25))
  for (let i = 0; i < steps; i++) {
    ctx.currentTime += s / steps
    await vi.advanceTimersByTimeAsync((s / steps) * 1000)
  }
}

/** Lets a load and a swap finish without moving any clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0)
}

/** The source the bed is playing for `id`, most recent first. */
function sourceOf(id: string): FakeSource {
  const loop = getLoop(id)
  const found = [...sources].reverse().find((s) => s.loopEnd - s.loopStart > loop.seconds - 0.01 && s.loopEnd - s.loopStart < loop.seconds + 0.01)
  if (!found) throw new Error(`no source for ${id}`)
  return found
}

describe('where a change lands', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    sources.length = 0
    gains.length = 0
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    )
    await audio.unlock()
    ctx = audio.context() as unknown as FakeContext
    ctx.currentTime = 0
  })

  afterEach(() => {
    music.stop()
    music.setLapSeconds(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('lands a lap handover exactly on the wrap, the old piece gone on the one', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    const first = music.getLoopId()
    const opening = sourceOf(first)
    expect(opening.startedAt).toBe(0)
    const lap = getLoop(first).seconds
    const wrap = lap * LAPS_PER_LOOP

    // Up to the edge of the lookahead: nothing has been asked for yet.
    await advance(wrap - HANDOVER_LOOKAHEAD_S - 0.5)
    expect(sources.length).toBe(1)

    // Inside it: the next loop is scheduled, and it is scheduled *on* the wrap.
    await advance(1)
    await settle()
    expect(sources.length).toBe(2)
    const incoming = sources[1]
    expect(incoming.startedAt).toBeCloseTo(wrap, 3)
    expect(incoming.startOffset).toBe(0)
    // Whole, on the one: a ramp too short to hear, not a crossfade curve.
    expect(incoming.gain?.gain.log.curves).toEqual([])
    expect(incoming.gain?.gain.log.sets).toEqual([{ at: incoming.startedAt, value: 0 }])
    const ramp = incoming.gain?.gain.log.ramps[0]
    expect(ramp?.value).toBe(1)
    expect((ramp?.at ?? -1) - (incoming.startedAt ?? 0)).toBeLessThan(0.1)
    expect((ramp?.at ?? -1) - (incoming.startedAt ?? 0)).toBeGreaterThan(0)

    // And the outgoing one fades over its last bar, ending where the new one starts.
    const tail = opening.gain?.gain.log.curves.find((c) => !c.up)
    expect(tail).toBeDefined()
    expect(tail!.at + tail!.dur).toBeCloseTo(wrap, 3)
    expect(tail!.dur).toBeCloseTo(HANDOVER_TAIL_S, 3)

    // The panel still names the piece on its way out until the new one sounds.
    expect(music.getLoopId()).toBe(first)
    await advance(HANDOVER_LOOKAHEAD_S)
    expect(music.getLoopId()).not.toBe(first)
    // Nothing was asked for twice in the window.
    expect(sources.length).toBe(2)
  })

  it('lands a section change on the outgoing loop\'s next bar line', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    const first = music.getLoopId()
    const bar = barSeconds(getLoop(first))

    // Somewhere mid-bar, well before the first lap is anywhere near done.
    await advance(bar * 2.3)
    const asked = ctx.currentTime
    music.setIntensity(0.95)
    // Slew (~1s to cross) plus the hold: the drop is wanted and believed, and
    // the change is scheduled — on a bar line no more than a bar past the
    // moment it was believed, which may already have gone by.
    await advance(3)
    await settle()
    expect(music.getSection()).toBe('drop')
    expect(sources.length).toBe(2)
    const incoming = sources[1]
    const at = incoming.startedAt ?? -1
    expect(at).toBeGreaterThan(asked)
    expect(at).toBeLessThan(ctx.currentTime + bar)
    // On a bar line of the piece it is replacing, to the millisecond.
    const phase = ((at % bar) + bar) % bar
    expect(Math.min(phase, bar - phase)).toBeLessThan(1e-3)
    // Both curves start there: a crossfade, not a landing.
    const up = incoming.gain?.gain.log.curves.find((c) => c.up)
    const down = sourceOf(first).gain?.gain.log.curves.find((c) => !c.up)
    expect(up?.at).toBeCloseTo(at, 6)
    expect(down?.at).toBeCloseTo(at, 6)
    expect(up?.dur).toBe(down?.dur)
  })

  it('answers a scene move on the spot, not on a bar line', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    await advance(1.3)
    music.setIntensity(0.2)
    music.start('lobby')
    await settle()
    expect(sources.length).toBe(2)
    expect(sources[1].startedAt).toBeCloseTo(ctx.currentTime, 6)
  })

  it('fades out when the scene goes off, and cuts when the tab hides', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    const src = sources[0]
    music.start('off')
    const fade = src.gain?.gain.log.curves.find((c) => !c.up)
    expect(fade?.dur).toBe(STOP_FADE_S)
    expect(src.stoppedAt).toBeGreaterThanOrEqual(ctx.currentTime + STOP_FADE_S)
    expect(music.isPlaying()).toBe(false)

    music.start('game')
    await settle()
    const again = sources[sources.length - 1]
    music.setHidden(true)
    expect(again.stoppedAt).toBe(-1)
    music.setHidden(false)
  })
})
