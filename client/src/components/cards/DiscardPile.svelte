<script lang="ts">
  import { untrack } from 'svelte'
  import type { CardDTO, CardColor } from '../../types/protocol'
  import Card from './Card.svelte'
  import {
    ACTIVE_RING,
    SUIT_PAINT,
    SUIT_ANGLE_DEG,
    CARD_W,
    CARD_H,
    cardKey,
    flightFor,
  } from './cardTheme'
  import SuitMark from './SuitMark.svelte'
  import { colorAssistPref } from '../../hooks/colorAssist'
  import { watchPref } from '../../hooks/prefs.svelte'
  import { discardPosition, onPile, pileTransform, PILE_CHIP_REACH } from './layout'

  type Props = {
    card: CardDTO | null
    activeColor: CardColor
    pendingDraw: number
    width: number
    height: number
    /** Vertical space claimed by the opponent seats — the piles follow the felt. */
    topReserve?: number
    /** A phone on its side: the felt sits right of the seat column (`layout.ts`). */
    landscape?: boolean
    /**
     * The stamp of the play that put `card` on the pile, 0 when none did (a
     * snapshot). Part of the pile's key: an interject is the same face as the
     * card under it, and keyed on the face alone the top never remounted, so
     * the settle never replayed on the one play the table most needs to see.
     */
    playStamp?: number
  }

  let { card, activeColor, pendingDraw, width, height, topReserve = 0, landscape = false, playStamp = 0 }: Props = $props()

  const assist = watchPref(colorAssistPref)

  // The pile's thickness: its near side, once it lies on the felt, drawn as the
  // edges of the cards under it, offset straight down in the pile's own plane.
  const EDGE_LAYERS = [9, 6, 3]

  // The two corner tokens stay upright, as readable as ever, but pinned to
  // where the laid card's corners are seen.
  const nearLeft = onPile(0, CARD_H)
  const farRight = onPile(CARD_W, 0)

  // Fixed tilts for the cards buried under the top one. Static rather than random
  // so the pile doesn't reshuffle itself on every update.
  const UNDER_LAYERS = [
    { rotate: -4, dx: -2, dy: 1, opacity: 0.28 },
    { rotate: 3, dx: 1, dy: -1, opacity: 0.4 },
  ]

  // Derives a small, stable tilt from the card's identity so each new top card
  // lands at its own angle and the pile looks handled rather than machine stacked.
  // Deterministic: the same card always lands the same way.
  function hashTilt(c: CardDTO): number {
    const s = cardKey(c)
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return ((Math.abs(h) % 11) - 5) * 0.9 // −4.5°..+4.5°
  }

  // The pile reveals on impact, not on the message: the card is still crossing the
  // table, and showing the answer early makes the flight look decorative. The one
  // exception is the first card this pile ever shows (an opening discard, or a
  // board rebuilt after a reconnect), where nothing flew, and waiting for a flight
  // that never happened just blanks the pile.
  let shown = $state<CardDTO | null>(untrack(() => card))
  // The stamp that goes with `shown`, revealed in the same instant so the top's
  // key changes once per play and never between a flight and its landing.
  let shownStamp = $state(untrack(() => playStamp))
  let isFirst = true
  const key = $derived(card ? `${cardKey(card)}|${playStamp}` : '')

  $effect(() => {
    // The card's identity is the *only* dependency, and on this board a
    // re-render is what an arriving message is. Reading the object as well
    // meant every message restaged the reveal: the cleanup dropped the staged
    // timer and the new run waited out a fresh flight, so while the table was
    // busy the pile went on showing the card before last — the one card in the
    // game every legality decision is read off. `key` is a `$derived`, so it
    // notifies only when the card actually changes; `untrack` is what keeps the
    // object out of the dependency list (same reason `GameBoard` uses it).
    key
    const next = untrack(() => card)
    const stampNow = untrack(() => playStamp)
    if (!next) {
      shown = null
      return
    }
    if (isFirst) {
      isFirst = false
      shown = next
      shownStamp = stampNow
      return
    }
    const timer = window.setTimeout(() => {
      shown = next
      shownStamp = stampNow
    }, flightFor(next).duration)
    return () => clearTimeout(timer)
  })

  const pos = $derived(discardPosition(width, height, topReserve, landscape))
  const tilt = $derived(shown ? hashTilt(shown) : 0)
</script>

