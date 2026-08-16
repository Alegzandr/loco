<script lang="ts">
  /**
   * The four ways a match ends, drawn.
   *
   * This was four emoji in a nested ternary (🏆 / 😔 / 🏳️ / 🚪), which broke
   * two rules at once. Every other glyph in this game is a path we own
   * (`SuitMark`, `CardGlyph`, the ✕ the three sheets share), and an emoji is
   * whatever the reader's OS decided: the trophy is gold on one platform and
   * grey on another, `🏳️` carries a variation selector that Android and Windows
   * disagree about, and none of them can be given the ink outline and the hard
   * bottom shadow that make every raised object here read as a physical thing.
   * On the one screen most likely to be clipped for a stream, the mark was the
   * only part of the frame this repository did not draw.
   *
   * So the four are drawn in the game's own vocabulary rather than in a picture
   * library's. Winning is the mark itself, in the gold the scoreboard wins in.
   * Losing is the cards still in your hand, which is literally what lost the
   * round. A forfeit is a card face-down: somebody put theirs down and left, and
   * the arrow says which side of it we are on. No trophy, and no face. A losing
   * screen that draws a sad face is telling the player how to feel about a card
   * game, and the quiet version reads better at 720p anyway.
   */
  import { LOCO_MARK_PATH, LOCO_MARK_VIEWBOX, LOCO_MARK_BOLD_STROKE } from './cards/locoMark'

  export type Outcome = 'win' | 'loss' | 'forfeitWon' | 'forfeitLeft'

  type Props = {
    outcome: Outcome
    /**
     * `lg` heads the game-over card; `sm` sits on the round summary's winner
     * line. One drawing at two sizes rather than two drawings, so "won" looks
     * the same after a round as it does after a match, and the small one holds
     * still, because a glyph inside a line of type that bobs takes the sentence
     * with it.
     */
    size?: 'lg' | 'sm'
  }
  let { outcome, size = 'lg' }: Props = $props()

  const box = $derived(size === 'lg' ? { w: 108, h: 90 } : { w: 32, h: 27 })

  /**
   * Card geometry in the mark's own box. 2:3 like every card in the game
   * (`cardTheme.ts`: 72×108), and the corner radius is that card's 5px scaled to
   * this one. A rounder box would read as a tile rather than as a card.
   */
  const CW = 30
  const CH = 45
  const CR = 3
  /** Reads as the board's own outline at the size this renders (~0.9 scale). */
  const INK = 4
</script>

<!--
  The heading beside this already names the outcome in words, in both languages.
  A second announcement would be the result twice, so the drawing is decoration
  to a screen reader and says so, on the same contract as `SuitMark` and every glyph on
  a card face.
-->
<svg
  class="outcome"
  class:sm={size === 'sm'}
  viewBox="0 0 120 100"
  width={box.w}
  height={box.h}
  aria-hidden="true"
  focusable="false"
  data-outcome={outcome}
>
  {#snippet card(x: number, y: number, rot: number, fill: string)}
    <rect
      x={-CW / 2}
      y={-CH / 2}
      width={CW}
      height={CH}
      rx={CR}
      {fill}
      stroke="var(--color-stroke)"
      stroke-width={INK}
      stroke-linejoin="round"
      transform="translate({x} {y}) rotate({rot})"
    />
  {/snippet}

  {#if outcome === 'win'}
    <!--
      The mark, in the gold this game wins in. Two passes, widest first, exactly
      as `LocoLogo` draws it: `paint-order` would do it in one path, but the
      outline has to sit outside the shape only and a centred stroke on an
      even-odd wireframe eats its own facets.
    -->
    <svg x="5" y="6" width="110" height="89" viewBox={LOCO_MARK_VIEWBOX}>
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
        fill="var(--color-secondary)"
        stroke="var(--color-secondary)"
        stroke-width={LOCO_MARK_BOLD_STROKE}
        stroke-linejoin="round"
      />
    </svg>
  {:else if outcome === 'loss'}
    <!-- What was still in the hand. Drawn at the trim, back to front, so the fan
         reads as held rather than as a spread on the table. -->
    {@render card(40, 56, -16, 'var(--color-surface-card)')}
    {@render card(80, 56, 16, 'var(--color-surface-card)')}
    {@render card(60, 50, 0, 'var(--color-surface-card)')}
  {:else}
    <!-- A seat that left puts its cards down: one card, face to the felt. Filled
         rather than outlined, because a face-down card is the one object on this
         screen that is deliberately opaque. -->
    {@render card(outcome === 'forfeitLeft' ? 48 : 60, 52, -6, 'var(--color-tertiary)')}
    {#if outcome === 'forfeitLeft'}
      <!-- Ours is the seat that walked, so the card is leaving the frame. The
           direction is drawn and never written: an arrow in a line of copy means
           something different in every chair around a table, but a card sliding
           off its own edge is the same picture from all of them. -->
      <path
        d="M76 52h20m0 0l-7-7m7 7l-7 7"
        fill="none"
        stroke="var(--color-stroke)"
        stroke-width={INK}
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {/if}
  {/if}
</svg>

<style>
  .outcome {
    display: block;
    /* The hard bottom shadow every raised object in this UI carries. On an SVG
       it has to be a filter: a box-shadow would draw the rectangle the element
       occupies, not the shape inside it. */
    filter: drop-shadow(0 6px 0 var(--color-stroke-soft));
    animation: outcomeBob 2.4s ease-in-out infinite;
  }

  @keyframes outcomeBob {
    0%,
    100% {
      transform: translateY(0) rotate(-4deg);
    }
    50% {
      transform: translateY(-6px) rotate(4deg);
    }
  }

  /* Inline in a line of type: no bob, and the ink shadow drops to the weight the
     text beside it carries. */
  .outcome.sm {
    display: inline-block;
    vertical-align: -0.18em;
    filter: drop-shadow(0 2px 0 var(--color-stroke-soft));
    animation: none;
  }

  /* Degrades to the drawing standing still, never to nothing: which of the four
     it is *is* the result, and only the bob was motion. */
  :root[data-motion='reduce'] .outcome {
    animation: none;
  }
</style>
