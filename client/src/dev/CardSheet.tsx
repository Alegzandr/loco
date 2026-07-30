/**
 * Dev-only contact sheet of the whole deck: every kind in every suit, the back,
 * and the states a card can be in.
 *
 * A card is the one component the game draws forty of at once, and no screen
 * scene shows more than a handful of kinds — a change to the face is only
 * reviewable if the whole deck is on screen at once. Laid out to fit the
 * capture viewport in one shot, big row first: the face is designed at poster
 * size and read at 72px, and only the big row shows whether it survives.
 */
import { CSSProperties } from 'react'
import { Card } from '../components/cards/Card'
import { CardBack } from '../components/cards/CardBack'
import { CardDTO, CardColor, CardKind } from '../types/protocol'
import styles from './CardSheet.module.css'

const SUITS: CardColor[] = ['red', 'yellow', 'green', 'blue']
const ACTIONS: CardKind[] = ['skip', 'reverse', 'draw_two', 'swap']
const WILDS: CardKind[] = ['wild', 'wild_draw_four', 'global_switch']

const card = (color: CardColor, kind: CardKind, value?: number): CardDTO => ({ color, kind, value })
const BIG: CSSProperties = { width: 150, height: 225 }
const SMALL: CSSProperties = { width: 58, height: 87 }

export function CardSheet() {
  return (
    <div className={styles.sheet}>
      <h1>LOCO · le jeu complet</h1>

      <div className={styles.row}>
        <Card card={card('yellow', 'number', 1)} shadow style={BIG} />
        <Card card={card('red', 'number', 1)} shadow style={BIG} />
        <Card card={card('wild', 'wild_draw_four')} shadow style={BIG} />
        <Card card={card('blue', 'skip')} shadow style={BIG} />
        <CardBack width={150} height={225} radius={5} />
        <Card card={card('green', 'number', 4)} shadow style={SMALL} />
        <Card card={card('green', 'number', 4)} shadow playable style={SMALL} />
      </div>

      <div className={styles.cols}>
        <section>
          <h2>Nombres</h2>
          {SUITS.map((c) => (
            <div className={styles.row} key={c}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((v) => (
                <Card key={v} card={card(c, 'number', v)} shadow style={SMALL} />
              ))}
            </div>
          ))}
        </section>

        <section>
          <h2>Actions</h2>
          {SUITS.map((c) => (
            <div className={styles.row} key={c}>
              {ACTIONS.map((k) => (
                <Card key={k} card={card(c, k)} shadow style={SMALL} />
              ))}
            </div>
          ))}
        </section>

        <section>
          <h2>Jokers · dos</h2>
          <div className={styles.row}>
            {WILDS.map((k) => (
              <Card key={k} card={card('wild', k)} shadow style={SMALL} />
            ))}
          </div>
          <div className={styles.row}>
            <CardBack width={58} height={87} radius={4} />
            <CardBack width={34} height={51} radius={3} />
            <CardBack width={20} height={30} radius={2} />
          </div>
        </section>
      </div>
    </div>
  )
}
