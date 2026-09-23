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
import { cueShiftFor } from '../audio/harmony'
import { currentCueShift } from '../audio/sfx'
import {
  barSeconds,
  BASS_SWAP_HZ,
  BRAKE_RATE,
  BRAKE_REST_MS,
  CUT_CLOSE_HZ,
  DIP_HZ,
  entryOffset,
  MUFFLE_HZ,
  REENTER_FADE_S,
  HANDOVER_LOOKAHEAD_S,
  HANDOVER_TAIL_S,
  LAPS_PER_LOOP,
  music,
  planSectionChange,
  STOP_FADE_S,
} from '../audio/music'
import { getLoop } from '../audio/tracks'

interface Scheduled {
  curves: { at: number; dur: number; up: boolean }[]
  ramps: { at: number; value: number }[]
  exps: { at: number; value: number }[]
  sets: { at: number; value: number }[]
  targets: { at: number; value: number }[]
}

class FakeParam {
  value = 1
  log: Scheduled = { curves: [], ramps: [], exps: [], sets: [], targets: [] }
  cancelScheduledValues() {}
  setValueAtTime(value: number, at: number) {
    this.log.sets.push({ at, value })
  }
  setTargetAtTime(value: number, at: number) {
    this.log.targets.push({ at, value })
    this.value = value
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.log.ramps.push({ at, value })
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    this.log.exps.push({ at, value })
  }
  setValueCurveAtTime(curve: Float32Array, at: number, dur: number) {
    this.log.curves.push({ at, dur, up: curve[0] < curve[curve.length - 1] })
  }
}

class FakeNode {
  next: FakeNode | null = null
  connect(node: FakeNode) {
    this.next = node
    return node
  }
  disconnect() {}
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeFilter extends FakeNode {
  type = ''
  frequency = new FakeParam()
  Q = new FakeParam()
}

/** Every source anybody made, the bed's and the swell's, in order. */
const made: FakeSource[] = []
const gains: FakeGain[] = []
/**
 * Every filter ever made, never reset: the bed's own tone filter is built once,
 * with its output stage, by whichever test first asks for it.
 */
const filters: FakeFilter[] = []

/** The bed's own sources: the ones looping a loop, not the swell's noise. */
function beds(): FakeSource[] {
  return made.filter((s) => s.loopEnd > 0)
}

/** The swell's sources: noise, looped on no loop points. */
function swells(): FakeSource[] {
  return made.filter((s) => s.loopEnd === 0)
}

class FakeSource extends FakeNode {
  buffer: unknown = null
  loop = false
  loopStart = 0
  loopEnd = 0
  onended: (() => void) | null = null
  startedAt: number | null = null
  startOffset = 0
  stoppedAt: number | null = null
  playbackRate = new FakeParam()
  constructor() {
    super()
    made.push(this)
  }
  /** Walks the chain to the first filter of a type, or the gain. */
  private find<T extends FakeNode>(match: (n: FakeNode) => n is T): T | null {
    let n = this.next
    while (n) {
      if (match(n)) return n
      n = n.next
    }
    return null
  }
  get gain(): FakeGain | null {
    return this.find((n): n is FakeGain => n instanceof FakeGain)
  }
  get hp(): FakeFilter | null {
    return this.find((n): n is FakeFilter => n instanceof FakeFilter && n.type === 'highpass')
  }
  get lp(): FakeFilter | null {
    return this.find((n): n is FakeFilter => n instanceof FakeFilter && n.type === 'lowpass')
  }
  start(at: number, offset = 0) {
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
  destination = new FakeNode()
  createGain() {
    const g = new FakeGain()
    gains.push(g)
    return g
  }
  createBiquadFilter() {
    const f = new FakeFilter()
    filters.push(f)
    return f
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
  const found = [...beds()].reverse().find((s) => s.loopEnd - s.loopStart > loop.seconds - 0.01 && s.loopEnd - s.loopStart < loop.seconds + 0.01)
  if (!found) throw new Error(`no source for ${id}`)
  return found
}

describe('where a change lands', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    made.length = 0
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
    expect(beds().length).toBe(1)

    // Inside it: the next loop is scheduled, and it is scheduled *on* the wrap.
    await advance(1)
    await settle()
    expect(beds().length).toBe(2)
    const incoming = beds()[1]
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
    expect(beds().length).toBe(2)
  })

