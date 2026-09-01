<script lang="ts">
  // Split: a `<script lang="ts">` block keeps its imports after type-stripping, so
  // a type imported as a value is asked of the bundler as a runtime binding.
  import type { CatchFlash } from '../hooks/gameStore'
  import { CATCH_PENALTY_CARDS } from '../hooks/gameStore'
  import type { Translations } from '../i18n/en'
  import { seatColor } from './playerColors'

  type Props = {
    flash: CatchFlash | null
    myIndex: number
    players: { index: number; nickname: string }[]
    t: Translations
    onDone: () => void
  }

  let { flash, myIndex, players, t, onDone }: Props = $props()

  /** How long the stamp stays up. Matched to the interception slam. */
  const DURATION_MS = 1900

  let visible = $state(false)
  // Keyed on the timestamp: a second catch restarts the stamp.
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

  const caught = $derived(players.find((p) => p.index === flash?.seat))
  const subtitle = $derived(
    flash?.seat === myIndex
      ? t.catchBannerYou
      : t.catchBannerOther.replace('%player', caught?.nickname ?? `P${flash?.seat}`),
  )
</script>

<!--
  The Contre-LOCO! verdict.

  A landed catch used to be the quietest thing in the game: the caught seat's
  hand grew by two, which on a board where hands grow all match long reads as an
  ordinary draw, and the player who won the race got no answer at all. It is the
  hardest reaction LOCO asks for, so it gets a moment of its own.

  Deliberately a *stamp* rather than the interception's horizontal wipe, and
  deliberately in the penalty's red rather than in an actor colour: the two are
  the loudest banners in the game and a muted highlight clip has to tell them
  apart at a glance. The caught player's seat colour appears on their name only —
  a viewer following "the orange player" still finds them.
-->
{#if flash && visible}
  {#key flash.at}
    <div class="overlay" aria-live="assertive" data-testid="catch-banner">
      <!-- Sits above the piles rather than over them, like the LOCO! banner: the
           penalty cards leave the deck while this is still up, and a verdict
           covering the cards it is about explains nothing. -->
      <div class="anchor">
        <!-- Shockwave, delayed to the frame the stamp actually lands on. -->
        <div class="ring"></div>
        <div class="stamp" style="--caught-color: {seatColor(flash.seat)}">
          <span class="title">{t.catchBannerTitle}</span>
          <!-- The seat's colour is the dot, never the name: see `.subtitle`. -->
          <span class="subtitle"><span class="seatDot" aria-hidden="true"></span>{subtitle}</span>
          <!-- What it cost. The whole point of the banner: a hand that grew is
               only news once the table knows it was a price. -->
          <span class="penalty">
            {t.catchBannerPenalty.replace('%n', String(CATCH_PENALTY_CARDS))}
          </span>
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  /* A stamp coming down, not a wipe crossing the screen — see the comment above
     for why it must not look like the interception slam. Transform/opacity only,
     so it stays on the compositor while the penalty cards fly underneath it. */

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 45;
    overflow: hidden;
  }

  /* Above the deck and the discard, below the seat row. The stamp is up for
     nearly two seconds and the penalty cards leave the deck inside that window,
     so a centred verdict would hide the one thing it exists to explain. */
  .anchor {
    position: absolute;
    top: 30%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Shockwave under the stamp, timed to the frame it lands on. Sized in vmin so
     it stays proportional on a phone and on a 1440p monitor alike. */
  .ring {
    position: absolute;
    width: 44vmin;
    height: 44vmin;
    border-radius: 50%;
    border: 6px solid var(--color-error);
    opacity: 0;
    transform: scale(0.2);
    animation: catchRing 0.55s var(--ease-out) 0.18s forwards;
  }

  @keyframes catchRing {
    0% {
      opacity: 0.85;
      transform: scale(0.2);
    }
    100% {
      opacity: 0;
      transform: scale(1.6);
    }
  }

  .stamp {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 16px 44px;
    background: var(--gradient-error);
    border: 5px solid var(--color-stroke);
    border-radius: var(--radius-lg);
    box-shadow:
      0 8px 0 var(--color-stroke-soft),
      0 0 70px rgba(229, 72, 77, 0.7);
    animation:
      catchStamp 0.36s var(--ease-bounce) forwards,
      catchOut 0.3s ease-in 1.55s forwards;
  }

  /* Punches down from above and overshoots into the table: a verdict landing,
     where the interception's banner grows out of the screen towards the viewer. */
  @keyframes catchStamp {
    0% {
      opacity: 0;
      transform: translateY(-38vh) scale(1.9) rotate(9deg);
    }
    60% {
      opacity: 1;
      transform: translateY(0) scale(0.9) rotate(-8deg);
    }
    100% {
      opacity: 1;
      transform: translateY(0) scale(1) rotate(-5deg);
    }
  }

  @keyframes catchOut {
    to {
      opacity: 0;
      transform: translateY(0) scale(1.1) rotate(-5deg);
    }
  }

  .title {
    font: 700 clamp(28px, 6.2vw, 58px) / 1 var(--font-display);
    letter-spacing: -1px;
    color: var(--color-on-dark);
    -webkit-text-stroke: 4px var(--color-stroke);
    paint-order: stroke fill;
    white-space: nowrap;
  }

  /* The name in the stamp's own white, outlined in ink like the title; the
     caught seat's colour is a swatch beside it. It used to *be* the name's
     colour, so that a viewer following "the orange player" would find them —
     and on the red stamp the ten seat colours measured between 1.05:1 and
     2.3:1, with the rose seat invisible outright. The dot keeps the seat
     findable, with its own ink outline; the name stays legible whichever seat
     it names. */
  .subtitle {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: 600 clamp(13px, 2.2vw, 18px) / 1.2 var(--font-display);
    color: var(--color-on-dark);
    -webkit-text-stroke: 3px var(--color-stroke);
    paint-order: stroke fill;
    white-space: nowrap;
  }

  .seatDot {
    flex: none;
    width: 0.8em;
    height: 0.8em;
    border-radius: var(--radius-full);
    background: var(--caught-color, var(--color-on-dark));
    border: var(--stroke-thin) solid var(--color-stroke);
  }

  /* The price. Same corner chip as the interception's ×N multiplier, so the two
     banners share one grammar even where they deliberately look different. */
  .penalty {
    position: absolute;
    top: -18px;
    right: -20px;
    padding: 5px 13px;
    font: 700 20px/1 var(--font-display);
    color: var(--color-stroke);
    background: var(--gradient-secondary);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    white-space: nowrap;
    animation: catchPenaltyPop 0.4s var(--ease-bounce) 0.22s both;
  }

  @keyframes catchPenaltyPop {
    from {
      opacity: 0;
      transform: scale(0.2) rotate(-25deg);
    }
    to {
      opacity: 1;
      transform: scale(1) rotate(9deg);
    }
  }

  @media (max-width: 480px) {
    .stamp {
      padding: 13px 24px;
    }
    .penalty {
      right: -10px;
      font-size: 17px;
    }
    .subtitle {
      white-space: normal;
      text-align: center;
    }
  }

  /* Degrades to a readable static verdict, never to nothing: which seat was
     caught and what it cost is information, not decoration. */
  :root[data-motion="reduce"] .ring {
    display: none;
  }

  :root[data-motion="reduce"] .stamp {
    animation: none;
    transform: rotate(-5deg);
  }

  :root[data-motion="reduce"] .penalty {
    animation: none;
    transform: rotate(9deg);
  }
</style>
