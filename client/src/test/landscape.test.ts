import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  boardScale,
  boardSpace,
  calcHandSlots,
  deckPosition,
  discardPosition,
  feltInViewport,
  isLandscape,
  seatLayout,
  seatPosition,
  tableRect,
  turnPillPlace,
  TURN_PILL_H,
  LANDSCAPE_MAX_H,
  MIN_BOARD_SCALE,
  SIDE_RESERVE,
  TOP_CHROME_LANDSCAPE,
  HAND_MARGIN_LANDSCAPE,
} from '../components/cards/layout'
import { CARD_H, CARD_W } from '../components/cards/cardTheme'

const read = (...p: string[]) => readFileSync(path.resolve(__dirname, '..', ...p), 'utf8')

// iPhone 13 Pro on its side, Safari's bar showing: the page is 844×340, the
// notch is on one flank and the home indicator still runs along the bottom.
const PHONE = { w: 844, h: 340, insets: { top: 0, right: 47, bottom: 21, left: 47 } }

/** The board's whole chain, as `GameBoard` runs it, for one pixel size. */
function lay(w: number, h: number, insets = { top: 0, right: 0, bottom: 0, left: 0 }, opponents = 1) {
  const landscape = isLandscape(w, h)
  const scale = boardScale(w - insets.left - insets.right, h - insets.top - insets.bottom, landscape)
  const space = boardSpace(w, h, scale, insets, landscape)
  const seats = seatLayout(opponents, space.width, space.height, landscape)
  const table = tableRect(space.width, space.height, seats.blockHeight, landscape)
  const hand = calcHandSlots(9, space.width, space.height, landscape)
  return { landscape, scale, space, seats, table, hand }
}

