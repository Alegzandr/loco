<script lang="ts">
  import { directionArrows, directionArrowBox } from './layout'

  type Props = {
    /** The middle of the deck and discard pair, in board space: what the arrows turn round. */
    centre: { x: number; y: number }
    /** +1 = clockwise on screen, -1 = counter-clockwise (see directionArrows). */
    direction: number
    /** Localised "play order: clockwise/counter-clockwise". */
    label: string
  }

  let { centre, direction, label }: Props = $props()

  const box = directionArrowBox()
  const arrows = $derived(directionArrows(direction))
</script>

<!--
  Which way play runs: two arrows round the piles, laid flat on the felt.

  Round the piles because that is where every eye already is: the question
  it answers is "who plays after me", and the answer is a turn round the
  table, which is what a circle drawn round the middle of it says. A viewer
  with no controls has to read it from a clip, so the heading is in the
  arrowheads and holds still under reduced motion; the slow turn is the second
  readout of the same fact, never the only one.

  Laid on the table in perspective, so the circle is seen the way the piles
  are: the far side smaller, the band's thickness showing under it.
  Translucent: it is a direction, not an object, and the piles and the cards
  thrown on them always win.

  Keyed on `direction` by its parent, so a Reverse remounts it and replays the
  half turn — the moment the whole card exists for.
-->
<div
  class="plane"
  style="left: {centre.x - box / 2}px; top: {centre.y - box / 2}px; width: {box}px; height: {box}px"
  role="img"
  aria-label={label}
  data-direction={direction >= 0 ? 'cw' : 'ccw'}
  data-testid="direction-ring"
>
  <div class="turn" class:ccw={direction < 0}>
    <svg viewBox="0 0 {box} {box}" width={box} height={box} aria-hidden="true">
      <defs>
        <linearGradient id="arrowFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" class="faceHi" />
          <stop offset="1" class="faceLo" />
        </linearGradient>
      </defs>
      {#each arrows as d, i (i)}
        <!-- The band's thickness: the same arrow a little further down the table, in shade. -->
        <path class="side" {d} transform="translate(0 5)" />
        <path class="face" {d} />
        <path class="edge" {d} />
      {/each}
    </svg>
  </div>
</div>

<style>
  /* Laid down on the felt about its own centre, more steeply than a pile: a
     circle this wide at the piles' own tilt reached the seats above and the
     pill below. */
  .plane {
    position: absolute;
    pointer-events: none;
    transform: perspective(900px) rotateX(62deg);
    transform-origin: 50% 50%;
  }

  .turn {
    width: 100%;
    height: 100%;
    transform-origin: 50% 50%;
    /* The half turn a Reverse makes, then the slow turn with the play. Both a
       transform on an element of its own: composited, never a repaint. */
    animation:
      dirReverse 0.7s var(--ease-bounce) both,
      dirDrift 60s linear 0.7s infinite;
  }

  .turn.ccw {
    animation:
      dirReverse 0.7s var(--ease-bounce) both,
      dirDriftBack 60s linear 0.7s infinite;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .side {
    fill: rgba(4, 2, 12, 0.3);
  }

  .face {
    fill: url(#arrowFace);
  }

  /* A light edge round the band: glass catching the room's light. */
  .edge {
    fill: none;
    stroke: color-mix(in srgb, var(--scene-tint, #ffffff) 50%, #ffffff);
    stroke-opacity: 0.4;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  /* Near-white washed with the room's accent: a saturated arrow would read as
     a suit, and the table's whole colour vocabulary belongs to the suits. */
  .faceHi {
    stop-color: color-mix(in srgb, #ffffff 82%, var(--map-accent, #e6f2fa));
    stop-opacity: 0.36;
  }

  .faceLo {
    stop-color: color-mix(in srgb, #ffffff 70%, var(--map-accent, #e6f2fa));
    stop-opacity: 0.18;
  }

  @keyframes dirReverse {
    from {
      transform: rotate(-180deg);
      opacity: 0;
    }
    to {
      transform: rotate(0deg);
      opacity: 1;
    }
  }

  @keyframes dirDrift {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes dirDriftBack {
    to {
      transform: rotate(-360deg);
    }
  }

  /* The heading is in the arrowheads, so still arrows still say which way
     play goes. */
  :root[data-motion="reduce"] .turn {
    animation: none;
  }
</style>
