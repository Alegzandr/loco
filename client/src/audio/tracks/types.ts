/**
 * The shape of a track.
 *
 * A track is **data**: harmony, melodies, rhythms and timbres, with no audio code
 * in it at all. `music.ts` is the one engine that plays any of them. Adding a
 * track is therefore a matter of writing notes, not of writing Web Audio.
 *
 * ## Why a track has parts and a form
 *
 * The first version of this bed was a single four-bar loop whose only variation
 * was how many layers played. However good four bars are, hearing them for a
 * twenty-minute match is hearing a chorus on repeat — which is exactly what it
 * sounded like.
 *
 * So a track is a set of named `parts` (intro, verse, chorus, bridge, break) plus
 * a `form` that orders them, and the engine walks the form. Two independent axes
 * end up driving what you hear:
 *
 * - **the form** advances with time — the music goes somewhere on its own
 * - **the game's intensity** picks how thickly the current part is played, and
 *   biases which part comes next by role (a drop wants a chorus, a round summary
 *   wants a break)
 *
 * That is what stops a match sounding like a loop: by the time a part comes
 * round again, a minute of different music has happened, and it usually comes
 * back in a different arrangement.
 */

/**
 * One slot of a melodic line.
 *
 * - `0` — rest
 * - `-1` — tie: hold the previous note through this slot
 * - `> 0` — MIDI note number, starts a new note
 *
 * Ties are what let a written line breathe over a fixed grid: without them every
 * note is exactly one slot long and the result is a sequencer pattern, not a
 * melody.
 */
export type Slot = number

/** Envelope, in the same terms as the Strudel sketches these are written from. */
export interface Adsr {
  attack: number
  decay: number
  /** Fraction of peak held after the decay, 0..1. */
  sustain: number
  release: number
}

/** One bar of harmony. */
export interface BarDef {
  /** Bass root, MIDI. The bass pattern's offsets are relative to it. */
  root: number
  /** Chord voicing, low → high. Used by the pad and the stabs. */
  chord: number[]
  /** Arpeggio figure, cycled across the bar at the part's `arpDiv`. */
  arp: number[]
}

/**
 * What a part is for. The engine picks the next part by role, so a track author
 * writes music and the game decides when each kind of music is wanted.
 */
export type PartRole = 'intro' | 'verse' | 'chorus' | 'bridge' | 'break'

export interface PartDef {
  id: string
  role: PartRole
  /** Harmony, one entry per bar. Defines the part's length. */
  bars: BarDef[]
  /** Slots per bar in `lead` and `counter`: 8 = eighths, 16 = sixteenths. */
  div: 8 | 16
  /** The tune. One row per bar, `div` slots each. Omit for parts with no lead. */
  lead?: Slot[][]
  /**
   * Answering line, same shape as `lead`. Plays only in the thickest sections —
   * a counter-melody under a sparse arrangement is clutter, under a full one it
   * is the difference between a loop and a song.
   */
  counter?: Slot[][]
  /** Which division the arpeggio runs at. */
  arpDiv: 8 | 16
  /**
   * Bass rhythm: 16 entries, one per sixteenth. `null` is a rest, a number is a
   * semitone offset from the bar's `root`. Offsets are what make a bass line
   * rather than a pulse on the root.
   */
  bass: (number | null)[]
  /** Sixteenths carrying an offbeat chord stab. Omit for none. */
  stabs?: number[]
}

/** A synthesised voice's timbre. */
export interface SynthSpec {
  wave: OscillatorType
  /** Unison voices. Level is divided by this, so wider never means louder. */
  unison: number
  /** Unison detune, edge to edge, in cents. */
  detune: number
  filter: number
  q?: number
  adsr: Adsr
  gain: number
  reverb?: number
  /** Which delay send to feed, if any. */
  echo?: 'lead' | 'arp' | null
}

/**
 * The bass.
 *
 * Always a sine sub plus a filtered body, never a waveshaper: this plays under a
 * twenty-minute match, and the reference sketch's resonant, distorted roll is
 * exhausting at that length. `wobble` adds an LFO on the cutoff for the tracks
 * that want a talking bass.
 */
export interface BassSpec {
  subGain: number
  bodyWave: OscillatorType
  bodyGain: number
  /** Lowpass sweep range, [low, high]. */
  cutoff: [number, number]
  q: number
  /** Note length in sixteenths. */
  length: number
  /** Filter wobble in Hz. 0 or absent = a steady, slow sweep instead. */
  wobble?: number
}

export interface VoiceSpec {
  lead: SynthSpec
  arp: SynthSpec
  pad: SynthSpec
  stab: SynthSpec
  bass: BassSpec
}

/** Drum kit flavour. Patterns live in the engine; this picks between them. */
export type DrumStyle = 'trance' | 'house' | 'electro'

export interface TrackDef {
  id: string
  /** Shown in the picker. A proper noun, so it is not translated. */
  title: string
  /** One line under the title in the picker. */
  blurb: { en: string; fr: string }
  bpm: number
  /** Sidechain pump shape, one value per sixteenth of a beat. */
  pump: number[]
  drums: DrumStyle
  voices: VoiceSpec
  parts: PartDef[]
  /** Part ids in playing order. The engine walks this forever, biased by role. */
  form: string[]
}
