/**
 * Sound effects — every one synthesised from oscillators and filtered noise,
 * and every one designed as a *thing* before it was written as a patch.
 *
 * The identity, in four materials:
 *  - **Card stock on felt.** A card is paper: it flicks, it cracks against the
 *    table, and the table answers with a low, short thud. Nothing that handles a
 *    card is a pitched tone; the hit is a resonant crack over a damped body,
 *    the slide is fibrous noise through a comb, and every hit lands a little to
 *    one side of the last (`spread`). A machine plays the same sample fifty
 *    times a round; a hand never does (`humanVariation`).
 *  - **Wood.** The interface is a mallet on wood — marimba and kalimba
 *    partials, a tick of attack noise — because the game is a table and its
 *    controls are things on it, not a phone's own beeps. Taps, backs, the turn
 *    coming round, somebody sitting down, a knock when a move is refused.
 *  - **Brass and bell.** The moments that shout — the call, the slam, the
 *    verdict, the match — are struck chords with a body: saw unison under a
 *    filter that opens on the transient, a bell partial on top (an FM pair, not
 *    a sample), a sub under the root. A cue is a chord, never a run, and no two
 *    moments share one; see `docs/notes/audio.md`.
 *  - **Air.** Before a slam and across a swap, a breath of noise that swells
 *    into the hit and pans across the room. The air is what says "something
 *    moved fast" without a single note being played.
 *
 * Nothing runs longer than ~1.2 s except the match fanfares. A card game plays
 * faster than its sounds decay if you let it.
 */
import { audio } from './engine'

// ─── Primitives ─────────────────────────────────────────────────────────────

let noiseBuffer: AudioBuffer | null = null

/** One shared white-noise buffer; regenerating it per hit is pure waste. */
function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer
  const len = Math.floor(ctx.sampleRate * 0.5)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuffer = buf
  return buf
}

/**
 * How much the next voice is allowed to differ from the last one.
 *
 * A card is played fifty times a round, and fifty copies of one sample is the
 * sound of a machine: real cards never land twice the same way. The handling
 * and the taps are pitched a few cents off and a shade softer or louder per
 * hit — under the threshold of "a different sound", over the threshold of
 * "the same sound again". The cues that *mean* something (a call, a catch, a
 * fanfare) are left exact: those are the game's vocabulary, and a word is not
 * pronounced differently each time. `humanVariation` is the pure half so the
 * range is testable; `variation` is what the helpers below read.
 */
export interface Variation {
  /** Frequency multiplier. */
  pitch: number
  /** Gain multiplier. */
  gain: number
  /** Stereo position, -1..1, for the voices that take one. */
  pan: number
}

const NEUTRAL: Variation = { pitch: 1, gain: 1, pan: 0 }
let variation: Variation = NEUTRAL

/** ±cents of detune, the gain floor, and the widest a hit may sit off centre. */
export const HUMAN_CENTS = 45
export const HUMAN_GAIN_FLOOR = 0.86
export const HUMAN_PAN = 0.22

export function humanVariation(rand: () => number = Math.random): Variation {
  const cents = (rand() * 2 - 1) * HUMAN_CENTS
  return {
    pitch: Math.pow(2, cents / 1200),
    gain: HUMAN_GAIN_FLOOR + (1 - HUMAN_GAIN_FLOOR) * rand(),
    pan: (rand() * 2 - 1) * HUMAN_PAN,
  }
}

const HUMANISED: ReadonlySet<string> = new Set([
  'cardPlay',
  'cardDraw',
  'cardDeal',
  'uiTap',
  'uiBack',
  'skip',
  'reverse',
  'countdown',
  'error',
])

/** Equal-tempered frequency for a MIDI note number. */
function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Where a voice ends up: the bus, optionally through a pan and a room send.
 * Every primitive routes through here so the panning, the send and the bus are
 * decided in one place.
 */
function out(ctx: AudioContext, dest: AudioNode, pan: number, reverb: number): GainNode {
  const g = ctx.createGain()
  let node: AudioNode = g
  if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner()
    p.pan.value = Math.max(-1, Math.min(1, pan))
    g.connect(p)
    node = p
  }
  node.connect(dest)
  if (reverb > 0) sendReverb(node, reverb)
  return g
}

