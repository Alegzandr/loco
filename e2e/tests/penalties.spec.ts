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

  test('Catch! button appears during the UNO catch window', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()

    try {
      const roomCode = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', roomCode)
      await startGame(alice)
      await expect(bob.locator('canvas')).toBeVisible({ timeout: 10_000 })

      const bobState = await getState(bob)
      const bobIdx = bobState?.myIndex ?? 1
      await debugSetState(bob, {
        hand: [{ color: 'red', kind: 'number', value: 7 }],
        discard: { color: 'red', kind: 'number', value: 5 },
        currentTurn: bobIdx,
      })
      await sendMsg(bob, { type: 'declare_uno' })

      await expect(alice.getByRole('button', { name: T.catchBtn })).toBeVisible({ timeout: 5_000 })
      const state = await getState(alice)
      expect(state?.unoTimerEnd).not.toBeNull()
      expect(state?.unoTimerEnd).toBeGreaterThan(Date.now() - 2_000)
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

  test('drawing penalty cards clears pendingDraw and advances turn', async ({ page }) => {
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

    await sendMsg(page, { type: 'draw_card' })

    await page.waitForFunction(
      (idx: number) => {
        const st = window.__LOCO_E2E__?.getState?.()
        return st !== undefined && st.currentTurn !== idx && (st.pendingDraw ?? 0) === 0
      },
      myIdx,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.pendingDraw).toBe(0)
    expect(after?.currentTurn).not.toBe(myIdx)
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
