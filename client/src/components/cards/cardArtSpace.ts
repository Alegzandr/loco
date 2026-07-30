// The coordinate space every card face is painted in, and where the mark sits
// inside it. Lives apart from CardArt.tsx so that file exports components only.
//
// Two boxes, deliberately not the same one:
//   • the *card* box, which has the card's own proportions (CARD_W:CARD_H);
//   • the *mark* box, which is landscape and complete in itself.
// The mark is placed inside the card at its own aspect ratio. Stretching it to
// fill the card — which is what happens if you reuse the mark's viewBox as the
// card's, and what the previous portrait mark got away with — turns the duck
// into a goose.
import { SUIT_ANGLE_DEG } from './cardTheme'
import { LOCO_MARK_W, LOCO_MARK_H } from './locoMark'

export const CARD_ART_W = 1000
export const CARD_ART_H = 1500
export const CARD_ART_VIEWBOX = `0 0 ${CARD_ART_W} ${CARD_ART_H}`

// Gradient axis for SUIT_ANGLE_DEG over the card box, in user space. CSS
// measures its angle clockwise from "to top"; SVG wants two points.
const rad = (SUIT_ANGLE_DEG * Math.PI) / 180
const ux = Math.sin(rad)
const uy = -Math.cos(rad)
const half = (Math.abs(CARD_ART_W * ux) + Math.abs(CARD_ART_H * uy)) / 2
export const CARD_AXIS = {
  x1: CARD_ART_W / 2 - ux * half,
  y1: CARD_ART_H / 2 - uy * half,
  x2: CARD_ART_W / 2 + ux * half,
  y2: CARD_ART_H / 2 + uy * half,
}

// ─── On a card, the mark is cropped and tilted ──────────────────────────────
// Everywhere else — logo, favicon, felt — the mark is shown whole. On a card it
// is deliberately not: blown up past the edges and tilted off square, the way
// the reference art does it. That is what makes a card read as a *printed
// object* with artwork running under the value, rather than as a panel with a
// picture centred in it. A landscape drawing sitting politely in the middle of a
// portrait card leaves two dead bands and looks like a placeholder.
const MARK_TILT_DEG = 22
// Chosen so the tilted bounding box overruns the card on both axes: at this
// angle the mark's box is 823 units tall in its own space, so the scale has to
// clear 1500/823 before anything bleeds. Below that the crop silently stops
// being a crop and the dead bands come back.
const MARK_S = 1.95
const tilt = (MARK_TILT_DEG * Math.PI) / 180
const cos = Math.cos(tilt)
const sin = Math.sin(tilt)

/** Card faces, the mini cards on a wild, and the deck back's watermark. */
export const MARK_CROP_TRANSFORM =
  `translate(${CARD_ART_W / 2} ${CARD_ART_H / 2}) rotate(${MARK_TILT_DEG}) ` +
  `scale(${MARK_S}) translate(${-LOCO_MARK_W / 2} ${-LOCO_MARK_H / 2})`

// There is deliberately no whole-mark placement here. Anything drawn in this
// space is on a card, and a card is always the cropped framing — the deck back
// briefly carried both and showed the duck twice at two different angles, which
// reads as a rendering bug. The whole mark belongs to the logo, the favicon and
// the felt, none of which use this space.

// The whole card face works because the watermark is the face gradient run
// backwards — brighter than the card where the card is dark, darker where it is
// light, so it never needs an outline or a tint to stay legible. That only holds
// if both gradients span the *same* line on the card, and the mark is drawn
// inside a rotated, scaled transform — so its axis is the card's axis mapped
// back through that transform, inverse rotation included.
function toMarkSpace(x: number, y: number) {
  const dx = (x - CARD_ART_W / 2) / MARK_S
  const dy = (y - CARD_ART_H / 2) / MARK_S
  return {
    x: dx * cos + dy * sin + LOCO_MARK_W / 2,
    y: -dx * sin + dy * cos + LOCO_MARK_H / 2,
  }
}
const a = toMarkSpace(CARD_AXIS.x1, CARD_AXIS.y1)
const b = toMarkSpace(CARD_AXIS.x2, CARD_AXIS.y2)
export const MARK_AXIS = { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