/**
 * A short room on a send, for the sounds allowed to be an event. Zero for the
 * card handling: paper stays in the room the player is in.
 */
function sendReverb(from: AudioNode, amount: number): void {
  const verb = audio.sfxReverbSend()
  const ctx = audio.context()
  if (!verb || !ctx || amount <= 0) return
  const g = ctx.createGain()
  g.gain.value = amount
  from.connect(g)
  g.connect(verb)
}

interface Common {
  gain?: number
  delay?: number
  /** -1..1; the handling adds the hit's own spread on top. */
  pan?: number
  reverb?: number
}

interface ToneOpts extends Common {
  freq: number
  /** Glide target; omitted means a steady pitch. */
  toFreq?: number
  type?: OscillatorType
  dur?: number
  attack?: number
  /** Optional low-pass, in Hz. */
  filter?: number
}

/** A plain oscillator under an envelope. Kept for the audition; the voices below use the materials. */
function tone(o: ToneOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return

  const dur = o.dur ?? 0.18
  const attack = o.attack ?? 0.004
  const peak = (o.gain ?? 0.25) * variation.gain
  const t0 = ctx.currentTime + (o.delay ?? 0)

  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq * variation.pitch, t0)
  if (o.toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq * variation.pitch), t0 + dur)
  }

  const g = out(ctx, dest, (o.pan ?? 0) + variation.pan, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  let node: AudioNode = osc
  if (o.filter) {
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(o.filter, t0)
    osc.connect(lp)
    node = lp
  }
  node.connect(g)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

interface NoiseOpts extends Common {
  dur?: number
  /** Band-pass centre in Hz. */
  freq?: number
  q?: number
  /** Sweep the band-pass to this frequency across the hit. */
  toFreq?: number
  type?: BiquadFilterType
  /** Seconds before the peak: 0 is a hit, half the duration is a breath. */
  attack?: number
  /**
   * A comb on the noise (a sub-millisecond delay fed back on itself): what
   * makes noise sound like fibre — paper sliding, a riffle — rather than air.
   * The value is the feedback; 0 is off.
   */
  comb?: number
}

/** Filtered noise under an envelope: air, or with a comb, paper. */
function noise(o: NoiseOpts = {}): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return

  const dur = o.dur ?? 0.12
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const attack = Math.max(0.002, o.attack ?? 0.006)

  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  // A random start, so two hits in a row never begin on the same grains.
  const offset = Math.random() * 0.3

  const bp = ctx.createBiquadFilter()
  bp.type = o.type ?? 'bandpass'
  bp.frequency.setValueAtTime((o.freq ?? 2400) * variation.pitch, t0)
  if (o.toFreq !== undefined) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, o.toFreq * variation.pitch), t0 + dur)
  }
  bp.Q.value = o.q ?? 1.1

  const g = out(ctx, dest, (o.pan ?? 0) + variation.pan, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime((o.gain ?? 0.2) * variation.gain, t0 + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  src.connect(bp)
  if (o.comb && o.comb > 0) {
    const delay = ctx.createDelay(0.01)
    delay.delayTime.value = 0.0007 / variation.pitch
    const fb = ctx.createGain()
    fb.gain.value = Math.min(0.85, o.comb)
    bp.connect(delay)
    delay.connect(fb)
    fb.connect(delay)
    delay.connect(g)
  }
  bp.connect(g)
  src.start(t0, offset)
  src.stop(t0 + dur + 0.02)
}

interface ThudOpts extends Common {
  /** Where the body starts, in Hz, and how far it falls (a ratio, 0.35 = a big drop). */
  freq: number
  drop?: number
  dur?: number
}

/**
 * The table answering a hit: a sine that starts a little above its pitch and
 * falls into it while it dies. The drop is what makes it an impact rather than
 * a note.
 */
function thud(o: ThudOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return
  const dur = o.dur ?? 0.12
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const f = o.freq * variation.pitch
  const osc = ctx.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(f * 1.6, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * (o.drop ?? 0.7)), t0 + dur)
  const g = out(ctx, dest, (o.pan ?? 0) + variation.pan, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime((o.gain ?? 0.2) * variation.gain, t0 + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

interface SnapOpts extends Common {
  /** The resonance the crack rings at. */
  freq: number
  q?: number
  dur?: number
}

/** A crack: a burst of noise through a resonant band, over in tens of milliseconds. */
function snap(o: SnapOpts): void {
  noise({
    dur: o.dur ?? 0.028,
    freq: o.freq,
    q: o.q ?? 6,
    gain: o.gain ?? 0.2,
    delay: o.delay,
    pan: o.pan,
    reverb: o.reverb,
    attack: 0.002,
  })
}

interface MalletOpts extends Common {
  midi: number
  dur?: number
  /** Level of the fourth partial: 0 is a soft marimba, 0.5 a bright kalimba. */
  bright?: number
  /** A tick of attack noise, so the note has been struck and not switched on. */
  tick?: number
}

/**
 * A mallet on wood: the fundamental with a fourth partial that dies faster,
 * both sine, under a tick of noise on the attack. Marimba at the bottom of the
 * range, kalimba at the top. Every UI sound in the game is one of these.
 */
function mallet(o: MalletOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return
  const dur = o.dur ?? 0.22
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const f = mtof(o.midi) * variation.pitch
  const peak = (o.gain ?? 0.16) * variation.gain
  const g = out(ctx, dest, (o.pan ?? 0) + variation.pan, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.003)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  const fund = ctx.createOscillator()
  fund.type = 'sine'
  fund.frequency.setValueAtTime(f, t0)
  fund.connect(g)
  fund.start(t0)
  fund.stop(t0 + dur + 0.02)

  const bright = o.bright ?? 0.22
  if (bright > 0) {
    const part = ctx.createOscillator()
    part.type = 'sine'
    part.frequency.setValueAtTime(f * 4, t0)
    const pg = ctx.createGain()
    pg.gain.setValueAtTime(bright, t0)
    pg.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 0.35)
    part.connect(pg)
    pg.connect(g)
    part.start(t0)
    part.stop(t0 + dur + 0.02)
  }
  const tick = o.tick ?? 0.4
  if (tick > 0) {
    noise({ dur: 0.012, freq: f * 3, q: 1.4, gain: peak * tick, delay: o.delay, pan: o.pan, attack: 0.002 })
  }
}

interface BellOpts extends Common {
  midi: number
  /** Modulator ratio: 2 and 3.5 are bells, 1.41 is a gong, metal that does not agree with itself. */
  ratio?: number
  /** Modulation index at the strike; it decays with the note. */
  index?: number
  dur?: number
}

/**
 * A struck bell: two-operator FM, the index falling with the envelope so the
 * strike is bright and the ring is pure. Glass on top of a chord, or, at a
 * wrong ratio, the metal a verdict is struck on.
 */
function bell(o: BellOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return
  const dur = o.dur ?? 0.5
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const f = mtof(o.midi) * variation.pitch
  const peak = (o.gain ?? 0.14) * variation.gain

  const carrier = ctx.createOscillator()
  carrier.type = 'sine'
  carrier.frequency.setValueAtTime(f, t0)
  const mod = ctx.createOscillator()
  mod.type = 'sine'
  mod.frequency.setValueAtTime(f * (o.ratio ?? 2), t0)
  const modGain = ctx.createGain()
  modGain.gain.setValueAtTime(f * (o.index ?? 2.2), t0)
  modGain.gain.exponentialRampToValueAtTime(f * 0.05, t0 + dur * 0.6)
  mod.connect(modGain)
  modGain.connect(carrier.frequency)

  const g = out(ctx, dest, (o.pan ?? 0) + variation.pan, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  carrier.connect(g)
  carrier.start(t0)
  mod.start(t0)
  carrier.stop(t0 + dur + 0.02)
  mod.stop(t0 + dur + 0.02)
}

interface WhooshOpts extends Common {
  from: number
  to: number
  dur?: number
  /** Where the air ends up, -1..1, from `pan`: a swap crosses the room. */
  toPan?: number
}

/** Air moving fast: noise swelling to a peak and sweeping, optionally across the stereo field. */
function whoosh(o: WhooshOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return
  const dur = o.dur ?? 0.22
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  const bp = ctx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.Q.value = 0.8
  bp.frequency.setValueAtTime(o.from, t0)
  bp.frequency.exponentialRampToValueAtTime(o.to, t0 + dur)
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime((o.gain ?? 0.16) * variation.gain, t0 + dur * 0.55)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  let node: AudioNode = g
  if (typeof ctx.createStereoPanner === 'function') {
    const p = ctx.createStereoPanner()
    p.pan.setValueAtTime(o.pan ?? 0, t0)
    if (o.toPan !== undefined) p.pan.linearRampToValueAtTime(o.toPan, t0 + dur)
    g.connect(p)
    node = p
  }
  node.connect(dest)
  if (o.reverb) sendReverb(node, o.reverb)
  src.connect(bp)
  bp.connect(g)
  src.start(t0, Math.random() * 0.3)
  src.stop(t0 + dur + 0.02)
}

interface StabOpts extends Common {
  /** The chord, as MIDI notes, all struck at once. */
  notes: number[]
  dur?: number
  attack?: number
  type?: OscillatorType
  /** Detuned copies per note. 1 is a plain oscillator. */
  unison?: number
  /** Cents across the unison spread. */
  detune?: number
  /** Where the lowpass sits at the strike, and where it falls to. */
  openTo?: number
  closeTo?: number
}

/**
 * A chord struck once, under a filter that opens on the transient and shuts as
 * it falls. The rule for every celebration and every shout here: it says its
 * whole piece in one hit, so the cue is over before the next card, and no
 * cue is a run up a scale. The gain is divided by the root of the voice count,
 * so eight detuned saws land at the level one voice was written for.
 */
function stab(o: StabOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return

  const dur = o.dur ?? 0.7
  const unison = o.unison ?? 3
  const detune = o.detune ?? 16
  const t0 = ctx.currentTime + (o.delay ?? 0)
  const count = Math.max(1, o.notes.length * unison)
  const peak = ((o.gain ?? 0.2) * variation.gain) / Math.sqrt(count)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.9
  lp.frequency.setValueAtTime(o.openTo ?? 4600, t0)
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, o.closeTo ?? 800), t0 + dur)

  const g = out(ctx, dest, o.pan ?? 0, o.reverb ?? 0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.006))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  lp.connect(g)

  for (const midi of o.notes) {
    for (let u = 0; u < unison; u++) {
      const osc = ctx.createOscillator()
      osc.type = o.type ?? 'sawtooth'
      osc.frequency.setValueAtTime(mtof(midi), t0)
      osc.detune.setValueAtTime(unison === 1 ? 0 : -detune / 2 + (detune * u) / (unison - 1), t0)
      osc.connect(lp)
      osc.start(t0)
      osc.stop(t0 + dur + 0.04)
    }
  }
}

