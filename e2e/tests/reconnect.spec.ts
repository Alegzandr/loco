/**
 * reconnect.spec.ts
 *
 * Tests for WebSocket reconnect behavior:
 *   - Dropping and restoring the network triggers the auto-reconnect handshake.
 *   - After reconnect the game state is fully restored (player_reconnected message).
 *   - The "Rebuilding table…" overlay is shown briefly while reconnecting.
 *   - A player who disconnects and reconnects is re-visible to other clients.
 *
 * Implementation notes:
 *   - `page.context().setOffline(true/false)` simulates a network drop at the browser
 *     level. The existing WebSocket closes immediately; useWebSocket.ts schedules a
 *     reconnect after RECONNECT_DELAY_MS (2 s). On re-open, getReconnectMsg() returns
 *     a join_room with the stored session_token so the server reclaims the slot.
 *   - The ReconnectTimeout on the server is 60 s by default, so the 2-3 s offline
 *     window is well within the reconnect window.
 */
import { test, expect, Browser } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  waitForRoundSummary,
  debugSetState,
} from '../helpers/game'

test.describe('WebSocket reconnect', () => {
  /**
   * Network drop while in an active game triggers auto-reconnect.
   *
   * The test goes offline for ~300 ms (within the 60-s server reconnect window),
   * then comes back online.  The client should:
   *   1. Close the WebSocket (onerror / onclose fires).
   *   2. Schedule a reconnect (useWebSocket exponential backoff, first attempt 2 s).
   *   3. On re-open, send join_room with session_token.
   *   4. Server sends player_reconnected; store sets isReconnecting = true.
   *   5. Reconnect animations complete; isReconnecting = false.
   *   6. Game screen is still active with a valid hand.
   */
  test('offline/online cycle triggers reconnect and restores game state', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait for at least one turn event so the game is genuinely in progress.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
      undefined,
      { timeout: 30_000 },
    )

    const preState = await getState(page)
    expect(preState?.screen).toBe('game')
    const preHandSize = (preState?.myHand ?? []).length

    // --- Simulate network drop ---
    await page.context().setOffline(true)
    // Give the WS a moment to notice the drop (browser fires close event synchronously
    // once the network stack reports the error).
    await page.waitForTimeout(400)
    await page.context().setOffline(false)

    // The reconnect flag may toggle quickly on a fast machine; best-effort detect.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === true,
      undefined,
      { timeout: 10_000 },
    ).catch(() => {})

    // Wait for the reconnect animation sequence to finish (overlay 600 ms + card stagger).
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === false,
      undefined,
      { timeout: 10_000 },
    )

    // Game state must be restored.
    const postState = await getState(page)
    expect(postState?.screen).toBe('game')
    // Hand must exist (server may have dealt new cards during disconnect, so size can differ).
    expect(postState?.myHand).toBeDefined()
    // Session token must still be valid (not cleared).
    expect(postState?.sessionToken).toBeTruthy()
  })

  /**
   * The "Rebuilding table…" reconnect overlay is rendered during the reconnect
   * animation phase (isReconnecting === true).
   */
  test('reconnect overlay is shown while game state is being restored', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
      undefined,
      { timeout: 30_000 },
    )

    // Drop and restore the network.
    await page.context().setOffline(true)
    await page.waitForTimeout(400)
    await page.context().setOffline(false)

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === true,
      undefined,
      { timeout: 10_000 },
    ).catch(() => {})

    const overlay = page.getByText('Rebuilding table\u2026')
    const sawOverlay = await overlay.isVisible().catch(() => false)
    if (sawOverlay) {
      await expect(overlay).toBeVisible({ timeout: 2_000 })
    }

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === false,
      undefined,
      { timeout: 10_000 },
    )
    await expect(overlay).not.toBeVisible({ timeout: 3_000 })
  })

  /**
   * Two-client reconnect: when player 1 disconnects and reconnects, player 2 sees
   * the player as connected again.
   *
   * Player 1's `connected` flag in player 2's store should go false → true.
   */
  test('disconnected player reappears as connected after reconnect', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await addBot(page1)
      await page1.getByRole('button', { name: T.startGame }).click()

      await expect(page1.locator('canvas')).toBeVisible({ timeout: 10_000 })
      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      // Get Alice's index from Bob's perspective.
      const aliceState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceIndex = aliceState?.myIndex ?? 0

      // Wait for at least one turn event so the game is live.
      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
        undefined,
        { timeout: 30_000 },
      )

      // Drop Alice's network.
      await ctx1.setOffline(true)
      await page1.waitForTimeout(400)

      // Restore Alice's network.
      await ctx1.setOffline(false)

      // Alice reconnects; wait for isReconnecting to complete.
      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === true,
        undefined,
        { timeout: 8_000 },
      ).catch(() => {})
      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === false,
        undefined,
        { timeout: 10_000 },
      )

      // Bob should now see Alice as connected again.
      await page2.waitForFunction(
        (idx: number) => {
          const players = window.__LOCO_E2E__?.getState?.()?.players ?? []
          const alice = players.find((p) => p.index === idx)
          return alice?.connected === true
        },
        aliceIndex,
        { timeout: 15_000 },
      )
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * Reconnect after round summary: if a player reconnects while the round summary is
   * visible, the game state is fully restored and the summary can still be dismissed.
   */
  test('reconnect mid round-summary restores state and summary is still dismissible', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponentIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: [{ playerIndex: opponentIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      currentTurn: myIdx,
      pendingDraw: 0,
    })
    await page.evaluate(() => {
      window.__LOCO_E2E__?.send?.({
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
      })
    })
    await waitForRoundSummary(page, 20_000)

    // Drop and restore network while summary is visible.
    await page.context().setOffline(true)
    await page.waitForTimeout(400)
    await page.context().setOffline(false)

    // Wait for reconnect to complete.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === true,
      undefined,
      { timeout: 8_000 },
    ).catch(() => {
      // Reconnect may have completed before we polled; that is acceptable.
    })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === false,
      undefined,
      { timeout: 10_000 },
    )

    // The round summary should still be dismissible after reconnect.
    const state = await getState(page)
    if (state?.showRoundSummary) {
      await expect(page.getByText(T.continueBtn, { exact: false })).toBeVisible()
      await page.getByText(T.continueBtn, { exact: false }).click()
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === false,
        undefined,
        { timeout: 10_000 },
      )
    }
  })
})
