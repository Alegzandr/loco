<script lang="ts">
  import type { ScoreboardEntryDTO } from '../types/protocol'
  import { i18n } from '../i18n/i18n.svelte'
  import Confetti from './Confetti.svelte'
  import ServerUpdating from './ServerUpdating.svelte'
  import { game } from '../hooks/gameStore.svelte'

  type Props = {
    winner: string
    myNickname: string
    scoreboard?: ScoreboardEntryDTO[]
    matchOver?: boolean
    /** This match came out of the 1v1 queue: the next one is another pairing. */
    isMatchmade?: boolean
    /** The seat that abandoned, or null when the match ended on the cards. */
    forfeitBy?: number | null
    /** Our own seat, so we know which side of a forfeit we are on. */
    mySeat?: number
    /** Seats that have asked for another match. */
    rematchOffers?: number[]
    /** How many asks deal it: everybody still at the table. 0 before the first. */
    rematchNeeded?: number
    /** True while somebody else is still at the table to agree with. */
    hasTablemates?: boolean
    /** Ask the table for another match. */
    onRematch: () => void
    /** Back into the queue for another opponent (matchmade matches only). */
    onFindMatch: () => void
    /** Give the seat up and go back to the home screen. */
    onLeave: () => void
  }

  let {
    winner,
    myNickname,
    scoreboard,
    matchOver,
    isMatchmade,
    forfeitBy,
    mySeat,
    rematchOffers = [],
    rematchNeeded = 0,
    hasTablemates = true,
    onRematch,
    onFindMatch,
    onLeave,
  }: Props = $props()

  const t = $derived(i18n.t)
  const isWinner = $derived(winner === myNickname)
  // A forfeit is not a victory and this screen must not pretend otherwise: no
  // confetti, no trophy, and a heading that says what actually happened. The
  // player who left is told plainly that they left, which is the honest reading
  // of a match they ended themselves.
  const isForfeit = $derived(typeof forfeitBy === 'number' && forfeitBy >= 0)
  const iForfeited = $derived(isForfeit && forfeitBy === mySeat)
  const iOffered = $derived(typeof mySeat === 'number' && rematchOffers.includes(mySeat))
  const theyOffered = $derived(rematchOffers.some((seat) => seat !== mySeat))
  // Nobody is asked to agree with an empty table. A matchmade one requeues
  // instead (App does it without being asked); an ordinary one keeps the button
  // in place and disabled, because the table is still there and somebody may
  // still walk back into it.
  const canRematch = $derived(!isForfeit && hasTablemates)
  // Past two seats "waiting on them" names nobody, and the count is the only
  // thing that says how far off the next match is. At two it would be noise.
  const isTable = $derived(rematchNeeded > 2)
  const progress = $derived(
    isTable ? ` ${t.rematchProgress(rematchOffers.length, rematchNeeded)}` : '',
  )
  const ranked = $derived((scoreboard ?? []).slice().sort((a, b) => b.score - a.score))
  // Read through a $derived rather than out of the snapshot inside the markup:
  // `game.current` is replaced whole on every message. See hooks/live.svelte.ts.
  const serverUpdating = $derived(game.current.serverUpdating)
</script>