// ─── Voices ─────────────────────────────────────────────────────────────────

export type SfxName =
  | 'cardPlay'
  | 'cardDraw'
  | 'cardDeal'
  | 'uiTap'
  | 'uiBack'
  | 'yourTurn'
  | 'skip'
  | 'reverse'
  | 'drawStack'
  | 'wild'
  | 'swap'
  | 'unoDeclare'
  | 'unoCaught'
  | 'interrupt'
  | 'penalty'
  | 'error'
  | 'roundWin'
  | 'roundLose'
  | 'matchWin'
  | 'matchLose'
  | 'playerJoin'
  | 'playerAway'
  | 'matchFound'
  | 'countdown'

/** A card hitting the table: the flick of it leaving the hand, the crack, the felt. */
function cardHit(gain: number, delay = 0): void {
  noise({ dur: 0.04, freq: 1600, toFreq: 3400, q: 1.2, gain: gain * 0.35, comb: 0.5, delay, attack: 0.02 })
  snap({ freq: 2300, q: 7, dur: 0.026, gain: gain, delay: delay + 0.038 })
  thud({ freq: 150, drop: 0.45, dur: 0.09, gain: gain * 0.7, delay: delay + 0.04 })
}

const VOICES: Record<SfxName, () => void> = {
  // A card played: it leaves the hand with a flick and hits the felt with a
  // crack and a thud. Three layers, forty milliseconds, and never the same twice.
  cardPlay: () => {
    cardHit(0.34)
  },
  // A card drawn: it slides off the deck — fibrous, rising — and settles with
  // the smallest tick. Quieter than a play: nothing has happened yet.
  cardDraw: () => {
    noise({ dur: 0.13, freq: 500, toFreq: 2600, q: 1.1, gain: 0.26, comb: 0.62, attack: 0.03 })
    snap({ freq: 1900, q: 5, dur: 0.02, gain: 0.13, delay: 0.11 })
  },
  // One card of the deal: a riffle tick with a little felt under it. Called in a
  // stagger by playDeal.
  cardDeal: () => {
    snap({ freq: 2900, q: 5, dur: 0.022, gain: 0.19 })
    thud({ freq: 210, drop: 0.5, dur: 0.05, gain: 0.08, delay: 0.004 })
  },

  // The interface is a mallet on wood: a tap is a high kalimba note, a back is
  // a lower, darker one. Not a beep: the game is a table, and its controls are
  // things on it.
  uiTap: () => {
    mallet({ midi: 88, dur: 0.1, gain: 0.15, bright: 0.35, tick: 0.5 })
  },
  uiBack: () => {
    mallet({ midi: 79, dur: 0.13, gain: 0.11, bright: 0.12, tick: 0.35 })
  },

  // "It's on you": two marimba notes, a fifth apart, the second with a touch
  // of glass on it. Warm and quiet enough to hear every turn.
  yourTurn: () => {
    mallet({ midi: 76, dur: 0.26, gain: 0.15, bright: 0.18, tick: 0.3, reverb: 0.1 })
    mallet({ midi: 83, dur: 0.34, gain: 0.14, bright: 0.24, tick: 0.3, delay: 0.11, reverb: 0.14 })
    bell({ midi: 95, ratio: 2, index: 1.2, dur: 0.3, gain: 0.05, delay: 0.11, reverb: 0.2 })
  },

  // Skip: a zip past the seat and a blunt stop. Air falling, a low knock, and
  // one dead note with no ring in it.
  skip: () => {
    whoosh({ from: 3200, to: 260, dur: 0.14, gain: 0.16, pan: 0.35, toPan: -0.35 })
    thud({ freq: 105, drop: 0.5, dur: 0.11, gain: 0.2, delay: 0.09 })
    mallet({ midi: 62, dur: 0.12, gain: 0.12, bright: 0, tick: 0.3, delay: 0.1 })
  },
  // Reverse: a sound played backwards. The note swells in and stops dead —
  // which is the one envelope nothing else here has, so the ear knows the
  // ring turned before it knows why — then the mallet lands on the far side.
  reverse: () => {
    const ctx = audio.context()
    const dest = audio.sfxDestination()
    if (!ctx || !dest) return
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(mtof(67) * variation.pitch, t0)
    osc.frequency.exponentialRampToValueAtTime(mtof(74) * variation.pitch, t0 + 0.16)
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(600, t0)
    lp.frequency.exponentialRampToValueAtTime(3200, t0 + 0.16)
    const g = out(ctx, dest, variation.pan - 0.3, 0.1)
    g.gain.setValueAtTime(0.0001, t0)
    g.gain.exponentialRampToValueAtTime(0.16 * variation.gain, t0 + 0.16)
    g.gain.setValueAtTime(0.0001, t0 + 0.165)
    osc.connect(lp)
    lp.connect(g)
    osc.start(t0)
    osc.stop(t0 + 0.2)
    mallet({ midi: 74, dur: 0.16, gain: 0.13, bright: 0.2, tick: 0.4, delay: 0.17, pan: 0.3 })
  },
  // A stack landing on somebody: the cards counted onto the table, three
  // cracks climbing, over a body that keeps falling.
  drawStack: () => {
    thud({ freq: 70, drop: 0.4, dur: 0.34, gain: 0.24 })
    snap({ freq: 1500, q: 6, dur: 0.03, gain: 0.16, delay: 0.0, pan: -0.15 })
    snap({ freq: 1800, q: 6, dur: 0.03, gain: 0.17, delay: 0.07, pan: 0 })
    snap({ freq: 2150, q: 6, dur: 0.03, gain: 0.18, delay: 0.14, pan: 0.15 })
    noise({ dur: 0.2, freq: 1400, toFreq: 300, q: 0.8, gain: 0.1, comb: 0.4, delay: 0.02 })
  },
  // Wild: the colour changes, and nothing is settled by it. A suspended fourth,
  // struck, with glass on top and a wash of air: the sound of a pivot rather
  // than of a result.
  wild: () => {
    stab({ notes: [72, 77, 79], dur: 0.42, gain: 0.12, openTo: 5200, closeTo: 1400, reverb: 0.18 })
    bell({ midi: 91, ratio: 3.5, index: 1.6, dur: 0.42, gain: 0.06, reverb: 0.3 })
    noise({ dur: 0.3, freq: 1800, toFreq: 5200, q: 0.9, gain: 0.06, attack: 0.12, reverb: 0.2 })
  },
  // Swap / global switch: two hands crossing the room, one each way, and the
  // bells that land where they end up. The stereo is the message.
  swap: () => {
    whoosh({ from: 400, to: 3000, dur: 0.3, gain: 0.3, pan: -0.7, toPan: 0.7 })
    whoosh({ from: 3000, to: 400, dur: 0.3, gain: 0.3, pan: 0.7, toPan: -0.7, delay: 0.03 })
    bell({ midi: 84, ratio: 2, index: 1.4, dur: 0.3, gain: 0.11, delay: 0.26, pan: 0.5, reverb: 0.2 })
    bell({ midi: 72, ratio: 2, index: 1.4, dur: 0.3, gain: 0.11, delay: 0.29, pan: -0.5, reverb: 0.2 })
  },

  // The signature shout, and it has to land in one instant: a call, not an
  // announcement. Root, fifth, octave, no third, so that it carries without
  // being cheerful; brass struck wide, a bell on the octave, a breath of air
  // just before it and a sub under it. Loud enough to cut a stream, over
  // before the next card.
  unoDeclare: () => {
    whoosh({ from: 600, to: 5000, dur: 0.07, gain: 0.12 })
    stab({
      notes: [76, 83, 88],
      dur: 0.5,
      gain: 0.22,
      unison: 4,
      detune: 26,
      attack: 0.003,
      openTo: 7000,
      closeTo: 1500,
      reverb: 0.3,
      delay: 0.05,
    })
    bell({ midi: 100, ratio: 2, index: 1.8, dur: 0.4, gain: 0.07, delay: 0.05, reverb: 0.3 })
    thud({ freq: 55, drop: 0.7, dur: 0.34, gain: 0.16, delay: 0.05 })
  },
  // Caught undeclared: a verdict, struck. The gavel — a heavy thud that keeps
  // falling — and the metal it lands on, a gong at a ratio that does not
  // agree with itself. Nothing melodic: being caught is not a tune.
  unoCaught: () => {
    snap({ freq: 900, q: 4, dur: 0.035, gain: 0.22 })
    thud({ freq: 80, drop: 0.35, dur: 0.3, gain: 0.32 })
    bell({ midi: 66, ratio: 1.41, index: 3, dur: 0.55, gain: 0.16, reverb: 0.35 })
    bell({ midi: 54, ratio: 1.41, index: 2, dur: 0.6, gain: 0.1, delay: 0.01, reverb: 0.35 })
  },

  // Somebody stole the lead out of turn: the air of a card thrown, three hits
  // on the table, and a brass hit on top. The loudest thing the board does.
  interrupt: () => {
    whoosh({ from: 350, to: 6000, dur: 0.12, gain: 0.2, pan: -0.5, toPan: 0.2 })
    cardHit(0.3, 0.1)
    cardHit(0.22, 0.13)
    thud({ freq: 60, drop: 0.35, dur: 0.28, gain: 0.26, delay: 0.14 })
    stab({ notes: [64, 71], dur: 0.22, gain: 0.2, unison: 3, detune: 22, openTo: 6500, closeTo: 700, delay: 0.14, reverb: 0.2 })
  },

  // A penalty taken: the body of it, then the cards counted onto the pile.
  penalty: () => {
    thud({ freq: 62, drop: 0.35, dur: 0.36, gain: 0.24 })
    snap({ freq: 1400, q: 5, dur: 0.03, gain: 0.12, delay: 0.06, pan: 0.2 })
    snap({ freq: 1250, q: 5, dur: 0.03, gain: 0.11, delay: 0.14, pan: 0 })
    snap({ freq: 1100, q: 5, dur: 0.03, gain: 0.1, delay: 0.22, pan: -0.2 })
  },
  // A refused move: two knocks on wood, muted, close together. Not a buzzer —
  // the table says no, it does not shout it.
  error: () => {
    mallet({ midi: 50, dur: 0.09, gain: 0.16, bright: 0, tick: 0.6 })
    mallet({ midi: 48, dur: 0.11, gain: 0.15, bright: 0, tick: 0.6, delay: 0.09 })
  },
  // One beat of the last five seconds: a woodblock. Dry, high, short — it cuts
  // through the bed without competing with a card.
  countdown: () => {
    snap({ freq: 1700, q: 9, dur: 0.014, gain: 0.22 })
    mallet({ midi: 86, dur: 0.05, gain: 0.15, bright: 0.4, tick: 0 })
  },

  // Somebody sat down: two kalimba notes, quiet. An arrival happens again and
  // again while a table fills, and a cue that celebrates it is one somebody
  // turns the sound off over.
  playerJoin: () => {
    mallet({ midi: 79, dur: 0.24, gain: 0.1, bright: 0.3, tick: 0.3, pan: -0.2, reverb: 0.15 })
    mallet({ midi: 86, dur: 0.3, gain: 0.09, bright: 0.3, tick: 0.3, delay: 0.07, pan: 0.2, reverb: 0.15 })
  },
  // Somebody's seat went quiet: the same two notes the other way down, softer
  // still, and darker.
  playerAway: () => {
    mallet({ midi: 86, dur: 0.24, gain: 0.08, bright: 0.1, tick: 0.2, pan: 0.2, reverb: 0.15 })
    mallet({ midi: 79, dur: 0.34, gain: 0.08, bright: 0.05, tick: 0.2, delay: 0.08, pan: -0.2, reverb: 0.15 })
  },

  // The queue found somebody: a call across a room. Stacked fifths — nothing
  // has been won, somebody has arrived — with a bell on top and air in front.
  matchFound: () => {
    whoosh({ from: 300, to: 4000, dur: 0.16, gain: 0.1, reverb: 0.2 })
    stab({ notes: [64, 71, 78], dur: 0.55, gain: 0.17, detune: 20, openTo: 5200, closeTo: 1100, reverb: 0.34, delay: 0.12 })
    bell({ midi: 90, ratio: 2, index: 1.6, dur: 0.5, gain: 0.07, delay: 0.12, reverb: 0.35 })
    thud({ freq: 55, drop: 0.7, dur: 0.5, gain: 0.14, delay: 0.14 })
  },

  // A round, taken. Major with the ninth on top: warm, open, and deliberately
  // *unfinished* — a round is not the match. Glass on the ninth, a body under
  // the root. Nothing here may sound like `matchWin`.
  roundWin: () => {
    stab({ notes: [69, 73, 76, 83], dur: 0.72, gain: 0.16, openTo: 4800, closeTo: 900, reverb: 0.4 })
    bell({ midi: 95, ratio: 2, index: 1.5, dur: 0.6, gain: 0.06, reverb: 0.4 })
    thud({ freq: 55, drop: 0.8, dur: 0.6, gain: 0.15, delay: 0.02 })
  },
  // A round, lost. Not the winning cue upside down: a minor chord under a
  // shut filter, short, and a dull knock under it. It does not fall, it goes out.
  roundLose: () => {
    stab({ notes: [69, 72, 76], dur: 0.4, gain: 0.14, unison: 2, openTo: 1500, closeTo: 420 })
    thud({ freq: 90, drop: 0.5, dur: 0.2, gain: 0.12 })
  },
  // The match. This is the clip people keep, so it is the one cue allowed two
  // chords: the fourth struck wide, then the tonic under it a beat later — the
  // cadence the bed resolves on all evening — with bells on both, a sub on the
  // root, and the longest tail on the bus, because there is nothing to play
  // after it.
  matchWin: () => {
    whoosh({ from: 300, to: 5000, dur: 0.2, gain: 0.12, reverb: 0.3 })
    stab({ notes: [65, 69, 72, 77], dur: 0.55, gain: 0.18, unison: 4, detune: 22, openTo: 6000, closeTo: 1200, reverb: 0.45, delay: 0.16 })
    bell({ midi: 89, ratio: 2, index: 1.8, dur: 0.5, gain: 0.07, delay: 0.16, reverb: 0.45 })
    stab({ notes: [60, 64, 67, 72, 76], dur: 1.2, gain: 0.2, unison: 4, detune: 22, openTo: 5200, closeTo: 700, reverb: 0.5, delay: 0.5 })
    bell({ midi: 96, ratio: 2, index: 2, dur: 0.9, gain: 0.08, delay: 0.5, reverb: 0.5 })
    bell({ midi: 100, ratio: 3, index: 1.2, dur: 0.8, gain: 0.04, delay: 0.56, reverb: 0.5 })
    thud({ freq: 48, drop: 0.9, dur: 1.0, gain: 0.2, delay: 0.5 })
  },
  // The match, lost. A minor chord that closes rather than falls, and one low
  // knock: the table has stopped, not sunk.
  matchLose: () => {
    stab({ notes: [57, 60, 64, 67], dur: 0.9, gain: 0.16, unison: 3, openTo: 1800, closeTo: 380, reverb: 0.3 })
    thud({ freq: 60, drop: 0.5, dur: 0.4, gain: 0.16 })
  },
}

