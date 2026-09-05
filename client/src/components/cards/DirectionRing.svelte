<script lang="ts">
  import { directionMarkers, DIRECTION_MARKER_COUNT } from './layout'

  type Props = {
    /** The felt's box, in board space — the ring is drawn just inside its rim. */
    rect: { left: number; top: number; width: number; height: number }
    /** +1 = clockwise on screen, -1 = counter-clockwise (see directionMarkers). */
    direction: number
    /** Localised "play order: clockwise/counter-clockwise". */
    label: string
  }

  let { rect, direction, label }: Props = $props()

  /** One lap of the chase, ms. Slow: this is ambience, not a countdown. */
  const CHASE_MS = 3200

  const marks = $derived(directionMarkers(rect.width, rect.height, direction))
</script>

<!--
  The ring of chevrons running around the felt that says which way play is moving.

  It is drawn *on the table* rather than as a badge in a corner because the
  question it answers is "who plays after me", and the answer is a direction around
  the seats. A viewer with no controls has to be able to read it from a clip, so the
  chevrons carry their heading statically: the chase animation is the second readout
  of the same fact, never the only one.

  Keyed on `direction` by its parent, so a Reverse remounts it and replays the
  flip-in — the moment the whole card exists for.
-->
<svg
  class="ring"
  style="left: {rect.left}px; top: {rect.top}px; width: {rect.width}px; height: {rect.height}px"
  viewBox="0 0 {rect.width} {rect.height}"
  role="img"
  aria-label={label}
  data-direction={direction >= 0 ? 'cw' : 'ccw'}
  data-testid="direction-ring"
>
  {#each marks as m, i (i)}
    <!-- Staggered along the flow: markers come out of directionMarkers in travel
         order, so a plain index stagger chases the right way round. -->
    <g
      class="chevron"
      transform="translate({m.x} {m.y}) rotate({m.angle})"
      style="animation-delay: {(i * CHASE_MS) / DIRECTION_MARKER_COUNT}ms"
    >
      <!-- Drawn twice, the wider soft pass first: the halo that holds an edge on
           near-black felt, as a stroke rather than a filter — see the style
           block. -->
      <path class="halo" d="M -11 -13 L 4 0 L -11 13" />
      <path d="M -11 -13 L 4 0 L -11 13" />
    </g>
  {/each}
</svg>

<style>
  /* Chevron ring around the felt: the play direction, drawn on the table.
     Positioned on exactly the same box as .tableOval (border-box), with the
     chevrons themselves inset by directionMarkers so they sit just inside the
     rim. Kept outside the felt element on purpose — .tableOval clips its
     overflow, and the glow below extends past the ellipse. */

  .ring {
    position: absolute;
    overflow: visible;
    pointer-events: none;
    /* The reverse: the whole ring turns over, once, on remount. */
    animation: dirFlipIn 0.5s var(--ease-bounce) both;
  }

  .chevron {
    fill: none;
    /* Near-white, barely cooled. A saturated cyan reads as a *coloured* cue on a
       table whose whole colour vocabulary belongs to the suits — the ring has no
       business looking like a card. Size and the chase carry it instead.
       In a map, it takes a *wash* of the room's accent rather than the accent
       itself (85% white): the chevrons have to read as engraved into that table,
       and the rule above still holds: they must not start looking like a suit. */
    stroke: color-mix(in srgb, #ffffff 85%, var(--map-accent, #e6f2fa));
    stroke-width: 5.4;
    stroke-linecap: round;
    stroke-linejoin: round;
    /* Resting state, and the one reduced motion keeps: the heading is in
       the geometry, so a frozen ring still says which way play goes. */
    opacity: 0.36;
    animation: dirChase 3.2s linear infinite;
  }

  /* Just enough light to hold an edge on near-black felt after a stream re-encode
     eats the thin end of a white stroke. Not a neon.

     A second, wider, translucent stroke under the chevron rather than a
     `filter: drop-shadow()` on it: ten chevrons each carried a filter under an
     infinite opacity animation, and a filtered element is re-rasterised on every
     frame its opacity moves, so the ambience was ten blurs a frame for the
     whole match. Two strokes are painted once; the chase then animates the
     group's opacity and nothing else. Same device as the card glyphs' ink pass. */
  .halo {
    stroke: rgba(150, 210, 240, 0.45);
    stroke-width: 11;
  }

  @keyframes dirChase {
    0% {
      opacity: 0.3;
    }
    12% {
      opacity: 0.72;
    }
    38% {
      opacity: 0.3;
    }
    100% {
      opacity: 0.3;
    }
  }

  :root[data-motion="reduce"] .chevron {
    opacity: 0.42;
  }

  /* A Reverse is one of the game's loud moments: the ring flips over and flashes
     before settling into the new heading. */
  @keyframes dirFlipIn {
    from {
      transform: rotateX(70deg) scale(0.94);
      opacity: 0;
    }
    to {
      transform: rotateX(0deg) scale(1);
      opacity: 1;
    }
  }
</style>
