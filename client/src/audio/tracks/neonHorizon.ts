/**
 * NEON HORIZON — uplifting trance, 138 BPM, A minor.
 *
 * Transcribed from the user's own Strudel sketch,
 * `F:\dev\strudel-test\neon-horizon.strudel`: same tempo, same vi–IV–I–V, same
 * arpeggio figures, same chord voicings, same ADSRs, same pump. **The `chorus`
 * part's lead is his, note for note** — that is the hook, and it is pinned by a
 * test so nobody "improves" it by accident.
 *
 * Everything else here is what the sketch did not have and a twenty-minute match
 * needs: a verse that leaves room, a counter-melody over the second chorus, a
 * bridge that finally goes somewhere harmonically (Dm → E, the first major V in
 * the track, which is what makes the return to Am feel like a return), and a
 * break to fall into between rounds.
 */
import type { BarDef, PartDef, TrackDef } from './types'

// ── Harmony. Voicings are the sketch's: <[a3,c4,e4,a4] [f3,a3,c4,f4] …>
const Am: BarDef = { root: 33, chord: [57, 60, 64, 69], arp: [57, 60, 64, 69, 72, 69, 64, 60] }
const F: BarDef = { root: 29, chord: [53, 57, 60, 65], arp: [53, 57, 60, 65, 69, 65, 60, 57] }
const C: BarDef = { root: 36, chord: [60, 64, 67, 72], arp: [60, 64, 67, 72, 76, 72, 67, 64] }
const G: BarDef = { root: 31, chord: [55, 59, 62, 67], arp: [55, 59, 62, 67, 71, 67, 62, 59] }
const Dm: BarDef = { root: 38, chord: [57, 62, 65, 69], arp: [57, 62, 65, 69, 74, 69, 65, 62] }
/** E major — the G♯ is the only accidental in the track, and it is the point. */
const E: BarDef = { root: 40, chord: [56, 59, 64, 68], arp: [56, 59, 64, 68, 71, 68, 64, 59] }

/** `struct("[~ x x x]*4")` — the sketch's roll. Never on the downbeat, so never on the kick. */
const ROLL = [null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 0, null, 0, 0, 0]
/** Sparser, with an octave lift on the last beat: room for a verse to breathe. */
const PUSH = [null, null, 0, 0, null, null, 0, 0, null, null, 0, 0, null, null, 12, 0]
/** Walking under the bridge — root, fifth, octave. A line, not a pulse. */
const WALK = [0, null, null, 7, null, null, 12, null, 0, null, null, 7, null, 12, null, null]

