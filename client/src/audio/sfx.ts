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

function arp(midis: number[], step = 0.075, gain = 0.2, type: OscillatorType = 'triangle'): void {
  midis.forEach((m, i) => {
    tone({ freq: mtof(m), type, dur: step * 2.4, gain, delay: i * step, attack: 0.006 })
  })
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
  // Wild: colour change. Bright shimmering fourth stack.
  wild: () => {
    arp([72, 76, 79, 84], 0.055, 0.14, 'triangle')
  },
  // Swap / global switch: two voices crossing.
  swap: () => {
    tone({ freq: mtof(72), toFreq: mtof(84), type: 'sine', dur: 0.3, gain: 0.14 })
    tone({ freq: mtof(84), toFreq: mtof(72), type: 'sine', dur: 0.3, gain: 0.14 })
  },

  // The signature shout. Bright major arpeggio, loud enough to cut a stream.
  unoDeclare: () => {
    arp([72, 76, 79, 84, 88], 0.06, 0.24, 'square')
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

  playerJoin: () => {
    arp([67, 72, 76], 0.06, 0.14, 'triangle')
  },

  // The queue found somebody. Stacked fifths rather than the thirds every other
  // cue is built on, so it reads as a call across a room instead of as a result:
  // nothing has been won here, somebody has arrived. Short, because the reveal
  // that follows it has its own countdown to fill.
  matchFound: () => {
    arp([64, 71, 76, 83], 0.075, 0.2, 'triangle')
    tone({ freq: mtof(40), type: 'sine', dur: 0.5, gain: 0.15, delay: 0.02 })
  },

  roundWin: () => {
    arp([72, 76, 79, 84], 0.085, 0.22, 'triangle')
    tone({ freq: mtof(48), type: 'sine', dur: 0.6, gain: 0.16, delay: 0.02 })
  },
  roundLose: () => {
    arp([69, 65, 62], 0.11, 0.16, 'triangle')
  },
  // Match won: a full cadence with a bass root. This is the clip people keep.
  matchWin: () => {
    arp([72, 76, 79, 84, 88, 91], 0.085, 0.24, 'triangle')
    arp([84, 88, 91, 96], 0.085, 0.13, 'square')
    tone({ freq: mtof(36), type: 'sine', dur: 1.1, gain: 0.2, delay: 0.02 })
    tone({ freq: mtof(48), type: 'sine', dur: 1.0, gain: 0.14, delay: 0.02 })
  },
  matchLose: () => {
    arp([69, 66, 62, 57], 0.14, 0.18, 'triangle')
    tone({ freq: mtof(33), type: 'sine', dur: 0.9, gain: 0.14, delay: 0.05 })
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