export const SFX_NAMES = Object.keys(VOICES) as SfxName[]

export function playSfx(name: SfxName): void {
  if (!audio.isReady()) return
  if (audio.getSettings().muted) return
  if (!audio.budgetVoice()) return
  variation = HUMANISED.has(name) ? humanVariation() : NEUTRAL
  try {
    VOICES[name]()
  } finally {
    variation = NEUTRAL
  }
}

/**
 * One step of a volume slider being auditioned.
 *
 * Deliberately not a `SfxName`: the sound is a function of the level, which is
 * what makes a drag legible. A slider is heard a dozen times down one gesture,
 * and a row of identical blips says nothing about which way it went — on the
 * master bus especially, where the audition is the only feedback there is. So
 * the pitch climbs the travel on a major pentatonic and moving up sounds like
 * moving up: a run, not a tick repeated. Steps rather than a continuous glide,
 * because a run lands and a siren does not.
 *
 * Two things it is careful about, both learned from the version this replaced:
 * the blip is an octave under `uiTap` and low-passed under the 2-5kHz band the
 * ear is sharpest in — bright heard once is shrill heard thirty times — and the
 * top of the travel is the brightest, never the loudest. **Level never scales
 * the gain**: the bus being moved already applies it, so scaling here too makes
 * the bottom of the travel silent, which is the one part of it a player is
 * listening for.
 */
