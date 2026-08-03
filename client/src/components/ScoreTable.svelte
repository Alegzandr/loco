<script lang="ts">
  import type { LatencyEntryDTO, PlayerDTO, ScoreboardEntryDTO } from '../types/protocol'
  import { buildScoreRows, pingTier } from './scoreTableModel'
  import type { Translations } from '../i18n/en'
  import { seatColor } from './playerColors'
  import { escapeKey } from '../hooks/escapeKey.svelte'

  type Props = {
    players: PlayerDTO[]
    scoreboard: ScoreboardEntryDTO[]
    roundHistory: number[][]
    latencies: LatencyEntryDTO[]
    myIndex: number
    t: Translations
    /** Tap-outside handler, only wired up when the table is pinned by the button. */
    onDismiss?: () => void
  }

  let { players, scoreboard, roundHistory, latencies, myIndex, t, onDismiss }: Props = $props()

  const rows = $derived(buildScoreRows(players, scoreboard, roundHistory, latencies))

  // Only while pinned: held open with TAB it closes when the key comes up, and an
  // Escape listener that outlived that would be one nobody asked for.
  escapeKey(
    () => !!onDismiss,
    () => onDismiss?.(),
  )
</script>

<!--
  In-game standings, held open with TAB (or pinned with the touch button).

  Read-only and non-interactive by design: it is consulted mid-round, often while
  it is somebody else's turn and the player is about to interrupt, so nothing here
  may take a click that was meant for a card.
