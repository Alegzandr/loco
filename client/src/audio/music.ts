/**
 * Adaptive music bed — generative, synthesised, no audio files and no
 * third-party dependency.
 *
 * Strudel (`@strudel/*`, `superdough`) was evaluated for this and rejected: it
 * is AGPL-3.0-or-later, and bundling it into a client served over the network
 * would pull the whole of LOCO under §13. It is also a live-coding engine, whose
 * value is improvising at a keyboard — what this game needs is a deterministic
 * bed driven by game state, which is what follows.
 *
 * The soundtrack is a four-bar loop over a fixed progression. What changes is
 * *density and tempo*, not harmony: an `intensity` value between 0 and 1 decides
 * how many layers are audible and how fast the loop runs. The game raises it
 * when someone is one card from winning or a draw stack is climbing, and drops
 * it back between rounds — so the music tracks the table's tension without
 * anyone having to compose a cue for every situation.
 *
 * Scheduling uses the standard Web Audio lookahead pattern: a coarse timer wakes
 * up often, and every event it finds inside the next slice is scheduled with a
 * sample-accurate start time. setTimeout jitter therefore never reaches the
 * output.
 */
import { audio } from './engine'

export type MusicScene = 'lobby' | 'game' | 'off'

/** How far ahead of the clock notes are scheduled, in seconds. */
const LOOKAHEAD = 0.18
/** How often the scheduler wakes, in ms. Must be well under LOOKAHEAD. */
const TICK_MS = 40

/** i – VI – III – VII in A minor: warm, loops without a seam, never resolves hard. */
const PROGRESSION = [
  { bass: 33, chord: [57, 60, 64] }, // Am
  { bass: 29, chord: [53, 57, 60] }, // F
  { bass: 36, chord: [55, 60, 64] }, // C
  { bass: 31, chord: [55, 59, 62] }, // G
]

/** Pentatonic A minor, two octaves — every note works over every chord above. */
const ARP_SCALE = [69, 72, 74, 76, 79, 81, 84, 86]

/**
 * The LOCO motif. Eight notes of A-minor pentatonic that sit correctly over all
 * four chords, so it can enter on any bar without a transition. A game needs one
 * line people can hum; a purely random arp is texture, not a theme.
 */
const MOTIF = [76, 74, 72, 74, 76, 79, 76, 72]

const STEPS_PER_BAR = 16
const BARS = PROGRESSION.length
const TOTAL_STEPS = STEPS_PER_BAR * BARS

/** Intensity at which each layer joins. Ordered so layers stack, never swap. */
const ENTER = {
  bass: 0.12,
  hats: 0.38,
  motif: 0.5,
  kick: 0.62,
  denseHats: 0.72,
  fastArp: 0.75,
}

/**
 * Intensity units per second. A full swing takes ~1.8s — about two bars, so the
 * crescendo lands on a bar line rather than dragging past the moment.
 */
const SLEW_PER_SEC = 0.55

function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

class MusicBed {
  private timer: ReturnType<typeof setInterval> | null = null
  private out: GainNode | null = null
  private step = 0
  private nextStepTime = 0
  /** Where the game wants the intensity. */
  private target = 0.35
  /** Where the bed actually is — slewed toward the target, never jumped. */
  private current = 0.35
  /** Tempo is sampled once per bar so the loop never speeds up mid-phrase. */
  private barIntensity = 0.35
  private scene: MusicScene = 'off'
  /** Loop counter, used to vary the motif so the bed never becomes wallpaper. */
  private cycle = 0
  /** Deterministic per-loop variation, so the arp is not a metronome. */
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

  setIntensity(value: number): void {
    this.target = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
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
      this.out.connect(bus)
    }
    return this.out
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
    this.step = 0
    this.cycle = 0
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

