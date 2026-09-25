<script lang="ts">
  import { tableTrackEllipse, TABLE_TRACK_WIDTH } from './layout'
  import type { Surface } from './tableSurface'

  type Props = {
    /** The felt's box, in board space: the track runs round the inside of its rim. */
    rect: { left: number; top: number; width: number; height: number }
    /** The rim's material, when a room has one; without it the track is the rim's plain colour. */
    wood?: Surface | null
  }

  let { rect, wood = null }: Props = $props()

  // Concentric with the felt, like the rim's own inner edge (`tableTrackEllipse`).
  const e = $derived(tableTrackEllipse(rect.width, rect.height))
  const W = TABLE_TRACK_WIDTH
</script>

<!--
  The racetrack: a band of the rim's own wood laid round the inside of the
  rim, flush with the cloth, the way a card table carries one. Drawn in the
  ellipse concentric with the felt, like the rim's inner edge, so every line
  round the table is the same kind of oval (`tableTrackEllipse`).

  One ellipse stroked four times, widest first: the dark joint where the wood
  meets the cloth, the metal filet inside it, the wood, and the light on the
  wood. One curve, so the four cannot part.
-->
<svg
  class="track"
  style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px"
  viewBox="0 0 {rect.width} {rect.height}"
  aria-hidden="true"
  data-testid="table-track"
>
  <defs>
    {#if wood}
      <pattern id="trackWood" patternUnits="userSpaceOnUse" width={wood.w} height={wood.h}>
        <image href={wood.uri} width={wood.w} height={wood.h} />
      </pattern>
    {/if}
    <!-- The light on a flush band: the far side catches it, the near side is in its own shade. -->
    <linearGradient id="trackLight" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" class="lightTop" />
      <stop offset="0.5" stop-color="#000" stop-opacity="0" />
      <stop offset="1" class="lightBottom" />
    </linearGradient>
  </defs>
  <ellipse class="joint" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W + 3}px" />
  <ellipse class="filet" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W - 1}px" />
  <ellipse class="wood" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W - 6}px" />
  {#if wood}
    <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W - 6}px" stroke="url(#trackWood)" fill="none" />
  {/if}
  <ellipse class="stain" cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W - 6}px" />
  <ellipse cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} style="stroke-width: {W - 6}px" stroke="url(#trackLight)" fill="none" />
</svg>

<style>
  .track {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }

  ellipse {
    fill: none;
    stroke-linejoin: round;
  }

  /* The seam between the wood and the cloth: a darker note of the wood, never
     the interface's ink (the room's own rule, `inkFor`). */
  .joint {
    stroke: color-mix(in srgb, var(--tbl-rim, var(--table-rim)), #000 70%);
  }

  /* The metal filet set along both edges, the same metal as the bead round the cloth. */
  .filet {
    stroke: color-mix(in srgb, var(--tbl-inlay, var(--table-rim-light)), #000 calc(var(--scene-dark, 0) * 25%));
  }

  .wood {
    stroke: var(--tbl-rim, var(--table-rim));
  }

  /* The band is the rim's wood a shade darker than the rim, the way a
     racetrack is stained to sit below the rail. The hour's dimming rides on
     the same stroke. */
  .stain {
    stroke: rgba(8, 4, 2, calc(0.22 + var(--scene-dark, 0) * 0.16));
  }

  .lightTop {
    stop-color: var(--scene-tint, #ffffff);
    stop-opacity: 0.14;
  }

  .lightBottom {
    stop-color: #000;
    stop-opacity: 0.22;
  }
</style>
