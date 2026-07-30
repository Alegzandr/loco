import { describe, it, expect } from 'vitest'
import {
  clockwiseOpponents,
  opponentBubblePositions,
  boardScale,
  boardSpace,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  TOP_CHROME,
  tableRect,
  discardPosition,
  deckPosition,
} from '../components/cards/layout'
import { CARD_H, BOTTOM_RESERVE } from '../components/cards/cardTheme'

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
  it('leaves mid-size windows at their design size', () => {
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

  it('shrinks the board on phones smaller than the reference screen', () => {
    // Cards and seats are drawn for a ~390×844 phone; on anything shorter or
    // narrower they read as too big rather than as a table seen from above.
    const reference = boardScale(390, 844)
    expect(boardScale(375, 667)).toBeLessThan(reference)   // iPhone SE
    expect(boardScale(360, 640)).toBeLessThan(reference)   // small Android
    for (const [w, h] of [[390, 844], [375, 667], [360, 640], [320, 568]]) {
      expect(boardScale(w, h)).toBeLessThanOrEqual(1)
      expect(boardScale(w, h)).toBeGreaterThanOrEqual(MIN_BOARD_SCALE)
    }
  })

  it('never zooms a phone in, and never shrinks a desktop window', () => {
    expect(boardScale(430, 932)).toBeLessThanOrEqual(1)  // large phone
    expect(boardScale(768, 1024)).toBe(1)                // tablet
  })

  it('leaves the virtual space at least as large as the design space', () => {
    for (const [w, h] of [[1920, 1080], [2560, 1440], [3440, 1440], [1440, 900]]) {
      const s = boardScale(w, h)
      expect(w / s).toBeGreaterThanOrEqual(1239)
      expect(h / s).toBeGreaterThanOrEqual(789)
    }
  })

  it('keeps both chrome reserves constant in pixels at every scale', () => {
    // The top cluster and the action bar are real chrome: they do not scale
    // with the board, so the two bands it must stay out of are the same number
    // of pixels whatever the scale.
    for (const [w, h] of [[1920, 1080], [2560, 1440], [390, 844], [360, 640], [1000, 800]]) {
      const s = boardScale(w, h)
      const { height, offsetY } = boardSpace(w, h, s)
      const toPx = (y: number) => offsetY + y * s
      // First seat row starts at TOP_CHROME; the hand ends BOTTOM_RESERVE up.
      expect(toPx(TOP_CHROME)).toBeCloseTo(TOP_CHROME, 5)
      expect(toPx(height - BOTTOM_RESERVE)).toBeCloseTo(h - BOTTOM_RESERVE, 5)
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
