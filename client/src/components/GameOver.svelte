<script lang="ts">
  import type { Emote, MatchRecordDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'
  import { i18n } from '../i18n/i18n.svelte'
  import Confetti from './Confetti.svelte'
  import ServerUpdating from './ServerUpdating.svelte'
  import { game } from '../hooks/gameStore.svelte'
  import { buildMatchRecap, hasEveningToShow } from './matchRecapModel'
  import { EMOTE_ORDER } from './emotes'

  type Props = {
    winner: string
    myNickname: string
    scoreboard?: ScoreboardEntryDTO[]
    /** The roster, for the evening's recap: it is indexed by seat, not by name. */
    players?: PlayerDTO[]
    /** Every match this table has finished, oldest first. */
    matchHistory?: MatchRecordDTO[]
    matchOver?: boolean
    /** This match came out of the 1v1 queue: the next one is another pairing. */
    isMatchmade?: boolean
    /** This match was against the server: there is nobody to ask for another. */
    isSolo?: boolean
    /** The seat that abandoned, or null when the match ended on the cards. */
    forfeitBy?: number | null
    /**
     * Which side of that forfeit we are on. A boolean rather than
     * `forfeitBy === mySeat`, because the departure re-bases the seats a beat
     * after this screen opens: the store answers it while the two indices still
     * name the players the message was written about. See store `forfeitedByMe`.
     */
    forfeitedByMe?: boolean
    /** Our own seat, for the emote row and our own rematch ask. */
    mySeat?: number
    /** Seats that have asked for another match. */
    rematchOffers?: number[]
    /** How many asks deal it: two, or the whole table below that. 0 before the first. */
    rematchNeeded?: number
    /** True while somebody else is still at the table to agree with. */
    hasTablemates?: boolean
    /** Ask the table for another match. */
    onRematch: () => void
    /** Back into the queue for another opponent (matchmade matches only). */
    onFindMatch: () => void
    /** Deal another game against the server (solo matches only). */
    onPlayBot?: () => void
    /** Say one of the three things. The set is the server's; this only sends. */
    onEmote?: (emote: Emote) => void
    /** Give the seat up and go back to the home screen. */
    onLeave: () => void
  }

  let {
    winner,
    myNickname,
    scoreboard,
    players = [],
    matchHistory = [],
    matchOver,
    isMatchmade,
    isSolo,
    forfeitBy,
    forfeitedByMe,
    mySeat,
    rematchOffers = [],
    rematchNeeded = 0,
    hasTablemates = true,
    onRematch,
    onFindMatch,
    onPlayBot,
    onEmote,
    onLeave,
  }: Props = $props()

  const t = $derived(i18n.t)
  const isWinner = $derived(winner === myNickname)
  // A forfeit is not a victory and this screen must not pretend otherwise: no
  // confetti, no trophy, and a heading that says what actually happened. The
  // player who left is told plainly that they left, which is the honest reading
  // of a match they ended themselves.
  const isForfeit = $derived(typeof forfeitBy === 'number' && forfeitBy >= 0)
  const iForfeited = $derived(isForfeit && forfeitedByMe === true)
  const iOffered = $derived(typeof mySeat === 'number' && rematchOffers.includes(mySeat))
  const theyOffered = $derived(rematchOffers.some((seat) => seat !== mySeat))
  // Nobody is asked to agree with an empty table. A matchmade one requeues
  // instead (App does it without being asked); an ordinary one keeps the button
  // in place and disabled, because the table is still there and somebody may
  // still walk back into it.
  const canRematch = $derived(!isForfeit && hasTablemates)
  // Past two seats "waiting on them" names nobody, and the count is the only
  // thing that says how far off the next match is. At two it would be noise.
  //
  // Read off the roster rather than off `rematchNeeded`: two asks deal the next
  // match at any size (server `RematchQuorum`), so the quorum stopped being able
  // to say how big the table is the moment it stopped counting the table.
  const isTable = $derived(players.length > 2)
  const progress = $derived(
    isTable ? ` ${t.rematchProgress(rematchOffers.length, rematchNeeded)}` : '',
  )
  // Rounds won first, points second: the same order the server settles the match
  // in, so the top row is always the name in the heading. Sorting on points here
  // used to put a losing seat above the winner whenever one expensive round beat
  // two cheap ones.
  const ranked = $derived(
    (scoreboard ?? []).slice().sort((a, b) => b.rounds_won - a.rounds_won || b.score - a.score),
  )
  const recap = $derived(buildMatchRecap(players, matchHistory))
  const showRecap = $derived(hasEveningToShow(matchHistory))
  // Read through a $derived rather than out of the snapshot inside the markup:
  // `game.current` is replaced whole on every message. See hooks/live.svelte.ts.
  const serverUpdating = $derived(game.current.serverUpdating)
  const emotes = $derived(game.current.emotes)
  const nameOf = $derived((s: number) => players.find((p) => p.index === s)?.nickname ?? '')

  /*
   * One slot per seat, in seat order, drawn whether or not that seat has said
   * anything.
   *
   * The card's height is the table's size and nothing else: a slot that only
   * existed once somebody spoke moved the two offers and the way out down the
   * screen under the thumb aiming for them, and every arrival moved them again.
   * An empty slot renders as height and nothing else.
   */
  const emoteSlots = $derived(
    players.map((p) => ({ seat: p.index, flash: emotes.find((e) => e.seat === p.index) ?? null })),
  )
  /** What we are saying, so the row can show which of the three is ours. */
  const myEmote = $derived(emotes.find((e) => e.seat === mySeat)?.emote ?? null)
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
            <!-- Rounds lead, points follow. The match was decided by the first
                 and measured by the second, and a card that shouted the points
                 was explaining the result with the wrong number. -->
            <span class="scoreDetails">
              <span class="scoreVal">{t.roundsWonCount(entry.rounds_won)}</span>
              <span class="scoreGap">{entry.score} pts</span>
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <!-- The evening, match by match. Hidden until the table has rematched: one
         column is the standings above, said twice. A cumulative total would hide
         the thing worth seeing — a 3-0 sweep and three matches taken on the last
         round are the same number and not the same evening. -->
    {#if showRecap}
      <div class="recap">
        <h3 class="scoreboardTitle">{t.recapTitle}</h3>
        <!-- Scrolls sideways past a few matches, so it takes a focus stop and a
             ring: a box that scrolls has to be reachable from the keyboard.
             Nothing inside it is focusable, which is exactly why the box itself
             has to be — the same rule the content pages' .tableWrap follows. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="recapScroller" tabindex="0">
          <table class="recapTable">
            <thead>
              <tr>
                <th class="recapThName">{t.player}</th>
                {#each matchHistory as _, i (i)}
                  <th class="recapTh">{t.recapMatchCol.replace('%n', String(i + 1))}</th>
                {/each}
                <th class="recapTh recapThTotal">{t.recapWonCol}</th>
              </tr>
            </thead>
            <tbody>
              {#each recap as row (row.index)}
                <tr>
                  <td class="recapName">{row.nickname}</td>
                  {#each row.cells as cell, i (i)}
                    <td class="recapCell" class:recapCellWon={cell.won}>
                      <span class="recapRounds">{cell.roundsWon}</span>
                      <span class="recapScore">{cell.score}</span>
                    </td>
                  {/each}
                  <td class="recapCell recapTotal">{row.matchesWon}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}

    <!-- A deploy is under way, so the button under this is going to be refused.
         Said before it is pressed rather than after: a rematch that comes back
         "server updating" on a screen that never mentioned a deploy reads as the
         button being broken. -->
    {#if serverUpdating}
      <ServerUpdating variant="card" />
    {/if}

    <!-- A solo game has nobody to agree with, so it offers a press instead of an
         ask: another hand against the server, or the queue, which is the other
         half of the same offer the entry screen made. Nothing here is ever
         rendered as a rematch — a button that said "waiting on them" over a seat
         the server is playing would be a lie the screen tells itself. -->
    {#if isSolo}
      <button class="btn" onclick={() => onPlayBot?.()}>{t.playBotAgain}</button>
      <button class="btn btnRematch" onclick={onFindMatch}>{t.findMatch}</button>
    {:else}
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
    {/if}

    <!-- Three fixed things, and the whole vocabulary the game has. After a close
         1v1 against a stranger there was no way to say anything at all, and free
         text would be a moderation surface this game promises not to have.
         Nothing said here is stored, logged or carried anywhere: it is shown for
         a few seconds and forgotten. -->
    {#if onEmote}
      <div class="emotes">
        <!-- One line per seat, always drawn: what changes when the table talks
             is what a line says, never how many there are. `aria-live` is on
             the list rather than on a bubble that comes and goes, so a screen
             reader is told the new sentence and not a new region. -->
        <ul class="emoteFeed" aria-live="polite">
          {#each emoteSlots as slot (slot.seat)}
            <li class="emoteSlot" class:emoteSlotMine={slot.seat === mySeat}>
              {#if slot.flash}
                <!-- Keyed on the arrival so saying the same thing twice pops
                     again: the bubble is already there, and the only thing that
                     can acknowledge the press is the animation. -->
                {#key slot.flash.at}
                  <span class="emoteBubble" class:emoteMine={slot.seat === mySeat}>
                    <span class="emoteWho">{nameOf(slot.seat)}</span>
                    <span class="emoteWhat">{t.emotes[slot.flash.emote]}</span>
                  </span>
                {/key}
              {/if}
            </li>
          {/each}
        </ul>
        <div class="emoteRow" role="group" aria-label={t.emotesLabel}>
          {#each EMOTE_ORDER as id (id)}
            <button
              class="emoteBtn"
              class:emoteBtnOn={myEmote === id}
              aria-pressed={myEmote === id}
              onclick={() => onEmote?.(id)}>{t.emotes[id]}</button
            >
          {/each}
        </div>
      </div>
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
    /* Pulled up against the heading it belongs to. The card is one gap all the
       way down otherwise, and a stack spaced evenly from the trophy to the way
       out reads as one long list rather than as a result, a scoreboard and two
       offers. */
    margin-top: calc(-1 * var(--space-sm));
    font: 600 16px/1.4 var(--font-body);
    color: var(--color-body);
    text-align: center;
  }

  /* The seam between the numbers and the first thing that can be pressed: the
     one place on the card where a step of air is worth more than compactness. */
  .scoreboard + .btn,
  .recap + .btn {
    margin-top: var(--space-xs);
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

  /* The gap, not the result. Quiet is a hue here like everywhere else. */
  .scoreGap {
    font: 700 11px/1.2 var(--font-display);
    color: var(--color-muted);
  }

  .scoreRowWinner .scoreGap {
    color: var(--color-on-secondary);
  }

  /* The evening's recap: a small dense grid under the standings, built like the
     TAB table rather than like the trophy card above it — it is consulted, not
     celebrated. */
  .recap {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-md);
    background: var(--color-surface-strong);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-md);
  }

  .recapScroller {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  /* The focus ring comes from tokens.css, which rings every [tabindex] on every
     surface. A second declaration here would be a second definition of it. */

  /* `separate`, not `collapse`. Two of these columns are pinned, and a collapsed
     border belongs to the *pair* of cells that share it: the rule meant to mark
     the pinned right-hand column stayed behind with the column it was collapsed
     against and never moved with it. Zero spacing, so nothing else changes. */
  .recapTable {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font: 700 12px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .recapTh,
  .recapThName {
    /* 11px, which is the floor — the Label step included. These name the columns
       somebody reads the evening out of, and the score table's heads were pulled
       back off 10px for exactly this reason. */
    font: 700 11px/1.15 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-muted);
    padding: 0 5px 4px;
    vertical-align: bottom;
  }

  .recapTh,
  .recapThName,
  .recapThTotal {
    white-space: nowrap;
  }

  .recapThName {
    text-align: left;
  }

  .recapThTotal {
    color: var(--color-ink);
  }

  /* Who, and how many taken: the question the block exists to answer. Both are
     pinned, so a long evening scrolls the matches *between* them rather than
     carrying the answer off the right edge. The hairline is what says the
     column is pinned rather than merely first. */
  .recapName,
  .recapThName,
  .recapTotal,
  .recapThTotal {
    position: sticky;
    z-index: 1;
    background: var(--color-surface-strong);
  }

  .recapName,
  .recapThName {
    left: 0;
    border-right: 2px solid var(--color-border-strong);
  }

  .recapTotal,
  .recapThTotal {
    right: 0;
    border-left: 2px solid var(--color-border-strong);
  }

  /* One line per seat, so a row can be followed across a grid that is scrolling
     under two pinned columns. Drawn on the cells, never on the row: a `<tr>`
     border is not painted at all when the borders are separate. */
  .recapTable tbody tr:not(:last-child) td {
    border-bottom: var(--stroke-thin) solid var(--color-hairline);
  }

  .recapName {
    padding: 4px 8px 4px 0;
    max-width: 11ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recapCell {
    padding: 4px 5px;
    text-align: center;
    white-space: nowrap;
  }

  /* Rounds over points rather than beside them. Side by side, one match column
     was 62px against a 244px scrollport, so an evening of three already ran off
     the edge; stacked it is 38px and a four-match evening fits a phone whole. It
     also puts the two numbers in the order they are read — what was won, then
     what it was won by. The column head is `M%n` for the same reason and by the
     same convention as the score table's: a word set over a two-digit column
     sizes the whole grid on the label instead of on the numbers. */
  .recapRounds {
    display: inline-block;
    min-width: 15px;
    font-size: 14px;
  }

  /* The seat that took that match, in the colour this game wins in — the gold of
     the scoreboard row directly above, so the two blocks agree. It is a filled
     body rather than a recoloured digit: LOCO Red on the panel measures 2.9:1,
     and a hue on its own is not something a spectator picks out of a grid at
     720p anyway. */
  .recapCellWon .recapRounds {
    padding: 1px 7px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
  }

  .recapScore {
    display: block;
    margin-top: 2px;
    font-size: 11px;
    color: var(--color-muted);
  }

  .recapTotal {
    padding: 4px 0 4px 10px;
    font-size: 15px;
  }

  .recapThName {
    padding-left: 0;
  }

  .recapThTotal {
    padding-right: 0;
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
  /* The three things, under the two offers and above the way out: it is the
     smallest thing on the card that is not leaving. */
  .emotes {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .emoteFeed {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    padding: 0;
  }

  /* The reserved line. It holds its height with nothing in it, which is the
     whole point: the card is the same card before and after anybody speaks. */
  .emoteSlot {
    display: flex;
    justify-content: flex-start;
    min-height: 30px;
  }

  /* Ours on the other side, so a table of six can tell who said what without
     reading every name. */
  .emoteSlotMine {
    justify-content: flex-end;
  }

  .emoteBubble {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    max-width: 100%;
    padding: 5px 11px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    font: 600 13px/1.3 var(--font-body);
    color: var(--color-ink);
    animation: emoteIn 0.22s var(--ease-bounce) both;
  }

  .emoteMine {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
    border-color: var(--color-stroke);
  }

  .emoteWho {
    font: 700 11px/1.3 var(--font-display);
    color: var(--color-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 10ch;
  }

  .emoteMine .emoteWho {
    color: var(--color-on-dark);
    opacity: 0.75;
  }

  @keyframes emoteIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .emoteRow {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 6px;
  }

  .emoteBtn {
    /* Sized to its own word, never stretched to a third of the row. Three equal
       columns give the longest string the set has ("C'était serré") 77px to sit
       in on a 360px phone, so one chip of the three broke onto a second line
       while its neighbours stayed on one — the ragged row. Left to their labels
       the three come to 249px of the 280 available and all read on one line, and
       three chips of three widths is what a set of fixed things looks like
       anyway. */
    flex: 0 1 auto;
    min-height: 44px;
    padding: 6px 14px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    background: var(--color-surface-strong);
    color: var(--color-body);
    font: 700 13px/1.2 var(--font-display);
    cursor: pointer;
    touch-action: manipulation;
    transition:
      transform 0.12s var(--ease-bounce),
      color 0.15s;
  }

  .emoteBtn:hover {
    color: var(--color-ink);
    transform: translateY(-2px);
  }

  /* Pressing another one moves this, it never adds a second line, so the row
     has to say which of the three is ours. */
  .emoteBtnOn {
    background: var(--gradient-tertiary);
    color: var(--color-on-dark);
  }

  .emoteBtnOn:hover {
    color: var(--color-on-dark);
  }

  .emoteBtn:active {
    transform: translateY(1px);
  }

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

  /* Degrades to a readable static state, never to nothing: what somebody said is
     information, and only the way it arrives was motion. */
  :root[data-motion="reduce"] .emoteBubble {
    animation: none;
  }

  :root[data-motion="reduce"] .emoteBtn:hover,
  :root[data-motion="reduce"] .emoteBtn:active {
    transform: none;
  }
</style>