const parts: PartDef[] = [
  {
    id: 'intro',
    role: 'intro',
    bars: [Am, F, C, G],
    div: 8,
    arpDiv: 16,
    bass: PUSH,
  },
  {
    id: 'verse',
    role: 'verse',
    bars: [Am, F, C, G],
    div: 8,
    arpDiv: 16,
    bass: ROLL,
    // Low, held, and mostly silence — a verse exists so the chorus can arrive.
    lead: [
      [69, 0, 72, 0, 74, -1, 0, 0], // A  C  D~
      [72, 0, 69, 0, 65, -1, 0, 0], // C  A  F~
      [67, 0, 72, 0, 76, -1, -1, 0], // G  C  E~~
      [74, 0, 71, 0, 67, -1, 0, 0], // D  B  G~
    ],
  },
  {
    id: 'chorus',
    role: 'chorus',
    bars: [Am, F, C, G],
    div: 8,
    arpDiv: 16,
    bass: ROLL,
    // The sketch's lead, verbatim:
    //   [e5 ~ c5 e5 ~ a4 ~ c5] [~ e5 ~ a5 g5 ~ e5 ~]
    //   [f5 ~ c5 f5 ~ a4 ~ c5] [~ f5 ~ a5 g5 ~ e5 ~]
    // Bars 3–4 keep F natural over C and G — an 11th and a dominant colour. That
    // is his sound, not a transcription slip.
    lead: [
      [76, 0, 72, 76, 0, 69, 0, 72],
      [0, 76, 0, 81, 79, 0, 76, 0],
      [77, 0, 72, 77, 0, 69, 0, 72],
      [0, 77, 0, 81, 79, 0, 76, 0],
    ],
  },
  {
    id: 'chorusLift',
    role: 'chorus',
    bars: [Am, F, C, G],
    div: 8,
    arpDiv: 16,
    bass: ROLL,
    lead: [
      [76, 0, 72, 76, 0, 69, 0, 72],
      [0, 76, 0, 81, 79, 0, 76, 0],
      [77, 0, 72, 77, 0, 69, 0, 72],
      [0, 77, 0, 81, 79, 0, 76, 0],
    ],
    // The answer, in the lead's own gaps and below it, so the two never mask
    // each other. This is the second pass of the hook: same tune, more track.
    counter: [
      [0, 0, 0, 0, 64, 0, 67, 0],
      [69, 0, 0, 0, 0, 0, 72, 0],
      [0, 0, 0, 0, 65, 0, 69, 0],
      [72, 0, 0, 0, 71, 0, 0, 0],
    ],
  },
  {
    id: 'bridge',
    role: 'bridge',
    bars: [Dm, E, Am, G],
    div: 8,
    arpDiv: 16,
    bass: WALK,
    // Rising through the iv and the major V. The sketch never leaves
    // vi–IV–I–V, which is why four bars of it eventually reads as wallpaper.
    lead: [
      [74, 0, 77, 0, 81, -1, 0, 0], // D  F  A~
      [76, 0, 80, 0, 83, -1, 0, 0], // E  G♯ B~
      [81, 0, 79, 0, 76, 0, 72, 0], // A  G  E  C
      [74, 0, 76, 0, 79, -1, -1, 0], // D  E  G~~
    ],
  },
  {
    id: 'break',
    role: 'break',
    bars: [Am, F, Dm, E],
    div: 8,
    arpDiv: 8,
    bass: PUSH,
    lead: [
      [0, 0, 76, 0, 0, 0, 72, 0],
      [0, 0, 77, 0, 0, 0, 72, 0],
      [0, 0, 74, 0, 0, 0, 69, 0],
      [0, 0, 71, 0, 0, 0, 68, 0],
    ],
  },
]

export const neonHorizon: TrackDef = {
  id: 'neon-horizon',
  title: 'Neon Horizon',
  blurb: {
    en: 'Uplifting trance · 138 BPM',
    fr: 'Trance uplifting · 138 BPM',
  },
  bpm: 138,
  // `.gain("[.15 .3 .4 .45]*4")` on the pad — the sketch's stepped sidechain.
  pump: [0.15, 0.3, 0.4, 0.45],
  drums: 'trance',
  voices: {
    // supersaw spread .7 unison 5, lpf 4000, att .01 dec .2 sus .5 rel .3
    lead: {
      wave: 'sawtooth', unison: 5, detune: 35, filter: 4000,
      adsr: { attack: 0.01, decay: 0.2, sustain: 0.5, release: 0.3 },
      gain: 0.062, reverb: 0.6, echo: 'lead',
    },
    // supersaw spread .6 unison 5, lpf sine 700→3500, lpq 5 — the resonance is
    // the arp's character, not an accident.
    arp: {
      wave: 'sawtooth', unison: 5, detune: 30, filter: 3500, q: 5,
      adsr: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.1 },
      gain: 0.05, reverb: 0.4, echo: 'arp',
    },
    // supersaw spread .8 unison 7, lpf 1600, att .4 rel 1.2
    pad: {
      wave: 'sawtooth', unison: 7, detune: 40, filter: 1600,
      adsr: { attack: 0.4, decay: 0.01, sustain: 1, release: 1.2 },
      gain: 0.05, reverb: 0.7,
    },
    stab: {
      wave: 'sawtooth', unison: 3, detune: 25, filter: 2600,
      adsr: { attack: 0.004, decay: 0.09, sustain: 0, release: 0.08 },
      gain: 0.03, reverb: 0.3,
    },
    // Deviation from the sketch, requested: no `lpq(8)`, no `shape(.3)`.
    bass: {
      subGain: 0.15, bodyWave: 'sawtooth', bodyGain: 0.055,
      cutoff: [420, 780], q: 0.7, length: 0.9,
    },
  },
  parts,
  // ~36 bars, a minute of music before anything comes round again.
  form: ['intro', 'verse', 'chorus', 'chorusLift', 'bridge', 'verse', 'chorus', 'chorusLift', 'break'],
}
