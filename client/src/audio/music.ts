/**
 * Adaptive music bed — the engine.
 *
 * This file contains no music. Tracks are data (`audio/tracks/`), and this plays
 * any of them: scheduling, synthesis, the arrangement ladder, the song form.
 *
 * ## Two axes, and why
 *
 * The first version was one four-bar loop whose only variation was layer count.
 * However good four bars are, a twenty-minute match spends it in the first two
 * minutes — the feedback was, exactly, "it's just a chorus on repeat".
 *
 * So what you hear is the product of two independent things:
 *
 * - **The form** advances on its own. A track is a set of parts (intro, verse,
 *   chorus, bridge, break) and an order; the engine walks it. Around forty bars
 *   pass before a part returns, and it usually returns in a different section.
 * - **The game's intensity** picks the *stack* (`sectionFor` → `LAYERS`) and
 *   *biases which part comes next* (`nextFormIndex`): a drop pulls the form
 *   toward a chorus, a round summary toward a break.
 *
 * Both are pure functions, exported and unit-tested, because "does the music go
 * somewhere" is a claim about behaviour and not about sound.
 *
 * ## Anti-repetition, deliberately
 *
 * Beyond the form: a riser and a crash whenever the *next* part is a chorus, a
 * drum fill in the last bar of every part, and an octave lift on alternate
 * passes of a chorus. These exist because the ear forgives a repeated phrase
 * that arrives differently, and never forgives one that arrives identically.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a coarse timer wakes
 * up often, and every event it finds inside the next slice is scheduled with a
 * sample-accurate start time. setTimeout jitter therefore never reaches the
 * output.
 */
import { audio } from './engine'
import { DEFAULT_TRACK_ID, getTrack, TRACKS } from './tracks'
import type { Adsr, DrumStyle, PartDef, PartRole, Slot, SynthSpec, TrackDef } from './tracks/types'

export type MusicScene = 'lobby' | 'game' | 'off'

/** How far ahead of the clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.18
/** How often the scheduler wakes, in ms. Must be well under LOOKAHEAD. */
const TICK_MS = 40

const STEPS_PER_BAR = 16

/** Arrangement stacks, in the order intensity unlocks them. */
export type Section = 'breakdown' | 'buildup' | 'groove' | 'drop'

/** Intensity at or above which each section plays. Ordered, ascending. */
export const SECTION_AT: Record<Section, number> = {
  breakdown: 0,
  buildup: 0.2,
  groove: 0.3,
  drop: 0.58,
}

export interface LayerSet {
  kick: boolean
  hats: boolean
  ride: boolean
  /** 'beats' = on 2 and 4; 'sparse' = one hit every other bar; null = none. */
  clap: 'beats' | 'sparse' | null
  crash: boolean
  bass: boolean
  pad: boolean
  lead: boolean
  counter: boolean
  stabs: boolean
  leadOctave: boolean
  /** Multiplier on the arp's written gain. */
  arpGain: number
  /** Fixed cutoff instead of the sweep, when the section wants it closed down. */
  arpCutoff: number | null
}

/**
 * What plays in each section.
 *
 * The lead is in every one of them. That is not an oversight to tidy up later: an
 * earlier version gated its theme above `intensity > 0.5` while an ordinary turn
 * sits at 0.34, so players never heard a tune at all. Sparse sections get their
 * quietness from the *part* the form is on (a `break` part is written sparse),
 * not from muting the melody.
 */
export const LAYERS: Record<Section, LayerSet> = {
  breakdown: {
    kick: false, hats: false, ride: false, clap: 'sparse', crash: false, bass: false,
    pad: true, lead: true, counter: false, stabs: false, leadOctave: false,
    arpGain: 0.35, arpCutoff: 1200,
  },
  buildup: {
    kick: false, hats: false, ride: false, clap: null, crash: false, bass: false,
    pad: true, lead: true, counter: false, stabs: false, leadOctave: false,
    arpGain: 0.8, arpCutoff: null,
  },
  groove: {
    kick: true, hats: true, ride: false, clap: 'beats', crash: false, bass: true,
    pad: true, lead: true, counter: false, stabs: true, leadOctave: false,
    arpGain: 1, arpCutoff: null,
  },
  drop: {
    kick: true, hats: true, ride: true, clap: 'beats', crash: true, bass: true,
    pad: true, lead: true, counter: true, stabs: true, leadOctave: true,
    arpGain: 1, arpCutoff: null,
  },
}

/**
 * Which stack a given intensity plays.
 *
 * Pure and exported because it is the whole contract between game state and what
 * the room hears — a test can assert it without an AudioContext.
 */
export function sectionFor(intensity: number, lobby = false): Section {
  // The lobby is a build-up, not a breakdown: people are reading names and
  // pressing buttons, and a build-up is the section that has the tune without
  // the drums.
  if (lobby) return 'buildup'
  if (intensity >= SECTION_AT.drop) return 'drop'
  if (intensity >= SECTION_AT.groove) return 'groove'
  if (intensity >= SECTION_AT.buildup) return 'buildup'
  return 'breakdown'
}

