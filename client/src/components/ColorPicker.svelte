<script lang="ts">
  import type { CardColor } from '../types/protocol'
  import { SUIT_PAINT, SUIT_ANGLE_DEG } from './cards/cardTheme'
  import SuitMark from './cards/SuitMark.svelte'
  import { colorAssistPref } from '../hooks/colorAssist'
  import { watchPref } from '../hooks/prefs.svelte'
  import { escapeKey } from '../hooks/escapeKey.svelte'
  import { dialogFocus } from './dialogFocus'
  import { i18n } from '../i18n/i18n.svelte'

  const WILD_COLORS: CardColor[] = ['red', 'yellow', 'green', 'blue']

  type Props = {
    label: string
    /** Accessible name of the ✕. Every way out of this panel says the same thing. */
    cancelLabel: string
    onChoose: (color: CardColor) => void
    onCancel: () => void
  }

  let { label, cancelLabel, onChoose, onCancel }: Props = $props()

  const assist = watchPref(colorAssistPref)
  const t = $derived(i18n.t)

  // The same way out as the scrim and the ✕: cancelling puts the card back in
  // the hand, so there is nothing here Escape could cost.
  escapeKey(() => true, () => onCancel())
</script>

<!--
  Wild colour chooser.

  svelte-ignore is deliberate on the scrim: the two ways out this panel owes a
  player are the Escape above and the pressable ✕ below, which is the rule for
  everything that opens over the board. Tapping the backdrop is a third, mouse
  only convenience, and giving it a keyboard role would put a focus stop between
  the player and the four swatches they came here for.
-->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onclick={onCancel}>
  <!-- A dialog with a click handler needs no ignore: the role is the answer. -->
  <!-- `tabindex="-1"` because a dialog is a focus container: it takes focus
       programmatically when the panel it labels has nothing focusable left,
       and it stays out of the tab order, so `dialogFocus`'s own cycle (which
       looks for buttons and `tabindex="0"`) is untouched. -->
  <div
    class="colorPicker"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-label={label}
    use:dialogFocus
    onclick={(e) => e.stopPropagation()}
  >
    <p>{label}</p>
    <!-- Swatches carry the suit's whole gradient, not a flat sample of it — the
         button and the card it produces are literally the same paint. `color`
         additionally drives the hover glow through currentColor. -->
    <div class="colorBtnRow">
      {#each WILD_COLORS as col (col)}
        <button
          class="colorBtn"
          aria-label={t.colorNames[col]}
          style="background: linear-gradient({SUIT_ANGLE_DEG}deg, {SUIT_PAINT[col].from}, {SUIT_PAINT[col].to}); color: {SUIT_PAINT[col].from}"
          onclick={() => onChoose(col)}
        >
          <!-- Four swatches that differ only in hue is the one control in the
               game a colour-blind player cannot use at all. -->
          {#if assist.current}
            <SuitMark color={col} class="suitMark" />
          {/if}
        </button>
      {/each}
    </div>
    <!-- The same path the three sheets carry, for the reason stated there: the ✕
         is one object across the game, not one drawing per panel. -->
    <button class="cancelBtn" onclick={onCancel} aria-label={cancelLabel}>
      <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
        <path
          d="M6 6l12 12M18 6L6 18"
          fill="none"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</div>

<style>
  /* Wild colour chooser — a decision the whole table is waiting on, so the four
     targets are large, saturated and unmistakably buttons. */

  .overlay {
    position: absolute;
    inset: 0;
    background: var(--color-scrim);
    backdrop-filter: blur(5px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    animation: pickerFade 0.18s ease-out both;
  }

  @keyframes pickerFade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .colorPicker {
    background: var(--color-surface-card);
    border: 4px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    padding: var(--space-lg) var(--space-xl);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-base);
    color: var(--color-ink);
    font: 700 18px/1.3 var(--font-display);
    box-shadow: var(--shadow-pop);
    animation: pickerIn 0.32s var(--ease-bounce) both;
  }

  @keyframes pickerIn {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .colorBtnRow {
    display: flex;
    gap: var(--space-md);
  }

  .colorBtn {
    width: 72px;
    height: 72px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    cursor: pointer;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    box-shadow:
      0 5px 0 var(--color-stroke-soft),
      inset 0 -8px 14px rgba(0, 0, 0, 0.18),
      inset 0 8px 14px rgba(255, 255, 255, 0.3);
    transition:
      transform 0.14s var(--ease-bounce),
      box-shadow 0.14s var(--ease-out);
  }

  /* Colour assist: the suit silhouette, centred in the swatch. Global because
     the element wearing it is rendered by <SuitMark />, not by this file, and
     Svelte scopes a class to the component whose markup carries it. */
  .colorBtn :global(.suitMark) {
    width: 46%;
    height: 46%;
  }

  .colorBtn:hover,
  .colorBtn:focus-visible {
    transform: translateY(-4px) scale(1.06);
    box-shadow:
      0 9px 0 var(--color-stroke-soft),
      0 0 26px 4px currentColor;
  }

  .colorBtn:active {
    transform: translateY(3px) scale(1.02);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .cancelBtn {
    background: transparent;
    border: var(--stroke-thin) solid var(--color-hairline);
    border-radius: var(--radius-full);
    color: var(--color-muted);
    font: 600 15px/1 var(--font-display);
    cursor: pointer;
    width: var(--touch-target);
    height: var(--touch-target);
    display: flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .cancelBtn:hover {
    color: var(--color-ink);
    background: var(--color-surface-strong);
  }

  @media (max-width: 480px) {
    .colorBtn {
      width: 64px;
      height: 64px;
    }

    .colorPicker {
      padding: var(--space-lg);
      width: 90vw;
      max-width: 340px;
    }

    .colorBtnRow {
      gap: var(--space-sm);
    }
  }

  :root[data-motion="reduce"] .colorPicker,
  :root[data-motion="reduce"] .overlay {
    animation: none;
  }
</style>
