/**
 * multi-client.spec.ts
 *
 * Two independent browser contexts join the same game and verify that
 * actions performed by one player are reflected correctly on the other client:
 *   - room join visible to both
 *   - game start visible to both
 *   - turn progression is synchronized (when p1 acts, p2 sees turn change)
 *   - hand-count updates propagate correctly
 */
import { test, expect, Browser, Page } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  startGame,
  getState,
  sendMsg,
  waitForRoundSummary,
  debugSetState,
} from '../helpers/game'

/** Wait until the turn is NOT the local player's. */
async function waitForOthersTurn(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s !== undefined && s.currentTurn !== s.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

test.describe('multi-client synchronization', () => {
  /**
   * Two players join the same room and both appear in each other's player lists.
   */
  test('two players see each other in the waiting room', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)

      // page1 should see Bob
      await expect(page1.getByText('Bob')).toBeVisible({ timeout: 5_000 })
      // page2 should see Alice
      await expect(page2.getByText('Alice')).toBeVisible({ timeout: 5_000 })
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * Both players see the game start (canvas + action bar) when host starts.
   */
  test('game start is visible to both clients', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)

      // Two real players — no bot needed to start
      await page1.getByRole('button', { name: T.startGame }).click()

      await expect(page1.locator('canvas')).toBeVisible({ timeout: 10_000 })
      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      await expect(page1.locator('[class*="actionBar"]')).toBeVisible()
      await expect(page2.locator('[class*="actionBar"]')).toBeVisible()
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * Turn synchronization: when Alice draws and passes, the turn moves to Bob or the bot,
   * and eventually Bob gets his own turn.
   *
   * A bot is added so the game progresses without both real players needing to act.
   */
  test('turn progression is synchronized between clients', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await startGame(page1)

      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      // Record Alice's player index
      const aliceState = await getState(page1)
      const aliceIndex = aliceState?.myIndex ?? 0

      // Force a deterministic Alice turn and action.
      const bobIndex = (await getState(page2))?.myIndex ?? 1
      await debugSetState(page1, {
        hand: [
          { color: 'red', kind: 'number', value: 6 },
          { color: 'blue', kind: 'number', value: 1 },
        ],
        hands: [{ playerIndex: bobIndex, hand: [{ color: 'blue', kind: 'number', value: 9 }, { color: 'green', kind: 'number', value: 2 }] }],
        discard: { color: 'red', kind: 'number', value: 5 },
        currentTurn: aliceIndex,
      })
      await sendMsg(page1, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 6 },
      })

      // After Alice's turn, the turn must be Bob's on both clients.
      await page1.waitForFunction(
        (idx: number) => window.__LOCO_E2E__?.getState?.()?.currentTurn === idx,
        bobIndex,
        { timeout: 10_000 },
      )

      // Bob sees the same authoritative turn.
      await page2.waitForFunction(
        (idx: number) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return s !== undefined && s.currentTurn === idx
        },
        bobIndex,
        { timeout: 10_000 },
      )

      // Give Bob a deterministic turn and action too.
      await debugSetState(page2, {
        hand: [
          { color: 'blue', kind: 'number', value: 8 },
          { color: 'yellow', kind: 'number', value: 4 },
        ],
        discard: { color: 'blue', kind: 'number', value: 2 },
        currentTurn: bobIndex,
      })
      await sendMsg(page2, {
        type: 'play_card',
        card: { color: 'blue', kind: 'number', value: 8 },
      })
      await waitForOthersTurn(page2, 10_000)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * Hand count update is reflected on the other client.
   * When Alice draws a card, Bob's store should show Alice's hand_size increased.
   */
  test('hand count update is reflected on the other client', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await startGame(page1)

      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      // Get Alice's player index.
      const aliceState = await getState(page1)
      const aliceIndex = aliceState?.myIndex ?? 0

      await debugSetState(page1, {
        hand: [{ color: 'red', kind: 'number', value: 1 }, { color: 'blue', kind: 'number', value: 3 }],
        discard: { color: 'red', kind: 'number', value: 5 },
        currentTurn: aliceIndex,
      })
      const bobAfterDebug = await getState(page2)
      const aliceAfterDebug = bobAfterDebug?.players.find((p) => p.index === aliceIndex)
      const handSizeBefore = aliceAfterDebug?.hand_size ?? 2

      await sendMsg(page1, { type: 'draw_card' })

      // Bob's view of Alice's hand size should increase by 1
      await page2.waitForFunction(
        ([idx, before]: [number, number]) => {
          const players = window.__LOCO_E2E__?.getState?.()?.players ?? []
          const alice = players.find((p) => p.index === idx)
          return (alice?.hand_size ?? 0) > before
        },
        [aliceIndex, handSizeBefore] as [number, number],
        { timeout: 10_000 },
      )

      const bobUpdated = await getState(page2)
      const aliceAfter = bobUpdated?.players.find((p) => p.index === aliceIndex)
      expect(aliceAfter?.hand_size).toBeGreaterThan(handSizeBefore)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * Round summary appears on both clients when a round ends.
   * A bot is added so the game reaches completion without both real players needing to win.
   */
  test('round summary appears on both clients', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await startGame(page1)

      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      const aliceState = await getState(page1)
      const aliceIndex = aliceState?.myIndex ?? 0
      const bobIndex = (await getState(page2))?.myIndex ?? 1
      await debugSetState(page1, {
        hand: [{ color: 'red', kind: 'number', value: 7 }],
        hands: [{ playerIndex: bobIndex, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
        discard: { color: 'red', kind: 'number', value: 5 },
        currentTurn: aliceIndex,
      })
      await sendMsg(page1, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
      })

      // Round summary should appear on both
      await waitForRoundSummary(page1, 20_000)
      await waitForRoundSummary(page2, 20_000)

      await expect(page1.getByText(/wins the round!/)).toBeVisible()
      await expect(page2.getByText(/wins the round!/)).toBeVisible()
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
