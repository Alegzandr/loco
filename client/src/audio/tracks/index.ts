/**
 * The loop registry.
 *
 * Adding a loop is: encode it into `client/public/music/`, put an entry here.
 * The engine, the panel, the tests and the audio harness all read this list, so
 * nothing else needs touching.
 *
 * ## Where the music comes from
 *
 * Abstraction (Tallbeard Studios), *Music Loop Bundle*, released **CC0**. The
 * files are normalised to −18 LUFS with peaks under −2 dBTP and re-encoded to
 * MP3, and they are served from this origin like every other asset — never a
 * CDN, because a request to somebody else's host from a player's browser is the
 * one thing `docs/notes/legal.md` is built to avoid. Credit and licence live in
 * `NOTICE.md` and `client/public/licenses.txt`.
 *
 * MP3 rather than the source OGG on purpose: Safari only decodes Ogg Vorbis
 * natively from 18.4, and before that `decodeAudioData` refuses it outright —
 * which on this platform fails as silence rather than as an error, the exact
 * failure mode `docs/notes/audio.md` already documents three of.
 */
import type { LoopDef } from './types'

/** Where the files are served from. Same origin, always. */
export const MUSIC_BASE = '/music'

export const LOOPS: LoopDef[] = [
  {
    id: 'entracte',
    title: 'Entracte',
    blurb: {
      fr: 'Le jazz qui passe pendant que la table compte les points.',
      en: 'The jazz that plays while the table counts up.',
    },
    sections: ['breakdown'],
    seconds: 101.647074829932,
  },
  {
    id: 'badinage',
    title: 'Badinage',
    blurb: {
      fr: "Rien de sérieux ne s'est encore produit, et ça s'entend.",
      en: 'Nothing serious has happened yet, and it shows.',
    },
    sections: ['breakdown', 'buildup'],
    seconds: 60,
  },
  {
    id: 'chahut',
    title: 'Chahut',
    blurb: {
      fr: 'Ça commence à parler fort autour de la table.',
      en: 'The table is starting to talk over itself.',
    },
    sections: ['buildup', 'groove'],
    seconds: 72,
  },
  {
    id: 'filou',
    title: 'Filou',
    blurb: {
      fr: "La musique de quelqu'un qui prépare un mauvais coup.",
      en: 'The music of somebody setting something up.',
    },
    sections: ['groove'],
    seconds: 56.470589569161,
  },
  {
    id: 'cavale',
    title: 'Cavale',
    blurb: {
      fr: 'Le funk qui se déclenche quand la fin arrive trop vite.',
      en: 'The funk that starts when the finish comes up too fast.',
    },
    sections: ['groove', 'drop'],
    seconds: 43.8260997732426,
  },
  {
    id: 'ruade',
    title: 'Ruade',
    blurb: {
      fr: "Une carte en main quelque part, et plus personne n'est poli.",
      en: 'One card in somebody’s hand, and nobody is polite any more.',
    },
    sections: ['drop'],
    seconds: 50.0869614512472,
  },
]

export const DEFAULT_LOOP_ID = LOOPS[0].id

/** Falls back to the first rather than going silent on an unknown id. */
export function getLoop(id: string | undefined): LoopDef {
  return LOOPS.find((l) => l.id === id) ?? LOOPS[0]
}

export type { LoopDef } from './types'
