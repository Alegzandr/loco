<script lang="ts">
  // Split: a `<script lang="ts">` block keeps its imports after type-stripping, so
  // a type imported as a value is asked of the bundler as a runtime binding.
  import type { CatchFlash } from '../hooks/gameStore'
  import { CATCH_PENALTY_CARDS } from '../hooks/gameStore'
  import type { Translations } from '../i18n/en'

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
      <!-- On the shout line, off the piles while the table has room: the penalty
           cards leave the deck while this is still up, and a verdict covering
           the cards it is about explains nothing. -->
      <div class="anchor">
        <!-- Shockwave, delayed to the frame the stamp actually lands on. -->
        <div class="ring"></div>
        <div class="stamp">
          <span class="title">{t.catchBannerTitle}</span>
          <span class="subtitle">{subtitle}</span>
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

  /* On the shout line (`--shout-y`, `layout.ts: shoutLine`): the tallest free
     gap in the middle of the table. The stamp is up for nearly two seconds and
     the penalty cards leave the deck inside that window, so a verdict over the
     piles would hide the one thing it exists to explain, and a fixed height
     above them sat on the hand of whoever faces us. */
  .anchor {
    position: absolute;
    top: var(--shout-y, 30%);
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
    border-radius: var(--radius-full);
    border: 8px solid var(--color-error);
    box-shadow:
      0 0 0 3px var(--color-stroke),
      inset 0 0 0 3px var(--color-stroke);
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

  /* A rubber stamp: squarer corners than any card on the board, and the white
     rule inset inside the ink edge that every stamp is cut with. It used to be
     a rounded red plate with a glow, which read as a dialog box. The name hangs
     off the bottom edge on a tag (`.subtitle`), so the padding leaves it room. */
  .stamp {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 20px 52px 34px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.22) 0 12%, rgba(255, 255, 255, 0) 12% 100%),
      var(--gradient-error);
    border: 5px solid var(--color-stroke);
    border-radius: var(--radius-sm);
    outline: 3px solid rgba(255, 255, 255, 0.85);
    outline-offset: -12px;
    box-shadow: 0 10px 0 var(--color-stroke-soft);
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

  /* The relief all three shouts wear: white, the ink outline, a stepped ink
     extrusion — hard, never blurred. */
  .title {
    font: 700 clamp(30px, 6.6vw, 66px) / 1 var(--font-display);
    letter-spacing: -1px;
    color: var(--color-on-dark);
    -webkit-text-stroke: 5px var(--color-stroke);
    paint-order: stroke fill;
    text-shadow:
      0 2px 0 var(--color-stroke),
      0 4px 0 var(--color-stroke),
      0 6px 0 var(--color-stroke),
      0 9px 0 var(--color-stroke-soft);
    white-space: nowrap;
  }

  /* The name, ink on a tag of the board's own chrome hanging off the stamp's
     bottom edge (the interception's device), so the verdict and the seat it
     falls on are two objects, not one line of small type on the red. It used
     to be the seat's colour, which measured 1.05:1 to 2.3:1 on the red; the
     coloured dot that replaced it read as decoration and is gone too. */
  .subtitle {
    position: absolute;
    bottom: -20px;
    inset-inline: 0;
    margin-inline: auto;
    width: fit-content;
    max-width: calc(100% + 24px);
    box-sizing: border-box;
    padding: 6px 16px;
    font: 700 clamp(14px, 2.2vw, 19px) / 1.2 var(--font-display);
    color: var(--color-ink);
    background: var(--color-surface-strong);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-hard);
    white-space: nowrap;
  }

  /* The price. Same corner chip as the interception's ×N multiplier, so the two
     banners share one grammar even where they deliberately look different. */
  .penalty {
    position: absolute;
    top: -22px;
    right: -30px;
    padding: 6px 14px;
    font: 700 22px/1 var(--font-display);
    color: var(--color-stroke);
    background: var(--gradient-secondary);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-hard);
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
      padding: 15px 28px 30px;
      outline-offset: -10px;
    }
    .title {
      -webkit-text-stroke-width: 4px;
    }
    .penalty {
      right: -10px;
      font-size: 17px;
    }
    .subtitle {
      white-space: normal;
      text-align: center;
      overflow-wrap: anywhere;
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
