<script lang="ts">
  import { SUIT_PAINT } from './cards/cardTheme'
  import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX, LOCO_MARK_BOLD_STROKE } from './cards/locoMark'

  // A type alias rather than an interface, and it stays one: TypeScript gives an
  // object type an implicit index signature and an interface none, which is what
  // lets these props satisfy a `Record<string, unknown>`. The bridge that needed
  // that is gone; `Base.astro` still hands the logo through as loose props.
  type Props = {
    /**
     * Type size the whole logo is built from, as a CSS length. The card, the gaps,
     * the ink stroke and the shadow are all `em` of it, so the logo scales as one
     * drawing rather than as a picture next to some text.
     */
    size?: string
    /** Stacks the card above the word — for narrow spaces. */
    stacked?: boolean
    /** Lobby hero only: the slow idle breathe. */
    animated?: boolean
    class?: string
  }

  let { size, stacked = false, animated = false, class: extra = '' }: Props = $props()

  // Two layouts render this twice on one page (the content pages' header and
  // their drawer), and a gradient is referenced by id: without one id per
  // instance the second logo paints with the first one's fill, or with nothing.
  const uid = $props.id()
</script>

<!--
  One image, not a drawing next to a word. WCAG exempts a logotype from the
  contrast rules, and the wordmark is one: LOCO Red carries an ink outline that a
  checker reads as the foreground on a dark canvas (1.07:1) and reads past on a
  light one, so the same drawing was failing an audit written for prose.
  `role="img"` says what it actually is, and the label is the word itself — which
  is also what a screen reader owed the mark beside it.
-->
<div
  class="logo {extra}"
  class:stacked
  class:animated
  style={size ? `font-size: ${size}` : undefined}
  role="img"
  aria-label="LOCO!"
>
  <svg class="mark" viewBox={LOCO_MARK_VIEWBOX} aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="{uid}-suits" gradientUnits="objectBoundingBox" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0" stop-color={SUIT_PAINT.green.from} />
        <stop offset="0.34" stop-color={SUIT_PAINT.blue.from} />
        <stop offset="0.67" stop-color={SUIT_PAINT.red.from} />
        <stop offset="1" stop-color={SUIT_PAINT.yellow.from} />
      </linearGradient>
    </defs>
    <!--
      Two passes, widest first: the ink outline every raised object in this UI
      carries, then the mark over it. `paint-order` would do it in one path, but
      the outline has to be *outside* the shape only, and a centred stroke on an
      even-odd wireframe eats its own facets.
    -->
    <path
      d={LOCO_MARK_PATH}
      fill-rule="evenodd"
      fill="var(--color-stroke)"
      stroke="var(--color-stroke)"
      stroke-width={LOCO_MARK_BOLD_STROKE + 12}
      stroke-linejoin="round"
    />
    <path
      d={LOCO_MARK_PATH}
      fill-rule="evenodd"
      fill="url(#{uid}-suits)"
      stroke="url(#{uid}-suits)"
      stroke-width={LOCO_MARK_BOLD_STROKE}
      stroke-linejoin="round"
    />
  </svg>
  <!-- The label above already says it; a second announcement would be the word twice. -->
  <span class="word" aria-hidden="true">LOCO!</span>
</div>

<style>
  /* Everything is `em` of the caller's font-size, so one component serves the
     lobby hero, the waiting room header and the game-over card without a second
     set of numbers. */

  .logo {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.2em;
    font-size: 72px;
    line-height: 1;
  }

  .stacked {
    flex-direction: column;
    gap: 0.14em;
  }

  /* The mark is a closed drawing, so it stands on its own — no frame, no plaque.
     Sized off the type it sits beside and tilted the same few degrees the rest of
     the UI's stickers are, so it reads as an object rather than as clip art. */
  .mark {
    display: block;
    height: 1.05em;
    width: calc(1.05em * 712 / 576); /* the mark's own proportions */
    flex-shrink: 0;
    overflow: visible;
    transform: rotate(-5deg);
    filter: drop-shadow(0 0.06em 0 var(--color-stroke))
      drop-shadow(0 0.13em 0.13em rgba(20, 8, 45, 0.3));
  }

  .stacked .mark {
    height: 1.35em;
    width: calc(1.35em * 712 / 576);
  }

  .word {
    font: 700 1em / 1 var(--font-display);
    letter-spacing: -0.045em;
    color: var(--color-primary);
    /* No stroke on the word itself: the outline is painted by the ::before
       below, for the reason written there. */
    position: relative;
    paint-order: stroke fill;
    text-shadow:
      0 0.07em 0 var(--color-stroke),
      0 0.14em 0 rgba(36, 21, 70, 0.35),
      0 0.25em 0.3em rgba(36, 21, 70, 0.3);
  }

  /*
   * The ink outline, drawn by a pseudo-element instead of by the word.
   *
   * A contrast checker reads `-webkit-text-stroke` as the colour of the text, not
   * as an edge around it, and on this canvas the outline and the canvas are both
   * near-black: the checker scored the wordmark at 1.07:1 and failed every page
   * of the site on a logotype WCAG exempts by name. LOCO Red against the canvas
   * is 5.4:1 and passes on its own, so the word carries no stroke and a ::before
   * painted over it carries the outline — the same two passes, the same drawing,
   * and nothing for the checker to measure but the red. `a11y.test.ts` pins
   * the pair: no stroke on the word, the outline on the pseudo-element.
   */
  .word::before {
    /* The empty alt keeps the word out of the accessibility tree: the logo names
       itself once, on the element that carries `role="img"`. */
    content: 'LOCO!' / '';
    position: absolute;
    inset: 0;
    color: inherit;
    -webkit-text-stroke: 0.07em var(--color-stroke);
    paint-order: stroke fill;
    /* The word underneath already casts it; a second copy would double the soft
       drop. */
    text-shadow: none;
  }

  .animated {
    animation: logoBreathe 4.5s ease-in-out infinite;
  }

  @keyframes logoBreathe {
    0%,
    100% {
      transform: rotate(-2deg) scale(1);
    }
    50% {
      transform: rotate(-2deg) scale(1.028);
    }
  }

  :root[data-motion="reduce"] .animated {
    animation: none;
    transform: rotate(-2deg);
  }
</style>
