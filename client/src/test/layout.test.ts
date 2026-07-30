import { describe, it, expect } from 'vitest'
import {
  clockwiseOpponents,
  opponentBubblePositions,
  boardScale,
  MAX_BOARD_SCALE,
  tableRect,
  discardPosition,
  deckPosition,
} from '../components/cards/layout'
import { CARD_H } from '../components/cards/cardTheme'

describe('pile placement', () => {
  it('centres the deck/discard pair inside the felt, seats included', () => {
    for (const [w, h, reserve] of [[1298, 730, 158], [1440, 900, 125], [390, 844, 156]]) {
      const t = tableRect(w, h, reserve)
      const feltCentre = t.top + t.height / 2
      for (const p of [discardPosition(w, h, reserve), deckPosition(w, h, reserve)]) {
        expect(p.y + CARD_H / 2).toBeCloseTo(feltCentre, 5)
      }
    }
  })

  it('keeps the deck left of the discard, both inside the felt', () => {
    const [w, h, reserve] = [1298, 730, 158]
    const t = tableRect(w, h, reserve)
    const deck = deckPosition(w, h, reserve)
    const discard = discardPosition(w, h, reserve)
    expect(deck.x).toBeLessThan(discard.x)
    expect(deck.x).toBeGreaterThan(t.left)
    expect(discard.x).toBeLessThan(t.left + t.width)
  })
})

describe('boardScale', () => {
  it('never shrinks the board below its design size', () => {
    expect(boardScale(390, 844)).toBe(1)   // phone
    expect(boardScale(820, 600)).toBe(1)   // small laptop window
    expect(boardScale(0, 0)).toBe(1)       // pre-measure
  })

  it('grows the board on a desktop viewport instead of leaving background', () => {
    expect(boardScale(1920, 1080)).toBeGreaterThan(1.2)
    expect(boardScale(2560, 1440)).toBe(MAX_BOARD_SCALE)
  })

  it('is limited by the shorter axis, so a wide but short window stays readable', () => {
    // Plenty of width, barely any height: scaling up here would push the hand
    // and the action bar off screen.
    expect(boardScale(2560, 700)).toBe(1)
  })

  it('leaves the virtual space at least as large as the design space', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440], [1440, 900]]) {
      const s = boardScale(w, h)
      expect(w / s).toBeGreaterThanOrEqual(1149)
      expect(h / s).toBeGreaterThanOrEqual(729)
    }
  })

  it('fills the vertical band better once scaled: less dead space under the felt', () => {
    const deadSpace = (w: number, h: number, s: number) => {
      const t = tableRect(w / s, h / s, 130)
      return (h / s) - (t.top + t.height)
    }
    const unscaled = deadSpace(1920, 1080, 1)
    const scaled = deadSpace(1920, 1080, boardScale(1920, 1080))
    expect(scaled).toBeLessThan(unscaled)
  })
})

describe('opponent layout helpers', () => {
  it('clockwiseOpponents preserves clockwise order from local player', () => {
    const players = [
      { index: 0, nickname: 'alice', hand_size: 5, connected: true },
      { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      { index: 2, nickname: 'carol', hand_size: 5, connected: true },
      { index: 3, nickname: 'dave', hand_size: 5, connected: true },
    ]
    const others = clockwiseOpponents(players, 2)
    expect(others.map((p) => p.index)).toEqual([3, 0, 1])
  })

  it('clockwiseOpponents handles sparse seat indexes without dropping opponents', () => {
    const players = [
      { index: 0, nickname: 'alice', hand_size: 5, connected: true },
      { index: 2, nickname: 'bob', hand_size: 5, connected: true },
      { index: 5, nickname: 'carol', hand_size: 5, connected: true },
    ]
    const others = clockwiseOpponents(players, 2)
    expect(others.map((p) => p.index)).toEqual([5, 0])
  })

  it('opponentBubblePositions keep bubbles on-screen for small/mobile viewport', () => {
    const positions = opponentBubblePositions(3, 320, 640)
    expect(positions).toHaveLength(3)
    for (const pos of positions) {
      expect(pos.x).toBeGreaterThanOrEqual(0)
      expect(pos.x).toBeLessThanOrEqual(320)
      expect(pos.y).toBeGreaterThan(0)
    }
  })

  it('opponentBubblePositions place first clockwise opponent on the left', () => {
    const positions = opponentBubblePositions(2, 1024, 768)
    expect(positions[0].x).toBeLessThan(positions[1].x)
    expect(positions[0].y).toBeGreaterThan(0)
    expect(positions[1].y).toBeGreaterThan(0)
  })
})
