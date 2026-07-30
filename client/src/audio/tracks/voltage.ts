/**
 * VOLTAGE — dark electro, 145 BPM, E minor.
 *
 * The fast one, for a table that has stopped being polite. Sixteenth-note bass
 * with a slow wobble on the cutoff so it talks rather than pulses, a syncopated
 * kick that lands off the grid, and a lead that sits high and stays busy.
 *
 * Harmonically it is the one that actually modulates: the bridge goes to B major
 * (`B` — the major V of E minor, D♯ and all) before falling back, and the break
 * sits on Am so the return to Em feels earned. A track that never leaves four
 * chords is a track you stop hearing after two minutes.
 */
import type { BarDef, PartDef, TrackDef } from './types'

const Em: BarDef = { root: 40, chord: [55, 59, 64, 67], arp: [55, 59, 64, 67, 71, 67, 64, 59] }
const C: BarDef = { root: 36, chord: [60, 64, 67, 72], arp: [60, 64, 67, 72, 76, 72, 67, 64] }
const G: BarDef = { root: 31, chord: [55, 59, 62, 67], arp: [55, 59, 62, 67, 71, 67, 62, 59] }
/** D major — the F♯ that keeps E minor from collapsing into C major. */
const D: BarDef = { root: 38, chord: [57, 62, 66, 69], arp: [57, 62, 66, 69, 74, 69, 66, 62] }
const Am: BarDef = { root: 33, chord: [57, 60, 64, 69], arp: [57, 60, 64, 69, 72, 69, 64, 60] }
/** B major — the major V, the only D♯ in the track, and the bridge's whole point. */
// The figure's peak is D♯ (75), not D (74): a natural D against the chord's D♯
// is the one clash this key offers, and the arp runs sixteenths straight through
// it. Caught by the "arp figures come from their own chord" test.
const B: BarDef = { root: 35, chord: [59, 63, 66, 71], arp: [59, 63, 66, 71, 75, 71, 66, 63] }

/** Sixteenths with holes in them. The holes are what make it a groove. */
const DRIVE = [0, null, 0, 0, null, 0, 0, null, 0, null, 0, 0, null, 0, 12, null]
/** Half-time under the verse, so the drop has somewhere to go. */
const HALF = [0, null, null, null, null, null, 0, null, 0, null, null, null, null, null, 7, null]
/** Octave-jumping under the bridge. */
const OCTAVE = [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 7, null, 7, null]

