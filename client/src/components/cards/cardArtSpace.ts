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
import {
  LOCO_MARK_W,
  LOCO_MARK_H,
  LOCO_MARK_PATH,
  LOCO_MARK_BOLD_STROKE,
} from './locoMark'

export const CARD_ART_W = 1000
export const CARD_ART_H = 1500
export const CARD_ART_VIEWBOX = `0 0 ${CARD_ART_W} ${CARD_ART_H}`

// The face and the watermark are painted by CSS gradients in the card's own
// box, so there is no SVG gradient axis to solve for any more: CSS measures its
// angle clockwise from "to top", which is exactly how SUIT_ANGLE_DEG is defined,
// and it lays the gradient line across the box's corners on its own.

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
// if both gradients span the *same* line on the card.
//
// Which is why the mark is painted as a *mask* over a gradient in card space,
// rather than as a filled path inside the rotated, scaled transform below. Drawn
// the second way, the mark's gradient lives in the mark's own space and its axis
// has to be the card's axis mapped back through the crop, inverse rotation
// included. Drawn as a mask, the crop applies to the shape alone and the
// gradient never leaves card space, so "the face gradient run backwards" is
// literally `linear-gradient(SUIT_ANGLE_DEG, …)` with the stops swapped.
//
// The other half of why it is a mask is cost, and it is measured. A card face is
// on screen up to fifty times at once (hand, piles, every opponent's fan) and
// most of them are under a scale animation, which re-rasterises them every
// frame. As a live <path> that meant re-filling this geometry (130-odd
// segments, even-odd, under a gradient) fifty times a frame. As a mask it is
// one image, identical for every card, so the browser rasterises the path once
// per used size and every card composites the same cached bitmap.
//
// Measured on the showcase, median of five runs, driving the hand to keep the
// animations alive. The cost is in rasterisation, so it shows up in proportion
// to how much of the raster the CPU is doing:
//   • Firefox under software rendering: 3.0 -> 9.8 fps on a full hand,
//     4.7 -> 14.9 on a map. Between 2.3x and 3.3x depending on the scene.
//   • Chromium throttled 6x on CPU: 55 -> 59 fps, and already at the vsync
//     ceiling on the other scenes, because that throttle constrains script far more
//     than raster, so it barely sees this.
// Keep it a mask. On a machine compositing in software this is a 3x regression,
// and nothing in the test suite can see it happen.
const MARK_MASK_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CARD_ART_VIEWBOX}" preserveAspectRatio="none">` +
  `<g transform="${MARK_CROP_TRANSFORM}">` +
  `<path d="${LOCO_MARK_PATH}" fill-rule="evenodd" fill="#fff"/>` +
  `</g></svg>`

/**
 * The cropped, tilted mark as a CSS mask image, in the card's own box.
 *
 * One string for the whole app on purpose: the browser's image cache is keyed on
 * the URL, so every card that uses this shares one rasterisation. Building it
 * per card (or per suit) would hand back exactly the cost this replaces.
 */
export const MARK_MASK_URL = `url("data:image/svg+xml,${encodeURIComponent(MARK_MASK_SVG)}")`

// The deck back wants the same crop at the logo's weight, see
// LOCO_MARK_BOLD_STROKE: a back is drawn at 26px in an opponent's fan far more
// often than at full size, and the bare bars close up long before the
// silhouette does. Weight is a rendering parameter, so it is the same geometry
// stroked, not a second path; that makes it a second mask image rather than a
// variant of the first. Two cached rasterisations for the whole board is the
// point: backs outnumber faces on a busy table.
const MARK_MASK_BOLD_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CARD_ART_VIEWBOX}" preserveAspectRatio="none">` +
  `<g transform="${MARK_CROP_TRANSFORM}">` +
  `<path d="${LOCO_MARK_PATH}" fill-rule="evenodd" fill="#fff" stroke="#fff"` +
  ` stroke-width="${LOCO_MARK_BOLD_STROKE}" stroke-linejoin="round"/>` +
  `</g></svg>`

/** The cropped mark at the logo's weight, as a CSS mask image. */
export const MARK_MASK_BOLD_URL = `url("data:image/svg+xml,${encodeURIComponent(MARK_MASK_BOLD_SVG)}")`
