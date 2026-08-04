/**
 * play-bot.spec.ts
 *
 * A 1v1 against the server, from the home screen to a dealt hand.
 *
 * The point of the mode is that it is the queue's experience with the wait taken
 * out — a name, one press, cards — so what is under test is the whole path in
 * one go, plus the two things that make it a *mode* rather than a shortcut: the
 * table has no host, and the game-over screen offers another press rather than
 * an ask nobody is there to answer.
 *
 * **It deliberately does not claim the matchmaking queue.** This entry point
 * touches nothing the queue owns, and the last test here proves it: the queue is
 * the one server-global the suite has to serialise around, and a second entry
 * quietly joining it would make every parallel run flaky in a way nothing points
 * at. A test that took the lock it does not need would hide exactly that.
 */
import { test, expect } from '@playwright/test'
import { T, getState, waitForTableOpen, gameBoard } from '../helpers/game'

/** Home screen → the bot form → a dealt hand. */
async function playBot(page: import('@playwright/test').Page, nickname: string) {
  await page.goto('/')
  await page.getByRole('button', { name: T.playBot }).click()
  await page.getByPlaceholder(T.yourNickname).fill(nickname)
  await page.getByRole('button', { name: T.playBotGo }).click()
  await expect(gameBoard(page)).toBeVisible({ timeout: 15_000 })
  await waitForTableOpen(page)
}

test.describe('1v1 against the server', () => {
  test('deals a hand from the home screen with nothing else to press', async ({ page }) => {
    await playBot(page, 'Alice')

    const s = await getState(page)
    expect(s?.screen).toBe('game')
    expect(s?.myHand ?? []).toHaveLength(8)
    expect(s?.players ?? []).toHaveLength(2)
    expect(s?.myIndex).toBe(0)
    // One round, like the queue's: the entry promised a hand now.
    expect(s?.matchFormat).toBe('BO1')
    // The identity rides game_started here, because this mode has no message in
    // front of it. Without these a reload could not reclaim the seat.
    expect(s?.roomCode ?? '').not.toBe('')
    expect(s?.sessionToken ?? '').not.toBe('')
    expect(s?.isSolo).toBe(true)
    expect(s?.isMatchmade).toBe(false)

    // No waiting room was ever shown, and the table's code is not offered to be
    // shared: there is nobody to share it with.
    expect(await page.getByRole('button', { name: T.startGame }).count()).toBe(0)
  })

  test('never joins the matchmaking queue', async ({ page }) => {
    // Read straight off the operator surface, which is the only place the
    // queue's size exists at all. No lock taken: if this mode enqueued anybody,
    // the number would move, and that is the whole assertion.
    const before = await queueSize(page)
    await playBot(page, 'Bob')
    expect(await queueSize(page)).toBe(before)
    expect(await soloMatches(page)).toBeGreaterThan(0)
  })

  test('offers another press at the end, never a rematch', async ({ page }) => {
    await playBot(page, 'Carol')
    await winSolo(page)

    // The other seat is the server, so there is nobody to agree with.
    await expect(page.getByRole('button', { name: T.rematch })).toHaveCount(0)
    await expect(page.getByRole('button', { name: T.playBotAgain })).toBeVisible()
    await expect(page.getByRole('button', { name: T.findMatch })).toBeVisible()

    const first = (await getState(page))?.roomCode
    await page.getByRole('button', { name: T.playBotAgain }).click()
    await expect(gameBoard(page)).toBeVisible({ timeout: 15_000 })
    await waitForTableOpen(page)
    const s = await getState(page)
    expect(s?.myHand ?? []).toHaveLength(8)
    expect(s?.roomCode).not.toBe(first)
  })
})

/** The queue's size, from /metrics — the one place it is readable. */
async function queueSize(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('http://localhost:8080/metrics')
  return (await res.json()).matchmaking_queue as number
}

async function soloMatches(page: import('@playwright/test').Page): Promise<number> {
  const res = await page.request.get('http://localhost:8080/metrics')
  return (await res.json()).matches_solo as number
}

/** Drives the human seat to a win so the table reaches game over. */
async function winSolo(page: import('@playwright/test').Page) {
  const { debugSetState, winWith, waitForRoundSummary, clickContinue, waitForGameOver } =
    await import('../helpers/game')
  await debugSetState(page, {
    hand: [{ color: 'red', kind: 'number', value: 7 }],
    hands: [{ playerIndex: 1, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
    discard: { color: 'red', kind: 'number', value: 5 },
    pendingDraw: 0,
    currentTurn: 0,
  })
  await winWith(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
  await waitForRoundSummary(page, 20_000)
  await clickContinue(page)
  await waitForGameOver(page, 30_000)
}
