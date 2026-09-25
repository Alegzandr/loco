import { describe, it, expect } from 'vitest'
import {
  seatLayout,
  tableRect,
  CLOTH_INSET,
  seatBox,
  seatFan,
  seatPlate,
  handSpots,
  fanCount,
  fanExtent,
  facingUs,
  deckPosition,
  discardPosition,
  TOP_CHROME,
  shoutLine,
  SHOUT_BAND_MIN,
  SHOUT_HALF_W,
  type Rect,
  type SeatPlace,
} from '../components/cards/layout'
import {
  SEAT_DIMS,
  SEAT_SPECS,
  BOTTOM_RESERVE,
  CARD_W,
  CARD_H,
  handCard,
  type SeatSize,
} from '../components/cards/cardTheme'

const DESKTOP = { w: 1440, h: 900 }
const DESIGN = { w: 1240, h: 790 }
const TABLET = { w: 800, h: 790 }
const PHONE = { w: 405, h: 830 }
const SMALL = { w: 410, h: 781 }
const VIEWPORTS = [DESKTOP, DESIGN, TABLET, { w: 1024, h: 768 }, PHONE, SMALL]

const overlaps = (a: Rect, b: Rect) =>
  a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

const plateRect = (s: SeatPlace): Rect => {
  const spec = SEAT_SPECS[s.size]
  return {
    left: s.x + s.plate.x - spec.plateW / 2,
    top: s.y + s.plate.y - spec.plateH / 2,
    width: spec.plateW,
    height: spec.plateH,
  }
}

type Pt = { x: number; y: number }

/** Every back of a seat's fullest hand, as the quadrilateral drawn on screen. */
const cardQuads = (s: SeatPlace): Pt[][] => {
  const card = SEAT_SPECS[s.size].card
  if (!card) return []
  return seatFan(s.size, SEAT_SPECS[s.size].maxVisible, s.lay).map((c) =>
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sy]) => {
      const lx = (sx * card.w) / 2
      const ly = (sy * card.h) / 2
      const x = lx * Math.cos(c.rotation) - ly * Math.sin(c.rotation)
      const y = (lx * Math.sin(c.rotation) + ly * Math.cos(c.rotation)) * c.squash
      return { x: s.x + c.x + x, y: s.y + c.y + y }
    }),
  )
}

/** Two convex polygons intersect unless an edge of one separates them. */
const polysTouch = (a: Pt[], b: Pt[]) => {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      const nx = q.y - p.y
      const ny = p.x - q.x
      const proj = (pts: Pt[]) => pts.map((r) => r.x * nx + r.y * ny)
      const pa = proj(a)
      const pb = proj(b)
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false
    }
  }
  return true
}

const rectQuad = (r: Rect): Pt[] => [
  { x: r.left, y: r.top },
  { x: r.left + r.width, y: r.top },
  { x: r.left + r.width, y: r.top + r.height },
  { x: r.left, y: r.top + r.height },
]

/** Where a point sits against the felt's ellipse: 1 on the rim, under 1 inside. */
const onEllipse = (felt: Rect, x: number, y: number) => {
  const a = felt.width / 2
  const b = felt.height / 2
  return Math.hypot((x - felt.left - a) / a, (y - felt.top - b) / b)
}

