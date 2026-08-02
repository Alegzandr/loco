/**
 * rematch.spec.ts
 *
 * Tests the end-of-match exit: instead of a dead end that forces a page reload
 * and a fresh room code, the table reopens the same room and everyone lands
 * back in the waiting room with scores cleared.
 *
 * A rematch is an agreement rather than the host's decision, so what is under
 * test is the agreement: one ask deals nothing, everybody's asks deal, and a
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
  await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
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

  test('when the host leaves the game-over screen, the remaining player is promoted and the ask waits', async ({ browser }) => {
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

    // Host abandons the room. The server re-bases Bob to seat 0; his client must
    // follow, otherwise the room is stranded with no one able to rematch.
    await hostCtx.close()
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.myIndex === 0,
      undefined,
      { timeout: 15_000 },
    )
    // The button stays where it was and is disabled: a rematch is an agreement,
    // and there is nobody left to agree with. It is not removed, because the
    // answer may still be one reconnect away and this screen does not reflow.
    const rematchBtn = guest.getByRole('button', { name: T.rematch })
    await expect(rematchBtn).toBeVisible({ timeout: 5_000 })
    await expect(rematchBtn).toBeDisabled()

    // The table itself survives the departure: same code, one seat.
    const s = await getState(guest)
    expect(s?.roomCode).toBe(code)
    expect(s?.players ?? []).toHaveLength(1)
    expect(s?.screen).toBe('gameover')

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
})