describe('a phone on its side', () => {
  // Portrait stacks seats, felt, hand and bar with 198px of chrome that does
  // not scale; at 340px tall that stack fits at no scale a card is readable
  // at. The mode is another composition, decided from pixels.
  it('is decided by the short axis and the orientation, never by width alone', () => {
    expect(isLandscape(844, 340)).toBe(true)
    expect(isLandscape(844, 390)).toBe(true)
    expect(isLandscape(1000, 540)).toBe(true) // a short desktop window gets it too
    expect(isLandscape(390, 844)).toBe(false) // the same phone upright
    expect(isLandscape(1440, 900)).toBe(false)
    expect(isLandscape(1024, 768)).toBe(false) // a tablet on its side is tall enough
    expect(isLandscape(1240, LANDSCAPE_MAX_H)).toBe(false)
    expect(isLandscape(1240, LANDSCAPE_MAX_H - 1)).toBe(true)
  })

  it('scales the board against the phone reference turned on its side, never above 1', () => {
    expect(boardScale(750, 319, true)).toBeGreaterThanOrEqual(MIN_BOARD_SCALE)
    expect(boardScale(750, 319, true)).toBeLessThan(1)
    expect(boardScale(1000, 540, true)).toBe(1)
    // Without the mode the same size was "desktop" at scale 1, which is the
    // 108px card in a 340px viewport of the bug report.
    expect(boardScale(750, 319, false)).toBe(1)
  })

  it('keeps the action stack and the top chrome constant in pixels', () => {
    for (const [w, h] of [[844, 340], [844, 390], [1000, 540]]) {
      const { scale, space } = lay(w, h, PHONE.insets)
      // The stack's band is real chrome up the right edge.
      expect(space.offsetX + space.width * scale).toBeCloseTo(w - PHONE.insets.right - SIDE_RESERVE, 5)
      // The round chip's band is pinned at the top, the hand at the safe bottom.
      expect(space.offsetY + TOP_CHROME_LANDSCAPE * scale).toBeCloseTo(PHONE.insets.top + TOP_CHROME_LANDSCAPE, 5)
      expect(space.offsetY + space.height * scale).toBeCloseTo(h - PHONE.insets.bottom, 5)
    }
  })

  it('stands the seats in a column down the left, next player at the bottom', () => {
    const { space, seats, table } = lay(PHONE.w, PHONE.h, PHONE.insets, 3)
    expect(seats.blockHeight).toBe(0)
    expect(seats.size).not.toBe('full')
    const xs = seats.positions.map((p) => p.x)
    // One column, left of the felt.
    expect(new Set(xs).size).toBe(1)
    expect(xs[0] + seats.pillW / 2).toBeLessThan(table.left)
    expect(xs[0] - seats.pillW / 2).toBeGreaterThanOrEqual(0)
    // Play runs clockwise on screen (6 → 9 → 12), so the first opponent is the
    // lowest pill and the rest climb from it.
    const ys = seats.positions.map((p) => p.y)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeLessThan(ys[i - 1])
    // Centred on the felt, clear of the top chrome and of the hand.
    const mid = (ys[0] + ys[ys.length - 1]) / 2
    expect(mid).toBeCloseTo(table.top + table.height / 2, 0)
    expect(ys[ys.length - 1] - seats.pillH / 2).toBeGreaterThanOrEqual(TOP_CHROME_LANDSCAPE)
    expect(ys[0] + seats.pillH / 2).toBeLessThan(space.height - CARD_H - HAND_MARGIN_LANDSCAPE)
  })

  it('carries a full table on along the top of the felt, and drops the felt under it', () => {
    const seven = lay(PHONE.w, PHONE.h, PHONE.insets, 7)
    expect(seven.seats.positions).toHaveLength(7)
    const column = seven.seats.positions.filter((p) => p.x === seven.seats.positions[0].x)
    const row = seven.seats.positions.slice(column.length)
    expect(row.length).toBeGreaterThan(0)
    expect(seven.seats.blockHeight).toBeGreaterThan(0)
    for (const p of row) {
      expect(p.y + seven.seats.pillH / 2).toBeLessThanOrEqual(seven.table.top)
      expect(p.x - seven.seats.pillW / 2).toBeGreaterThanOrEqual(seven.table.left - 1)
      expect(p.x + seven.seats.pillW / 2).toBeLessThanOrEqual(seven.table.left + seven.table.width + 1)
    }
    // Every pill still inside the space.
    for (const p of seven.seats.positions) {
      expect(p.y - seven.seats.pillH / 2).toBeGreaterThanOrEqual(0)
      expect(p.x + seven.seats.pillW / 2).toBeLessThanOrEqual(seven.space.width)
    }
  })

  it('gives the felt the band between the chrome and the hand, and both piles fit in it', () => {
    for (const [w, h] of [[844, 340], [844, 390], [1000, 540]]) {
      const { space, table, hand } = lay(w, h, PHONE.insets)
      expect(table.top).toBeGreaterThanOrEqual(TOP_CHROME_LANDSCAPE)
      // The hand's top edge is below the felt, the hand's bottom on the margin.
      const handTop = Math.min(...hand.map((s) => s.y))
      expect(table.top + table.height).toBeLessThanOrEqual(handTop)
      expect(Math.max(...hand.map((s) => s.y)) + CARD_H).toBeLessThanOrEqual(space.height)
      expect(table.left + table.width).toBeLessThanOrEqual(space.width)
      // Deck and discard stand inside the felt, centred on it.
      const deck = deckPosition(space.width, space.height, 0, true)
      const disc = discardPosition(space.width, space.height, 0, true)
      expect(deck.x).toBeGreaterThan(table.left + 11)
      expect(disc.x + CARD_W).toBeLessThan(table.left + table.width - 11)
      expect(deck.y).toBeGreaterThanOrEqual(table.top)
      expect(deck.y + CARD_H).toBeLessThanOrEqual(table.top + table.height)
      expect((deck.x + disc.x + CARD_W) / 2).toBeCloseTo(table.left + table.width / 2, 5)
    }
  })

  it('stands the turn pill inside the felt, under the piles, where the hand leaves it no room', () => {
    for (const [w, h] of [[844, 340], [844, 390], [1000, 540]]) {
      const { space, table, hand } = lay(w, h, PHONE.insets)
      const pill = turnPillPlace(space.width, space.height, 0, true)
      const deck = deckPosition(space.width, space.height, 0, true)
      // Under the piles, above the felt's bottom rim, centred on the felt.
      expect(pill.top).toBeGreaterThanOrEqual(deck.y + CARD_H)
      expect(pill.top + TURN_PILL_H).toBeLessThanOrEqual(table.top + table.height - 11)
      expect(pill.centreX).toBeCloseTo(table.left + table.width / 2, 5)
      // …and never over the hand's top edge, where a fan keeps its values.
      expect(pill.top + TURN_PILL_H).toBeLessThan(Math.min(...hand.map((s) => s.y)))
    }
    // Portrait keeps the pill above the hand, clear of a hovered card.
    const up = turnPillPlace(405, 830)
    expect(up.centreX).toBe(405 / 2)
    expect(up.top + TURN_PILL_H).toBeLessThan(calcHandSlots(7, 405, 830)[3].y - 9 - 19)
  })

  it('rides the bottom rim rather than the piles when a top row squeezes the felt', () => {
    const { space, seats, hand } = lay(PHONE.w, PHONE.h, PHONE.insets, 7)
    const pill = turnPillPlace(space.width, space.height, seats.blockHeight, true)
    const deck = deckPosition(space.width, space.height, seats.blockHeight, true)
    expect(pill.top).toBeGreaterThanOrEqual(deck.y + CARD_H)
    // Clear of a playable card's rest lift (9px), which is what the hand's top edge is on our turn.
    expect(pill.top + TURN_PILL_H).toBeLessThanOrEqual(Math.min(...hand.map((s) => s.y)) - 9)
    // The piles gave up their inset and stand flush under the rim.
    const { table } = lay(PHONE.w, PHONE.h, PHONE.insets, 7)
    expect(deck.y).toBeCloseTo(table.top + 11, 5)
  })

  it('keeps the top row of a full table out from under the chip row', () => {
    const { space, seats } = lay(PHONE.w, PHONE.h, PHONE.insets, 7)
    const row = seats.positions.filter((p) => p.x !== seats.positions[0].x)
    // The five chips reach 244px in from the safe edge; the band is 160px.
    const chipRow = space.width - (244 - 160) / boardScale(750, 319, true)
    for (const p of row) expect(p.x + seats.pillW / 2).toBeLessThanOrEqual(chipRow)
  })

  it('anchors the local seat on the hand it draws, in both compositions', () => {
    const players = [
      { index: 0, nickname: 'me', hand_size: 3 },
      { index: 1, nickname: 'bot', hand_size: 3 },
    ]
    const { space } = lay(PHONE.w, PHONE.h, PHONE.insets)
    const me = seatPosition(0, players, 0, space.width, space.height, true)
    const hand = calcHandSlots(1, space.width, space.height, true)[0]
    expect(me.y).toBeCloseTo(hand.y + CARD_H / 2, 5)
    const them = seatPosition(1, players, 0, space.width, space.height, true)
    expect(them).toEqual(seatLayout(1, space.width, space.height, true).positions[0])
  })

  it('solves the felt the room is rendered under from the same chain', () => {
    const anchor = feltInViewport(PHONE.w, PHONE.h, 1, PHONE.insets)
    const { scale, space, table } = lay(PHONE.w, PHONE.h, PHONE.insets)
    expect(anchor.cx).toBeCloseTo(space.offsetX + (table.left + table.width / 2) * scale, 5)
    expect(anchor.cy).toBeCloseTo(space.offsetY + (table.top + table.height / 2) * scale, 5)
    expect(anchor.cy + anchor.ry).toBeLessThan(PHONE.h)
  })

  it('leaves portrait and desktop exactly as they were', () => {
    expect(boardScale(390, 844)).toBe(boardScale(390, 844, false))
    expect(boardSpace(1440, 900, 1)).toEqual(boardSpace(1440, 900, 1, undefined, false))
    expect(tableRect(1240, 790, 130)).toEqual(tableRect(1240, 790, 130, false))
    expect(calcHandSlots(7, 1240, 790)).toEqual(calcHandSlots(7, 1240, 790, false))
    expect(seatLayout(3, 1240, 790)).toEqual(seatLayout(3, 1240, 790, false))
  })
})

