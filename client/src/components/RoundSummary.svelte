<script lang="ts">
  import type { RoundScoreEntry } from '../hooks/gameStore'
  import { countUp } from './countUp'
  import type { ScoreboardEntryDTO, MatchFormat } from '../types/protocol'
  import type { Translations } from '../i18n/en'
  import { formatRounds } from './matchLengthModel'
  import OutcomeMark from './OutcomeMark.svelte'

  function placementSuffix(rank: number, tr: Translations): string {
    if (rank === 1) return tr.ord1
    if (rank === 2) return tr.ord2
    if (rank === 3) return tr.ord3
    return `${rank}${tr.ordN}`
  }

  type Props = {
    roundNumber: number
    roundWinner: string
    roundScores: RoundScoreEntry[]
    scoreboard: ScoreboardEntryDTO[]
    matchFormat: MatchFormat
    summaryCountdown: number
    /**
     * The match is over and its payload is buffered behind this summary. It is
     * how the card tells "the format ran out and somebody won" from "the format
     * ran out and nothing separates the table", which is the whole difference
     * between the last round and a decisive one.
     */
    matchOverPending: boolean
    onDismiss: () => void
    t: Translations
  }

  let {
    roundNumber,
    roundWinner,
    roundScores,
    scoreboard,
    matchFormat,
    summaryCountdown,
    matchOverPending,
    onDismiss,
    t,
  }: Props = $props()

  const matchRoundsNeeded = $derived(formatRounds(matchFormat))

  // The round that just ended was itself a decisive one: past the format, so it
  // has no number the format can name. "Round 4 of 3" is a broken counter.
  const wasDecisive = $derived(roundNumber > matchRoundsNeeded)

  // And the next one is decisive whenever the format has run out with the match
  // still running: the server only deals past the format when its whole
  // tiebreak chain — rounds won, points, lost-hand total — separated nobody.
  const nextIsDecisive = $derived(roundNumber >= matchRoundsNeeded && !matchOverPending)

  // Sort by round_points descending to show placements; ties broken by cumulative score
  const sorted = $derived(
    roundScores
      .slice()
      .sort((a, b) => b.round_points - a.round_points || b.cumulative_score - a.cumulative_score),
  )

  // "Where the match stands" is a standings table, so it is ordered the way the
  // match is settled: rounds won, then points. Ordering it on points alone put
  // the seat that is actually behind at the top of it.
  const ranked = $derived(
    scoreboard.slice().sort((a, b) => b.rounds_won - a.rounds_won || b.score - a.score),
  )
</script>

