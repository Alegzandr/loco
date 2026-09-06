import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { cardPlay } from '../hooks/gamePlay.svelte'
import { resolveServerError } from '../i18n/serverErrors'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { CardDTO, ClientMsg } from '../types/protocol'

/**
 * An interject is one card, so no interject carries a call.
 *
 * It used to: a hand of two identical cards slammed at once went 2 → 0 without
 * ever passing through a single card, so no catch window opened, the LOCO!
 * button was never offered, and the tap that took the round had to *be* the
 * call. Batching is gone from the interject — one press, one card — and with it
 * that whole exemption. Every finish out of turn now comes off a hand that has
 * been sitting at one card, catchable, with the button on screen.
 *
 * What this file guards is that the tap never rebuilds a batch: a seat holding
 * three copies sends one and keeps two, and the copies it keeps cost it a press
 * and a window each. See `docs/rules.md` §6.5.
 */
const RED5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const BLUE9: CardDTO = { color: 'blue', kind: 'number', value: 9 }
const WILD4: CardDTO = { color: 'wild', kind: 'wild_draw_four' }

/** An out-of-turn tap on the first card of `hand`, which is also on the pile. */
function tapOutOfTurn(hand: CardDTO[]) {
  const sent: ClientMsg[] = []
  let played = false
  const top = hand[0]
  const { result } = renderHook<ReturnType<typeof cardPlay>, Record<string, never>>(
    () =>
      cardPlay({
        myHand: () => hand,
        discard: () => top,
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
    played = result.onCardClick(top, 0)
  })
  return { sent, played, result }
}

function slam(hand: CardDTO[]): { sent: ClientMsg[]; played: boolean } {
  const { sent, played } = tapOutOfTurn(hand)
  return { sent, played }
}

describe('one card per interject', () => {
  it('sends a single card off a hand full of copies', () => {
    const { sent, played } = slam([RED5, RED5, RED5, BLUE9])

    expect(played).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('interrupt_play_card')
    expect(sent[0].card).toEqual(RED5)
    // The two copies left are two more presses, each into a window the rest of
    // the table can win first. A tap that sent all three charged one reaction
    // for three.
    expect(sent[0].play_cards).toBeUndefined()
  })

  it('sends one card off a hand of exactly two copies, and no call with it', () => {
    // This is the hand the finishing batch used to take the round with. It now
    // lands the seat on one card: catchable, owing the table a LOCO! it has the
    // button and the window to make, and one press away from the round.
    const { sent } = slam([RED5, RED5])

    expect(sent[0].card).toEqual(RED5)
    expect(sent[0].play_cards).toBeUndefined()
    expect(sent[0].declare_loco).toBeUndefined()
  })

  it('carries no call on the interject that takes the round', () => {
    // One card left: this seat has been catchable since it got there, so the
    // declaration is one it already had the chance — and the button — to make.
    const { sent } = slam([RED5])

    expect(sent[0].play_cards).toBeUndefined()
    expect(sent[0].declare_loco).toBeUndefined()
  })

  it('never builds a batch through the colour prompt either', () => {
    // A +4 stops to ask for a colour, and that is where the batch used to be
    // committed: the player picked a colour and three cards left, having been
    // told about none of it. The prompt now carries the tapped card and nothing
    // else, so there is nothing for GameView to attach to the message.
    const { sent, played, result } = tapOutOfTurn([WILD4, WILD4, WILD4])

    expect(played).toBe(false)
    expect(sent).toHaveLength(0)
    expect(result.colorPicker).toEqual({ card: WILD4, idx: 0, interrupt: true })
  })
})

describe('the refusal a forgotten call produces', () => {
  const raw = 'must call LOCO! before playing your last card'

  it('reaches the player in their own language, never as wire prose', () => {
    expect(resolveServerError(raw, en.errors)).toBe(en.errors.mustDeclareBeforeWinning)
    expect(resolveServerError(raw, fr.errors)).toBe(fr.errors.mustDeclareBeforeWinning)
    expect(resolveServerError(raw, en.errors)).not.toBe(en.errors.generic)
  })

  it('is not swallowed by the other declaration refusals', () => {
    // `can only declare with exactly 1 card` and `player already declared` are
    // answers to the LOCO! button; this one answers a tap on a card. Three
    // different things to do next, so three different lines.
    expect(resolveServerError(raw, fr.errors)).not.toBe(fr.errors.declareTooEarly)
    expect(resolveServerError(raw, fr.errors)).not.toBe(fr.errors.alreadyDeclared)
  })
})
