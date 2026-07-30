/**
 * PIXEL RUSH — electro house, 128 BPM, C major.
 *
 * The bright one. Where Neon Horizon is a wash of supersaws, this is *plucks*:
 * short square-ish notes with a lot of air between them, offbeat chord stabs, an
 * open hat on the "and", and a bass that only ever plays offbeats. It is the
 * Newgrounds-electro end of the Geometry Dash catalogue — major key, obvious
 * hook, nothing brooding about it.
 *
 * The chorus hook is written on a sixteenth grid rather than an eighth one, which
 * is where the bounce comes from: the long note lands *between* beats 2 and 3
 * instead of on a beat. Syncopation is the whole difference between a hook and a
 * scale exercise, and it costs nothing to write down.
 */
import type { BarDef, PartDef, TrackDef } from './types'

const C: BarDef = { root: 36, chord: [60, 64, 67, 72], arp: [60, 64, 67, 72, 76, 72, 67, 64] }
const G: BarDef = { root: 31, chord: [55, 59, 62, 67], arp: [55, 59, 62, 67, 71, 67, 62, 59] }
const Am: BarDef = { root: 33, chord: [57, 60, 64, 69], arp: [57, 60, 64, 69, 72, 69, 64, 60] }
const F: BarDef = { root: 29, chord: [53, 57, 60, 65], arp: [53, 57, 60, 65, 69, 65, 60, 57] }
const Dm: BarDef = { root: 38, chord: [57, 62, 65, 69], arp: [57, 62, 65, 69, 74, 69, 65, 62] }
const Em: BarDef = { root: 40, chord: [55, 59, 64, 67], arp: [55, 59, 64, 67, 71, 67, 64, 59] }

/** House bass: offbeat eighths only. The kick owns every downbeat. */
const OFFBEAT = [
  null, null, 0, null, null, null, 0, null,
  null, null, 0, null, null, null, 0, null,
]
/** Same, with an octave jump on the last two — the bar stops being four copies. */
const OFFBEAT_LIFT = [
  null, null, 0, null, null, null, 0, null,
  null, null, 12, null, null, null, 7, null,
]
/** Driving under the bridge: a note on every eighth. */
const DRIVE = [0, null, 0, null, 7, null, 0, null, 12, null, 0, null, 7, null, 0, null]

/** Chord stabs on the "and" of every beat — the house signature. */
const STABS = [2, 6, 10, 14]