  it('lands a section change on the outgoing loop\'s next bar line, in the shape its two loops call for', async () => {
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
    // the change is scheduled — on a bar line no further past the moment it
    // was believed than a bar plus the lead its tail and its air need.
    await advance(3)
    await settle()
    expect(music.getSection()).toBe('drop')
    expect(beds().length).toBe(2)
    const incoming = beds()[1]
    const at = incoming.startedAt ?? -1
    expect(at).toBeGreaterThan(asked)
    // On a bar line of the piece it is replacing, to the millisecond.
    const phase = ((at % bar) + bar) % bar
    expect(Math.min(phase, bar - phase)).toBeLessThan(1e-3)

    // Which loop came in is the bag's business; what it must look like
    // follows from the pair.
    await advance(at - ctx.currentTime + 0.1)
    const next = music.getLoopId()
    expect(next).not.toBe(first)
    const plan = planSectionChange(getLoop(first), getLoop(next), 'groove', 'drop')
    expect(at).toBeLessThan(asked + 3 + plan.lead + bar)
    // A rise enters on the incoming loop's first full phrase.
    expect(incoming.startOffset).toBeCloseTo(entryOffset(getLoop(next)), 6)
    const up = incoming.gain?.gain.log.curves.find((c) => c.up)
    const down = sourceOf(first).gain?.gain.log.curves.find((c) => !c.up)
    if (plan.handover === 'blend') {
      // Both curves start there: a crossfade, not a landing.
      expect(up?.at).toBeCloseTo(at, 6)
      expect(down?.at).toBeCloseTo(at, 6)
      expect(up?.dur).toBe(down?.dur)
    } else {
      // Never on top of each other: the old piece is gone on the one, the new
      // one arrives whole there, and the air rises into it.
      expect(up).toBeUndefined()
      expect(incoming.gain?.gain.log.sets).toEqual([{ at, value: 0 }])
      expect((down?.at ?? 0) + (down?.dur ?? 0)).toBeCloseTo(at, 6)
      expect(down?.dur).toBeCloseTo(plan.tail, 6)
      const swell = swells()[0]
      expect(swell).toBeDefined()
      expect(swell.stoppedAt).toBeGreaterThan(at)
    }
  })

  it('answers a scene move on the spot, not on a bar line', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    await advance(1.3)
    music.setIntensity(0.2)
    music.start('lobby')
    await settle()
    expect(beds().length).toBe(2)
    expect(beds()[1].startedAt).toBeCloseTo(ctx.currentTime, 6)
  })

  it('fades out when the scene goes off, and cuts when the tab hides', async () => {
    music.setIntensity(0.4)
    music.start('game')
    await settle()
    const src = beds()[0]
    music.start('off')
    const fade = src.gain?.gain.log.curves.find((c) => !c.up)
    expect(fade?.dur).toBe(STOP_FADE_S)
    expect(src.stoppedAt).toBeGreaterThanOrEqual(ctx.currentTime + STOP_FADE_S)
    expect(music.isPlaying()).toBe(false)

    music.start('game')
    await settle()
    const again = beds()[beds().length - 1]
    music.setHidden(true)
    expect(again.stoppedAt).toBe(-1)
    music.setHidden(false)
  })
})

/**
 * What a change sounds like, pinned on loops chosen so the bag has no say:
 * a start is forced with `setLoop` while the bed is stopped, and the family's
 * candidates are then all of one kind for the change under test.
 */
