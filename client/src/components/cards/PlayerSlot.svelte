<script lang="ts" module>
  /**
   * Backs that are on their way to this hand and must not be drawn before they
   * land: card index → milliseconds after `at` at which it may appear. Set by
   * the board for the same instant it launches the fliers, so a card drawn is
   * seen leaving the deck and *then* sitting in the fan, never both at once.
   */
  export interface FanHold {
    /** `Date.now()` when the fliers left. Also the key the hold is re-armed on. */
    at: number
    delays: Record<number, number>
  }

  /** A knock the whole hand takes when something lands in it hard (a Contre-LOCO!). */
  export interface FanJolt {
    at: number
    /** ms after `at`: the flight time of what is landing. */
    delay: number
  }
</script>

<script lang="ts">
  import CardBack from './CardBack.svelte'
  import { radToDeg, SEAT_SPECS } from './cardTheme'
  import { fanExtent, seatFan, type SeatPlace } from './layout'
  import { prefersReducedMotion } from '../../hooks/motionPref'

  type Props = {
    nickname: string
    handSize: number
    isActiveTurn: boolean
    isDisconnected: boolean
    /** Chosen by seatLayout(): where the hand is, which way it is held, and at what size. */
    seat: SeatPlace
    hold?: FanHold | null
    jolt?: FanJolt | null
  }

  let { nickname, handSize, isActiveTurn, isDisconnected, seat, hold = null, jolt = null }: Props =
    $props()

  const spec = $derived(SEAT_SPECS[seat.size])
  const mini = $derived(seat.size === 'mini')
  const fan = $derived(seatFan(seat.size, handSize, seat.lay))
  const plate = $derived(seat.plate)
  // A hand held up wears the turn marker over its top, where the eye already
  // is. A hand lying on the felt has its place light up instead, and the
  // marker rides the plate, as it does on a mini seat, which has no hand.
  const fanBox = $derived(seat.onFelt ? null : fanExtent(seat.size, Math.max(handSize, 1), seat.lay))
  // The place on the felt, for its glow: the fullest the hand spreads, and a margin.
  const place = $derived.by(() => {
    const c = spec.card
    if (!seat.onFelt || !c) return null
    return { w: seat.lay.span + c.w + 44, h: c.h + 40 }
  })

  /**
   * Keeps a back out of sight until its flier has landed on it.
   *
   * Keyed on the hold's own stamp, never re-run by the ordinary re-renders a
   * busy board produces: reading a prop is not depending on its value, and a
   * hold re-armed by an unrelated message would hide a card that had already
   * landed. `fill: backwards` is the whole of the hiding — the card is at
   * opacity 0 through the delay and fades up in the last few frames.
   */
  function arrive(node: HTMLElement, arg: { hold: FanHold | null; i: number }) {
    let armed = 0
    const run = (a: typeof arg) => {
      const h = a.hold
      if (!h || h.at === armed) return
      armed = h.at
      const d = h.delays[a.i]
      if (d === undefined || typeof node.animate !== 'function') return
      const left = h.at + d - Date.now()
      if (left <= 0) return
      node.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 90,
        delay: Math.max(0, left - 90),
        fill: 'backwards',
      })
    }
    run(arg)
    return { update: run }
  }

  let fanEl = $state<HTMLDivElement | null>(null)
  // The knock is on the `translate` property, never `transform`: the fan's
  // breathing owns `scale`, and two animations on one transform would take
  // turns overwriting each other. Guarded on the jolt's timestamp, the same
  // rule every animation effect on the board follows.
  let joltedAt = 0
  $effect(() => {
    const j = jolt
    const el = fanEl
    if (!j || !el || j.at === joltedAt) return
    joltedAt = j.at
    if (prefersReducedMotion() || typeof el.animate !== 'function') return
    const left = Math.max(0, j.at + j.delay - Date.now())
    el.animate(
      [
        { translate: '0 0' },
        { translate: '-7px 3px' },
        { translate: '6px -2px' },
        { translate: '-4px 1px' },
        { translate: '2px 0' },
        { translate: '0 0' },
      ],
      { duration: 420, delay: left, easing: 'ease-out' },
    )
  })
