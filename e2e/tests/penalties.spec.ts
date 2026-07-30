import { test, expect, Browser } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  debugSetState,
  gameBoard,
  playCard,
} from '../helpers/game'

test.describe('error feedback, turn timer, and penalty flows', () => {
  test('invalid play out-of-turn shows error toast', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 1 }],
      discard: { color: 'red', kind: 'number', value: 5 },
      currentTurn: otherIdx,
    })

    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'red', kind: 'number', value: 1 },
    })

    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 10_000 },
    )
    await expect(page.locator('[class*="errorToast"]')).toBeVisible()
  })

  test('turn timer bar is visible when a turn deadline is active', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.turnDeadline !== null,
      undefined,
      { timeout: 30_000 },
    )
    await expect(page.locator('[class*="turnTimerBar"]')).toBeVisible()
  })

  /**
   * §8: the catch window opens when a player *plays down to* one card without
   * calling LOCO!, and closes the moment they call it.
   *
   * The previous version of this test declared UNO and then expected a Catch
   * button — the exact opposite of the rule. It only ever passed because the
   * client used to open the window on the declaration itself.
   */
  test('Catch! appears when an opponent reaches 1 card, and closes when they declare', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()

    try {
      const roomCode = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', roomCode)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const bobIdx = (await getState(bob))?.myIndex ?? 1
      await debugSetState(bob, {
        hand: [
          { color: 'red', kind: 'number', value: 7 },
          { color: 'blue', kind: 'number', value: 3 },
        ],
        discard: { color: 'red', kind: 'number', value: 5 },
        activeColor: 'red',
        currentTurn: bobIdx,
      })

      // Bob plays down to one card and says nothing: he is now catchable.
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })

      // The catch button holds the centre slot at all times and is *enabled* by
      // the window opening — it is never mounted or unmounted, so it cannot move
      // out from under a cursor already parked on it.
      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })
      const armed = await getState(alice)
      expect(armed?.catchTarget).toBe(bobIdx)
      expect(armed?.unoTimerEnd).not.toBeNull()

      // Declaring closes the window — you cannot catch someone who called it.
      await sendMsg(bob, { type: 'declare_uno' })
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })
      expect((await getState(alice))?.catchTarget).toBeNull()
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('pending draw counter is displayed on the Draw button', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0

    await debugSetState(page, {
      hand: [{ color: 'blue', kind: 'number', value: 4 }],
      discard: { color: 'red', kind: 'draw_two' },
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    await expect(page.getByRole('button', { name: /Draw \+2/ })).toBeVisible()
  })

  // rules.md §14.5: eating a draw stack costs cards, not the turn. The victim
  // draws the whole stack and then plays from the enlarged hand.
  test('drawing penalty cards clears pendingDraw and keeps the turn', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const playable = { color: 'red', kind: 'number', value: 4 } as const

    await debugSetState(page, {
      hand: [playable],
      discard: { color: 'red', kind: 'draw_two' },
      activeColor: 'red',
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    await sendMsg(page, { type: 'draw_card' })

    await page.waitForFunction(
      (idx: number) => {
        const st = window.__LOCO_E2E__?.getState?.()
        return st !== undefined && st.currentTurn === idx && (st.pendingDraw ?? 0) === 0 && st.hasDrawn === true
      },
      myIdx,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.pendingDraw).toBe(0)
    expect(after?.currentTurn).toBe(myIdx)
    expect(after?.myHand.length).toBe(3) // 1 held + 2 drawn

    // The turn is still ours: playing is accepted and only then does it move on.
    await playCard(page, playable)
    await page.waitForFunction(
      (idx: number) => {
        const st = window.__LOCO_E2E__?.getState?.()
        return st !== undefined && st.currentTurn !== idx
      },
      myIdx,
      { timeout: 10_000 },
    )
  })

  test('UNO button is enabled and clickable with exactly 1 card in hand', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0

    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      discard: { color: 'red', kind: 'number', value: 5 },
      currentTurn: myIdx,
    })

    const unoBtn = page.getByRole('button', { name: T.unoBtn })
    await expect(unoBtn).toBeEnabled({ timeout: 3_000 })
    await unoBtn.click()

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.unoDeclared === true,
      undefined,
      { timeout: 5_000 },
    )
  })
})
