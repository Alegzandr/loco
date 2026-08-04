/**
 * "If you have played a game of colours and symbols": the eight things LOCO
 * does differently, for the visitor who arrives with a model of that game
 * already in their head and is looking for the delta.
 *
 * It exists because the delta was unfindable. The home page carried three
 * bullets, only one of which was about the rules, and the real differences were
 * spread across ten sections of the rules page — so a first-time visitor read a
 * rulebook to answer a question they could have been told the answer to.
 *
 * **The numbers are not typed here.** They are constants checked against the
 * server by `contentPages.test.ts`, exactly as the deck table is: a hand size
 * copied by hand would be right on the day it was written and wrong on the day
 * `initialHandSize` moved, and this page is the copy nobody plays against, so it
 * would stay wrong silently.
 *
 * **This block does not go in the rules modal.** The modal is a reference read
 * standing up in the middle of a round; this is an argument read before the
 * first one. `contentPages.test.ts` pins that too.
 *
 * Build-time only, like everything under `src/content/`.
 */
import { DECK_SIZE } from './deck'
import type { Lang } from '../seo/meta'

/** Cards dealt to each seat (`initialHandSize`, server/game/room.go). */
export const HAND_SIZE = 8

/** The lowest and highest number in the deck (server/game/deck.go). No zero. */
export const NUMBER_LOW = 1
export const NUMBER_HIGH = 9

/** One line of the block, in both languages. */
export type Contrast = Record<Lang, string>

export const CONTRASTS: readonly Contrast[] = [
  {
    en: `You are dealt ${HAND_SIZE} cards.`,
    fr: `On te distribue ${HAND_SIZE} cartes.`,
  },
  {
    en: `${DECK_SIZE} cards in the deck, numbered ${NUMBER_LOW} to ${NUMBER_HIGH}. There is no 0.`,
    fr: `${DECK_SIZE} cartes dans le jeu, numérotées de ${NUMBER_LOW} à ${NUMBER_HIGH}. Il n’y a pas de 0.`,
  },
  {
    en: 'Doubles go down together: every identical copy in one tap, and the effects stack. Three +2s make the next player draw six.',
    fr: 'Les doublons partent ensemble : tous les exemplaires identiques d’un seul geste, et les effets se cumulent. Trois +2 font piocher six cartes.',
  },
  {
    en: 'Swap: you take somebody’s whole hand, and they take yours.',
    fr: 'Échange : tu prends toute la main de quelqu’un, et il récupère la tienne.',
  },
  {
    en: 'Global Switch: every hand at the table slides one seat along. Nobody keeps anything.',
    fr: 'Rotation : chaque main glisse d’une place autour de la table. Personne ne garde rien.',
  },
  {
    en: 'A forced draw costs you cards, not your turn. You take the stack, then you play or you pass.',
    fr: 'Une pioche forcée te coûte des cartes, pas ton tour. Tu prends la pile, puis tu joues ou tu passes.',
  },
  {
    en: 'A match is played in rounds won, not in points. It ends the moment the lead cannot be caught.',
    fr: 'Un match se joue en manches gagnantes, pas en points. Il s’arrête dès que l’avance est imprenable.',
  },
  {
    en: 'A Catch! that misses costs the caller a card. It is a bet, not a free shot.',
    fr: 'Un Contre-LOCO raté coûte une carte à celui qui le crie. C’est un pari, pas un coup gratuit.',
  },
]