  /** Seconds per 16th note. Tempo climbs with intensity: 88 → 124 BPM. */
  private stepDuration(): number {
    const bpm = this.scene === 'lobby' ? 76 : 88 + this.barIntensity * 36
    return 60 / bpm / 4
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
      this.emitStep(this.step, this.nextStepTime, ctx, dest)
      this.nextStepTime += this.stepDuration()
      this.step = (this.step + 1) % TOTAL_STEPS
      if (this.step === 0) this.cycle++
    }
  }

  /**
   * Moves `current` toward `target` at SLEW_PER_SEC.
   *
   * Intensity is derived from discrete game events, so it arrives in jumps — a
   * +4 landing can take it from 0.34 to 0.7 between one message and the next.
   * Applied raw, whole layers would snap in and out mid-bar. Slewing turns that
   * into a crescendo, which is what the tension actually feels like.
   *
   * The rate is per *second*, not per step: a 16th note at 88 BPM lasts 170ms,
   * so a per-step rate made the ramp depend on the tempo it was supposed to be
   * driving — and took 14 seconds to cross the range, by which time the round
   * was over.
   */
  private slew(now: number): void {
    const dt = this.lastSlewAt === 0 ? 0 : Math.min(0.5, Math.max(0, now - this.lastSlewAt))
    this.lastSlewAt = now
    const maxDelta = SLEW_PER_SEC * dt
    const d = this.target - this.current
    if (Math.abs(d) <= maxDelta) this.current = this.target
    else this.current += Math.sign(d) * maxDelta
  }

  private emitStep(step: number, when: number, ctx: AudioContext, dest: AudioNode) {
    const bar = Math.floor(step / STEPS_PER_BAR)
    const inBar = step % STEPS_PER_BAR
    const harmony = PROGRESSION[bar]
    const lobby = this.scene === 'lobby'

    this.slew(when)
    // Layer decisions and tempo are frozen at the bar line: a layer that appears
    // on beat 3 sounds like a mistake, the same layer on beat 1 sounds intended.
    if (inBar === 0) this.barIntensity = this.current
    const i = lobby ? 0.2 : this.barIntensity

    // ── Pad: one sustained chord per bar. Always present; it is the room tone.
    if (inBar === 0) {
      const dur = this.stepDuration() * STEPS_PER_BAR * 0.98
      harmony.chord.forEach((m, idx) => {
        this.voice(ctx, dest, {
          freq: mtof(m),
          type: 'triangle',
          when,
          dur,
          attack: 0.5,
          release: 0.9,
          gain: 0.055 - idx * 0.008,
          filter: 1500 + i * 1400,
        })
      })
    }

    // ── Bass: root on the downbeat, plus pushes once it matters.
    if (!lobby && i > ENTER.bass) {
      const hit = inBar === 0 || (i > 0.5 && inBar === 8) || (i > 0.85 && inBar === 12)
      if (hit) {
        this.voice(ctx, dest, {
          freq: mtof(harmony.bass),
          type: 'sawtooth',
          when,
          dur: this.stepDuration() * 3.2,
          attack: 0.012,
          release: 0.16,
          gain: 0.1 + i * 0.05,
          filter: 320 + i * 420,
        })
      }
    }

    // ── Hats: offbeat 8ths, then 16ths when the table is tense.
    if (!lobby && i > ENTER.hats) {
      const dense = i > ENTER.denseHats
      if (dense ? inBar % 2 === 1 : inBar % 4 === 2) {
        this.hat(ctx, dest, when, 0.035 + i * 0.03)
      }
    }

    // ── Kick: only at high intensity, and only on 1 and 3.
    if (!lobby && i > ENTER.kick && (inBar === 0 || inBar === 8)) {
      this.kick(ctx, dest, when, 0.16 + i * 0.08)
    }

    // ── Motif: the actual theme. Enters mid-intensity as 8th notes across the
    //    first two bars of the loop, so it recurs often enough to be learned
    //    without playing continuously.
    const motifBars = bar < 2
    if (!lobby && i > ENTER.motif && motifBars && inBar % 2 === 0) {
      const idx = bar * 8 + inBar / 2
      // Every other pass lifts the phrase an octave: same tune, more urgency.
      const octave = this.cycle % 2 === 1 && i > 0.7 ? 12 : 0
      this.voice(ctx, dest, {
        freq: mtof(MOTIF[idx % MOTIF.length] + octave),
        type: 'square',
        when,
        dur: this.stepDuration() * 1.8,
        attack: 0.008,
        release: 0.1,
        gain: 0.05 + i * 0.025,
        filter: 2600 + i * 2200,
      })
    }

    // ── Arp: the filler layer. Sparse and slow in the lobby, running 16ths when
    //    someone is about to go out. Steps back where the motif plays so the two
    //    never fight for the same beat.
    const arpEvery = lobby ? 8 : i > ENTER.fastArp ? 2 : i > 0.45 ? 4 : 8
    const motifOwnsThisBeat = !lobby && i > ENTER.motif && motifBars && inBar % 2 === 0
    if (inBar % arpEvery === 0 && !motifOwnsThisBeat) {
      // Bias the note choice toward the current chord tones so the line always
      // sounds intentional even though the pitch is picked at random.
      const pool = this.rand() < 0.55 ? harmony.chord.map((m) => m + 12) : ARP_SCALE
      const midi = pool[Math.floor(this.rand() * pool.length) % pool.length]
      this.voice(ctx, dest, {
        freq: mtof(midi),
        type: lobby ? 'sine' : 'square',
        when,
        dur: this.stepDuration() * (lobby ? 5 : 2.2),
        attack: 0.006,
        release: 0.12,
        gain: (lobby ? 0.05 : 0.04) + i * 0.025,
        filter: 2200 + i * 2600,
      })
    }
  }

  private voice(
    ctx: AudioContext,
    dest: AudioNode,
    o: {
      freq: number
      type: OscillatorType
      when: number
      dur: number
      attack: number
      release: number
      gain: number
      filter?: number
    },
  ) {
    const osc = ctx.createOscillator()
    osc.type = o.type
    osc.frequency.setValueAtTime(o.freq, o.when)

    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, o.when)
    g.gain.exponentialRampToValueAtTime(o.gain, o.when + o.attack)
    g.gain.setValueAtTime(o.gain, o.when + Math.max(o.attack, o.dur - o.release))
    g.gain.exponentialRampToValueAtTime(0.0001, o.when + o.dur)

    let node: AudioNode = osc
    if (o.filter) {
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.setValueAtTime(o.filter, o.when)
      osc.connect(lp)
      node = lp
    }
    node.connect(g)
    g.connect(dest)
    osc.start(o.when)
    osc.stop(o.when + o.dur + 0.05)
  }

  private hat(ctx: AudioContext, dest: AudioNode, when: number, gain: number) {
    const osc = ctx.createOscillator()
    osc.type = 'square'
    osc.frequency.setValueAtTime(7800, when)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.setValueAtTime(6000, when)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(gain, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045)
    osc.connect(hp)
    hp.connect(g)
    g.connect(dest)
    osc.start(when)
    osc.stop(when + 0.06)
  }

  private kick(ctx: AudioContext, dest: AudioNode, when: number, gain: number) {
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(150, when)
    osc.frequency.exponentialRampToValueAtTime(44, when + 0.11)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(gain, when + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.18)
    osc.connect(g)
    g.connect(dest)
    osc.start(when)
    osc.stop(when + 0.22)
  }
}

export const music = new MusicBed()