const parts: PartDef[] = [
  {
    id: 'intro',
    role: 'intro',
    bars: [Em, C, G, D],
    div: 8,
    arpDiv: 16,
    bass: HALF,
  },
  {
    id: 'verse',
    role: 'verse',
    bars: [Em, C, G, D],
    div: 8,
    arpDiv: 16,
    bass: HALF,
    lead: [
      [67, 0, 71, 0, 76, -1, 0, 0], // G  B  E~
      [72, 0, 76, 0, 79, -1, 0, 0], // C  E  G~
      [71, 0, 74, 0, 79, -1, 0, 0], // B  D  G~
      [69, 0, 74, 0, 78, -1, -1, 0], // A  D  F♯~~
    ],
  },
  {
    id: 'chorus',
    role: 'chorus',
    bars: [Em, C, G, D],
    div: 16,
    arpDiv: 16,
    bass: DRIVE,
    // High and relentless, but every bar ends by falling back down — a line that
    // only ascends stops reading as a melody and starts reading as a siren.
    lead: [
      [83, 0, 81, 0, 79, 0, 0, 83, 0, -1, 0, 79, 0, 76, 0, 0], // B A G  B~ G E
      [84, 0, 83, 0, 79, 0, 0, 84, 0, -1, 0, 81, 0, 79, 0, 0], // C B G  C~ A G
      [86, 0, 83, 0, 79, 0, 0, 83, 0, -1, 0, 86, 0, 83, 0, 0], // D B G  B~ D B
      [81, 0, 83, 0, 86, 0, 0, 83, 0, -1, -1, 0, 0, 0, 0, 0], // A B D  B~~ ·
    ],
  },
  {
    id: 'chorusLift',
    role: 'chorus',
    bars: [Em, C, G, D],
    div: 16,
    arpDiv: 16,
    bass: DRIVE,
    lead: [
      [83, 0, 81, 0, 79, 0, 0, 83, 0, -1, 0, 79, 0, 76, 0, 0],
      [84, 0, 83, 0, 79, 0, 0, 84, 0, -1, 0, 81, 0, 79, 0, 0],
      [86, 0, 83, 0, 79, 0, 0, 83, 0, -1, 0, 86, 0, 83, 0, 0],
      [81, 0, 83, 0, 86, 0, 0, 83, 0, -1, -1, 0, 0, 0, 0, 0],
    ],
    counter: [
      [0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 67, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 67, 0, 0, 0, 0, 0, 72, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 62, 0, 0, 0, 0, 0, 67, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 66, 0, 0, 0, 0, 0, 69, 0, 71, 0],
    ],
  },
  {
    id: 'bridge',
    role: 'bridge',
    bars: [Am, B, Em, D],
    div: 8,
    arpDiv: 16,
    bass: OCTAVE,
    lead: [
      [72, 0, 76, 0, 81, -1, 0, 0], // A  C  E → over Am
      [71, 0, 75, 0, 78, -1, 0, 0], // B  D♯ F♯ → the modulation
      [83, 0, 79, 0, 76, 0, 71, 0], // B  G  E  B
      [78, 0, 81, 0, 86, -1, -1, 0], // F♯ A  D~~
    ],
  },
  {
    id: 'break',
    role: 'break',
    bars: [Am, C, Em, B],
    div: 8,
    arpDiv: 8,
    bass: HALF,
    lead: [
      [0, 0, 76, 0, 0, 0, 72, 0],
      [0, 0, 79, 0, 0, 0, 76, 0],
      [0, 0, 76, 0, 0, 0, 71, 0],
      [0, 0, 75, 0, 0, 0, 71, 0],
    ],
  },
]

export const voltage: TrackDef = {
  id: 'voltage',
  title: 'Voltage',
  blurb: {
    en: 'Dark electro · 145 BPM',
    fr: 'Électro sombre · 145 BPM',
  },
  bpm: 145,
  pump: [0.16, 0.4, 0.65, 0.82],
  drums: 'electro',
  voices: {
    lead: {
      wave: 'sawtooth', unison: 4, detune: 22, filter: 4400, q: 1.4,
      adsr: { attack: 0.006, decay: 0.14, sustain: 0.4, release: 0.2 },
      gain: 0.05, reverb: 0.4, echo: 'lead',
    },
    arp: {
      wave: 'square', unison: 2, detune: 12, filter: 3000, q: 4,
      adsr: { attack: 0.003, decay: 0.09, sustain: 0.1, release: 0.08 },
      gain: 0.032, reverb: 0.3, echo: 'arp',
    },
    pad: {
      wave: 'sawtooth', unison: 6, detune: 36, filter: 1300,
      adsr: { attack: 0.5, decay: 0.01, sustain: 1, release: 1.1 },
      gain: 0.04, reverb: 0.75,
    },
    stab: {
      wave: 'sawtooth', unison: 3, detune: 20, filter: 2400,
      adsr: { attack: 0.003, decay: 0.07, sustain: 0, release: 0.06 },
      gain: 0.03, reverb: 0.3,
    },
    // The wobble is slow on purpose: fast enough to talk, slow enough that it is
    // not a dubstep novelty you get sick of in one round.
    bass: {
      subGain: 0.15, bodyWave: 'sawtooth', bodyGain: 0.05,
      cutoff: [300, 1000], q: 1.1, length: 0.85, wobble: 2.6,
    },
  },
  parts,
  form: ['intro', 'verse', 'chorus', 'chorusLift', 'break', 'verse', 'chorus', 'bridge', 'chorusLift'],
}
