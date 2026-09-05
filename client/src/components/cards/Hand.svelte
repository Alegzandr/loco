<script lang="ts">
  import { untrack } from 'svelte'
  import type { CardDTO } from '../../types/protocol'
  import Card from './Card.svelte'
  import { calcHandSlots, handCardKeys } from './layout'
  import { CARD_W, CARD_H, DEAL_FLIGHT_MS, DEAL_STAGGER_MS, radToDeg } from './cardTheme'

  type Props = {
    hand: CardDTO[]
    /** The round the hand was dealt for; a new one restarts the deal stagger. */
    roundNumber?: number
    width: number
    height: number
    /** A phone on its side: the fan sits on the bottom edge, not above a bar (`layout.ts`). */
    landscape?: boolean
    /** Predicate run per card to decide playable/highlight state. */
    isPlayable: (card: CardDTO) => boolean
    /**
     * Predicate that decides whether a tap should be allowed at all (turn or legal
     * interrupt). When false, the card renders without pointer cursor.
     */
    isInteractive: (card: CardDTO) => boolean
    onCardClick: (card: CardDTO, idx: number) => void
  }

  let { hand, roundNumber = -1, width, height, landscape = false, isPlayable, isInteractive, onCardClick }: Props = $props()

  let hoveredIdx = $state<number | null>(null)

  // A hand that grows from empty is a deal — worth staggering. Any other growth is
  // a draw, which already has its own deck→hand flier and must not stagger.
  let prevLen = 0
  let prevRound = untrack(() => roundNumber)
  let dealing = $state(false)
  // The deal ends at a wall-clock moment, not after "one timeout from whenever
  // this effect last ran". Any prop moving re-runs the effect and its cleanup
  // takes the timer with it, so a version that only armed on the 0→n transition
  // armed once, lost it to the next message, and left every card wearing its
  // deal delay for the rest of the round. Same shape as `drainBar`: an absolute
  // deadline survives any number of re-runs.
  let dealUntil = 0
  $effect(() => {
    const len = hand.length
    const wasEmpty = prevLen === 0
    const newRound = roundNumber !== prevRound
    prevLen = len
    prevRound = roundNumber
    const now = Date.now()
    // A fresh deal, or the next round's: each card waits for its flier from
    // the deck (GameBoard's deal effect) and appears where it lands.
    if ((wasEmpty || newRound) && len >= 2) dealUntil = now + len * DEAL_STAGGER_MS + DEAL_FLIGHT_MS + 400
    const left = dealUntil - now
    if (left <= 0) {
      dealing = false
      return
    }
    dealing = true
    const id = setTimeout(() => (dealing = false), left)
    return () => clearTimeout(id)
  })

  const slots = $derived(calcHandSlots(hand.length, width, height, landscape))
  const keys = $derived(handCardKeys(hand))
</script>

<!--
  The local player's fanned cards. Pure presentational — position and rotation come
  from `calcHandSlots`, hover state is local.

  The hover is a mouse's and nobody else's. It listened to `mouseenter`, which a
  touch screen synthesises on the tap and never follows with a `mouseleave`
  until the finger lands somewhere else: a card tapped and refused stayed lifted
  and straightened over the fan for the rest of the turn, which read as the game
  having picked it. Pointer events say what the pointer is, so a finger lifts
  nothing — the press feedback below is the touch's whole answer — and a
  refused tap leaves the fan exactly as it found it.

  Each slot is positioned purely by transform, so when a card leaves the fan the
  neighbours glide into the gap instead of snapping to their new left/top. Framer
  Motion ran that on a spring per card; it is a CSS transition now, which keeps the
  reflow on the compositor and off the main thread — the thing that matters most on
  a board whose whole point is answering a tap instantly. A fresh deal staggers the
  cards in through a per-card delay.
-->
{#if hand.length > 0}
  <div class="hand" aria-label="hand">
    {#each hand as card, i (keys[i])}
      {@const slot = slots[i]}
      {@const playable = isPlayable(card)}
      {@const interactive = isInteractive(card)}
      <!-- Playable cards lift slightly even at rest so they stand out. -->
      {@const restLift = playable ? -9 : 0}
      {@const hovered = hoveredIdx === i}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="slot"
        class:hovered
        class:dealing
        style="width: {CARD_W}px; height: {CARD_H}px; z-index: {hovered
          ? 100
          : i}; transform: translate({slot.x}px, {slot.y + restLift}px) rotate({hovered
          ? 0
          : radToDeg(slot.rotation)}deg); transition-delay: {dealing
          ? i * DEAL_STAGGER_MS
          : 0}ms; animation-delay: {dealing ? i * DEAL_STAGGER_MS + DEAL_FLIGHT_MS : 0}ms"
        onpointerenter={(e) => {
          if (e.pointerType === 'mouse') hoveredIdx = i
        }}
        onpointerleave={() => {
          if (hoveredIdx === i) hoveredIdx = null
        }}
      >
        <Card
          {card}
          {playable}
          shadow
          onclick={interactive ? () => onCardClick(card, i) : undefined}
          class="card"
        />
      </div>
    {/each}
  </div>
{/if}

<style>
  .hand {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .slot {
    position: absolute;
    /* Pinned at the origin: placement and rotation are the inline transform, so
       nothing here may set left/top/transform or it would fight the reflow. */
    left: 0;
    top: 0;
    pointer-events: auto;
    transform-origin: 50% 50%;
    will-change: transform;
    /* The fan re-spreads when a card leaves and straightens under the pointer.
       Cubic-bezier rather than a spring: the overshoot a spring gave was never
       readable at this size, and this costs no frame budget at all. */
    transition: transform 420ms cubic-bezier(0.22, 1, 0.28, 1);
    animation: handCardIn 380ms cubic-bezier(0.22, 1, 0.28, 1) both;
  }

  @keyframes handCardIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* The lift lives on the inner card so the slot's transform stays exclusively the
     fan's — two nested transforms, no conflict. Global because <Card /> renders
     the element that wears it.

     Transform alone. It also transitioned `box-shadow`, and nothing the hover
     does moves the shadow: the one shadow change a card in hand ever sees is
     the playable glow, which flips for the whole fan at once on a turn change
     and was being tweened on every card of it. */
  .slot :global(.card) {
    transform-origin: 50% 50%;
    transition: transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .slot.hovered :global(.card) {
    transform: scale(1.08) translateY(-14px);
  }

  /* The press: the card gives under the thumb for the frame before it flies.
     A control that does not move when pressed is a picture of a control. */
  .slot:active :global(.card.interactive) {
    transform: scale(1.02) translateY(-6px);
    transition-duration: 60ms;
  }

  :root[data-motion="reduce"] .slot {
    transition: none;
    animation: none;
  }

  :root[data-motion="reduce"] .slot :global(.card) {
    transition: none;
  }
</style>
