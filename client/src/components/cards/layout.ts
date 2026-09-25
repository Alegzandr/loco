// Pure layout math for the card renderer.
import {
  CARD_W,
  CARD_H,
  HAND_SCALE,
  handCard,
  BOTTOM_RESERVE,
  SEAT_DIMS,
  SEAT_SPECS,
  type SeatSize,
} from './cardTheme'
import { LOOK } from '../scene/look'

/** Vertical space the top chrome (round badge, theme/audio/rules cluster) owns. */
export const TOP_CHROME = 58

/**
 * The device's unusable edges, in CSS pixels (iOS notch, home indicator, and
 * the two side bands a phone held in landscape puts around the screen).
 * Measured by `safeAreaInsets`; zero on every desktop browser.
 */
export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export const NO_INSETS: SafeAreaInsets = { top: 0, right: 0, bottom: 0, left: 0 }

// ─── A phone on its side ────────────────────────────────────────────────────
// Portrait stacks the table: seats, felt, hand, action bar, one above the
// other, and the two chrome bands are a constant 198 pixels of that stack. A
// phone held sideways is ~340 pixels tall with the browser's bar showing, so
// the stack cannot be scaled into it — at the scale that fits, a card is 25
// pixels wide. Landscape is therefore a different *composition*, not a smaller
// one: the seats stand in a column down the left, the action bar becomes a
// stack up the right edge (real chrome, outside the coordinate space like the
// bottom band is in portrait), the felt takes the middle, and the hand runs
// along the bottom edge under it. The mode is decided once, from the element's
// pixel size, and handed to every layout function: the virtual space cannot
// re-derive it, because a short window at scale 0.78 is taller in virtual
// units than a desktop window at scale 1.

/** Below this viewport height, a viewport wider than it is tall is a phone on its side. */
export const LANDSCAPE_MAX_H = 560
/** True for a viewport that gets the landscape composition. Pixels, not virtual units. */
export function isLandscape(width: number, height: number): boolean {
  return width > height && height < LANDSCAPE_MAX_H
}
/**
 * The action stack's band up the right edge, in pixels: the stack's width, its
 * margin from the safe edge, and a gap to the felt. Real chrome, so it does not
 * scale — mirrored by `ActionBar.svelte`'s landscape block, and pinned to it by
 * `landscape.test.ts`.
 */
export const SIDE_RESERVE = 160
/** What sits above the felt in landscape: the round chip and the turn clock. */
export const TOP_CHROME_LANDSCAPE = 44
/** The hand's margin from the bottom of the coordinate space in landscape. */
export const HAND_MARGIN_LANDSCAPE = 8
/**
 * What the chip row reaches into the space in landscape, in virtual units: it
 * is 244 pixels wide from the safe edge against a 160-pixel band, and the
 * space is never scaled below `MIN_BOARD_SCALE`.
 */
