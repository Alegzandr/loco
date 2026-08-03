<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { drainBar } from '../hooks/drainBar.svelte'

  type Props = {
    nickname: string
    /** Unix ms at which the match is given away. */
    deadline: number
  }

  let { nickname, deadline }: Props = $props()

  const t = $derived(i18n.t)
  let fill = $state<HTMLDivElement | null>(null)
  let seconds = $state(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))

  drainBar(() => fill, () => deadline, 'auto')

  $effect(() => {
    const at = deadline
    const id = setInterval(() => {
      seconds = Math.max(0, Math.ceil((at - Date.now()) / 1000))
    }, 500)
    return () => clearInterval(id)
  })
</script>

<!--
  "They dropped, and here is how long that lasts."

  Only a matchmade match sends a deadline, and only a matchmade match should: an
  ordinary room holds the seat for a minute for people who came in together, and
  telling them their friend is on a countdown to losing would be a worse table
  than the silent wait. Here the two players are strangers, the wait is short,
  and a number is the difference between sitting through it and reloading the
  page to see whether the game is broken.

  The bar drains on the compositor (drainBar) and only the seconds figure is
  re-rendered, twice a second: a board frozen on somebody else's connection is
  exactly when the main thread must stay free for the moment it unfreezes.
-->
<div class="banner" role="status">
  <span class="dot" aria-hidden="true"></span>
  <span class="text">
    <span class="headline">
      <strong class="name">{nickname}</strong>
      {t.opponentAway}
    </span>
    <span class="hint">{t.opponentAwayHint}</span>
  </span>
  <span class="count">{seconds}s</span>
  <div class="track">
    <div bind:this={fill} class="fill"></div>
  </div>
</div>

<style>
  /* The opponent dropped and the match is on a clock. Anchored top-centre, over
     the empty upper felt: never over the hand, and never where the turn timer
     bar or the interrupt banner already live. */

  .banner {
    position: absolute;
    /* Below the top chrome, not across it: the round pill (top-left) and the
       icon row (top-right) both live at 12-14px + safe-top, and this banner is
       wide enough to reach both. */
    top: calc(60px + var(--safe-top));
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: var(--space-sm) var(--space-md);
    width: max-content;
    max-width: min(94vw, 480px);
    padding: 10px 18px 12px;
    border-radius: var(--radius-lg);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    box-shadow: var(--shadow-pop);
    animation: dropIn 0.32s var(--ease-bounce);
  }

  .dot {
    width: 12px;
    height: 12px;
    border-radius: var(--radius-full);
    background: var(--color-error);
    border: var(--stroke-thin) solid var(--color-stroke);
    animation: blink 1.4s steps(2, end) infinite;
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    color: var(--color-ink);
    text-align: left;
  }

  .headline {
    font: 600 15px/1.3 var(--font-body);
  }

  /* The consequence, one step quieter than the fact. Together they answer both
     questions a frozen board raises: what happened, and what happens next. */
  .hint {
    color: var(--color-muted);
    font: 600 12.5px/1.3 var(--font-body);
  }

  .name {
    font-family: var(--font-display);
    font-weight: 700;
  }

  .count {
    color: var(--color-error);
    font: 700 20px/1 var(--font-display);
    font-variant-numeric: tabular-nums;
  }

  .track {
    grid-column: 1 / -1;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--color-surface-strong);
    overflow: hidden;
  }

  /* The fill is animated by drainBar: a CSS animation with a negative delay, so
     it is already at the right point the instant it mounts. */
  .fill {
    height: 100%;
    width: 100%;
    transform-origin: left center;
    border-radius: var(--radius-full);
    background: var(--color-error);
  }

  @keyframes dropIn {
    from {
      opacity: 0;
      transform: translate(-50%, -14px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @keyframes blink {
    50% {
      opacity: 0.25;
    }
  }

  :root[data-motion="reduce"] .banner {
    animation: none;
  }

  :root[data-motion="reduce"] .dot {
    animation: none;
  }
</style>
