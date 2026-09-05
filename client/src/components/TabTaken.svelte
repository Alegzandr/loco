<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import LocoLogo from './LocoLogo.svelte'
  import Preferences from './Preferences.svelte'
  import FullscreenButton from './FullscreenButton.svelte'

  type Props = {
    /**
     * Whether the tab holding the game is at a table. It is the whole difference
     * between an offer and a warning: taking the game from a tab sitting on the
     * menu costs nothing, and taking it from one mid-match costs that match.
     */
    seated: boolean
    /** Take the game. See `takeOverTab` in hooks/tabLock.ts for what it inherits: nothing. */
    onTake: () => void
  }

  let { seated, onTake }: Props = $props()
  const t = $derived(i18n.t)
</script>

<!--
  Shown in every tab that is not the one holding the game.

  It exists because the alternative is the game lying: a second tab looked like a
  fresh game, counted a second time in `players_online`, and could be paired
  against the first one in the 1v1 queue. This says where the game is, and offers
  the one thing worth offering — bringing it here.

  It does not close on Escape, and that is not an oversight. The rule about
  anything opening over the board closing two ways is about panels somebody chose
  to open; this is the state of the tab. There is nothing behind it to go back to,
  and a key that dismissed it would leave a tab showing a game it does not hold.
-->
<div class="container">
  <div class="topBar">
    <FullscreenButton />
    <Preferences />
  </div>

  <LocoLogo size="clamp(46px, 9vw, 88px)" />

  <div class="card" role="status" aria-live="polite">
    <p class="title">{t.tabTakenTitle}</p>
    <p class="hint">{seated ? t.tabTakenHintSeated : t.tabTakenHint}</p>
  </div>

  <button class="take" type="button" onclick={onTake}>
    {t.tabTakenTake}
  </button>
</div>

<style>
  /* Deliberately the same parts as <Reconnecting />: ink outline, hard bottom
     shadow, display type. Both are curtains a tab boots onto instead of the game,
     and a second visual language for the second one would read as a different
     app rather than as the same game explaining itself. */

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

  .hint {
    font: 500 14px/1.45 var(--font-body);
    color: var(--color-muted);
    max-width: 32ch;
  }

  .take {
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

  .take:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .take:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }
</style>