describe('seatLayout: a place on the rim', () => {
  it('returns nothing for a table with no opponents', () => {
    const l = seatLayout(0, DESKTOP.w, DESKTOP.h)
    expect(l.seats).toEqual([])
    expect(l.blockHeight).toBe(0)
  })

  it('gives every opponent a place on the rim of a desktop table, in clockwise order', () => {
    for (let n = 1; n <= 9; n++) {
      const l = seatLayout(n, DESIGN.w, DESIGN.h)
      const felt = tableRect(DESIGN.w, DESIGN.h, l.blockHeight)
      expect(l.seats.every((s) => s.onFelt)).toBe(true)
      // The next player first, at the left, then over the top to the right:
      // clockwise on screen from our own place at the bottom.
      const round = (s: SeatPlace) => {
        const t = Math.atan2(s.y - felt.top - felt.height / 2, s.x - felt.left - felt.width / 2)
        return (t - Math.PI / 2 + Math.PI * 4) % (Math.PI * 2)
      }
      for (let i = 1; i < n; i++) expect(round(l.seats[i])).toBeGreaterThan(round(l.seats[i - 1]))
      for (const s of l.seats) {
        // The hand lies on the felt; the plate sits on its edge.
        expect(onEllipse(felt, s.x, s.y)).toBeLessThan(1)
        const plate = plateRect(s)
        if (plate.left > 10 && plate.left + plate.width < DESIGN.w - 10) {
          const r = onEllipse(felt, plate.left + plate.width / 2, plate.top + plate.height / 2)
          expect(r).toBeGreaterThan(0.9)
          expect(r).toBeLessThan(1.15)
        }
      }
    }
  })

  it('spaces a crowded table round the whole rim, us included, rather than bunching it over the top', () => {
    for (const vp of [DESIGN, DESKTOP]) {
      // Four at the table split the rim in four: 9 o'clock, across, 3 o'clock.
      const three = seatLayout(3, vp.w, vp.h)
      const felt3 = tableRect(vp.w, vp.h, three.blockHeight)
      const mid3 = felt3.top + felt3.height / 2
      expect(Math.abs(three.seats[0].y + three.seats[0].plate.y - mid3)).toBeLessThan(felt3.height * 0.06)
      expect(Math.abs(three.seats[2].y + three.seats[2].plate.y - mid3)).toBeLessThan(felt3.height * 0.06)
      // More come down the shoulders towards our end, as far as our hand lets them.
      for (let n = 5; n <= 9; n++) {
        const l = seatLayout(n, vp.w, vp.h)
        const felt = tableRect(vp.w, vp.h, l.blockHeight)
        const mid = felt.top + felt.height / 2
        expect(l.seats[0].y + l.seats[0].plate.y).toBeGreaterThan(mid)
        expect(l.seats[n - 1].y + l.seats[n - 1].plate.y).toBeGreaterThan(mid)
      }
    }
  })

  it('lays every hand down with its tips towards the middle of the table', () => {
    const l = seatLayout(5, DESIGN.w, DESIGN.h)
    const felt = tableRect(DESIGN.w, DESIGN.h, l.blockHeight)
    const cx = felt.left + felt.width / 2
    const cy = felt.top + felt.height / 2
    for (const s of l.seats) {
      // The card's "up", (sin r, −cos r), against the way to the centre before
      // the perspective flattens it.
      const ux = Math.sin(s.lay.rotation)
      const uy = -Math.cos(s.lay.rotation)
      const dx = cx - s.x
      const dy = (cy - s.y) / s.lay.squash
      expect((ux * dx + uy * dy) / Math.hypot(dx, dy)).toBeGreaterThan(0.99)
      expect(s.lay.squash).toBeGreaterThanOrEqual(0.8)
      expect(s.lay.squash).toBeLessThanOrEqual(1)
    }
    // The player across has theirs tips down the screen: put down, facing us.
    const across = l.seats[2]
    expect(Math.abs(Math.abs(across.lay.rotation) - Math.PI)).toBeLessThan(0.05)
  })

  it('sits two opponents at the shoulders of the table, never at its far ends', () => {
    const l = seatLayout(2, DESIGN.w, DESIGN.h)
    const felt = tableRect(DESIGN.w, DESIGN.h, l.blockHeight)
    for (const s of l.seats) expect(s.y).toBeLessThan(felt.top + felt.height * 0.4)
  })

  it('never lets two names or two hands touch, at any size of table', () => {
    for (const vp of VIEWPORTS) {
      for (let n = 1; n <= 9; n++) {
        const { seats } = seatLayout(n, vp.w, vp.h)
        expect(seats).toHaveLength(n)
        for (let i = 0; i < n; i++) {
          for (let j = i + 1; j < n; j++) {
            expect(overlaps(plateRect(seats[i]), plateRect(seats[j]))).toBe(false)
            // Card against card, as drawn: a tilted hand's bounding box is
            // mostly air, and two neighbours' boxes may cross where no card is.
            for (const qa of cardQuads(seats[i])) {
              for (const qb of cardQuads(seats[j])) expect(polysTouch(qa, qb)).toBe(false)
            }
          }
        }
      }
    }
  })

  it('lays every hand on the cloth, inside the rail and the racetrack', () => {
    for (const vp of VIEWPORTS) {
      for (let n = 1; n <= 9; n++) {
        const l = seatLayout(n, vp.w, vp.h)
        if (!l.seats.every((s) => s.onFelt)) continue
        const t = tableRect(vp.w, vp.h, l.blockHeight)
        const a = t.width / 2 - CLOTH_INSET
        const b = t.height / 2 - CLOTH_INSET
        for (const s of l.seats) {
          for (const q of cardQuads(s)) {
            for (const { x, y } of q) {
              const e = ((x - t.left - t.width / 2) / a) ** 2 + ((y - t.top - t.height / 2) / b) ** 2
              expect(e, `${vp.w}×${vp.h}, ${n} seats, seat at ${Math.round(s.x)},${Math.round(s.y)} ${s.size}`).toBeLessThanOrEqual(1.02)
            }
          }
        }
      }
    }
  })

  it('keeps every hand clear of the deck and the discard', () => {
    for (const vp of VIEWPORTS) {
      for (let n = 1; n <= 9; n++) {
        const l = seatLayout(n, vp.w, vp.h)
        const deck = deckPosition(vp.w, vp.h, l.blockHeight)
        const disc = discardPosition(vp.w, vp.h, l.blockHeight)
        const piles: Rect = { left: deck.x, top: deck.y, width: disc.x + CARD_W - deck.x, height: CARD_H }
        for (const s of l.seats) {
          for (const q of cardQuads(s)) expect(polysTouch(q, rectQuad(piles))).toBe(false)
          expect(overlaps(plateRect(s), piles)).toBe(false)
        }
      }
    }
  })

  it('keeps every seat on screen, under the top chrome', () => {
    for (const vp of [...VIEWPORTS, { w: 320, h: 640 }]) {
      for (let n = 1; n <= 9; n++) {
        for (const s of seatLayout(n, vp.w, vp.h).seats) {
          expect(s.box.left).toBeGreaterThanOrEqual(-0.5)
          expect(s.box.left + s.box.width).toBeLessThanOrEqual(vp.w + 0.5)
          expect(s.box.top).toBeGreaterThanOrEqual(TOP_CHROME - 0.5)
          expect(s.box.top + s.box.height).toBeLessThanOrEqual(vp.h - handCard().h - BOTTOM_RESERVE)
        }
      }
    }
  })

  it('never uses the big seats on a phone', () => {
    for (let n = 1; n <= 9; n++) expect(seatLayout(n, PHONE.w, PHONE.h).size).not.toBe('full')
  })

  it('stands a crowded phone table in rows above the felt when the rim cannot seat everybody', () => {
    const l = seatLayout(9, PHONE.w, PHONE.h)
    expect(l.seats.every((s) => !s.onFelt)).toBe(true)
    expect(new Set(l.seats.map((s) => Math.round(s.y))).size).toBeGreaterThan(1)
    const felt = tableRect(PHONE.w, PHONE.h, l.blockHeight)
    expect(felt.top).toBeGreaterThanOrEqual(l.blockHeight)
    for (const s of l.seats) expect(l.blockHeight).toBeGreaterThanOrEqual(s.box.top + s.box.height - 0.5)
  })

  it('gives the table the room: the felt nearly fills the width', () => {
    for (const vp of [DESIGN, DESKTOP, PHONE]) {
      const l = seatLayout(3, vp.w, vp.h)
      expect(tableRect(vp.w, vp.h, l.blockHeight).width).toBeGreaterThan(vp.w * 0.75)
    }
  })
})

