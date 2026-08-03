<script lang="ts">
  import { SUIT_PAINT } from './cardTheme'
  import { MARK_MASK_BOLD_URL } from './cardArtSpace'

  type Props = {
    /** Card width in px. Default 72 (full size). */
    width?: number
    /** Card height in px. Default 108 (full size). */
    height?: number
    /** Border radius in px. Default 5, matching the face. */
    radius?: number
    /** 0..1; the deck stack and mini fans fade the cards behind the top one. */
    opacity?: number
    class?: string
    style?: string
  }

  let {
    width = 72,
    height = 108,
    radius = 5,
    opacity = 1,
    class: extra = '',
    style = '',
  }: Props = $props()

  /** Below this width the mark is a smudge, so a back is painted flat instead. */
  const ART_MIN_W = 26
  const showArt = $derived(width >= ART_MIN_W)
</script>

<!--
  The deck-back visual: the wild card's near-black face, the same LOCO mark
  watermarked into it, and the mark again across the middle in all four suit
  colours at once — the one place the full palette appears, which is what makes a
  face-down card unmistakable in a blurred mini-fan.
-->
<div
  class="back {extra}"
  style="width: {width}px; height: {height}px; border-radius: {radius}px; opacity: {opacity}; {style}"
>
  <!-- The back is a card, so it gets the card framing — the same cropped, tilted
       mark every face carries — and nothing else. Painting the whole mark on top
       of it as well showed the duck twice at two different angles, which reads as
       a rendering bug.

       What makes it a *back* rather than a face is the paint: all four suit
       colours at once. -->
  {#if showArt}
    <div
      class="art"
      aria-hidden="true"
      style="--suit-green: {SUIT_PAINT.green.from}; --suit-blue: {SUIT_PAINT.blue
        .from}; --suit-red: {SUIT_PAINT.red.from}; --suit-yellow: {SUIT_PAINT.yellow
        .from}; --mark-mask: {MARK_MASK_BOLD_URL}"
    ></div>
  {/if}
</div>

<style>
  /* The game's "logo card". The wild card's near-black face with the LOCO mark
     watermarked into it, then the mark again across the middle in all four suit
     colours, so a face-down card is unmistakable even in a blurred mini-fan. */

  .back {
    position: relative;
    background: linear-gradient(35deg, var(--card-back-bg) 0%, var(--card-back-bg-top) 100%);
    /* A near-black card on near-black felt measures 1.3:1 against it, and the ink
       outline is as dark as both — the deck would have no edge at all, and a mini
       fan of eight backs inside an opponent's pill would merge into one bar. The
       light rim is the edge; the ink outline behind it keeps it working on the
       pale seat pills too. */
    box-shadow:
      0 0 0 2px var(--color-stroke),
      inset 0 0 0 1.5px rgba(255, 255, 255, 0.42);
    box-sizing: border-box;
    flex-shrink: 0;
    overflow: hidden;
  }

  /* The mark across the middle, in all four suit colours at once.
     A mask over a gradient rather than a stroked <path>, for the reason spelled
     out in cardArtSpace.ts: backs are the most numerous card art on the board (a
     deck stack plus up to nine per opponent seat) and every one of them used to
     re-fill the mark's geometry on its own. */
  .art {
    position: absolute;
    inset: 0;
    pointer-events: none;
    /* `to top right`, not the angle of the card's diagonal: see fanGradient() in
       CardArt.svelte. The corner keyword is what reproduces the SVG
       `objectBoundingBox` gradient this replaces; an explicit angle swaps the two
       off-diagonal corners. */
    background: linear-gradient(
      to top right,
      var(--suit-green) 0%,
      var(--suit-blue) 34%,
      var(--suit-red) 67%,
      var(--suit-yellow) 100%
    );
    -webkit-mask-image: var(--mark-mask);
    mask-image: var(--mark-mask);
    -webkit-mask-size: 100% 100%;
    mask-size: 100% 100%;
    -webkit-mask-repeat: no-repeat;
    mask-repeat: no-repeat;
  }
</style>