<div class="container">
  <!-- Only the winner gets confetti — a losing screen that celebrates is a worse
       experience than a quiet one, and a walkover is not something to throw paper
       over either. -->
  {#if isWinner && !isForfeit}
    <Confetti />
  {/if}
  <div class="card">
    <div class="emoji">
      {isForfeit ? (iForfeited ? '🚪' : '🏳️') : isWinner ? '🏆' : '😔'}
    </div>
    <h2 class="heading">
      {isForfeit
        ? iForfeited
          ? t.forfeitYouLeft
          : t.forfeitWon
        : matchOver
          ? isWinner
            ? t.matchWon
            : t.gameOver
          : isWinner
            ? t.youWin
            : t.gameOver}
    </h2>
    {#if isForfeit}
      <p class="sub">{iForfeited ? t.forfeitYouLeftSub : t.forfeitWonSub}</p>
    {:else if !isWinner}
      <p class="sub">{winner} {matchOver ? t.winsMatch : t.winsGame}</p>
    {/if}

    {#if scoreboard && scoreboard.length > 0}
      <div class="scoreboard">
        <h3 class="scoreboardTitle">{t.finalScores}</h3>
        {#each ranked as entry (entry.player_index)}
          <div class="scoreRow" class:scoreRowWinner={entry.nickname === winner}>
            <span class="scoreName">{entry.nickname}</span>
            <span class="scoreDetails">
              <span class="scoreVal">{entry.score} pts</span>
              <span class="scoreWins">{entry.rounds_won}W</span>
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- A deploy is under way, so the button under this is going to be refused.
         Said before it is pressed rather than after: a rematch that comes back
         "server updating" on a screen that never mentioned a deploy reads as the
         button being broken. -->
    {#if serverUpdating}
      <ServerUpdating variant="card" />
    {/if}

    <!-- A rematch is an agreement, not a decision, and it reads the same at every
         table: ask, wait, accept. The middle state is the point of the whole
         thing, which is why the ask is public: knowing somebody is waiting on you
         is what gets answered. A table nobody is left at keeps the button,
         disabled: the offer is gone, not the room. -->
    <button
      class="btn"
      class:btnRematch={!theyOffered}
      onclick={onRematch}
      disabled={iOffered || !canRematch}
    >
      {iOffered
        ? (isTable ? t.rematchWaitingTable : t.rematchWaitingOpponent) + progress
        : theyOffered
          ? t.rematchAccept + progress
          : t.rematch}
    </button>

    <!-- Only a matchmade table has a next opponent to offer, and the offer is the
         search rather than the opponent: relaunching it is the whole act. -->
    {#if isMatchmade}
      {#if isForfeit || theyOffered}
        <button class="btnSecondary" onclick={onFindMatch}>{t.searchAgain}</button>
      {:else}
        <button class="btn" onclick={onFindMatch}>{t.searchAgain}</button>
      {/if}
    {/if}

    <!-- The way out, and the quietest thing on the card: leaving is what somebody
         does when neither of the two things above is what they came back for. -->
    <button class="btnQuit" onclick={onLeave}>{t.leaveRoom}</button>
  </div>
</div>

<style>
  /* End of match. This is the screenshot people post, so it is built like a
     trophy card: heavy panel, oversized emoji, ranked scoreboard. */

  .container {
    display: flex;
    align-items: center;
    justify-content: center;
    justify-content: safe center;
    height: 100%;
    padding: calc(var(--space-lg) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-lg) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    overflow-y: auto;
    background: transparent;
    font-family: var(--font-body);
    color: var(--color-ink);
  }

  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-md);
    width: 380px;
    max-width: 100%;
    padding: var(--space-xl) var(--space-lg) var(--space-lg);
    background: var(--color-surface-card);
    border: 4px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-pop);
    animation: trophyIn 0.5s var(--ease-bounce) both;
  }

  @keyframes trophyIn {
    from {
      opacity: 0;
      transform: translateY(28px) scale(0.9);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .emoji {
    font-size: 72px;
    line-height: 1;
    filter: drop-shadow(0 6px 0 var(--color-stroke-soft));
    animation: trophyBob 2.4s ease-in-out infinite;
  }

  @keyframes trophyBob {
    0%,
    100% {
      transform: translateY(0) rotate(-4deg);
    }
    50% {
      transform: translateY(-8px) rotate(4deg);
    }
  }

  .heading {
    font: 700 clamp(28px, 6vw, 38px) / 1.1 var(--font-display);
    color: var(--color-primary);
    text-align: center;
    -webkit-text-stroke: 3px var(--color-stroke);
    paint-order: stroke fill;
  }

  .sub {
    font: 600 16px/1.4 var(--font-body);
    color: var(--color-body);
    text-align: center;
  }

  .scoreboard {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-md);
    background: var(--color-surface-strong);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-md);
  }

  .scoreboardTitle {
    font: 700 12px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--color-muted);
    text-align: center;
    margin-bottom: 2px;
  }

  .scoreRow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-sm);
    padding: 8px 12px;
    background: var(--color-surface-card);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    font: 600 15px/1.2 var(--font-display);
  }

  /* Match winner's row — gold, so the result is unmistakable in a screenshot. */
  .scoreRowWinner {
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .scoreName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoreDetails {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
    flex-shrink: 0;
  }

  .scoreVal {
    font-weight: 700;
  }

  .scoreWins {
    font: 700 11px/1.2 var(--font-display);
    padding: 3px 8px;
    border-radius: var(--radius-full);
    background: var(--color-tertiary);
    border: 1.5px solid var(--color-stroke);
    color: var(--color-on-dark);
  }

  .btn {
    width: 100%;
    padding: 14px 24px;
    min-height: 54px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.4);
    font: 700 19px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 5px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out),
      filter 0.12s ease;
    touch-action: manipulation;
  }

  .btn:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 0 var(--color-stroke-soft);
    filter: brightness(1.06);
  }
  .btn:active {
    transform: translateY(3px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  /* The rematch offer before anybody has answered: an equal-weight alternative to
     finding the next opponent, so it gets its own hue rather than competing with
     the primary. Once the opponent has asked first it drops back to `.btn`: at
     that point it is not an alternative, it is the answer somebody is waiting for.
     Both classes are applied in the markup rather than `composes: btn`, which is
     a CSS Modules directive Svelte's <style> has no equivalent of. */
  .btnRematch {
    background: var(--gradient-tertiary);
    text-shadow: 0 2px 0 rgba(30, 16, 90, 0.4);
  }

  /* Waiting on the other side. Still a button in the layout so the card does not
     reflow when the answer lands, but visibly not pressable. */
  .btnRematch:disabled,
  .btn:disabled {
    background: var(--color-surface-strong);
    color: var(--color-muted);
    cursor: default;
    box-shadow: none;
    text-shadow: none;
    transform: none;
  }

  .btnSecondary {
    width: 100%;
    padding: 11px 20px;
    min-height: 46px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: transparent;
    color: var(--color-muted);
    font: 600 14px/1.2 var(--font-display);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
    touch-action: manipulation;
  }

  .btnSecondary:hover {
    background: var(--color-surface-strong);
    color: var(--color-ink);
  }

  /* Leaving. Deliberately the quietest control on the card: no outline, no fill,
     nothing competing with the two offers above it. Quiet is a hue here as
     everywhere else (--color-muted, never ink at an opacity), and the row keeps
     its 44px of target even though nothing is drawn that tall. */
  .btnQuit {
    width: 100%;
    min-height: 44px;
    padding: 4px 12px;
    border: none;
    background: none;
    color: var(--color-muted);
    font: 600 13px/1.2 var(--font-display);
    text-decoration: underline;
    text-underline-offset: 3px;
    cursor: pointer;
    transition: color 0.15s;
    touch-action: manipulation;
  }

  .btnQuit:hover {
    color: var(--color-ink);
  }

  :root[data-motion="reduce"] .card,
  :root[data-motion="reduce"] .emoji {
    animation: none;
  }
</style>
