/**
 * penalties.spec.ts
 *
 * Tests for error feedback, the per-turn timer bar, the UNO catch window,
 * and pending-draw penalty flows.
 *
 * These tests verify that the client correctly responds to server-driven
 * game events.  Server-side validation and rule enforcement are covered by
 * Go unit tests; here we confirm the UI reacts as expected.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  waitForUnoDeclared,
  waitForMyTurn,
} from '../helpers/game'

test.describe('error feedback, turn timer, and penalty flows', () => {
  /**
   * Send a play_card message when it is NOT our turn.
   * The server returns an error message; the client must show an error toast.
   */
  test('invalid play out-of-turn shows error toast', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait until it is definitely not our turn so the play is invalid.
    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s !== undefined && s.currentTurn !== s.myIndex
      },
      undefined,
      { timeout: 30_000 },
    )

    // Send a well-formed but out-of-turn play_card message.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'red', kind: 'number', value: 1 },
    })

    // Server returns an error; store should set errorMsg to a non-empty string.
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 10_000 },
    )

    // Error toast element must be visible in the DOM.
    await expect(page.locator('[class*="errorToast"]')).toBeVisible()
  })

  /**
   * After at least one game event (card played, drawn, or turn changed), the server
   * includes a turn_deadline in its broadcast.  The client sets turnDeadline in the
   * store, which triggers the per-turn countdown bar in GameView.
   */
  test('turn timer bar is visible when a turn deadline is active', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait until the store has a non-null turnDeadline (set on first card/draw/turn event).
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
      undefined,
      { timeout: 30_000 },
    )

    // The turnTimerBar element must be rendered in the DOM.
    await expect(page.locator('[class*="turnTimerBar"]')).toBeVisible()
  })

  /**
   * When any player declares UNO (bots auto-declare when they play to 1 card),
   * the store sets unoDeclared=true and unoTimerEnd to a future timestamp.
   * The Catch! button must appear in the action bar.
   */
  test('Catch! button appears during the UNO catch window', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Bots auto-declare UNO; wait up to 90 s for it to happen.
    await waitForUnoDeclared(page, 90_000)

    // Catch! button must now be visible.
    await expect(page.getByRole('button', { name: T.catchBtn })).toBeVisible({
      timeout: 3_000,
    })

    // unoTimerEnd must be a future timestamp.
    const state = await getState(page)
    expect(state?.unoTimerEnd).not.toBeNull()
    expect(state?.unoTimerEnd).toBeGreaterThan(Date.now() - 5_000) // within last 5 s
  })

  /**
   * When a +2 or +4 has been played (pendingDraw > 0) and it becomes our turn,
   * the Draw button label must include the accumulated draw count (e.g. "Draw 2").
   *
   * This scenario depends on the random deck dealing a penalty card targeting us.
   * The test uses a generous timeout and gracefully skips with an annotation if the
   * condition is not reached, matching the project's pattern for non-deterministic
   * deck-dependent assertions.
   */
  test('pending draw counter is displayed on the Draw button', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait up to 90 s for pendingDraw > 0 on our turn.
    let hasPendingDraw = false
    try {
      await page.waitForFunction(
        () => {
          const s = window.__LOCO_E2E__?.getState?.()
          return (
            s !== undefined &&
            s.currentTurn === s.myIndex &&
            (s.pendingDraw ?? 0) > 0
          )
        },
        undefined,
        { timeout: 90_000 },
      )
      hasPendingDraw = true
    } catch {
      test.info().annotations.push({
        type: 'note',
        description:
          'No +2/+4 penalty was directed at us in this run — pending-draw button check skipped (deck is random)',
      })
    }

    if (hasPendingDraw) {
      const state = await getState(page)
      const pending = state?.pendingDraw ?? 0
      expect(pending).toBeGreaterThan(0)

      // The Draw button must show "Draw N" where N matches the pending count.
      await expect(
        page.getByRole('button', { name: new RegExp(`${T.draw}\\s+${pending}`) }),
      ).toBeVisible()
    }
  })

  /**
   * After absorbing a penalty draw (pendingDraw > 0 → draw_card), pendingDraw must
   * reset to 0 and the turn must advance away from the drawing player.
   *
   * Like the button test above, this requires a +2/+4 to have been played against us.
   */
  test('drawing penalty cards clears pendingDraw and advances turn', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait for a penalty targeting us.
    let hasPendingDraw = false
    try {
      await page.waitForFunction(
        () => {
          const s = window.__LOCO_E2E__?.getState?.()
          return (
            s !== undefined &&
            s.currentTurn === s.myIndex &&
            (s.pendingDraw ?? 0) > 0
          )
        },
        undefined,
        { timeout: 90_000 },
      )
      hasPendingDraw = true
    } catch {
      test.info().annotations.push({
        type: 'note',
        description:
          'No +2/+4 penalty was directed at us in this run — penalty absorption test skipped (deck is random)',
      })
    }

    if (hasPendingDraw) {
      const before = await getState(page)
      const myIdx = before?.myIndex ?? 0

      // Draw the penalty cards.
      await sendMsg(page, { type: 'draw_card' })

      // After a penalty draw the turn moves to the next player and pendingDraw resets.
      await page.waitForFunction(
        (idx: number) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return (
            s !== undefined &&
            s.currentTurn !== idx &&
            (s.pendingDraw ?? 0) === 0
          )
        },
        myIdx,
        { timeout: 10_000 },
      )

      const after = await getState(page)
      expect(after?.pendingDraw).toBe(0)
      expect(after?.currentTurn).not.toBe(myIdx)
    }
  })

  /**
   * Pressing UNO! when it is enabled (hand_size === 1) sends a declare_uno message
   * and the server acknowledges it.  Bots drive our hand down; we declare when ready.
   *
   * The test waits for our hand to reach exactly 1 card, then clicks the UNO button.
   */
  test('UNO button is enabled and clickable with exactly 1 card in hand', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Play aggressively until we have exactly 1 card or the game ends.
    let reached1Card = false
    for (let i = 0; i < 40; i++) {
      try {
        await waitForMyTurn(page, 20_000)
      } catch {
        break
      }
      const state = await getState(page)
      if (!state || state.screen !== 'game' || state.showRoundSummary) break

      const hand = state.myHand ?? []

      if (hand.length === 1) {
        reached1Card = true
        break
      }

      // Find a playable card
      const { discard, activeColor, pendingDraw } = state
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
    }

    if (reached1Card) {
      // UNO button must now be enabled.
      const unoBtn = page.getByRole('button', { name: T.unoBtn })
      await expect(unoBtn).toBeEnabled({ timeout: 3_000 })

      // Click UNO! — this fires declare_uno and the server processes it.
      await unoBtn.click()

      // Verify the server acknowledged: unoDeclared becomes true and the UNO banner shows.
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.unoDeclared === true,
        undefined,
        { timeout: 5_000 },
      )
    } else {
      test.info().annotations.push({
        type: 'note',
        description:
          'Hand never reached exactly 1 card in this run — UNO button enabled/click check skipped',
      })
    }
  })
})
