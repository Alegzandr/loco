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

      // The catch button holds the centre slot at all times and is never mounted
      // or unmounted, so it cannot move out from under a cursor already parked
      // on it. It is pressable from the moment a seat is near the finish; what
      // the window opening adds is the *armed* cue.
      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })
      const armed = await getState(alice)
      expect(armed?.catchTarget).toBe(bobIdx)
      expect(armed?.unoTimerEnd).not.toBeNull()

      // Declaring closes the window — you cannot catch someone who called it.
      // What closes with it is the *armed* cue and the target, never the
      // control: Bob is still the seat near the finish, so the button stays
      // pressable and a press now costs Alice a card. That press is the one the
      // price exists to charge for — the thumb already on its way down when Bob
      // shouted — and a button that went dead here would both refuse it and
      // report the declaration to a player who was not listening for it.
      await sendMsg(bob, { type: 'declare_uno' })
      await expect(catchBtn).not.toHaveClass(/\barmed\b/, { timeout: 5_000 })
      await expect(catchBtn).toBeEnabled()
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

    // The chip stays where it is and goes dead. Nothing on the bar moves when a
    // control is spent, here or anywhere else on it.
    await expect(unoBtn).toBeDisabled({ timeout: 5_000 })
    expect((await getState(page))?.myDeclared).toBe(true)
  })

  /**
   * §14.6: a Contre-LOCO! only lands inside the window, and one that arrives
   * after the declaration costs its caller a card.
   *
   * The tap itself has to go down the socket rather than through the button:
   * the client disarms Catch the instant `uno_declared` arrives and spends the
   * wager on the press, so by construction a missed call is a message that left
   * while the window was still open. That is the race this rule exists for, and
   * it is the one part of the flow the UI cannot stage. The button's own half —
   * spent on press — is asserted from the click just below.
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
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })

      const handBefore = (await getState(alice))?.myHand?.length ?? 0

      // Bob calls it; Alice's tap was already on its way.
      await sendMsg(bob, { type: 'declare_uno' })
      await expect(catchBtn).not.toHaveClass(/\barmed\b/, { timeout: 5_000 })
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
   * The centre button wakes up on a read of the table, not on the server's
   * permission: two cards in somebody else's hand is one ordinary play from the
   * window, so the thumb can be there before the server has named anybody. A
   * control that only unlocked once a window was already open could only ever
   * be answered, and the window it answers is five seconds long.
   *
   * It stops one card short of that, and the stop is the calibration: from three
   * cards out only an interrupt of two identical cards reaches the window, so
   * the button would be live through a long stretch where pressing can only
   * miss — and a miss the player can schedule is a card drawn on purpose, which
   * a Swap turns into a hand handed to somebody else.
   */
  test('Catch! is pressable from two cards out, and dead above that', async ({
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
      await waitForTableOpen(alice)

      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      // Three cards is one too many: the button is present, in place, and dead.
      await debugSetState(bob, {
        hand: [
          { color: 'red', kind: 'number', value: 1 },
          { color: 'red', kind: 'number', value: 2 },
          { color: 'red', kind: 'number', value: 3 },
        ],
      })
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })

      await debugSetState(bob, {
        hand: [
          { color: 'red', kind: 'number', value: 1 },
          { color: 'red', kind: 'number', value: 2 },
        ],
      })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })
      // Pressable, but not promising anything: nobody owes the call yet.
      await expect(catchBtn).not.toHaveClass(/\barmed\b/)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * No latch. A seat that leaves the button's reach without a card being
   * played — it takes two penalty cards from a catch that landed, it draws, it
   * swallows a stack of four — takes the button down with it. Held past that,
   * the offer was farmed: press against a seat on two, watch it draw, wait for
   * anybody to play, press again, a card a press for a Swap to hand on.
   */
  test('Catch! goes dead when the seat it was offered on leaves its reach', async ({
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
      await waitForTableOpen(alice)

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      await debugSetState(alice, {
        hands: [
          { playerIndex: aliceIdx, hand: [
            { color: 'red', kind: 'number', value: 1 },
            { color: 'red', kind: 'number', value: 2 },
          ] },
          { playerIndex: bobIdx, hand: [
            { color: 'red', kind: 'number', value: 7 },
            { color: 'blue', kind: 'number', value: 3 },
          ] },
        ],
        discard: { color: 'red', kind: 'number', value: 5 },
        activeColor: 'red',
        pendingDraw: 0,
        direction: 1,
        currentTurn: bobIdx,
      })

      // Bob plays down to one card and says nothing.
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })

      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })
      await catchBtn.click()

      // The catch lands once Bob's head start is over, and his hand grows by
      // two: three cards from the finish, out of the armed cue and out of the
      // button's reach.
      await alice.waitForFunction(
        (seat) =>
          (window.__LOCO_E2E__?.getState?.()?.players ?? []).find((p) => p.index === seat)
            ?.hand_size === 3,
        bobIdx,
        { timeout: 10_000 },
      )
      await expect(catchBtn).not.toHaveClass(/\barmed\b/)
      expect((await getState(alice))?.catchTarget).toBeNull()
      // The press was acknowledged on the spot and the verdict released it: a
      // button still held down after the catch landed would be waiting on an
      // answer that has already arrived.
      expect((await getState(alice))?.catchPending).toBe(false)
      await expect(catchBtn).not.toHaveClass(/\bcalled\b/)
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })

      // And it stays dead through Alice's own play: nothing about Bob moved.
      await playCard(alice, { color: 'red', kind: 'number', value: 1 })
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * The clock. A seat on its last card is offered for exactly as long as its
   * window runs, and the button goes dark when the window does — whether or
   * not the seat called it, which is what keeps the button from reporting the
   * call. Past the window nothing about the seat can be caught, so a press
   * there would be a wager that could only lose, i.e. a card drawn on purpose.
   */
  test('Catch! goes dark when the window runs out, declared or not', async ({
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
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })

      // Bob calls it: the armed cue goes, the button does not.
      await sendMsg(bob, { type: 'declare_uno' })
      await expect(catchBtn).not.toHaveClass(/\barmed\b/, { timeout: 5_000 })
      await expect(catchBtn).toBeEnabled()

      // The window runs out on its own — no message arrives — and the button
      // reads the clock and goes dark. Bob is still on one card throughout.
      await expect(catchBtn).toBeDisabled({ timeout: 8_000 })
      expect(
        ((await getState(alice))?.players ?? []).find((p) => p.index === bobIdx)?.hand_size,
      ).toBe(1)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * The head start. A thumb that never lets go used to land the catch on the
   * millisecond the card touched the pile, before the LOCO! it was racing could
   * have crossed the wire — spamming the button was the way to deny every call
   * at the table. The seat that owes the call now gets the first 1.5 s of its
   * own window: a press inside it is held, and a call made in the meantime
   * turns it into a lost race. Charged once, and Bob keeps his single card.
   */
  test('a Contre-LOCO! pressed the instant the card lands waits out the head start', async ({
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
      const handBefore = (await getState(alice))?.myHand?.length ?? 0

      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 7 },
        chosen_color: 'red',
      })
      // Alice's press is on its way the instant the cue arrives; Bob's call
      // follows it by a network trip, well inside his head start.
      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })
      await catchBtn.click()
      await sendMsg(bob, { type: 'declare_uno' })

      // The held press resolves as a lost race: one card for Alice, none for
      // Bob, and no catch stamp anywhere.
      await alice.waitForFunction(
        (n) => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === n,
        handBefore + 1,
        { timeout: 6_000 },
      )
      const after = await getState(alice)
      expect(after?.catchFailed?.seat).toBe(aliceIdx)
      expect(after?.catchFlash).toBeNull()
      expect((after?.players ?? []).find((p) => p.index === bobIdx)?.hand_size).toBe(1)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * §14.6's price, and its ceiling. The button is live from the moment anybody
   * is near the finish, so most presses are made on a read of the table rather
   * than on a window the server has already named — and a read that is wrong
   * costs a card, exactly like a race lost by a millisecond.
   *
   * What it does not cost is a card per press, and it costs nothing at all
   * where nothing is offered. The charge is rationed by the offer — the seat
   * on two cards — so the second, third and tenth press against it are the
   * same misread, and a game that billed each of them would be taxing the
   * reflex it spends the whole match asking for. All three are asserted here,
   * because any one alone is a rule that reads fine and plays badly.
   */
  test('a Contre-LOCO! with nobody on the hook costs one card per offer, and nothing off one', async ({
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
      const handBefore = (await getState(alice))?.myHand?.length ?? 0

      // Eight-card hands all round: nobody is near the finish, so this is not a
      // wager. Nothing is charged and nothing is answered.
      await sendMsg(alice, { type: 'catch_uno', target_index: bobIdx })
      await alice.waitForTimeout(1_000)
      expect((await getState(alice))?.myHand?.length ?? 0).toBe(handBefore)
      expect((await getState(alice))?.catchFailed).toBeNull()

      // Bob one play from the finish: now the press is the wager, and it misses.
      await debugSetState(bob, {
        hand: [
          { color: 'red', kind: 'number', value: 7 },
          { color: 'blue', kind: 'number', value: 3 },
        ],
      })
      await expect(alice.getByRole('button', { name: T.catchBtn })).toBeEnabled({
        timeout: 5_000,
      })
      await sendMsg(alice, { type: 'catch_uno', target_index: bobIdx })
      await alice.waitForFunction(
        (n) => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === n,
        handBefore + 1,
        { timeout: 5_000 },
      )
      expect((await getState(alice))?.catchFailed?.seat).toBe(aliceIdx)

      // Four more presses against the same offer. Generous margin, then the
      // assertion is the absence: the hand has not moved again.
      for (let i = 0; i < 4; i++) {
        await sendMsg(alice, { type: 'catch_uno', target_index: bobIdx })
      }
      await alice.waitForTimeout(1_000)
      const after = await getState(alice)
      expect(after?.myHand?.length ?? 0).toBe(handBefore + 1)
      // The seat it was aimed at keeps its hand throughout: a failed call is the
      // caller's business and nobody else's obligation.
      expect((after?.players ?? []).find((p) => p.index === bobIdx)?.hand_size).toBe(2)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * The other half of §14.6: the wager is spent the moment the button is
   * pressed, not when the server answers. A call in flight already costs a card
   * if it loses, so a second tap during that round trip would buy the same
   * opinion twice.
   *
   * What is spent is the wager, not the control. The button stays pressable —
   * greying it out under a thumb already on it is the one thing this bar exists
   * not to do — and what goes is the target it was offering.
   */
  test('the Catch! wager is spent on press, before the server answers', async ({
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
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })
      await catchBtn.click()
      await alice.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.catchTarget === null,
        undefined,
        { timeout: 5_000 },
      )
      await expect(catchBtn).toBeEnabled()
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

      // Armed, not merely enabled: the button is pressable from two cards out,
      // so clicking on `toBeEnabled` would fire before the window opened and buy
      // a penalty instead of the catch this test is about.
      const catchBtn = alice.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toHaveClass(/\barmed\b/, { timeout: 5_000 })
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
