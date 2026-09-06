import { describe, it, expect } from 'vitest'
import {
  isCatchLive,
  isCatchLocked,
  catchLiveUntil,
  CATCH_LIVE_MAX_HAND,
  CATCH_LATE_GRACE_MS,
} from '../components/catchAvailability'
import type { PlayerDTO } from '../types/protocol'

const seat = (index: number, hand_size: number): PlayerDTO => ({
  index,
  nickname: `P${index}`,
  hand_size,
  connected: true,
})

const NOW = 1_000_000
// No lockout of our own: the ordinary board every case below is about.
const UNLOCKED = 0
const WINDOW = 5000

describe('isCatchLive', () => {
  it('is dead on a fresh deal', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 8), seat(2, 8)], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  it('wakes up at the threshold and stays asleep one card above it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)], 0, {}, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND + 1)], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  // And the threshold itself, in figures rather than through the constant: the
  // wager is offered exactly one ordinary play from the window it is aiming at.
  // Nothing takes a seat from three cards to one in a single action — an
  // interject is one card — so arming the button that early opens a long
  // stretch of round where pressing can only ever miss, and a miss that a
  // player can schedule is a card they chose to draw, which is a Swap away from
  // being a reward.
  it('is one card from the window, never two', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 2)], 0, {}, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, 3)], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  // There is nobody to catch at our own seat, so our own hand may never arm the
  // button — otherwise every player would find it live for the last two cards
  // of every round they were winning.
  it('never counts our own hand', () => {
    expect(isCatchLive([seat(0, 2), seat(1, 8)], 0, {}, UNLOCKED, NOW)).toBe(false)
    expect(isCatchLive([seat(0, 1), seat(1, 8)], 0, { 0: NOW + WINDOW }, UNLOCKED, NOW)).toBe(false)
  })

  // A seat on zero cards has won the round or been retired out of it. Neither
  // owes the table a call, and offering a wager against them is offering a card
  // for nothing.
  it('ignores an empty hand', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 0)], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  it('is live as soon as any one seat qualifies', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 7), seat(2, 2), seat(3, 6)], 0, {}, UNLOCKED, NOW)).toBe(true)
  })

  it('answers an empty roster without throwing', () => {
    expect(isCatchLive([], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  // A seat on its last card is offered for as long as its window runs, and
  // then for the late grace: pressing a beat after it shut is a call that came
  // too late, which the server charges a card for and which therefore has to
  // be a press the player is allowed to make. Past the grace nothing about the
  // seat can be caught and the server answers with silence, so a button live
  // there would be offering a wager nobody takes.
  it('offers a last card through its window and the late grace after it', () => {
    const players = [seat(0, 8), seat(1, 1)]
    expect(isCatchLive(players, 0, { 1: NOW + WINDOW }, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive(players, 0, { 1: NOW + 1 }, UNLOCKED, NOW)).toBe(true)
    // The window itself has run out here, and the press is still a wager.
    expect(isCatchLive(players, 0, { 1: NOW - CATCH_LATE_GRACE_MS + 1 }, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive(players, 0, { 1: NOW - CATCH_LATE_GRACE_MS }, UNLOCKED, NOW)).toBe(false)
    expect(isCatchLive(players, 0, { 1: NOW - 60_000 }, UNLOCKED, NOW)).toBe(false)
  })

  // The half of it the interface used to take away. A seat leaves the
  // near-finish picture without a card being played — it draws, it swallows a
  // stack of four, a Contre-LOCO! lands on it and its hand grows by two — and
  // the button greyed out on that frame, under a thumb already on its way
  // down. The offer is the window, so it runs its course whatever the hand
  // does inside it, and the server charges for exactly the same stretch.
  it('keeps offering a window whose hand has grown out of reach', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 5)], 0, { 1: NOW + WINDOW }, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, 3)], 0, { 1: NOW + WINDOW }, UNLOCKED, NOW)).toBe(true)
  })

  // A seat on one card the table was never told a window for — a reloaded tab
  // that arrived after the seat spoke, or after the window ran out — is not an
  // offer. Only the armed cue is a promise, and this is not even that.
  it('is dead on a last card with no window on the clock', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 1)], 0, {}, UNLOCKED, NOW)).toBe(false)
  })

  // And it is still a clock, not a latch: the entry a seat left behind stops
  // counting when its grace runs out, whatever the seat is holding by then.
  // Held past that, the offer could be farmed a card at a time.
  it('drops a window entry once its grace has run out', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 4)], 0, { 1: NOW - WINDOW }, UNLOCKED, NOW)).toBe(false)
  })

  // What this function does NOT read, and it is the pin on the rule: whether
  // the table heard the seat call it. The clock runs the same whether the seat
  // spoke or not, so a button that reads only the clock reports nothing — and
  // it keeps accepting the press the price exists to charge for, the thumb
  // already coming down when the seat shouted. The only thing a declaration
  // closes is the *armed* cue, which rides `catchTarget` and not this.
  it('takes no declaration, by signature', () => {
    // players, myIndex, onHookUntil, catchLockedUntil, now — the roster, the
    // clock the offer runs on and the clock our own last press set. No
    // declaredSeats, and that absence is the assertion.
    expect(isCatchLive.length).toBe(5)
  })
})

