import { describe, it, expect } from 'vitest'
import {
  clockwiseOpponents,
  seatLayout,
  boardScale,
  boardSpace,
  MAX_BOARD_SCALE,
  MIN_BOARD_SCALE,
  TOP_CHROME,
  tableRect,
  discardPosition,
  deckPosition,
  directionArrows,
  directionArrowBox,
  DIRECTION_RADIUS,
  feltSquash,
  tableTrackEllipse,
  TABLE_TRACK_WIDTH,
  FELT_RIM,
  onPile,
  pileTransform,
  PILE_PERSPECTIVE,
  PILE_SQUASH,
  PILE_TILT_DEG,
  MIN_SQUASH,
  PILE_CHIP_REACH,
} from '../components/cards/layout'
import { CARD_W, CARD_H, BOTTOM_RESERVE } from '../components/cards/cardTheme'

describe('the piles lie on the felt', () => {
  // What the browser does with `perspective(d) rotateX(t)` about the box's
  // centre, written out as the spec's matrices rather than as `onPile`'s algebra:
  // the corner tokens and the landing squash are only right if the two agree.
  function css(x: number, y: number): { x: number; y: number } {
    const t = (PILE_TILT_DEG * Math.PI) / 180
    const [px, py] = [x - CARD_W / 2, y - CARD_H / 2]
    // rotateX: y' = y cos t, z' = y sin t; perspective: w = 1 - z'/d.
    const ry = py * Math.cos(t)
    const rz = py * Math.sin(t)
    const w = 1 - rz / PILE_PERSPECTIVE
    return { x: CARD_W / 2 + px / w, y: CARD_H / 2 + ry / w }
  }

  it('says in numbers exactly what the CSS transform draws', () => {
    expect(pileTransform()).toBe(`perspective(${PILE_PERSPECTIVE}px) rotateX(${PILE_TILT_DEG}deg)`)
    for (const [x, y] of [[0, 0], [CARD_W, 0], [0, CARD_H], [CARD_W, CARD_H], [CARD_W / 2, CARD_H / 2]]) {
      const a = onPile(x, y)
      const b = css(x, y)
      expect(a.x).toBeCloseTo(b.x, 6)
      expect(a.y).toBeCloseTo(b.y, 6)
    }
  })

  it('keeps the pair close in, and the colour chip clear of the deck', () => {
    for (const [w, h, reserve] of [[1920, 1080, 158], [390, 844, 156]]) {
      const deck = deckPosition(w, h, reserve)
      const discard = discardPosition(w, h, reserve)
      // The deck's nearest seen point is its bottom layer's near-right corner;
      // the chip's is its left edge off the discard's near-left corner.
      const deckRight = deck.x + onPile(CARD_W, CARD_H + 9).x
      const chipLeft = discard.x + onPile(0, CARD_H).x - PILE_CHIP_REACH
      expect(chipLeft - deckRight).toBeGreaterThanOrEqual(8)
      expect(discard.x - (deck.x + CARD_W)).toBeLessThanOrEqual(CARD_W / 2)
    }
  })

  it('draws the far edge narrower than the near one, and the card flatter than it is', () => {
    const far = onPile(CARD_W, 0).x - onPile(0, 0).x
    const near = onPile(CARD_W, CARD_H).x - onPile(0, CARD_H).x
    expect(far).toBeLessThan(near)
    expect(PILE_SQUASH).toBeLessThan(0.9)
    // Never laid flatter than the hands lying on the same felt around it.
    expect(PILE_SQUASH).toBeGreaterThanOrEqual(MIN_SQUASH)
  })
})

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

  // The page runs `viewport-fit=cover` so the map reaches every edge of the
  // screen (without it iOS paints the notch and the home-indicator band with
  // the body's own colour, which is where the dark purple bands came from).
  // Paint may reach those edges; the game may not. Both reserves are therefore
  // measured from the safe edge, not from the screen edge.
  it('measures both chrome reserves from the safe edge, not the screen edge', () => {
    // iPhone 14 Pro portrait: notch above, home indicator below.
    const insets = { top: 59, right: 0, bottom: 34, left: 0 }
    for (const [w, h] of [[390, 844], [360, 640], [1920, 1080]]) {
      const s = boardScale(w - insets.left - insets.right, h - insets.top - insets.bottom)
      const { height, offsetY } = boardSpace(w, h, s, insets)
      const toPx = (y: number) => offsetY + y * s
      expect(toPx(TOP_CHROME)).toBeCloseTo(insets.top + TOP_CHROME, 5)
      expect(toPx(height - BOTTOM_RESERVE)).toBeCloseTo(h - insets.bottom - BOTTOM_RESERVE, 5)
    }
  })

  it('spends a landscape notch on the sides, so nothing is dealt under it', () => {
    const insets = { top: 0, right: 59, bottom: 21, left: 59 }
    const [w, h] = [844, 390]
    const s = boardScale(w - insets.left - insets.right, h - insets.top - insets.bottom)
    const { width, offsetX } = boardSpace(w, h, s, insets)
    expect(offsetX).toBe(insets.left)
    expect(offsetX + width * s).toBeCloseTo(w - insets.right, 5)
  })

  it('is unchanged on a device with no safe areas', () => {
    const s = boardScale(1440, 900)
    const withNone = boardSpace(1440, 900, s, { top: 0, right: 0, bottom: 0, left: 0 })
    const omitted = boardSpace(1440, 900, s)
    expect(omitted).toEqual(withNone)
    expect(omitted.offsetX).toBe(0)
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

describe('directionArrows', () => {
  // The points of a path, in order.
  const points = (d: string) =>
    [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
  // The path runs the outer edge (33 points), then neck, tip, neck and back
  // down the inner edge: the tip is the 35th point.
  const tip = (d: string) => {
    const c = directionArrowBox() / 2
    const p = points(d)[34]
    return { x: p.x - c, y: p.y - c }
  }

  it('draws two arrows, one each side of the piles', () => {
    const [right, left] = directionArrows(1)
    const c = directionArrowBox() / 2
    const mean = (d: string) => points(d).reduce((s, p) => s + p.x - c, 0) / points(d).length
    expect(mean(right)).toBeGreaterThan(DIRECTION_RADIUS * 0.6)
    expect(mean(left)).toBeLessThan(-DIRECTION_RADIUS * 0.6)
  })

  it('points clockwise on screen for direction +1', () => {
    // The seat arc runs 6 o'clock → 9 → 12 → 3 for +1: down the right-hand
    // side, up the left. With y pointing down, the right arrow's head is
    // below its middle and the left arrow's above.
    const [right, left] = directionArrows(1)
    expect(tip(right).y).toBeGreaterThan(0)
    expect(tip(left).y).toBeLessThan(0)
  })

  it('turns both heads round when the direction flips', () => {
    const [right, left] = directionArrows(-1)
    expect(tip(right).y).toBeLessThan(0)
    expect(tip(left).y).toBeGreaterThan(0)
  })

  it('keeps every point of the arrows inside the box it is drawn in', () => {
    const box = directionArrowBox()
    for (const d of [...directionArrows(1), ...directionArrows(-1)]) {
      for (const p of points(d)) {
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(box)
        expect(p.y).toBeLessThanOrEqual(box)
      }
    }
  })

  it('clears both piles', () => {
    // The circle stands outside the pair of cards: deck | gap | discard.
    const discard = discardPosition(1280, 800)
    const deck = deckPosition(1280, 800)
    const halfPair = (discard.x + CARD_W - deck.x) / 2
    expect(DIRECTION_RADIUS).toBeGreaterThan(halfPair)
  })
})

describe('the table seen from a chair', () => {
  it('foreshortens the depth by the felt against the table it stands for', () => {
    // A felt as flat on screen as the table is deep on the ground reads as
    // seen from straight above, and is not squashed at all.
    expect(feltSquash(600, 900)).toBe(1)
    // The desktop's flat oval: its depth is a fraction of its width.
    const k = feltSquash(1200, 440)
    expect(k).toBeGreaterThan(0.2)
    expect(k).toBeLessThan(0.4)
    expect(feltSquash(0, 100)).toBe(1)
  })

  it('lays the racetrack as an ellipse concentric with the felt, against the rim', () => {
    // Taken in by the same amount on both axes, exactly as the CSS draws the
    // rim's inner edge: every line round the table the same kind of oval. An
    // offset curve came to points at the ends of a flat oval, and bands drawn
    // foreshortened had a gap that swelled at the sides.
    const e = tableTrackEllipse(1200, 440)
    expect(e.cx).toBe(600)
    expect(e.cy).toBe(220)
    expect(600 - e.rx).toBeCloseTo(FELT_RIM + TABLE_TRACK_WIDTH / 2, 6)
    expect(220 - e.ry).toBeCloseTo(FELT_RIM + TABLE_TRACK_WIDTH / 2, 6)
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

  it('keeps every seat on-screen for a small phone', () => {
    const { seats } = seatLayout(3, 320, 640)
    expect(seats).toHaveLength(3)
    for (const s of seats) {
      expect(s.box.left).toBeGreaterThanOrEqual(0)
      expect(s.box.left + s.box.width).toBeLessThanOrEqual(320)
      expect(s.box.top).toBeGreaterThan(0)
    }
  })

  it('places the first clockwise opponent on the left', () => {
    const { seats } = seatLayout(2, 1024, 768)
    expect(seats[0].x).toBeLessThan(seats[1].x)
    expect(seats[0].y).toBeGreaterThan(0)
    expect(seats[1].y).toBeGreaterThan(0)
  })
})
