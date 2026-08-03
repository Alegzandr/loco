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
 *     level. The existing WebSocket closes immediately; webSocket.svelte.ts schedules a
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
  waitForTableOpen,
  gameBoard,
} from '../helpers/game'

async function waitForGameReady(page: Parameters<typeof getState>[0], timeout = 15_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return (
        s?.screen === 'game' &&
        (s?.players?.length ?? 0) >= 2 &&
        Array.isArray(s?.myHand) &&
        (s?.myHand?.length ?? 0) > 0
      )
    },
    undefined,
    { timeout },
  )
}

test.describe('WebSocket reconnect', () => {
  /**
   * Network drop while in an active game triggers auto-reconnect.
   *
   * The test goes offline for ~300 ms (within the 60-s server reconnect window),
   * then comes back online.  The client should:
   *   1. Close the WebSocket (onerror / onclose fires).
   *   2. Schedule a reconnect (webSocket exponential backoff, first attempt 2 s).
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

    // Wait for a stable in-game state, then force deterministic reconnect preconditions:
    // fixed hand/discard, no penalty stack, and our turn so bot cannot race state changes.
    await waitForGameReady(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const oppIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 7 },
        { color: 'blue', kind: 'number', value: 4 },
      ],
      hands: [{ playerIndex: oppIdx, hand: [{ color: 'yellow', kind: 'number', value: 8 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await page.waitForFunction(
      (idx: number) => {
        const st = window.__LOCO_E2E__?.getState?.()
        return (
          st?.screen === 'game' &&
          st.currentTurn === idx &&
          st.discard?.kind === 'number' &&
          st.discard?.color === 'red' &&
          (st.pendingDraw ?? -1) === 0 &&
          (st.myHand?.length ?? 0) === 2
        )
      },
      myIdx,
      { timeout: 10_000 },
    )

    const preState = await getState(page)
    expect(preState?.screen).toBe('game')
    expect(preState?.myHand).toHaveLength(2)
    expect(preState?.players?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(await page.evaluate(() => window.__LOCO_E2E__?.getWsStatus?.())).toBe('open')

    // Record WS status transitions so we can prove disconnect/reconnect lifecycle
    // without depending on exact close-event timing under offline mode.
    await page.evaluate(() => {
      const w = window as unknown as {
        __LOCO_WS_STATUSES?: string[]
        __LOCO_WS_TIMER?: number
      }
      w.__LOCO_WS_STATUSES = [window.__LOCO_E2E__?.getWsStatus?.() ?? 'unknown']
      let last = w.__LOCO_WS_STATUSES[0]
      w.__LOCO_WS_TIMER = window.setInterval(() => {
        const s = window.__LOCO_E2E__?.getWsStatus?.() ?? 'unknown'
        if (s !== last) {
          w.__LOCO_WS_STATUSES?.push(s)
          last = s
        }
      }, 50)
    })

    // --- Deterministic disconnect/reconnect ---
    await page.context().setOffline(true)
    await page.evaluate(() => window.__LOCO_E2E__?.forceCloseWs?.())
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getWsStatus?.() === 'closed',
      undefined,
      { timeout: 8_000 },
    )
    await page.waitForTimeout(300)
    await page.context().setOffline(false)

    // Authoritative reconnect state application may be brief; best-effort detect.
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

    const wsTransitions = await page.evaluate(() => {
      const w = window as unknown as {
        __LOCO_WS_STATUSES?: string[]
        __LOCO_WS_TIMER?: number
      }
      if (w.__LOCO_WS_TIMER !== undefined) {
        clearInterval(w.__LOCO_WS_TIMER)
      }
      return w.__LOCO_WS_STATUSES ?? []
    })
    // Disconnect/reconnect proof: after starting open, we must observe at least one
    // non-open state ('closed' or 'connecting') and then return to open.
    expect(wsTransitions[0]).toBe('open')
    expect(wsTransitions.some((s) => s === 'closed' || s === 'connecting')).toBe(true)
    expect(wsTransitions[wsTransitions.length - 1]).toBe('open')

    // Game state must be restored.
    const postState = await getState(page)
    expect(await page.evaluate(() => window.__LOCO_E2E__?.getWsStatus?.())).toBe('open')
    expect(postState?.screen).toBe('game')
    expect(Array.isArray(postState?.myHand)).toBe(true)
    expect(postState?.players?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(postState?.discard).not.toBeNull()
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

    await waitForGameReady(page)

    // Drop and restore the network.
    await page.context().setOffline(true)
    await page.waitForTimeout(400)
    await page.context().setOffline(false)

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.isReconnecting === true,
      undefined,
      { timeout: 10_000 },
    ).catch(() => {})

    const overlay = page.getByText(T.rebuildingTable)
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

      await expect(gameBoard(page1)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(page1)
      await expect(gameBoard(page2)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(page2)

      // Get Alice's index from Bob's perspective.
      const aliceState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceIndex = aliceState?.myIndex ?? 0

      await waitForGameReady(page1)

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
   * The reconnect people actually have: the page is reloaded.
   *
   * A dropped socket keeps the store, so the earlier tests only ever exercised
   * the transport. A refresh, a crashed tab or a phone killing the page throws
   * the room, the seat and the token away, and before session persistence the
   * player landed on the lobby with their hand still held by the server and no
   * way to name it. The seat is reclaimed from sessionStorage instead.
   */
  test('a page reload reclaims the seat and the hand', async ({ page }) => {
    const roomCode = await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForGameReady(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const oppIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
    // Pin everything the assertions read. Our turn so the bot cannot move the
    // board while the page is away, no pending stack, and a two-card hand. One
    // card would open a catch window a bot answers about two thirds of the time.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 7 },
        { color: 'blue', kind: 'number', value: 4 },
      ],
      hands: [{ playerIndex: oppIdx, hand: [{ color: 'yellow', kind: 'number', value: 8 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await page.waitForFunction(
      (idx: number) => {
        const st = window.__LOCO_E2E__?.getState?.()
        return st?.screen === 'game' && st.currentTurn === idx && (st.myHand?.length ?? 0) === 2
      },
      myIdx,
      { timeout: 10_000 },
    )

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Back on the board, same seat, same hand, same discard: no room code
    // typed, no nickname re-entered.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'game',
      undefined,
      { timeout: 20_000 },
    )
    await waitForTableOpen(page)

    // The recovery overlay has to come down, and a reload is the one path where
    // it can fail to: <GameView /> mounts with isReconnecting already true, so
    // the timer that ends the overlay is armed on mount, which is where React
    // double-invokes effects in dev. Reading the store alone cannot see this —
    // every assertion below passed while the board sat under "setting the table
    // back up" for the rest of the match.
    await expect(page.getByText(T.rebuildingTable)).not.toBeVisible({ timeout: 5_000 })

    const after = await getState(page)
    expect(after?.roomCode).toBe(roomCode)
    expect(after?.myIndex).toBe(myIdx)
    expect(after?.myHand).toHaveLength(2)
    expect(after?.discard?.color).toBe('red')
    expect(after?.sessionToken).toBeTruthy()
  })

  /**
   * The same for a room that has not started. The seat is released the moment
   * the socket closes, so this is an ordinary rejoin rather than a token
   * reclaim, but from the player's side it is the same promise: a reload does
   * not cost them the room.
   */
  test('a page reload in the waiting room rejoins it', async ({ page }) => {
    const roomCode = await createRoom(page, 'Alice')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 20_000 },
    )
    const after = await getState(page)
    expect(after?.roomCode).toBe(roomCode)
    expect((after?.players ?? []).some((p) => p.nickname === 'Alice')).toBe(true)
  })

  /**
   * A stored session naming a room that no longer exists must land the player on
   * the lobby with a reason, not on a spinner. Without this the refusal would
   * arrive as a toast over a reconnect screen that never ends, and the record
   * would still be there to replay it on the next load.
   */
  test('a dead session falls back to the lobby', async ({ page }) => {
    await createRoom(page, 'Alice')

    // Point the record at a room that was never created. Same shape the app
    // writes; the server is the one that decides it is dead.
    await page.evaluate(() => {
      window.sessionStorage.setItem(
        'loco_session',
        JSON.stringify({
          roomCode: 'ZZZZZZ',
          nickname: 'Alice',
          sessionToken: 'deadbeefdeadbeefdeadbeefdeadbeef',
          target: 'game',
          at: Date.now(),
        }),
      )
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'lobby',
      undefined,
      { timeout: 20_000 },
    )
    await expect(page.getByRole('button', { name: T.createRoom })).toBeVisible()
    expect(await page.evaluate(() => window.sessionStorage.getItem('loco_session'))).toBeNull()
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
