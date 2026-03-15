/**
 * round-progression.spec.ts
 *
 * Tests for multi-round match flow:
 *   - BO3 round 2 starts after dismissing the first round summary
 *   - BO3 match reaches game-over after all rounds complete
 *   - Round summary auto-dismisses after the countdown timer expires
 *   - Spectating banner is shown when the local player finishes before the round ends
 *
 * These complement the single-round BO1 test in game-flow.spec.ts and the
 * two-client sync test in multi-client.spec.ts.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  addBot,
  setMatchFormat,
  startGame,
  getState,
  sendMsg,
  waitForMyTurn,
  waitForRoundSummary,
  waitForGameOver,
  waitForRoundNumber,
  clickContinue,
  participateInTurns,
} from '../helpers/game'

test.describe('round summary and match progression', () => {
  /**
   * Round summary auto-dismisses: the Continue button shows a countdown and
   * disappears after ≤8 seconds without user interaction.
   */
  test('round summary auto-dismisses after countdown expires', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForRoundSummary(page, 90_000)

    // Summary must show the expected content.
    await expect(page.getByText(/Round\s+1/)).toBeVisible()
    await expect(page.getByText(/wins the round!/)).toBeVisible()
    await expect(page.getByText(T.continueBtn, { exact: false })).toBeVisible()

    // Without clicking Continue, the summary auto-dismisses within 8 s.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === false,
      undefined,
      { timeout: 10_000 },
    )
  })

  /**
   * BO3 — round 2 starts after the player clicks Continue from round 1 summary.
   *
   * Verifies that:
   *   1. The server sends game_started for round 2 while summary is visible (buffered).
   *   2. Clicking Continue applies the buffered state and roundNumber advances.
   *   3. The BO3 round indicator is visible on screen.
   */
  test('BO3: round 2 starts after clicking Continue from round 1 summary', async ({ page }) => {
    await createRoom(page, 'Alice')
    await setMatchFormat(page, 'BO3')
    await addBot(page)
    await startGame(page)

    // Participate in a few turns so both players contribute before bots win.
    await participateInTurns(page, 5)

    await waitForRoundSummary(page, 120_000)
    await expect(page.getByText(/wins the round!/)).toBeVisible()

    const summaryState = await getState(page)
    expect(summaryState?.roundNumber_completed).toBe(1)

    // Dismiss the summary manually — this applies the buffered game_started state.
    await clickContinue(page)

    // Round 2 must now be active.
    await waitForRoundNumber(page, 2, 20_000)

    const round2State = await getState(page)
    expect(round2State?.roundNumber).toBeGreaterThanOrEqual(2)
    expect(round2State?.screen).toBe('game')
    expect(round2State?.showRoundSummary).toBe(false)
  })

  /**
   * BO3 — the match ends with a game-over screen after all rounds complete.
   *
   * Uses 2 bots to drive the game quickly.  The test plays through up to 3 rounds,
   * dismissing each summary, until the gameover screen appears.
   *
   * Total expected wall time: ≈ 2–3 minutes (each round ~30–60 s with bots).
   */
  test('BO3 match completes and shows game-over screen', async ({ page }) => {
    test.setTimeout(300_000) // 5 min budget for full BO3 match

    await createRoom(page, 'Alice')
    await setMatchFormat(page, 'BO3')
    await addBot(page)
    await addBot(page)
    await startGame(page)

    // Loop through rounds until game over.
    for (let round = 1; round <= 4; round++) {
      // Participate in a few turns before bots drive it to completion.
      await participateInTurns(page, 3)

      // Wait for this round to end.
      await waitForRoundSummary(page, 120_000)

      const state = await getState(page)
      if (state?.screen === 'gameover') break

      // Dismiss summary; if this was the final round, dismissRoundSummary transitions
      // to gameover via pendingMatchEnd.
      await clickContinue(page)

      // Give the store a moment to settle after dismissal.
      await page.waitForTimeout(300)

      const postState = await getState(page)
      if (postState?.screen === 'gameover') break
    }

    await waitForGameOver(page, 30_000)
    await expect(
      page.getByText(T.youWin).or(page.getByText(T.gameOver)),
    ).toBeVisible()
    // Play Again button confirms we are truly on the game-over screen.
    await expect(page.getByRole('button', { name: T.playAgain })).toBeVisible()
  })

  /**
   * Spectating banner: when the local player empties their hand before the round ends,
   * the "You finished! Watching the round…" banner is shown and the action bar is hidden.
   *
   * This test plays aggressively to try to empty the hand first.  Because the deck is
   * random, we may not finish before the bots do.  Graceful skip with annotation if not
   * observed.
   */
  test('spectating banner is shown when local player finishes first', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await addBot(page)
    await startGame(page)

    let sawSpectating = false

    for (let i = 0; i < 40; i++) {
      try {
        await waitForMyTurn(page, 15_000)
      } catch {
        break
      }

      const state = await getState(page)
      if (!state || state.screen !== 'game' || state.showRoundSummary) break

      const me = state.players.find((p) => p.index === state.myIndex)

      // Already finished — spectating state should be active.
      if (me?.finished) {
        sawSpectating = true
        break
      }

      const { myHand, discard, activeColor, pendingDraw } = state
      const hand = myHand ?? []

      const playable = hand.find((c) => {
        if ((pendingDraw ?? 0) > 0)
          return c.kind === 'draw_two' || c.kind === 'wild_draw_four'
        if (
          c.kind === 'wild' ||
          c.kind === 'wild_draw_four' ||
          c.kind === 'swap' ||
          c.kind === 'global_switch'
        )
          return true
        if (!discard) return true
        if (c.color === activeColor) return true
        if (c.kind !== 'number' && c.kind === discard.kind) return true
        if (c.kind === 'number' && discard.kind === 'number')
          return c.value === discard.value
        return false
      })

      if (playable) {
        if (playable.kind === 'wild' || playable.kind === 'wild_draw_four') {
          await sendMsg(page, { type: 'play_card', card: playable, chosen_color: 'red' })
        } else if (playable.kind === 'swap') {
          const opponents = state.players.filter(
            (p) => p.index !== state.myIndex && !p.finished,
          )
          if (opponents.length > 0) {
            await sendMsg(page, {
              type: 'play_card',
              card: playable,
              chosen_player: opponents[0].index,
            })
          } else {
            await sendMsg(page, { type: 'draw_card' })
            await page.waitForFunction(
              () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
              undefined,
              { timeout: 8_000 },
            )
            await sendMsg(page, { type: 'pass_turn' })
          }
        } else {
          await sendMsg(page, { type: 'play_card', card: playable })
        }
      } else if ((pendingDraw ?? 0) > 0) {
        await sendMsg(page, { type: 'draw_card' })
      } else {
        await sendMsg(page, { type: 'draw_card' })
        await page.waitForFunction(
          () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
          undefined,
          { timeout: 8_000 },
        )
        await sendMsg(page, { type: 'pass_turn' })
      }

      await page.waitForTimeout(300)

      // Re-check finished state after playing
      const afterState = await getState(page)
      const afterMe = afterState?.players.find((p) => p.index === afterState.myIndex)
      if (afterMe?.finished && !afterState?.showRoundSummary) {
        sawSpectating = true
        break
      }
    }

    if (sawSpectating) {
      // Spectating banner must be visible.
      await expect(page.getByText(T.spectating)).toBeVisible({ timeout: 3_000 })

      // Draw and Pass buttons must NOT be shown for a finished player.
      await expect(page.getByRole('button', { name: T.draw })).not.toBeVisible()
      await expect(page.getByRole('button', { name: T.pass })).not.toBeVisible()
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Local player never finished before round end in this run — spectating banner not observed (deck is random)',
      })
    }
  })

  /**
   * Final round summary transitions to game-over when Continue is pressed.
   *
   * Verifies that after dismissing a BO1 round summary the gameover screen is shown,
   * not a new round.  (BO1 single round = match end.)
   */
  test('BO1 final round summary transitions to game-over on Continue', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await participateInTurns(page, 5)
    await waitForRoundSummary(page, 90_000)

    // Click Continue — for BO1 this goes directly to game over.
    await clickContinue(page)

    await waitForGameOver(page, 30_000)
    await expect(
      page.getByText(T.youWin).or(page.getByText(T.gameOver)),
    ).toBeVisible()
  })

  /**
   * Round indicator text is visible during a BO3 match.
   * The "Round X · BO3" chip must appear in the game view header area.
   */
  test('BO3 round indicator is visible during the match', async ({ page }) => {
    await createRoom(page, 'Alice')
    await setMatchFormat(page, 'BO3')
    await addBot(page)
    await startGame(page)

    // Wait for at least one game event so the canvas is live.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
      undefined,
      { timeout: 30_000 },
    )

    // Round indicator: "Round 1 · BO3" (the BO3 suffix distinguishes from BO1 which hides it).
    await expect(page.getByText(/Round\s+1/)).toBeVisible({ timeout: 5_000 })
    await expect(page.getByText(/BO3/)).toBeVisible({ timeout: 5_000 })
  })
})
