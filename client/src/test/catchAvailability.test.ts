import { describe, it, expect } from 'vitest'
import {
  isCatchLive,
  catchLiveUntil,
  CATCH_LIVE_MAX_HAND,
} from '../components/catchAvailability'
import type { PlayerDTO } from '../types/protocol'

const seat = (index: number, hand_size: number): PlayerDTO => ({
  index,
  nickname: `P${index}`,
  hand_size,
  connected: true,
})

const NOW = 1_000_000
const WINDOW = 5000

describe('isCatchLive', () => {
  it('is dead on a fresh deal', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 8), seat(2, 8)], 0, {}, NOW)).toBe(false)
  })

  it('wakes up at the threshold and stays asleep one card above it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)], 0, {}, NOW)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND + 1)], 0, {}, NOW)).toBe(false)
  })

  // And the threshold itself, in figures rather than through the constant: the
  // wager is offered exactly one ordinary play from the window it is aiming at.
  // A seat on three needs an interrupt of two identical cards to get there, so
  // arming the button that early opens a long stretch of round where pressing
  // can only ever miss — and a miss that a player can schedule is a card they
  // chose to draw, which is a Swap away from being a reward.
  it('is one card from the window, never two', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 2)], 0, {}, NOW)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, 3)], 0, {}, NOW)).toBe(false)
  })

  // There is nobody to catch at our own seat, so our own hand may never arm the
  // button — otherwise every player would find it live for the last two cards
  // of every round they were winning.
  it('never counts our own hand', () => {
    expect(isCatchLive([seat(0, 2), seat(1, 8)], 0, {}, NOW)).toBe(false)
    expect(isCatchLive([seat(0, 1), seat(1, 8)], 0, { 0: NOW + WINDOW }, NOW)).toBe(false)
  })

  // A seat on zero cards has won the round or been retired out of it. Neither
  // owes the table a call, and offering a wager against them is offering a card
  // for nothing.
  it('ignores an empty hand', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 0)], 0, {}, NOW)).toBe(false)
  })

  it('is live as soon as any one seat qualifies', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 7), seat(2, 2), seat(3, 6)], 0, {}, NOW)).toBe(true)
  })

  it('answers an empty roster without throwing', () => {
    expect(isCatchLive([], 0, {}, NOW)).toBe(false)
  })

  // A seat on its last card is offered for exactly as long as its window runs.
  // Past it nothing about the seat can be caught, so a button live over it
  // was a wager that could only ever lose — and a loss a player can schedule
  // is a card drawn on purpose, for a Swap to hand on.
  it('offers a last card inside its window and not past it', () => {
    const players = [seat(0, 8), seat(1, 1)]
    expect(isCatchLive(players, 0, { 1: NOW + WINDOW }, NOW)).toBe(true)
    expect(isCatchLive(players, 0, { 1: NOW + 1 }, NOW)).toBe(true)
    expect(isCatchLive(players, 0, { 1: NOW }, NOW)).toBe(false)
    expect(isCatchLive(players, 0, { 1: NOW - 60_000 }, NOW)).toBe(false)
  })

  // A seat on one card the table was never told a window for — a reloaded tab
  // that arrived after the seat spoke, or after the window ran out — is not an
  // offer. Only the armed cue is a promise, and this is not even that.
  it('is dead on a last card with no window on the clock', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 1)], 0, {}, NOW)).toBe(false)
  })

  // The clock is per seat and read against the roster: an entry left behind
  // by a seat that has since drawn counts for nothing.
  it('ignores a window entry for a seat no longer on one card', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 4)], 0, { 1: NOW + WINDOW }, NOW)).toBe(false)
  })

  // What this function does NOT read, and it is the pin on the rule: whether
  // the table heard the seat call it. The clock runs the same whether the seat
  // spoke or not, so a button that reads only the clock reports nothing — and
  // it keeps accepting the press the price exists to charge for, the thumb
  // already coming down when the seat shouted. The only thing a declaration
  // closes is the *armed* cue, which rides `catchTarget` and not this.
  it('takes no declaration, by signature', () => {
    expect(isCatchLive.length).toBe(4)
  })
})

// The instant the button will go dead on its own, so the store can ask again
// then rather than on the next message.
describe('catchLiveUntil', () => {
  it('is null while the button is dead', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 8)], 0, {}, NOW)).toBeNull()
    expect(catchLiveUntil([seat(0, 8), seat(1, 1)], 0, { 1: NOW - 1 }, NOW)).toBeNull()
  })

  // A seat on two cards only leaves the band by a card being played, and a
  // card arrives as a message: no clock to run.
  it('is null while a seat on two cards holds it live', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 2)], 0, {}, NOW)).toBeNull()
    expect(
      catchLiveUntil([seat(0, 8), seat(1, 2), seat(2, 1)], 0, { 2: NOW + 100 }, NOW),
    ).toBeNull()
  })

  it('is the end of the last window when only last cards hold it live', () => {
    expect(catchLiveUntil([seat(0, 8), seat(1, 1)], 0, { 1: NOW + 800 }, NOW)).toBe(NOW + 800)
    expect(
      catchLiveUntil(
        [seat(0, 8), seat(1, 1), seat(2, 1)],
        0,
        { 1: NOW + 800, 2: NOW + 3000 },
        NOW,
      ),
    ).toBe(NOW + 3000)
  })

  it('never runs a clock on our own window', () => {
    expect(catchLiveUntil([seat(0, 1), seat(1, 8)], 0, { 0: NOW + 800 }, NOW)).toBeNull()
  })
})