describe('how a change sounds', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    made.length = 0
    gains.length = 0
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeContext
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
    )
    await audio.unlock()
    ctx = audio.context() as unknown as FakeContext
    ctx.currentTime = 0
    music.stop()
  })

  afterEach(() => {
    music.stop()
    music.setLapSeconds(null)
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  async function open(id: string, intensity: number): Promise<void> {
    music.setLoop(id)
    music.setIntensity(intensity)
    music.start('game')
    await settle()
    expect(music.getLoopId()).toBe(id)
  }

  it('forgets the loop before once it has stopped, so a fresh start ranks the whole bag', async () => {
    // Left over from a previous match, `previous` would keep a new one from
    // the best partner for its opening loop.
    await open('neck-and-neck', 0.4)
    await advance(1)
    music.setLoop('clockwork')
    await settle()
    music.stop()
    await open('clockwork', 0.4)
    await advance(2)
    music.setIntensity(0.95)
    await advance(3)
    await settle()
    const at = beds().at(-1)?.startedAt ?? -1
    await advance(at - ctx.currentTime + 0.1)
    expect(music.getLoopId()).toBe('neck-and-neck')
  })

  it('blends two loops that agree, handing the bass over on a beat and lifting into the drop', async () => {
    // Clockwork is G minor at 85. The night's drop offers Neck and Neck (F
    // minor, 85: two steps, same tempo) and Runaway (C minor, 90: one step,
    // six percent off). Only the first can be overlapped, so it is the one.
    await open('clockwork', 0.4)
    const outgoing = sourceOf('clockwork')
    await advance(2)
    music.setIntensity(0.95)
    await advance(3)
    await settle()
    const incoming = beds()[1]
    const at = incoming.startedAt ?? -1
    await advance(at - ctx.currentTime + 0.1)
    expect(music.getLoopId()).toBe('neck-and-neck')

    const up = incoming.gain?.gain.log.curves.find((c) => c.up)
    expect(up?.at).toBeCloseTo(at, 6)
    // The incoming loop arrives with its low end cut, and gets it back on the
    // same instant the outgoing one gives its own up.
    const gets = incoming.hp?.frequency.log.exps[0]
    const gives = outgoing.hp?.frequency.log.exps[0]
    expect(gets).toBeDefined()
    expect(gives?.value).toBe(BASS_SWAP_HZ)
    expect(gets?.at).toBeCloseTo(gives?.at ?? -1, 6)
    expect(gets!.at).toBeGreaterThan(at)
    expect(gets!.at).toBeLessThan(at + (up?.dur ?? 0))
    // On a beat of the incoming loop, give or take the glide.
    const beat = 60 / getLoop('neck-and-neck').bpm
    const off = ((gets!.at - at) % beat) / beat
    expect(Math.min(off, 1 - off)).toBeLessThan(0.1)
    // Nothing is darkened in a blend, and the air rises into the drop.
    expect(outgoing.lp?.frequency.log.exps).toEqual([])
    expect(swells()).toHaveLength(1)
    expect(swells()[0].startedAt).toBeLessThan(at)
  })

  it('cuts between two loops that do not agree: the tail darkened, the air across it, nothing on top', async () => {
    // Full Table is C minor at 130. Every other groove loop of the party is
    // at least eight percent off it, so every lap handover is a cut.
    music.setLapSeconds(10)
    await open('full-table', 0.4)
    const outgoing = sourceOf('full-table')
    await advance(20 - 1)
    await settle()
    const incoming = beds()[1]
    expect(incoming.startedAt).toBeCloseTo(20, 3)
    expect(incoming.gain?.gain.log.curves.find((c) => c.up)).toBeUndefined()
    const shut = outgoing.lp?.frequency.log.exps[0]
    expect(shut?.value).toBe(CUT_CLOSE_HZ)
    expect(shut?.at).toBeCloseTo(20, 3)
    expect(swells()).toHaveLength(1)
    expect(swells()[0].stoppedAt).toBeGreaterThan(20)
  })

  it('brakes the loop at the end of a match, rests, and brings the next piece up out of the silence', async () => {
    await open('clockwork', 0.4)
    const src = sourceOf('clockwork')
    music.brake()
    expect(src.playbackRate.log.ramps.at(-1)?.value).toBe(BRAKE_RATE)
    expect(src.stoppedAt).toBeGreaterThan(ctx.currentTime)
    expect(music.getTonality()).toBeNull()
    // Nothing starts under the fanfare.
    await advance(BRAKE_REST_MS / 1000 - 0.3)
    await settle()
    expect(beds()).toHaveLength(1)
    // Then the recap's piece rises.
    await advance(0.6)
    await settle()
    expect(beds()).toHaveLength(2)
    const back = beds()[1]
    const rise = back.gain?.gain.log.curves.find((c) => c.up)
    expect(rise?.dur).toBe(REENTER_FADE_S)
  })

  it('drops a change still loading when the bed was braked, so nothing starts under the fanfare', async () => {
    await open('clockwork', 0.4)
    // A load that never settles until the test lets it.
    let release: (() => void) | null = null
    vi.stubGlobal('fetch', () =>
      new Promise((r) => {
        release = () => r({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
      }),
    )
    music.nextTrack()
    await settle()
    music.brake()
    release!()
    await settle()
    expect(beds()).toHaveLength(1)
  })

  it('steps behind a door while something is read over it, and dips for a shout', async () => {
    await open('clockwork', 0.4)
    expect(music.getToneHz()).toBe(20_000)
    music.setMuffled(true)
    music.setMuffled(true)
    expect(music.getToneHz()).toBe(MUFFLE_HZ)
    // Two panels, one shut: still behind the door.
    music.setMuffled(false)
    expect(music.getToneHz()).toBe(MUFFLE_HZ)
    music.setMuffled(false)
    expect(music.getToneHz()).toBe(20_000)
    music.dip(700)
    // Down, then back to where it was.
    const tone = filters.find((f) => f.frequency.log.targets.some((t) => t.value === MUFFLE_HZ))
    const [down, back] = tone?.frequency.log.targets.slice(-2) ?? []
    expect(down?.value).toBe(DIP_HZ)
    expect(back?.value).toBe(20_000)
    expect(back!.at - down!.at).toBeCloseTo(0.7, 6)
  })

  it('tells the effects which key it is in, and nothing once it has stopped', async () => {
    await open('clockwork', 0.4)
    expect(music.getTonality()).toBe('Gm')
    expect(currentCueShift()).toBe(cueShiftFor('Gm'))
    music.stop()
    expect(music.getTonality()).toBeNull()
    expect(currentCueShift()).toBe(0)
  })
})

