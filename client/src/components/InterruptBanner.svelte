<script lang="ts">
  import type { InterruptFlash } from '../hooks/gameStore'
  import type { Translations } from '../i18n/en'
  import { seatColor } from './playerColors'

  type Props = {
    flash: InterruptFlash | null
    myIndex: number
    players: { index: number; nickname: string }[]
    t: Translations
    onDone: () => void
  }

  let { flash, myIndex, players, t, onDone }: Props = $props()

  /** How long the slam stays up. Long enough to read, short enough not to hide the play. */
  const DURATION_MS = 1800

  let visible = $state(false)
  // Keyed on the timestamp: a second interception restarts the banner.
  const at = $derived(flash?.at)

  $effect(() => {
    if (at === undefined) return
    visible = true
    const id = setTimeout(() => {
      visible = false
      onDone()
    }, DURATION_MS)
    return () => clearTimeout(id)
  })

  const actor = $derived(players.find((p) => p.index === flash?.actorIndex))
  const subtitle = $derived(
    flash?.actorIndex === myIndex
      ? t.interruptByYou
      : t.interruptBy.replace('%actor', actor?.nickname ?? `P${flash?.actorIndex}`),
  )
</script>

<!--
  The interception slam.

  Playing an identical card out of turn is the most spectacular thing that can
  happen in a round, and until now the client rendered it exactly like an
  ordinary turn. This is the one moment the UI is allowed to shout.
-->
{#if flash && visible}
  {#key flash.at}
    <div class="overlay" aria-live="assertive">
      <div class="slash"></div>
      <div class="banner" style="--actor-color: {seatColor(flash.actorIndex)}">
        <span class="title">{t.interruptTitle}</span>
        <span class="subtitle">{subtitle}</span>
        <!-- A batched interception (several identical cards at once) is rarer
             still — it gets its own multiplier chip. -->
        {#if flash.count > 1}
          <span class="combo">{t.interruptCombo.replace('%n', String(flash.count))}</span>
        {/if}
      </div>
    </div>
  {/key}
{/if}

<style>
  /* Deliberately the loudest thing in the game — see the comment above.
     Everything here is transform/opacity only so it stays on the compositor
     while the board keeps animating underneath. */

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 45;
    overflow: hidden;
  }

  /* A colour wipe crossing the screen behind the words. */
  .slash {
    position: absolute;
    top: 50%;
    left: -20%;
    width: 140%;
    height: 168px;
    margin-top: -84px;
    background: linear-gradient(
      90deg,
      rgba(255, 61, 104, 0) 0%,
      rgba(255, 61, 104, 0.85) 22%,
      rgba(108, 92, 255, 0.85) 78%,
      rgba(108, 92, 255, 0) 100%
    );
    transform: skewY(-6deg) scaleX(0);
    transform-origin: left center;
    animation: slashSweep 0.9s var(--ease-out) forwards;
  }

  @keyframes slashSweep {
    0% {
      transform: skewY(-6deg) scaleX(0);
      opacity: 0;
    }
    22% {
      transform: skewY(-6deg) scaleX(1);
      opacity: 1;
    }
    70% {
      transform: skewY(-6deg) scaleX(1);
      opacity: 1;
    }
    100% {
      transform: skewY(-6deg) scaleX(1);
      opacity: 0;
    }
  }

  .banner {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 44px;
    background: var(--color-surface-card);
    border: 5px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow:
      0 8px 0 var(--color-stroke-soft),
      0 0 0 5px var(--actor-color, var(--color-primary)),
      0 0 70px var(--actor-color, var(--color-primary));
    animation:
      slamIn 0.42s var(--ease-bounce) forwards,
      slamOut 0.3s ease-in 1.45s forwards;
  }

  @keyframes slamIn {
    0% {
      opacity: 0;
      transform: scale(2.4) rotate(-9deg);
    }
    55% {
      opacity: 1;
      transform: scale(0.92) rotate(3deg);
    }
    100% {
      opacity: 1;
      transform: scale(1) rotate(-2.5deg);
    }
  }

  @keyframes slamOut {
    to {
      opacity: 0;
      transform: scale(1.12) rotate(-2.5deg);
    }
  }

  .title {
    font: 700 clamp(30px, 6.5vw, 62px) / 1 var(--font-display);
    letter-spacing: -1px;
    color: var(--actor-color, var(--color-primary));
    -webkit-text-stroke: 4px var(--color-stroke);
    paint-order: stroke fill;
    white-space: nowrap;
  }

  .subtitle {
    font: 600 clamp(13px, 2.2vw, 18px) / 1.2 var(--font-display);
    color: var(--color-ink);
    white-space: nowrap;
  }

  /* Batched interception multiplier. */
  .combo {
    position: absolute;
    top: -18px;
    right: -18px;
    padding: 5px 13px;
    font: 700 20px/1 var(--font-display);
    /* Ink, not white: this chip is yellow, and white on it measures ~1.7:1. The
       catch banner's ×N chip — which this one is deliberately twinned with —
       already reads the ink. */
    color: var(--color-stroke);
    background: var(--gradient-secondary);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    text-shadow: 0 2px 0 rgba(120, 80, 0, 0.5);
    animation: comboPop 0.4s var(--ease-bounce) 0.2s both;
  }

  @keyframes comboPop {
    from {
      opacity: 0;
      transform: scale(0.2) rotate(-25deg);
    }
    to {
      opacity: 1;
      transform: scale(1) rotate(10deg);
    }
  }

  :root[data-motion="reduce"] .slash {
    display: none;
  }

  :root[data-motion="reduce"] .banner {
    animation: none;
    transform: rotate(-2.5deg);
  }

  :root[data-motion="reduce"] .combo {
    animation: none;
  }
</style>
