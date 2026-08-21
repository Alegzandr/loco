import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { cardPlay } from '../hooks/gamePlay.svelte'
import type { CardDTO, ClientMsg } from '../types/protocol'

/**
 * What a slam costs the hand it comes out of.
 *
 * The interject batches by itself — a reaction cannot stop to ask how many
 * copies to send — and that is honest only while every extra copy buys
 * something. It does for a +2, a +4, a Skip and a Reverse, and for nothing
 * else: two wilds name one colour. A player who slammed one wild to take the
 * lead back was charged all three of theirs for it.
 */
const WILD: CardDTO = { color: 'wild', kind: 'wild', value: 0 }
const PLUS4: CardDTO = { color: 'wild', kind: 'wild_draw_four', value: 0 }
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
        onSend: (msg) => sent.push(msg),
        lastPlayAt: () => undefined,
      }),
    { initialProps: {} },
  )
  act(() => {
    result.onCardClick(card, 0)
  })
  // Every wild asks for its colour first, so what goes out is what the prompt
  // was handed. That is the batch, and it is what this file is about.
  return { picker: result.colorPicker, sent }
}

describe('a wild slammed out of turn', () => {
  it('spends one copy, whatever the hand holds', () => {
    const { picker } = slam(WILD, [WILD, WILD, WILD, BLUE9])

    expect(picker?.copies).toBeUndefined()
    expect(picker?.declareLoco).toBe(false)
  })

  it('spends the whole hand when the whole hand is the batch', () => {
    // The one batch a wild is worth: three copies and nothing else left, so the
    // slam takes the round. The call rides it — 3 → 0 never passes through one
    // card, so no window ever opened and no button was ever offered.
    const { picker } = slam(WILD, [WILD, WILD, WILD])

    expect(picker?.copies).toEqual([WILD, WILD, WILD])
    expect(picker?.declareLoco).toBe(true)
  })
})

describe('a +4 slammed out of turn', () => {
  it('still batches every copy, because each one raises the stack', () => {
    const { picker } = slam(PLUS4, [PLUS4, PLUS4, BLUE9])

    expect(picker?.copies).toEqual([PLUS4, PLUS4])
    expect(picker?.declareLoco).toBe(false)
  })
})
