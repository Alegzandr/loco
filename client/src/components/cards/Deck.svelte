<script lang="ts">
  import CardBack from './CardBack.svelte'
  import { pressToAct } from '../press'
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
  use:pressToAct={interactive ? onDraw : undefined}
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
    transition: transform 0.15s var(--ease-bounce);
    /* A stacking context of its own, so the glow below can sit at `z-index: -1`
       behind the four layers of the pile and still be inside the deck. */
    isolation: isolate;
  }

  /* The glow, as a pseudo-element under the pile animated on opacity. It was a
     `filter: drop-shadow()` transitioned on the deck itself, and a transitioned
     filter re-rasterises the whole pile — four card backs — on every frame of
     the fade, twice per turn. A box shadow on a rounded box the pile's size is
     the same halo, painted once and faded on the compositor. */
  .deck::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: 14px;
    box-shadow: 0 0 14px 4px color-mix(in srgb, var(--color-secondary) 55%, transparent);
    opacity: 0;
    transition: opacity 0.15s ease;
  }

  /* Drawing is legal: the pile lifts, glows and accepts a click. */
  .interactive {
    pointer-events: auto;
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .interactive::after {
    opacity: 1;
  }

  /* Hover on a device that has one. A touch screen synthesises `:hover` on
     the tap and keeps it there, so the pile stayed lifted and lit after the
     draw — a deck that looked pressable on a turn that was over. */
  @media (hover: hover) {
    .interactive:hover {
      transform: translateY(-5px) scale(1.03);
    }

    .interactive:hover::after {
      box-shadow: 0 0 22px 6px color-mix(in srgb, var(--color-secondary) 80%, transparent);
    }
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