</script>

<!--
  An opponent: their hand, face down, held towards the felt, and a plate with
  their name, the exact count, and whose turn it is.

  The seat is placed by transform rather than left/top so it glides when the
  layout is recomputed (a player joins or leaves, or the window is resized).
  Each back is placed by its own transform, which is what lets the fan re-spread
  on a CSS transition as the hand grows and shrinks instead of jumping.
-->
<div
  class="seat"
  class:active={isActiveTurn}
  class:disconnected={isDisconnected}
  class:danger={handSize === 1}
  class:onFelt={seat.onFelt}
  aria-label="player {nickname}"
  style="transform: translate({seat.x}px, {seat.y}px)"
>
  {#if place && isActiveTurn}
    <!-- Laid on the felt like the hand: turned and flattened with it. -->
    <div
      class="placeGlow"
      aria-hidden="true"
      style="width: {place.w}px; height: {place.h}px; transform: translate({-place.w / 2}px, {-place.h /
        2}px) scale(1, {seat.lay.squash}) rotate({radToDeg(seat.lay.rotation)}deg)"
    ></div>
  {/if}
  {#if spec.card}
    {@const c = spec.card}
    <div class="fan" bind:this={fanEl} aria-hidden="true">
      {#each fan as b, i (i)}
        <div
          class="back"
          style="width: {c.w}px; height: {c.h}px; transform: translate({b.x - c.w / 2}px, {b.y -
            c.h / 2}px) scale(1, {b.squash}) rotate({radToDeg(b.rotation)}deg)"
          use:arrive={{ hold, i }}
        >
          <div class="backInner" style="border-radius: {c.r}px">
            <CardBack width={c.w} height={c.h} radius={c.r} />
          </div>
        </div>
      {/each}
    </div>
  {/if}
  {#if isActiveTurn && fanBox}
    <div
      class="dot dotOverFan"
      style="transform: translate({fanBox.left + fanBox.width / 2 - 7}px, {fanBox.top - 16}px)"
    ></div>
  {/if}
  <div
    class="plate"
    class:mini
    class:compact={seat.size === 'compact'}
    style="width: {spec.plateW}px; height: {spec.plateH}px; transform: translate({plate.x -
      spec.plateW / 2}px, {plate.y - spec.plateH / 2}px)"
  >
    {#if isActiveTurn && !fanBox}<div class="dot"></div>{/if}
    <!-- The name shortens, the mark never does: a seat whose nickname fills the
         plate is exactly the seat whose "gone" was being ellipsed away when the
         two shared one string. Drawn rather than `✗`, which at 11px on a mini
         seat is whatever glyph the fallback font had. -->
    <div class="label">
      <span class="labelName">{nickname}</span>
      {#if isDisconnected}
        <svg class="goneMark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M6 6l12 12M18 6L6 18"
            fill="none"
            stroke="currentColor"
            stroke-width="3"
            stroke-linecap="round"
          />
        </svg>
      {/if}
    </div>
    <!-- The exact count. The fan says how many at a glance, but nobody counts
         eleven backs at 720p, and a spectator tracking who is about to win needs
         the number — on a mini seat it is the only card information there is. -->
    <div class="count" class:countDanger={handSize === 1} aria-hidden="true">{handSize}</div>
  </div>
</div>

<style>
  /* The seat's anchor is the middle back of its fan; everything inside is
     placed relative to it by `layout.ts: seatFan / seatPlate`, which the
     board's fliers read too. Sizes mirror cardTheme.ts (SEAT_SPECS). */
  .seat {
    position: absolute;
    left: 0;
    top: 0;
    width: 0;
    height: 0;
    pointer-events: none;
    font-family: var(--font-display);
    /* No `will-change` here. A seat moves when the layout is recomputed — a
       join, a leave, a resize — which is a handful of times a match. */
    transition: transform 260ms var(--ease-bounce);
  }

  .fan {
    position: absolute;
    left: 0;
    top: 0;
    /* Its own two properties, and nothing else may animate them: `scale` is the
       breathing of a hand whose turn it is, `translate` the knock of a penalty
       landing in it. */
    scale: 1;
    transition: filter 200ms ease;
  }

  /* A place whose turn it is lights up on the felt, in the gold the plate
     wears: a pool under the hand, not a halo round it. */
  .placeGlow {
    position: absolute;
    left: 0;
    top: 0;
    border-radius: 50%;
    background: radial-gradient(closest-side, rgba(255, 214, 90, 0.5), rgba(255, 214, 90, 0.18) 62%, transparent);
    animation: placeGlow 2.6s ease-in-out infinite;
  }

  @keyframes placeGlow {
    0%,
    100% {
      opacity: 0.75;
    }
    50% {
      opacity: 1;
    }
  }

  /* The hand whose turn it is breathes, so a viewer sees who is thinking from
     the cards and not only from the plate. A breath, not a bounce: the gold
     plate already says whose turn it is, and at 7% every 1.6s the hand pulsed
     louder than the moments allowed to shout. */
  .seat.active:not(.onFelt) .fan {
    animation: fanBreath 2.6s ease-in-out infinite;
  }

  @keyframes fanBreath {
    0%,
    100% {
      scale: 1;
    }
    50% {
      scale: 1.025;
    }
  }

  /* A seat that is gone holds its cards in the dark. A hue, never an opacity. */
  .seat.disconnected .fan {
    filter: saturate(0.25) brightness(0.72);
  }

  .back {
    position: absolute;
    left: 0;
    top: 0;
    transform-origin: 50% 50%;
    /* The fan re-spreads as the hand grows or shrinks. */
    transition: transform 280ms var(--ease-out);
  }

  .backInner {
    filter: drop-shadow(0 2px 0 var(--color-stroke-soft));
  }

  /* One card left: the moment the whole table is watching for. The last back
     burns red, on its own layer so the fan's placement never has to share. */
  .seat.danger .backInner {
    animation: lastCard 1.1s ease-in-out infinite;
  }

  @keyframes lastCard {
    0%,
    100% {
      filter: drop-shadow(0 2px 0 var(--color-stroke-soft)) drop-shadow(0 0 4px var(--color-primary));
      rotate: 0deg;
    }
    25% {
      rotate: -5deg;
    }
    50% {
      filter: drop-shadow(0 2px 0 var(--color-stroke-soft)) drop-shadow(0 0 12px var(--color-primary));
      rotate: 4deg;
    }
    75% {
      rotate: -2deg;
    }
  }

  /* The name plate — a chunky sticker pill across the foot of the hand it names, holding it. */
  .plate {
    position: absolute;
    left: 0;
    top: 0;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 22px 0 12px;
    border-radius: var(--radius-full);
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    box-shadow: var(--shadow-hard);
    /* Turn / connection state changes fade rather than snap, and the plate
       follows the foot of a leaning hand as it thins. */
    transition:
      transform 280ms var(--ease-out),
      border-color 200ms ease,
      background-color 200ms ease,
      box-shadow 200ms ease;
  }

  /* Active seat: the plate turns into the brightest object on screen. On a
     stream the viewer should never have to hunt for whose turn it is. */
  .seat.active .plate {
    background: linear-gradient(180deg, #ffe58a 0%, var(--color-secondary) 100%);
    box-shadow:
      var(--shadow-hard),
      0 0 0 5px rgba(255, 201, 60, 0.4),
      0 0 26px 6px rgba(255, 201, 60, 0.45);
  }

  /* A seat that is gone is quiet, and quiet is a hue. The fill and the outline
     dim; the ink does not — a nickname a spectator cannot read on the seat whose
     absence is the news is the one failure this state must not have. */
  .seat.disconnected .plate {
    background: var(--color-surface-strong);
    border-color: var(--color-border-strong);
  }

  /* Crowded phone table: the plate is the whole seat, name and count only. */
  .plate.mini {
    padding: 0 8px;
  }

  .plate.mini .label {
    font-size: 11px;
    max-width: 68px;
  }

  .plate.mini .count,
  .plate.compact .count {
    min-width: 24px;
    height: 24px;
    font-size: 13px;
    top: -9px;
    right: -7px;
  }

  .plate.mini .dot,
  .plate.compact .dot {
    top: -15px;
    border-left-width: 6px;
    border-right-width: 6px;
    border-top-width: 8px;
    margin-left: -6px;
  }

  .plate.compact {
    padding: 0 16px 0 8px;
  }

  .plate.compact .label {
    font-size: 12px;
  }

  .label {
    font: 600 14px/1.2 var(--font-display);
    color: var(--color-ink);
    min-width: 0;
    max-width: 100%;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* The ellipsis belongs to the name alone. `min-width: 0` is what lets a flex
     item shrink below its content. Without it the name pushes the mark out of
     the plate instead of truncating. */
  .labelName {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Sized in `em` so it follows the three seat sizes without three rules. */
  .goneMark {
    flex-shrink: 0;
    width: 0.85em;
    height: 0.85em;
  }

  .seat.active .label {
    color: var(--color-on-secondary);
    font-weight: 700;
  }

  /* `--color-muted`, never `-soft`: 4.5:1 on the dimmed fill. */
  .seat.disconnected .label {
    color: var(--color-muted);
  }

  /* Card count — sits on the plate's right edge, straddling the outline. The
     number a spectator tracks the race by, so a size up from the name. */
  .count {
    position: absolute;
    top: -11px;
    right: -10px;
    min-width: 30px;
    height: 30px;
    padding: 0 6px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--color-tertiary);
    border: var(--stroke-thin) solid var(--color-stroke);
    color: var(--color-on-dark);
    font: 700 16px/1 var(--font-display);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  .countDanger {
    background: var(--color-primary);
    animation: countPulse 1.1s var(--ease-bounce) infinite;
  }

  @keyframes countPulse {
    0%,
    100% {
      transform: scale(1);
    }
    50% {
      transform: scale(1.18);
    }
  }

  /* Over the hand, the marker is placed by the seat's transform; the bob
     rides `translate`, the property the placement leaves alone. */
  .dotOverFan {
    top: 0;
    left: 0;
    margin-left: 0;
    animation-name: turnArrowBobOver;
  }

  @keyframes turnArrowBobOver {
    0%,
    100% {
      translate: 0 0;
    }
    50% {
      translate: 0 5px;
    }
  }

  /* Bouncing marker above the active plate — the same "it's you" language
     Nintendo uses for a selected character. */
  .dot {
    position: absolute;
    top: -18px;
    left: 50%;
    margin-left: -7px;
    width: 0;
    height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-top: 10px solid var(--color-secondary);
    filter: drop-shadow(0 2px 0 var(--color-stroke));
    animation: turnArrowBob 1.1s ease-in-out infinite;
  }

  @keyframes turnArrowBob {
    0%,
    100% {
      transform: translateY(0);
    }
    50% {
      transform: translateY(5px);
    }
  }

  /* Motion degrades to a readable still: the last card keeps its red glow at
     full, the active hand simply stops breathing. */
  :root[data-motion="reduce"] .seat,
  :root[data-motion="reduce"] .back,
  :root[data-motion="reduce"] .plate {
    transition: none;
  }

  :root[data-motion="reduce"] .seat.active .fan,
  :root[data-motion="reduce"] .placeGlow,
  :root[data-motion="reduce"] .dot,
  :root[data-motion="reduce"] .countDanger {
    animation: none;
  }

  :root[data-motion="reduce"] .seat.danger .backInner {
    animation: none;
    filter: drop-shadow(0 2px 0 var(--color-stroke-soft)) drop-shadow(0 0 10px var(--color-primary));
  }
</style>
