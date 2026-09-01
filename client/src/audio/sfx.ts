/**
 * Sound effects — every one synthesised from oscillators and filtered noise.
 *
 * Design rules:
 *  - Card handling sounds are *noise*, not tones. Paper has no pitch, and a
 *    pitched click for every card played becomes a melody nobody wrote.
 *  - Anything that reports a rule outcome (skip, +N, catch, UNO) is *pitched*
 *    and interval-based, so the table learns the outcomes by ear.
 *  - Nothing runs longer than ~1.2s except the win fanfares. A card game plays
 *    faster than its sounds decay if you let it.
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

interface ToneOpts {
  freq: number
  /** Glide target; omitted means a steady pitch. */
  toFreq?: number
  type?: OscillatorType
  dur?: number
  attack?: number
  gain?: number
  delay?: number
  /** Optional low-pass, in Hz. */
  filter?: number
}

function tone(o: ToneOpts): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return

  const dur = o.dur ?? 0.18
  const attack = o.attack ?? 0.004
  const peak = o.gain ?? 0.25
  const t0 = ctx.currentTime + (o.delay ?? 0)

  const osc = ctx.createOscillator()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, t0)
  if (o.toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.toFreq), t0 + dur)
  }

  const g = ctx.createGain()
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
  g.connect(dest)

  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

interface NoiseOpts {
  dur?: number
  gain?: number
  delay?: number
  /** Band-pass centre in Hz. */
  freq?: number
  q?: number
  /** Sweep the band-pass to this frequency across the hit. */
  toFreq?: number
  type?: BiquadFilterType
}