<!-- Top of the discard pile + active-colour ring + pending-draw +N badge. -->
{#if shown}
  <div
    class="pile"
    style="left: {pos.x}px; top: {pos.y}px; width: {CARD_W}px; height: {CARD_H}px"
    aria-label="discard"
  >
    <!-- Three readings of the same fact, at three distances. The pool is the one a
         spectator gets at 720p without looking for anything; the ring is the one a
         player already knows; the chip is the one that answers the question when
         the card itself cannot — a wild has no colour on its face, and that is
         exactly when people ask where the colour is. Keyed on the colour so a wild
         resolving replays all three. Framer Motion staged these; they are CSS
         entrance animations now, replayed by the same key. -->
    <!-- Everything that lies on the felt is laid down with the pile: the pool, the
         ring, the cards. The chip and the badge are tokens read across the room
         and stay upright, outside it. -->
    <div class="laid" style="transform: {pileTransform()}">
    {#key activeColor}
      <div class="pool" style="color: {ACTIVE_RING[activeColor]}"></div>
    {/key}
    <!-- `color` drives both the border (border-color defaults to currentColor) and
         the glow, so the active colour is set in one place. -->
    <div class="ring" style="color: {ACTIVE_RING[activeColor]}"></div>
    <div class="contact"></div>
    {#each EDGE_LAYERS as dy (dy)}
      <div class="edge" style="top: {dy}px"></div>
    {/each}
    {#each UNDER_LAYERS as l, i (i)}
      <div
        class="under"
        style="transform: translate({l.dx}px, {l.dy}px) rotate({l.rotate}deg); opacity: {l.opacity}"
      ></div>
    {/each}
    <!-- Keyed on the card so every new top card remounts and replays the settle. -->
    {#key `${cardKey(shown)}|${shownStamp}`}
      <div class="top" style="--tilt: {tilt}deg">
        <Card card={shown} />
      </div>
    {/key}
    </div>
    <!-- The chip carries the suit's whole gradient, so it is literally the paint of
         the swatch that was tapped in <ColorPicker /> and of the cards it now lets
         you play. A flat sample would be a fourth colour to learn. Bottom-left
         mirrors the +N badge's corner: the pile has two fixed places to look, and
         this one is always occupied. -->
    {#key activeColor}
      <div
        class="chip"
        style="left: {nearLeft.x - PILE_CHIP_REACH}px; top: {nearLeft.y - 22}px; color: {ACTIVE_RING[
          activeColor
        ]}; background: linear-gradient({SUIT_ANGLE_DEG}deg, {SUIT_PAINT[activeColor]
          .from}, {SUIT_PAINT[activeColor].to})"
        aria-label="active color {activeColor}"
      >
        <!-- The chip is the answer to "what can I play now?", and after a wild it
             is the *only* place that answer is written. -->
        {#if assist.current}<SuitMark color={activeColor} class="chipMark" />{/if}
      </div>
    {/key}
    {#if pendingDraw > 0}
      <div
        class="badge"
        style="left: {farRight.x - 46 / 2}px; top: {farRight.y - 30 / 2}px"
        aria-label="pending draw {pendingDraw}"
      >
        +{pendingDraw}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pile {
    position: absolute;
    pointer-events: none;
  }

  /* The laid pile, tipped back about the card's centre (`pileTransform`). */
  .laid {
    position: absolute;
    inset: 0;
    transform-origin: 50% 50%;
  }

  /* The pile's contact shadow on the felt, cast the way the room's sun casts
     every block's (`--sun-dx` / `--sun-dy`, the table's own shadow). Soft, and
     that is allowed here: it is ambience, grounding the pile in the room; the
     structure is still the ink outline and the band of edges. */
  .contact {
    position: absolute;
    inset: 0;
    border-radius: 8px;
    pointer-events: none;
    transform: translate(calc(var(--sun-dx, 0) * 7px), calc(var(--sun-dy, 0.7) * 7px + 4px));
    box-shadow: 0 0 12px 3px rgba(0, 0, 0, calc(0.5 + var(--scene-dark, 0) * 0.2));
    background: rgba(0, 0, 0, 0.35);
  }

  /* The near side of the pile: card edges under the top one, paper in shade.
     Solid rather than faded, for the same reason the deck's buried layers are
     darkened: faded they would take the felt's colour and read as a glow. */
  .edge {
    position: absolute;
    left: 0;
    width: 72px;
    height: 108px;
    border-radius: 11px;
    background: var(--card-edge);
    border: var(--stroke-thin) solid var(--color-stroke);
    pointer-events: none;
  }

  /* Coloured light pooled on the felt around the discard. The ring states the
     active colour precisely; this one states it from across the room — a viewer on
     a 720p stream reads a red table before they read a red outline, and a player
     who just looked away reads it without hunting.
     Deliberately low and blurred: the table stays near-black and the card edges
     keep winning, which is the rule the felt exists to protect. Centred with
     margins, not `transform` — the entrance animation owns this node's transform. */
  .pool {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 330px;
    height: 286px;
    margin-left: -165px;
    margin-top: -143px;
    border-radius: 50%;
    background: radial-gradient(closest-side, currentColor 0%, rgba(0, 0, 0, 0) 72%);
    filter: blur(18px);
    pointer-events: none;
    animation: poolIn 0.55s var(--ease-out) both;
  }

  @keyframes poolIn {
    from {
      opacity: 0.78;
      transform: scale(1.28);
    }
    to {
      opacity: 0.44;
      transform: scale(1);
    }
  }

  /* Active-colour halo. This is the single most-consulted piece of state on the
     board, so it is a solid glowing ring rather than a hairline: readable from a
     stream thumbnail, and it changes the moment a wild resolves. */
  .ring {
    position: absolute;
    top: -11px;
    left: -11px;
    width: calc(72px + 22px);
    height: calc(108px + 22px);
    border-radius: 20px;
    border-width: 5px;
    border-style: solid;
    box-shadow:
      0 0 22px 3px currentColor,
      inset 0 0 12px rgba(255, 255, 255, 0.35);
    opacity: 0.95;
    pointer-events: none;
    animation: ringBreathe 2.6s ease-in-out infinite;
  }

  @keyframes ringBreathe {
    0%,
    100% {
      opacity: 0.95;
    }
    50% {
      opacity: 0.7;
    }
  }

  /* Buried cards giving the pile visible thickness. Deliberately neutral: the
     active-colour ring already owns the colour around the discard, and tinted
     layers underneath would muddy it. */
  .under {
    position: absolute;
    top: 0;
    left: 0;
    width: 72px;
    height: 108px;
    border-radius: 11px;
    background: #fff;
    border: var(--stroke-thin) solid var(--color-stroke);
    transform-origin: 50% 50%;
    pointer-events: none;
  }

  /* The settle: the card lands a touch large and over-tilted, then sits. */
  /* No `will-change`: the settle is one 420ms animation per new top card, and
     the browser promotes an animating element for its duration on its own. A
     permanent hint kept a layer alive for the whole round for a card that
     moves once. */
  .top {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 50% 50%;
    animation: topSettle 0.42s var(--ease-bounce) both;
  }

  @keyframes topSettle {
    from {
      opacity: 0.85;
      transform: scale(1.14) rotate(calc(var(--tilt) * 2.2));
    }
    to {
      opacity: 1;
      transform: scale(1) rotate(var(--tilt));
    }
  }

  /* Stacked penalty counter. Sits on the card's corner like a damage number. */
  .badge {
    position: absolute;
    width: 46px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(180deg, #ff6d7d 0%, var(--color-primary) 100%);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    color: var(--color-on-primary);
    font: 700 16px/1 var(--font-display);
    pointer-events: none;
    z-index: 2;
    box-shadow:
      0 3px 0 var(--color-stroke-soft),
      0 0 18px rgba(255, 61, 104, 0.6);
    animation: badgePop 0.32s var(--ease-bounce) both;
  }

  @keyframes badgePop {
    from {
      opacity: 0;
      transform: scale(0.5);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* The active-colour chip: a physical token set into the ring, in the app's
     chunky language (ink outline + hard ledge) because it is an object on the
     table, not a swatch in a legend. Same corner discipline as .badge. */
  .chip {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow:
      0 3px 0 var(--color-stroke-soft),
      0 0 16px currentColor,
      inset 0 2px 4px rgba(255, 255, 255, 0.4);
    pointer-events: none;
    z-index: 3;
    animation: chipPop 0.36s var(--ease-bounce) both;
  }

  @keyframes chipPop {
    from {
      transform: scale(0.35) rotate(-22deg);
    }
    to {
      transform: scale(1) rotate(0deg);
    }
  }

  /* Colour assist: the suit silhouette inside the active-colour chip. Global
     because <SuitMark /> renders the element. */
  .chip :global(.chipMark) {
    width: 58%;
    height: 58%;
  }

  :root[data-motion="reduce"] .ring {
    animation: none;
  }

  /* The entrances degrade to their end state, never to nothing: the pile, the
     colour and the penalty are all information. */
  :root[data-motion="reduce"] .pool,
  :root[data-motion="reduce"] .top,
  :root[data-motion="reduce"] .chip,
  :root[data-motion="reduce"] .badge {
    animation-duration: 0.01ms;
  }
</style>
