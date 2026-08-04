/**
 * walk-out.spec.ts
 *
 * Leaving a match in progress at a table that can spare the seat.
 *
 * "The cards are out, go and finish the round" is the right answer at three
 * seats. At four or more it is not: the only exit somebody who genuinely has to
 * leave can reach is the turn clock, which auto-draws and auto-passes for them
 * until the AFK threshold — two rounds spoiled for everybody else rather than
 * one player leaving.
 *
 * Four seats here, two of them bots: the rule counts seats that can still act,
 * and a bot can act. Self-contained like every test in this suite, and it takes
 * no lock — nothing here touches the matchmaking queue.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  waitForTableOpen,
} from '../helpers/game'

test.describe('walking out of a match', () => {
  test('a table of four lets a seat go, and keeps playing', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await addBot(host)
    await addBot(host)
    await startGame(host)
    await waitForTableOpen(host)
    await waitForTableOpen(guest)

    // The guest can go: three seats are left, and two of them are bots.
    const leave = guest.getByRole('button', { name: T.leaveMatchBtn })
    await expect(leave).toBeVisible({ timeout: 10_000 })
    await leave.click()

    // It asks first, and the safe answer is the one that backs out.
    await expect(guest.getByText(T.leaveMatchAsk)).toBeVisible()
    await guest.getByRole('button', { name: T.leaveMatchStay }).click()
    await expect(guest.getByText(T.leaveMatchAsk)).toHaveCount(0)
    expect((await getState(guest))?.screen).toBe('game')

    await leave.click()
    await guest.getByRole('button', { name: T.leaveMatchYes }).click()

    // The leaver is back at the front door.
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'lobby',
      undefined,
      { timeout: 10_000 },
    )

    // And the table is still playing, with the seat reading as gone and holding
    // no cards: the hand went back to the deck rather than sitting where nobody
    // can play it.
    await host.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        const bob = s?.players?.find((p) => p.nickname === 'Bob')
        return !!bob && !bob.connected && bob.hand_size === 0
      },
      undefined,
      { timeout: 10_000 },
    )
    expect((await getState(host))?.screen).toBe('game')
    // Never the leaver's turn again: the clock has nothing to auto-pass for.
    const s = await getState(host)
    const bobSeat = s?.players?.find((p) => p.nickname === 'Bob')?.index
    expect(s?.currentTurn).not.toBe(bobSeat)

    await hostCtx.close()
    await guestCtx.close()
  })

  test('a table of three offers no way out at all', async ({ browser }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await addBot(host)
    await startGame(host)
    await waitForTableOpen(host)
    await waitForTableOpen(guest)

    // One leaving would leave two, and this game is not any good at two people
    // who did not choose it. The control is simply not drawn.
    await expect(guest.getByRole('button', { name: T.leaveMatchBtn })).toHaveCount(0)

    await hostCtx.close()
    await guestCtx.close()
  })
})
