<script lang="ts">
  import { i18n } from '../i18n/i18n.svelte'

  type Props = {
    /**
     * Step down below the opponent-away banner when both are up. Only does
     * anything at the narrow width, where the two share a slot.
     */
    offset?: boolean
  }

  let { offset = false }: Props = $props()
  const t = $derived(i18n.t)
</script>

<!--
  "A new version is landing, and this match is going to finish."

  Deliberately the quietest thing on the board. Everything else that appears over
  the felt is either a deadline (OpponentAway, the turn bar, the catch window) or
  a moment (InterruptBanner, CatchBanner), and all of them are asking for
  something. This asks for nothing: the server drains, the match plays out, and
  if the process is replaced before the last card the restart costs a one-second
  reconnect the client already handles on its own. So: no countdown, no colour
  from the alert ramp, no blinking dot, and nothing disabled. A player who
  ignores it entirely loses nothing, which is exactly what it is telling them.

  It exists at all because a board that quietly changes behaviour is worse than
  one that says so: during a drain the rematch button stops working, and without
  this line that reads as a bug.

  Where it sits depends on the width, and it hides nothing at either: see below.
-->
<div class="banner" class:offset role="status">
  <span class="text">{t.serverUpdatingBanner}</span>
</div>

<style>
  /* A deploy is under way.
   *
   * Two slots, because the top of the board is a different shape at each width
   * and this notice can sit there for the whole match. It has to hide nothing.
   *
   *   wide: the top chrome row, in the gap between the round pill on the left
   *           and the icon row on the right. It is about the server rather than
   *           about the match, so living with the other chrome is right.
   *   small: that gap does not exist: the pill, the icons and Règles fill the
   *           row, and a notice placed there is unreadable behind them. So it
   *           drops to the banner slot under the chrome, and steps down again
   *           when OpponentAway is using it. That one is a countdown and owns
   *           the slot; this one waits its turn.
   *
   * The slot over the felt at 60px was the first attempt at both widths, and it
   * put a permanent pill on top of the top-centre seat pod, hiding an opponent's
   * card count for as long as the drain lasted.
   *
   * One register quieter than everything around it in every direction: surface
   * instead of card, muted ink, no shadow pop, no accent, no motion but a fade.
   */

  .banner {
    position: absolute;
    top: calc(60px + var(--safe-top));
    left: 50%;
    transform: translateX(-50%);
    /* Under the seat pods and every in-match banner: anything actually happening
       to the match wins this space. */
    z-index: 6;
    max-width: min(92vw, 420px);
    padding: 6px 14px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    pointer-events: none;
    animation: fadeIn 0.4s var(--ease-out);
  }

  /* Below the opponent-away banner, which is two lines plus a bar. */
  .offset {
    top: calc(148px + var(--safe-top));
  }

  .text {
    display: block;
    color: var(--color-muted);
    font: 600 12.5px/1.3 var(--font-body);
    text-align: center;
  }

  @media (min-width: 481px) {
    .banner,
    .banner.offset {
      top: calc(16px + var(--safe-top));
      /* Narrow enough to clear the round pill and the icon row on either side. */
      max-width: min(46vw, 420px);
    }
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Degrades to the static, readable state rather than to nothing: the line is
     the point, the fade never was. */
  :root[data-motion="reduce"] .banner {
    animation: none;
  }
</style>
