<script lang="ts">
  import { feltInlay } from './layout'

  type Props = {
    /** The felt's box, in board space. */
    rect: { left: number; top: number; width: number; height: number }
    /** The middle of the two piles, in board space: what the medallion is laid round. */
    centre: { x: number; y: number }
  }

  let { rect, centre }: Props = $props()

  const g = $derived(feltInlay(rect, centre))
</script>

<!--
  What makes the cloth a board and not a disc of colour: the lamp's pool on
  its middle, its falling off towards the rail, a thread inlaid round it, and a
  medallion under the piles.

  Every line here is an ellipse concentric with the felt, or one of the same
  proportions round the piles (`feltInlay`): the table's own rule, for the
  table's own reason. Nothing is a texture: two washes and four hairlines.
  Drawn over the rendered table and over the CSS one alike, so the cloth is
  the same cloth whichever of the two carries it.
-->
<svg
  class="inlay"
  style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px"
  viewBox="0 0 {rect.width} {rect.height}"
  aria-hidden="true"
  data-testid="felt-inlay"
>
  <defs>
    <radialGradient id="feltPool" cx="50%" cy="50%" r="50%">
      <stop offset="0" class="poolIn" />
      <stop offset="0.55" class="poolMid" />
      <stop offset="1" class="poolOut" />
    </radialGradient>
    <radialGradient id="feltMedal" cx="50%" cy="50%" r="50%">
      <stop offset="0" class="medalIn" />
      <stop offset="1" class="medalOut" />
    </radialGradient>
  </defs>
  <ellipse class="wash" cx={g.cloth.cx} cy={g.cloth.cy} rx={g.cloth.rx} ry={g.cloth.ry} fill="url(#feltPool)" />
  <ellipse class="thread wide" cx={g.thread.cx} cy={g.thread.cy} rx={g.thread.rx} ry={g.thread.ry} />
  <ellipse class="thread" cx={g.thread.cx} cy={g.thread.cy} rx={g.thread.rx - 7} ry={g.thread.ry - 7} />
  {#each g.studs as s, i (i)}
    <path class="stud" d="M{s.x} {s.y - 7} L{s.x + 11} {s.y} L{s.x} {s.y + 7} L{s.x - 11} {s.y} Z" />
  {/each}
  <ellipse class="medal" cx={g.medal.cx} cy={g.medal.cy} rx={g.medal.rx} ry={g.medal.ry} fill="url(#feltMedal)" />
  <ellipse class="thread wide" cx={g.medal.cx} cy={g.medal.cy} rx={g.medal.rx} ry={g.medal.ry} />
  <ellipse class="thread" cx={g.medal.cx} cy={g.medal.cy} rx={g.medal.rx - 6} ry={g.medal.ry - 6} />
</svg>

<style>
  .inlay {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }

  /* The lamp over the table: its pool in the room's own light, and the cloth
     going down into shade towards the rail. Weaker in the dark, like every
     light the room lends the board. */
  .poolIn {
    stop-color: var(--scene-tint, #ffffff);
    stop-opacity: calc(0.2 - var(--scene-dark, 0) * 0.06);
  }

  .poolMid {
    stop-color: #000;
    stop-opacity: 0;
  }

  .poolOut {
    stop-color: #05020c;
    stop-opacity: 0.4;
  }

  .medalIn {
    stop-color: #05020c;
    stop-opacity: 0.04;
  }

  .medalOut {
    stop-color: #05020c;
    stop-opacity: 0.24;
  }

  /* The thread: the rim's own metal, set into the cloth. */
  .thread {
    fill: none;
    stroke: color-mix(in srgb, var(--tbl-inlay, var(--table-rim-light)), #000 calc(var(--scene-dark, 0) * 25%));
    stroke-width: 1px;
    stroke-opacity: 0.4;
  }

  .thread.wide {
    stroke-width: 2px;
    stroke-opacity: 0.7;
  }

  .stud {
    fill: color-mix(in srgb, var(--tbl-inlay, var(--table-rim-light)), #000 calc(var(--scene-dark, 0) * 25%));
    fill-opacity: 0.8;
  }
</style>
