<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { CARD_H, BOTTOM_RESERVE } from './cardTheme'
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
    height: number
    texts: TurnTexts
  }

  let {
    isMyTurn,
    pendingDraw,
    canCounter,
    currentTurn,
    players,
    height,
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

  // Sits clear above the hand: the fan's playable cards lift by 9px and the pill
  // is ~38px tall, so anything tighter than this overlaps the cards.
  const top = $derived(height - CARD_H - BOTTOM_RESERVE - 58)

  // Framer Motion took the preference through <MotionConfig>; a Svelte transition
  // is given it here. The label still swaps — only the movement goes, which is the
  // rule: motion degrades to a readable static state, never to nothing.
  const dur = $derived(reducedMotion.current ? 0 : 180)
</script>

<div class="anchor" style="top: {top}px">
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
    left: 50%;
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 3;
  }

  .indicator {
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

  /* Your turn: the loudest label on the board. */
  .mine {
    font-size: 20px;
    color: var(--color-on-dark);
    background: var(--gradient-primary);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.45);
  }

  /* Your turn *and* a stack is pending — the decision is now a dilemma. */
  .penalty {
    background: linear-gradient(180deg, #ffb648 0%, #f2760c 100%);
    text-shadow: 0 2px 0 rgba(120, 55, 0, 0.45);
    animation: penaltyThrob 0.9s var(--ease-bounce) infinite;
  }

  @keyframes penaltyThrob {
    0%,
    100% {
      filter: brightness(1);
    }
    50% {
      filter: brightness(1.18);
    }
  }

  /* Someone else's turn: present but quiet. */
  .theirs {
    font-size: 15px;
    font-weight: 600;
    color: var(--color-ink);
    background: var(--color-surface-card);
  }

  :root[data-motion="reduce"] .penalty {
    animation: none;
  }
</style>
