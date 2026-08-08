import { describe, it, expect } from 'vitest'
import { isCatchLive, nextCatchLive, CATCH_LIVE_MAX_HAND } from '../components/catchAvailability'
import type { PlayerDTO } from '../types/protocol'

const seat = (index: number, hand_size: number): PlayerDTO => ({
  index,
  nickname: `P${index}`,
  hand_size,
  connected: true,
})

describe('isCatchLive', () => {
  it('is dead on a fresh deal', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 8), seat(2, 8)], 0)).toBe(false)
  })

  it('wakes up at the threshold and stays asleep one card above it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)], 0)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND + 1)], 0)).toBe(false)
  })

  // And the threshold itself, in figures rather than through the constant: the
  // wager is offered exactly one ordinary play from the window it is aiming at.
  // A seat on three needs an interrupt of two identical cards to get there, so
  // arming the button that early opens a long stretch of round where pressing
  // can only ever miss — and a miss that a player can schedule is a card they
  // chose to draw, which is a Swap away from being a reward.
  it('is one card from the window, never two', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 2)], 0)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, 3)], 0)).toBe(false)
  })

  // There is nobody to catch at our own seat, so our own hand may never arm the
  // button — otherwise every player would find it live for the last two cards
  // of every round they were winning.
  it('never counts our own hand', () => {
    expect(isCatchLive([seat(0, 1), seat(1, 8)], 0)).toBe(false)
  })

  // A seat on zero cards has won the round or been retired out of it. Neither
  // owes the table a call, and offering a wager against them is offering a card
  // for nothing.
  it('ignores an empty hand', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 0)], 0)).toBe(false)
  })

  it('is live as soon as any one seat qualifies', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 7), seat(2, 2), seat(3, 6)], 0)).toBe(true)
  })

  it('answers an empty roster without throwing', () => {
    expect(isCatchLive([], 0)).toBe(false)
  })

  // The one seat left is on a single card the whole table just heard it call,
  // so the press will miss and cost a card — and it stays offered anyway. This
  // is the pin on the rule, not an oversight: a button that went dead here
  // would report the declaration to a player who was not listening for it, and
  // it would refuse the press the price exists to charge for, the thumb already
  // coming down when the seat shouted. The only thing the declaration closes is
  // the *armed* cue, which rides `catchTarget` and not this function.
  it('stays live against a seat the table heard call it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 1)], 0)).toBe(true)
  })
})

// The latch. `isCatchLive` above is a photograph of the roster, and a roster
// slips out of reach without anybody playing anything: a seat on its last card
// swallows a stack of four and is holding five. Read as a photograph the button
// dies in that instant, under a thumb already on its way down — which is the
// interface making the wager for the player, and making it in their favour.
describe('nextCatchLive', () => {
  it('rises with the roster', () => {
    expect(nextCatchLive(false, [seat(0, 8), seat(1, 8)], 0)).toBe(false)
    expect(nextCatchLive(false, [seat(0, 8), seat(1, 2)], 0)).toBe(true)
  })

  // The bait this exists for, in the two shapes it comes in.
  it('holds through a seat drawing itself out of reach', () => {
    expect(nextCatchLive(true, [seat(0, 8), seat(1, 5)], 0)).toBe(true)
  })

  it('holds through the last seat in reach finishing the round', () => {
    expect(nextCatchLive(true, [seat(0, 8), seat(1, 0)], 0)).toBe(true)
  })

  // And the bound, which is the whole reason it is a latch and not an unlock:
  // the offer belongs to one board. The store puts it down on the card played
  // and on the authoritative snapshot, and what this function does with a false
  // it is handed is read the roster again — nothing carries over.
  it('is a fresh read once it has been put back down', () => {
    expect(nextCatchLive(false, [seat(0, 8), seat(1, 5)], 0)).toBe(false)
    expect(nextCatchLive(false, [seat(0, 8), seat(1, 1)], 0)).toBe(true)
  })
})
