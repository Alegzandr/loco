/**
 * Keys, and what two pieces of music can do next to each other.
 *
 * Pure and framework-free, so every claim here is a unit test rather than a
 * listening session: which loops may be overlapped, which ones have to be cut
 * between, and how far the effects are moved so a cue lands in the bed's key.
 *
 * ## Why the bed needed to know about keys at all
 *
 * The first bed chose the next loop from a shuffle bag and crossfaded into it
 * over 1.5 to 4 seconds. Measured on the files, the registry spans A major to
 * C minor — seven steps apart on the circle of fifths — and the lounge held
 * both ends of that, so an ordinary handover could put two keys a tritone
 * apart on top of each other for four seconds. That is what "the transitions
 * do not hang together" was describing, and no amount of bar alignment fixes
 * it: the downbeats were already on the one.
 *
 * Two things are measured here and both are needed. The **key distance** says
 * whether two pieces share a harmony, which decides the order they are played
 * in; the **tempo gap** says whether their beats can run side by side, which
 * decides whether they may overlap at all. A pair that fails either is cut
 * between rather than blended (`handoverFor`).
 */

/** The twenty-four keys, spelled the way the registry spells them. `m` is minor. */
export type KeyName =
  | 'C' | 'Db' | 'D' | 'Eb' | 'E' | 'F' | 'F#' | 'G' | 'Ab' | 'A' | 'Bb' | 'B'
  | 'Cm' | 'C#m' | 'Dm' | 'Ebm' | 'Em' | 'Fm' | 'F#m' | 'Gm' | 'G#m' | 'Am' | 'Bbm' | 'Bm'

/** Pitch classes by name, both spellings the registry is allowed to use. */
const PITCH: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
}

/** Every key, for a test that must not fall behind the type. */
export const KEY_NAMES: KeyName[] = [
  'C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
]

export interface Tonality {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number
  minor: boolean
}

export function parseKey(key: KeyName): Tonality {
  const minor = key.endsWith('m')
  const name = minor ? key.slice(0, -1) : key
  return { tonic: PITCH[name], minor }
}

/**
 * The tonic of the major key sharing this one's notes: itself for a major
 * key, a minor third up for a minor one (C minor lives on E flat major's
 * notes). The circle of fifths is about notes, so this is what it is drawn on.
 */
function homeMajor(k: Tonality): number {
  return k.minor ? (k.tonic + 3) % 12 : k.tonic
}

/** Position on the circle of fifths, 0..11, of the notes a key uses. */
function fifthsPosition(k: Tonality): number {
  return (homeMajor(k) * 7) % 12
}

/**
 * Steps between two keys on the circle of fifths, plus one when they differ
 * in mode — the distance a DJ's key wheel measures. 0 is the same key; 1 is a
 * neighbour or the relative (C minor and E flat major); 2 is still one shared
 * chord away; beyond that the two share little enough that heard together
 * they are a wrong note, not a harmony.
 */
export function keyDistance(a: KeyName, b: KeyName): number {
  const ka = parseKey(a)
  const kb = parseKey(b)
  const d = Math.abs(fifthsPosition(ka) - fifthsPosition(kb))
  return Math.min(d, 12 - d) + (ka.minor === kb.minor ? 0 : 1)
}

/**
 * How far apart two tempos are, as a fraction, counting a tempo and its
 * double as the same pulse: 85 against 170 is a drum-and-bass loop under a
 * half-time one, and their downbeats agree. 0.03 is three percent.
 */
export function tempoGap(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return Infinity
  const r = Math.max(a, b) / Math.min(a, b)
  return Math.min(Math.abs(r - 1), Math.abs(r / 2 - 1))
}

/**
 * The widest key distance two loops may be overlapped at. Two steps is the
 * edge of what the key wheel calls compatible: the pair still share a chord.
 */
export const BLEND_MAX_KEY_STEPS = 2

/**
 * The widest tempo gap two loops may be overlapped at. Three percent drifts a
 * tenth of a beat over the longest crossfade the bed makes at a table (1.5 s
 * at 115 BPM), which the bass swap covers; the next pair up in the registry is
 * over four, and at four seconds that is a flam anyone hears.
 */
export const BLEND_MAX_TEMPO_GAP = 0.03

/** What the bed needs to know about a loop to decide how to leave it. */
export interface Harmonic {
  key: KeyName
  bpm: number
}

/**
 * How the bed goes from one loop to another.
 *
 * `blend` overlaps them — a crossfade with the bass handed over halfway, the
 * way a DJ mixes two records in one key at one tempo. `cut` does not: the
 * outgoing loop is closed down under a low-pass over its last beats, a breath
 * of air rises into the downbeat, and the incoming one lands whole on it.
 * A cut is not the failure case. It is what a band does between two numbers,
 * and it is the only honest move between two pieces that do not agree.
 */
export type Handover = 'blend' | 'cut'

export function handoverFor(from: Harmonic, to: Harmonic): Handover {
  return keyDistance(from.key, to.key) <= BLEND_MAX_KEY_STEPS && tempoGap(from.bpm, to.bpm) <= BLEND_MAX_TEMPO_GAP
    ? 'blend'
    : 'cut'
}

/**
 * How badly `to` follows `from`, for ranking the next loop. A pair that can be
 * overlapped always ranks before one that cannot (`CUT_COST` is more than any
 * two keys can differ by); inside each group, the key distance first, then the
 * tempo gap. Zero is the same key at the same tempo. A sequence of pieces is
 * heard as a progression when each one is a neighbour of the last, even where
 * they are cut between rather than overlapped.
 */
export function followCost(from: Harmonic, to: Harmonic): number {
  const cut = handoverFor(from, to) === 'cut' ? CUT_COST : 0
  return cut + keyDistance(from.key, to.key) + Math.min(1, tempoGap(from.bpm, to.bpm) * 5)
}

/** What ranking a cut behind every blend costs: more than the widest key distance plus the tempo term. */
export const CUT_COST = 10

/**
 * The semitones every pitched effect is moved by so it sits in `key`, or 0
 * without one.
 *
 * The cues are written around C: the match fanfare is a plagal cadence onto C,
 * the round's chords and the calls are C's neighbours. Over a bed in A major
 * that is a chromatic clash under the one moment people clip. Moving the whole
 * vocabulary together keeps every cue's own chord — a call is still a call —
 * and puts C on the bed's home chord or on one of the two chords next to it on
 * the circle (its IV or V), whichever is the smallest move. Three candidates a
 * fifth and a fourth apart cover the octave in steps of at most five, so no
 * key moves the cues more than three semitones: every one stays the sound a
 * player has learnt, a shade higher or lower.
 *
 * A minor key is read through its relative major (C minor is E flat's notes),
 * so a major cue over a minor bed lands on a chord that bed actually contains.
 */
export function cueShiftFor(key: KeyName | null): number {
  if (!key) return 0
  const home = homeMajor(parseKey(key))
  let best = 0
  let bestAbs = Infinity
  for (const target of [home, (home + 7) % 12, (home + 5) % 12]) {
    const shift = ((target + 6) % 12) - 6
    if (Math.abs(shift) < bestAbs) {
      best = shift
      bestAbs = Math.abs(shift)
    }
  }
  return best
}
