<script lang="ts">
  import type { Translations } from '../i18n/en'

  type Props = {
    isMyTurn: boolean
    pendingDraw: number
    handSize: number
    hasDrawn: boolean
    hasPlayableCard: boolean
    /**
     * True while another player sits on a single card without having called it.
     * Driven by the catch window, not by uno_declared — a declaration is exactly
     * the moment catching stops being possible.
     */
    canCatch: boolean
    /**
     * True once we have already called it on the card we hold. A declaration is
     * spent — the server refuses the second one — so the button must stop asking.
     */
    hasDeclared: boolean
    onDraw: () => void
    onPass: () => void
    onUno: () => void
    onCatch: () => void
    t: Translations
  }

  let {
    isMyTurn,
    pendingDraw,
    handSize,
    hasDrawn,
    hasPlayableCard,
    canCatch,
    hasDeclared,
    onDraw,
    onPass,
    onUno,
    onCatch,
    t,
  }: Props = $props()

  // The centre column is CATCH's home, and LOCO only borrows it while we are the
  // one on a single card. Catch is by far the hardest button in the game to hit:
  // it opens on someone else's mistake and lives for seconds, so it has to sit —
  // greyed out, but present and in place — on the pixel the player already knows,
  // long before the window opens. LOCO borrows the column at `handSize === 1`
  // because declaring is ours to lose and outranks an opportunity; Catch then
  // floats beside the bar for that rare overlap.
  const locoTurn = $derived(handSize === 1)
</script>

<!--
  Fixed three-column grid: draw left, reaction button centre, pass right. The
  slots keep their width whether or not they hold a button, so every control sits
  at the same screen pixel all match long and can be aimed at before it lights up
  — this is a speed game, and a bar that reflows under the cursor costs a win.