describe('a hand, face down', () => {
  it('draws the real number of backs, up to what a seat can hold', () => {
    expect(seatFan('full', 7, facingUs('full'))).toHaveLength(7)
    expect(seatFan('full', 40, facingUs('full'))).toHaveLength(SEAT_SPECS.full.maxVisible)
    expect(seatFan('compact', 3, facingUs('compact'))).toHaveLength(3)
    expect(seatFan('mini', 7, facingUs('mini'))).toHaveLength(0)
    expect(fanCount('full', 0)).toBe(0)
  })

  it('is held the right way up in a row, the way our own hand is', () => {
    const up = seatFan('full', 5, facingUs('full'))
    expect(up[2].rotation).toBeCloseTo(0)
    expect(up[0].y).toBeGreaterThan(up[2].y)
    expect(up[4].y).toBeGreaterThan(up[2].y)
    expect(up[0].rotation).toBeLessThan(0)
    expect(up[4].rotation).toBeGreaterThan(0)
  })

  it('never spreads wider than its lay allows', () => {
    for (const size of ['full', 'compact'] as SeatSize[]) {
      const fan = seatFan(size, 30, facingUs(size))
      const span = Math.max(...fan.map((c) => c.x)) - Math.min(...fan.map((c) => c.x))
      expect(span).toBeLessThanOrEqual(SEAT_SPECS[size].maxSpan + 1e-9)
      const tight = seatFan(size, 30, { ...facingUs(size), span: 20 })
      expect(Math.max(...tight.map((c) => c.x)) - Math.min(...tight.map((c) => c.x))).toBeLessThanOrEqual(20 + 1e-9)
    }
  })

  it('holds a raised fan by its foot with the name plate', () => {
    const spec = SEAT_SPECS.full
    const plate = seatPlate('full')
    const fan = fanExtent('full', spec.maxVisible, facingUs('full'))!
    expect(plate.y - spec.plateH / 2).toBeGreaterThan(fan.top + fan.height / 2)
    expect(plate.y - spec.plateH / 2).toBeLessThan(fan.top + fan.height)
  })

  it('packs rows with the box it measures', () => {
    for (const size of ['full', 'compact', 'mini'] as SeatSize[]) {
      const b = seatBox(size)
      expect(SEAT_DIMS[size].w).toBe(Math.ceil(b.width))
      expect(SEAT_DIMS[size].h).toBe(Math.ceil(b.height))
    }
  })

  it('lands a flier exactly where the seat draws the card, flattened as it lies', () => {
    // The board flies cards to `handSpots`; <PlayerSlot /> draws the backs at
    // the seat's anchor plus `seatFan`. They are one geometry or a draw lands
    // beside the hand it went into.
    const players = [0, 1, 2, 3].map((index) => ({ index, nickname: `p${index}`, hand_size: 6 }))
    const l = seatLayout(3, DESIGN.w, DESIGN.h)
    ;[1, 2, 3].forEach((index, i) => {
      const s = l.seats[i]
      const spots = handSpots(index, 6, players, 0, DESIGN.w, DESIGN.h)
      const drawn = seatFan(s.size, 6, s.lay)
      expect(spots).toHaveLength(drawn.length)
      spots.forEach((spot, k) => {
        expect(spot.x).toBeCloseTo(s.x + drawn[k].x)
        expect(spot.y).toBeCloseTo(s.y + drawn[k].y)
        expect(spot.rotation).toBeCloseTo(drawn[k].rotation)
        expect(spot.squash).toBeCloseTo(s.lay.squash)
      })
    })
  })
})

