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
   * It stops one card short of that, and the stop is the calibration: nothing
   * takes a seat from three cards to one in a single action, so the button
   * would be live through a long stretch where pressing can only miss — and a
   * miss the player can schedule is a card drawn on purpose, which a Swap turns
   * into a hand handed to somebody else.
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
   * A seat can leave the button's reach without a card being played — it takes
   * two penalty cards from a catch that landed, it draws, it swallows a stack
   * of four — and the button used to grey out on that frame. That spared the
   * player the late half of their own wager: the server charges a press made
   * there, so an interface that refuses it is deciding, in the player's
   * favour, that they may not be too late. Being too early is a mistake the
   * button has always allowed; being too late has to be one too.
   *
   * What ends the offer is the clock, not the hand: the window plus the late
   * grace, which is the same stretch the server keeps charging for. Not a
   * latch — held to the next card played, the offer was farmed: press against a
   * seat on two, watch it draw, wait for anybody to play, press again.
   */
  test('Catch! outlives the seat leaving its reach, and ends on the clock', async ({
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

      // Bob swallows a stack of four without a card being played: five cards
      // now, nothing about him can be caught, and the armed cue goes with it.
      // Alice has pressed nothing — her wager is the one this test is about, so
      // it has to still be hers to lose.
      await debugSetState(alice, {
        hands: [
          { playerIndex: bobIdx, hand: [
            { color: 'blue', kind: 'number', value: 3 },
            { color: 'blue', kind: 'number', value: 4 },
            { color: 'blue', kind: 'number', value: 5 },
            { color: 'blue', kind: 'number', value: 6 },
            { color: 'blue', kind: 'number', value: 7 },
          ] },
        ],
      })
      await alice.waitForFunction(
        (seat) =>
          (window.__LOCO_E2E__?.getState?.()?.players ?? []).find((p) => p.index === seat)
            ?.hand_size === 5,
        bobIdx,
        { timeout: 10_000 },
      )
      await expect(catchBtn).not.toHaveClass(/\barmed\b/)
      expect((await getState(alice))?.catchTarget).toBeNull()
      // And still pressable, with Bob five cards from the finish: his window is
      // what the button is offered against, and it is still running. A control
      // that greyed out on this frame would be sparing Alice the late press the
      // server charges her a card for.
      await expect(catchBtn).toBeEnabled()

      // It ends on the clock and on nothing else: the window plus its grace,
      // measured from the card Bob played at the top of this test.
      await expect(catchBtn).toBeDisabled({ timeout: 12_000 })

      // And it stays dead through Alice's own play: nothing about Bob moved.
      await playCard(alice, { color: 'red', kind: 'number', value: 1 })
      await expect(catchBtn).toBeDisabled({ timeout: 5_000 })
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  /**
   * The clock. A seat on its last card is offered for as long as its window
   * runs and for the late grace after it — whether or not the seat called it,
   * which is what keeps the button from reporting the call. Past the grace the
   * server charges nothing, so a button live there would be offering a wager
   * nobody takes.
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

      // The window and its grace run out on their own — no message arrives —
      // and the button reads the clock and goes dark. Bob is still on one card
      // throughout.
      await expect(catchBtn).toBeDisabled({ timeout: 12_000 })
      expect(
        ((await getState(alice))?.players ?? []).find((p) => p.index === bobIdx)?.hand_size,
      ).toBe(1)
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
      // And what those four free presses *did* buy is the other ration: each one
      // re-armed the lockout, so the button is dead and says why. This is the
      // half the card alone never covered — free presses used to sit there
      // waiting for a window to open under them.
      expect(after?.catchLocked).toBe(true)
      expect(after?.catchLockedUntil ?? 0).toBeGreaterThan(Date.now())
      await expect(alice.getByRole('button', { name: T.catchBtn })).toBeDisabled()
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
   * And once it is spent with no window left to aim at, the button says so.
   * There are two lies a reaction bar can tell and this rule sits between them:
   * greying out because the *table* moved hides the press the price exists to
   * charge for, and staying live over a send the store suppresses offers a
   * press that does nothing at all. The seat is still on one card here; what is
   * over is our turn at it.
   */
  test('the Catch! wager is spent on press, and the button says so', async ({
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
      // Our call is spent, so the control goes dead rather than sitting there
      // live over a press that would send nothing. That the *offer* itself
      // outlives the press is pinned in `catchDerivation.test.ts`, and
      // deliberately not here: it is true for one second of wall clock, which
      // is not a thing to assert through a browser and a network.
      expect((await getState(alice))?.catchSpent).toBe(true)
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
