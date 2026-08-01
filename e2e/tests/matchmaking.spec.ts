/**
 * matchmaking.spec.ts
 *
 * The 1v1 queue, end to end: two independent browsers ask for a game, get each
 * other, and are dealt in without anybody pressing start.
 *
 * The two things worth an E2E here are the two that no unit test can reach: the
 * pairing itself (it needs two real sockets and the server's own queue), and
 * the abandon path, which is the whole reason this mode has its own timings.
 *
 * Self-contained like every test in this suite: each one opens its own contexts
 * and carries no state from the last.
 */
import { test, expect, Browser } from '@playwright/test'
import {
  T,
  findMatch,
  waitForMatchmadeGame,
  getState,
  sendMsg,
  playCard,
  debugSetState,
} from '../helpers/game'

test.describe('1v1 matchmaking', () => {
  test('two searchers are paired and dealt in with nobody pressing start', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await findMatch(page1, 'Alice')
      // The first searcher waits: the screen says so and offers nothing else.
      await expect(page1.getByText(T.searchTitle)).toBeVisible()

      await findMatch(page2, 'Bob')

      // Both get the reveal, and it names the other player.
      await expect(page1.getByText(T.matchFoundKicker)).toBeVisible({ timeout: 10_000 })
      await expect(page1.getByText('Bob')).toBeVisible()
      await expect(page2.getByText('Alice')).toBeVisible()

      // And then the match deals itself.
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      const s1 = await getState(page1)
      const s2 = await getState(page2)
      expect(s1.players).toHaveLength(2)
      // One round, decided now: what somebody who queued to play came for.
      expect(s1.matchFormat).toBe('BO1')
      expect(s1.maxPlayers).toBe(2)
      expect(s1.myHand.length).toBeGreaterThan(0)
      expect(s2.myHand.length).toBeGreaterThan(0)
      // One seat each, and they are not the same one.
      expect(s1.myIndex).not.toBe(s2.myIndex)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('cancelling leaves the queue, so the next searcher is not paired with a ghost', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await findMatch(page1, 'Alice')
      await page1.getByRole('button', { name: T.searchCancel }).click()
      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'lobby',
        undefined,
        { timeout: 10_000 },
      )

      await findMatch(page2, 'Bob')
      // Bob keeps waiting: there is nobody in the queue to give him.
      await page2.waitForTimeout(1_500)
      expect((await getState(page2)).screen).toBe('searching')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // The frustrating case the mode's timings exist for. A player who quits ends
  // the match on the spot: the one still at the table is told, rather than left
  // playing against a seat that auto-passes every turn.
  test('quitting hands the match to the player who stayed', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await findMatch(page1, 'Alice')
      await findMatch(page2, 'Bob')
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      await sendMsg(page2, { type: 'leave_room' })

      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
        undefined,
        { timeout: 15_000 },
      )
      const s1 = await getState(page1)
      expect(s1.matchOver).toBe(true)
      // Named as a forfeit, not as a win on points: the screen has to be able to
      // say what happened.
      expect(s1.forfeitBy).toBe(1)
      await expect(page1.getByText(T.forfeitWon)).toBeVisible()
      // And the way out is another opponent, not a rematch with somebody who left.
      await expect(page1.getByRole('button', { name: T.findAnotherOpponent })).toBeVisible()

      // The player who left is back at the front door.
      await page2.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'lobby',
        undefined,
        { timeout: 10_000 },
      )
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // A rematch between two strangers is an agreement. One offer waits; the second
  // one deals the same two in again, with no queue in between.
  test('a rematch needs both players and then deals them in again', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await findMatch(page1, 'Alice')
      await findMatch(page2, 'Bob')
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      // End the match with both players still seated: a forfeit would remove the
      // opponent, and there would be nobody left to agree with.
      const { roomCode, myIndex: mySeat } = await getState(page1)
      expect(roomCode).not.toBe('')
      // The fixture states everything the assertion rests on, including which
      // seat page1 actually drew: the pairing decides that, not the test.
      const winner = { color: 'red', kind: 'number', value: 5 }
      await debugSetState(page1, {
        hands: [
          { playerIndex: mySeat, hand: [winner] },
          { playerIndex: 1 - mySeat, hand: [{ color: 'blue', kind: 'number', value: 9 }] },
        ],
        discard: { color: 'red', kind: 'number', value: 3 },
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: mySeat,
        direction: 1,
      })
      await playCard(page1, winner)

      for (const page of [page1, page2]) {
        await page.waitForFunction(
          () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
          undefined,
          { timeout: 20_000 },
        )
      }

      // One offer: the other side is told, and nothing is dealt.
      await page1.getByRole('button', { name: T.rematch }).click()
      await expect(page2.getByRole('button', { name: T.rematchAccept })).toBeVisible({
        timeout: 10_000,
      })
      expect((await getState(page1)).screen).toBe('gameover')

      // The second one deals the same pair again.
      await page2.getByRole('button', { name: T.rematchAccept }).click()
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)
      const s1 = await getState(page1)
      expect(s1.roomCode).toBe(roomCode)
      expect(s1.myHand.length).toBeGreaterThan(0)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // A matchmade room has no host and no lobby: the controls that belong to one
  // are refused, and the UI never offers them in the first place.
  test('a matchmade match has no host controls', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      await findMatch(page1, 'Alice')
      await findMatch(page2, 'Bob')
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      await sendMsg(page1, { type: 'add_bot' })
      await page1.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
        undefined,
        { timeout: 10_000 },
      )
      expect((await getState(page1)).errorMsg).toContain('matchmade')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
