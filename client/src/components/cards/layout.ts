// Pure layout math for the React renderer.
import { CARD_W, CARD_H, BOTTOM_RESERVE, SEAT_DIMS, SeatSize } from './cardTheme'

export interface OpponentBubblePosition {
  x: number
  y: number
}

/** Vertical space the top chrome (round badge, theme/audio/rules cluster) owns. */
export const TOP_CHROME = 58

// ─── Board scale ────────────────────────────────────────────────────────────
// The whole board is laid out in a fixed coordinate space and then scaled to
// the viewport, exactly like a game canvas. Everything — cards, seats, felt,
// fliers, type — grows by the same factor, so a 1440p monitor shows a bigger
// table rather than the same small table surrounded by background.
//
// The design space is the smallest window we still consider "desktop"; between
// it and the phone reference below, the scale stays at 1 and the layout falls
// back to its responsive behaviour.
const DESIGN_W = 1240
const DESIGN_H = 790

// Phone reference: the screen the current card/seat sizes were drawn for. A
// narrower or shorter phone scales the whole board down instead of showing the
// same objects cropped — the elements were "trop gros, trop in" on small
// screens, and shrinking the coordinate space keeps every proportion intact.
const PHONE_W = 405
const PHONE_H = 830
/** Below this width we are on a phone and the board may shrink. */
const PHONE_MAX_W = 560

/** Upper bound: past this the felt starts to look like a poster, not a table. */
export const MAX_BOARD_SCALE = 1.45
/** Lower bound: past this the suit glyphs stop reading at arm's length. */
export const MIN_BOARD_SCALE = 0.78

/**
 * Scale factor between the board's coordinate space and its pixel size.
 *
 * Driven by the *shorter* axis relative to the reference space: an ultrawide but
 * short window has no vertical room to spend, and scaling on width alone would
 * push the hand under the action bar.
 */
export function boardScale(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  if (width < PHONE_MAX_W) {
    const fit = Math.min(width / PHONE_W, height / PHONE_H)
    return Math.min(1, Math.max(MIN_BOARD_SCALE, fit))
  }
  const fit = Math.min(width / DESIGN_W, height / DESIGN_H)
  return Math.min(MAX_BOARD_SCALE, Math.max(1, fit))
}

/**
 * Virtual size of the board's coordinate space, plus the pixel offset the stage
 * must be translated by.
 *
 * Not simply `px / scale`. The board is bracketed by two bands of **real
 * chrome** that do not scale with it: the round badge / theme / audio / rules
 * cluster on top (`TOP_CHROME`) and the action bar at the bottom
 * (`BOTTOM_RESERVE`). Both reserves therefore have to stay constant in
 * *pixels*. Scaling them along with everything else shrinks them on a phone —
 * seats slide under the buttons and the hand under the action bar — and
 * inflates them on a monitor into two bands nothing is allowed to use.
 *
 * `offsetY` pins the top band; the height is then solved so the bottom one
 * lands exactly on the action bar.
 */
export function boardSpace(
  pxWidth: number,
  pxHeight: number,
  scale: number,
): { width: number; height: number; offsetY: number } {
  const offsetY = TOP_CHROME * (1 - scale)
  return {
    width: pxWidth / scale,
    height: (pxHeight - BOTTOM_RESERVE - offsetY) / scale + BOTTOM_RESERVE,
    offsetY,
  }
}

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

// ─── Play direction ─────────────────────────────────────────────────────────

export interface DirectionMarker {
  x: number
  y: number
  /** Heading of the flow at that point, in **degrees** (SVG rotate takes degrees). */
  angle: number
}

/**
 * Chevrons laid around the felt. Enough to read as a ring, few enough to stay
 * chunky — and deliberately not twelve, which on the phone's near-circular felt
 * turns the table into a clock face.
 */