const CHIP_ROW_CLEAR = 110
/** The seat column's band down the left edge, in virtual units: a compact pill and its margins. */
export const SEAT_BAND_LANDSCAPE = SEAT_DIMS.compact.w + 2 * 12

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
export function boardScale(width: number, height: number, landscape = false): number {
  if (width <= 0 || height <= 0) return 1
  if (landscape) {
    // The phone reference turned on its side: the same cards, the same seats,
    // fitted against the screen's short axis. Never above 1 — this is a phone.
    const fit = Math.min(width / PHONE_H, height / PHONE_W)
    return Math.min(1, Math.max(MIN_BOARD_SCALE, fit))
  }
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
 *
 * `insets` are the device's safe areas (an iOS notch, a home indicator). The
 * page runs `viewport-fit=cover` so the room's picture reaches every edge of
 * the screen, which means the element we are laying out into is *bigger* than
 * the part of it a player can see and touch. Paint may use those edges; the
 * game may not, so both reserves are measured from the safe edge rather than
 * from the screen edge and the whole coordinate space stops short of them.
 */
export function boardSpace(
  pxWidth: number,
  pxHeight: number,
  scale: number,
  insets: SafeAreaInsets = NO_INSETS,
  landscape = false,
): { width: number; height: number; offsetX: number; offsetY: number } {
  if (landscape) {
    // The chrome that does not scale is up the right edge here (the action
    // stack, `SIDE_RESERVE`) and along the top (the round chip), and nothing
    // is under the hand: it runs along the bottom safe edge itself.
    const offsetY = insets.top + TOP_CHROME_LANDSCAPE * (1 - scale)
    return {
      width: (pxWidth - insets.left - insets.right - SIDE_RESERVE) / scale,
      height: (pxHeight - insets.bottom - offsetY) / scale,
      offsetX: insets.left,
      offsetY,
    }
  }
  const offsetY = insets.top + TOP_CHROME * (1 - scale)
  return {
    width: (pxWidth - insets.left - insets.right) / scale,
    height: (pxHeight - insets.bottom - BOTTOM_RESERVE - offsetY) / scale + BOTTOM_RESERVE,
    offsetX: insets.left,
    offsetY,
  }
}

/** Gap between stacked seat rows. */
const ROW_GAP = 6
/** Minimum breathing room between two seats on the same row. */
const SEAT_GAP = 10
/** Breathing room kept between the outermost seat and the screen edge. */
const SEAT_EDGE = 28
/** Room kept between two name plates round the rim. */
const PLATE_GAP = 8

// ─── A hand, face down ──────────────────────────────────────────────────────
// Every opponent's hand is the real number of backs, fanned the way our own
// is. Where the table has room for everybody (`rimLayout`), each opponent has
// a place on the rim of the felt: their hand lies on the felt in front of
// them, face down, tips towards the middle — put down, the way a hand is left
// on a table — and flattened by the table's perspective, with their name plate
// astride the rim where they sit. Where it has not, they stand in rows above
// the felt holding their hand up (`rowLayout`, `seatColumn`).
//
// Both are one geometry, `seatFan` under a `FanLay`, so that <PlayerSlot />
// draws the backs exactly where the board's fliers land them — a card drawn
// arrives *in its place*, a card played leaves from one, and neither can drift
// from the other.

/**
 * How a hand lies: its tilt in the plane of the screen (radians, 0 held up
 * facing us, π tips down the screen), how much the table's perspective
 * flattens it vertically (1 = not at all), and how wide it may spread.
 */
export interface FanLay {
  rotation: number
  squash: number
  span: number
}

/** A hand held up, facing us, at its seat's full spread. */
export function facingUs(size: SeatSize): FanLay {
  return { rotation: 0, squash: 1, span: SEAT_SPECS[size].maxSpan }
}

/**
 * A back of an opponent's fan: its centre relative to the seat's anchor, its
 * tilt in radians, and the lay's vertical flattening (applied in screen space,
 * after the tilt).
 */
export interface FanCard {
  x: number
  y: number
  rotation: number
  squash: number
}

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** How many backs a seat draws for a hand of `handSize`. */
export function fanCount(size: SeatSize, handSize: number): number {
  return Math.max(0, Math.min(handSize, SEAT_SPECS[size].maxVisible))
}

/**
 * The backs of a hand of `handSize`, laid as `lay` says.
 *
 * The fan is laid out as our own is — spread along x, the outer cards dropping
 * and turning out, the tips up — then turned by `lay.rotation` and flattened
 * by `lay.squash`. The anchor is the middle card's centre. A mini seat has no
 * fan.
 */
export function seatFan(size: SeatSize, handSize: number, lay: FanLay): FanCard[] {
  const spec = SEAT_SPECS[size]
  const card = spec.card
  const k = fanCount(size, handSize)
  if (!card || k === 0) return []
  const spacing = k > 1 ? Math.min(spec.stride, Math.max(0, lay.span) / (k - 1)) : 0
  const maxRot = k > 4 ? 0.24 : k > 1 ? 0.14 : 0
  const drop = card.h * 0.1
  const cos = Math.cos(lay.rotation)
  const sin = Math.sin(lay.rotation)
  return Array.from({ length: k }, (_, i) => {
    const t = k > 1 ? (i / (k - 1)) * 2 - 1 : 0
    const x = (i - (k - 1) / 2) * spacing
    const y = Math.abs(t) * drop
    return {
      x: x * cos - y * sin,
      y: (x * sin + y * cos) * lay.squash,
      rotation: t * maxRot + lay.rotation,
      squash: lay.squash,
    }
  })
}

/** The fan's extent around the anchor, every back's turned and flattened corners included. */
export function fanExtent(size: SeatSize, handSize: number, lay: FanLay): Rect | null {
  const card = SEAT_SPECS[size].card
  const fan = seatFan(size, handSize, lay)
  if (!card || fan.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const c of fan) {
    const ex = Math.abs((card.w / 2) * Math.cos(c.rotation)) + Math.abs((card.h / 2) * Math.sin(c.rotation))
    const ey = (Math.abs((card.w / 2) * Math.sin(c.rotation)) + Math.abs((card.h / 2) * Math.cos(c.rotation))) * c.squash
    minX = Math.min(minX, c.x - ex)
    maxX = Math.max(maxX, c.x + ex)
    minY = Math.min(minY, c.y - ey)
    maxY = Math.max(maxY, c.y + ey)
  }
  return { left: minX, top: minY, width: maxX - minX, height: maxY - minY }
}

/** How much of the fan's foot the plate covers, as a share of a card's height: the plate holds the hand. */
const PLATE_GRIP = 0.4

/**
 * A hand held up: where its name plate's centre sits, relative to the anchor —
 * across the foot of the fan, holding it, the way the hand holding the cards
 * would be. Measured on the fullest fan, so the plate never moves as the hand
 * grows and shrinks.
 */
export function seatPlate(size: SeatSize): { x: number; y: number } {
  const spec = SEAT_SPECS[size]
  const fan = fanExtent(size, spec.maxVisible, facingUs(size))
  if (!fan || !spec.card) return { x: 0, y: 0 }
  return { x: fan.left + fan.width / 2, y: fan.top + fan.height - spec.card.h * PLATE_GRIP + spec.plateH / 2 }
}

/**
 * Everything a seat can ever cover — its plate at `plate` (relative to the
 * anchor) and the fullest fan it draws under `lay` — relative to its anchor.
 * The layout packs with this, so a hand that grows never grows into its
 * neighbour or under the chrome.
 */
export function seatBox(size: SeatSize, lay: FanLay = facingUs(size), plate = seatPlate(size)): Rect {
  const spec = SEAT_SPECS[size]
  const fan = fanExtent(size, spec.maxVisible, lay)
  const left = Math.min(plate.x - spec.plateW / 2, fan?.left ?? Infinity)
  const top = Math.min(plate.y - spec.plateH / 2, fan?.top ?? Infinity)
  const right = Math.max(plate.x + spec.plateW / 2, fan ? fan.left + fan.width : -Infinity)
  const bottom = Math.max(plate.y + spec.plateH / 2, fan ? fan.top + fan.height : -Infinity)
  return { left, top, width: right - left, height: bottom - top }
}

/** One opponent's place at the table. */
export interface SeatPlace {
  /** The anchor: the middle back's centre (the plate's, on a mini seat). */
  x: number
  y: number
  size: SeatSize
  /** How the hand lies. */
  lay: FanLay
  /** The name plate's centre, relative to the anchor. */
  plate: { x: number; y: number }
  /** Whether the hand lies on the felt (a place on the rim) or is held up in a row. */
  onFelt: boolean
  /** What the seat covers, in board coordinates. */
  box: Rect
}

export interface SeatLayout {
  /** In `clockwiseOpponents` order: the next player first. */
  seats: SeatPlace[]
  /** The size most seats are drawn at; the one a crowded table fell back to. */
  size: SeatSize
  /** Vertical space claimed above the felt, measured from y = 0. */
  blockHeight: number
}

/** A seat held up, anchored at (x, y). */
function heldAt(size: SeatSize, x: number, y: number): SeatPlace {
  const lay = facingUs(size)
  const plate = seatPlate(size)
  const b = seatBox(size, lay, plate)
  return { x, y, size, lay, plate, onFelt: false, box: { left: x + b.left, top: y + b.top, width: b.width, height: b.height } }
}

/** A seat held up whose box is centred on (cx, cy). */
function heldByBox(size: SeatSize, cx: number, cy: number): SeatPlace {
  const b = seatBox(size)
  return heldAt(size, cx - (b.left + b.width / 2), cy - (b.top + b.height / 2))
}

/**
 * Places every opponent seat.
 *
 * One function owns this because three callers must agree exactly: the board
 * (which draws the seats), the fliers (which land cards in them) and tableRect
 * (which must not slide the felt under them). When these disagreed, trails
 * flew to empty space and seats sat on the table edge.
 *
 * Three compositions, tried in order:
 * - **A place on the rim** (`rimLayout`): the table the way it is sat at.
 * - **Rows above the felt** (`rowLayout`): a table whose rim cannot fit
 *   everybody's name side by side (a crowded phone).
 * - **A column down the left** in landscape (`seatColumn`).
 */
export function seatLayout(
  opponentCount: number,
  width: number,
  height: number,
  landscape = false,
): SeatLayout {
  if (opponentCount <= 0) return { seats: [], size: 'full', blockHeight: 0 }
  if (landscape) return seatColumn(opponentCount, width, height)
  return rimLayout(opponentCount, width, height) ?? rowLayout(opponentCount, width, height)
}

/** Arc length along the ellipse (a, b) from angle t0 to every one of `STEPS` steps up to t1. */
function arcTable(a: number, b: number, t0: number, t1: number, steps: number): number[] {
  const cum = [0]
  let prev = { x: a * Math.cos(t0), y: b * Math.sin(t0) }
  for (let i = 1; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps
    const next = { x: a * Math.cos(t), y: b * Math.sin(t) }
    cum.push(cum[i - 1] + Math.hypot(next.x - prev.x, next.y - prev.y))
    prev = next
  }
  return cum
}

/** The angle at arc length `target` along a table built by `arcTable`. */
function angleAt(cum: number[], t0: number, t1: number, target: number): number {
  const steps = cum.length - 1
  let j = 1
  while (j < steps && cum[j] < target) j++
  const span = cum[j] - cum[j - 1] || 1
  return t0 + ((t1 - t0) * (j - 1 + (target - cum[j - 1]) / span)) / steps
}

/**
 * Where the first place round the rim would be if everybody at the table sat
 * the same distance apart, us included: one step of an even split of the
 * whole rim into n + 1, taken from our own place at the bottom (angle π/2,
 * y growing down the screen) towards 9 o'clock.
 */
function evenFirstAngle(n: number, a: number, b: number): number {
  const STEPS = 512
  const t0 = Math.PI / 2
  const t1 = Math.PI * 2.5
  const cum = arcTable(a, b, t0, t1, STEPS)
  return angleAt(cum, t0, t1, cum[STEPS] / (n + 1))
}

/**
 * Where the places go round the rim, from `first` (on the left) to its mirror
 * on the right, spaced evenly *along the rim*, not by angle: on a flat oval,
 * evenly spaced angles bunch at the two ends.
 */
function rimAngles(n: number, a: number, b: number, first: number): number[] {
  if (n === 1) return [Math.PI * 1.5]
  const t0 = first
  const t1 = Math.PI * 3 - first
  const STEPS = 256
  const cum = arcTable(a, b, t0, t1, STEPS)
  const total = cum[STEPS]
  return Array.from({ length: n }, (_, i) => angleAt(cum, t0, t1, (total * i) / (n - 1)))
}

/**
 * The first place round the rim, on the left; the last is its mirror.
 *
 * Everybody at the table the same distance apart, us included
 * (`evenFirstAngle`): a crowded table comes down the shoulders towards our
 * end, rather than bunching over the top and leaving an empty stretch of rim
 * either side of us. It comes down only as far as a place stays clear of what
 * the middle and the near end of the table hold — the piles and the arrows
 * round them, the turn pill, our own hand under the pointer — and stays on
 * screen; past that, the places close up over the top. Two opponents sit at
 * the shoulders, never at the far ends, which would put the table between
 * them and nobody.
 */
function firstRimAngle(
  n: number,
  a: number,
  b: number,
  width: number,
  height: number,
  blockHeight: number,
  boxAt: (t: number) => Rect,
  fallback: number,
): number {
  const even = n === 2 ? Math.PI + 0.62 : evenFirstAngle(n, a, b)
  const centre = pileCentre(width, height, blockHeight)
  const ring = directionArrowBox()
  const middle: Rect = {
    left: centre.x - ring / 2 - 12,
    top: centre.y - CARD_H / 2 - 16,
    width: ring + 24,
    height: CARD_H + 32,
  }
  const pill = turnPillPlace(width, height, blockHeight)
  // Our hand, which may run the whole width of the table: a playable card
  // stands up out of it at rest, and nothing may come down into that. A card
  // under the pointer rises further, over whatever is behind it, for as long
  // as it is pointed at.
  const nearEnd = height - handCard().h - BOTTOM_RESERVE - HAND_REST_LIFT
  const pillRect: Rect = { left: pill.centreX - 150, top: pill.top - 8, width: 300, height: TURN_PILL_H + 16 }
  const touches = (r: Rect, o: Rect) =>
    r.left < o.left + o.width && o.left < r.left + r.width && r.top < o.top + o.height && o.top < r.top + r.height
  const clear = (r: Rect) =>
    r.left >= 0 &&
    r.left + r.width <= width &&
    r.top + r.height <= nearEnd &&
    !touches(r, middle) &&
    !touches(r, pillRect)
  for (let t = Math.max(Math.PI / 2 + 0.05, even); t < Math.PI * 1.5; t += 0.01) {
    if (clear(boxAt(t)) && clear(boxAt(Math.PI * 3 - t))) return t
  }
  return fallback
}

/** The flattest the table's perspective lays a hand down: more read as a smear, not a card. */
export const MIN_SQUASH = 0.82

/**
 * A place on the rim for everybody: the table the way it is sat at.
 *
 * Play runs clockwise on screen from our own seat at the bottom — 6 o'clock →
 * 9 → 12 → 3 — so the next player sits at 9 o'clock and the ring goes over the
 * top. Each name plate sits astride the rim where that player is; their hand
 * lies on the felt in front of them, tips towards the middle, flattened by the
 * table's perspective (the felt's own proportion). Tried at the biggest size
 * first; null when even the smaller plates cannot stand side by side, and the
 * rows take over.
 */
function rimLayout(n: number, width: number, height: number): SeatLayout | null {
  const sizes: SeatSize[] = width >= RING_MIN_W ? ['full', 'compact'] : ['compact']
  for (const size of sizes) {
    const spec = SEAT_SPECS[size]
    const card = spec.card!
    // The plate across the top of the rim reaches half its height above it.
    const blockHeight = TOP_CHROME + spec.plateH / 2 + 4
    const felt = tableRect(width, height, blockHeight)
    const a = felt.width / 2
    const b = felt.height / 2
    const cx = felt.left + a
    const cy = felt.top + b
    const squash = Math.max(MIN_SQUASH, Math.min(1, b / a))
    // Where a hand laid down lies, measured in from the rim: wholly on the
    // cloth, inside the rail and the racetrack (`CLOTH_INSET`), the fan's
    // dropped outer cards included — a hand is put down on the table, never
    // across its rail.
    const inset = CLOTH_INSET + card.h * 0.62 + 10
    // The plate sits on the table's edge where the player is: mostly outside
    // the felt, never off the screen.
    const outward = spec.plateH * 0.3
    const plateAt = (t: number) => {
      const nx = Math.cos(t) / a
      const ny = Math.sin(t) / b
      const nl = Math.hypot(nx, ny) || 1
      return {
        x: Math.min(Math.max(cx + a * Math.cos(t) + (nx / nl) * outward, spec.plateW / 2 + 8), width - spec.plateW / 2 - 8),
        y: cy + b * Math.sin(t) + (ny / nl) * outward,
      }
    }
    const placeAt = (t: number, span: number): SeatPlace => {
      // In front of the plate, on the felt.
      const nx = Math.cos(t) / a
      const ny = Math.sin(t) / b
      const nl = Math.hypot(nx, ny) || 1
      // The rail and the racetrack are as wide on every side (`CLOTH_INSET`,
      // both axes); only what lies on the cloth is foreshortened.
      let x = cx + a * Math.cos(t) - (nx / nl) * inset
      let y = cy + b * Math.sin(t) - (ny / nl) * (CLOTH_INSET + (inset - CLOTH_INSET) * squash)
      // Tips towards the middle, judged on the table before its perspective
      // flattens it, so the hand still points at the centre once flattened.
      let rotation = Math.atan2(cx - x, -(cy - y) / squash)
      // A fan spreads along the rim while the rim curves away under it, so
      // the ends of a wide one can still reach the rail: the whole hand is
      // drawn in towards the middle until every corner of the fullest fan
      // it can show is on the cloth.
      const ca = a - CLOTH_INSET
      const cb = b - CLOTH_INSET
      for (let step = 0; step < 40; step++) {
        const worst = Math.max(
          0,
          ...seatFan(size, spec.maxVisible, { rotation, squash, span }).flatMap((c) =>
            [
              [-1, -1],
              [1, -1],
              [1, 1],
              [-1, 1],
            ].map(([sx, sy]) => {
              const lx = (sx * card.w) / 2
              const ly = (sy * card.h) / 2
              const px = x + c.x + lx * Math.cos(c.rotation) - ly * Math.sin(c.rotation)
              const py = y + c.y + (lx * Math.sin(c.rotation) + ly * Math.cos(c.rotation)) * c.squash
              return ((px - cx) / ca) ** 2 + ((py - cy) / cb) ** 2
            }),
          ),
        )
        if (worst <= 1) break
        x -= (nx / nl) * 3
        y -= (ny / nl) * 3 * squash
        rotation = Math.atan2(cx - x, -(cy - y) / squash)
      }
      const lay: FanLay = { rotation, squash, span }
      const p = plateAt(t)
      const plate = { x: p.x - x, y: p.y - y }
      const box = seatBox(size, lay, plate)
      return {
        x,
        y,
        size,
        lay,
        plate,
        onFelt: true,
        box: { left: x + box.left, top: y + box.top, width: box.width, height: box.height },
      }
    }
    // Where the arc stopped before anything else was measured: as far down the
    // shoulders as a hand laid down clears the piles vertically.
    const reach = CARD_H / 2 + inset + card.h * 0.6 + 12
    const fallback = Math.PI + Math.max(n === 2 ? 0.62 : 0.2, Math.asin(Math.min(0.97, Math.max(0.2, reach / b))))
    const first = firstRimAngle(n, a, b, width, height, blockHeight, (t) => placeAt(t, spec.maxSpan).box, fallback)
    const angles = rimAngles(n, a, b, first)
    const plates = angles.map(plateAt)
    // Two names must never touch.
    const crowded = plates.some(
      (p, i) =>
        i > 0 &&
        Math.abs(p.x - plates[i - 1].x) < spec.plateW + PLATE_GAP &&
        Math.abs(p.y - plates[i - 1].y) < spec.plateH + PLATE_GAP,
    )
    if (crowded) continue
    // How far apart two neighbouring hands are where they lie, which is as
    // wide as a hand may spread: in on the cloth they are closer together than
    // their plates on the rim.
    const hands = angles.map((t) => placeAt(t, 0))
    const gap =
      n === 1
        ? Infinity
        : Math.min(
            ...plates.slice(1).map((p, i) => Math.hypot(p.x - plates[i].x, p.y - plates[i].y)),
            ...hands.slice(1).map((h, i) => Math.hypot(h.x - hands[i].x, h.y - hands[i].y)),
          )
    const span = Math.max(0, Math.min(spec.maxSpan, gap * 0.55 - card.w))
    const seats = angles.map((t) => placeAt(t, span))
    return { seats, size, blockHeight }
  }
  return null
}

/** How many seats of `size` fit across one row of `width`. */
function perRow(size: SeatSize, width: number): number {
  const { w } = SEAT_DIMS[size]
  // Big seats also have to clear the screen edges: a row that technically fits
  // but runs into both edges reads as a toolbar, not as players around a
  // table. Mini seats keep the tight margin — they only ever appear when the
  // table is crowded and every pixel counts.
  const edge = size === 'mini' ? SEAT_GAP : SEAT_EDGE
  const available = Math.max(0, width - (w + 2 * edge))
  return 1 + Math.floor(available / (w + SEAT_GAP))
}

/**
 * Rows of seats across the top, centred, with a gentle arc when there is only
 * one. Returns the seats and where the block ends.
 */
function placeRows(
  count: number,
  size: SeatSize,
  width: number,
  height: number,
  top: number,
): { seats: SeatPlace[]; bottom: number } {
  const { w, h } = SEAT_DIMS[size]
  const inRow = Math.max(1, Math.min(count, perRow(size, width)))
  const rows = Math.ceil(count / inRow)
  const playableHeight = Math.max(140, height - BOTTOM_RESERVE)
  // Only a single row gets the arc; stacked rows read better as flat strips.
  const dip = rows > 1 ? 0 : Math.max(14, Math.min(34, playableHeight * 0.06))
  const seats: SeatPlace[] = []
  for (let row = 0; row < rows; row++) {
    const start = row * inRow
    const n = Math.min(inRow, count - start)
    const available = Math.max(0, width - (w + 2 * (size === 'mini' ? SEAT_GAP : SEAT_EDGE)))
    // Seats sit shoulder to shoulder rather than stretching to both screen
    // edges: three opponents pinned to the corners of a 1440px monitor read as
    // three unrelated widgets, not as players around one table.
    const span = n > 1 ? Math.min(available, (n - 1) * (w + SEAT_GAP) * 1.16) : 0
    const left = width / 2 - span / 2
    const cy = top + h / 2 + row * (h + ROW_GAP)
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5
      seats.push(heldByBox(size, n > 1 ? left + t * span : width / 2, cy + (1 - Math.sin(Math.PI * t)) * dip))
    }
  }
  return { seats, bottom: top + rows * h + (rows - 1) * ROW_GAP + dip }
}

