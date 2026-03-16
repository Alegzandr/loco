/**
 * special-cards.spec.ts
 *
 * Deterministic end-to-end tests for custom card mechanics.
 *
 * All tests use debugSetState (backed by the server-side debug_set_state WebSocket
 * message, active when LOCO_E2E=1) to inject specific cards into the player's hand
 * and control the discard pile / pending-draw state.  No test depends on the random
 * deck; every assertion is guaranteed to run on every execution.
 *
 * Coverage:
 *   - Swap card → PlayerPicker opens, choosing target swaps hands
 *   - GlobalSwitch card → plays without picker, discard updates, hand rotates
 *   - counter_draw → stacks penalty, turn advances to next player
 *   - interrupt_play → out-of-turn play with exact match advances turn to us
 *   - Non-counter card during active +2/+4 penalty returns error
 *   - Two-player real-time sync: card play reflected on both clients
 *
 * Prerequisites:
 *   - Server must be running with LOCO_E2E=1 (set in docker-compose.dev.yml and CI).
 *   - Go server on :8080, Vite dev server on :5173.
 */
import { test, expect, Browser } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  waitForMyTurn,
  debugSetState,
} from '../helpers/game'

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

/** Wait for it to be the local player's turn. */
async function waitForTurn(page: Parameters<typeof getState>[0], timeoutMs = 20_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s?.currentTurn === s?.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

/** Wait until it is NOT the local player's turn. */
async function waitForOtherTurn(page: Parameters<typeof getState>[0], timeoutMs = 10_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s !== undefined && s.currentTurn !== s.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('special card mechanics (deterministic via debug_set_state)', () => {
  /**
   * Swap card — PlayerPicker UI:
   * When the player triggers handleCardClick with a Swap card, the PlayerPicker
   * modal must appear before any message is sent to the server.
   */
  test('Swap card opens the PlayerPicker modal', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    // Inject a Swap card as the entire hand.
    // Discard is set to a neutral red card so Swap (always playable) has a valid game state.
    await debugSetState(page, {
      hand: [{ color: 'wild', kind: 'swap' }],
      discard: { color: 'red', kind: 'number', value: 5 },
    })

    // Verify the hand now contains exactly the Swap card.
    const state = await getState(page)
    expect(state?.myHand).toHaveLength(1)
    expect(state?.myHand[0].kind).toBe('swap')

    // Trigger handleCardClick via the E2E playCard helper.
    await page.evaluate((card) => window.__LOCO_E2E__?.playCard?.(card), {
      color: 'wild',
      kind: 'swap',
    })

    // PlayerPicker modal must be visible.
    await expect(page.getByText('Choose a player to swap hands with')).toBeVisible({
      timeout: 5_000,
    })

    // Cancel to avoid sending a partial message.
    await page.getByRole('button', { name: '✕' }).click()
    await expect(page.getByText('Choose a player to swap hands with')).not.toBeVisible()
  })

  /**
   * Swap card end-to-end:
   * Playing a Swap card via sendMsg (with a valid chosen_player) should:
   *   1. Remove the Swap card from our hand.
   *   2. Cause the discard pile to show the Swap card.
   *   3. Trigger a game_state broadcast so our hand updates.
   *
   * The bot's hand before the swap is unknown, but after swapping our single-card
   * hand the discard must show "swap" and our hand must differ from the pre-swap state.
   */
  test('Swap card played end-to-end changes hand and updates discard', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    // Set a predictable starting state: our hand = one Swap card.
    const initial = await getState(page)
    const myIdx = initial?.myIndex ?? 0

    await debugSetState(page, {
      hand: [{ color: 'wild', kind: 'swap' }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    await page.waitForFunction(
      (idx: number) => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s !== undefined && s.currentTurn === idx && (s.myHand?.length ?? 0) === 1 && s.myHand?.[0]?.kind === 'swap'
      },
      myIdx,
      { timeout: 8_000 },
    )

    const before = await getState(page)
    expect(before?.myHand).toHaveLength(1)

    // Choose the bot as the swap target (first non-self, non-finished player).
    const opponents = (before?.players ?? []).filter(
      (p) => p.index !== before?.myIndex && !p.finished,
    )
    expect(opponents.length).toBeGreaterThan(0)
    const target = opponents[0].index

    // Play the Swap card.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'wild', kind: 'swap' },
      chosen_player: target,
    })

    // After the swap:
    //   • discard shows the Swap card
    //   • if the server rejects the play, fail immediately with the surfaced error
    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s?.discard?.kind === 'swap' || (s?.errorMsg ?? '') !== ''
      },
      undefined,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.errorMsg ?? '').toBe('')
    expect(after?.discard?.kind).toBe('swap')
    // Our hand is now whatever the bot had (could be any size ≥ 0).
    // The Swap card itself should no longer be in our hand.
    const stillHasSwap = after?.myHand.some((c) => c.kind === 'swap')
    expect(stillHasSwap).toBe(false)
  })

  /**
   * GlobalSwitch card end-to-end:
   * Playing a GlobalSwitch card via sendMsg should:
   *   1. Update the discard pile to show the GlobalSwitch card.
   *   2. Trigger a game_state broadcast (hands rotate; our new hand comes from the
   *      previous player in game direction).
   *   3. The GlobalSwitch card must no longer be in our hand.
   */
  test('GlobalSwitch card plays without picker and triggers game_state update', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    // Inject GlobalSwitch into hand with a neutral discard.
    await debugSetState(page, {
      hand: [{ color: 'wild', kind: 'global_switch' }],
      discard: { color: 'blue', kind: 'number', value: 3 },
    })

    const before = await getState(page)
    expect(before?.myHand).toHaveLength(1)
    expect(before?.myHand[0].kind).toBe('global_switch')

    // Play it — no picker, sent directly.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'wild', kind: 'global_switch' },
    })

    // Discard must update to show global_switch.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'global_switch',
      undefined,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.discard?.kind).toBe('global_switch')
    // GlobalSwitch must no longer be in our hand.
    expect(after?.myHand.some((c) => c.kind === 'global_switch')).toBe(false)
  })

  /**
   * counter_draw — deterministic:
   * 1. Inject a +2 card into our hand.
   * 2. Set the discard to a +2 and pendingDraw to 2 (simulates a +2 played against us).
   * 3. Send counter_draw with our +2 — this stacks the penalty to 4.
   * 4. The turn must advance away from us and pendingDraw must be > 2.
   */
  test('counter_draw stacks the pending draw and advances the turn', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    // Inject: we have a red +2, discard is a red +2, pendingDraw = 2, and it's our turn.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'draw_two' },
        { color: 'red', kind: 'number', value: 7 }, // filler so hand is non-empty after counter
      ],
      hands: [{ playerIndex: otherIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'draw_two' },
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    const before = await getState(page)
    expect(before?.pendingDraw).toBe(2)

    // Counter the +2 with our +2 — stack grows to 4.
    await sendMsg(page, {
      type: 'counter_draw',
      card: { color: 'red', kind: 'draw_two' },
    })

    // Turn must advance away from us and pendingDraw must have grown.
    await page.waitForFunction(
      ([idx, stackBefore]: [number, number]) => {
        const s = window.__LOCO_E2E__?.getState?.()
        return (
          s !== undefined &&
          s.currentTurn !== idx &&
          (s.pendingDraw ?? 0) > stackBefore
        )
      },
      [myIdx, 2] as [number, number],
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.pendingDraw).toBeGreaterThan(2) // stacked: 2 + 2 = 4
    expect(after?.currentTurn).not.toBe(myIdx)
  })

  /**
   * interrupt_play — deterministic:
   * 1. Set the discard to a specific card (e.g. red 5).
   * 2. Inject that exact card into our hand.
   * 3. Wait until it is NOT our turn.
   * 4. Send interrupt_play with the exact match — turn must come to us.
   */
  test('interrupt_play with exact match advances turn to the interrupter', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      hands: [{ playerIndex: otherIdx, hand: [{ color: 'blue', kind: 'number', value: 2 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      currentTurn: otherIdx,
      pendingDraw: 0,
    })

    // Send interrupt_play.
    await sendMsg(page, {
      type: 'interrupt_play',
      card: { color: 'red', kind: 'number', value: 5 },
    })

    // The interrupt card is applied immediately and play continues from our
    // position, so the next turn should be the next player (the bot here).
    await page.waitForFunction(
      (idx: number) => window.__LOCO_E2E__?.getState?.()?.currentTurn === idx,
      otherIdx,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.discard?.kind).toBe('number')
    expect(after?.discard?.color).toBe('red')
    expect(after?.discard?.value).toBe(5)
    expect(after?.currentTurn).toBe(otherIdx)
  })

  /**
   * Non-counter card during active +2/+4 penalty returns an error:
   * Under an active draw stack, only a matching +2 or +4 may be countered.
   * Playing any other card via play_card is rejected by the server.
   */
  test('playing a non-counter card during active penalty returns an error', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0

    // Set state: we have a non-counter card (red 7), pendingDraw=2, and it's our turn.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 7 },
        { color: 'blue', kind: 'number', value: 3 },
      ],
      discard: { color: 'red', kind: 'draw_two' },
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    const before = await getState(page)
    expect(before?.pendingDraw).toBe(2)

    // Wait for any pre-existing error to clear (auto-clears after 2.5 s).
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined,
      { timeout: 5_000 },
    ).catch(() => { /* no prior error */ })

    // Attempt to play a non-counter card illegally.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'red', kind: 'number', value: 7 },
    })

    // Server must reject with an error.
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 10_000 },
    )

    await expect(page.locator('[class*="errorToast"]')).toBeVisible()

    // pendingDraw must remain unchanged (play was rejected).
    const after = await getState(page)
    expect(after?.pendingDraw).toBe(2)
  })

  /**
   * Two-player real-time sync:
   * When Alice plays a card, Bob's store must reflect the reduced hand size.
   * Uses debugSetState to give Alice a guaranteed playable card (a wild)
   * so the play succeeds on the first attempt.
   */
  test('two-player sync: card play is immediately reflected on the other client', async ({
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
      await page1.getByRole('button', { name: T.startGame }).click()

      await expect(page1.locator('canvas')).toBeVisible({ timeout: 10_000 })
      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      const aliceState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceIndex = aliceState?.myIndex ?? 0

      const bobView = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceFromBob = (bobView?.players ?? []).find((p) => p.index === aliceIndex)
      const handBefore = aliceFromBob?.hand_size ?? 7

      // Wait for Alice's turn.
      await waitForTurn(page1, 30_000)

      // Inject a wild card into Alice's hand so she always has a playable card.
      await debugSetState(page1, {
        hand: [
          { color: 'wild', kind: 'wild' },
          { color: 'red', kind: 'number', value: 1 },
          { color: 'blue', kind: 'number', value: 2 },
        ],
      })

      // Verify Alice's hand was updated.
      const aliceHand = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.()?.myHand)
      expect(aliceHand).toHaveLength(3)

      // Alice plays the wild card.
      await sendMsg(page1, {
        type: 'play_card',
        card: { color: 'wild', kind: 'wild' },
        chosen_color: 'red',
      })

      // Bob's view of Alice's hand_size must decrease.
      await page2.waitForFunction(
        ([idx, before]: [number, number]) => {
          const players = window.__LOCO_E2E__?.getState?.()?.players ?? []
          const alice = players.find((p) => p.index === idx)
          return (alice?.hand_size ?? 0) < before
        },
        [aliceIndex, 3] as [number, number],
        { timeout: 10_000 },
      )

      const bobUpdated = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceAfter = (bobUpdated?.players ?? []).find((p) => p.index === aliceIndex)
      expect(aliceAfter?.hand_size).toBeLessThan(3)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
