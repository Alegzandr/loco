/**
 * `catchTarget` and `unoTimerEnd` are derived from `catchWindows`, `myDeclared`
 * from `declaredSeats`, `catchLive` from the roster and our own seat, and all
 * four are completed by the store itself rather than by each action (see
 * `store/deriveCatchMiddleware.ts`). These tests fail if that ever goes back to
 * being every action's job: the failure mode of stored derived state is an
 * action that forgets, and a forgotten derivation costs a reaction silently.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../hooks/gameStore'
import type { GameStateDTO, PlayerDTO } from '../types/protocol'

const now = () => Date.now()

const seat = (index: number, hand_size: number): PlayerDTO => ({
  index,
  nickname: `P${index}`,
  hand_size,
  connected: true,
})

describe('the offered catch is completed by the store', () => {
  beforeEach(() => {
    gameStore.setState({ myIndex: 0, catchWindows: [], players: [], catchLive: false })
  })

  it('is derived from a bare write to catchWindows', () => {
    const endsAt = now() + 5000
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt }] })
    const s = gameStore.getState()
    expect(s.catchTarget).toBe(2)
    expect(s.unoTimerEnd).toBe(endsAt)
  })

  it('offers the window closest to expiring, never our own seat', () => {
    gameStore.setState({
      myIndex: 1,
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 }, // ours: never offered
        { seat: 3, endsAt: now() + 4000 },
        { seat: 2, endsAt: now() + 2000 },
      ],
    })
    expect(gameStore.getState().catchTarget).toBe(2)
  })

  it('follows our seat moving under a snapshot that re-seats us', () => {
    gameStore.setState({
      myIndex: 0,
      catchWindows: [
        { seat: 0, endsAt: now() + 1000 },
        { seat: 1, endsAt: now() + 2000 },
      ],
    })
    expect(gameStore.getState().catchTarget).toBe(1)
    // Pruning absent players re-bases seats: the window we could not take is
    // now somebody else's, and the one we owed is ours.
    gameStore.setState({ myIndex: 1 })
    expect(gameStore.getState().catchTarget).toBe(0)
  })

  it('closes when the last window is retired by an action that says nothing about it', () => {
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    expect(gameStore.getState().catchTarget).toBe(2)
    gameStore.getState().applyUnoCaught(2)
    const s = gameStore.getState()
    expect(s.catchWindows).toEqual([])
    expect(s.catchTarget).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
  })

  it('spends a window we have already called on', () => {
    gameStore.setState({
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 },
        { seat: 2, endsAt: now() + 3000 },
      ],
    })
    gameStore.getState().noteCatchAttempt(1)
    expect(gameStore.getState().catchTarget).toBe(2)
  })

  it('leaves a write that names neither field alone', () => {
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    const before = gameStore.getState().unoTimerEnd
    gameStore.setState({ errorMsg: 'nope' })
    expect(gameStore.getState().unoTimerEnd).toBe(before)
    expect(gameStore.getState().catchTarget).toBe(2)
  })
})

describe('our own declaration is completed by the store', () => {
  beforeEach(() => {
    gameStore.setState({ myIndex: 0, declaredSeats: [], players: [], catchLive: false })
  })

  it('is derived from a bare write to declaredSeats', () => {
    gameStore.setState({ declaredSeats: [2] })
    expect(gameStore.getState().myDeclared).toBe(false)
    gameStore.setState({ declaredSeats: [0, 2] })
    expect(gameStore.getState().myDeclared).toBe(true)
  })

  // Same reason `catchTarget` follows it: a snapshot can re-seat us, and the
  // call that spends our LOCO! button is the one made at the seat we hold now.
  it('follows our seat moving under a snapshot that re-seats us', () => {
    gameStore.setState({ declaredSeats: [1] })
    expect(gameStore.getState().myDeclared).toBe(false)
    gameStore.setState({ myIndex: 1 })
    expect(gameStore.getState().myDeclared).toBe(true)
  })
})

/**
 * `catchLive` is the same completion with a memory, and the memory is the
 * mechanic: the centre button never goes dead between two cards. What takes a
 * seat out of reach without a card being played — a declaration, a draw, a
 * stack of four swallowed whole, the round being won — is precisely what a
 * player betting on that seat has already committed their thumb to, and an
 * interface that retracts the offer there is making the read for them.
 *
 * The bound is the card that lands: it puts the latch down and the store reads
 * the roster again. So the wager is offered on one board and never carried to
 * the next, which is what keeps it from being farmed a card at a time.
 */
describe('the pressable button is completed and latched by the store', () => {
  const deal = (players: PlayerDTO[]): GameStateDTO => ({
    your_index: 0,
    hand: [],
    players,
    discard: { color: 'red', kind: 'number', value: 3 },
    active_color: 'red',
    turn: 0,
    direction: 1,
    round_number: 1,
    match_format: 'BO1',
    max_players: 10,
  })

  beforeEach(() => {
    gameStore.setState({ myIndex: 0, catchWindows: [], players: [], catchLive: false })
  })

  it('rises on a bare write to the roster', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 8)])
    expect(gameStore.getState().catchLive).toBe(false)
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    expect(gameStore.getState().catchLive).toBe(true)
  })

  // The bait, drawn from the roster this time: a seat on its last card takes a
  // stack of four and is holding five, and nothing has been played.
  it('holds through a seat drawing itself out of reach', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore.getState().applyCardDrawn(null, 1, 0, undefined, 4, 0)
    const s = gameStore.getState()
    expect(s.players.find((p) => p.index === 1)?.hand_size).toBe(5)
    // Out of reach, out of the armed cue, and still pressable.
    expect(s.catchTarget).toBeNull()
    expect(s.catchLive).toBe(true)
  })

  // Same hold, the other way a seat escapes: it calls it.
  it('holds through the declaration that closes the window', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.setState({ catchWindows: [{ seat: 1, endsAt: now() + 5000 }] })
    expect(gameStore.getState().catchTarget).toBe(1)
    gameStore.getState().applyUnoDeclared(1)
    const s = gameStore.getState()
    expect(s.catchTarget).toBeNull()
    expect(s.catchLive).toBe(true)
  })

  // And the bound. The card that lands ends the hold, and what answers next is
  // the new roster on its own — here, a table nobody is near the finish at.
  it('is put back down by the card played, and re-read on the new roster', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.getState().applyCardDrawn(null, 1, 0, undefined, 4, 0)
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore
      .getState()
      .applyCardPlayed(0, { color: 'red', kind: 'number', value: 3 }, 1, 0, 'red', [
        seat(0, 7),
        seat(1, 5),
      ])
    expect(gameStore.getState().catchLive).toBe(false)
  })

  // A snapshot is authoritative when it arrives, and a fresh deal is the case
  // that matters: without this the last round's endgame lights the button over
  // a table of eight-card hands.
  it('is put back down by an authoritative snapshot', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore.getState().applyGameState(deal([seat(0, 8), seat(1, 8)]))
    expect(gameStore.getState().catchLive).toBe(false)
  })

  it('leaves a write that names neither the roster nor our seat alone', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.setState({ errorMsg: 'nope' })
    expect(gameStore.getState().catchLive).toBe(true)
  })
})
