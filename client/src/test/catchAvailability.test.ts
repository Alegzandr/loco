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
    expect(isCatchLive([seat(0, 8), seat(1, 8), seat(2, 8)], 0)).toBe(false)
  })

  it('wakes up at the threshold and stays asleep one card above it', () => {
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND)], 0)).toBe(true)
    expect(isCatchLive([seat(0, 8), seat(1, CATCH_LIVE_MAX_HAND + 1)], 0)).toBe(false)
  })

  // There is nobody to catch at our own seat, so our own hand may never arm the
  // button — otherwise every player would find it live for the last three cards
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
})
