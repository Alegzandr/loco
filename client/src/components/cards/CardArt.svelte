<script lang="ts">
  // Everything that is painted *inside* a card face.
  //
  // Face, watermark and wild fan all live in the same 1000x1500 space, so they
  // scale as one object and stay in register whatever size the card is drawn at —
  // hand, discard, a flier mid-flight or a 12px mini fan. That space and the card
  // are both 2:3, so expressing it as percentages of the card box reproduces it
  // exactly, rotations included.
  //
  // It used to be one SVG per card, and that was the board's single biggest
  // rendering cost: fifty live copies of the mark's geometry, most of them under a
  // scale animation and so re-filled every frame. The gradients are CSS now and
  // the mark is a shared mask image; see MARK_MASK_URL in cardArtSpace.ts for the
  // measurement and for why it must stay one.
  import type { CardDTO, CardColor } from '../../types/protocol'
  import { SUIT_PAINT, SUIT_ANGLE_DEG } from './cardTheme'
  import { CARD_ART_W as W, CARD_ART_H as H, MARK_MASK_URL } from './cardArtSpace'
  import { FAN, FAN_CY, FAN_W, FAN_H } from './cardGlyphs'

  type Props = { card: CardDTO; class?: string }
  let { card, class: extra = '' }: Props = $props()

  /**
   * The four-suit fan is what "choose a colour" looks like — players read the
   * shape, not a letter — so it belongs to exactly the two cards that ask for one.
   * A GlobalSwitch is wild-coloured but chooses nothing; it keeps the bare black
   * face and its own glyph.
   */
  function showsFan(c: CardDTO): boolean {
    return c.kind === 'wild' || c.kind === 'wild_draw_four'
  }

  /** The suit's face gradient, on the card's own axis. */
  function faceGradient(color: CardColor): string {
    const p = SUIT_PAINT[color]
    return `linear-gradient(${SUIT_ANGLE_DEG}deg, ${p.from}, ${p.to})`
  }

  /** The same gradient run backwards: what the watermark is painted in. */
  function markGradient(color: CardColor): string {
    const p = SUIT_PAINT[color]
    return `linear-gradient(${SUIT_ANGLE_DEG}deg, ${p.mark[0]}, ${p.mark[1]})`
  }

  /**
   * A mini card on the wild's fan: corner to corner, like the reference.
   *
   * `to top right`, and not the angle of the box's diagonal: they are different
   * gradients on anything that is not square, and this one is 164x336. The
   * reference was an SVG `objectBoundingBox` gradient, whose colour bands stay
   * parallel to the *other* diagonal because the unit square is stretched onto the
   * box after the gradient is laid out. CSS's corner keyword does exactly that; an
   * explicit angle keeps its bands perpendicular to itself instead, and swaps the
   * two off-diagonal corners. Caught by eye on `make visual`, which is the only
   * thing that was ever going to catch it.
   */
  function fanGradient(color: Exclude<CardColor, 'wild'>): string {
    const p = SUIT_PAINT[color]
    return `linear-gradient(to top right, ${p.from}, ${p.to})`
  }

  const pct = (n: number, total: number) => `${(n / total) * 100}%`

  const isWild = $derived(showsFan(card))
</script>

<div
  class="art {extra}"
  style="--face: {faceGradient(card.color)}; --mark: {markGradient(
    card.color,
  )}; --mark-mask: {MARK_MASK_URL}"
  aria-hidden="true"
><!-- No line breaks between these: a whitespace text node here lands inside the
     card's own textContent, and a rule card's text is meant to be the single
     corner "L". Same reason as Card.svelte. --><div class="mark"
  ></div>{#if isWild}{#each FAN as f (f.color)}<div
        class="fanCard"
        style="left: {pct(f.cx - FAN_W / 2, W)}; top: {pct(
          FAN_CY - FAN_H / 2,
          H,
        )}; width: {pct(FAN_W, W)}; height: {pct(FAN_H, H)}; transform: rotate({f.rot}deg); --fan: {fanGradient(
          f.color,
        )}"
      ><div class="fanFace"><div class="fanMark"></div></div></div>{/each}{/if}</div>

<style>
  /* Sized in container query units against `.card` (Card.svelte owns the
     `container-type`), which is what keeps the face in register from the 12px
     mini fan up to the showcase's hero shot without a second set of numbers. */

  .art {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* The face gradient. `--face` is set per suit by the component. */
    background: var(--face);
  }

  /* The mark, cropped and tilted, in the face gradient run backwards.
     A mask over a gradient rather than a filled <path>: one cached rasterisation
     shared by every card on screen instead of one per card per frame. See the
     note on MARK_MASK_URL in cardArtSpace.ts for the measurement. Going back to
     a path costs up to 3x the frame rate wherever the raster is done in
     software. */
  .mark {
    position: absolute;
    inset: 0;
    background: var(--mark);
    -webkit-mask-image: var(--mark-mask);
    mask-image: var(--mark-mask);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }

  /* ─── The wild's four-suit fan ─────────────────────────────────────────────
     Four mini cards across the middle band, each stroked in its own suit and
     carrying the same cropped mark inside. Positions come from the component as
     percentages of the art box, which reproduces the old SVG exactly: the art
     space (1000x1500) and the card (72x108) are both 2:3, so the stretch is
     uniform and a CSS rotation lands where the SVG one did. */
  .fanCard {
    position: absolute;
    /* The suit gradient shows through as the stroke; .fanFace covers the middle. */
    background: var(--fan);
    border-radius: 1.5cqw;
    transform-origin: 50% 50%;
  }

  /* Inset by the stroke width, carrying the card's own (near-black) face back
     over the middle. This is how a gradient stroke is drawn without a second
     gradient: paint the whole rect, then cover all but its rim. */
  .fanFace {
    position: absolute;
    inset: 1.8cqw;
    border-radius: 0.9cqw;
    background: var(--face);
    overflow: hidden;
  }

  /* The mark again inside each mini card, at 0.9 opacity like the reference.
     Same shared mask image as the big one: a fifth copy of the path per wild is
     exactly what this change exists to delete. */
  .fanMark {
    position: absolute;
    inset: 0;
    background: var(--fan);
    opacity: 0.9;
    -webkit-mask-image: var(--mark-mask);
    mask-image: var(--mark-mask);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
</style>
