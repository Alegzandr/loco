<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import LocoLogo from './LocoLogo.svelte'
  import Preferences from './Preferences.svelte'
  import FullscreenButton from './FullscreenButton.svelte'
  import TableCode from './TableCode.svelte'

  type Props = {
    /**
     * The room the seat is being reclaimed in. Shown so a player can tell at a
     * glance that this is the game they meant, not a leftover from an old tab.
     */
    roomCode: string
    /**
     * Whether the tab is coming back to a match or to a waiting room. One is a
     * seat with a hand on it, the other is a queue, and the wait means different
     * things in each.
     */
    target: 'waiting' | 'game'
    /**
     * Give up and go to the lobby. A reclaim can only be waited on for so long
     * before "is it stuck?" is a reasonable question, and it must be answerable
     * without reaching for the reload button.
     */
    onCancel: () => void
  }

  let { roomCode, target, onCancel }: Props = $props()
  const t = $derived(i18n.t)
</script>

<!--
  Shown while a reloaded tab reclaims its seat.

  It exists because the alternative reads as data loss: the page comes back on the
  lobby, the room code is gone, the nickname field is empty, and the match is still
  running somewhere with a hand in it. This says the seat is being fetched, names
  the room so the player recognises it, and offers the way out.
-->
<div class="container">
  <div class="topBar">
    <FullscreenButton />
    <Preferences />
  </div>

  <LocoLogo size="clamp(46px, 9vw, 88px)" animated />

  <div class="card" role="status" aria-live="polite">
    <!-- Three dots on their own stagger rather than a spinning ring: the rest of
         this UI has no spinners in it, and a bouncing row is the same language as
         the cards and the buttons. -->
    <div class="dots" aria-hidden="true">
      <span></span><span></span><span></span>
    </div>
    <p class="title">
      {target === 'game' ? t.reconnectingGame : t.reconnectingRoom}
    </p>
    {#if roomCode}
      <p class="room">
        <span class="roomLabel">{t.roomCodeLabel}</span>
        <TableCode code={roomCode} class="roomVal" />
      </p>
    {/if}
    <!-- The in-match promise is a 60 s clock; the pre-match one is not a clock at
         all, and stating a deadline that does not exist is how a player decides to
         reload something that was never at risk. -->
    <p class="hint">
      {target === 'game' ? t.reconnectingHint : t.reconnectingHintRoom}
    </p>
  </div>

  <button class="cancel" type="button" onclick={onCancel}>
    {t.reconnectCancel}
  </button>
</div>

<style>
  /* The screen a reloaded tab boots onto while it reclaims its seat. Deliberately
     built from the same chunky-sticker parts as the lobby it replaces (ink
     outline, hard bottom shadow, display type), because it is the first thing a
     returning player sees and a bare spinner would read as a different app. */

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    height: 100%;
    gap: var(--space-lg);
    padding: calc(var(--space-xl) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-xl) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    overflow-y: auto;
    position: relative;
    background: transparent;
    color: var(--color-ink);
    font-family: var(--font-body);
    text-align: center;
  }

  .topBar {
    position: absolute;
    top: var(--space-base);
    right: var(--space-base);
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    z-index: 5;
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    padding: var(--space-lg) clamp(20px, 6vw, 44px);
    max-width: 420px;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-hard-lg);
  }

  .title {
    font: 700 clamp(19px, 4.4vw, 24px) / 1.25 var(--font-display);
    color: var(--color-ink);
  }

  .room {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .roomLabel {
    font: 700 11px/1.3 var(--font-display);
    color: var(--color-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* Global because the element wearing it is rendered by <TableCode />, which is
     the only thing allowed to print a table code and therefore owns that span. */
  .room :global(.roomVal) {
    font: 700 clamp(26px, 6vw, 34px) / 1.1 var(--font-display);
    color: var(--color-primary);
    letter-spacing: 0.14em;
  }

  .hint {
    font: 500 14px/1.45 var(--font-body);
    color: var(--color-muted);
    max-width: 30ch;
  }

  /* Three bouncing dots. The stagger is what makes them read as progress rather
     than as decoration, so under reduced motion they hold a static row at three
     different opacities instead of vanishing: the screen would otherwise say
     nothing at all about whether anything is happening. */
  .dots {
    display: flex;
    gap: 9px;
    margin-bottom: 2px;
  }

  .dots span {
    width: 13px;
    height: 13px;
    border-radius: var(--radius-full);
    background: var(--color-primary);
    border: 2px solid var(--color-stroke);
    animation: loco-reconnect-bounce 1s var(--ease-bounce) infinite;
  }

  .dots span:nth-child(2) {
    animation-delay: 0.14s;
  }
  .dots span:nth-child(3) {
    animation-delay: 0.28s;
  }

  @keyframes loco-reconnect-bounce {
    0%,
    70%,
    100% {
      transform: translateY(0);
      opacity: 0.55;
    }
    35% {
      transform: translateY(-9px);
      opacity: 1;
    }
  }

  .cancel {
    padding: 11px 26px;
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 700 15px/1.2 var(--font-display);
    cursor: pointer;
    min-height: 44px;
    touch-action: manipulation;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
  }

  .cancel:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .cancel:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  :root[data-motion="reduce"] .dots span {
    opacity: 1;
  }

  :root[data-motion="reduce"] .dots span:nth-child(2) {
    opacity: 0.7;
  }

  :root[data-motion="reduce"] .dots span:nth-child(3) {
    opacity: 0.45;
  }
</style>