-->
<div class="actionBar">
  <div class="slot" data-slot="left">
    {#if isMyTurn && pendingDraw > 0}
      <button class="btn btnPenalty" onclick={onDraw}>{t.draw} +{pendingDraw}</button>
    {/if}
    {#if isMyTurn && pendingDraw === 0}
      <button
        class="btn"
        class:btnDisabled={hasDrawn}
        class:btnDrawSecondary={!hasDrawn && hasPlayableCard}
        class:btnDraw={!hasDrawn && !hasPlayableCard}
        onclick={onDraw}
        disabled={hasDrawn}
      >
        {t.draw}
      </button>
    {/if}
  </div>

  <div class="slot" data-slot="center">
    {#if locoTurn}
      <!-- We are on one card: LOCO is live by definition — until we call it. The
           declaration is a one-shot, so afterwards the button stays in place
           (nothing may move in this bar) as a spent, dead object, the same way
           Catch waits out the match greyed in this very column. -->
      <button
        class="btn btnUno"
        class:btnDisabled={hasDeclared}
        class:armed={!hasDeclared}
        onclick={onUno}
        disabled={hasDeclared}
      >
        {t.unoBtn}
      </button>
    {:else}
      <button class="btn btnCatch" class:armed={canCatch} onclick={onCatch} disabled={!canCatch}>
        {t.catchBtn}
      </button>
    {/if}
  </div>

  <div class="slot" data-slot="right">
    {#if isMyTurn && pendingDraw === 0}
      <button class="btn btnPass" class:btnDisabled={!hasDrawn} onclick={onPass} disabled={!hasDrawn}>
        {t.pass}
      </button>
    {/if}
  </div>

  <!-- Overlap only: we are on one card (so LOCO borrows the centre) AND somebody
       else is catchable. Out of the grid flow entirely, so its arrival cannot push
       the three fixed slots. -->
  {#if canCatch && locoTurn}
    <div class="catchSlot" data-slot="float">
      <button class="btn btnCatch armed" onclick={onCatch}>{t.catchBtn}</button>
    </div>
  {/if}
</div>

<style>
  /* The only always-on control surface. Every button is a physical chunky object:
     ink outline, solid ledge underneath, travels down on press.

     Layout is a THREE-COLUMN GRID OF FIXED WIDTH, not a content-sized flex row:
     draw left, reaction button centre, pass right. Slots keep their column whether
     or not they hold a button, and the bar's own width never changes, so each
     control stays on the same screen pixel for the whole match. LOCO is a reaction
     game — the player parks the cursor over the centre before the card that needs
     it lands, and a bar that reflows (penalty draw appearing) moves the target out
     from under them.

     The centre column carries whichever race is live: Catch while somebody else
     sits on an undeclared single card, LOCO when we are the one on a single card.
     Both are the same target, which is what makes a few-second catch window
     actually hittable. */

  .actionBar {
    position: absolute;
    /* Clear of the home indicator: the swipe bar sits over the bottom band and
       would eat taps aimed at the draw and pass buttons. */
    bottom: calc(14px + var(--safe-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    grid-template-columns: var(--slot-w) var(--slot-w-mid) var(--slot-w);
    gap: var(--space-sm);
    align-items: center;
    /* Sized for the widest label each column can hold IN ANY LANGUAGE: "Piocher
       +4" on the outside, "Contre-LOCO !" in the middle (English's "Catch!" is
       far shorter, but the column must not resize when the player switches
       language mid-match). Different widths, both constant — what must never
       change is a column's width *during* a match. */
    --slot-w: 126px;
    --slot-w-mid: 172px;
    padding: var(--space-sm) var(--space-md);
    /* Solid, not glass. This is the one always-on control surface in the game and
       it was the only backdrop-filtered *panel* in the client: every other blur
       here is a modal scrim, which is the single place the system allows one. A
       translucent bar also put whatever card happened to be behind it into the
       contrast of its own labels, which on the felt changes from round to round.
       Opaque, inked and ledged, like every other object a player presses. */
    background: var(--color-surface-card);
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard);
    white-space: nowrap;
    z-index: 20;
  }

  /* A slot always occupies its column, empty or not. */
  .slot {
    display: flex;
    justify-content: center;
    min-width: 0;
  }

  /* Catch only sits beside the bar when LOCO already owns the centre (we are on
     one card and somebody else is catchable). Out of the grid, so it shifts
     nothing. */
  .catchSlot {
    position: absolute;
    left: 100%;
    margin-left: var(--space-sm);
    top: 50%;
    transform: translateY(-50%);
  }

  .catchSlot .btn {
    width: auto;
    padding: 10px 18px;
  }

  /* Base button */
  .btn {
    width: 100%;
    padding: 10px 14px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    font: 600 15px/1.2 var(--font-display);
    cursor: pointer;
    min-height: 44px;
    min-width: 64px;
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out),
      filter 0.12s ease,
      opacity 0.15s ease;
    position: relative;
    overflow: hidden;
  }

  .btn:not(:disabled):hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 0 var(--color-stroke-soft);
    filter: brightness(1.06);
  }

  .btn:not(:disabled):active {
    transform: translateY(2px);
    box-shadow: 0 1px 0 var(--color-stroke-soft);
  }

  /* Disabled state.
     Deliberately *not* the fill swap the rest of the game uses (surface-strong +
     muted label): on this bar `.btnPass` already wears surface-strong while it is
     enabled, so a fill swap would draw a disabled button and a live Pass as the
     same object. The ledge is what carries the meaning instead — a disabled
     object is flat and has stopped being a body. Held at 0.55 rather than 0.42
     because Catch sits here disabled for most of the match and a spectator still
     has to be able to read what the centre column is for. */
  .btnDisabled,
  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    pointer-events: none;
    box-shadow: none;
  }

  /* Draw button — primary */
  .btnDraw {
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    text-shadow: 0 1px 0 rgba(120, 10, 40, 0.4);
  }

  /* Draw — secondary (the player already has a legal card, so drawing is a choice
     rather than the expected move). */
  .btnDrawSecondary {
    background: var(--color-surface-card);
    color: var(--color-ink);
  }

  /* Pass button */
  .btnPass {
    background: var(--color-surface-strong);
    color: var(--color-ink);
  }

  /* UNO button — the signature move, so it gets the signature colour. */
  .btnUno {
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    font-weight: 700;
    letter-spacing: 0.3px;
    --arm-glow: rgba(255, 196, 46, 0.6);
    --arm-glow-0: rgba(255, 196, 46, 0);
  }

  /* The moment a race becomes winnable. Both the catch window and our own LOCO
     get the SAME punch-in and the same pulsing halo, deliberately: the two are the
     same wager seen from opposite sides of the table, and the player about to be
     caught must not get a louder cue than the player who could catch them. Loud on
     purpose — this is a seconds-long window, and a state change signalled only by
     an opacity going from 0.42 to 1 is one nobody notices in peripheral vision
     while they are reading their hand. */
  .armed {
    animation:
      armPop 0.42s var(--ease-bounce),
      armGlow 0.85s ease-in-out 0.42s infinite alternate;
    z-index: 1; /* the pop overshoots its slot; it must ride over its neighbours */
  }

  @keyframes armPop {
    0% {
      transform: scale(0.62) rotate(-7deg);
      filter: brightness(2.1);
    }
    55% {
      transform: scale(1.2) rotate(3deg);
      filter: brightness(1.35);
    }
    100% {
      transform: scale(1);
      filter: brightness(1);
    }
  }

  @keyframes armGlow {
    from {
      box-shadow:
        0 3px 0 var(--color-stroke-soft),
        0 0 0 0 var(--arm-glow),
        0 0 14px 2px var(--arm-glow);
    }
    to {
      box-shadow:
        0 3px 0 var(--color-stroke-soft),
        0 0 0 16px var(--arm-glow-0),
        0 0 22px 4px var(--arm-glow);
    }
  }

  /* Penalty draw — urgent. */
  .btnPenalty {
    background: linear-gradient(180deg, #ff8a5c 0%, #ef3d2a 100%);
    color: var(--color-on-primary);
    text-shadow: 0 1px 0 rgba(120, 20, 0, 0.45);
    animation: penaltyPulse 0.9s ease-in-out infinite alternate;
  }

  /* Catch button — live only inside the 5s window, so it must grab the eye then,
     and stay a recognisable dead object the rest of the time (see `.armed`). */
  .btnCatch {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.4);
    --arm-glow: rgba(155, 139, 255, 0.62);
    --arm-glow-0: rgba(155, 139, 255, 0);
  }

  @keyframes penaltyPulse {
    from {
      box-shadow:
        0 3px 0 var(--color-stroke-soft),
        0 0 0 0 rgba(239, 61, 42, 0.55);
    }
    to {
      box-shadow:
        0 3px 0 var(--color-stroke-soft),
        0 0 0 12px rgba(239, 61, 42, 0);
    }
  }

  @media (max-width: 480px) {
    /* Edge to edge, three equal columns: the bar spans a known width, so thirds
       are as stable as the desktop fixed slots — and the reaction button stays
       dead centre, under the thumb. */
    .actionBar {
      bottom: calc(8px + var(--safe-bottom));
      left: calc(8px + var(--safe-left));
      right: calc(8px + var(--safe-right));
      transform: none;
      /* The centre takes the extra share it needs for "Contre-LOCO !" — the two
         outer labels are short. */
      grid-template-columns: 1fr 1.35fr 1fr;
      gap: var(--space-xs);
      padding: var(--space-xs) var(--space-sm);
      border-radius: var(--radius-full);
    }

    .btn {
      min-height: 44px;
      padding: 10px 8px;
      min-width: 0;
      font-size: 14px;
    }

    /* No room to the side of a full-width bar — catch floats above its right end. */
    .catchSlot {
      left: auto;
      right: 0;
      top: auto;
      bottom: calc(100% + 8px);
      margin-left: 0;
      transform: none;
    }
  }

  :root[data-motion="reduce"] .btnPenalty {
    animation: none;
  }

  /* Degrades to a static halo rather than to nothing: "this button just became
     clickable" is information, not decoration. */
  :root[data-motion="reduce"] .armed {
    animation: none;
    box-shadow:
      0 3px 0 var(--color-stroke-soft),
      0 0 0 5px var(--arm-glow);
  }
</style>