-->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="overlay" onpointerdown={() => onDismiss?.()} data-testid="score-table">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="card" onpointerdown={(e) => e.stopPropagation()}>
    <div class="header">
      <h2 class="title">{t.scoreTableTitle}</h2>
      <!-- Pinned by the touch button, so the way out has to be one too: the hint
           names a key a phone does not have, and the button that pinned it is
           underneath the scrim. Held with TAB there is nothing to close, and a ✕
           that appears for a fifth of a second is noise. -->
      {#if onDismiss}
        <button class="closeBtn" onclick={onDismiss} aria-label={t.scoreTableClose}>
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
            <path
              d="M6 6l12 12M18 6L6 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {:else}
        <span class="hint">{t.scoreTableHint}</span>
      {/if}
    </div>

    <div class="scroller">
      <table class="table">
        <thead>
          <tr>
            <th class="thPlayer">{t.player}</th>
            {#each roundHistory as _, i (i)}
              <th class="thRound">{t.scoreTableRoundCol.replace('%n', String(i + 1))}</th>
            {/each}
            <th class="thNum">{t.totalLabel}</th>
            <th class="thNum colWins">{t.winsLabel}</th>
            <th class="thPing">{t.scoreTablePingCol}</th>
          </tr>
        </thead>
        <tbody>
          {#each rows as row (row.index)}
            <tr
              class="row"
              class:rowMe={row.index === myIndex}
              class:rowOffline={!row.connected}
            >
              <!-- The flex box is an inner div: a display:flex <td> drops out of
                   the table's column sizing and the row splits in two. -->
              <td class="tdPlayer">
                <div class="playerCell">
                  <span class="dot" style="background: {seatColor(row.index)}"></span>
                  <span class="nickname">{row.nickname}</span>
                  {#if row.index === myIndex}
                    <span class="you">{t.scoreTableYou}</span>
                  {/if}
                </div>
              </td>
              {#each row.perRound as points, i (i)}
                <td class="tdRound">{points > 0 ? `+${points}` : '·'}</td>
              {/each}
              <td class="tdTotal">{row.total}</td>
              <td class="tdNum colWins">{row.wins}</td>
              <td class="tdPing">
                <span class="ping" data-tier={pingTier(row.rtt)}>
                  {row.bot
                    ? t.scoreTableBot
                    : pingTier(row.rtt) === 'unknown'
                      ? t.scoreTableNoPing
                      : `${row.rtt} ms`}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- A note under the table, never a column header: the sentence is far wider
         than the 40px a round column gets, and as a nowrap <th> it stretched the
         whole table past the card and pushed the ping off the right edge of a
         phone. -->
    {#if roundHistory.length === 0}
      <p class="note">{t.scoreTableEmptyRounds}</p>
    {/if}
  </div>
</div>

<style>
  /* Consulted mid-round, so it sits above the board but stays a panel rather than
     a full-screen takeover: the discard and the active seat must remain readable
     at the edges while a player checks who is about to win. */

  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: calc(var(--space-base) + var(--safe-top)) calc(var(--space-base) + var(--safe-right))
      calc(var(--space-base) + var(--safe-bottom)) calc(var(--space-base) + var(--safe-left));
    background: var(--color-scrim);
    backdrop-filter: blur(5px);
    z-index: 45;
    animation: scoreFade 0.14s var(--ease-out) both;
  }

  @keyframes scoreFade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .card {
    width: 620px;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-md);
    padding: var(--space-lg);
    background: var(--color-surface-card);
    border: 4px solid var(--color-stroke);
    border-radius: var(--radius-xl);
    box-shadow: var(--shadow-pop);
    /* Fast and small: TAB is tapped dozens of times a match, and a 400ms bounce
       on every peek would make the overlay feel heavier than the game. */
    animation: scoreIn 0.16s var(--ease-out) both;
  }

  @keyframes scoreIn {
    from {
      opacity: 0;
      transform: translateY(10px) scale(0.97);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-sm);
  }

  .title {
    margin: 0;
    font: 700 clamp(20px, 4vw, 26px) / 1.1 var(--font-display);
    color: var(--color-ink);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .hint {
    font: 700 11px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-muted);
  }

  /* The way out while the panel is pinned. Same shape as the rules modal's, so
     the ✕ is one object across the game rather than one per panel. */
  .closeBtn {
    align-self: center;
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--color-ink);
    cursor: pointer;
    transition: background 0.15s;
  }

  .closeBtn:hover,
  .closeBtn:focus-visible {
    background: var(--color-surface-strong);
  }

  /* No keyboard, no TAB. On a touch device the hint is an instruction the player
     cannot carry out, and the button that opened the panel is right above it. */
  @media (hover: none) and (pointer: coarse) {
    .hint {
      display: none;
    }
  }

  /* Seven rounds plus the fixed columns overflow a phone; the table scrolls
     inside its own box so the page never does. */
  .scroller {
    overflow: auto;
    margin: 0 calc(-1 * var(--space-xs));
    padding: 0 var(--space-xs);
  }

  .table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 5px;
  }

  /* The Label step, not below it: these name the columns a spectator reads the
     standings out of, and --color-muted-soft put them at ~3:1 on the panel in
     light and ~2.6:1 in dark. Quiet is a weight and a size here, not a contrast
     the header has to be squinted through. */
  .table th {
    font: 700 11px/1.2 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--color-muted);
    padding: 0 8px 2px;
    text-align: center;
    white-space: nowrap;
  }

  .thPlayer {
    text-align: left !important;
    min-width: 120px;
  }

  .thRound {
    width: 42px;
  }
  .thNum {
    width: 54px;
  }
  .thPing {
    width: 72px;
  }

  .note {
    margin: 0;
    text-align: center;
    font: 600 12px/1.3 var(--font-body);
    color: var(--color-muted);
  }

  .row td {
    background: var(--color-surface-strong);
    border-top: var(--stroke-thin) solid var(--color-stroke);
    border-bottom: var(--stroke-thin) solid var(--color-stroke);
    padding: 8px;
    font: 600 14px/1.2 var(--font-display);
    color: var(--color-ink);
    text-align: center;
    white-space: nowrap;
  }

  .row td:first-child {
    border-left: var(--stroke-thin) solid var(--color-stroke);
    border-radius: var(--radius-full) 0 0 var(--radius-full);
    padding-left: 14px;
    text-align: left;
  }

  .row td:last-child {
    border-right: var(--stroke-thin) solid var(--color-stroke);
    border-radius: 0 var(--radius-full) var(--radius-full) 0;
    padding-right: 14px;
  }

  /* Your own row is the one a player looks for first. */
  .rowMe td {
    background: var(--color-secondary);
    color: var(--color-stroke);
  }

  .rowOffline td {
    opacity: 0.55;
  }

  .playerCell {
    display: flex;
    align-items: center;
    gap: var(--space-sm);
  }

  .dot {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    flex: none;
  }

  .nickname {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }

  .you {
    font: 700 11px/1 var(--font-display);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 6px;
    border-radius: var(--radius-full);
    background: var(--color-stroke);
    color: var(--color-on-dark);
  }

  /* A round nobody scored in is a dot, not a zero: a column of zeroes reads as
     data, and the only number that matters here is the one somebody won. */
  .tdRound {
    color: var(--color-body);
  }

  .tdTotal {
    font-weight: 700;
    font-size: 16px;
  }

  .ping {
    display: inline-block;
    min-width: 58px;
    padding: 4px 8px;
    border-radius: var(--radius-full);
    border: var(--stroke-thin) solid var(--color-stroke);
    font: 700 12px/1.2 var(--font-display);
    color: var(--color-stroke);
    background: var(--color-surface-card);
  }

  /* Colour AND position carry the meaning here: the tiers are ordered, so a
     colourblind viewer still reads the number next to them. */
  .ping[data-tier='good'] {
    background: #12c48f;
  }
  .ping[data-tier='ok'] {
    background: #ffc93c;
  }
  .ping[data-tier='poor'] {
    background: #ff9f1a;
  }
  .ping[data-tier='bad'] {
    background: #e5304b;
    color: var(--color-on-dark);
  }
  .ping[data-tier='unknown'] {
    background: transparent;
    border-color: var(--color-border-strong);
    color: var(--color-muted);
  }

  @media (max-width: 480px) {
    .card {
      padding: var(--space-base);
      gap: var(--space-sm);
    }
    .row td {
      padding: 7px 5px;
      font-size: 13px;
    }
    .row td:first-child {
      padding-left: 10px;
    }
    /* The ping pill is the widest thing in the row; without real room on the
       right it sits on top of the row's own rounded edge. */
    .row td:last-child {
      padding-right: 14px;
    }
    .thPlayer {
      min-width: 92px;
    }
    .thRound {
      width: 34px;
    }
    .thNum {
      width: 44px;
    }
    .nickname {
      max-width: 74px;
    }
    .thPing,
    .ping {
      min-width: 50px;
    }
    .ping {
      padding: 4px 6px;
      font-size: 11px;
    }
    /* Rounds won is the one column that can go: it is derivable from the round
       columns beside it, and it is shown in full on the round summary and the
       final scoreboard. The ping is not derivable from anything, and pushing it
       off the right edge of a phone would defeat the whole panel. */
    .colWins {
      display: none;
    }
  }

  /* Below ~400px (iPhone SE class) even the trimmed table pushes the ping off the
     right edge. The "you" badge is what goes: the row is already the only gold
     one on screen, and it carries your own nickname. */
  @media (max-width: 400px) {
    .you {
      display: none;
    }
    .thPlayer {
      min-width: 76px;
    }
    .nickname {
      max-width: 66px;
    }
    .row td {
      padding: 7px 4px;
    }
  }
</style>