const AUDITION_SCALE = [0, 2, 4, 7, 9]
const AUDITION_ROOT = 57
const AUDITION_STEPS = 11

export function playVolumeAudition(level: number): void {
  if (!audio.isReady()) return
  if (audio.getSettings().muted) return
  if (!audio.budgetVoice()) return
  const at = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))
  const step = Math.round(at * (AUDITION_STEPS - 1))
  const midi =
    AUDITION_ROOT + 12 * Math.floor(step / AUDITION_SCALE.length) + AUDITION_SCALE[step % AUDITION_SCALE.length]
  tone({
    freq: mtof(midi),
    type: 'triangle',
    dur: 0.1,
    gain: 0.16,
    attack: 0.012,
    // Opens with the travel, so the top is brighter as well as higher. The
    // ceiling keeps the second harmonic of the highest note out of the band a
    // repeated blip turns shrill in.
    filter: 1600 + at * 1200,
  })
}

/** Staggered deal — one tick per card, capped so a big hand stays a flourish. */
export function playDeal(cardCount: number): void {
  if (!audio.isReady() || audio.getSettings().muted) return
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return
  const n = Math.min(cardCount, 10)
  // Each card of the deal lands its own way, like each card of the hand.
  for (let i = 0; i < n; i++) {
    variation = humanVariation()
    // The riffle: each tick a shade higher than the last, each on its own side.
    variation = { ...variation, pitch: variation.pitch * (1 + i * 0.03), pan: -0.3 + (0.6 * i) / Math.max(1, n - 1) }
    snap({ freq: 2900, q: 5, dur: 0.022, gain: 0.19, delay: i * DEAL_TICK_S })
    thud({ freq: 210, drop: 0.5, dur: 0.05, gain: 0.08, delay: i * DEAL_TICK_S + 0.004 })
  }
  variation = NEUTRAL
}

/** Seconds between two cards of the deal flourish: DEAL_STAGGER_MS, in seconds. */
const DEAL_TICK_S = 0.055