// The instant the button will go dead on its own, so the store can ask again
// then rather than on the next message.
describe('catchLiveUntil', () => {
  it('is null while the button is dead', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 8)], 0, {}, UNLOCKED, NOW)).toBeNull()
    expect(
      catchLiveUntil([seat(0, 8), seat(1, 1)], 0, { 1: NOW - CATCH_LATE_GRACE_MS }, UNLOCKED, NOW),
    ).toBeNull()
  })

  // A seat on two cards only leaves the band by a card being played, and a
  // card arrives as a message: no clock to run.
  it('is null while a seat on two cards holds it live', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 2)], 0, {}, UNLOCKED, NOW)).toBeNull()
    expect(
      catchLiveUntil([seat(0, 8), seat(1, 2), seat(2, 1)], 0, { 2: NOW + 100 }, UNLOCKED, NOW),
    ).toBeNull()
  })

  // The grace is part of what the timer waits for: the button has to go dark
  // when the *server* stops charging, not when the bar finishes draining.
  it('is the last window plus its grace when only windows hold it live', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 1)], 0, { 1: NOW + 800 }, UNLOCKED, NOW)).toBe(
      NOW + 800 + CATCH_LATE_GRACE_MS,
    )
    expect(
      catchLiveUntil(
        [seat(0, 8), seat(1, 1), seat(2, 1)],
        0,
        { 1: NOW + 800, 2: NOW + 3000 },
        UNLOCKED,
        NOW,
      ),
    ).toBe(NOW + 3000 + CATCH_LATE_GRACE_MS)
  })

  // A window whose hand has grown still runs its clock: that is the press the
  // grace exists to let the player lose.
  it('runs the clock on a window whose hand has grown out of reach', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 3)], 0, { 1: NOW + 800 }, UNLOCKED, NOW)).toBe(
      NOW + 800 + CATCH_LATE_GRACE_MS,
    )
  })

  it('never runs a clock on our own window', () => {
    expect(catchLiveUntil([seat(0, 1), seat(1, 8)], 0, { 0: NOW + 800 }, UNLOCKED, NOW)).toBeNull()
  })
})

/**
 * The lockout, which is the other half of what a missed call costs and the only
 * half a held thumb pays.
 *
 * The card is rationed per offer, so after the first press every later one
 * against the same near-finish picture is free — and the one that lands on the
 * frame a window opens takes the catch, since a catch that lands spends no
 * offer. Mashing bought every window at the table for one card. The lockout is
 * rationed per press instead, so the button is never live at the instant a
 * window opens under a thumb that never let go.
 *
 * Nothing here mirrors the server's duration: it sends the instant, and this
 * side counts it down.
 */
describe('the lockout', () => {
  it('takes the button down whatever the table is holding', () => {
    const nearlyDone = [seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)]
    expect(isCatchLive(nearlyDone, 0, {}, UNLOCKED, NOW)).toBe(true)
    expect(isCatchLive(nearlyDone, 0, {}, NOW + 1500, NOW)).toBe(false)
    // The window a mashed button used to collect: open, unspoken for, and not
    // ours while the lock runs.
    expect(isCatchLive([seat(0, 8), seat(1, 1)], 0, { 1: NOW + WINDOW }, NOW + 1500, NOW)).toBe(
      false,
    )
  })

  it('ends on the clock, like every other deadline here', () => {
    expect(isCatchLocked(NOW + 1, NOW)).toBe(true)
    expect(isCatchLocked(NOW, NOW)).toBe(false)
    expect(isCatchLocked(NOW - 1, NOW)).toBe(false)
    // Never locked at all.
    expect(isCatchLocked(0, NOW)).toBe(false)
    const nearlyDone = [seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)]
    expect(isCatchLive(nearlyDone, 0, {}, NOW - 1, NOW)).toBe(true)
  })

  // The store arms one timer on this, so the button has to come back on its own
  // rather than on the next message: a lock is two seconds and a quiet table
  // can be longer than that.
  it('is what the clock is set to while it runs', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 2)], 0, {}, NOW + 1500, NOW)).toBe(NOW + 1500)
    // Even where the offer itself would never end on a clock (a seat sitting on
    // two cards), the lock does — and that is the instant the answer changes.
    expect(catchLiveUntil([seat(0, 8), seat(1, 1)], 0, { 1: NOW + 200 }, NOW + 1500, NOW)).toBe(
      NOW + 1500,
    )
  })
})
