import { describe, it, expect } from 'vitest'
import { renderHook, act } from './renderHook'
import { cardPlay } from '../hooks/gamePlay.svelte'
import { resolveServerError } from '../i18n/serverErrors'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import type { CardDTO, ClientMsg } from '../types/protocol'

/**
 * A batch that empties the hand is the only finish a player has no chance to
 * announce beforehand: 2 → 0 never passes through one card, so no catch window
 * ever opens and the LOCO! button is never offered. The server refuses that
 * batch unless the message carries the call, which makes the tap that takes the
 * round the call itself — and makes this the one place the client has to get
 * right, because there is no button to fall back on.
 */
const RED5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const BLUE9: CardDTO = { color: 'blue', kind: 'number', value: 9 }

/** An out-of-turn tap on `hand`, with `RED5` on top of the discard. */
function slam(hand: CardDTO[]): { sent: ClientMsg[]; played: boolean } {
  const sent: ClientMsg[] = []
  let played = false
  const { result } = renderHook<ReturnType<typeof cardPlay>, Record<string, never>>(
    () =>
      cardPlay({
        myHand: () => hand,
        discard: () => RED5,
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
    played = result.onCardClick(RED5, 0)
  })
  return { sent, played }
}

describe('the call a finishing batch has to carry', () => {
  it('rides the interject that empties the hand', () => {
    const { sent, played } = slam([RED5, RED5])

    expect(played).toBe(true)
    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('interrupt_play_card')
    expect(sent[0].play_cards).toEqual([RED5, RED5])
    // Without this the server refuses the slam and the round is not taken.
    expect(sent[0].declare_loco).toBe(true)
  })

  it('is absent from a batch that leaves a card behind', () => {
    const { sent } = slam([RED5, RED5, BLUE9])

    expect(sent[0].play_cards).toEqual([RED5, RED5])
    // The seat lands on one card, owes the table a declaration and is catchable.
    // Claiming the call here would hand out that exemption for free.
    expect(sent[0].declare_loco).toBe(false)
  })

  it('is absent from a single-card interject', () => {
    const { sent } = slam([RED5, BLUE9])

    expect(sent[0].play_cards).toBeUndefined()
    expect(sent[0].declare_loco).toBe(false)
  })

  it('is absent from a single-card interject that finishes, which owed its call earlier', () => {
    // One card left: this seat has been catchable since it got there, so the
    // declaration is one it already had the chance — and the button — to make.
    const { sent } = slam([RED5])

    expect(sent[0].play_cards).toBeUndefined()
    expect(sent[0].declare_loco).toBe(false)
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
