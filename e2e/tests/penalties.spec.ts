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
  waitForTableOpen,
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
      await waitForTableOpen(bob)

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

  /**
   * §8: one card, one call. The declaration is spent on the server's
   * confirmation, so the button stops offering it — it used to stay armed and
   * every extra tap re-broadcast uno_declared, replaying the banner and the
   * sting for the whole table.
   */
  test('the LOCO! button is spent once the declaration lands', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await expect(gameBoard(page)).toBeVisible({ timeout: 10_000 })
    await waitForTableOpen(page)

    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      discard: { color: 'red', kind: 'number', value: 5 },
      activeColor: 'red',
      currentTurn: myIdx,
    })

    const unoBtn = page.getByRole('button', { name: T.unoBtn })
    await expect(unoBtn).toBeEnabled({ timeout: 5_000 })
    await unoBtn.click()

    await expect(unoBtn).toBeDisabled({ timeout: 5_000 })
    expect((await getState(page))?.myDeclared).toBe(true)
  })

  /**
   * §14.6: a Contre-LOCO! only lands inside the window, and one that arrives
   * after the declaration costs its caller a card.
   *
   * The tap itself has to go down the socket rather than through the button:
   * the client disables Catch the instant `uno_declared` arrives, so by
   * construction a missed call is a message that left while the button was
   * still armed. That is the race this rule exists for, and it is the one part
   * of the flow the UI cannot stage. The button's own half — spent on press —
   * is asserted from the click just below.
   */
  test('a Contre-LOCO! that loses its race costs the caller a card', async ({
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
      await waitForTableOpen(bob)

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
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

      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })

      const handBefore = (await getState(alice))?.myHand?.length ?? 0

      // Bob calls it; Alice's tap was already on its way.
      await sendMsg(bob, { type: 'declare_uno' })
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })
      await sendMsg(alice, { type: 'catch_uno', target_index: bobIdx })

      await alice.waitForFunction(
        (n) => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === n,
        handBefore + 1,
        { timeout: 5_000 },
      )
      const after = await getState(alice)
      expect(after?.catchFailed?.seat).toBe(aliceIdx)
      // The seat the call was aimed at keeps its single card.
      expect((after?.players ?? []).find((p) => p.index === bobIdx)?.hand_size).toBe(1)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * The other half of §14.6: the button is spent the moment it is pressed, not
   * when the server answers. A call in flight already costs a card if it loses,
   * so a second tap during that round trip would buy the same opinion twice.
   */
  test('the Catch! button is spent on press, before the server answers', async ({
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
      await waitForTableOpen(bob)

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
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })

      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })
      await catchBtn.click()
      await expect(catchBtn).toBeDisabled()
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * A catch that lands has to be visible to the whole table, and for a long time
   * it was visible to nobody: the server closed the window, the caught hand grew
   * by two, and on a board where hands grow all match long that is
   * indistinguishable from an ordinary draw. The catcher saw a button go dark.
   *
   * Asserted on both pages on purpose — the verdict is table news, not a
   * private reply to whoever pressed the button.
   */
  test('a landed Contre-LOCO! is announced on every screen', async ({
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
      await waitForTableOpen(bob)

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
      // Bob plays down to one card and says nothing.
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })

      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })
      await catchBtn.click()

      // The stamp names the seat that owed the call, on the caller's screen and
      // on the caught player's alike.
      await expect(alice.getByTestId('catch-banner')).toContainText(T.catchBannerTitle, {
        timeout: 5_000,
      })
      await expect(bob.getByTestId('catch-banner')).toContainText(T.catchBannerTitle, {
        timeout: 5_000,
      })

      // And the store agrees about whose seat it was, which is what the penalty
      // cards on the board are aimed at.
      expect((await getState(alice))?.catchFlash?.seat).toBe(bobIdx)
      // Bob took the two-card penalty: 1 card left + 2 drawn.
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === 3,
        undefined,
        { timeout: 5_000 },
      )
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