/** Which part roles each section wants next, best first. */
const ROLE_PREF: Record<Section, PartRole[]> = {
  breakdown: ['break', 'intro'],
  buildup: ['intro', 'verse', 'break'],
  groove: ['verse', 'bridge', 'chorus'],
  drop: ['chorus', 'bridge'],
}

/**
 * Where the form goes next.
 *
 * A **single forward scan** for the first part whose role the section accepts.
 * Two properties matter and both were got wrong first time:
 *
 * - It can never return `from` (the scan stops one short of a full lap), so the
 *   form cannot stall. Preferring a role that only one part carries otherwise
 *   pins the track on that part — a loop, which is the exact thing this design
 *   exists to escape.
 * - It takes the *first* acceptable part rather than exhausting one role before
 *   trying the next. Ranking by role instead made a sustained groove ping-pong
 *   between the two verses and never reach the bridge or the choruses; taking
 *   them in written order tours the whole track.
 *
 * Falls through to the next entry when nothing matches, because silence is never
 * the right answer to a track with an unusual role mix.
 */
export function nextFormIndex(track: TrackDef, from: number, section: Section): number {
  const prefs = ROLE_PREF[section]
  const n = track.form.length
  for (let k = 1; k < n; k++) {
    const idx = (from + k) % n
    const role = partById(track, track.form[idx])?.role
    if (role && prefs.includes(role)) return idx
  }
  return (from + 1) % n
}

export function partById(track: TrackDef, id: string): PartDef | undefined {
  return track.parts.find((p) => p.id === id)
}

/** Length of the note starting at `i`, in slots, following `-1` ties. */
export function noteLength(row: Slot[], i: number): number {
  let n = 1
  while (i + n < row.length && row[i + n] === -1) n++
  return n
}

/**
 * A shuffle bag: every track exactly once, in a random order that does not open
 * on `avoid`.
 *
 * Not `Math.random()` per track. Pure random repeats — roughly one handover in
 * three would play the track that just finished, which people hear as "it's
 * broken", not as "that's what random means". Dealing a shuffled bag and
 * refilling it when empty gives an order that feels random *and* guarantees you
 * hear everything before hearing anything twice.
 */
export function shuffledOrder(ids: string[], avoid: string | null, rand: () => number): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  // One deterministic swap rather than a reshuffle loop: re-rolling until the
  // head differs can, with one track in the bag, never terminate.
  if (out.length > 1 && out[0] === avoid) [out[0], out[1]] = [out[1], out[0]]
  return out
}

/**
 * How many parts a track plays before handing over.
 *
 * One pass of a form is ~36 bars, about a minute — short for something presented
 * as a song. Two passes lands around two minutes, which is both a normal track
 * length and long enough that the handover is an event rather than a carousel.
 */
export const PASSES_PER_TRACK = 2

/**
 * Intensity units per second. A full swing takes ~1.8s — about a bar, so a
 * change lands on a bar line rather than dragging past the moment.
 */
const SLEW_PER_SEC = 0.55

/** Above this much pending climb, a bar line launches a riser. */
const RISER_GAP = 0.18

/** Drum patterns, in sixteenths. The kit is the track's, the pattern is here. */
const KITS: Record<DrumStyle, { kick: number[]; clap: number[]; hat: number[]; openHat: number[]; ride: number[] }> = {
  // Four on the floor, offbeat hats — the trance engine.
  trance: {
    kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], openHat: [],
    ride: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
  // Same kick, but the hat is on every eighth and the "and" gets an open one.
  house: {
    kick: [0, 4, 8, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14],
    openHat: [2, 6, 10, 14], ride: [],
  },
  // The kick leaves the grid: 1, the "a" of 2, 3, the "a" of 4.
  electro: {
    kick: [0, 6, 8, 14], clap: [4, 12], hat: [2, 6, 10, 14], openHat: [],
    ride: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  },
}

function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

class MusicBed {
  private timer: ReturnType<typeof setInterval> | null = null
  private out: GainNode | null = null
  /** Pad-only bus carrying the stepped pump. */
  private padBus: GainNode | null = null
  private reverbIn: GainNode | null = null
  private leadEchoIn: GainNode | null = null
  private leadDelay: DelayNode | null = null
  private arpEchoIn: GainNode | null = null
  private arpDelay: DelayNode | null = null
  private noiseBuf: AudioBuffer | null = null
  /** Soft clipping for the kick — most of a 909's punch. */
  private shaper: WaveShaperNode | null = null

  private track: TrackDef = getTrack(DEFAULT_TRACK_ID)
  private pendingTrack: TrackDef | null = null
  /** True when the swap was asked for by a person and should not wait a part. */
  private pendingNow = false
  /** A track just changed; the next emitted step covers the seam with a dip. */
  private dipPending = false
  /** Remaining tracks in the current shuffle bag. */
  private queue: string[] = []
  /** Parts played in the current track; at `partsPerTrack()` it hands over. */
  private partsPlayed = 0
  /** Harness-only shortening of a track. See `setPartsPerTrack`. */
  private partsOverride: number | null = null
  /** Index into `track.form`. */
  private formIndex = 0
  /** Sixteenth within the current part. */
  private partStep = 0
  /** How many times the current part has played — drives per-pass variation. */
  private partPass = 0

