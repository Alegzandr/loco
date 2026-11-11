/**
 * The deck as a first look: one face per kind, in the order the rules introduce
 * them.
 *
 * This is what the "Cards" half of the rules modal draws. A player who has
 * played a card game of colours and symbols before arrives with a model of it,
 * and the two cards this game adds — Swap and Global Switch — are exactly the
 * two that model has no slot for. Naming them in a rulebook bullet asks
 * somebody to imagine a card; drawing the real face lets them recognise it in
 * their hand a minute later, which is the whole job of an onboarding read
 * standing up.
 *
 * Only the faces are here. The names come from `t.cardNames` and the one-line
 * effects from `t.cardBriefs`, so nothing about a card is spelled out twice.
 * The catalogue for somebody who came looking for one card — copies, points,
 * the long form — is the `/cards/` page, and it stays there: this is eight
 * lines, not a reference.
 *
 * Every coloured kind is drawn in a different suit so the four colours all
 * appear once, and the lede above the grid is what says a coloured card exists
 * in all four.
 */
import type { CardDTO } from '../types/protocol'

export const CARD_CATALOGUE: readonly CardDTO[] = [
  { color: 'red', kind: 'number', value: 7 },
  { color: 'yellow', kind: 'skip' },
  { color: 'green', kind: 'reverse' },
  { color: 'blue', kind: 'draw_two' },
  { color: 'wild', kind: 'wild' },
  { color: 'wild', kind: 'wild_draw_four' },
  { color: 'red', kind: 'swap' },
  { color: 'wild', kind: 'global_switch' },
]
