import { describe, it, expect } from 'vitest'
import { isCatchLive, CATCH_LIVE_MAX_HAND } from '../components/catchAvailability'
import type { PlayerDTO } from '../types/protocol'

const seat = (index: number, hand_size: number): PlayerDTO => ({
  index,
  nickname: `P${index}`,
  hand_size,
  connected: true,
})

describe('isCatchLive', () => {
  it('is dead on a fresh deal', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 8), seat(2, 8)], 0, [])).toBe(false)
  })

  it('wakes up at the threshold and stays asleep one card above it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)], 0, [])).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND + 1)], 0, [])).toBe(false)
  })

  // There is nobody to catch at our own seat, so our own hand may never arm the
  // button — otherwise every player would find it live for the last three cards
  // of every round they were winning.
  it('never counts our own hand', () => {
    expect(isCatchLive([seat(0, 1), seat(1, 8)], 0, [])).toBe(false)
  })

  // A seat on zero cards has won the round or been retired out of it. Neither
  // owes the table a call, and offering a wager against them is offering a card
  // for nothing.
  it('ignores an empty hand', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 0)], 0, [])).toBe(false)
  })

  it('is live as soon as any one seat qualifies', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 7), seat(2, 2), seat(3, 6)], 0, [])).toBe(true)
  })

  it('answers an empty roster without throwing', () => {
    expect(isCatchLive([], 0, [])).toBe(false)
  })

  // The whole table heard the call, and the seat cannot be caught until its hand
  // changes. A press against it is not a read that lost — it is a card paid for
  // nothing, so the button stops offering the wager.
  it('goes dead when the only seat on one card has called it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 1)], 0, [1])).toBe(false)
  })

  it('stays live when one seat on a single card has called it and another has not', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 1), seat(2, 1)], 0, [1])).toBe(true)
  })

  // Two or three cards is still a read: an interrupt puts that seat on one card
  // before a thumb can land, and it will owe the table a fresh call when it
  // gets there. Whatever it declared on an earlier card voids nothing here.
  it('ignores a declaration by a seat that is not on one card', () => {
    expect(isCatchLive([seat(0, 8), seat(1, 2)], 0, [1])).toBe(true)
  })

  // Our own declaration is about our own LOCO! button and says nothing about
  // anybody else's, so it must not be able to grey the centre column out.
  it('is unmoved by our own declaration', () => {
    expect(isCatchLive([seat(0, 1), seat(1, 2)], 0, [0])).toBe(true)
  })
})
