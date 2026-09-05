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
import { CATCH_LATE_GRACE_MS } from '../components/catchAvailability'

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
 * `catchLive` is the same completion read off the roster and the clock. The
 * centre button is pressable while some other seat is on exactly two cards or
 * on its last card inside its window, and that answer is the store's to keep
 * current: an action that changes the roster, the seat we hold or the windows
 * the server named must not be able to leave the button where it was.
 *
 * The offer is the window, and it runs its course whatever happens inside it:
 * the seat speaks, its hand grows back out of reach, somebody else catches it
 * first — none of that may grey the button out under a thumb that has already
 * committed, because the server charges that press a card and a mistake the
 * interface prevents is a mistake the player never gets to make. What ends it
 * is the clock: the window plus CATCH_LATE_GRACE_MS, the same stretch the
 * server keeps charging for. Not a latch, then — held to the next card played,
 * the offer could be farmed a card at a time for a Swap to hand on.
 */
describe('the pressable button is completed by the store', () => {
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
    gameStore.setState({
      myIndex: 0,
      catchWindows: [],
      onHookUntil: {},
      players: [],
      catchLive: false,
    })
  })

  it('rises on a bare write to the roster', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 8)])
    expect(gameStore.getState().catchLive).toBe(false)
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    expect(gameStore.getState().catchLive).toBe(true)
  })

  // A seat on its last card takes a stack of four and is holding five: out of
  // the armed cue, because nothing about it can be caught any more — and still
  // under the button, because the window it opened is still running. That
  // press is the late half of the wager and the server charges a card for it,
  // so the interface may not spare the player by greying out underneath their
  // thumb. It was the exact frame they had already committed on.
  it('keeps the button live when a seat draws itself out of reach', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.setState({
      catchWindows: [{ seat: 1, endsAt: now() + 5000 }],
      onHookUntil: { 1: now() + 5000 },
    })
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore.getState().applyCardDrawn(null, 1, 0, undefined, 4, 0)
    const s = gameStore.getState()
    expect(s.players.find((p) => p.index === 1)?.hand_size).toBe(5)
    // The armed cue is a promise and there is nothing left to promise.
    expect(s.catchTarget).toBeNull()
    // The wager is not a promise, and it is still on the table.
    expect(s.catchLive).toBe(true)
  })

  // The pin on what the button must not know: the seat calls it, its window is
  // retired from the armed cue, and the button stays exactly where it was for
  // the rest of the window.
  it('holds through the declaration that closes the window', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.setState({
      catchWindows: [{ seat: 1, endsAt: now() + 5000 }],
      onHookUntil: { 1: now() + 5000 },
    })
    expect(gameStore.getState().catchTarget).toBe(1)
    gameStore.getState().applyUnoDeclared(1)
    const s = gameStore.getState()
    expect(s.catchTarget).toBeNull()
    expect(s.catchLive).toBe(true)
    expect(s.catchLiveUntil).not.toBeNull()
  })

  // And the clock. The window the server named runs out, nothing arrives, and
  // the store is asked to read again: the seat is still on one card, but
  // nothing about it can be caught any more.
  it('falls when the last window runs out and the store re-reads', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1)])
    gameStore.setState({ onHookUntil: { 1: now() + 30 } })
    expect(gameStore.getState().catchLive).toBe(true)
    // The timer waits for the grace as well as the window: the button has to go
    // dark when the server stops charging, not when the bar finishes draining.
    expect(gameStore.getState().catchLiveUntil).toBe(
      gameStore.getState().onHookUntil[1] + CATCH_LATE_GRACE_MS,
    )
    // Past the deadline: the clock is read off Date.now() in the derivation.
    gameStore.setState({ onHookUntil: { 1: now() - CATCH_LATE_GRACE_MS } })
    gameStore.getState().rereadCatchLive()
    expect(gameStore.getState().catchLive).toBe(false)
    expect(gameStore.getState().catchLiveUntil).toBeNull()
  })

  // The clock is written from what the server names on card_played, and it
  // survives the window's retirement so the declaration cannot reach the
  // button through it.
  it('takes its clock from catch_seats on the card played', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    const endsAt = now() + 5000
    gameStore
      .getState()
      .applyCardPlayed(
        1,
        { color: 'red', kind: 'number', value: 3 },
        0,
        0,
        'red',
        [seat(0, 8), seat(1, 1)],
        undefined,
        1,
        [{ player_index: 1, ends_at: endsAt }],
      )
    expect(gameStore.getState().onHookUntil).toEqual({ 1: endsAt })
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore.getState().applyUnoDeclared(1)
    expect(gameStore.getState().onHookUntil).toEqual({ 1: endsAt })
    expect(gameStore.getState().catchLive).toBe(true)
  })

  // A snapshot is authoritative when it arrives, and a fresh deal is the case
  // that matters: without this the last round's endgame lights the button over
  // a table of eight-card hands.
  it('is put back down by an authoritative snapshot', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    expect(gameStore.getState().catchLive).toBe(true)
    gameStore.getState().applyGameState(deal([seat(0, 8), seat(1, 8)]))
    expect(gameStore.getState().catchLive).toBe(false)
  })

  // A reloaded tab holds no clock from before, so a seat the snapshot does not
  // name — one that spoke, or whose window ran out — is dark there: the one
  // reading a tab that was not listening can honestly give. One it does name
  // is on the clock the server sent.
  it("reads a snapshot's catch_seats onto the clock and nothing else", () => {
    gameStore.getState().applyGameState(deal([seat(0, 8), seat(1, 1)]))
    expect(gameStore.getState().catchLive).toBe(false)
    const endsAt = now() + 4000
    gameStore
      .getState()
      .applyGameState({ ...deal([seat(0, 8), seat(1, 1)]), catch_seats: [{ player_index: 1, ends_at: endsAt }] })
    expect(gameStore.getState().onHookUntil).toEqual({ 1: endsAt })
    expect(gameStore.getState().catchLive).toBe(true)
  })

  it('leaves a write that names neither the roster, the clock nor our seat alone', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    gameStore.setState({ errorMsg: 'nope' })
    expect(gameStore.getState().catchLive).toBe(true)
  })
})

