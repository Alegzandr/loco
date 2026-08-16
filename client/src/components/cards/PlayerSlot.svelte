<script lang="ts">
  import CardBack from './CardBack.svelte'
  import { radToDeg, SEAT_DIMS, type SeatSize } from './cardTheme'

  type Props = {
    nickname: string
    handSize: number
    isActiveTurn: boolean
    isDisconnected: boolean
    x: number
    y: number
    /** Chosen by seatLayout() from the viewport and the number of opponents. */
    size?: SeatSize
  }

  let { nickname, handSize, isActiveTurn, isDisconnected, x, y, size = 'full' }: Props = $props()

  /** Mini-fan geometry per seat size. `mini` drops the fan entirely. */
  const FAN: Record<
    SeatSize,
    { maxVisible: number; miniW: number; miniH: number; miniR: number; stride: number } | null
  > = {
    full: { maxVisible: 9, miniW: 17, miniH: 25, miniR: 3, stride: 11 },
    compact: { maxVisible: 5, miniW: 13, miniH: 19, miniR: 2, stride: 9 },
    mini: null,
  }

  const fan = $derived(FAN[size])
  const dims = $derived(SEAT_DIMS[size])

  const n = $derived(fan ? Math.min(handSize, fan.maxVisible) : 0)
  const totalW = $derived(fan ? (n - 1) * fan.stride + fan.miniW : 0)
  const startX = $derived(-totalW / 2)
  const maxRot = $derived(((n > 4 ? 14 : n > 1 ? 8 : 0) * Math.PI) / 180)


  const backs = $derived(
    !fan
      ? []
      : Array.from({ length: n }, (_, i) => {
          const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0
          return {
            rot: radToDeg(t * maxRot),
            arcY: Math.abs(t) * 4,
            // Offset from the pill centre; expressed as a transform so the fan
            // reflows on a transition instead of jumping when the count changes.
            dx: startX + i * fan.stride + dims.w / 2 - fan.miniW / 2,
            opacity: 0.6 + (i / Math.max(n - 1, 1)) * 0.4,
          }
        }),
  )
</script>

<!--
  An opponent bubble centred on (x, y) — pill background, nickname, card count,
  fanned mini card backs, and an active-turn marker.

  The pill is placed by transform rather than left/top so seats glide when the arc
  is recomputed (a player joins or leaves, or the window is resized). Framer
  Motion ran that on a spring; it is a CSS transition on the transform now, which
  is the same movement on the compositor and no JavaScript per frame.
-->
<div
  class="slot"
  class:compact={size === 'compact'}
  class:mini={size === 'mini'}
  class:active={isActiveTurn}
  class:disconnected={isDisconnected}
  aria-label="player {nickname}"
  style="transform: translate({x - dims.w / 2}px, {y - dims.h / 2}px)"
