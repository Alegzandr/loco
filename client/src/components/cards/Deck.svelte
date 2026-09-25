<script lang="ts">
  import CardBack from './CardBack.svelte'
  import { pressToAct } from '../press'
  import { deckPosition, pileTransform } from './layout'
  import { CARD_W, CARD_H } from './cardTheme'

  type Props = {
    width: number
    height: number
    /** Vertical space claimed by the opponent seats — the piles follow the felt. */
    topReserve?: number
    /** A phone on its side: the felt sits right of the seat column (`layout.ts`). */
    landscape?: boolean
    /** True when drawing is currently legal — the pile then becomes a button. */
    canDraw?: boolean
    onDraw?: () => void
    /** Accessible name for the draw action, from i18n. */
    drawLabel?: string
  }

  let { width, height, topReserve = 0, landscape = false, canDraw = false, onDraw, drawLabel }: Props = $props()

  // Depth of the visible stack. Deeper layers are drawn first and offset straight
  // down, in the plane of the pile: once it is laid on the felt that is the
  // block's near side, a band of edges under the top card (`pileTransform`).
  const LAYERS = [3, 2, 1, 0]
  const LAYER_OFFSET = 3

  const pos = $derived(deckPosition(width, height, topReserve, landscape))
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
  style="left: {pos.x}px; top: {pos.y}px; width: {CARD_W}px; height: {CARD_H + LAYERS.length * LAYER_OFFSET}px"
  use:pressToAct={interactive ? onDraw : undefined}
  onkeydown={onKey}
  role={interactive ? 'button' : undefined}
  tabindex={interactive ? 0 : undefined}
  aria-label={interactive ? drawLabel : undefined}
  aria-hidden={interactive ? undefined : true}
>
  <!-- The pile lies on the felt: tipped back about the top card's centre. On a
       node of its own because the deck's transform is the hover lift's. -->
  <div class="laid" style="transform: {pileTransform()}; transform-origin: {CARD_W / 2}px {CARD_H / 2}px">
    {#each LAYERS as i (i)}
      <div class="layer" class:buried={i !== 0} style="top: {i * LAYER_OFFSET}px">
        <CardBack />
      </div>
    {/each}
  </div>
</div>

<style>
  .deck {
    position: absolute;
    pointer-events: none;
    transition: transform 0.15s var(--ease-bounce);
  }

  /* The glow, as a pseudo-element under the pile animated on opacity. It was a
     `filter: drop-shadow()` transitioned on the deck itself, and a transitioned
     filter re-rasterises the whole pile — four card backs — on every frame of
     the fade, twice per turn. A box shadow on a rounded box the pile's size is
     the same halo, painted once and faded on the compositor. It is drawn on
     the laid node, so it lies on the felt with the pile; that node's transform
     makes it a stacking context, which keeps `z-index: -1` inside it. */
  .laid::after {
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

  .interactive .laid::after {
    opacity: 1;
  }

  /* Hover on a device that has one. A touch screen synthesises `:hover` on
     the tap and keeps it there, so the pile stayed lifted and lit after the
     draw — a deck that looked pressable on a turn that was over. */
  @media (hover: hover) {
    .interactive:hover {
      transform: translateY(-5px) scale(1.03);
    }

    .interactive:hover .laid::after {
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

  .laid {
    position: absolute;
    inset: 0;
  }

  /* The pile's contact shadow on the felt, cast the way the room's sun casts
     every block's (`--sun-dx` / `--sun-dy`, the table's own shadow). Soft, and
     that is allowed here: it is ambience, grounding the pile in the room; the
     structure is still the ink outline and the band of edges. */
  .laid::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: 8px;
    pointer-events: none;
    transform: translate(calc(var(--sun-dx, 0) * 7px), calc(var(--sun-dy, 0.7) * 7px + 4px));
    box-shadow: 0 0 12px 3px rgba(0, 0, 0, calc(0.5 + var(--scene-dark, 0) * 0.2));
    background: rgba(0, 0, 0, 0.35);
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
