<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'
  import { playSfx } from '../audio/sfx'
  import { seatColor, seatInitial } from './playerColors'
  import LocoLogo from './LocoLogo.svelte'
  import Preferences from './Preferences.svelte'
  import AudioSettings from './AudioSettings.svelte'
  import RulesButton from './RulesButton.svelte'
  import RulesModal from './RulesModal.svelte'
  import { searchStage, formatElapsed } from './searchStages'

  type Props = {
    /** Date.now() when the search began. */
    startedAt: number
    nickname: string
    onCancel: () => void
    /** Offered once the wait is long: a table needs one friend, not one stranger. */
    onCreateTable: () => void
  }

  let { startedAt, nickname, onCancel, onCreateTable }: Props = $props()

  const t = $derived(i18n.t)
  let elapsed = $state(Date.now() - startedAt)
  let showRules = $state(false)

  // One tick a second, and nothing else in this screen is stateful: the ring, the
  // sweep and the cards all run on CSS. See drainBar for why anything continuous
  // stays off the framework's hands.
  $effect(() => {
    const from = startedAt
    const id = setInterval(() => {
      elapsed = Date.now() - from
    }, 1000)
    return () => clearInterval(id)
  })

  const stage = $derived(searchStage(elapsed))
</script>

<!--
  Waiting for an opponent.

  The screen times its own wait, because the server never says how long the queue
  is (see searchStages.ts, which owns that rule and the three stages of copy it
  produces). Everything here is presentation: a radar that is visibly doing
  something, the empty chair opposite, and the two ways out.
