/**
 * The shape of a loop.
 *
 * A loop is **data**: a file name, the section it can carry, and how long one
 * turn of it lasts. `music.ts` is the one engine that plays any of them, so
 * adding a loop is a matter of encoding a file and writing an entry, never of
 * writing Web Audio.
 *
 * ## Why a set of loops rather than one adaptive track
 *
 * Every note used to be synthesised here, and a track was a set of parts plus a
 * form the engine walked, because the version before *that* was one four-bar
 * loop whose only variation was layer count — "a chorus on repeat", which it
 * was. The music is files now, so the form is gone, and the property it was
 * defending has to be bought some other way.
 *
 * It is bought by having **more loops than sections**. Each loop declares the
 * sections it can carry, the bed plays one that fits where the table currently
 * is, and it changes loop for two reasons: the table moved to another section,
 * or this one has come round `LAPS_PER_LOOP` times. So an ordinary match hears
 * several distinct pieces of music, and it hears them because the game moved,
 * which is the same contract the form served under a different mechanism.
 *
 * That is also why `sections` is a list. A loop pinned to exactly one section
 * would mean an ordinary turn — where a match spends most of its time — hearing
 * one piece of music forever, which is the failure this design exists to avoid.
 */
import type { Section } from '../music'

export interface LoopDef {
  /**
   * Both the registry key and the file name: the bed fetches
   * `${MUSIC_BASE}/${id}.mp3`. Kept in sync with `client/public/music/` by
   * `music.test.ts`, which fails on an entry with no file behind it.
   */
  id: string
  /**
   * What a player reads in the audio panel.
   *
   * **One string, in English, and never translated.** A title is a name, not
   * copy: it is what this piece is called, the way a font or a room is called
   * something, and a name that changed with the interface language would be two
   * different pieces to anybody who switched. `blurb` below is the copy and is
   * per language, which is the line between the two.
   *
   * A title names the writing, never the genre, and never the source file's
   * date — these arrive as `Sketchbook 2024-05-29`, which says nothing about
   * this piece that it would not say about the other two hundred in the pack.
   */
  title: string
  /**
   * One line in the panel, under the title. This *is* copy, so it is written in
   * both languages and follows the game's voice like every other string a
   * player reads.
   */
  blurb: { fr: string; en: string }
  /**
   * Which sections this loop can carry, in no particular order. At least one,
   * and every section must be offered by at least two loops across the
   * registry — otherwise a table that sits in one section hears one loop.
   */
  sections: Section[]
  /**
   * One turn of the loop, in seconds, taken from the **source** file rather
   * than from the MP3.
   *
   * This is the whole seamlessness mechanism. MP3 carries encoder delay at the
   * head and padding at the tail, both of which survive `decodeAudioData`, so a
   * buffer looped on its own length inserts a gap — the one defect the pack's
   * own README warns about. The bed skips the head by finding the first audible
   * sample and sets `loopEnd` to that offset plus this figure, which puts the
   * seam back exactly where the composer cut it.
   */
  seconds: number
}
