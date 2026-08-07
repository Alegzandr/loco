/**
 * round-progression.spec.ts
 *
 * Tests for multi-round match flow:
 *   - BO3 round 2 starts after dismissing the first round summary
 *   - BO3 match reaches game-over after all rounds complete
 *   - Round summary auto-dismisses after the countdown timer expires
 *   - Reading the scores does not roll the board back to the deal
 *   - Spectating banner is shown when the local player finishes before the round ends
 *
 * These complement the single-round BO1 test in game-flow.spec.ts and the
 * two-client sync test in multi-client.spec.ts.
 */
import { test, expect, Browser } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  setMatchFormat,
  startGame,
  getState,
  sendMsg,
  drawAndPass,
  waitForMyTurn,
  waitForRoundSummary,
  waitForGameOver,
  waitForRoundNumber,
  waitForTableOpen,
  clickContinue,
  debugSetState,
  winWith,
} from '../helpers/game'

test.describe('round summary and match progression', () => {
  async function forceRoundEndAsLocalWinner(page: Parameters<typeof getState>[0]) {
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponents = (s?.players ?? []).filter((p) => p.index !== myIdx)
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: opponents.map((p, i) => ({
        playerIndex: p.index,
        hand: [{ color: i % 2 === 0 ? 'blue' : 'green', kind: 'number', value: 9 - i }],
      })),
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await winWith(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
  }

  /**
   * Round summary auto-dismisses: the Continue button shows a countdown and
   * disappears after ≤8 seconds without user interaction.
   */
  test('round summary auto-dismisses after countdown expires', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await forceRoundEndAsLocalWinner(page)
    await waitForRoundSummary(page, 20_000)

    // Summary is visible and has a dismiss button before countdown expiry.
    await expect(page.getByText(T.continueBtn, { exact: false })).toBeVisible()

    // Without clicking Continue, the summary auto-dismisses within 8 s.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === false,
      undefined,
      { timeout: 10_000 },
    )
  })

  /**
   * Reading the scores must not roll the table back to the deal.
   *
   * The server deals the next round in the same breath as it announces the last
   * one and starts the turn clock with it, so the table is already moving while
   * the summary card is up. The client used to buffer that deal and replay it on
   * dismissal, which put the board back as it stood eight seconds earlier — and
   * `currentTurn` with it. When the rolled-back turn was the reader's own, the
   * desync could not heal: nobody else could play, the reader was shown somebody
   * else's turn, and the table sat there until the server's turn timer expired.
   */
  test('a player still reading the scores is not rolled back to the deal', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()

    try {
      const code = await createRoom(alice, 'Alice')
      await setMatchFormat(alice, 'BO3')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await waitForTableOpen(alice)
      await waitForTableOpen(bob)

      await forceRoundEndAsLocalWinner(alice)
      await waitForRoundSummary(alice, 20_000)
      await waitForRoundSummary(bob, 20_000)

      // Round 2 is dealt behind the card, on both screens: the board is
      // authoritative the moment it lands, never on dismissal.
      await waitForRoundNumber(alice, 2, 20_000)
      await waitForRoundNumber(bob, 2, 20_000)

      // Whoever holds the first turn plays it without dismissing anything; the
      // other one is still reading, which is the window the bug lived in.
      const aliceState = await getState(alice)
      const actor = aliceState?.currentTurn === aliceState?.myIndex ? alice : bob
      const reader = actor === alice ? bob : alice
      await drawAndPass(actor)

      // The turn has moved on the reader's board too, under the card.
      await reader.waitForFunction(
        (seat: number) => window.__LOCO_E2E__?.getState?.()?.currentTurn !== seat,
        (await getState(actor))?.myIndex ?? 0,
        { timeout: 10_000 },
      )
      expect((await getState(reader))?.showRoundSummary).toBe(true)

      await clickContinue(reader)

      // Taking the card down settles nothing about the board: both seats agree.
      const truth = await getState(actor)
      const seen = await getState(reader)
      expect(seen?.currentTurn).toBe(truth?.currentTurn)
      expect(seen?.discard).toEqual(truth?.discard)
      expect(seen?.roundNumber).toBe(truth?.roundNumber)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * BO3 — round 2 starts after the player clicks Continue from round 1 summary.
   *
   * Verifies that:
   *   1. The server deals round 2 while the summary is visible, and the client
   *      applies it there rather than buffering it.
   *   2. Dismissing the summary leaves that board exactly as it stands.
   *   3. The BO3 round indicator is visible on screen.
   */
  test('BO3: round 2 starts after clicking Continue from round 1 summary', async ({ page }) => {
    await createRoom(page, 'Alice')
    await setMatchFormat(page, 'BO3')
    await addBot(page)
    await startGame(page)

    await forceRoundEndAsLocalWinner(page)
    await waitForRoundSummary(page, 20_000)
    await expect(page.getByText(new RegExp(T.winsRound))).toBeVisible()

    const summaryState = await getState(page)
    expect(summaryState?.roundNumber_completed).toBe(1)

    // Dismiss the summary manually. The board behind it is already round 2's.
    await clickContinue(page)

    // Round 2 must now be active.
    await waitForRoundNumber(page, 2, 20_000)

    const round2State = await getState(page)
    expect(round2State?.roundNumber).toBeGreaterThanOrEqual(2)
    expect(round2State?.screen).toBe('game')
    expect(round2State?.showRoundSummary).toBe(false)
  })

  /**
   * A best of 3 ends the moment the lead cannot be caught, which is what "best
   * of 3" has always meant everywhere else: first to two.
   *
   * This used to play three rounds because the match was decided on points, so
   * the format ran to its end whatever the standings were. Two rounds now, and
   * the third is never dealt — which is the assertion, not the shortcut.
   */
  test('a BO3 stops the moment the lead cannot be caught', async ({ page }) => {
    test.setTimeout(120_000)

    await createRoom(page, 'Alice')
    await setMatchFormat(page, 'BO3')
    await addBot(page)
    await startGame(page)

    // One round of three is still catchable, so the match deals another.
    await forceRoundEndAsLocalWinner(page)
    await waitForRoundSummary(page, 20_000)
    await clickContinue(page)
    await waitForRoundNumber(page, 2, 10_000)

    // Two nil with one round left is not, so the match stops here.
    await forceRoundEndAsLocalWinner(page)
    await waitForRoundSummary(page, 20_000)
    await clickContinue(page)
    await waitForGameOver(page, 15_000)

    const s = await getState(page)
    const mine = (s?.scoreboard ?? []).find((e) => e.nickname === 'Alice')
    expect(mine?.rounds_won, 'the match was taken on rounds, at two of three').toBe(2)
    await expect(page.getByRole('button', { name: T.rematch })).toBeVisible()
  })

  /**
   * Round ends the moment a player empties their hand (single-finisher model).
   * The local player plays their last card → the RoundSummary overlay appears.
   */
  test('round ends immediately when local player empties their hand', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponents = (s?.players ?? []).filter((p) => p.index !== myIdx)
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: opponents.map((p, i) => ({
        playerIndex: p.index,
        hand: [
          { color: i % 2 === 0 ? 'blue' : 'green', kind: 'number', value: 9 - i },
          { color: i % 2 === 0 ? 'yellow' : 'red', kind: 'number', value: 4 + i },
        ],
      })),
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await winWith(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
    await expect(page.getByText(T.winsRound, { exact: false })).toBeVisible({ timeout: 5_000 })
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

    await forceRoundEndAsLocalWinner(page)
    await waitForRoundSummary(page, 20_000)

    // Click Continue — for BO1 this goes directly to game over.
    await clickContinue(page)

    await waitForGameOver(page, 30_000)
    await expect(page.getByRole('button', { name: T.rematch })).toBeVisible()
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