// The stack is CSS, the reserve it needs is a number in layout.ts, and a
// stylesheet cannot import a constant: the two are pinned to each other here.
describe('the action stack', () => {
  const bar = read('components', 'ActionBar.svelte')
  const block = bar.match(/@media \(orientation: landscape\) and \(max-height: (\d+)px\)\s*\{([\s\S]*?)\n {2}\}\n/)

  it('turns on the same height the layout does', () => {
    expect(block, 'ActionBar.svelte must carry a landscape block').toBeTruthy()
    expect(Number(block![1])).toBe(LANDSCAPE_MAX_H - 1)
  })

  it('stands up the right edge in one column, three rows, and fits the band the board keeps for it', () => {
    const css = block![2]
    expect(css).toMatch(/grid-template-columns:\s*var\(--slot-w\)/)
    expect(css).toMatch(/grid-template-rows:\s*repeat\(3, auto\)/)
    expect(css).toMatch(/right:\s*calc\(10px \+ var\(--safe-right\)\)/)
    const slotW = Number(css.match(/--slot-w:\s*(\d+)px/)?.[1])
    // The stack's width plus its padding, its stroke, its margin from the safe
    // edge and a gap to the felt, all inside SIDE_RESERVE.
    const padding = 2 * 8 + 2 * 3 + 10
    expect(slotW + padding).toBeLessThanOrEqual(SIDE_RESERVE)
    expect(slotW + padding).toBeGreaterThan(SIDE_RESERVE - 20)
  })
})