describe('tableRect', () => {
  it('never overflows the viewport width', () => {
    for (const vp of [DESKTOP, PHONE, { w: 320, h: 640 }, { w: 2560, h: 1440 }]) {
      const t = tableRect(vp.w, vp.h, 120)
      expect(t.left).toBeGreaterThanOrEqual(0)
      expect(t.left + t.width).toBeLessThanOrEqual(vp.w)
    }
  })

  it('stays below the seat block', () => {
    const seats = seatLayout(7, PHONE.w, PHONE.h)
    const t = tableRect(PHONE.w, PHONE.h, seats.blockHeight)
    expect(t.top).toBeGreaterThanOrEqual(seats.blockHeight)
  })

  it('stays clear of the action bar at the bottom', () => {
    const t = tableRect(DESKTOP.w, DESKTOP.h, 120)
    expect(t.top + t.height).toBeLessThanOrEqual(DESKTOP.h - BOTTOM_RESERVE)
  })

  it('stays an oval rather than collapsing to a circle', () => {
    for (const vp of [DESKTOP, PHONE]) {
      const t = tableRect(vp.w, vp.h, 120)
      expect(t.height).toBeLessThan(t.width)
    }
  })
})

describe('shoutLine: where LOCO!, the interception and the catch stamp land', () => {
  // The shout is a band SHOUT_BAND_MIN tall and a little wider than the piles,
  // centred on the line. It used to sit at a fixed height above the piles, on
  // the hand of whoever faces us.
  const band = (line: number, w: number): Rect => ({
    left: w / 2 - SHOUT_HALF_W,
    top: line - SHOUT_BAND_MIN / 2,
    width: 2 * SHOUT_HALF_W,
    height: SHOUT_BAND_MIN,
  })

  // Where no gap is tall enough the shout is laid over the piles instead, by
  // design, and that is the only case in which it may reach a seat.
  const onPiles = (line: number, pilesTop: number) => line >= pilesTop + CARD_H / 2 - 0.5 && line <= pilesTop + CARD_H + 0.5

  it('never covers an opponent while the table has a gap for it', () => {
    let gaps = 0
    for (const vp of VIEWPORTS) {
      for (let n = 1; n <= 9; n++) {
        const lay = seatLayout(n, vp.w, vp.h)
        const line = shoutLine(vp.w, vp.h, lay.seats, lay.blockHeight)
        if (onPiles(line, deckPosition(vp.w, vp.h, lay.blockHeight).y)) continue
        gaps++
        for (const s of lay.seats) {
          expect(overlaps(band(line, vp.w), s.box), `${vp.w}x${vp.h}, ${n} opponents, seat at ${s.x},${s.y}`).toBe(false)
        }
      }
    }
    // Not a test of nothing: a good share of tables have one.
    expect(gaps).toBeGreaterThan((VIEWPORTS.length * 9) / 3)
  })

  it('finds the gap above the piles when the seats are held up in rows', () => {
    const lay = seatLayout(6, PHONE.w, PHONE.h)
    const line = shoutLine(PHONE.w, PHONE.h, lay.seats, lay.blockHeight)
    expect(line).toBeLessThan(deckPosition(PHONE.w, PHONE.h, lay.blockHeight).y)
  })

  it('goes under the piles when the seat across the table is above them', () => {
    const lay = seatLayout(3, DESKTOP.w, DESKTOP.h)
    const line = shoutLine(DESKTOP.w, DESKTOP.h, lay.seats, lay.blockHeight)
    expect(line).toBeGreaterThan(deckPosition(DESKTOP.w, DESKTOP.h, lay.blockHeight).y + CARD_H)
  })

  it('never comes down on our own hand, which an interception is answered from', () => {
    for (const vp of VIEWPORTS) {
      for (let n = 1; n <= 9; n++) {
        const lay = seatLayout(n, vp.w, vp.h)
        const line = shoutLine(vp.w, vp.h, lay.seats, lay.blockHeight)
        const handTop = vp.h - BOTTOM_RESERVE - handCard().h
        expect(line + SHOUT_BAND_MIN / 2, `${vp.w}x${vp.h}, ${n} opponents`).toBeLessThanOrEqual(handTop)
      }
    }
  })
})