<div class="roundSummary">
  <div class="roundSummaryCard">
    <div class="roundSummaryTitle">
      {#if wasDecisive}
        {t.decisiveRound}
        {t.complete}
      {:else}
        {t.round}
        {roundNumber}{matchRoundsNeeded > 1 ? ` ${t.of} ${matchRoundsNeeded}` : ''}
        {t.complete}
      {/if}
    </div>
    <!-- The same drawing that heads the game-over card, at line size: a round
         won and a match won are the same event at two scales, and the trophy
         emoji that used to sit here belonged to neither. -->
    <div class="roundSummaryWinner">
      <OutcomeMark outcome="win" size="sm" />
      {roundWinner}
      {t.winsRound}
    </div>

    <div class="roundScoreTable">
      <div class="roundScoreHeader">
        <span>{t.placementLabel}</span>
        <span>{t.player}</span>
        <span>{t.ptsLabel}</span>
        <span>{t.winsLabel}</span>
        <span>{t.totalLabel}</span>
      </div>
      {#each sorted as entry, idx (entry.player_index)}
        <div
          class="roundScoreRow"
          class:roundScoreRowWinner={entry.nickname === roundWinner}
          style="--row-i: {idx}"
        >
          <span class="roundScorePlacement">{placementSuffix(idx + 1, t)}</span>
          <span class="roundScoreName">{entry.nickname}</span>
          <!-- The points climb to their value: a figure that pops into place is
               a spreadsheet cell, one that is counted is a score. -->
          {#if entry.round_points > 0}
            <span
              class="roundScoreDelta"
              use:countUp={{ value: entry.round_points, format: (n) => `+${n}` }}
            ></span>
          {:else}
            <span class="roundScoreDelta">—</span>
          {/if}
          <span class="roundScoreWins">{entry.rounds_won}</span>
          <span class="roundScoreTotal" use:countUp={{ value: entry.cumulative_score }}></span>
        </div>
      {/each}
    </div>

    {#if scoreboard.length > 0 && matchRoundsNeeded > 1}
      <div class="matchProgress">
        <div class="matchProgressTitle">
          {t.matchScoreboard} — {matchFormat}
        </div>
        <div class="scoreboard">
          {#each ranked as entry (entry.player_index)}
            <div class="scoreRow">
              <span class="scoreName">{entry.nickname}</span>
              <span class="scoreDetails">
                <span class="scoreVal">{t.roundsWonCount(entry.rounds_won)}</span>
                <span class="scoreGap" use:countUp={{ value: entry.score, format: (n) => `${n} pts` }}></span>
              </span>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if nextIsDecisive}
      <div class="decisiveNext">
        <span class="decisiveLabel">{t.decisiveRound}</span>
        <span class="decisiveWhy">{t.decisiveRoundWhy}</span>
      </div>
    {/if}

    <button class="btnContinue" onclick={onDismiss}>
      {t.continueBtn} ({summaryCountdown}s)
    </button>
  </div>
</div>

<style>
  /* Between-rounds scoreboard. Overlays the live board, so it needs enough weight
     to own the screen for its eight seconds without hiding the table entirely. */

  /* The heavy scrim, and no blur. The next round is dealt *under* this card
     (see docs/notes/visual.md, "The card is an overlay"), so for up to eight
     seconds a `backdrop-filter` was re-rasterising the whole viewport on every
     frame of the deal behind it — the most expensive thing the client did all
     round, for a card whose only job is to be read.

     47: above the three shouts (45), the chrome row and the leave question
     (46) and level with the catch capsule, under the standings (48). It sat at
     40, so an interception slam, the chip row and a catch window's countdown
     could all be drawn across the scores. The whole ledger, and why the
     capsule and this card can share a number, is in `ScoreTable.svelte`. */
  .roundSummary {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-base);
    background: var(--color-scrim-heavy);
    z-index: 47;
    animation: summaryFade 0.25s ease-out both;
  }

  @keyframes summaryFade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .roundSummaryCard {
    width: 420px;
    max-width: 100%;
    max-height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: var(--color-surface-card);
    border: 4px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-pop);
    animation: summaryIn 0.42s var(--ease-bounce) both;
  }

  @keyframes summaryIn {
    from {
      opacity: 0;
      transform: translateY(30px) scale(0.92);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .roundSummaryTitle {
    font: 700 13px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-muted);
    text-align: center;
  }

  .roundSummaryWinner {
    font: 700 clamp(22px, 5vw, 28px) / 1.2 var(--font-display);
    color: var(--color-primary);
    text-align: center;
    -webkit-text-stroke: 2px var(--color-stroke);
    paint-order: stroke fill;
  }

  .roundScoreTable {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .roundScoreHeader,
  .roundScoreRow {
    display: grid;
    grid-template-columns: 40px 1fr 56px 56px 40px;
    align-items: center;
    gap: var(--space-xs);
  }

  /* 12px is the floor for anything on a screen a spectator reads; the heads,
     the progress title and the gap below were 11. */
  .roundScoreHeader {
    font: 700 12px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-muted);
    padding: 0 12px;
  }

  .roundScoreRow {
    padding: 9px 12px;
    background: var(--color-surface-strong);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full);
    font: 600 14px/1.2 var(--font-display);
    color: var(--color-ink);
  }

  .roundScoreRowWinner {
    background: var(--gradient-secondary);
    color: var(--color-on-secondary);
    box-shadow: 0 3px 0 var(--color-stroke-soft);
  }

  .roundScorePlacement {
    font-weight: 700;
    color: var(--color-muted);
  }

  .roundScoreRowWinner .roundScorePlacement {
    color: var(--color-on-secondary-muted);
  }

  .roundScoreName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* The mint as text, never the mint as a fill: `--color-mint` on the row's
     surface-strong measured 1.81:1 in light, so the one number this card is
     opened for was the one nobody could read. The token is the same hue pushed
     until it clears AA on each canvas (tokens.css). */
  .roundScoreDelta {
    font-weight: 700;
    color: var(--color-mint-text);
    text-align: right;
  }

  .roundScoreRowWinner .roundScoreDelta {
    color: var(--color-on-secondary-mint);
  }

  /* Rounds won carries the weight now: it is what the match is settled on. The
     cumulative total sits beside it as the gap, in the quiet hue. */
  .roundScoreWins {
    text-align: right;
    font-weight: 700;
  }

  .roundScoreTotal {
    text-align: right;
    color: var(--color-muted);
  }

  .matchProgress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-md);
    background: var(--color-surface-soft);
    border: var(--stroke-thin) solid var(--color-hairline);
    border-radius: var(--radius-md);
  }

  .matchProgressTitle {
    font: 700 12px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted);
    text-align: center;
  }

  .scoreboard {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .scoreRow {
    display: flex;
    justify-content: space-between;
    gap: var(--space-sm);
    font: 600 13px/1.3 var(--font-body);
    color: var(--color-body);
    padding: 2px 4px;
  }

  .scoreName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scoreVal {
    flex-shrink: 0;
    font-weight: 700;
  }

  .scoreDetails {
    display: flex;
    align-items: baseline;
    gap: var(--space-xs);
    flex-shrink: 0;
  }

  /* The gap, not the result. A hue rather than an opacity, like everywhere. */
  .scoreGap {
    flex-shrink: 0;
    font: 700 12px/1.3 var(--font-display);
    color: var(--color-muted);
  }

  /* The format ran out and the match is still running. It is announced next to
     the button that goes there, not up in the title: the title says what just
     happened, this says what happens now.

     **It fades in on a delay, and the delay is the point.** `round_ended` and
     `match_end` are two messages, so the card is composed and can be painted
     before the second one lands: without the delay an ordinary final round
     shows "decisive round" for a frame before the match-end payload arrives and
     takes it away. A third of a second costs a real decisive round nothing and
     is longer than any gap between two messages off the same socket read. */
  .decisiveNext {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: var(--space-sm) var(--space-md);
    background: var(--color-surface-strong);
    border: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-md);
    text-align: center;
    animation: decisiveIn 0.3s var(--ease-out) 0.35s both;
  }

  @keyframes decisiveIn {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .decisiveLabel {
    font: 700 15px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--color-primary);
  }

  .decisiveWhy {
    font: 600 13px/1.35 var(--font-body);
    color: var(--color-body);
  }

  .btnContinue {
    width: 100%;
    padding: 13px 24px;
    min-height: 52px;
    border-radius: var(--radius-full);
    border: var(--stroke) solid var(--color-stroke);
    background: var(--gradient-primary);
    color: var(--color-on-primary);
    text-shadow: 0 2px 0 rgba(120, 10, 40, 0.4);
    font: 700 17px/1.2 var(--font-display);
    cursor: pointer;
    box-shadow: 0 5px 0 var(--color-stroke-soft);
    transition:
      transform 0.12s var(--ease-bounce),
      box-shadow 0.12s var(--ease-out),
      filter 0.12s ease;
    touch-action: manipulation;
  }

  .btnContinue:hover {
    transform: translateY(-3px);
    box-shadow: 0 8px 0 var(--color-stroke-soft);
    filter: brightness(1.06);
  }
  .btnContinue:active {
    transform: translateY(3px);
    box-shadow: 0 2px 0 var(--color-stroke-soft);
  }

  @media (max-width: 480px) {
    .roundScoreHeader,
    .roundScoreRow {
      grid-template-columns: 32px 1fr 46px 46px 32px;
      font-size: 13px;
    }
  }

  :root[data-motion="reduce"] .roundSummary,
  :root[data-motion="reduce"] .roundSummaryCard {
    animation: none;
  }

  /* The band keeps its delay under reduced motion: it is not decoration, it is
     what stops a final round from being labelled decisive for a frame. Only the
     movement goes. */
  :root[data-motion="reduce"] .decisiveNext {
    animation: decisiveIn 0.01s linear 0.35s both;
    transform: none;
  }

  /* Rows arrive one after another, top place first: the card is read from the
     top, and a list that lands all at once is read nowhere. */
  .roundScoreRow {
    animation: rowIn 0.34s var(--ease-out) both;
    animation-delay: calc(0.12s + var(--row-i, 0) * 0.06s);
  }

  @keyframes rowIn {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  /* The winner's row catches the light once, after it has landed: a sweep on
     a pseudo-element, transform only, over a gradient that never repaints. */
  .roundScoreRowWinner {
    position: relative;
    overflow: hidden;
  }

  .roundScoreRowWinner::after {
    content: '';
    position: absolute;
    inset: -40% 0;
    width: 40%;
    background: linear-gradient(105deg, transparent 0%, rgba(255, 255, 255, 0.55) 50%, transparent 100%);
    transform: translateX(-160%) skewX(-18deg);
    pointer-events: none;
    animation: rowShine 0.9s ease-in-out 0.7s 1 both;
  }

  @keyframes rowShine {
    to {
      transform: translateX(340%) skewX(-18deg);
    }
  }

  :root[data-motion='reduce'] .roundScoreRow,
  :root[data-motion='reduce'] .roundScoreRowWinner::after {
    animation: none;
  }
</style>