// The entry screen is the other screen a phone can be held sideways at, and the
// only one whose chrome — the chip row, the connected-player plate, the live
// strip — is absolutely positioned and therefore reserves nothing. Stacked it
// overflowed a 340px page and ran straight through all three. Same answer as the
// board's, so the same height, and the paddings that clear that chrome are what
// the fix actually is: assert them, not the fact that a media query exists.
describe('the entry screen on its side', () => {
  const lobby = read('components', 'Lobby.svelte')
  const block = lobby.match(
    /@media \(orientation: landscape\) and \(max-height: (\d+)px\)\s*\{([\s\S]*?)\n {2}\}\n/,
  )

  it('turns on the same height the board does', () => {
    expect(block, 'Lobby.svelte must carry a landscape block').toBeTruthy()
    expect(Number(block![1])).toBe(LANDSCAPE_MAX_H - 1)
  })

  it('lays the lockup beside the controls instead of over them', () => {
    const css = block![2]
    expect(css).toMatch(/flex-direction:\s*row/)
    // Four rows of buttons do not fit sideways; two columns of two do.
    expect(css).toMatch(/grid-template-columns:\s*1fr 1fr/)
  })

  it('clears the chip row it draws absolutely, in the tokens and not in a literal', () => {
    const css = block![2]
    expect(css).toMatch(
      /padding-top:\s*calc\(var\(--space-base\) \+ var\(--topbar-h\) \+ var\(--space-sm\) \+ var\(--safe-top\)\)/,
    )
  })

  it('clears the live strip at the foot, and the second plate the narrow end carries', () => {
    expect(block![2]).toMatch(/padding-bottom:\s*calc\(var\(--space-base\) \+ var\(--safe-bottom\)/)
    // Under 46rem the connected-player count moves to the foot and the strip
    // stacks above it (LiveStrip.svelte), so that band is taller.
    const narrow = lobby.match(
      /@media \(orientation: landscape\) and \(max-height: \d+px\) and \(max-width: 46rem\)\s*\{([\s\S]*?)\n {2}\}\n/,
    )
    expect(narrow, 'Lobby.svelte must clear the narrow foot too').toBeTruthy()
    expect(narrow![1]).toMatch(/padding-bottom:\s*calc\(var\(--space-lg\) \+ var\(--safe-bottom\)/)
  })

  it('keeps the mark sizeable from CSS rather than from a literal prop', () => {
    expect(lobby).toMatch(/<LocoLogo size="var\(--lobby-logo\)"/)
    expect(block![2]).toMatch(/--lobby-logo:/)
  })
})

// The queue's two screens have the same shape of problem — one carries the chip
// row and overlapped it, the other simply ran off the bottom — and take the same
// height. A screen that clears the row at the top but centres a column taller
// than the box still puts it under that row: `safe` on both axes is the fix, and
// it is the assertion worth keeping.
describe('the queue on its side', () => {
  const searching = read('components', 'Searching.svelte')
  const found = read('components', 'MatchFound.svelte')
  const block = (src: string) =>
    src.match(/@media \(orientation: landscape\) and \(max-height: (\d+)px\)\s*\{([\s\S]*?)\n {2}\}\n/)

  it('turns on the same height everything else does', () => {
    for (const [name, src] of [['Searching', searching], ['MatchFound', found]] as const) {
      const m = block(src)
      expect(m, `${name}.svelte must carry a landscape block`).toBeTruthy()
      expect(Number(m![1]), name).toBe(LANDSCAPE_MAX_H - 1)
    }
  })

  it('puts the radar beside the words, clear of the chip row, and cannot overflow up into it', () => {
    const css = block(searching)![2]
    expect(css).toMatch(/flex-direction:\s*row/)
    expect(css).toMatch(
      /padding-top:\s*calc\(var\(--space-base\) \+ var\(--topbar-h\) \+ var\(--space-sm\) \+ var\(--safe-top\)\)/,
    )
    expect(css).toMatch(/align-items:\s*safe center/)
    expect(css).toMatch(/justify-content:\s*safe center/)
  })

  it('keeps the reveal inside the page rather than recomposing it', () => {
    const css = block(found)![2]
    // The two cards meeting is the whole screen: it may be squeezed, never
    // turned into two columns.
    expect(css).not.toMatch(/flex-direction:\s*row/)
    expect(css).toMatch(/padding-bottom:\s*calc\(var\(--space-md\) \+ var\(--safe-bottom\)\)/)
  })
})
