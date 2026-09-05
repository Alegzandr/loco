import { describe, it, expect, beforeEach } from 'vitest'
import { createServerMessageHandler } from '../hooks/serverMessages'
import { gameStore } from '../hooks/gameStore'
import type { CardDTO } from '../types/protocol'

/**
 * Whether the pile may still be slammed is the server's word, carried on every
 * message that can open or shut the window. The client used to keep no copy of
 * it and offered the twin for as long as the card was on top, so a slam after
 * somebody had drawn came back "somebody was faster" on a table where nobody
 * had been.
 */
const red5: CardDTO = { color: 'red', kind: 'number', value: 5 }
const roster = [
  { index: 0, nickname: 'Me', hand_size: 3, connected: true },
  { index: 1, nickname: 'Them', hand_size: 4, connected: true },
]

beforeEach(() => {
  gameStore.setState({ myIndex: 0, players: roster, interruptOpen: true, catchWindows: [] })
})

describe('the interrupt window in the store', () => {
  const handle = createServerMessageHandler({ clear: () => {}, arm: () => {} })

  it('shuts when the seat at turn draws, and not when a hand merely grows', () => {
    handle({ type: 'card_drawn', player_index: 1, turn: 1, drawn_count: 1, interrupt_open: false })
    expect(gameStore.getState().interruptOpen).toBe(false)
    handle({ type: 'card_played', player_index: 1, card: red5, turn: 0, players: roster })
    expect(gameStore.getState().interruptOpen).toBe(true)
    // A penalty draw says nothing about the window, and the server sends it
    // as open: the value on the message is what counts, never the message type.
    handle({ type: 'card_drawn', player_index: 1, turn: 0, drawn_count: 2, interrupt_open: true })
    expect(gameStore.getState().interruptOpen).toBe(true)
  })

  it('shuts on a pass and reopens on the next card', () => {
    handle({ type: 'turn_changed', turn: 1, interrupt_open: false })
    expect(gameStore.getState().interruptOpen).toBe(false)
    handle({ type: 'card_played', player_index: 1, card: red5, turn: 0, players: roster, interrupt_open: true })
    expect(gameStore.getState().interruptOpen).toBe(true)
  })

  it('takes the snapshot\'s answer, and a snapshot that says nothing is shut', () => {
    handle({ type: 'turn_changed', turn: 1 })
    expect(gameStore.getState().interruptOpen).toBe(false)
    handle({
      type: 'game_state',
      state: {
        your_index: 0,
        hand: [],
        players: roster,
        discard: red5,
        active_color: 'red',
        turn: 0,
        direction: 1,
        round_number: 1,
        match_format: 'BO1',
        max_players: 2,
        interrupt_open: true,
      },
    })
    expect(gameStore.getState().interruptOpen).toBe(true)
    handle({
      type: 'game_state',
      state: {
        your_index: 0,
        hand: [],
        players: roster,
        discard: red5,
        active_color: 'red',
        turn: 0,
        direction: 1,
        round_number: 1,
        match_format: 'BO1',
        max_players: 2,
      },
    })
    expect(gameStore.getState().interruptOpen).toBe(false)
  })
})
