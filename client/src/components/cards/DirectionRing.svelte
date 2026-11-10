<script lang="ts">
  import { directionArrows, directionArrowBox, ARROW_SWEEP, DIRECTION_RADIUS } from './layout'

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
  // Where each arrow starts and where it points, on the circle: the line its
  // light runs along, faint at the tail and full at the head: the same sweep
  // `directionArrows` draws, centred on each side of the piles.
  const SWEEP = ARROW_SWEEP
  const runs = $derived(
    [0, Math.PI].map((middle) => {
      const flow = direction >= 0 ? 1 : -1
      const at = (t: number) => ({ x: box / 2 + Math.cos(t) * DIRECTION_RADIUS, y: box / 2 + Math.sin(t) * DIRECTION_RADIUS })
      return { from: at(middle - (flow * SWEEP) / 2), tip: at(middle + (flow * SWEEP) / 2) }
    }),
  )
</script>

<!--
  Which way play runs: two arrows round the piles, laid flat on the felt.

  Round the piles because that is where every eye already is: the question
  it answers is "who plays after me", and the answer is a turn round the
  table, which is what a circle drawn round the middle of it says. A viewer
  with no controls has to read it from a clip, so the heading is in the
  arrowheads and holds still under reduced motion; the arrows running that
  way is the second readout of the same fact, never the only one.

  Laid on the table in perspective, so the circle is seen the way the piles
  are: the far side smaller. Each arrow is a stroke of light on the cloth,
  nothing at its tail and full at its head, so the heading is said twice: by
  the head's shape and by which end is lit. An even translucent band with a
  shaded copy under it for thickness was what this was, and round the piles
  it read as a grey smudge rather than as a direction. It is still a
  direction and not an object: the piles and the cards thrown on them always
  win.

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
        {#each runs as run, i (i)}
          <linearGradient id="arrowRun{i}" gradientUnits="userSpaceOnUse" x1={run.from.x} y1={run.from.y} x2={run.tip.x} y2={run.tip.y}>
            <stop offset="0" class="tail" />
            <stop offset="0.55" class="body" />
            <stop offset="1" class="head" />
          </linearGradient>
        {/each}
      </defs>
      {#each arrows as d, i (i)}
        <path class="face" {d} fill="url(#arrowRun{i})" />
        <path class="edge" {d} stroke="url(#arrowRun{i})" />
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
    /* The half turn a Reverse makes, then the arrows running a few degrees
       the way the play runs, over and over: lit as they set off, gone before
       they snap back. A transform and an opacity on an element of its own:
       composited, never a repaint. A full slow turn was what this did, and
       it carried both heads behind the piles for most of every minute. */
    animation:
      dirReverse 0.7s var(--ease-bounce) both,
      dirFlow 3.6s linear 0.7s infinite;
  }

  .turn.ccw {
    animation:
      dirReverse 0.7s var(--ease-bounce) both,
      dirFlowBack 3.6s linear 0.7s infinite;
  }

  svg {
    display: block;
    overflow: visible;
  }

  .face {
    fill-opacity: 0.5;
  }

  /* The same run of light as a line round the stroke: what keeps the head
     crisp on a pale cloth and under a rain. */
  .edge {
    fill: none;
    stroke-width: 1.5;
    stroke-linejoin: round;
  }

  /* Near-white washed with the room's accent: a saturated arrow would read as
     a suit, and the table's whole colour vocabulary belongs to the suits. */
  .tail,
  .body,
  .head {
    stop-color: color-mix(in srgb, #ffffff 78%, var(--map-accent, #e6f2fa));
  }

  .tail {
    stop-opacity: 0;
  }

  .body {
    stop-opacity: 0.42;
  }

  .head {
    stop-opacity: 0.95;
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

  @keyframes dirFlow {
    0% {
      transform: rotate(-7deg);
      opacity: 0;
    }
    20%,
    70% {
      opacity: 1;
    }
    100% {
      transform: rotate(7deg);
      opacity: 0;
    }
  }

  @keyframes dirFlowBack {
    0% {
      transform: rotate(7deg);
      opacity: 0;
    }
    20%,
    70% {
      opacity: 1;
    }
    100% {
      transform: rotate(-7deg);
      opacity: 0;
    }
  }

  /* The heading is in the arrowheads, so still arrows still say which way
     play goes. */
  :root[data-motion="reduce"] .turn {
    animation: none;
  }
</style>