/**
 * The third reading the centre button owes the player, and the one the store
 * deliberately does not answer: the wager is spent.
 *
 * `catchLive` is the *offer* — is a seat near the finish — and it must stay
 * blind to everything else, or the button starts reporting the table. Whether
 * *we* still have a press to make against that offer is a separate question
 * (`catchSpent`, the client's copy of the server's ration), and it is the
 * question a live button that does nothing was failing to answer: the press
 * would be a blind send the store suppresses, so the control looked pressable
 * and was inert. `GameView` narrows the one with the other, and only where
 * there is nothing left to aim at — a window still unspent names itself in
 * `catchTarget`, which is the ordinary second catch after a Swap.
 */
describe('the spent wager, which is not the offer', () => {
  beforeEach(() => {
    gameStore.setState({
      myIndex: 0,
      catchWindows: [],
      onHookUntil: {},
      players: [],
      catchLive: false,
      catchSpent: false,
    })
  })

  it('leaves the offer standing when our call is spent', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    gameStore.getState().noteBlindCatchAttempt()
    const s = gameStore.getState()
    // The store still says a seat is near the finish, because it is.
    expect(s.catchLive).toBe(true)
    // And it says our press is spent, which is what the bar draws dead.
    expect(s.catchSpent).toBe(true)
    expect(s.catchTarget).toBeNull()
  })

  it('keeps a second window to aim at after the first press', () => {
    const end = now() + 5000
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 1), seat(2, 1)])
    gameStore.setState({
      catchWindows: [
        { seat: 1, endsAt: end },
        { seat: 2, endsAt: end + 500 },
      ],
      onHookUntil: { 1: end, 2: end + 500 },
    })
    gameStore.getState().noteCatchAttempt(1)
    const s = gameStore.getState()
    expect(s.catchSpent).toBe(true)
    // Not spent *here*: seat 2 still owes the call, so the bar stays pressable.
    expect(s.catchTarget).toBe(2)
  })

  it('is handed back by the card that puts a new offer on the table', () => {
    gameStore.getState().setPlayers([seat(0, 8), seat(1, 2)])
    gameStore.getState().noteBlindCatchAttempt()
    expect(gameStore.getState().catchSpent).toBe(true)
    gameStore
      .getState()
      .applyCardPlayed(
        1,
        { color: 'red', kind: 'number', value: 3 },
        0,
        0,
        'red',
        [seat(0, 8), seat(1, 1)],
        undefined,
        1,
        [{ player_index: 1, ends_at: now() + 5000 }],
      )
    expect(gameStore.getState().catchSpent).toBe(false)
  })
})
