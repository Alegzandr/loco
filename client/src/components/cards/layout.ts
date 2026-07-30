// Pure layout math for the React renderer.
import { CARD_W, CARD_H, BOTTOM_RESERVE, SEAT_DIMS, SeatSize } from './cardTheme'

export interface OpponentBubblePosition {
  x: number
  y: number
}

// ─── Board scale ────────────────────────────────────────────────────────────
// The whole board is laid out in a fixed coordinate space and then scaled to
// the viewport, exactly like a game canvas. Everything — cards, seats, felt,
// fliers, type — grows by the same factor, so a 1440p monitor shows a bigger
// table rather than the same small table surrounded by background.
//
// The design space is the smallest window we still consider "desktop"; below it
// the scale stays at 1 and the layout falls back to its responsive behaviour
// (which is what phones already use).
const DESIGN_W = 1150
const DESIGN_H = 730

/** Upper bound: past this the felt starts to look like a poster, not a table. */
export const MAX_BOARD_SCALE = 1.6

/**
 * Scale factor between the board's coordinate space and its pixel size.
 *
 * Driven by the *shorter* axis relative to the design space: an ultrawide but
 * short window has no vertical room to spend, and scaling on width alone would
 * push the hand under the action bar.
 */
export function boardScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  const fit = Math.min(width / DESIGN_W, height / DESIGN_H)
  return Math.min(MAX_BOARD_SCALE, Math.max(1, fit))
}

/** Vertical space the top chrome (round badge, theme/audio/rules cluster) owns. */
const TOP_CHROME = 58
/** Gap between stacked seat rows. */
const ROW_GAP = 6
/** Minimum breathing room between two pills on the same row. */
const SEAT_GAP = 10
/** Breathing room kept between the outermost pill and the screen edge. */
const SEAT_EDGE = 28

export interface SeatLayout {
  positions: OpponentBubblePosition[]
  size: SeatSize
  pillW: number
  pillH: number
  /** Total vertical space the seat block occupies, measured from y = 0. */
  blockHeight: number
}

/**
 * Places every opponent seat, choosing the pill size and row count that fit.
 *
 * One function owns this because three callers must agree exactly: the board
 * (which renders the pills), seatPosition (which anchors swap/steal animations
 * to them), and tableRect (which must not slide the felt under them). When
 * these disagreed, trails flew to empty space and pills sat on the table edge.
 *
 * Strategy: take the largest pill size that fits the whole table on one row;
 * if none does, drop to mini pills and wrap onto as many rows as needed.
 */
export function seatLayout(opponentCount: number, width: number, height: number): SeatLayout {
  const order: SeatSize[] = ['full', 'compact', 'mini']

  if (opponentCount <= 0) {
    const d = SEAT_DIMS.full
    return { positions: [], size: 'full', pillW: d.w, pillH: d.h, blockHeight: 0 }
  }

  const fits = (size: SeatSize): number => {
    const { w } = SEAT_DIMS[size]
    // Big pills also have to clear the screen edges: a row that technically fits
    // but runs into both edges reads as a toolbar, not as players around a
    // table. Mini pills keep the tight margin — they only ever appear when the
    // table is crowded and every pixel counts.
    const edge = size === 'mini' ? SEAT_GAP : SEAT_EDGE
    const available = Math.max(0, width - (w + 2 * edge))
    // Number of pills that fit on one row at minimum spacing, plus the first.
    return 1 + Math.floor(available / (w + SEAT_GAP))
  }

  // Full-size pills are also gated on viewport width: on a phone they crowd the
  // table even when only one opponent is present.
  let size: SeatSize = 'mini'
  for (const candidate of order) {
    if (candidate === 'full' && width < 720) continue
    if (opponentCount <= fits(candidate)) {
      size = candidate
      break
    }
  }

  const { w: pillW, h: pillH } = SEAT_DIMS[size]
  const perRow = Math.max(1, Math.min(opponentCount, fits(size)))
  const rows = Math.ceil(opponentCount / perRow)
  const topOffset = TOP_CHROME + pillH / 2
  const playableHeight = Math.max(140, height - BOTTOM_RESERVE)
  // Only a single row gets the arc; stacked rows read better as flat strips.
  const dip = rows > 1 ? 0 : Math.max(14, Math.min(34, playableHeight * 0.06))

  const positions: OpponentBubblePosition[] = []
  for (let row = 0; row < rows; row++) {
    const start = row * perRow
    const count = Math.min(perRow, opponentCount - start)
    const available = Math.max(0, width - (pillW + 2 * (size === 'mini' ? SEAT_GAP : SEAT_EDGE)))
    // Seats sit shoulder to shoulder rather than stretching to both screen
    // edges: three opponents pinned to the corners of a 1440px monitor read as
    // three unrelated widgets, not as players around one table.
    const span = count > 1 ? Math.min(available, (count - 1) * (pillW + SEAT_GAP) * 1.16) : 0
    const left = width / 2 - span / 2
    const rowY = topOffset + row * (pillH + ROW_GAP)
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0.5
      positions.push({
        x: count > 1 ? left + t * span : width / 2,
        y: rowY + (1 - Math.sin(Math.PI * t)) * dip,
      })
    }
  }

  return {
    positions,
    size,
    pillW,
    pillH,
    blockHeight: topOffset + (rows - 1) * (pillH + ROW_GAP) + pillH / 2 + dip,
  }
}

export interface HandSlot {
  x: number
  y: number
  rotation: number
}

interface PlayerLike {
  index: number
  nickname: string
  hand_size: number
  connected?: boolean
}