-->
<div class="container">
  <!-- The wait is the longest a player ever spends on one screen, so the row
       every other screen carries stays reachable here too: turning the music down
       or reading the rules is exactly what one does while queueing. -->
  <div class="topBar">
    <Preferences />
    <AudioSettings />
    <RulesButton label={t.rulesBtn} onclick={() => (showRules = true)} />
  </div>

  <LocoLogo size="clamp(30px, 5vw, 48px)" />

  <div class="stage">
    <!-- The radar is the one thing on screen that is unambiguously *doing*
         something. Three rings on staggered delays so the pulse never has a still
         frame, and a sweep that keeps turning even when it stops. -->
    <div class="radar" aria-hidden="true">
      <span class="ring"></span>
      <span class="ring"></span>
      <span class="ring"></span>
      <span class="sweep"></span>
      <span class="avatar" style="background: {seatColor(0)}">{seatInitial(nickname)}</span>
    </div>

    <!-- The empty chair opposite. It is what the whole screen is about, and
         leaving it visibly empty is more honest than a spinner. Same box as the
         radar so the two sides balance: this is a 1v1, and a lopsided pair reads
         as a layout bug rather than as a missing player. -->
    <div class="opponent" aria-hidden="true">
      <span class="opponentSlot">?</span>
    </div>
  </div>

  <!-- An h2: the document's top-level heading is served by GamePage.astro and
       describes the page itself. A screen inside the game heads its own section. -->
  <h2 class="title">{t.searchTitle}</h2>

  <!-- aria-live so the stage change is announced rather than silently swapped:
       somebody using a screen reader is doing exactly the same thing as everybody
       else here, which is waiting. -->
  <p class="subtitle" aria-live="polite">
    {stage === 'long' ? t.searchLong : stage === 'patient' ? t.searchPatient : t.searchFresh}
  </p>

  <p class="elapsed">
    <span class="elapsedLabel">{t.searchElapsed}</span>
    <span class="elapsedValue">{formatElapsed(elapsed)}</span>
  </p>

  <div class="actions">
    <button
      class="cancel"
      onclick={() => {
        playSfx('uiBack')
        onCancel()
      }}
    >
      {t.searchCancel}
    </button>
    {#if stage === 'long'}
      <!-- Both classes rather than the `composes: cancel` this used under CSS
           Modules: Svelte's <style> has no such directive, and duplicating the
           declarations would be two buttons to keep in step instead of one. -->
      <button class="cancel alternative" onclick={onCreateTable}>
        {t.searchCreateTable}
      </button>
    {/if}
  </div>

  {#if showRules}
    <RulesModal onClose={() => (showRules = false)} />
  {/if}
</div>

<style>
  /* Everything that moves here is CSS: the screen can be up for minutes, and a
     re-render per frame would be a re-render per frame for nothing. Motion
     degrades to a readable static state under reduced motion, never to nothing. */

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    position: relative;
    height: 100%;
    overflow-y: auto;
    gap: var(--space-base);
    padding: calc(var(--space-lg) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-lg) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    color: var(--color-ink);
    font-family: var(--font-body);
    text-align: center;
  }

  /* Same row, same corner and same order as every other screen: the controls do
     not move because the screen changed. Above the radar's rings, which reach the
     corners once they are at full scale. */
  .topBar {
    position: absolute;
    top: calc(var(--space-base) + var(--safe-top));
    right: calc(var(--space-base) + var(--safe-right));
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    z-index: 5;
  }

  /* The player and the chair opposite, on one line: this is a 1v1 and the layout
     says so before any text does. */
  .stage {
    /* One box per side, identical, so the pair is optically centred whatever the
       radar's rings are doing. */
    --slot-box: clamp(150px, 19vw, 200px);
    --slot-disc: clamp(84px, 10vw, 108px);
    display: flex;
    align-items: center;
    gap: clamp(var(--space-sm), 4vw, var(--space-xl));
    margin-bottom: var(--space-sm);
  }

  .radar {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--slot-box);
    height: var(--slot-box);
  }

  .ring {
    position: absolute;
    inset: 0;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-tertiary);
    opacity: 0;
    animation: pulse 2.4s var(--ease-out) infinite;
  }

  .ring:nth-child(2) {
    animation-delay: 0.8s;
  }
  .ring:nth-child(3) {
    animation-delay: 1.6s;
  }

  /* The sweep: a conic wedge turning behind the avatar. Slower than the pulse so
     the two never sync up into a single beat. */
  .sweep {
    position: absolute;
    inset: 8px;
    border-radius: var(--radius-full);
    background: conic-gradient(
      from 0deg,
      rgba(108, 92, 255, 0.38) 0deg,
      rgba(108, 92, 255, 0) 70deg,
      rgba(108, 92, 255, 0) 360deg
    );
    animation: sweep 3.2s linear infinite;
  }

  .avatar {
    position: relative;
    display: grid;
    place-items: center;
    width: var(--slot-disc);
    height: var(--slot-disc);
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard-lg);
    color: var(--color-on-dark);
    font: 700 clamp(30px, 4vw, 42px) / 1 var(--font-display);
    text-shadow: 0 2px 0 rgba(36, 21, 70, 0.35);
  }

  .opponent {
    display: grid;
    place-items: center;
    width: var(--slot-box);
    height: var(--slot-box);
  }

  /* Deliberately an empty seat, not a spinner: the thing being waited for is a
     person, and a dashed outline says "this is where they go". */
  .opponentSlot {
    display: grid;
    place-items: center;
    width: var(--slot-disc);
    height: var(--slot-disc);
    border-radius: var(--radius-full);
    border: var(--stroke) dashed var(--color-border-strong);
    background: var(--color-surface-strong);
    color: var(--color-muted);
    font: 700 clamp(30px, 4vw, 42px) / 1 var(--font-display);
    animation: breathe 2.4s ease-in-out infinite;
  }

  .title {
    margin: 0;
    font: 700 clamp(26px, 5vw, 38px) / 1.1 var(--font-display);
    color: var(--color-ink);
    text-wrap: balance;
  }

  .subtitle {
    margin: 0;
    max-width: 30ch;
    color: var(--color-body);
    font: 600 16px/1.45 var(--font-body);
    text-wrap: balance;
    /* The copy changes under the player's eyes at 15s and 45s, so it fades in
       rather than swapping. */
    animation: fadeIn 0.5s var(--ease-out);
  }

  .elapsed {
    display: inline-flex;
    align-items: center;
    gap: var(--space-sm);
    margin: 0;
    padding: 8px 18px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-card);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .elapsedLabel {
    color: var(--color-muted);
    font: 700 12px/1 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  /* Tabular so the digits do not jitter the pill's width every second. */
  .elapsedValue {
    color: var(--color-ink);
    font: 700 18px/1 var(--font-display);
    font-variant-numeric: tabular-nums;
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    width: clamp(280px, 26vw, 360px);
    margin-top: var(--space-sm);
  }

  .cancel {
    width: 100%;
    padding: 12px 24px;
    min-height: 48px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    color: var(--color-ink);
    font: 600 16px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 4px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out);
    touch-action: manipulation;
  }

  .cancel:hover {
    transform: translateY(-2px);
    box-shadow: 0 6px 0 var(--color-stroke-soft);
  }
  .cancel:active {
    transform: translateY(2px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* Appears only once the wait is long. It is an offer, not a retreat, so it gets
     the secondary hue rather than the quiet surface the cancel button uses. */
  .alternative {
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    animation: fadeIn 0.5s var(--ease-out);
  }

  @keyframes pulse {
    0% {
      transform: scale(0.55);
      opacity: 0;
    }
    15% {
      opacity: 0.9;
    }
    100% {
      transform: scale(1);
      opacity: 0;
    }
  }

  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }

  @keyframes breathe {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.06);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (max-width: 480px) {
    .stage {
      --slot-box: 118px;
      --slot-disc: 68px;
    }
    .avatar,
    .opponentSlot {
      font-size: 28px;
    }
    .actions {
      width: 90vw;
      max-width: 340px;
    }
  }

  /* The search still has to look like it is running: the rings stop, and what is
     left is a static halo and a solid ring on the empty seat. */
  :root[data-motion="reduce"] .ring {
    animation: none;
    opacity: 0.35;
  }

  :root[data-motion="reduce"] .ring:nth-child(2),
  :root[data-motion="reduce"] .ring:nth-child(3) {
    display: none;
  }

  :root[data-motion="reduce"] .sweep {
    animation: none;
    opacity: 0.5;
  }

  :root[data-motion="reduce"] .opponentSlot {
    animation: none;
  }

  :root[data-motion="reduce"] .subtitle,
  :root[data-motion="reduce"] .alternative {
    animation: none;
  }
</style>
