/**
 * Adaptive music bed — generative, synthesised, no audio files and no
 * third-party dependency.
 *
 * The soundtrack is a four-bar loop over a fixed progression. What changes is
 * *density*, not melody: an `intensity` value between 0 and 1 decides how many
 * layers are audible and how fast the loop runs. The game raises it when
 * someone is one card from winning or a draw stack is climbing, and drops it
 * back between rounds — so the music tracks the table's tension without anyone
 * having to compose a cue for every situation.
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

const STEPS_PER_BAR = 16
const BARS = PROGRESSION.length
const TOTAL_STEPS = STEPS_PER_BAR * BARS

function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

class MusicBed {
  private timer: ReturnType<typeof setInterval> | null = null
  private step = 0
  private nextStepTime = 0
  private intensity = 0.35
  private scene: MusicScene = 'off'
  /** Deterministic per-loop variation, so the arp is not a metronome. */
  private seed = 1

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

  setIntensity(value: number): void {
    this.intensity = Math.min(1, Math.max(0, value))
  }

  start(scene: MusicScene): void {
    this.scene = scene
    if (scene === 'off') {
      this.stop()
      return
    }
    if (!audio.isReady() || this.timer) return
    this.step = 0
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
    const bpm = this.scene === 'lobby' ? 76 : 88 + this.intensity * 36
    return 60 / bpm / 4
  }

  private schedule(): void {
    const ctx = audio.context()
    const dest = audio.musicDestination()
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
    }
  }

  private emitStep(step: number, when: number, ctx: AudioContext, dest: AudioNode) {
    const bar = Math.floor(step / STEPS_PER_BAR)
    const inBar = step % STEPS_PER_BAR
    const harmony = PROGRESSION[bar]
    const lobby = this.scene === 'lobby'
    const i = lobby ? 0.2 : this.intensity

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

    // ── Bass: root on the downbeat, plus an eighth-note push once it matters.
    if (!lobby && i > 0.12) {
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
    if (!lobby && i > 0.38) {
      const dense = i > 0.72
      if (dense ? inBar % 2 === 1 : inBar % 4 === 2) {
        this.hat(ctx, dest, when, 0.035 + i * 0.03)
      }
    }

    // ── Kick: only at high intensity, and only on 1 and 3.
    if (!lobby && i > 0.62 && (inBar === 0 || inBar === 8)) {
      this.kick(ctx, dest, when, 0.16 + i * 0.08)
    }

    // ── Arp: the melodic layer. Sparse and slow in the lobby, running 16ths
    //    when someone is about to go out.
    const arpEvery = lobby ? 8 : i > 0.75 ? 2 : i > 0.45 ? 4 : 8
    if (inBar % arpEvery === 0) {
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
        gain: (lobby ? 0.05 : 0.045) + i * 0.03,
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
