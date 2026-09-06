import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { cardPlay } from '../hooks/gamePlay.svelte'
import type { CardDTO, ClientMsg } from '../types/protocol'

/**
 * What a slam costs the hand it comes out of: one card, always.
 *
 * The interject used to batch by itself — a reaction cannot stop to ask how
 * many copies to send — and the line was drawn at what an extra copy *buys*: a
 * +2, a +4, a Skip and a Reverse bought something, a plain wild did not. The
 * line was in the wrong place. A seat holding three +4 played one, took the
 * lead back off itself with the second, and the tap sent the third with it: one
 * press, three cards, and the read the mechanic is made of never had to be made
 * again. Worse, the +4 is the one card that stops to ask for a colour, so the
 * batch was committed inside a prompt that said nothing about it.
 *
 * So an interject is one card. The copies still go out — one press each, each
 * one a window the rest of the table can win first — and the server refuses a
 * batch interject rather than trusting the tap (`an interject is one card`,
 * game.ErrInterruptBatch).
 */
const WILD: CardDTO = { color: 'wild', kind: 'wild', value: 0 }
const PLUS4: CardDTO = { color: 'wild', kind: 'wild_draw_four', value: 0 }
const RED5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const BLUE9: CardDTO = { color: 'blue', kind: 'number', value: 9 }

/** An out-of-turn tap on `card`, with the same card on top of the discard. */
function slam(card: CardDTO, hand: CardDTO[]) {
  const sent: ClientMsg[] = []
  const { result } = renderHook<ReturnType<typeof cardPlay>, Record<string, never>>(
    () =>
      cardPlay({
        myHand: () => hand,
        discard: () => card,
        activeColor: () => 'red',
        // Not our turn: this is the interject path.
        currentTurn: () => 1,
        myIndex: () => 0,
        pendingDraw: () => 0,

        interruptOpen: () => true,
        onSend: (msg) => sent.push(msg),
        lastPlayAt: () => undefined,
      }),
    { initialProps: {} },
  )
  act(() => {
    result.onCardClick(card, 0)
  })
  // A wild asks for its colour first, so nothing has gone out yet and what will
  // go out is what the prompt was handed. A coloured card goes straight.
  return { picker: result.colorPicker, sent }
}

describe('an interject is one card', () => {
  it('sends the tapped card and nothing else', () => {
    const { sent } = slam(RED5, [RED5, RED5, RED5, BLUE9])

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('interrupt_play_card')
    expect(sent[0].card).toEqual(RED5)
    expect(sent[0].play_cards).toBeUndefined()
  })

  it('leaves the copies in the hand, one press each', () => {
    // The whole point of the change: two +4 still to place, and each of them is
    // a separate read of a table that has moved in between.
    const { picker, sent } = slam(PLUS4, [PLUS4, PLUS4, PLUS4])

    expect(sent).toHaveLength(0)
    expect(picker).toEqual({ card: PLUS4, idx: 0, interrupt: true })
  })

  it('hands the colour prompt one card, never a count', () => {
    // The prompt is where a batch could be smuggled past the player: they are
    // asked for a colour and answer for cards they were never shown.
    const { picker } = slam(WILD, [WILD, WILD, WILD])

    expect(picker).toEqual({ card: WILD, idx: 0, interrupt: true })
  })
})