/** Felt height below which another row of fans costs the table too much: the piles need it. */
const MIN_FELT_BAND = 300
/** Rows of fanned seats at most, before a table drops to mini seats. */
const MAX_FAN_ROWS = 3
/** A table this narrow never gets the big seats. */
const RING_MIN_W = 720

/**
 * Rows of seats above the felt: the biggest size that fits, wrapping onto
 * extra rows of fans while the felt keeps room for the piles, then mini seats.
 */
function rowLayout(n: number, width: number, height: number): SeatLayout {
  const playable = Math.max(200, height - BOTTOM_RESERVE)
  const blockFor = (size: SeatSize) => {
    const rows = Math.ceil(n / Math.max(1, perRow(size, width)))
    return { rows, block: TOP_CHROME + rows * SEAT_DIMS[size].h + (rows - 1) * ROW_GAP }
  }
  let size: SeatSize = 'mini'
  // Full-size seats are also gated on viewport width: on a phone they crowd
  // the table even when only one opponent is present.
  if (width >= RING_MIN_W && n <= perRow('full', width)) size = 'full'
  else {
    const c = blockFor('compact')
    if (c.rows <= MAX_FAN_ROWS && playable - c.block - 16 >= MIN_FELT_BAND) size = 'compact'
  }
  const { seats, bottom } = placeRows(n, size, width, height, TOP_CHROME)
  return { seats, size, blockHeight: bottom }
}