const parts: PartDef[] = [
  {
    id: 'intro',
    role: 'intro',
    bars: [C, G, Am, F],
    div: 8,
    arpDiv: 16,
    bass: OFFBEAT,
    stabs: STABS,
  },
  {
    id: 'verse',
    role: 'verse',
    bars: [C, G, Am, F],
    div: 8,
    arpDiv: 16,
    bass: OFFBEAT,
    lead: [
      [64, 0, 67, 0, 72, -1, 0, 0], // E  G  C~
      [62, 0, 67, 0, 71, -1, 0, 0], // D  G  B~
      [64, 0, 69, 0, 72, -1, 0, 0], // E  A  C~
      [65, 0, 69, 0, 72, -1, -1, 0], // F  A  C~~
    ],
  },
  {
    id: 'chorus',
    role: 'chorus',
    bars: [C, G, Am, F],
    div: 16,
    arpDiv: 16,
    bass: OFFBEAT_LIFT,
    stabs: STABS,
    // The hook. Note where the ties fall: the held note starts on the "and" of
    // beat 2, so the phrase leans forward instead of sitting on the grid.
    lead: [
      [72, 0, 72, 0, 76, 0, 0, 79, 0, -1, 0, 0, 76, 0, 74, 0], // C C E  G~  E D
      [74, 0, 74, 0, 71, 0, 0, 74, 0, -1, 0, 0, 71, 0, 67, 0], // D D B  D~  B G
      [72, 0, 72, 0, 76, 0, 0, 81, 0, -1, 0, 0, 79, 0, 76, 0], // C C E  A~  G E
      [77, 0, 76, 0, 74, 0, 0, 72, 0, -1, -1, 0, 0, 0, 0, 0], // F E D  C~~ ·
    ],
  },
  {
    id: 'chorusLift',
    role: 'chorus',
    bars: [C, G, Am, F],
    div: 16,
    arpDiv: 16,
    bass: OFFBEAT_LIFT,
    stabs: STABS,
    lead: [
      [72, 0, 72, 0, 76, 0, 0, 79, 0, -1, 0, 0, 76, 0, 74, 0],
      [74, 0, 74, 0, 71, 0, 0, 74, 0, -1, 0, 0, 71, 0, 67, 0],
      [72, 0, 72, 0, 76, 0, 0, 81, 0, -1, 0, 0, 79, 0, 76, 0],
      [77, 0, 76, 0, 74, 0, 0, 72, 0, -1, -1, 0, 0, 0, 0, 0],
    ],
    // Fills the hook's one long gap — bar 4, where the lead has stopped.
    counter: [
      [0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 67, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 62, 0, 67, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 64, 0, 69, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0, 65, 0, 69, 0, 71, 0, 72, 0],
    ],
  },
  {
    id: 'bridge',
    role: 'bridge',
    bars: [Am, F, Dm, G],
    div: 8,
    arpDiv: 16,
    bass: DRIVE,
    stabs: STABS,
    lead: [
      [69, 0, 72, 0, 76, -1, 0, 0], // A  C  E~
      [77, 0, 76, 0, 72, -1, 0, 0], // F  E  C~
      [74, 0, 77, 0, 81, -1, 0, 0], // D  F  A~
      [79, 0, 74, 0, 71, -1, -1, 0], // G  D  B~~
    ],
  },
  {
    id: 'break',
    role: 'break',
    bars: [C, Am, F, Em],
    div: 8,
    arpDiv: 8,
    bass: OFFBEAT,
    lead: [
      [0, 0, 72, 0, 0, 0, 76, 0],
      [0, 0, 69, 0, 0, 0, 72, 0],
      [0, 0, 72, 0, 0, 0, 69, 0],
      [0, 0, 71, 0, 0, 0, 67, 0],
    ],
  },
]

export const pixelRush: TrackDef = {
  id: 'pixel-rush',
  title: 'Pixel Rush',
  blurb: {
    en: 'Electro house · 128 BPM',
    fr: 'Électro house · 128 BPM',
  },
  bpm: 128,
  // Deeper than the trance pump: house lives on the sidechain.
  pump: [0.18, 0.45, 0.72, 0.88],
  drums: 'house',
  voices: {
    lead: {
      wave: 'square', unison: 3, detune: 16, filter: 3800,
      adsr: { attack: 0.006, decay: 0.12, sustain: 0.35, release: 0.18 },
      gain: 0.05, reverb: 0.35, echo: 'lead',
    },
    arp: {
      wave: 'sawtooth', unison: 3, detune: 14, filter: 2800, q: 3,
      adsr: { attack: 0.004, decay: 0.1, sustain: 0.12, release: 0.09 },
      gain: 0.04, reverb: 0.3, echo: 'arp',
    },
    pad: {
      wave: 'sawtooth', unison: 5, detune: 30, filter: 1500,
      adsr: { attack: 0.35, decay: 0.01, sustain: 1, release: 1 },
      gain: 0.038, reverb: 0.6,
    },
    stab: {
      wave: 'sawtooth', unison: 4, detune: 28, filter: 3000,
      adsr: { attack: 0.003, decay: 0.08, sustain: 0, release: 0.07 },
      gain: 0.042, reverb: 0.35,
    },
    bass: {
      subGain: 0.16, bodyWave: 'square', bodyGain: 0.042,
      cutoff: [380, 900], q: 0.8, length: 1.6,
    },
  },
  parts,
  form: ['intro', 'verse', 'chorus', 'chorusLift', 'bridge', 'chorus', 'chorusLift', 'verse', 'break'],
}