export const DIRECTION_MARKER_COUNT = 10
/** Distance kept between each chevron and the felt's rim, measured along the normal. */
export const DIRECTION_RING_INSET = 26
/** `.tableOval`'s border width, in board space — the box it is given is border-box. */
const FELT_RIM = 11

/**
 * Chevrons running around the felt, one per step of the ring, each already
 * turned to face the way play is moving.
 *
 * The seat arc puts the next player at the *left* end of the top row and the
 * previous one at the right, so a table flows 6 o'clock → 9 → 12 → 3: with
 * `direction = +1` the play order is **clockwise on screen**, which is what
 * `clockwiseOpponents` is named after. The ring must never contradict that —
 * an arrow pointing the wrong way is worse than no arrow at all.
 *
 * Markers come out in flow order, so a chase animation only has to stagger them
 * by index to travel the right way round.
 */
export function directionMarkers(
  width: number,
  height: number,
  direction: number,
  count = DIRECTION_MARKER_COUNT,
): DirectionMarker[] {
  // The felt is a flat oval, and both of the obvious shortcuts only work on a
  // circle: evenly-spaced *parametric* angles bunch the chevrons at the two
  // ends, and shrinking both semi-axes by the inset is not an offset curve —
  // it drifts inward wherever the curvature is low. So: walk the rim by arc
  // length, then step off it along the normal.
  const a = Math.max(1, width / 2 - FELT_RIM)
  const b = Math.max(1, height / 2 - FELT_RIM)
  // With y pointing down, a growing parametric angle sweeps clockwise, which is
  // already the +1 case; -1 simply walks the same ellipse backwards.
  const flow = direction >= 0 ? 1 : -1
  const inset = Math.min(DIRECTION_RING_INSET, Math.min(a, b) * 0.45)

  // The chevrons sit on the *offset* curve, so that is the curve to walk by arc
  // length: spacing them evenly on the rim and then stepping inward pulls them
  // together again wherever the rim bends hardest, i.e. at the two ends.
  const pointAt = (t: number) => {
    const cos = Math.cos(t)
    const sin = Math.sin(t)
    // Outward normal of x²/a² + y²/b² = 1 — the gradient, normalised.
    const gx = cos / a
    const gy = sin / b
    const g = Math.hypot(gx, gy) || 1
    return {
      x: width / 2 + a * cos - (inset * gx) / g,
      y: height / 2 + b * sin - (inset * gy) / g,
    }
  }
  const angleAt = arcLengthSampler(pointAt)

  return Array.from({ length: count }, (_, i) => {
    const t = flow * angleAt(i / count)
    // Tangent of (a·cos t, b·sin t), taken in the direction of travel. The
    // offset curve is parallel to the rim, so it shares the heading.
    const dx = flow * -a * Math.sin(t)
    const dy = flow * b * Math.cos(t)
    return {
      ...pointAt(t),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    }
  })
}

/**
 * Returns `fraction of the perimeter → parametric angle` for a closed curve, so
 * callers can space things by arc length. Sampled rather than solved: an
 * ellipse's arc length has no closed form to begin with, and this runs once per
 * board render with the felt's dimensions, not per frame.
 */
function arcLengthSampler(
  pointAt: (t: number) => { x: number; y: number },
): (fraction: number) => number {
  const STEPS = 512
  const cumulative = [0]
  let prev = pointAt(0)
  for (let i = 1; i <= STEPS; i++) {
    const next = pointAt((i / STEPS) * Math.PI * 2)
    cumulative.push(cumulative[i - 1] + Math.hypot(next.x - prev.x, next.y - prev.y))
    prev = next
  }
  const total = cumulative[STEPS]
  return (fraction) => {
    const target = fraction * total
    let lo = 0
    let hi = STEPS
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (cumulative[mid] < target) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return 0
    // Linear interpolation inside the step the target landed in.
    const span = cumulative[lo] - cumulative[lo - 1]
    const frac = span > 0 ? (target - cumulative[lo - 1]) / span : 0
    return ((lo - 1 + frac) / STEPS) * Math.PI * 2
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