  private nextStepTime = 0
  /** Where the game wants the intensity. */
  private target = 0.35
  /** Where the bed actually is — slewed toward the target, never jumped. */
  private current = 0.35
  /** Sampled once per bar, so the arrangement never changes mid-phrase. */
  private barIntensity = 0.35
  private section: Section = 'groove'
  private scene: MusicScene = 'off'
  /** Bars elapsed since the bed started — drives the slow filter sweeps. */
  private barCount = 0
  /** Deterministic variation, so hats are not a machine. */
  private seed = 1
  /** Scheduler time of the last slew, for a frame-rate-independent ramp. */
  private lastSlewAt = 0

  private rand(): number {
    // xorshift — cheap, dependency-free, and repeatable enough to debug.
    this.seed ^= this.seed << 13
    this.seed ^= this.seed >>> 17
    this.seed ^= this.seed << 5
    return Math.abs(this.seed % 1000) / 1000
  }

  isPlaying(): boolean {
    return this.timer !== null
  }

  getScene(): MusicScene {
    return this.scene
  }

  /** Current slewed intensity. Exposed for the verification harness. */
  getIntensity(): number {
    return this.current
  }

  /** Section currently playing. Exposed for the verification harness. */
  getSection(): Section {
    return this.section
  }

  getTrackId(): string {
    return this.track.id
  }

  /** Part currently playing. Exposed so the harness can prove the form moves. */
  getPartId(): string {
    return this.track.form[this.formIndex] ?? ''
  }

  /**
   * Switches track, persisting the choice. Used by the verification harness and
   * by the automatic handover; people use `nextTrack()`.
   *
   * `now` swaps at the next bar line, roughly a second and a half away; without
   * it the swap waits for the end of the current part, which can be four bars.
   * That distinction is the whole difference between an automatic handover
   * (which should land on a phrase boundary) and a button press (which has to
   * feel like it did something).
   */
  setTrack(id: string, now = false): void {
    const next = getTrack(id)
    audio.setSettings({ track: next.id })
    if (!this.isPlaying() || next.id === this.track.id) {
      this.track = next
      this.pendingTrack = null
      this.beginTrack()
      return
    }
    this.pendingTrack = next
    this.pendingNow = now
  }

  /**
   * Skips to the next track in the shuffle bag, refilling it when empty.
   *
   * This is the only way a person changes track: there is no picker. Choosing
   * from a list means reading three names to make a decision nobody came here to
   * make, whereas "not this one" is a judgement you can act on in one tap.
   */
  nextTrack(): void {
    this.setTrack(this.takeFromQueue(), true)
  }

  /** How many parts this track plays before handing over. */
  private partsPerTrack(): number {
    return this.partsOverride ?? this.track.form.length * PASSES_PER_TRACK
  }

  /**
   * Shortens a track, for the verification harness only.
   *
   * A real track runs about two minutes, which is the right length and far too
   * long for a harness to sit through — so the automatic handover would be the
   * one behaviour here that nothing ever checks. Same test seam the server uses
   * for `AFKKickThreshold`; pass `null` to restore.
   */
  setPartsPerTrack(parts: number | null): void {
    this.partsOverride = parts
  }

  private takeFromQueue(): string {
    if (this.queue.length === 0) {
      this.queue = shuffledOrder(TRACKS.map((t) => t.id), this.track.id, () => this.rand())
    }
    return this.queue.shift() ?? this.track.id
  }

  /** Resets the position counters for a track that is starting now. */
  private beginTrack(): void {
    this.formIndex = 0
    this.partStep = 0
    this.partPass = 0
    this.partsPlayed = 0
    this.retuneDelays()
  }

  /**
   * Covers a track change with a short dip.
   *
   * Two pieces of music butt-joined on a bar line still click, because the tails
   * of the outgoing one (reverb, delay repeats, a pad's 1.2s release) are cut
   * mid-air. Fading down into the seam and back out of it costs a quarter of a
   * second and removes the only artefact of the swap.
   */
  private dipThrough(ctx: AudioContext, at: number): void {
    const out = this.out
    if (!out) return
    const from = Math.max(ctx.currentTime, at - 0.18)
    out.gain.cancelScheduledValues(from)
    out.gain.setValueAtTime(out.gain.value, from)
    out.gain.linearRampToValueAtTime(0.06, at)
    out.gain.linearRampToValueAtTime(1, at + 0.28)
  }

  setIntensity(value: number): void {
    this.target = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  }

  /** Seconds per sixteenth, from the current track's tempo. */
  private stepDur(): number {
    return 60 / this.track.bpm / 4
  }

  private barDur(): number {
    return this.stepDur() * STEPS_PER_BAR
  }