>
  {#if isActiveTurn}<div class="dot"></div>{/if}
  <!-- The name shortens, the mark never does: a seat whose nickname fills the
       pill is exactly the seat whose "gone" was being ellipsed away when the two
       shared one string. Drawn rather than `✗`, which at 11px on a mini seat is
       whatever glyph the fallback font had. -->
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
  <!-- Explicit card count. The mini-fan conveys "few vs many" at a glance, but a
       spectator tracking who is about to win needs the exact number — and on mini
       seats it is the only card information there is. -->
  <div class="count" class:countDanger={handSize === 1} aria-hidden="true">{handSize}</div>
  {#if fan}
    <div class="miniFan" aria-hidden="true">
      {#each backs as b, i (i)}
        <div
          class="miniBack"
          style="transform: translate({b.dx}px, {-b.arcY}px) rotate({b.rot}deg); opacity: {b.opacity}"
        >
          <CardBack width={fan.miniW} height={fan.miniH} radius={fan.miniR} />
        </div>
      {/each}
      {#if handSize > fan.maxVisible}
        <div
          class="overflow"
          style="transform: translateX({startX + n * fan.stride + 2 + dims.w / 2}px)"
        >
          +{handSize - fan.maxVisible}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Opponent bubble — a chunky sticker pill floating above the table.
     Position and size are mirrored in cardTheme.ts (SEAT_DIMS). */

  .slot {
    position: absolute;
    /* Pinned at the origin: the transform above is the placement. */
    left: 0;
    top: 0;
    width: 172px;
    height: 66px;
    border-radius: var(--radius-full);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 7px 0 8px;
    box-sizing: border-box;
    background: var(--color-surface-card);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard);
    pointer-events: none;
    font-family: var(--font-display);
    will-change: transform;
    /* Turn / connection state changes fade rather than snap, and the seat glides
       to a recomputed arc instead of jumping. */
    transition:
      transform 260ms var(--ease-bounce),
      border-color 200ms ease,
      background-color 200ms ease,
      box-shadow 200ms ease;
  }

  /* Active seat: the pill turns into the brightest object on screen. On a stream
     the viewer should never have to hunt for whose turn it is. */
  .slot.active {
    background: linear-gradient(180deg, #ffe58a 0%, var(--color-secondary) 100%);
    box-shadow:
      var(--shadow-hard),
      0 0 0 5px rgba(255, 201, 60, 0.4),
      0 0 26px 6px rgba(255, 201, 60, 0.45);
  }

  .slot.disconnected {
    background: var(--color-surface-strong);
    opacity: 0.72;
  }

  /* Crowded phone table: name and count only. Dimensions mirror SEAT_DIMS.mini. */
  .slot.mini {
    width: 82px;
    height: 46px;
    padding: 0;
    justify-content: center;
    border-width: var(--stroke-thin);
  }

  .slot.mini .label {
    font-size: 11px;
    max-width: 68px;
  }

  .slot.mini .count {
    min-width: 20px;
    height: 20px;
    font-size: 11px;
    top: -6px;
    right: -4px;
  }

  .slot.mini .dot {
    top: -15px;
    border-left-width: 6px;
    border-right-width: 6px;
    border-top-width: 8px;
    margin-left: -6px;
  }

  /* Crowded table: same object, smaller. Dimensions mirror SEAT_DIMS.compact. */
  .slot.compact {
    width: 124px;
    height: 56px;
    padding: 5px 0 6px;
    border-width: var(--stroke-thin);
  }

  .slot.compact .label {
    font-size: 12px;
    max-width: 92px;
  }

  .slot.compact .count {
    min-width: 22px;
    height: 22px;
    font-size: 12px;
    top: -7px;
    right: -5px;
  }

  .slot.compact .miniFan {
    height: 19px;
    margin-top: 3px;
  }

  .label {
    font: 600 14px/1.2 var(--font-display);
    color: var(--color-ink);
    max-width: 132px;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* The ellipsis belongs to the name alone. `min-width: 0` is what lets a flex
     item shrink below its content. Without it the name pushes the mark out of
     the pill instead of truncating. */
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

  .slot.active .label {
    color: var(--color-on-secondary);
    font-weight: 700;
  }

  .slot.disconnected .label {
    color: var(--color-muted-soft);
  }

  /* Card count — sits on the pill's right edge, straddling the outline. */
  .count {
    position: absolute;
    top: -8px;
    right: -6px;
    min-width: 26px;
    height: 26px;
    padding: 0 5px;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    background: var(--color-tertiary);
    border: var(--stroke-thin) solid var(--color-stroke);
    color: var(--color-on-dark);
    font: 700 14px/1 var(--font-display);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* One card left — the moment the whole table is watching for. */
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

  .miniFan {
    position: relative;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    margin-top: 4px;
    height: 25px;
    width: 100%;
  }

  .miniBack {
    position: absolute;
    bottom: 0;
    left: 0;
    transform-origin: 50% 100%;
    /* The fan re-spreads as the opponent's hand grows or shrinks. */
    transition:
      transform 240ms var(--ease-out),
      opacity 240ms ease;
  }

  .overflow {
    position: absolute;
    bottom: 6px;
    left: 0;
    font: 700 11px/1.18 var(--font-display);
    color: var(--color-primary);
    transition: transform 240ms var(--ease-out);
  }

  .slot.active .overflow {
    color: var(--color-on-secondary);
  }

  /* Bouncing marker above the active pill — the same "it's you" language Nintendo
     uses for a selected character. */
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

  :root[data-motion="reduce"] .slot,
  :root[data-motion="reduce"] .miniBack,
  :root[data-motion="reduce"] .overflow {
    transition: none;
  }

  :root[data-motion="reduce"] .dot,
  :root[data-motion="reduce"] .countDanger {
    animation: none;
  }
</style>
