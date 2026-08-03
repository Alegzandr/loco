<script lang="ts">
  import type { MatchFormat } from '../types/protocol'
  import { i18n } from '../i18n/i18n.svelte'
  import { seatColor, seatInitial } from './playerColors'
  import LocoLogo from './LocoLogo.svelte'

  type Props = {
    myNickname: string
    opponentNickname: string
    mySeat: number
    /** Date.now() ms at which the server deals. */
    startsAt: number
    format: MatchFormat
  }

  let { myNickname, opponentNickname, mySeat, startsAt, format }: Props = $props()

  const t = $derived(i18n.t)
  let remaining = $state(Math.max(0, startsAt - Date.now()))

  $effect(() => {
    const at = startsAt
    const id = setInterval(() => {
      remaining = Math.max(0, at - Date.now())
    }, 200)
    return () => clearInterval(id)
  })

  const seconds = $derived(Math.ceil(remaining / 1000))
  const opponentSeat = $derived(mySeat === 0 ? 1 : 0)
  // The badge says what the match is, not what the wire calls it: "BO1" is a
  // protocol value, "One round" is the thing the player is about to play.
  const formatLabel = $derived(
    { BO1: t.bestOf1, BO3: t.bestOf3, BO5: t.bestOf5, BO7: t.bestOf7 }[format],
  )
</script>

<!--
  The versus reveal: two and a half seconds between "you are in a queue" and "you
  are in a match".

  It exists so the other side of the table is a person before it is a hand. A
  queue that dealt straight into a board would make the opponent a number that
  appeared in a seat, and this is the game's one chance to say who they are while
  nothing else is happening.

  The countdown is presentation and nothing rests on it: the match begins when the
  server's game_started lands, whether that is early, late or never. If the counter
  reaches zero first the screen simply holds, which is the correct thing for it to
  do while the server is the one deciding.
-->
<div class="container">
  <LocoLogo size="clamp(34px, 6vw, 56px)" />
  <p class="kicker">{t.matchFoundKicker}</p>

  <div class="versus">
    <!-- Each side slides in from its own edge and lands with a bounce. The two
         arrivals are staggered so the collision reads as a meeting rather than a
         single object appearing. -->
    <div class="side left">
      <span class="avatar" style="background: {seatColor(mySeat)}">{seatInitial(myNickname)}</span>
      <span class="name">{myNickname}</span>
      <span class="you">{t.matchFoundYou}</span>
    </div>

    <div class="vs" aria-hidden="true">
      <span class="vsText">VS</span>
    </div>

    <div class="side right">
      <span class="avatar" style="background: {seatColor(opponentSeat)}">
        {seatInitial(opponentNickname)}
      </span>
      <span class="name">{opponentNickname}</span>
      <span class="format">{formatLabel}</span>
    </div>
  </div>

  <p class="countdown" aria-live="polite">
    {seconds > 0 ? t.matchFoundStartingIn.replace('%n', String(seconds)) : t.matchFoundDealing}
  </p>
</div>

<style>
  /* Two and a half seconds, so every part of it has to land at once: the two
     sides arrive from opposite edges, the VS mark punches in between them, and
     the countdown is the only thing that moves afterwards. */

  .container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: safe center;
    height: 100%;
    overflow-y: auto;
    gap: var(--space-base);
    padding: calc(var(--space-lg) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-lg) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    color: var(--color-ink);
    font-family: var(--font-body);
    text-align: center;
  }

  .kicker {
    margin: 0;
    padding: 7px 16px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-mint);
    color: var(--color-on-mint);
    font: 700 13px/1.3 var(--font-display);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    box-shadow: 0 3px 0 var(--color-stroke-soft);
    animation: popIn 0.4s var(--ease-bounce) both;
  }

  .versus {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: clamp(var(--space-sm), 3vw, var(--space-lg));
    width: 100%;
    max-width: 720px;
    margin: var(--space-sm) 0;
  }

  .side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-sm);
    flex: 1 1 0;
    min-width: 0;
    padding: var(--space-base) var(--space-md);
    border-radius: var(--radius-lg);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--color-surface-card);
    box-shadow: var(--shadow-pop);
  }

  .left {
    animation: slideInLeft 0.5s var(--ease-bounce) both;
  }
  .right {
    animation: slideInRight 0.5s 0.1s var(--ease-bounce) both;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: clamp(60px, 12vw, 88px);
    height: clamp(60px, 12vw, 88px);
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    box-shadow: var(--shadow-hard-lg);
    color: var(--color-on-dark);
    font: 700 clamp(26px, 5vw, 36px) / 1 var(--font-display);
    text-shadow: 0 2px 0 rgba(36, 21, 70, 0.35);
  }

  /* A nickname is up to 20 characters and the card is a third of a phone: it
     truncates rather than reflowing the whole reveal. */
  .name {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font: 700 clamp(16px, 3vw, 22px) / 1.2 var(--font-display);
    color: var(--color-ink);
  }

  .you,
  .format {
    padding: 3px 12px;
    border-radius: var(--radius-full);
    font: 700 11px/1.3 var(--font-display);
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .you {
    background: var(--color-surface-strong);
    color: var(--color-body);
  }

  .format {
    background: var(--color-tertiary);
    color: var(--color-on-dark);
  }

  .vs {
    flex: none;
    display: grid;
    place-items: center;
    animation: punchIn 0.4s 0.35s var(--ease-bounce) both;
  }

  .vsText {
    display: grid;
    place-items: center;
    width: clamp(48px, 9vw, 68px);
    height: clamp(48px, 9vw, 68px);
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--gradient-primary);
    color: var(--color-on-dark);
    font: 700 clamp(18px, 3.4vw, 26px) / 1 var(--font-display);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.4);
    box-shadow: var(--shadow-hard-lg);
  }

  .countdown {
    margin: 0;
    color: var(--color-body);
    font: 700 16px/1.3 var(--font-display);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.04em;
  }

  @keyframes slideInLeft {
    from {
      opacity: 0;
      transform: translateX(-40%);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes slideInRight {
    from {
      opacity: 0;
      transform: translateX(40%);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes punchIn {
    from {
      opacity: 0;
      transform: scale(2.2) rotate(-12deg);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: translateY(-8px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (max-width: 520px) {
    .versus {
      gap: var(--space-sm);
    }
    .side {
      padding: var(--space-md) var(--space-sm);
    }
  }

  /* Everything still arrives, it just arrives already in place. */
  :root[data-motion="reduce"] .left,
  :root[data-motion="reduce"] .right,
  :root[data-motion="reduce"] .vs,
  :root[data-motion="reduce"] .kicker {
    animation: none;
  }
</style>
