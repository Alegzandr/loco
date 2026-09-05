<script lang="ts">
  import type { Translations } from '../i18n/en'
  import { drainBar } from '../hooks/drainBar.svelte'
  import { pressToAct } from './press'

  type Props = {
    isMyTurn: boolean
    pendingDraw: number
    handSize: number
    hasDrawn: boolean
    hasPlayableCard: boolean
    /**
     * True while another player sits on a single card without having called it.
     * Driven by the catch window, not by uno_declared — a declaration is exactly
     * the moment catching stops being possible. This arms the button; it is not
     * what makes it pressable.
     */
    catchArmed: boolean
    /**
     * True while some other seat is close enough to finishing to be worth
     * watching (`catchAvailability.ts`). This is what makes the button pressable,
     * and it is deliberately looser than `catchArmed`: a press that finds nobody
     * on the hook is a card, not a refusal, so the player can commit to the
     * gesture before the server has named anybody. A seat on exactly two
     * cards, or on its last card inside its window — and a seat that calls
     * LOCO! does not pull the button out from under the thumb already aiming
     * at it: the window runs its course either way. That miss is the wager,
     * and the interface does not get to make it for anybody.
     */
    catchLive: boolean
    /**
     * A Contre-LOCO! we pressed that the server has not answered yet. The
     * button holds itself down for exactly that long (`.called`): the verdict
     * is the server's, the press is ours, and the one has to be seen the
     * instant it is made or the round trip reads as a control that did nothing.
     */
    catchPending: boolean
    /**
     * True while our own last Contre-LOCO! has us locked out of the mechanic
     * (`game.catchLockout`). It is one of the reasons `catchLive` is false, and
     * the only one the player caused: the card a missed call costs is rationed
     * per offer, so mashing used to be free after the first one and took, for
     * nothing, whichever window happened to open under the thumb. The lockout
     * is rationed per press instead, which is why the button has to *say* it —
     * a control that goes quiet without a reason is one the player keeps
     * pressing, and pressing is exactly what re-arms it.
     */
    catchLocked: boolean
    /**
     * When that lockout ends, absolute on our own clock. The bar under the
     * padlock drains to it, so the player can wait it out instead of guessing,
     * and a press made in the meantime pushes it out again.
     */
    catchLockedUntil: number
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
    catchArmed,
    catchLive,
    catchPending,
    catchLocked,
    catchLockedUntil,
    hasDeclared,
    onDraw,
    onPass,
    onUno,
    onCatch,
    t,
  }: Props = $props()

  // The centre column is CATCH's, all match, with nothing else ever in it. It is
  // by far the hardest button in the game to hit — it opens on someone else's
  // mistake and lives for seconds — so it has to be the one control the player
  // never has to look for, and it has to be pressable *before* the server names
  // a target, or the gesture is always a reply and never a read. `catchLive` is
  // that: somebody is close to finishing, so the wager is on the table.
  //
  // LOCO! sits above the bar, on the same axis, on screen the whole match and
  // dead until it is owed. Two reasons it is not a fourth column and not a thing
  // that appears: the bar may not grow a fourth target a reaction is aimed at,
  // and a control that only exists for the seconds it matters is a control the
  // player has never once looked at before the moment they need it. Drawn small
  // and quiet on purpose — forgetting the call is a turn of the game, not a
  // mistake the interface is meant to prevent.
  const locoOwed = $derived(handSize === 1 && !hasDeclared)

  // The two outer columns are drawn all match and go dead rather than away, so
  // the only thing these decide is whether the button is pressable — never
  // whether it is there. One draw a turn, and a pass costs that draw first;
  // outside our turn neither is ours to take.
  const canDraw = $derived(isMyTurn && !hasDrawn)
  const canPass = $derived(isMyTurn && pendingDraw === 0 && hasDrawn)

  // The lockout's own countdown, drained on the compositor like every other
  // window in this game: the element is handed one CSS animation whose duration
  // is what is left, and nothing here re-renders while it runs. `'auto'`
  // anchors "full" to whatever remained when the deadline arrived, which for a
  // lock is its whole length — and a press that re-arms it hands over a new
  // deadline, so the bar starts over at full rather than resuming somebody
  // else's clock.
  let lockFill = $state<HTMLSpanElement | null>(null)
  drainBar(
    () => lockFill,
    () => (catchLocked ? catchLockedUntil : null),
    'auto',
  )