/**
 * The seats in landscape: a column down the left band, centred on the felt.
 *
 * Order is still the ring's. `clockwiseOpponents` puts the next player first
 * and play runs clockwise on screen — 6 o'clock → 9 → 12 → 3 — so the first
 * seat is the **bottom** of the column and the rest climb from it. A column
 * that does not fit continues along the top of the felt, left to right, which
 * is the same ring carried on; the felt is dropped under that row by
 * `blockHeight`, exactly as a portrait row is. Compact seats while the column
 * holds them, mini when it needs the room.
 */
function seatColumn(n: number, width: number, height: number): SeatLayout {
  const edge = 12
  const felt = tableRect(width, height, 0, true)
  const columnTop = TOP_CHROME_LANDSCAPE + 4
  const columnBottom = felt.top + felt.height
  const perColumn = (size: SeatSize) =>
    Math.max(1, Math.floor((columnBottom - columnTop + ROW_GAP) / (SEAT_DIMS[size].h + ROW_GAP)))
  const size: SeatSize = n <= perColumn('compact') ? 'compact' : 'mini'
  const { w, h } = SEAT_DIMS[size]
  const inColumn = Math.min(n, perColumn(size))
  const overflow = n - inColumn
  // A top row pushes the felt down, and the column is centred on the felt it ends up beside.
  const blockHeight = overflow > 0 ? TOP_CHROME_LANDSCAPE + h + ROW_GAP : 0
  const table = tableRect(width, height, blockHeight, true)
  const columnH = inColumn * h + (inColumn - 1) * ROW_GAP
  const centreY = table.top + table.height / 2
  const top = Math.max(blockHeight + 4 + h / 2, centreY - columnH / 2 + h / 2)
  const x = edge + w / 2
  const seats: SeatPlace[] = []
  for (let i = 0; i < inColumn; i++) {
    seats.push(heldByBox(size, x, top + (inColumn - 1 - i) * (h + ROW_GAP)))
  }
  if (overflow > 0) {
    const rowY = TOP_CHROME_LANDSCAPE + h / 2
    const left = table.left + w / 2
    // The chip row (five 40px chips at the top right, real pixels) reaches
    // past the action stack's band into the space: the row stops short of it.
    const right = Math.min(table.left + table.width, width - CHIP_ROW_CLEAR) - w / 2
    const span = Math.max(0, right - left)
    for (let i = 0; i < overflow; i++) {
      const t = overflow > 1 ? i / (overflow - 1) : 0.5
      seats.push(heldByBox(size, left + t * span, rowY))
    }
  }
  return { seats, size, blockHeight }
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

/** What the hand keeps clear beneath it: the action bar in portrait, a margin in landscape. */
export function handReserve(landscape: boolean): number {
  return landscape ? HAND_MARGIN_LANDSCAPE : BOTTOM_RESERVE
}

// Fan layout for the local hand. (n - 1) cards spaced by `cardSpacing`,
// centred horizontally, with a slight arc and per-card rotation.
export function calcHandSlots(n: number, width: number, height: number, landscape = false): HandSlot[] {
  if (n === 0) return []
  const card = handCard(landscape)
  const baseY = height - card.h - handReserve(landscape)
  const maxSpacing = card.w + 8
  const minSpacing = 20
  // Margin, not padding: the playable glow and ink outline extend past a card's
  // layout box, so a fan sized to the full width looks clipped at both ends.
  const availWidth = width - 56
  const cardSpacing = Math.max(minSpacing, Math.min(maxSpacing, availWidth / n))
  const totalWidth = (n - 1) * cardSpacing + card.w
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
// the `{#each}` reuse the wrong node when a card leaves the middle of the fan,
// and the remaining cards would snap instead of sliding into the gap.
export function handCardKeys(hand: { color: string; kind: string; value?: number }[]): string[] {
  const seen = new Map<string, number>()
  return hand.map((c) => {
    const base = `${c.color}-${c.kind}-${c.value ?? ''}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return `${base}#${n}`
  })
}

/** How far under the felt's top rim the piles stand in landscape. */
const PILE_INSET_LANDSCAPE = 10
/** How far a playable card of our hand stands up out of it at rest (`Hand.svelte`). */
const HAND_REST_LIFT = 9
/** The turn pill's height, `TurnIndicator.svelte`'s `.indicator` at its type size. */
export const TURN_PILL_H = 38

/**
 * Where the turn pill sits, as its top edge and its centre line.
 *
 * Portrait: clear above the hand — clear of a *hovered* card, not only a
 * resting one. The reserve used to be 58px, which covered the pill plus the
 * 9px a playable card lifts at rest and nothing else; the hover in
 * `Hand.svelte` is `scale(1.08) translateY(-14px)` about the card's centre,
 * which carries the top edge a further 14 × 1.08 + 0.04 × CARD_H ≈ 19.4px up,
 * so a card under the pointer put its top ~20px into the pill. The numbers
 * below are that transform written out, so the reserve moves with it.
 *
 * Landscape: the felt ends a hair above the hand, so the pill stands inside
 * the felt, in the band under the piles (`pileTop` raises them for it),
 * centred on the felt rather than on the space.
 */
export function turnPillPlace(
  width: number,
  height: number,
  topReserve = 0,
  landscape = false,
): { top: number; centreX: number } {
  if (landscape) {
    const t = tableRect(width, height, topReserve, landscape)
    // A felt squeezed under a top row of seats is shorter than the piles and
    // the pill together: the pill then rides the bottom rim rather than the
    // piles, and stops a hair short of the hand's top edge.
    const pilesBottom = pileTop(width, height, topReserve, landscape) + CARD_H + 2
    return {
      top: Math.max(t.top + t.height - FELT_RIM - TURN_PILL_H - 4, pilesBottom),
      centreX: t.left + t.width / 2,
    }
  }
  // The hover is drawn inside the hand's scale, so it lifts by that much more.
  const HOVER_LIFT = (14 * 1.08 + 0.04 * CARD_H) * HAND_SCALE
  const CLEARANCE = 8
  return {
    top: height - handCard().h - BOTTOM_RESERVE - Math.ceil(TURN_PILL_H + HAND_REST_LIFT + HOVER_LIFT + CLEARANCE),
    centreX: width / 2,
  }
}

/**
 * Half the width a shout is measured against when it looks for a free band:
 * the interception's plate, the widest of the three, is about 400 board
 * pixels across, and 20 more on each side keep a seat from touching it.
 */
export const SHOUT_HALF_W = 220
/** The shortest band a shout is laid in; below it no gap on the table will do. */
export const SHOUT_BAND_MIN = 120

/**
 * The line the three shouts (LOCO!, the interception, the catch stamp) are
 * centred on, in board coordinates.
 *
 * The shout needs a band of the middle column with no card in it. From the
 * seat block down to our hand, that column is taken by the piles and by
 * every seat that reaches into it, and the shout goes in the tallest gap left,
 * the lower one on a tie. Where the table is sat round its rim the seat across
 * from us is above the piles, so the gap under them wins; where the seats are
 * held up in rows the gap above is the tall one. When no gap is tall enough (a
 * small screen, a phone on its side) the shout goes over the piles, for a
 * second and a half, rather than over anybody's hand, ours least of all: an
 * interception is answered from it.
 */
export function shoutLine(
  width: number,
  height: number,
  seats: SeatPlace[],
  topReserve = 0,
  landscape = false,
): number {
  const t = tableRect(width, height, topReserve, landscape)
  const cx = pileCentreX(width, height, topReserve, landscape)
  const pilesTop = pileTop(width, height, topReserve, landscape)
  const pilesBottom = pilesTop + CARD_H
  const top = Math.max(topReserve, t.top)
  // Down to our hand as it rests (a playable card lifted), which the turn pill
  // is laid over the top of; on a phone on its side the pill is the last thing
  // above the hand.
  const bottom = landscape
    ? turnPillPlace(width, height, topReserve, landscape).top + TURN_PILL_H
    : height - handCard().h - BOTTOM_RESERVE - HAND_REST_LIFT
  const taken = [
    { top: pilesTop, bottom: pilesBottom },
    ...seats
      .filter((s) => s.box.left < cx + SHOUT_HALF_W && s.box.left + s.box.width > cx - SHOUT_HALF_W)
      .map((s) => ({ top: s.box.top, bottom: s.box.top + s.box.height })),
  ].sort((a, b) => a.top - b.top)
  let best = { top: 0, bottom: 0 }
  let y = top
  for (const span of [...taken, { top: bottom, bottom }]) {
    const gap = { top: y, bottom: Math.min(span.top, bottom) }
    if (gap.bottom - gap.top >= best.bottom - best.top) best = gap
    y = Math.max(y, span.bottom)
  }
  if (best.bottom - best.top >= SHOUT_BAND_MIN) return (best.top + best.bottom) / 2
  // Over the piles, as low as the room under them allows: the discard's top
  // edge, where its value is printed, stays in sight when there is room for it.
  return Math.max(pilesTop + CARD_H / 2, Math.min(pilesBottom, bottom - SHOUT_BAND_MIN / 2))
}

/**
 * How far the active-colour chip reaches out past the discard's near-left
 * corner, towards the deck (`DiscardPile.svelte`).
 */
export const PILE_CHIP_REACH = 16

// Horizontal gap between the deck stack and the discard pile. The pair sits
// close in around the middle of the felt, the way two piles are put down on a
// real table: wide enough that the chip, reaching out of the discard towards
// the deck, still clears it, and no wider — at 58 each pile stood off to one
// side and the middle of the table was left empty.
export const PILE_GAP = 32

// Vertical centre shared by the deck and the discard, expressed as the card's
// top edge. Derived from the felt itself rather than from the container, so the
// pair sits in the middle of the table at every size: the table is pushed down
// by the seat block and up by the hand, and a container-centred pair drifted
// into the upper third of the oval on a large screen.
function pileTop(width: number, height: number, topReserve: number, landscape: boolean): number {
  const t = tableRect(width, height, topReserve, landscape)
  // In landscape the felt is only a card and a half tall, and the turn pill has
  // nowhere to go between it and the hand: the pair stands in the upper part of
  // the felt and the pill takes the band under it, inside the rim. A felt
  // squeezed under a top row of seats gives up the inset first, so the pair
  // stands flush under the rim before the pill has to ride over the bottom one.
  if (landscape) {
    const room = t.height - (2 * FELT_RIM + CARD_H + 2 + TURN_PILL_H + 4)
    return t.top + FELT_RIM + Math.max(0, Math.min(PILE_INSET_LANDSCAPE, room))
  }
  return t.top + t.height / 2 - CARD_H / 2
}

// The pair is centred on the felt, not on the space: in landscape the felt is
// pushed right of the seat column, and a pair centred on the space would sit
// on the felt's left rim.
function pileCentreX(width: number, height: number, topReserve: number, landscape: boolean): number {
  const t = tableRect(width, height, topReserve, landscape)
  return t.left + t.width / 2
}

// ─── The piles lie on the felt ───────────────────────────────────────────────
// The deck and the discard are laid down on the table, not stood up facing us:
// each is tipped back about its own centre and seen in perspective, so its far
// edge is narrower than its near one and its thickness shows as a band of
// edges under it. One tilt for both, applied in CSS (`pileTransform`) and
// mirrored here in numbers (`onPile`), so what lands on a pile and what is
// pinned to one agree with what is drawn.

/** How far a pile is tipped back from facing us, in degrees. */
export const PILE_TILT_DEG = 32
/** The perspective distance the tilt is seen from, in board pixels. */
export const PILE_PERSPECTIVE = 600

/** The CSS transform that lays a card-sized box down on the felt, about its centre. */
export function pileTransform(): string {
  return `perspective(${PILE_PERSPECTIVE}px) rotateX(${PILE_TILT_DEG}deg)`
}

/**
 * Where a point of a pile's card box (x, y from its top-left, unlaid) is seen
 * once the pile lies on the felt, in the same box's coordinates. Exactly what
 * `pileTransform()` does about the box's centre.
 */
export function onPile(x: number, y: number): { x: number; y: number } {
  const t = (PILE_TILT_DEG * Math.PI) / 180
  const dx = x - CARD_W / 2
  const dy = y - CARD_H / 2
  const k = PILE_PERSPECTIVE / (PILE_PERSPECTIVE - dy * Math.sin(t))
  return { x: CARD_W / 2 + dx * k, y: CARD_H / 2 + dy * Math.cos(t) * k }
}

/**
 * The highest the felt may start, as a share of the board's height (portrait):
 * what leaves the room's horizon room at `LOOK.vista.camera.horizon` above it
 * inside the lens range, on a board 560 wide or more. `sceneView.test.ts` pins
 * that it does, on monitors.
 */
export const FELT_TOP_MIN = 0.245

/**
 * How flat a card lying on a pile looks: its seen height over its real one.
 * A flier coming down on a pile lands at this `squash`.
 */
export const PILE_SQUASH = (onPile(CARD_W / 2, CARD_H).y - onPile(CARD_W / 2, 0).y) / CARD_H

// Centre of the discard pile, in container coordinates.
// Deck and discard are laid out as one centred pair: deck | gap | discard.
export function discardPosition(
  width: number,
  height: number,
  topReserve = 0,
  landscape = false,
): { x: number; y: number } {
  return {
    x: pileCentreX(width, height, topReserve, landscape) + PILE_GAP / 2,
    y: pileTop(width, height, topReserve, landscape),
  }
}

// Centre of the deck stack (left of discard).
export function deckPosition(
  width: number,
  height: number,
  topReserve = 0,
  landscape = false,
): { x: number; y: number } {
  return {
    x: pileCentreX(width, height, topReserve, landscape) - PILE_GAP / 2 - CARD_W,
    y: pileTop(width, height, topReserve, landscape),
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
  landscape = false,
): { left: number; top: number; width: number; height: number } {
  if (landscape) {
    // The felt takes the whole band between the top chrome and the hand, and
    // the whole width right of the seat column. Flatter than portrait's oval
    // and never taller than the band: the deck and the discard have to stand
    // inside it, and there is no dead space to bias against.
    const top = Math.max(topReserve, TOP_CHROME_LANDSCAPE) + 8
    const bottom = height - CARD_H - HAND_MARGIN_LANDSCAPE - 8
    const h = Math.min(Math.max(bottom - top, 150), 440)
    const avail = Math.max(240, width - SEAT_BAND_LANDSCAPE - 12)
    const w = Math.min(avail, 720, Math.max(h * 2.6, 420))
    return { left: SEAT_BAND_LANDSCAPE + (avail - w) / 2, top, width: w, height: h }
  }
  const playable = Math.max(200, height - BOTTOM_RESERVE)
  // The felt is where everybody sits — every opponent has a place on its rim
  // (`rimLayout`) — so it takes nearly the width, and never more than the
  // viewport: on a phone an unclamped 520px minimum ran the felt off both
  // edges — and a share of it rather than a margin in board units, or a phone
  // whose notch scales the board down would get a *bigger* felt. It runs on
  // behind our own hand, the way the near edge of a real table does.
  const w = Math.min(Math.max(width * 0.78, 520), 1100, width * 0.94)
  const band = Math.max(160, playable - topReserve - 16)
  // Keep the felt an oval, never a circle. A phone gets a rounder table on
  // purpose: the wide oval that reads well on a monitor leaves a dead band of
  // background above and below it on a tall narrow screen.
  const aspect = width < 560 ? 0.95 : 0.66
  // The felt claims the whole band it is given. It took 62% capped at 400px,
  // then 74% capped at 440, and the places round its rim did not fit either.
  const h = Math.min(Math.max(band, 200), 560, w * aspect)
  // Biased above centre inside the space left under the seats: the hand and
  // the action bar crowd from below, so an optically centred table has to sit
  // higher than a mathematically centred one.
  const top = topReserve + 8 + (band - h) * 0.34
  // The room's horizon has to stand above the felt (`scene/view.ts`), with the
  // sky between the seat pills. With the seats on the rim nothing held the
  // felt down, and on a monitor it climbed to 11% of the height: the camera
  // could not put the horizon above it and the room lost its sky. So the felt
  // starts no higher than `FELT_TOP_MIN` and gives up height from its top,
  // never its near edge. A phone upright needs none: its narrow lens already
  // leaves the horizon room over a rounder table.
  const floor = width < 560 ? 0 : Math.min(height * FELT_TOP_MIN, top + h - 200)
  if (top >= floor) return { left: (width - w) / 2, top, width: w, height: h }
  return { left: (width - w) / 2, top: floor, width: w, height: top + h - floor }
}

// ─── The felt, in viewport pixels ───────────────────────────────────────────

export interface FeltAnchor {
  /** Centre of the felt's ellipse, in CSS pixels of the viewport. */
  cx: number
  cy: number
  /** Its semi-axes. */
  rx: number
  ry: number
  /**
   * CSS pixels per board pixel (`boardScale`): what the render needs to draw
   * the rail and the racetrack the widths the board lays hands against
   * (`CLOTH_INSET`). Absent where the felt is not the board's (the rooms
   * page's still), and the render then takes it off the felt's width.
   */
  unit?: number
}

/**
 * Where the felt lands on the screen, for a viewport of `pxWidth × pxHeight`
 * with `opponentCount` opponents at the table.
 *
 * The same four functions the board runs, in the same order, so the answer is
 * the board's to the pixel: the scene engine builds the table top it renders
 * from exactly this ellipse (`scene/view.ts: tableOutline`), and the loading
 * gate renders the room before the board has measured anything, from the
 * viewport and the roster alone. A table top a few pixels off is a felt
 * floating beside the table it is meant to cover.
 */
export function feltInViewport(
  pxWidth: number,
  pxHeight: number,
  opponentCount: number,
  insets: SafeAreaInsets = NO_INSETS,
): FeltAnchor {
  const landscape = isLandscape(pxWidth, pxHeight)
  const scale = boardScale(
    pxWidth - insets.left - insets.right,
    pxHeight - insets.top - insets.bottom,
    landscape,
  )
  const space = boardSpace(pxWidth, pxHeight, scale, insets, landscape)
  const seats = seatLayout(opponentCount, space.width, space.height, landscape)
  const felt = tableRect(space.width, space.height, seats.blockHeight, landscape)
  return {
    cx: space.offsetX + (felt.left + felt.width / 2) * scale,
    cy: space.offsetY + (felt.top + felt.height / 2) * scale,
    rx: (felt.width / 2) * scale,
    ry: (felt.height / 2) * scale,
    unit: scale,
  }
}

// ─── The table's rim and racetrack ──────────────────────────────────────────

/** `.tableOval`'s rim, in board space: the same width all the way round — the box it is given is border-box. */
export const FELT_RIM = 11

/**
 * How much the table's depth is foreshortened on screen, 0-1: the felt is a
 * table seen from a chair, on the ground an oval `LOOK.vista.camera.aspect`
 * times as deep as it is wide (`scene/view.ts`), and on screen this ellipse.
 * What lies *on* the cloth — the mark — is squashed by it. The rim and the
 * racetrack are not: they are ovals round the felt, and ovals round an oval
 * read right only as concentric ellipses (below).
 */
export function feltSquash(width: number, height: number): number {
  if (width <= 0 || height <= 0) return 1
  const k = height / width / LOOK.vista.camera.aspect
  return Math.max(0.2, Math.min(1, k))
}

/**
 * The racetrack: a band of the rim's own wood laid round the inside of the
 * rim, flush with the cloth, the way a card table carries one — this wide, in
 * board pixels (`TableTrack.svelte`).
 */
export const TABLE_TRACK_WIDTH = 30

/**
 * Where the cloth starts, in board space, in from the felt's outer edge: past
 * the rail and the racetrack. The CSS table and the render's
 * (`LOOK.table.rail`) both put it here, and the opponents' hands are laid
 * inside it (`rimLayout`).
 */
export const CLOTH_INSET = FELT_RIM + TABLE_TRACK_WIDTH

/**
 * The racetrack's middle line: **an ellipse concentric with the felt**, both
 * semi-axes taken in by the same amount — exactly how the CSS draws the rim's
 * inner edge, so every line round the table is the same kind of oval.
 *
 * Two other constructions were tried and both read as a bent table. An offset
 * curve (the same distance from the rim along the normal) is not an ellipse:
 * on a flat oval its ends come to points. And drawing the bands in the
 * table's plane and foreshortening them made the gap between two lines swell
 * at the sides and vanish at the near and far edges.
 */
export function tableTrackEllipse(width: number, height: number): { cx: number; cy: number; rx: number; ry: number } {
  const inset = FELT_RIM + TABLE_TRACK_WIDTH / 2
  return {
    cx: width / 2,
    cy: height / 2,
    rx: Math.max(1, width / 2 - inset),
    ry: Math.max(1, height / 2 - inset),
  }
}

// ─── Play direction ─────────────────────────────────────────────────────────

/** The middle of the deck and discard pair, in board space: what the direction's arrows turn round. */
export function pileCentre(width: number, height: number, topReserve = 0, landscape = false): { x: number; y: number } {
  return {
    x: pileCentreX(width, height, topReserve, landscape),
    y: pileTop(width, height, topReserve, landscape) + CARD_H / 2,
  }
}

/** The arrows' circle, board pixels, laid flat: clear of both piles with a hand's width to spare. */
export const DIRECTION_RADIUS = CARD_W + PILE_GAP / 2 + 40
/** How wide each arrow's band is, board pixels. */
export const DIRECTION_BAND = 15
/** How far each arrow runs round the circle, radians: two of them, a gap at the top and the bottom. */
const ARROW_SWEEP = (130 * Math.PI) / 180

/** The box the arrows are drawn in: the circle plus an arrowhead's reach, on every side. */
export function directionArrowBox(r = DIRECTION_RADIUS, w = DIRECTION_BAND): number {
  return 2 * (r + w * 1.1)
}

/**
 * The two arrows that say which way play runs, as SVG paths in a
 * `directionArrowBox()` square with the circle's centre in its middle: one
 * down the right-hand side of the piles and one up the left for a clockwise
 * table, drawn flat and laid on the felt by the component.
 *
 * With y pointing down, a growing angle sweeps clockwise on screen, so
 * `direction = +1` walks the angle up and puts each head at the far end of
 * its arc; -1 walks it down. The seat arc runs 6 o'clock → 9 → 12 → 3 for +1
 * (`clockwiseOpponents`), and these must never say otherwise: an arrow
 * pointing the wrong way is worse than no arrow at all.
 */
export function directionArrows(direction: number, r = DIRECTION_RADIUS, w = DIRECTION_BAND): string[] {
  const flow = direction >= 0 ? 1 : -1
  const c = directionArrowBox(r, w) / 2
  const head = w * 1.7
  const reach = w * 1.05
  const at = (t: number, rad: number) => `${(c + Math.cos(t) * rad).toFixed(1)} ${(c + Math.sin(t) * rad).toFixed(1)}`
  return [0, Math.PI].map((middle) => {
    // Each arrow is centred on its side of the circle and runs with the flow.
    const from = middle - (flow * ARROW_SWEEP) / 2
    const tip = middle + (flow * ARROW_SWEEP) / 2
    const neck = tip - (flow * head) / r
    const steps = 32
    const outer: string[] = []
    const inner: string[] = []
    for (let i = 0; i <= steps; i++) {
      const t = from + ((neck - from) * i) / steps
      outer.push(at(t, r + w / 2))
      inner.push(at(t, r - w / 2))
    }
    return `M ${outer.join(' L ')} L ${at(neck, r + reach)} L ${at(tip, r)} L ${at(neck, r - reach)} L ${inner.reverse().join(' L ')} Z`
  })
}

/**
 * The on-screen anchor for a seat: the middle of our own hand for `myIndex`,
 * otherwise the middle back of that opponent's fan. What a Swap's cards and
 * a penalty fly between when no particular card is meant.
 */
export function seatPosition<T extends PlayerLike>(
  playerIndex: number,
  players: T[],
  myIndex: number,
  width: number,
  height: number,
  landscape = false,
): { x: number; y: number } {
  if (playerIndex === myIndex) {
    return { x: width / 2, y: height - handCard(landscape).h / 2 - (landscape ? HAND_MARGIN_LANDSCAPE : 20) }
  }
  const seat = seatPlaceOf(playerIndex, players, myIndex, width, height, landscape)
  return seat ? { x: seat.x, y: seat.y } : { x: width / 2, y: height / 2 }
}

/** An opponent's place at the table, or null for our own seat or one that is not there. */
export function seatPlaceOf<T extends PlayerLike>(
  playerIndex: number,
  players: T[],
  myIndex: number,
  width: number,
  height: number,
  landscape = false,
): SeatPlace | null {
  const others = clockwiseOpponents(players, myIndex)
  const i = others.findIndex((p) => p.index === playerIndex)
  if (i < 0 || playerIndex === myIndex) return null
  return seatLayout(others.length, width, height, landscape).seats[i] ?? null
}

/** Where one card of a hand sits on the board: its centre, its tilt, and its size. */
export interface CardSpot {
  x: number
  y: number
  rotation: number
  /** A card lying on the felt is flattened by the table's perspective, in screen space. */
  squash?: number
  w: number
  h: number
}

/**
 * Where the backs of a seat's hand of `handSize` sit, in board coordinates —
 * our own hand's slots for `myIndex`, the fan for anybody else. A mini seat
 * has no fan, so its one spot is the plate. The fliers land exactly here,
 * and <PlayerSlot /> draws exactly here.
 */
export function handSpots<T extends PlayerLike>(
  playerIndex: number,
  handSize: number,
  players: T[],
  myIndex: number,
  width: number,
  height: number,
  landscape = false,
): CardSpot[] {
  if (playerIndex === myIndex) {
    const card = handCard(landscape)
    return calcHandSlots(handSize, width, height, landscape).map((s) => ({
      x: s.x + card.w / 2,
      y: s.y + card.h / 2,
      rotation: s.rotation,
      w: card.w,
      h: card.h,
    }))
  }
  const seat = seatPlaceOf(playerIndex, players, myIndex, width, height, landscape)
  if (!seat) return []
  const card = SEAT_SPECS[seat.size].card
  if (!card) return [{ x: seat.x + seat.plate.x, y: seat.y + seat.plate.y, rotation: 0, w: 24, h: 36 }]
  return seatFan(seat.size, handSize, seat.lay).map((c) => ({
    x: seat.x + c.x,
    y: seat.y + c.y,
    rotation: c.rotation,
    squash: c.squash,
    w: card.w,
    h: card.h,
  }))
}
