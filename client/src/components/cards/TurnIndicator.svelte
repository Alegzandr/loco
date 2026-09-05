<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { turnPillPlace } from './layout'
  import { reducedMotion } from '../../hooks/uiPrefs.svelte'

  export type TurnTexts = {
    yourTurn: string
    drawOrCounter: string // contains %n placeholder
    drawPenalty: string // contains %n placeholder
    playerTurnSuffix: string
  }

  type Props = {
    isMyTurn: boolean
    pendingDraw: number
    /**
     * True when a card in hand can actually stack the pending penalty. Only the
     * same card counters (same kind AND same colour), so most hands cannot —
     * announcing the counter unconditionally sent players tapping cards that were
     * never going to leave.
     */
    canCounter: boolean
    currentTurn: number
    players: { index: number; nickname: string }[]
    width: number
    height: number
    /** Vertical space claimed by the opponent seats — the felt, and the pill in landscape, follow it. */
    topReserve?: number
    /** A phone on its side: the pill stands inside the felt, under the piles (`layout.ts`). */
    landscape?: boolean
    texts: TurnTexts
  }

  let {
    isMyTurn,
    pendingDraw,
    canCounter,
    currentTurn,
    players,
    width,
    height,
    topReserve = 0,
    landscape = false,
    texts,
  }: Props = $props()

  const msg = $derived.by(() => {
    if (isMyTurn) {
      if (pendingDraw > 0) {
        const tpl = canCounter ? texts.drawOrCounter : texts.drawPenalty
        return tpl.replace('%n', String(pendingDraw))
      }
      return texts.yourTurn
    }
    const nick = players.find((p) => p.index === currentTurn)?.nickname ?? '?'
    return `${nick}${texts.playerTurnSuffix}`
  })

  const isPenalty = $derived(isMyTurn && pendingDraw > 0)

  // Where it sits is layout maths (`layout.ts: turnPillPlace`), beside the
  // hand and the felt it has to stay clear of, so the three agree.
  const place = $derived(turnPillPlace(width, height, topReserve, landscape))

  // Framer Motion took the preference through <MotionConfig>; a Svelte transition
  // is given it here. The label still swaps — only the movement goes, which is the
  // rule: motion degrades to a readable static state, never to nothing.
  const dur = $derived(reducedMotion.current ? 0 : 180)
</script>

<div class="anchor" style="top: {place.top}px; left: {place.centreX}px">
  <!-- Keyed on the message so a turn change crossfades instead of swapping text
       mid-glance. The wrapper holds the centering transform, so the pill inside is
       free to animate its own. -->
  {#key msg}
    <div
      class="indicator"
      class:mine={isMyTurn}
      class:theirs={!isMyTurn}
      class:penalty={isPenalty}
      in:fly={{ y: 6, duration: dur, easing: cubicOut }}
      out:fly={{ y: -6, duration: dur, easing: cubicOut }}
    >
      {msg}
    </div>
  {/key}
</div>

<style>
  /* Owns the position and centering so the inner node is free to animate its own
     transform. */
  .anchor {
    position: absolute;
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 3;
  }

  .indicator {
    position: relative;
    font-family: var(--font-display);
    font-weight: 700;
    white-space: nowrap;
    pointer-events: none;
    text-align: center;
    padding: 7px 20px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard);
    /* Both the outgoing and the incoming pill occupy the anchor at once while
       they cross, so they are stacked rather than stacked *up*. */
    grid-area: 1 / 1;
  }

  .anchor {
    display: grid;
  }

  /* Your turn: the loudest label on the board. It arrives with a burst — a
     ring on a pseudo-element, scaled and faded once, the pill's own transform
     untouched — because the moment the table hands you the turn is the one
     moment a spectator should be able to see from across the room. */
  .mine {
    font-size: 20px;
    color: var(--color-on-dark);
    background: var(--gradient-primary);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.45);
    isolation: isolate;
  }

  .mine::before {
    content: '';
    position: absolute;
    inset: -6px;
    z-index: -1;
    border-radius: inherit;
    border: 3px solid var(--color-on-dark);
    opacity: 0;
    pointer-events: none;
    animation: turnBurst 0.6s ease-out 1;
  }

  @keyframes turnBurst {
    from {
      opacity: 0.9;
      transform: scale(0.85);
    }
    to {
      opacity: 0;
      transform: scale(1.45);
    }
  }

  :root[data-motion='reduce'] .mine::before {
    animation: none;
  }

  /* Your turn *and* a stack is pending — the decision is now a dilemma.

     The throb is a white wash on a pseudo-element, animated on opacity, and not
     a `filter: brightness()` keyframe on the pill: a filter is re-rasterised on
     every frame it changes, and this one ran for as long as the stack stood,
     over a board that was already flying the penalty cards. `isolation` makes
     the pill a stacking context so the wash can sit at `z-index: -1` — above
     the pill's own fill, under its text — and the pill's transform (the fly
     transition) stays the only transform on it. */
  .penalty {
    background: linear-gradient(180deg, #ffb648 0%, #f2760c 100%);
    text-shadow: 0 2px 0 rgba(120, 55, 0, 0.45);
    isolation: isolate;
  }

  .penalty::after {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    background: var(--color-on-dark);
    opacity: 0;
    pointer-events: none;
    animation: penaltyThrob 0.9s var(--ease-bounce) infinite;
  }

  @keyframes penaltyThrob {
    0%,
    100% {
      opacity: 0;
    }
    50% {
      opacity: 0.18;
    }
  }

  /* Someone else's turn: present but quiet. */
  .theirs {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-ink);
    background: var(--color-surface-card);
  }

  :root[data-motion="reduce"] .penalty::after {
    animation: none;
  }
</style>