  /**
   * Own output stage, between the voices and the music bus, so the bed can be
   * ducked without touching the user's music volume.
   */
  private output(): GainNode | null {
    const ctx = audio.context()
    const bus = audio.musicDestination()
    if (!ctx || !bus) return null
    if (!this.out) {
      this.out = ctx.createGain()
      this.out.gain.value = 1
      // Fixed output trim, downstream of the duck so `duck()` can keep treating
      // 1 as nominal on `out.gain`.
      //
      // Headroom is a real problem here: the pad is up to 7 unison voices per
      // chord tone with a long release, so chords overlap, and a drop stacks that
      // under an arp, a lead, a counter-line, stabs, a bass and drums. Measured
      // bare, the bed peaked at 0.73 with the music slider at 1 — clipping once
      // effects play over it. A `DynamicsCompressor` was the obvious fix and the
      // wrong one: Chrome's applies an internal makeup gain, so the "limiter"
      // came back *louder* (peak 0.81, RMS +45%). One multiplication is
      // predictable, and every voice level is tuned against it.
      const trim = ctx.createGain()
      trim.gain.value = 0.55
      this.out.connect(trim)
      trim.connect(bus)
      this.buildGraph(ctx, this.out)
    }
    return this.out
  }

  /**
   * The fixed part of the graph, built once: pad bus, reverb, the two delays and
   * the kick's waveshaper.
   *
   * All of it hangs off `out`, upstream of the duck, so `duck()` attenuates wet
   * and dry together — a fanfare over a reverb tail that ignored the duck would
   * be the same mush the duck exists to prevent.
   */
  private buildGraph(ctx: AudioContext, out: GainNode) {
    this.padBus = ctx.createGain()
    this.padBus.gain.value = 1
    this.padBus.connect(out)

    // Three lowpassed comb delays. A convolver would sound lusher, but this bed
    // runs next to card animations on a phone, and "latency → smooth animation"
    // outranks "lush" in this repo.
    const revIn = ctx.createGain()
    const revOut = ctx.createGain()
    revOut.gain.value = 0.5
    const preTone = ctx.createBiquadFilter()
    preTone.type = 'lowpass'
    preTone.frequency.value = 4200
    revIn.connect(preTone)
    for (const [time, fb] of [[0.037, 0.78], [0.041, 0.75], [0.053, 0.72]]) {
      const comb = ctx.createDelay(0.2)
      comb.delayTime.value = time
      const loop = ctx.createGain()
      loop.gain.value = fb
      const damp = ctx.createBiquadFilter()
      damp.type = 'lowpass'
      damp.frequency.value = 2600
      preTone.connect(comb)
      comb.connect(damp)
      damp.connect(loop)
      loop.connect(comb)
      damp.connect(revOut)
    }
    revOut.connect(out)
    this.reverbIn = revIn

    // Dotted delays — this genre's whole sense of space. The times are bar
    // fractions recomputed on every tempo change (`retuneDelays`); typed in as
    // seconds they would land between the beats and the groove would die.
    const echo = (feedback: number, level: number, tone: number): [GainNode, DelayNode] => {
      const input = ctx.createGain()
      input.gain.value = level
      const delay = ctx.createDelay(2)
      const fb = ctx.createGain()
      fb.gain.value = feedback
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = tone
      input.connect(delay)
      delay.connect(lp)
      lp.connect(fb)
      fb.connect(delay)
      lp.connect(out)
      return [input, delay]
    }
    const [leadIn, leadDelay] = echo(0.55, 0.5, 3200)
    const [arpIn, arpDelay] = echo(0.45, 0.4, 2600)
    this.leadEchoIn = leadIn
    this.leadDelay = leadDelay
    this.arpEchoIn = arpIn
    this.arpDelay = arpDelay
    this.retuneDelays()

    const curve = new Float32Array(1024)
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1
      curve[i] = Math.tanh(x * 2.2)
    }
    this.shaper = ctx.createWaveShaper()
    this.shaper.curve = curve
    this.shaper.oversample = '2x'
    this.shaper.connect(out)
  }

  /** Keeps the dotted delays locked to the current track's tempo. */
  private retuneDelays(): void {
    const bar = this.barDur()
    if (this.leadDelay) this.leadDelay.delayTime.value = bar * (3 / 8)
    if (this.arpDelay) this.arpDelay.delayTime.value = bar * (3 / 16)
  }

  /** One buffer of white noise, reused by every percussion voice and the riser. */
  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = Math.floor(ctx.sampleRate * 2)
      const buf = ctx.createBuffer(1, len, ctx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
      this.noiseBuf = buf
    }
    return this.noiseBuf
  }

  /**
   * Pulls the bed down for `ms`, then brings it back.
   *
   * Used under the win/lose fanfares: two pieces of music competing for the same
   * moment makes both of them mush, and the fanfare is the one that matters.
   */
  duck(ms = 2200, amount = 0.22): void {
    const ctx = audio.context()
    const out = this.output()
    if (!ctx || !out) return
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(amount, t + 0.12)
    out.gain.setValueAtTime(amount, t + ms / 1000)
    out.gain.linearRampToValueAtTime(1, t + ms / 1000 + 0.5)
  }

  start(scene: MusicScene): void {
    this.scene = scene
    if (scene === 'off') {
      this.stop()
      return
    }
    if (!audio.isReady() || this.timer) return
    // Seed the shuffle from the clock, once. The generator is otherwise
    // deterministic — fine for debugging a rhythm, useless for "play them in a
    // random order", which would hand every session the same order forever.
    this.seed = (Date.now() & 0x7fffffff) | 1
    this.queue = shuffledOrder(TRACKS.map((t) => t.id), null, () => this.rand())
    this.track = getTrack(this.takeFromQueue())
    audio.setSettings({ track: this.track.id })
    this.beginTrack()
    this.barCount = 0
    this.lastSlewAt = 0
    this.nextStepTime = audio.now() + 0.08
    this.timer = setInterval(() => this.schedule(), TICK_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.scene = 'off'
  }

  private part(): PartDef {
    return partById(this.track, this.track.form[this.formIndex]) ?? this.track.parts[0]
  }

  private schedule(): void {
    const ctx = audio.context()
    const dest = this.output()
    if (!ctx || !dest || !audio.isReady() || audio.getSettings().muted) return

    const horizon = ctx.currentTime + LOOKAHEAD
    // Recover from a tab that was backgrounded: never try to catch up on
    // thousands of missed steps, just resync to now.
    if (this.nextStepTime < ctx.currentTime - 1) this.nextStepTime = ctx.currentTime + 0.05

    let guard = 0
    while (this.nextStepTime < horizon && guard++ < 64) {
      this.emitStep(this.nextStepTime, ctx, dest)
      this.nextStepTime += this.stepDur()
      this.advance()
    }
  }

  /** Moves one sixteenth on, crossing part boundaries and applying a track swap. */
  private advance(): void {
    this.partStep++
    if (this.partStep % STEPS_PER_BAR === 0) this.barCount++
    const len = this.part().bars.length * STEPS_PER_BAR
    if (this.partStep < len) return

    this.partStep = 0
    this.partsPlayed++

    // A track that has played its length hands over to the next one in the bag.
    // The handover waits for this part boundary rather than a bar line: it is not
    // a response to anything a person did, so it can afford to land on a phrase.
    if (!this.pendingTrack && this.partsPlayed >= this.partsPerTrack()) {
      this.pendingTrack = getTrack(this.takeFromQueue())
      this.pendingNow = false
    }
    if (this.pendingTrack) {
      this.applyPendingTrack()
      return
    }

    const before = this.formIndex
    this.formIndex = nextFormIndex(this.track, this.formIndex, this.section)
    if (this.formIndex === before) this.partPass++
    else this.partPass = 0
  }

  private applyPendingTrack(): void {
    if (!this.pendingTrack) return
    this.track = this.pendingTrack
    this.pendingTrack = null
    this.pendingNow = false
    // Both routes in — button and end-of-track — get the dip. `advance()` has no
    // scheduler time to hand to `dipThrough`, so it is flagged here and applied
    // on the next emitted step, which is the seam itself.
    this.dipPending = true
    audio.setSettings({ track: this.track.id })
    this.beginTrack()
  }

  /**
   * Moves `current` toward `target` at SLEW_PER_SEC.
   *
   * Intensity is derived from discrete game events, so it arrives in jumps — a
   * +4 landing can take it from 0.34 to 0.7 between one message and the next.
   * Applied raw, the arrangement would cut from breakdown to drop mid-bar.
   * Slewing turns that into a build, which is what the tension actually feels
   * like — and it is what gives the riser something real to announce.
   *
   * The rate is per *second*, not per step: a sixteenth at 138 BPM lasts 109ms,
   * so a per-step rate made the ramp depend on the tempo and took 14 seconds to
   * cross the range, by which time the round was over.
   */
  private slew(now: number): void {
    const dt = this.lastSlewAt === 0 ? 0 : Math.min(0.5, Math.max(0, now - this.lastSlewAt))
    this.lastSlewAt = now
    const maxDelta = SLEW_PER_SEC * dt
    const d = this.target - this.current
    if (Math.abs(d) <= maxDelta) this.current = this.target
    else this.current += Math.sign(d) * maxDelta
  }

  /** Sine LFO in 0..1 over `bars` bars. */
  private lfo(bars: number, offset = 0): number {
    const pos = this.barCount + (this.partStep % STEPS_PER_BAR) / STEPS_PER_BAR
    return 0.5 + 0.5 * Math.sin((2 * Math.PI * (pos + offset)) / bars)
  }

  private emitStep(when: number, ctx: AudioContext, dest: GainNode) {
    // A person pressed "next": swap on this bar line rather than making them wait
    // out the part. It happens *before* anything below reads the track, so the
    // new one gets its own downbeat — applying it later and returning early
    // silently swallowed the first sixteenth, which is where the kick, the pad
    // and the first note of the tune all live.
    if (this.pendingTrack && this.pendingNow && this.partStep % STEPS_PER_BAR === 0) {
      this.applyPendingTrack()
    }
    if (this.dipPending) {
      this.dipThrough(ctx, when)
      this.dipPending = false
    }

    const track = this.track
    const part = this.part()
    const step = this.partStep
    const bar = Math.floor(step / STEPS_PER_BAR)
    const inBar = step % STEPS_PER_BAR
    const barDef = part.bars[bar]
    const lobby = this.scene === 'lobby'
    const stepDur = this.stepDur()

    this.slew(when)
    if (inBar === 0) {
      // The arrangement is frozen at the bar line: a layer that appears on beat 3
      // sounds like a mistake, the same layer on beat 1 sounds intended.
      this.barIntensity = this.current
      this.section = sectionFor(this.barIntensity, lobby)

      const lastBar = bar === part.bars.length - 1
      const next = partById(track, track.form[nextFormIndex(track, this.formIndex, this.section)])
      // Build into a chorus. This is the single biggest thing separating a song
      // from a loop: the arrival is announced before it happens.
      if (lastBar && next?.role === 'chorus' && this.section !== 'breakdown') {
        this.riser(ctx, dest)
      } else if (!lobby && this.section !== 'drop' && this.target - this.current > RISER_GAP) {
        // Otherwise a riser only fires from the *gap*: the game has asked for
        // more tension than the bed has reached, so there is a real build.
        this.riser(ctx, dest)
      }
      if (step === 0 && LAYERS[this.section].crash && part.role === 'chorus') {
        this.crash(ctx, dest, when)
      }
    }

    const L = LAYERS[this.section]

    // ── Pump: stepped on every sixteenth, pad bus only.
    if (this.padBus) {
      this.padBus.gain.setValueAtTime(track.pump[inBar % track.pump.length], when)
    }

    // ── Pad: one sustained chord per bar.
    if (L.pad && inBar === 0 && this.padBus) {
      for (const midi of barDef.chord) {
        this.synth(ctx, this.padBus, track.voices.pad, mtof(midi), when, this.barDur())
      }
    }

    // ── Arp: the texture that never stops. Cutoff sweeps slowly across sixteen
    //    bars, or sits closed when the section wants it out of the way.
    const arpEvery = STEPS_PER_BAR / part.arpDiv
    if (inBar % arpEvery === 0) {
      const spec = track.voices.arp
      const idx = (inBar / arpEvery) % barDef.arp.length
      const open = spec.filter * (0.35 + 0.65 * this.lfo(16))
      this.synth(ctx, dest, spec, mtof(barDef.arp[idx]), when, stepDur * arpEvery, {
        gain: spec.gain * L.arpGain,
        filter: L.arpCutoff ?? open,
        pan: inBar % 2 === 0 ? -0.18 : 0.18,
      })
    }

    // ── Lead, and its answer.
    if (L.lead && part.lead) {
      const every = STEPS_PER_BAR / part.div
      if (inBar % every === 0) {
        const row = part.lead[bar]
        const slot = inBar / every
        const midi = row[slot]
        if (midi > 0) {
          const len = noteLength(row, slot) * every * stepDur
          // Alternate passes of a chorus lift an octave: same tune, more arrival.
          const lift = L.leadOctave && part.role === 'chorus' && this.partPass % 2 === 1 ? 12 : 0
          this.synth(ctx, dest, track.voices.lead, mtof(midi + lift), when, len)
          if (L.leadOctave && lift === 0) {
            this.synth(ctx, dest, track.voices.lead, mtof(midi + 12), when, len * 0.7, {
              gain: track.voices.lead.gain * 0.3,
              echo: null,
              reverb: 0.3,
            })
          }
        }
      }
    }
    if (L.counter && part.counter) {
      const every = STEPS_PER_BAR / part.div
      if (inBar % every === 0) {
        const row = part.counter[bar]
        const slot = inBar / every
        const midi = row[slot]
        if (midi > 0) {
          const len = noteLength(row, slot) * every * stepDur
          this.synth(ctx, dest, track.voices.lead, mtof(midi), when, len, {
            gain: track.voices.lead.gain * 0.55,
            filter: track.voices.lead.filter * 0.6,
          })
        }
      }
    }

    // ── Stabs: offbeat chord hits, the electro-house signature.
    if (L.stabs && part.stabs?.includes(inBar)) {
      for (const midi of barDef.chord.slice(1)) {
        this.synth(ctx, dest, track.voices.stab, mtof(midi), when, stepDur)
      }
    }

    // ── Bass.
    if (L.bass) {
      const offset = part.bass[inBar]
      if (offset !== null && offset !== undefined) {
        this.bassNote(ctx, dest, barDef.root + offset, when)
      }
    }

    // ── Drums.
    const kit = KITS[track.drums]
    if (L.kick && kit.kick.includes(inBar)) this.kick(ctx, when)
    if (L.hats && kit.hat.includes(inBar)) {
      this.noiseVoice(ctx, dest, {
        when, dur: 0.045, gain: 0.05 * (0.85 + this.rand() * 0.3),
        type: 'highpass', freq: 8000, pan: (this.lfo(0.5) - 0.5) * 0.4,
      })
    }
    if (L.hats && kit.openHat.includes(inBar)) {
      this.noiseVoice(ctx, dest, {
        when, dur: 0.13, gain: 0.03, type: 'highpass', freq: 7000, pan: 0.12,
      })
    }
    if (L.ride && kit.ride.includes(inBar)) {
      this.noiseVoice(ctx, dest, {
        when, dur: 0.03, gain: 0.05 * [0.35, 0.15, 0.25, 0.15][inBar % 4],
        type: 'highpass', freq: 9200, pan: -0.1,
      })
    }
    if (L.clap === 'beats' && kit.clap.includes(inBar)) this.clap(ctx, dest, when)
    if (L.clap === 'sparse' && inBar === 8 && bar % 2 === 0) this.clap(ctx, dest, when)

    // ── Fill: the last beat of a part, when there are drums to fill with. Four
    //    rising snare hits is a cliché, and clichés are how a listener knows a
    //    section is ending.
    const lastBar = bar === part.bars.length - 1
    if ((L.kick || L.hats) && lastBar && inBar >= 12) {
      this.noiseVoice(ctx, dest, {
        when, dur: 0.06, gain: 0.03 + (inBar - 12) * 0.012,
        type: 'bandpass', freq: 1400 + (inBar - 12) * 260, Q: 1.2, reverb: 0.25,
      })
    }
  }

  /**
   * One synthesised voice: `unison` detuned oscillators through a lowpass with an
   * ADSR, plus optional sends and pan.
   *
   * Detuned stacks are the sound of this genre — a single oscillator playing the
   * same notes reads as a test tone however good the tune is. Level is divided by
   * the unison count so widening a voice never also makes it louder.
   */
  private synth(
    ctx: AudioContext,
    dest: AudioNode,
    spec: SynthSpec,
    freq: number,
    when: number,
    dur: number,
    override?: { gain?: number; filter?: number; pan?: number; reverb?: number; echo?: SynthSpec['echo'] },
  ) {
    const gain = override?.gain ?? spec.gain
    const filter = override?.filter ?? spec.filter
    const reverb = override?.reverb ?? spec.reverb
    const echoName = override?.echo === undefined ? spec.echo : override.echo
    const { attack, decay, sustain, release }: Adsr = spec.adsr

    const g = ctx.createGain()
    const sus = Math.max(0.0002, gain * sustain)
    const relStart = Math.max(when + attack + decay, when + dur)
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(gain, when + attack)
    g.gain.exponentialRampToValueAtTime(sus, when + attack + decay)
    g.gain.setValueAtTime(sus, relStart)
    g.gain.exponentialRampToValueAtTime(0.0001, relStart + release)
    const end = relStart + release

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(filter, when)
    lp.Q.value = spec.q ?? 0.9
    lp.connect(g)

    const level = 1 / spec.unison
    const oscs: OscillatorNode[] = []
    for (let n = 0; n < spec.unison; n++) {
      const osc = ctx.createOscillator()
      osc.type = spec.wave
      osc.frequency.setValueAtTime(freq, when)
      const cents = spec.unison === 1 ? 0 : -spec.detune / 2 + (spec.detune * n) / (spec.unison - 1)
      osc.detune.setValueAtTime(cents, when)
      const mix = ctx.createGain()
      mix.gain.value = level
      osc.connect(mix)
      mix.connect(lp)
      oscs.push(osc)
    }

    let tail: AudioNode = g
    if (override?.pan !== undefined) {
      const panner = ctx.createStereoPanner()
      panner.pan.setValueAtTime(override.pan, when)
      g.connect(panner)
      tail = panner
    }
    tail.connect(dest)
    this.send(ctx, tail, this.reverbIn, reverb)
    if (echoName) {
      this.send(ctx, tail, echoName === 'lead' ? this.leadEchoIn : this.arpEchoIn, 1)
    }

    for (const osc of oscs) {
      osc.start(when)
      osc.stop(end + 0.02)
    }
  }

  private send(ctx: AudioContext, from: AudioNode, to: GainNode | null, amount?: number) {
    if (!to || !amount) return
    const g = ctx.createGain()
    g.gain.value = amount
    from.connect(g)
    g.connect(to)
  }

  /**
   * The bass: a sine sub for weight plus a filtered body for movement, one
   * lowpass, no waveshaper.
   *
   * The reference sketch reaches for `lpq(8)` and `shape(.3)` — a great
   * three-minute sound and an exhausting twenty-minute one, since the resonant
   * peak lands where the ear is most sensitive and the distortion fills every gap
   * the arp left. The user asked for this to be gentler by name.
   */
  private bassNote(ctx: AudioContext, dest: AudioNode, midi: number, when: number) {
    const spec = this.track.voices.bass
    const dur = this.stepDur() * spec.length
    const freq = mtof(midi)
    const env = (param: AudioParam, peak: number) => {
      const sus = Math.max(0.0002, peak * 0.25)
      param.setValueAtTime(0.0001, when)
      param.exponentialRampToValueAtTime(peak, when + 0.002)
      param.exponentialRampToValueAtTime(sus, when + 0.12)
      param.setValueAtTime(sus, when + dur)
      param.exponentialRampToValueAtTime(0.0001, when + dur + 0.05)
    }

    const sub = ctx.createOscillator()
    sub.type = 'sine'
    sub.frequency.setValueAtTime(freq, when)
    const subG = ctx.createGain()
    env(subG.gain, spec.subGain)
    sub.connect(subG)
    subG.connect(dest)
    sub.start(when)
    sub.stop(when + dur + 0.1)

    const body = ctx.createOscillator()
    body.type = spec.bodyWave
    body.frequency.setValueAtTime(freq * 2, when)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    const [lo, hi] = spec.cutoff
    lp.frequency.setValueAtTime(lo + this.lfo(8) * (hi - lo), when)
    lp.Q.value = spec.q
    if (spec.wobble) {
      // A talking bass, slow enough not to become a novelty you tire of.
      const lfo = ctx.createOscillator()
      lfo.frequency.setValueAtTime(spec.wobble, when)
      const depth = ctx.createGain()
      depth.gain.value = (hi - lo) * 0.45
      lfo.connect(depth)
      depth.connect(lp.frequency)
      lfo.start(when)
      lfo.stop(when + dur + 0.1)
    }
    const bodyG = ctx.createGain()
    env(bodyG.gain, spec.bodyGain)
    body.connect(lp)
    lp.connect(bodyG)
    bodyG.connect(dest)
    body.start(when)
    body.stop(when + dur + 0.1)
  }

  /** One-shot noise voice, used by every percussion sound and the riser. */
  private noiseVoice(
    ctx: AudioContext,
    dest: AudioNode,
    o: {
      when: number
      dur: number
      gain: number
      type: BiquadFilterType
      freq: number
      endFreq?: number
      Q?: number
      pan?: number
      reverb?: number
      attack?: number
    },
  ) {
    const src = ctx.createBufferSource()
    src.buffer = this.noise(ctx)
    src.loop = true
    // Start somewhere else in the buffer each time so repeated hits differ.
    const offset = this.rand() * 1.5

    const filter = ctx.createBiquadFilter()
    filter.type = o.type
    filter.frequency.setValueAtTime(o.freq, o.when)
    if (o.endFreq) filter.frequency.exponentialRampToValueAtTime(o.endFreq, o.when + o.dur)
    if (o.Q) filter.Q.value = o.Q

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, o.when)
    g.gain.exponentialRampToValueAtTime(o.gain, o.when + (o.attack ?? 0.002))
    g.gain.exponentialRampToValueAtTime(0.0001, o.when + o.dur)

    src.connect(filter)
    filter.connect(g)
    let tail: AudioNode = g
    if (o.pan !== undefined) {
      const panner = ctx.createStereoPanner()
      panner.pan.setValueAtTime(o.pan, o.when)
      g.connect(panner)
      tail = panner
    }
    tail.connect(dest)
    this.send(ctx, tail, this.reverbIn, o.reverb)
    src.start(o.when, offset)
    src.stop(o.when + o.dur + 0.05)
  }

  private kick(ctx: AudioContext, when: number) {
    const dest = this.shaper ?? this.out
    if (!dest) return
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(158, when)
    osc.frequency.exponentialRampToValueAtTime(46, when + 0.095)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(0.3, when + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.2)
    osc.connect(g)
    g.connect(dest)
    osc.start(when)
    osc.stop(when + 0.24)
    // Click transient: without it the kick is felt but not heard on the laptop
    // speakers most of this game gets played on.
    this.noiseVoice(ctx, dest, { when, dur: 0.02, gain: 0.09, type: 'highpass', freq: 1900 })
  }

  /** Three quick bursts then a body — one burst reads as a tick, not as hands. */
  private clap(ctx: AudioContext, dest: AudioNode, when: number) {
    for (let n = 0; n < 3; n++) {
      this.noiseVoice(ctx, dest, {
        when: when + n * 0.011, dur: 0.02, gain: 0.055, type: 'bandpass', freq: 1500, Q: 1.4,
      })
    }
    this.noiseVoice(ctx, dest, {
      when: when + 0.032, dur: 0.15, gain: 0.06, type: 'bandpass', freq: 1300, Q: 0.9, reverb: 0.4,
    })
  }

  private crash(ctx: AudioContext, dest: AudioNode, when: number) {
    this.noiseVoice(ctx, dest, {
      when, dur: 1.6, gain: 0.06, type: 'highpass', freq: 5000, reverb: 0.5, attack: 0.006,
    })
  }

  /** One bar of noise sweeping up — the build-up. */
  private riser(ctx: AudioContext, dest: AudioNode) {
    const dur = this.barDur()
    this.noiseVoice(ctx, dest, {
      when: this.nextStepTime,
      dur,
      gain: 0.05,
      type: 'bandpass',
      freq: 400,
      endFreq: 9000,
      Q: 1.1,
      reverb: 0.5,
      attack: dur * 0.8,
    })
  }
}

export const music = new MusicBed()
export { TRACKS, getTrack, DEFAULT_TRACK_ID }
