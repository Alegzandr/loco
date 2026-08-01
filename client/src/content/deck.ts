/**
 * The deck, as the tables and the catalogue a content page needs: what is in it,
 * what each card does, and what it costs you to still be holding it.
 *
 * One structure rather than three because the composition, the effects and the
 * scoring are the same eight kinds seen from three angles, and pages that listed
 * them separately would eventually disagree with each other. The numbers come
 * from `docs/rules.md` §2 and §10, and `contentPages.test.ts` checks them
 * against `server/game/deck.go` and `server/game/card.go`, which are the only
 * authorities in the repo.
 *
 * The *names* deliberately do not come from `docs/rules.md`: that file is the
 * implementation spec and still calls these by their SOLO names ("Miss a Turn",
 * "Change Cards All Round"). The player-facing names live in `t.cardNames`.
 *
 * Build-time only, like everything under `src/content/`: this never ships to a
 * player, so it does not grow the bundle that does.
 */
import type { CardKind } from '../types/protocol'
import type { Lang } from '../seo/meta'

export interface DeckEntry {
  kind: CardKind
  /** How many of this kind are in the 112. */
  copies: number
  /**
   * Points it is worth in somebody else's hand when the round ends. `null` for
   * numbers, which are worth their face value and so have no single number.
   */
  points: number | null
  /** How the copies break down, in each language. */
  detail: Record<Lang, string>
  /**
   * What the card does, as a catalogue entry.
   *
   * Deliberately its own wording rather than the matching line of `t.rules`:
   * that line is a rulebook bullet read in sequence ("Skip: the next player
   * loses their turn."), this one is read on its own by somebody who came
   * looking for one card. Mapping a kind to a bullet would mean parsing a name
   * out of a sentence, which breaks on the first rewording. The *facts* are not
   * duplicated: copies and points are checked against the server.
   */
  effect: Record<Lang, string>
}

export const DECK: readonly DeckEntry[] = [
  {
    kind: 'number',
    copies: 72,
    points: null,
    detail: {
      en: '4 colours × values 1 to 9 × 2 copies',
      fr: '4 couleurs × valeurs 1 à 9 × 2 exemplaires',
    },
    effect: {
      en: 'Plays on a card of the same colour or the same number, and does nothing else. Most of a hand is these, and most of a turn is finding one that fits.',
      fr: 'Se pose sur une carte de la même couleur ou du même chiffre, et ne fait rien de plus. L’essentiel d’une main, et l’essentiel d’un tour.',
    },
  },
  {
    kind: 'skip',
    copies: 8,
    points: 20,
    detail: { en: '4 colours × 2 copies', fr: '4 couleurs × 2 exemplaires' },
    effect: {
      en: 'The next player loses their turn. In a duel that means the turn comes straight back to you.',
      fr: 'Le joueur suivant saute son tour. En duel, la main te revient donc aussitôt.',
    },
  },
  {
    kind: 'reverse',
    copies: 8,
    points: 10,
    detail: { en: '4 colours × 2 copies', fr: '4 couleurs × 2 exemplaires' },
    effect: {
      en: 'Play changes direction. With two players there is nobody to go around, so it behaves like a second Skip.',
      fr: 'Le jeu repart dans l’autre sens. À deux, il n’y a personne à contourner : ça revient à un Passe.',
    },
  },
  {
    kind: 'draw_two',
    copies: 8,
    points: 30,
    detail: { en: '4 colours × 2 copies', fr: '4 couleurs × 2 exemplaires' },
    effect: {
      en: 'The next player draws two, unless they answer with a +2 of their own and pass the whole stack along. Taking the cards does not cost them the turn: they draw, then play or pass.',
      fr: 'Le suivant pioche deux cartes, sauf s’il répond par un +2 et fait suivre toute la pile. Piocher ne lui coûte pas son tour : il pioche, puis joue ou passe.',
    },
  },
  {
    kind: 'swap',
    copies: 4,
    points: 30,
    detail: { en: '4 colours × 1 copy', fr: '4 couleurs × 1 exemplaire' },
    effect: {
      en: 'Played on your turn like any coloured card. Pick anyone at the table and take their whole hand; they get yours.',
      fr: 'Se joue à ton tour comme n’importe quelle carte colorée. Tu désignes quelqu’un et tu prends toute sa main ; il récupère la tienne.',
    },
  },
  {
    kind: 'global_switch',
    copies: 4,
    points: 40,
    detail: { en: 'no colour: it plays on anything', fr: 'sans couleur : elle se pose sur tout' },
    effect: {
      en: 'Name the new colour, then every hand at the table slides one seat along. Nobody keeps anything.',
      fr: 'Tu annonces la nouvelle couleur, puis chaque main glisse d’une place. Personne ne garde rien.',
    },
  },
  {
    kind: 'wild',
    copies: 4,
    points: 40,
    detail: { en: 'no colour: it plays on anything', fr: 'sans couleur : elle se pose sur tout' },
    effect: {
      en: 'Lands on anything, whatever colour is on the pile. You name the colour that follows.',
      fr: 'Se pose sur n’importe quoi, quelle que soit la couleur en cours. C’est toi qui annonces la couleur suivante.',
    },
  },
  {
    kind: 'wild_draw_four',
    copies: 4,
    points: 50,
    detail: { en: 'no colour: it plays on anything', fr: 'sans couleur : elle se pose sur tout' },
    effect: {
      en: 'Lands on anything, names the colour, and the next player draws four unless they stack a +4 of their own.',
      fr: 'Se pose sur n’importe quoi, annonce la couleur, et le suivant pioche quatre cartes s’il ne cumule pas un +4.',
    },
  },
]

/** 112. Asserted in a test, because the tables are only right if this is. */
export const DECK_SIZE = DECK.reduce((n, e) => n + e.copies, 0)

/** The four suits, in the order the card art fans them. */
export const SUITS = ['red', 'yellow', 'green', 'blue'] as const

/** Entry by kind, for a page that walks the deck in its own order. */
export function entry(kind: CardKind): DeckEntry {
  const found = DECK.find((e) => e.kind === kind)
  if (!found) throw new Error(`no deck entry for ${kind}`)
  return found
}
