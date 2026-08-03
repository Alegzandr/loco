<script lang="ts">
  import type { RoundScoreEntry } from '../hooks/gameStore'
  import type { ScoreboardEntryDTO, MatchFormat } from '../types/protocol'
  import type { Translations } from '../i18n/en'

  function matchFormatRounds(fmt: string): number {
    switch (fmt) {
      case 'BO3':
        return 3
      case 'BO5':
        return 5
      case 'BO7':
        return 7
      default:
        return 1
    }
  }

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
    onDismiss,
    t,
  }: Props = $props()

  const matchRoundsNeeded = $derived(matchFormatRounds(matchFormat))

  // Sort by round_points descending to show placements; ties broken by cumulative score
  const sorted = $derived(
    roundScores
      .slice()
      .sort((a, b) => b.round_points - a.round_points || b.cumulative_score - a.cumulative_score),
  )

  const ranked = $derived(scoreboard.slice().sort((a, b) => b.score - a.score))
</script>

<div class="roundSummary">
  <div class="roundSummaryCard">
    <div class="roundSummaryTitle">
      {t.round}
      {roundNumber}{matchRoundsNeeded > 1 ? ` ${t.of} ${matchRoundsNeeded}` : ''}
      {t.complete}
    </div>
    <div class="roundSummaryWinner">
      🏆 {roundWinner} {t.winsRound}
    </div>

    <div class="roundScoreTable">
      <div class="roundScoreHeader">
        <span>{t.placementLabel}</span>
        <span>{t.player}</span>
        <span>{t.ptsLabel}</span>
        <span>{t.totalLabel}</span>
        <span>{t.winsLabel}</span>
      </div>
      {#each sorted as entry, idx (entry.player_index)}
        <div class="roundScoreRow" class:roundScoreRowWinner={entry.nickname === roundWinner}>
          <span class="roundScorePlacement">{placementSuffix(idx + 1, t)}</span>
          <span class="roundScoreName">{entry.nickname}</span>
          <span class="roundScoreDelta">
            {entry.round_points > 0 ? `+${entry.round_points}` : '—'}
          </span>
          <span class="roundScoreTotal">{entry.cumulative_score}</span>
          <span class="roundScoreWins">{entry.rounds_won}</span>
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
              <span class="scoreVal">{entry.score} pts · {entry.rounds_won}W</span>
            </div>
          {/each}
        </div>
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

  .roundSummary {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-base);
    background: var(--color-scrim);
    backdrop-filter: blur(5px);
    z-index: 40;
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

  .roundScoreHeader {
    font: 700 11px/1.2 var(--font-display);
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
    color: #7a4a00;
  }

  .roundScoreName {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .roundScoreDelta {
    font-weight: 700;
    color: var(--color-mint);
    text-align: right;
  }

  .roundScoreRowWinner .roundScoreDelta {
    color: #1f6b3c;
  }

  .roundScoreTotal {
    text-align: right;
    font-weight: 700;
  }

  .roundScoreWins {
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
    font: 700 11px/1.2 var(--font-display);
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
</style>
