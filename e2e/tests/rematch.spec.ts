/**
 * rematch.spec.ts
 *
 * Tests the end-of-match exit: instead of a dead end that forces a page reload
 * and a fresh room code, the table reopens the same room and everyone lands
 * back in the waiting room with scores cleared.
 *
 * A rematch is an agreement rather than the host's decision, so what is under
 * test is the agreement: one ask deals nothing, two asks deal whatever the size
 * of the table, the reopened room is hosted by somebody who asked for it, and a
 * player leaving retires their ask instead of stranding the rest.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  winWith,
  waitForRoundSummary,
  waitForGameOver,
  clickContinue,
  askRematch,
  acceptRematch,
  clickRematch,
  debugSetState,
} from '../helpers/game'

/** Drives a BO1 match to game over by emptying the local player's hand. */
async function winBO1(page: import('@playwright/test').Page): Promise<void> {
  const s = await getState(page)
  const myIdx = s?.myIndex ?? 0
  const opponentIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
  await debugSetState(page, {
    hand: [{ color: 'red', kind: 'number', value: 7 }],
    hands: [{ playerIndex: opponentIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
    discard: { color: 'red', kind: 'number', value: 5 },
    pendingDraw: 0,
    currentTurn: myIdx,
  })
  await winWith(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
  await waitForRoundSummary(page, 20_000)
  await clickContinue(page)
  await waitForGameOver(page, 30_000)
}

test.describe('rematch', () => {
  test('one player asking reopens a table where the only other seat is a bot', async ({ page }) => {
    const code = await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await winBO1(page)

    await clickRematch(page)

    // Same room, cleared match state, and the bot is still at the table.
    await expect(page.getByText(code, { exact: false })).toBeVisible({ timeout: 5_000 })
    const s = await getState(page)
    expect(s?.roomCode).toBe(code)
    expect(s?.matchOver).toBe(false)
    expect(s?.matchWinner).toBe('')
    expect(s?.scoreboard ?? []).toHaveLength(0)
    expect(s?.players ?? []).toHaveLength(2)

    // The reopened room is a real lobby: the new match deals fresh hands.
    await startGame(page)
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === 8,
      undefined,
      { timeout: 10_000 },
    )
    const after = await getState(page)
    expect(after?.roundNumber).toBe(1)

    // And the table can be rematched again. The asks that dealt this match are
    // spent: a set left standing made the second game over open on a disabled
    // button waiting on an opponent nobody had asked, with no ask left to send.
    await winBO1(page)
    expect((await getState(page))?.rematchOffers ?? []).toHaveLength(0)
    await expect(page.getByRole('button', { name: T.rematch })).toBeEnabled()
    await clickRematch(page)
    expect((await getState(page))?.screen).toBe('waiting')
  })

  test('both players have to ask, and the second ask reopens the room for both', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await startGame(host)
    await winBO1(host)

    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
      undefined,
      { timeout: 30_000 },
    )
    // The guest has the same button the host has: nobody decides for anybody.
    await expect(guest.getByRole('button', { name: T.rematch })).toBeVisible({ timeout: 5_000 })

    // One ask deals nothing, and it is public: the guest is told somebody is
    // waiting on them, and the host's own button says it is waiting.
    await askRematch(host)
    await guest.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.rematchOffers ?? []).includes(0),
      undefined,
      { timeout: 5_000 },
    )
    await expect(host.getByRole('button', { name: T.rematchWaitingOpponent })).toBeDisabled()
    expect((await getState(host))?.screen).toBe('gameover')

    await acceptRematch(guest)

    // The guest is moved back to the waiting room by the server, keeping their seat.
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 10_000 },
    )
    const guestState = await getState(guest)
    expect(guestState?.roomCode).toBe(code)
    expect(guestState?.myIndex).toBe(1)
    expect(guestState?.matchOver).toBe(false)

    await hostCtx.close()
    await guestCtx.close()
  })

  // Two asks are a game, whatever the table's size. The seat that said nothing
  // is carried into the reopened lobby rather than dropped, and the table goes
  // to somebody who did ask — the host said nothing here, so the badge moves.
  test('two asks at a table of three reopen the room and hand it to an asker', async ({ browser }) => {
    const ctxs = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ])
    const [host, bob, carol] = await Promise.all(ctxs.map((c) => c.newPage()))

    const code = await createRoom(host, 'Alice')
    await joinRoom(bob, 'Bob', code)
    await joinRoom(carol, 'Carol', code)
    await startGame(host)
    await winBO1(host)
    for (const page of [bob, carol]) {
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
        undefined,
        { timeout: 30_000 },
      )
    }

    // Carol asks first, Bob answers, and the host never touches the button.
    await askRematch(carol)
    await bob.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.rematchOffers ?? []).includes(2),
      undefined,
      { timeout: 10_000 },
    )
    await bob.getByRole('button', { name: T.rematchAccept, exact: false }).click()

    for (const page of [host, bob, carol]) {
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
        undefined,
        { timeout: 10_000 },
      )
    }

    // Everybody is still at the table, the silent host included, and the seat
    // that hosts it is Bob's: the earliest arrival among the two who asked.
    const hostState = await getState(host)
    expect(hostState?.roomCode).toBe(code)
    expect(hostState?.players).toHaveLength(3)
    expect(hostState?.myIndex).toBe(1)
    expect((await getState(bob))?.myIndex).toBe(0)
    expect((await getState(carol))?.myIndex).toBe(2)

    await Promise.all(ctxs.map((c) => c.close()))
  })

  // A dropped socket on the game-over screen used to cost the seat outright, so
  // the player who pressed the same button two seconds later was answered "not
  // in a room" by the only control that screen has. The seat is held now and the
  // client reclaims it with its token, exactly like a seat in a running match.
  test('a socket that drops on the game-over screen reclaims its seat and can still rematch', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await startGame(host)
    await winBO1(host)
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
      undefined,
      { timeout: 30_000 },
    )

    // Only the socket goes; the tab stays, which is the disconnect this is about.
    await guest.evaluate(() => window.__LOCO_E2E__?.forceCloseWs?.())
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getWsStatus?.() === 'open',
      undefined,
      { timeout: 15_000 },
    )

    // The screen never moved, and the seat is the same one.
    const back = await getState(guest)
    expect(back?.screen).toBe('gameover')
    expect(back?.roomCode).toBe(code)
    expect(back?.myIndex).toBe(1)

    // The button works, which is the whole point of holding the seat.
    await askRematch(guest)
    await host.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.rematchOffers ?? []).includes(1),
      undefined,
      { timeout: 10_000 },
    )
    await acceptRematch(host)
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 10_000 },
    )

    await hostCtx.close()
    await guestCtx.close()
  })

  test('when the host drops on the game-over screen, the table is not stranded', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await startGame(host)
    await winBO1(host)
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
      undefined,
      { timeout: 30_000 },
    )

    // The host's socket goes. A finished table holds the seat for the reconnect
    // window rather than releasing it — the match is over, the rematch is not,
    // and a wifi hiccup between the last card and the button used to cost the
    // seat outright. So Bob sees a seat marked absent, not a seat removed.
    await hostCtx.close()
    await guest.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.players ?? []).some((p) => !p.connected),
      undefined,
      { timeout: 15_000 },
    )

    // The button stays where it was and stays live: the answer may be one
    // reconnect away, and this screen does not reflow.
    const rematchBtn = guest.getByRole('button', { name: T.rematch })
    await expect(rematchBtn).toBeVisible({ timeout: 5_000 })
    await expect(rematchBtn).toBeEnabled()

    // And it is not a button that waits out a minute for somebody who is gone:
    // the quorum is whoever is connected, so Bob's ask is the whole table. The
    // room reopens with the absent seat pruned and Bob re-based onto seat 0.
    await rematchBtn.click()
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 15_000 },
    )
    const s = await getState(guest)
    expect(s?.roomCode).toBe(code)
    expect(s?.myIndex).toBe(0)
    expect(s?.players ?? []).toHaveLength(1)

    await guestCtx.close()
  })

  // Nobody is left waiting on a player who is not there: the ask that cannot be
  // answered leaves with the seat, and the table's question is answered by the
  // departure itself.
  test('a player leaving completes the agreement of whoever is left', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await startGame(host)
    await winBO1(host)
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
      undefined,
      { timeout: 30_000 },
    )

    await askRematch(guest)
    await hostCtx.close()

    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 15_000 },
    )
    const s = await getState(guest)
    expect(s?.roomCode).toBe(code)
    expect(s?.myIndex).toBe(0)
    expect(s?.matchOver).toBe(false)

    await guestCtx.close()
  })

  // The evening, not the match. A rematch nils the scoreboard, so two matches on
  // one code used to leave nothing able to say who won the night.
  test('keeps a match-by-match recap across a rematch', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await winBO1(page)

    // One match is one column, which is the standings above it said twice: the
    // block has to stay off until there is an evening to show.
    await expect(page.getByText(T.recapTitle)).toHaveCount(0)
    const first = (await getState(page))?.matchHistory ?? []
    expect(first).toHaveLength(1)
    // The match was timed on the server, and the card says so: a real match
    // through the map gate takes well under a minute here, which is the
    // wording the card gives anything below sixty seconds.
    expect(first[0].duration_ms ?? 0).toBeGreaterThanOrEqual(1)
    await expect(page.getByText(T.matchUnderAMinute)).toBeVisible()

    await clickRematch(page)
    await startGame(page)
    await winBO1(page)

    const s = await getState(page)
    expect(s?.matchHistory ?? []).toHaveLength(2)
    // Both matches were taken by seat 0, and the scoreboard beside it restarted.
    expect((s?.matchHistory ?? []).map((m) => m.winner_index)).toEqual([0, 0])

    await expect(page.getByText(T.recapTitle)).toBeVisible({ timeout: 5_000 })
    // Scoped to the recap's own head row: `M1` is two characters and the round
    // columns of the scoreboard above it carry the same convention.
    const heads = page.locator('.recapTable th')
    await expect(heads.filter({ hasText: T.recapMatchCol.replace('%n', '1') })).toBeVisible()
    await expect(heads.filter({ hasText: T.recapMatchCol.replace('%n', '2') })).toBeVisible()
    await expect(page.getByText(T.recapWonCol)).toBeVisible()
  })
})