</script>

<!--
  Fixed three-column grid: draw left, reaction button centre, pass right. The
  slots keep their width whether or not they hold a button, so every control sits
  at the same screen pixel all match long and can be aimed at before it lights up
  — this is a speed game, and a bar that reflows under the cursor costs a win.

  And every column holds its button the whole match, dead when the action is not
  available, exactly like Catch and LOCO!. Reserving the width was only half of
  it: on somebody else's turn the two outer slots emptied, and the bar became one
  lone pill floating in a wide trough — the outline pinching to a point at each
  end of it, four little teeth that appeared and went with the turn. The
  silhouette a thumb aims at cannot be one shape on our turn and another on
  theirs, and a control that is drawn only while it is pressable is one the
  player has never once looked at before the moment they need it.
-->
<div class="actionBar">
  <div class="slot" data-slot="left">
    <!-- The penalty draw is the one swap left in the bar, and it is deliberate:
         it is the same button in the same column, recoloured and pulsing because
         the stack is the most urgent thing that happens in a round. It is ours
         only — on somebody else's turn the stack is theirs to answer, so the
         column stays the ordinary draw, dead. -->
    {#if isMyTurn && pendingDraw > 0}
      <button class="btn btnPenalty" use:pressToAct={onDraw}>{t.draw} +{pendingDraw}</button>
    {:else}
      <button
        class="btn"
        class:btnDisabled={!canDraw}
        class:btnDrawSecondary={!canDraw || hasPlayableCard}
        class:btnDraw={canDraw && !hasPlayableCard}
        use:pressToAct={onDraw}
        disabled={!canDraw}
      >
        {t.draw}
      </button>
    {/if}
  </div>

  <div class="slot" data-slot="center">
    <!-- Never anything else, and never absent. Pressable as soon as any seat is
         within reach of finishing; armed only once one of them actually owes the
         call. Pressing it in between costs a card, which is what makes pressing
         it a read rather than a reflex test. -->
    <!-- And held down from the press to the verdict. The press is the one
         thing about a Contre-LOCO! that is decided on this screen, so it is
         shown here and now; everything after it — the stamp, the penalty, the
         card drawn for a miss — waits for the server, and the round trip is
         the network's, not this button's to hide. -->
    <!-- And locked, for a couple of seconds, whenever our own last call found
         nobody. That state is drawn rather than merely dead: `:disabled`
         already cuts the button into the bar like every other unavailable
         control, and on top of it go a padlock and a bar draining to the
         instant the server named. The reason is the mechanic itself — the
         lockout is what a held thumb pays, and a player who cannot see it is a
         player who keeps pressing and keeps pushing it out.

         It also takes the halo off. `catchArmed` says somebody at the table
         owes a call, which stays true while we are locked out of answering it,
         and a control that pulses over a press it will refuse is the one lie a
         reaction bar cannot afford. The capsule above still names the window:
         the opening is real, it is just not ours this time. -->
    <button
      class="btn btnCatch"
      class:armed={catchArmed && !catchLocked}
      class:called={catchPending}
      use:pressToAct={onCatch}
      disabled={!catchLive}
      aria-label={catchLocked ? t.catchLockedLabel : undefined}
    >
      <span class="catchFace">
        {#if catchLocked}
          <!-- Drawn, like every glyph in this game: a shackle stroked in the
               label's own colour over a solid body, so it reads at 720p and
               takes the disabled ink without being told to. -->
          <svg class="lockGlyph" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M8.2 10.4V7.6a3.8 3.8 0 0 1 7.6 0v2.8"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              stroke-linecap="round"
            />
            <rect x="4.6" y="10.2" width="14.8" height="10.4" rx="2.8" fill="currentColor" />
          </svg>
        {/if}
        <span class="catchLabel">{t.catchBtn}</span>
      </span>
      {#if catchLocked}
        <span class="lockTrack" aria-hidden="true">
          <span class="lockFill loco-slide" bind:this={lockFill}></span>
        </span>
      {/if}
    </button>
  </div>

  <div class="slot" data-slot="right">
    <button class="btn btnPass" class:btnDisabled={!canPass} use:pressToAct={onPass} disabled={!canPass}>
      {t.pass}
    </button>
  </div>

  <!-- Always here, above the bar and out of the grid flow, so neither its arming
       nor its spending can push the three fixed slots. Dead unless we are sitting
       on a single uncalled card: the player learns where it is over a whole match
       instead of hunting for it in the two seconds it is worth pressing. -->
  <div class="locoSlot" data-slot="loco">
    <button
      class="btn btnUno"
      class:armed={locoOwed}
      class:hit-target={locoOwed}
      use:pressToAct={onUno}
      disabled={!locoOwed}
    >
      {t.unoBtn}
    </button>
  </div>
</div>

<style>
  /* The only always-on control surface. Every button is a physical chunky object:
     ink outline, solid ledge underneath, travels down on press.

     Layout is a THREE-COLUMN GRID OF FIXED WIDTH, not a content-sized flex row:
     draw left, reaction button centre, pass right. Every column holds its button
     for the whole match — dead when the action is not ours, never absent — and the
     bar's own width never changes, so each control stays on the same screen pixel
     from the deal to the last card. LOCO is a reaction game: the player parks the
     cursor over the centre before the card that needs it lands, and a bar that
     reflows (penalty draw appearing) moves the target out from under them. A slot
     that *empties* moves nothing, but it changes the shape the thumb is aiming at,
     which is the same failure one step further out — see the markup above.

     The centre column is Contre-LOCO's and holds nothing else, ever. It is the
     one control in the game whose window is measured in seconds and opens on
     somebody else's mistake, so it gets the pixel the thumb is already resting
     on. LOCO! is a chip centred above the bar, out of the grid and permanently on
     screen: it is ours, it has no deadline, and the hand is dealt clear of it
     (`BOTTOM_RESERVE`) so nothing moves when it lights up. */

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
       +4" on the outside, "Contre-LOCO!" in the middle (English's "Catch!" is
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

  /* LOCO! — centred above the bar, on the axis the hand is centred on, out of the
     grid so it shifts none of the three columns.

     Drawn deliberately smaller and quieter than a bar button. Forgetting to call
     it is one of the game's turns, not a mistake the interface exists to prevent:
     a chip the size of Catch, sat over the fan all match, would read as a fourth
     action and pull the eye away from the centre column every round. The 10px gap
     is what keeps its 44px hit target (`.hit-target`) clear of the bar's top
     edge — the target is 5px taller than the paint on each side, and the button
     it must not steal a tap from is Catch. */
  .locoSlot {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 10px);
    transform: translateX(-50%);
  }

  .locoSlot .btn {
    width: auto;
    min-height: 34px;
    padding: 6px 22px;
    font-size: 14px;
    letter-spacing: 0.4px;
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
      filter 0.12s ease;
    position: relative;
    /* No `overflow: hidden`. It clipped everything a button hangs outside its
       own box: the 44px `.hit-target::after` on the LOCO! chip — drawn 34px,
       and the catcher it was promised was being cut back to the paint — and
       the halo pseudo-elements below. Nothing inside a pill overflows it. */
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

  /* Disabled state — a slot cut into the bar, not a button waiting to be pressed.
     Quiet is a hue, so the state was already a fill swap rather than an opacity
     (0.55 put the dead Catch label at ~2:1, and Catch is disabled through the
     opening of every round). But the fill it swapped to was
     `--color-surface-strong`, which is exactly what a *live* Pass wears: the two
     differed by a label colour and a missing ledge, so half the bar read as
     pressable at a glance for the whole of somebody else's turn.

     Three things say it now, and they are the inverse of the three that make
     every raised object in this game:
       - the fill is BELOW the bar rather than on it (`--color-surface-sunken`,
         desaturated as well as darker — the live Pass keeps the lilac),
       - the hard ledge underneath is replaced by a hard shadow INSIDE the top
         edge, which is the same 0-blur vocabulary read as a hollow,
       - the outline drops to the hairline. Not the ink, and not the panel
         border either: at `--color-border-strong` on a sunken fill the dead
         buttons came out as ringed ghost pills, which is a pressable shape in
         every other interface a player has used.
     The label is `--color-disabled-ink`, 5.1:1 in light and 6.1:1 in dark,
     because a spectator at 720p still has to be able to read what the centre
     column is for. */
  .btn.btnDisabled,
  .btn:disabled {
    background: var(--color-surface-sunken);
    border-color: var(--color-hairline);
    color: var(--color-disabled-ink);
    text-shadow: none;
    cursor: not-allowed;
    pointer-events: none;
    box-shadow: inset 0 2px 0 var(--color-stroke-soft);
  }

  /* Locked Contre-LOCO!. Everything that makes it look dead is already
     `.btn:disabled` above — sunken fill, hairline outline, hard shadow inside
     the top edge — because a locked button is a dead button with a reason, not
     a fourth kind of object. What is added is the reason: the padlock, and the
     bar that says how much of it is left.

     The bar is inside the pill and clips itself: `.btn` deliberately carries no
     `overflow: hidden` (it would cut the hit targets and the halos off every
     other control), so the track owns the rounding and the fill slides out of
     it. `loco-slide` rather than a scale, like every other countdown here — the
     fill is drawn back out of its slot instead of being squashed flat. */
  .catchFace {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 0;
  }

  .catchLabel {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .lockGlyph {
    width: 15px;
    height: 15px;
    flex: none;
    /* The shackle is stroked and the body filled, both in the label's colour,
       so the glyph follows `--color-disabled-ink` without naming it. */
    color: inherit;
  }

  .lockTrack {
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 6px;
    height: 4px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--color-hairline);
    pointer-events: none;
  }

  .lockFill {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    background: var(--color-disabled-ink);
  }

  /* Draw button — primary */
  .btnDraw {
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    text-shadow: 0 1px 0 rgba(120, 10, 40, 0.4);
  }

  /* Draw — secondary (the player already has a legal card, so drawing is a choice
     rather than the expected move). Surface-strong like Pass, never surface-card:
     the bar itself is surface-card, so that was a white pill on a white bar in
     light, held apart by nothing but its outline. */
  .btnDrawSecondary {
    background: var(--color-surface-strong);
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
  }

  /* The moment a race becomes winnable. Both the catch window and our own LOCO
     get the SAME punch-in and the same pulsing halo, deliberately: the two are the
     same wager seen from opposite sides of the table, and the player about to be
     caught must not get a louder cue than the player who could catch them. Loud on
     purpose — this is a seconds-long window, and a state change signalled only by
     an opacity going from 0.42 to 1 is one nobody notices in peripheral vision
     while they are reading their hand. */
  .armed {
    animation: armPop 0.42s var(--ease-bounce);
    z-index: 1; /* the pop overshoots its slot; it must ride over its neighbours */
  }

  /* The press, acknowledged on the frame it lands. A call in flight is the
     button held down: the ledge collapses, the face darkens, and nothing else
     moves — the stamp and the penalty are the server's to deliver. It wins over
     `.armed`, whose pop and halo would otherwise carry on over a press already
     made, and it is a state rather than an animation so the round trip it
     covers looks the same at 5 ms and at 500. Static under reduced motion by
     construction. */
  .btnCatch.called,
  .btnCatch.called:not(:disabled):hover {
    animation: none;
    transform: translateY(3px);
    box-shadow: inset 0 0 0 999px rgba(30, 10, 90, 0.4);
    filter: brightness(0.82);
  }

  .btnCatch.called::before {
    animation: none;
    opacity: 0;
  }

  /* The pulsing halo, as a pseudo-element with a *static* shadow, breathed on
     opacity and scale. It was `armGlow`, a `box-shadow` keyframe on the button
     itself, infinite alternate — and a shadow that changes is repainted on every
     frame, for the whole of every catch window, on the one control this game
     asks to be answered fastest. Opacity and transform composite; the shadow is
     rasterised once. `::before` because `::after` is the 44px hit target on the
     LOCO! chip, and the two are armed together. `z-index: -1` inside the
     button's own stacking context (`.armed` sets one) puts the glow under the
     label and over the fill. */
  .armed::before {
    content: '';
    position: absolute;
    inset: -3px;
    z-index: -1;
    border-radius: inherit;
    box-shadow:
      0 0 0 4px var(--arm-glow),
      0 0 22px 6px var(--arm-glow);
    pointer-events: none;
    animation: armHalo 0.85s ease-in-out 0.42s infinite alternate;
  }

  @keyframes armHalo {
    from {
      opacity: 0.5;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1.05);
    }
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

  /* Penalty draw — urgent. The pulse is the same device as the armed halo: a
     ring on a pseudo-element, scaled out and faded, where it used to be a
     `box-shadow` spread keyframe repainting the button every frame for as long
     as the stack stood. `isolation` gives the button a stacking context of its
     own so the ring can sit under the label at `z-index: -1` (without it, -1
     would drop the ring behind the whole bar). */
  .btnPenalty {
    background: linear-gradient(180deg, #ff8a5c 0%, #ef3d2a 100%);
    color: var(--color-on-primary);
    text-shadow: 0 1px 0 rgba(120, 20, 0, 0.45);
    isolation: isolate;
  }

  .btnPenalty::before {
    content: '';
    position: absolute;
    inset: -2px;
    z-index: -1;
    border-radius: inherit;
    border: 4px solid rgba(239, 61, 42, 0.55);
    pointer-events: none;
    animation: penaltyPulse 0.9s ease-in-out infinite alternate;
  }

  /* Catch button — pressable whenever somebody is close to finishing, armed only
     once one of them owes the call. Three readable states, not two: dead while
     nothing is in reach, awake and pressable while it is a wager, and `.armed`
     for the seconds it is a certainty. */
  .btnCatch {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    text-shadow: 0 1px 0 rgba(30, 10, 90, 0.4);
    --arm-glow: rgba(155, 139, 255, 0.62);
  }

  @keyframes penaltyPulse {
    from {
      opacity: 0.85;
      transform: scale(1);
    }
    to {
      opacity: 0;
      transform: scale(1.2);
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

    /* The chip keeps its own size here: the rule above is more specific than this
       block's `.btn`, which is deliberate. A 44px LOCO! chip on a phone would be
       a second full-height button sat directly over the centre column. */
  }

  /* A phone on its side. The bar becomes a stack up the right edge — draw,
     Contre-LOCO!, pass, top to bottom, the reaction still in the middle — and
     the LOCO! chip keeps its place above it. The same three fixed slots that
     never reflow: only the axis turns, with the phone. The band this takes,
     its width plus its margins, is `layout.ts: SIDE_RESERVE`, which the board's
     coordinate space stops short of, and the height ceiling is
     `LANDSCAPE_MAX_H` there; `landscape.test.ts` pins both to this block. The
     `max-width: 480px` block above cannot match here — a phone on its side is
     wider than that — so every measurement it sets is set again. */
  @media (orientation: landscape) and (max-height: 559px) {
    .actionBar {
      left: auto;
      right: calc(10px + var(--safe-right));
      bottom: calc(10px + var(--safe-bottom));
      transform: none;
      grid-template-columns: var(--slot-w);
      grid-template-rows: repeat(3, auto);
      --slot-w: 124px;
      gap: var(--space-xs);
      padding: var(--space-xs);
    }

    .btn {
      min-height: 44px;
      padding: 10px 6px;
      min-width: 0;
      font-size: 14px;
    }

    .locoSlot .btn {
      min-height: 34px;
      padding: 6px 18px;
    }
  }

  :root[data-motion="reduce"] .btnPenalty::before {
    display: none;
  }

  /* Degrades to a static halo rather than to nothing: "this button just became
     clickable" is information, not decoration. The halo's shadow is static
     already; only its breathing stops. */
  :root[data-motion="reduce"] .armed {
    animation: none;
  }

  :root[data-motion="reduce"] .armed::before {
    animation: none;
    opacity: 1;
    transform: none;
  }
</style>
