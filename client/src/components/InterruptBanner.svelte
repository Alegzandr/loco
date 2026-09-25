<script lang="ts">
  import type { InterruptFlash } from '../hooks/gameStore'
  import type { Translations } from '../i18n/en'
  import { seatColor } from './playerColors'

  type Props = {
    flash: InterruptFlash | null
    myIndex: number
    players: { index: number; nickname: string }[]
    t: Translations
    onDone: () => void
  }

  let { flash, myIndex, players, t, onDone }: Props = $props()

  /** How long the slam stays up. Long enough to read, short enough not to hide the play. */
  const DURATION_MS = 1800

  let visible = $state(false)
  // Keyed on the timestamp: a second interception restarts the banner.
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

  const actor = $derived(players.find((p) => p.index === flash?.actorIndex))
  const subtitle = $derived(
    flash?.actorIndex === myIndex
      ? t.interruptByYou
      : t.interruptBy.replace('%actor', actor?.nickname ?? `P${flash?.actorIndex}`),
  )
</script>

<!--
  The interception slam.

  Playing an identical card out of turn is the most spectacular thing that can
  happen in a round, and until now the client rendered it exactly like an
  ordinary turn. This is the one moment the UI is allowed to shout.
-->
{#if flash && visible}
  {#key flash.at}
    <div class="overlay" aria-live="assertive" style="--actor-color: {seatColor(flash.actorIndex)}">
      <!-- On the shout line, like the other two shouts: the card that was
           slammed is the proof of the interception, and a slam laid over it
           hid it. -->
      <div class="anchor">
        <div class="banner">
          <!-- The ribbon the word is printed on, cut to the word. Speed lines
               ride it: the unfurl is the gesture, these say it was fast. -->
          <div class="ribbon" aria-hidden="true">
            <div class="ink"></div>
            <div class="face">
              <span class="streak s1"></span>
              <span class="streak s2"></span>
              <span class="streak s3"></span>
            </div>
          </div>
          <span class="title">{t.interruptTitle}</span>
          <span class="who">{subtitle}</span>
          <!-- A batched interception (several identical cards at once) is rarer
               still — it gets its own multiplier chip. -->
          {#if flash.count > 1}
            <span class="combo">{t.interruptCombo.replace('%n', String(flash.count))}</span>
          {/if}
        </div>
      </div>
    </div>
  {/key}
{/if}

<style>
  /* Deliberately the loudest thing in the game — see the comment above.
     Everything here is transform/opacity only so it stays on the compositor
     while the board keeps animating underneath.

     No card behind the words. It used to be a dark rounded plate with a glow,
     which read as a dialog box opened over the board rather than as a moment,
     and then a band across the whole frame, which read as a transition rather
     than as an object: the plate is a ribbon cut to the word now, in the
     actor's colour, and the word sits on it in the relief all three shouts
     wear: white, ink outline, a stepped ink extrusion, hard and never blurred. */

  .overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 45;
    overflow: hidden;
  }

  /* A full-width line of no height at `--shout-y` (`layout.ts: shoutLine`), the
     line the catch stamp and the LOCO! sticker land on too. */
  .anchor {
    position: absolute;
    top: var(--shout-y, 30%);
    left: 0;
    right: 0;
    height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* The ribbon: an object like everything raised on this board, never a wipe
     across the frame. Cut to the title and a swallowtail wider on each side,
     notched at both ends, the ink as a layer under the face (a clip-path takes
     a border with it) and the hard shadow as a drop-shadow on the pair. It is
     inside the banner, so it takes the slam's tilt with the word, and it
     unfurls from the middle on a transform of its own. */
  .ribbon {
    position: absolute;
    top: -20px;
    left: -52px;
    right: -52px;
    height: calc(var(--title-size) + 40px);
    z-index: -1;
    filter: drop-shadow(0 8px 0 var(--color-stroke-soft));
    animation: ribbonUnfurl 0.34s var(--ease-out) both;
  }

  .ink,
  .face {
    position: absolute;
    clip-path: polygon(0 0, 100% 0, calc(100% - var(--n)) 50%, 100% 100%, 0 100%, var(--n) 50%);
  }

  .ink {
    --n: var(--notch);
    inset: 0;
    background: var(--color-stroke);
  }

  /* The notch is a little shallower on the face so the ink along its two cut
     edges keeps a width, not only along the top and bottom. */
  .face {
    --n: calc(var(--notch) - 2px);
    inset: 5px 6px;
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.3) 0 16%, rgba(255, 255, 255, 0) 16% 100%),
      linear-gradient(
        180deg,
        var(--actor-color, var(--color-primary)),
        color-mix(in srgb, var(--actor-color, var(--color-primary)) 72%, var(--color-stroke))
      );
  }

  @keyframes ribbonUnfurl {
    from {
      transform: scaleX(0.2);
    }
    to {
      transform: scaleX(1);
    }
  }

  .streak {
    position: absolute;
    left: 0;
    width: 22%;
    height: 6px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.55);
    opacity: 0;
    animation: streakRun 0.7s var(--ease-out) forwards;
  }

  .s1 {
    top: 24%;
    animation-delay: 0.08s;
  }

  .s2 {
    top: 60%;
    width: 34%;
    animation-delay: 0.16s;
  }

  .s3 {
    top: 80%;
    width: 16%;
    animation-delay: 0.26s;
  }

  @keyframes streakRun {
    0% {
      opacity: 1;
      transform: translateX(-120%);
    }
    100% {
      opacity: 0;
      transform: translateX(520%);
    }
  }

  .banner {
    --title-size: clamp(32px, 7vw, 72px);
    --notch: 26px;
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: calc(100% - 2 * var(--space-base));
    animation:
      slamIn 0.42s var(--ease-bounce) 0.08s both,
      slamOut 0.3s ease-in 1.45s forwards;
  }

  @keyframes slamIn {
    0% {
      opacity: 0;
      transform: scale(2.4) rotate(-12deg);
    }
    55% {
      opacity: 1;
      transform: scale(0.92) rotate(-2deg);
    }
    100% {
      opacity: 1;
      transform: scale(1) rotate(-4deg);
    }
  }

  @keyframes slamOut {
    to {
      opacity: 0;
      transform: scale(1.12) rotate(-4deg);
    }
  }

  /* White with the ink outline and a stepped ink extrusion, so the word reads on
     any seat's colour — all ten fills are behind it sooner or later, and the
     title used to *be* the actor's colour, which on a band in that colour would
     be nothing at all. */
  .title {
    font: 700 var(--title-size) / 1 var(--font-display);
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

  /* Who did it, on a tag of the board's own chrome hanging off the band: ink on
     the plate, legible whichever seat it names. No seat-colour dot beside the
     name, which read as decoration; the band already wears the seat. */
  .who {
    padding: 6px 16px;
    font: 700 clamp(14px, 2.2vw, 19px) / 1.2 var(--font-display);
    color: var(--color-ink);
    background: var(--color-surface-strong);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-hard);
    white-space: nowrap;
  }

  /* Batched interception multiplier. */
  .combo {
    position: absolute;
    top: -22px;
    right: -34px;
    padding: 6px 14px;
    font: 700 22px/1 var(--font-display);
    /* Ink, not white: this chip is yellow, and white on it measures ~1.7:1. The
       catch banner's ×N chip — which this one is deliberately twinned with —
       already reads the ink. */
    color: var(--color-stroke);
    background: var(--gradient-secondary);
    border: var(--stroke) solid var(--color-stroke);
    border-radius: var(--radius-full);
    box-shadow: var(--shadow-hard);
    animation: comboPop 0.4s var(--ease-bounce) 0.3s both;
  }

  @keyframes comboPop {
    from {
      opacity: 0;
      transform: scale(0.2) rotate(-25deg);
    }
    to {
      opacity: 1;
      transform: scale(1) rotate(10deg);
    }
  }

  /* A nickname is up to 20 characters, and a tag that may not wrap took one off
     both edges of a 360px screen. */
  @media (max-width: 480px) {
    .banner {
      --notch: 18px;
    }
    .ribbon {
      top: -14px;
      left: -30px;
      right: -30px;
      height: calc(var(--title-size) + 28px);
    }
    .title {
      -webkit-text-stroke-width: 4px;
    }
    .combo {
      top: -32px;
      right: -6px;
      font-size: 17px;
    }
    .who {
      white-space: normal;
      text-align: center;
      overflow-wrap: anywhere;
    }
  }

  /* The ribbon stays: it is the plate the word is printed on, not a movement.
     What goes is everything that travels: the unfurl, the speed lines, the
     punch. */
  :root[data-motion="reduce"] .ribbon {
    animation: none;
  }

  :root[data-motion="reduce"] .streak {
    display: none;
  }

  :root[data-motion="reduce"] .banner {
    animation: none;
    transform: rotate(-4deg);
  }

  :root[data-motion="reduce"] .combo {
    animation: none;
    transform: rotate(10deg);
  }
</style>