function noise(o: NoiseOpts = {}): void {
  const ctx = audio.context()
  const dest = audio.sfxDestination()
  if (!ctx || !dest) return

  const dur = o.dur ?? 0.12
  const t0 = ctx.currentTime + (o.delay ?? 0)

  const src = ctx.createBufferSource()
  src.buffer = getNoise(ctx)
  src.playbackRate.value = 1

  const bp = ctx.createBiquadFilter()
  bp.type = o.type ?? 'bandpass'
  bp.frequency.setValueAtTime(o.freq ?? 2400, t0)
  if (o.toFreq !== undefined) {
    bp.frequency.exponentialRampToValueAtTime(Math.max(20, o.toFreq), t0 + dur)
  }
  bp.Q.value = o.q ?? 1.1

  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t0 + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  src.connect(bp)
  bp.connect(g)
  g.connect(dest)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

/** Equal-tempered frequency for a MIDI note number. */
function mtof(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

// `arp()` lived here and is gone with the last of its callers. It was the whole
// vocabulary of the celebration cues (eight of them, five on the same chord),
// and leaving the helper behind is how that vocabulary comes back.

/** Taps the short room on the effects bus, when there is one to tap. */
function sendReverb(from: AudioNode, amount: number): void {
  const ctx = audio.context()
  const room = audio.sfxReverbSend()
  if (!ctx || !room || amount <= 0) return
  const send = ctx.createGain()
  send.gain.value = amount
  from.connect(send)
  send.connect(room)
}

interface StabOpts {
  /** The chord, as MIDI notes, all struck at once. */
  notes: number[]
  dur?: number
  gain?: number
  delay?: number
  attack?: number
  type?: OscillatorType
  /** Detuned copies per note. 1 is a plain oscillator. */
  unison?: number
  /** Cents across the unison spread. */
  detune?: number
  /** Where the lowpass sits at the strike, and where it falls to. */
  openTo?: number
  closeTo?: number
  /** Send level into the short room. */
  reverb?: number
}

/**
 * A chord, struck. The thing this file had no way of making.
 *
 * Every celebration in this game used to be `arp()`, and five of them were the
 * same arpeggio: `wild`, `unoDeclare`, `roundWin` and `matchWin` all ran up
 * 0-4-7-12, and `roundWin` was *note for note* `wild`, so playing a Global
 * Switch sounded exactly like taking the round. The two losing cues were the
 * same figure inverted. That is the reflex the whole set had: major going up is
 * good, minor coming down is bad, and every moment in the game gets the same
 * sentence at a different speed.
 *
 * The bed is 138 BPM trance and it does not talk like that. A struck chord under
 * a filter that opens on the transient and shuts as it falls is what the music
 * beside it is made of, and it says its whole piece in one hit rather than
 * spelling a scale, which also means the cue is over before the next card is
 * played, and a card game plays faster than its sounds decay.
 *
 * The gain is divided by the root of the voice count. Summing eight detuned saws
 * into one envelope at the level a single triangle wanted is how a cue clips on
 * a phone speaker while measuring fine on the bus.
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
  const peak = (o.gain ?? 0.2) / Math.sqrt(count)

  const lp = ctx.createBiquadFilter()
  lp.type = 'lowpass'
  lp.Q.value = 0.9
  lp.frequency.setValueAtTime(o.openTo ?? 4600, t0)
  lp.frequency.exponentialRampToValueAtTime(Math.max(80, o.closeTo ?? 800), t0 + dur)

  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.006))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)

  lp.connect(g)
  g.connect(dest)
  sendReverb(g, o.reverb ?? 0)

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

const VOICES: Record<SfxName, () => void> = {
  // Card leaving a hand and landing: a short paper swish with a snap at the end.
  cardPlay: () => {
    noise({ dur: 0.11, freq: 3200, toFreq: 900, q: 0.8, gain: 0.22 })
    noise({ dur: 0.045, freq: 1500, q: 2.2, gain: 0.16, delay: 0.055 })
  },
  // Drawing is the same gesture reversed: quieter, sweeping upward.
  cardDraw: () => {
    noise({ dur: 0.13, freq: 700, toFreq: 2600, q: 0.9, gain: 0.17 })
  },
  // One card of a deal. Called in a stagger by the deal helper below.
  cardDeal: () => {
    noise({ dur: 0.06, freq: 2600, toFreq: 1200, q: 1.4, gain: 0.13 })
  },

  uiTap: () => {
    tone({ freq: mtof(84), toFreq: mtof(88), type: 'triangle', dur: 0.07, gain: 0.13 })
  },
  uiBack: () => {
    tone({ freq: mtof(79), toFreq: mtof(74), type: 'triangle', dur: 0.09, gain: 0.12 })
  },

  // "It's on you" — a friendly rising fifth, quiet enough to hear every turn.
  yourTurn: () => {
    tone({ freq: mtof(76), type: 'triangle', dur: 0.16, gain: 0.16 })
    tone({ freq: mtof(83), type: 'triangle', dur: 0.24, gain: 0.15, delay: 0.09 })
  },

  // Skip: a blunt stop. Falling minor second, filtered dark.
  skip: () => {
    tone({ freq: mtof(69), toFreq: mtof(62), type: 'square', dur: 0.2, gain: 0.16, filter: 1400 })
    noise({ dur: 0.09, freq: 900, q: 1.6, gain: 0.14 })
  },
  // Reverse: a turn-around. Down then up, same distance.
  reverse: () => {
    tone({ freq: mtof(74), toFreq: mtof(67), type: 'triangle', dur: 0.13, gain: 0.15 })
    tone({ freq: mtof(67), toFreq: mtof(76), type: 'triangle', dur: 0.18, gain: 0.15, delay: 0.12 })
  },
  // A stack landing on someone: heavy, low, and it keeps falling.
  drawStack: () => {
    tone({ freq: mtof(50), toFreq: mtof(38), type: 'sawtooth', dur: 0.34, gain: 0.22, filter: 900 })
    noise({ dur: 0.2, freq: 1800, toFreq: 300, q: 0.7, gain: 0.2 })
  },
  // Wild: the colour changes, and nothing is settled by it. A suspended fourth,
  // struck. The one chord that states a key without saying whether it is major
  // or minor, which is the sound of a pivot rather than of a result. It used to
  // be 0-4-7-12, note for note the same figure `roundWin` played.
  wild: () => {
    stab({ notes: [72, 77, 79], dur: 0.42, gain: 0.13, openTo: 5200, closeTo: 1400, reverb: 0.18 })
  },
  // Swap / global switch: two voices crossing.
  swap: () => {
    tone({ freq: mtof(72), toFreq: mtof(84), type: 'sine', dur: 0.3, gain: 0.14 })
    tone({ freq: mtof(84), toFreq: mtof(72), type: 'sine', dur: 0.3, gain: 0.14 })
  },

  // The signature shout, and it has to land in one instant: this is a call, not
  // an announcement, and a five-note run meant the table heard the *end* of it
  // a third of a second after the player pressed. Root, fifth, octave, with no
  // third, so that it carries without being cheerful. Struck hard, detuned wide
  // enough to sound like more than one voice, over a short sub that gives the
  // press a body. Loud enough to cut a stream, over before the next card.
  unoDeclare: () => {
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
    })
    tone({ freq: mtof(40), toFreq: mtof(35), type: 'sine', dur: 0.34, gain: 0.15 })
  },
  // Caught undeclared: the sound of being wrong. Descending, sour.
  unoCaught: () => {
    tone({ freq: mtof(71), toFreq: mtof(58), type: 'sawtooth', dur: 0.42, gain: 0.2, filter: 1200 })
    tone({ freq: mtof(70), toFreq: mtof(57), type: 'sawtooth', dur: 0.42, gain: 0.14, filter: 1100, delay: 0.02 })
  },

  // Someone stole the lead out of turn — the most dramatic beat in the game.
  interrupt: () => {
    noise({ dur: 0.24, freq: 5200, toFreq: 320, q: 0.6, gain: 0.3 })
    tone({ freq: mtof(64), toFreq: mtof(40), type: 'sawtooth', dur: 0.3, gain: 0.26, filter: 1600 })
    tone({ freq: mtof(88), toFreq: mtof(93), type: 'square', dur: 0.14, gain: 0.14, delay: 0.03 })
  },

  penalty: () => {
    tone({ freq: mtof(45), toFreq: mtof(33), type: 'square', dur: 0.36, gain: 0.2, filter: 700 })
  },
  error: () => {
    tone({ freq: mtof(58), type: 'square', dur: 0.09, gain: 0.13, filter: 1000 })
    tone({ freq: mtof(57), type: 'square', dur: 0.11, gain: 0.13, filter: 1000, delay: 0.1 })
  },
  // One beat of the last-five-seconds countdown. Short and high so it cuts
  // through the music bed without competing with the card sounds.
  countdown: () => {
    tone({ freq: mtof(88), type: 'triangle', dur: 0.08, gain: 0.13 })
  },

  // Somebody sat down. Two notes and a soft filter: an arrival is the quietest
  // positive thing that happens here, and it happens repeatedly while a table
  // fills, and a cue that celebrates it is one somebody turns the sound off over.
  playerJoin: () => {
    stab({
      notes: [67, 74],
      dur: 0.3,
      gain: 0.1,
      unison: 2,
      type: 'triangle',
      openTo: 2600,
      closeTo: 900,
      reverb: 0.12,
    })
  },

  // Somebody's seat went quiet: the arrival's two notes, the other way down,
  // and softer still. A departure is news and not a verdict, so it is the
  // quietest cue on the board — under the music bed, over nothing.
  playerAway: () => {
    stab({
      notes: [74, 67],
      dur: 0.34,
      gain: 0.09,
      unison: 2,
      type: 'triangle',
      openTo: 2200,
      closeTo: 700,
      reverb: 0.12,
    })
  },

  // The queue found somebody. Stacked fifths rather than the thirds the rest of
  // the set is built on, so it reads as a call across a room instead of as a
  // result: nothing has been won here, somebody has arrived. Short, because the
  // reveal that follows it has its own countdown to fill.
  matchFound: () => {
    stab({
      notes: [64, 71, 78],
      dur: 0.55,
      gain: 0.17,
      detune: 20,
      openTo: 5200,
      closeTo: 1100,
      reverb: 0.34,
    })
    tone({ freq: mtof(40), type: 'sine', dur: 0.5, gain: 0.15, delay: 0.02 })
  },

  // A round, taken. Major with the ninth on top: warm, open, and deliberately
  // *unfinished*: a round is not the match, and the cue that says so is the one
  // that does not resolve. Nothing here may sound like `matchWin`.
  roundWin: () => {
    stab({
      notes: [69, 73, 76, 83],
      dur: 0.72,
      gain: 0.17,
      openTo: 4800,
      closeTo: 900,
      reverb: 0.4,
    })
    tone({ freq: mtof(45), type: 'sine', dur: 0.6, gain: 0.16, delay: 0.02 })
  },
  // A round, lost. Not the winning cue upside down. That inversion is the tell,
  // and it also flatters the loss by giving it the same shape. A minor chord
  // under a shut filter, short, no tail: it does not fall, it simply goes out.
  roundLose: () => {
    stab({
      notes: [69, 72, 76],
      dur: 0.4,
      gain: 0.145,
      unison: 2,
      openTo: 1500,
      closeTo: 420,
    })
  },
  // The match. This is the clip people keep, so it is the one cue allowed two
  // chords: the fourth struck wide, then the tonic under it a beat later, which
  // is the cadence the bed resolves on all evening. Sub on the root, and the
  // longest tail on the bus, because this is the only moment in the game with nothing
  // to play after it.
  matchWin: () => {
    stab({
      notes: [65, 69, 72, 76, 79],
      dur: 0.6,
      gain: 0.17,
      detune: 20,
      openTo: 5600,
      closeTo: 1200,
      reverb: 0.45,
    })
    stab({
      notes: [60, 67, 72, 76, 79],
      dur: 1.5,
      gain: 0.19,
      detune: 22,
      delay: 0.26,
      openTo: 6400,
      closeTo: 900,
      reverb: 0.6,
    })
    tone({ freq: mtof(36), type: 'sine', dur: 1.5, gain: 0.16, delay: 0.26 })
  },
  // The match, lost. A minor seventh that opens and then closes over a long sub:
  // disappointment, which is a different thing from punishment. `penalty` and
  // `unoCaught` are what punishment sounds like here, and neither of them is
  // this. It takes its time because nothing follows it either.
  matchLose: () => {
    stab({
      notes: [57, 60, 64, 67],
      dur: 1.3,
      gain: 0.15,
      unison: 2,
      openTo: 1900,
      closeTo: 320,
      reverb: 0.3,
    })
    tone({ freq: mtof(33), type: 'sine', dur: 1.1, gain: 0.14, delay: 0.05 })
  },
}

/**
 * Every voice, in declaration order.
 *
 * `tools/audio/verify.mjs` renders this list rather than one of its own. It used
 * to carry a hand-written copy, which meant a new sound was silently exempt from
 * the only check that can catch a broken envelope — and a broken envelope is
 * silence, not an error.
 */
export const SFX_NAMES = Object.keys(VOICES) as SfxName[]

/**
 * Plays a one-shot effect. Silent (and free) until the engine is unlocked, so
 * callers never have to check.
 */
export function playSfx(name: SfxName): void {
  if (!audio.isReady()) return
  if (audio.getSettings().muted) return
  if (!audio.budgetVoice()) return
  VOICES[name]()
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
  for (let i = 0; i < n; i++) {
    noise({ dur: 0.06, freq: 2600 + i * 90, toFreq: 1200, q: 1.4, gain: 0.12, delay: i * 0.055 })
  }
}
