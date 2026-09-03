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
    id: 'intermission',
    title: 'Intermission',
    blurb: {
      fr: 'Le jazz qui passe pendant que la table compte les points.',
      en: 'The jazz that plays while the table counts up.',
    },
    family: 'lounge',
    sections: ['breakdown'],
    seconds: 101.647074829932,
  },
  {
    id: 'small-talk',
    title: 'Small Talk',
    blurb: {
      fr: "Rien de sérieux ne s'est encore produit, et ça s'entend.",
      en: 'Nothing serious has happened yet, and it shows.',
    },
    family: 'party',
    sections: ['breakdown', 'buildup'],
    seconds: 60,
  },
  {
    id: 'rowdy',
    title: 'Rowdy',
    blurb: {
      fr: 'Ça commence à parler fort autour de la table.',
      en: 'The table is starting to talk over itself.',
    },
    family: 'party',
    sections: ['buildup', 'groove'],
    seconds: 72,
  },
  {
    id: 'sleight',
    title: 'Sleight',
    blurb: {
      fr: "La musique de quelqu'un qui prépare un mauvais coup.",
      en: 'The music of somebody setting something up.',
    },
    family: 'lounge',
    sections: ['groove'],
    seconds: 56.470589569161,
  },
  {
    id: 'on-the-run',
    title: 'On the Run',
    blurb: {
      fr: 'Le funk qui se déclenche quand la fin arrive trop vite.',
      en: 'The funk that starts when the finish comes up too fast.',
    },
    family: 'lounge',
    sections: ['groove', 'drop'],
    seconds: 43.8260997732426,
  },
  {
    id: 'bad-manners',
    title: 'Bad Manners',
    blurb: {
      fr: "Une carte en main quelque part, et plus personne n'est poli.",
      en: 'One card in somebody’s hand, and nobody is polite any more.',
    },
    family: 'party',
    sections: ['drop'],
    seconds: 50.0869614512472,
  },
  {
    id: 'nightcap',
    title: 'Nightcap',
    blurb: {
      fr: 'Le calme juste avant que ça reparte.',
      en: 'The quiet just before it starts again.',
    },
    family: 'night',
    sections: ['breakdown', 'buildup'],
    seconds: 40.421065759637,
  },
  {
    id: 'sidetrack',
    title: 'Sidetrack',
    blurb: {
      fr: 'La partie a pris une direction, on ne sait pas encore laquelle.',
      en: 'The match has picked a direction, nobody knows which yet.',
    },
    family: 'night',
    sections: ['buildup', 'groove'],
    seconds: 51,
  },
  {
    id: 'mirage',
    title: 'Mirage',
    blurb: {
      fr: 'Quelqu’un croit avoir compris ce que tient son voisin.',
      en: 'Somebody thinks they know what their neighbour is holding.',
    },
    family: 'night',
    sections: ['groove'],
    seconds: 61.5384807256236,
  },
  {
    id: 'pile-up',
    title: 'Pile-Up',
    blurb: {
      fr: 'Trois cartes identiques et plus personne ne sait à qui c’est le tour.',
      en: 'Three identical cards and nobody knows whose turn it is.',
    },
    family: 'party',
    sections: ['groove', 'drop'],
    seconds: 38.4,
  },
  {
    id: 'uproar',
    title: 'Uproar',
    blurb: {
      fr: 'Le moment où toute la table se met à parler en même temps.',
      en: 'The moment the whole table starts talking at once.',
    },
    family: 'party',
    sections: ['groove', 'drop'],
    seconds: 43.6363718820862,
  },
  {
    id: 'idle-hands',
    title: 'Idle Hands',
    blurb: {
      fr: 'Personne ne joue, tout le monde regarde le tapis.',
      en: 'Nobody is playing, everybody is looking at the felt.',
    },
    family: 'lounge',
    sections: ['breakdown'],
    seconds: 101.684218,
  },
  {
    id: 'fanned-out',
    title: 'Fanned Out',
    blurb: {
      fr: 'Le jazz qui se joue pendant qu’on remet les cartes en ordre.',
      en: 'The jazz that plays while hands get sorted back out.',
    },
    family: 'lounge',
    sections: ['breakdown', 'buildup'],
    seconds: 87.272744,
  },
  {
    id: 'patience',
    title: 'Patience',
    blurb: {
      fr: 'On attend quelqu’un, et ça ne presse pas encore.',
      en: 'Somebody is still missing, and there is no hurry yet.',
    },
    family: 'night',
    sections: ['buildup'],
    seconds: 90.352948,
  },
  {
    id: 'full-table',
    title: 'Full Table',
    blurb: {
      fr: 'Le tour de chacun, sans que rien de grave arrive.',
      en: 'Everybody’s turn, and nothing much at stake.',
    },
    family: 'lounge',
    sections: ['groove'],
    seconds: 60.923084,
  },
  {
    id: 'clockwork',
    title: 'Clockwork',
    blurb: {
      fr: 'La partie tourne, chacun voit son plan avancer.',
      en: 'The match turns over, everybody watching their own plan.',
    },
    family: 'night',
    sections: ['groove'],
    seconds: 67.764717,
  },
  {
    id: 'neck-and-neck',
    title: 'Neck and Neck',
    blurb: {
      fr: 'Deux joueurs se tiennent et personne ne lâche.',
      en: 'Two players neck and neck, and neither is letting go.',
    },
    family: 'night',
    sections: ['groove', 'drop'],
    seconds: 56.470590,
  },
  {
    id: 'runaway',
    title: 'Runaway',
    blurb: {
      fr: 'Ça part dans tous les sens et ça ne se rattrape plus.',
      en: 'It has got away from everybody and there is no catching it.',
    },
    family: 'night',
    sections: ['drop'],
    seconds: 58.666667,
  },
]

export const DEFAULT_LOOP_ID = LOOPS[0].id

/** Falls back to the first rather than going silent on an unknown id. */
export function getLoop(id: string | undefined): LoopDef {
  return LOOPS.find((l) => l.id === id) ?? LOOPS[0]
}

export type { LoopDef } from './types'
