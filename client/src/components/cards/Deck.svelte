<script lang="ts">
  import CardBack from './CardBack.svelte'
  import { deckPosition } from './layout'
  import { CARD_W, CARD_H } from './cardTheme'

  type Props = {
    width: number
    height: number
    /** Vertical space claimed by the opponent seats — the piles follow the felt. */
    topReserve?: number
    /** True when drawing is currently legal — the pile then becomes a button. */
    canDraw?: boolean
    onDraw?: () => void
    /** Accessible name for the draw action, from i18n. */
    drawLabel?: string
  }

  let { width, height, topReserve = 0, canDraw = false, onDraw, drawLabel }: Props = $props()

  // Depth of the visible stack. Deeper layers are drawn first and offset down-right
  // so the pile reads as a physical block of cards seen from slightly above.
  const LAYERS = [3, 2, 1, 0]
  const LAYER_OFFSET = 3

  const pos = $derived(deckPosition(width, height, topReserve))
  const interactive = $derived(canDraw && Boolean(onDraw))

  function onKey(e: KeyboardEvent) {
    if (!interactive) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onDraw?.()
    }
  }
</script>

<!--
  The draw pile. Clickable whenever drawing is legal: reaching for the deck is the
  physical gesture players already expect, and it saves crossing the board to the
  action bar on every turn.
-->
<!-- The role, the tabindex and the label move together with `interactive`: this is
     a button whenever it can be drawn from and hidden from the tree when it
     cannot. The compiler cannot follow a conditional role, so it reads the
     tabindex as one put on plain scenery. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="deck"
  class:interactive
  style="left: {pos.x}px; top: {pos.y}px; width: {CARD_W +
    LAYERS.length * LAYER_OFFSET}px; height: {CARD_H + LAYERS.length * LAYER_OFFSET}px"
  onclick={interactive ? onDraw : undefined}
  onkeydown={onKey}
  role={interactive ? 'button' : undefined}
  tabindex={interactive ? 0 : undefined}
  aria-label={interactive ? drawLabel : undefined}
  aria-hidden={interactive ? undefined : true}
>
  {#each LAYERS as i (i)}
    <div class="layer" class:buried={i !== 0} style="left: {i * LAYER_OFFSET}px; top: {i * LAYER_OFFSET}px">
      <CardBack />
    </div>
  {/each}
</div>

<style>
  .deck {
    position: absolute;
    pointer-events: none;
    transition:
      transform 0.15s var(--ease-bounce),
      filter 0.15s ease;
  }

  /* Drawing is legal: the pile lifts, glows and accepts a click. */
  .interactive {
    pointer-events: auto;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    filter: drop-shadow(0 0 12px rgba(255, 201, 60, 0.55));
  }

  .interactive:hover {
    transform: translateY(-5px) scale(1.03);
    filter: drop-shadow(0 0 20px rgba(255, 201, 60, 0.8));
  }

  .interactive:active {
    transform: translateY(2px) scale(0.99);
  }

  .interactive:focus-visible {
    outline: 3px solid var(--color-tertiary);
    outline-offset: 4px;
    border-radius: 12px;
  }

  .layer {
    position: absolute;
    top: 0;
    left: 0;
  }

  /* Cards underneath the top one. Darkened rather than faded: on the dark theme
     lowering opacity would lighten them against the table and break the illusion
     of depth. */
  .buried {
    filter: brightness(0.62) saturate(0.85);
  }
</style>