// Returns opponents in clockwise seat order starting from the player immediately
// after myIndex, so the leftmost bubble in the arc is the next player in turn order.
export function clockwiseOpponents<T extends PlayerLike>(players: T[], myIndex: number): T[] {
  const seatCount = players.reduce((max, p) => Math.max(max, p.index), myIndex) + 1
  return players
    .filter((p) => p.index !== myIndex)
    .sort((a, b) => {
      const aDist = (a.index - myIndex + seatCount) % seatCount
      const bDist = (b.index - myIndex + seatCount) % seatCount
      return aDist - bDist
    })
}

/**
 * Convenience wrapper around seatLayout() for callers that only need the
 * coordinates. Kept as the public name because it is what the board and the
 * animation anchors have always called.
 */
export function opponentBubblePositions(
  opponentCount: number,
  width: number,
  height: number,
): OpponentBubblePosition[] {
  return seatLayout(opponentCount, width, height).positions
}

// Fan layout for the local hand. (n - 1) cards spaced by `cardSpacing`,
// centred horizontally, with a slight arc and per-card rotation.
export function calcHandSlots(n: number, width: number, height: number): HandSlot[] {
  if (n === 0) return []
  const baseY = height - CARD_H - BOTTOM_RESERVE
  const maxSpacing = CARD_W + 8
  const minSpacing = 20
  // Margin, not padding: the playable glow and ink outline extend past a card's
  // layout box, so a fan sized to the full width looks clipped at both ends.
  const availWidth = width - 56
  const cardSpacing = Math.max(minSpacing, Math.min(maxSpacing, availWidth / n))
  const totalWidth = (n - 1) * cardSpacing + CARD_W
  const startX = width / 2 - totalWidth / 2
  const maxRot = Math.min(0.12, 0.25 / Math.max(n, 1))

  return Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0  // -1 to 1
    return {
      x: startX + i * cardSpacing,
      y: baseY + Math.abs(t) * 6,
      rotation: t * maxRot,
    }
  })
}

// Returns one stable key per card in hand order. Cards are value objects, so a
// duplicate pair is disambiguated by occurrence number. Index keys would make
// React reuse the wrong node when a card leaves the middle of the fan, and the
// remaining cards would snap instead of sliding into the gap.
export function handCardKeys(hand: { color: string; kind: string; value?: number }[]): string[] {
  const seen = new Map<string, number>()
  return hand.map((c) => {
    const base = `${c.color}-${c.kind}-${c.value ?? ''}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}#${n}`
  })
}

// Horizontal gap between the deck stack and the discard pile. Wide enough for
// the discard's active-colour ring (11px) and the pending-draw badge to breathe
// without touching the deck.
const PILE_GAP = 58

// Vertical centre shared by the deck and the discard, expressed as the card's
// top edge. Derived from the felt itself rather than from the container, so the
// pair sits in the middle of the table at every size: the table is pushed down
// by the seat block and up by the hand, and a container-centred pair drifted
// into the upper third of the oval on a large screen.
function pileTop(width: number, height: number, topReserve: number): number {
  const t = tableRect(width, height, topReserve)
  return t.top + t.height / 2 - CARD_H / 2
}

// Centre of the discard pile, in container coordinates.
// Deck and discard are laid out as one centred pair: deck | gap | discard.
export function discardPosition(width: number, height: number, topReserve = 0): { x: number; y: number } {
  return {
    x: width / 2 + PILE_GAP / 2,
    y: pileTop(width, height, topReserve),
  }
}

// Centre of the deck stack (left of discard).
export function deckPosition(width: number, height: number, topReserve = 0): { x: number; y: number } {
  return {
    x: width / 2 - PILE_GAP / 2 - CARD_W,
    y: pileTop(width, height, topReserve),
  }
}

// Size and placement of the felt table. Clamped so it stays an elegant oval on
// an ultrawide monitor instead of stretching to a horizon line, and never
// shrinks below the space the deck/discard pair actually needs.
export function tableRect(
  width: number,
  height: number,
  /** Vertical space already claimed by the opponent seats (seatLayout.blockHeight). */
  topReserve = 0,
): { left: number; top: number; width: number; height: number } {
  const playable = Math.max(200, height - BOTTOM_RESERVE)
  // Never wider than the viewport: on a phone an unclamped 520px minimum ran
  // the felt off both edges.
  const w = Math.min(Math.max(width * 0.7, 520), 960, width - 20)
  const band = Math.max(160, playable - topReserve - 16)
  // Keep the felt an oval, never a circle. A phone gets a rounder table on
  // purpose: the wide oval that reads well on a monitor leaves a dead band of
  // background above and below it on a tall narrow screen.
  const aspect = width < 560 ? 0.95 : 0.66
  // The felt claims most of the band it is given. It used to take 62% capped at
  // 400px, which on a large monitor left a third of the play area as bare
  // background above and below the table.
  const h = Math.min(Math.max(band * 0.74, 200), 440, band, w * aspect)
  return {
    left: (width - w) / 2,
    // Biased above centre inside the space left under the seats: the hand and
    // the action bar crowd from below, so an optically centred table has to sit
    // higher than a mathematically centred one.
    top: topReserve + 8 + (band - h) * 0.34,
    width: w,
    height: h,
  }
}

// Returns the on-screen anchor for a seat: the local hand for myIndex,
// otherwise the opponent's bubble centre. Used as the source/sink for swap
// and global_switch trail animations.
export function seatPosition<T extends PlayerLike>(
  playerIndex: number,
  players: T[],
  myIndex: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (playerIndex === myIndex) {
    return { x: width / 2, y: height - CARD_H / 2 - 20 }
  }
  const others = clockwiseOpponents(players, myIndex)
  const positions = seatLayout(others.length, width, height).positions
  const i = others.findIndex((p) => p.index === playerIndex)
  if (i < 0) return { x: width / 2, y: height / 2 }
  return positions[i]
}
