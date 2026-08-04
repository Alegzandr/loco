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
 * and carries no state from the last. What these six cannot open their own of is
 * the queue — there is one per server, it is a FIFO, and a searcher from another
 * test arriving between this one's two is paired with one of them. So each test
 * claims it for the duration and gives it back, the way it would wait on a port.
 * That is a lock on a shared resource, not shared state: nothing crosses, no
 * order is implied, and a failure here does not abandon the rest.
 * See helpers/matchmakingQueue.ts.
 */
import { test, expect, Browser } from '@playwright/test'
import { claimMatchmakingQueue } from '../helpers/matchmakingQueue'
import {
  T,
  findMatch,
  waitForMatchmadeGame,
  getState,
  sendMsg,
  playCard,
  debugSetState,
  declareLoco,
} from '../helpers/game'

test.describe('1v1 matchmaking', () => {
  test('two searchers are paired and dealt in with nobody pressing start', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

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
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
    }
  })

  test('cancelling leaves the queue, so the next searcher is not paired with a ghost', async ({
    browser,
  }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

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
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
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
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

    try {
      await findMatch(page1, 'Alice')
      await findMatch(page2, 'Bob')
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      await sendMsg(page2, { type: 'leave_room' })

      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.matchOver === true,
        undefined,
        { timeout: 15_000 },
      )
      const s1 = await getState(page1)
      // Named as a forfeit, not as a win on points: nothing downstream may read
      // this as a victory on the cards.
      expect(s1.forfeitBy).toBe(1)

      // There is nobody left to agree with, so the screen does not sit there
      // offering a rematch that cannot complete: this player goes back into the
      // queue by default, and cancelling the search is the way out.
      await page1.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'searching',
        undefined,
        { timeout: 10_000 },
      )

      // The player who left is back at the front door.
      await page2.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'lobby',
        undefined,
        { timeout: 10_000 },
      )
    } finally {
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
    }
  })

  // A rematch between two strangers is an agreement. One offer waits; the second
  // one deals the same two in again, with no queue in between.
  test('a rematch needs both players and then deals them in again', async ({
    browser,
  }: { browser: Browser }) => {
    // The only test here that is dealt in twice, and being dealt in is the
    // expensive part: `waitForMatchmadeGame` waits out the match-found countdown
    // and then the map-loading gate, and the gate is real image downloads
    // through the dev server into a browser context with a cold cache. The
    // single-deal tests in this file sit around 23s against the default 30s;
    // two deals do not fit, and the failure reads as a bare timeout in the
    // `finally` with every assertion having passed. Raised deliberately rather
    // than by trimming what the test covers.
    test.setTimeout(90_000)

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

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
      // The winner is page1's only card, so the round is taken and the call
      // comes first (docs/rules.md §14.7).
      await declareLoco(page1)
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
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
    }
  })

  // Relaunching the search from a finished match, with the opponent still
  // sitting there: the automatic requeue above cannot cover this one, because
  // there is somebody left to agree with and the screen is doing nothing on its
  // own. It is also the seat being given up inside find_match, which is the half
  // no unit test can see.
  test('relaunching the search from a finished 1v1 gives the seat up and requeues', async ({
    browser,
  }: { browser: Browser }) => {
    // One deal, plus the map-loading gate on a cold cache: the same ~23s the
    // single-deal tests here sit at, with room for the requeue on top.
    test.setTimeout(60_000)

    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

    try {
      await findMatch(page1, 'Alice')
      await findMatch(page2, 'Bob')
      await waitForMatchmadeGame(page1)
      await waitForMatchmadeGame(page2)

      // Ended on the cards, both seats still there: a forfeit would empty the
      // table and the automatic requeue would be what we were watching.
      const { myIndex: mySeat } = await getState(page1)
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
      // The winner is page1's only card, so the round is taken and the call
      // comes first (docs/rules.md §14.7).
      await declareLoco(page1)
      await playCard(page1, winner)

      await page2.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
        undefined,
        { timeout: 20_000 },
      )

      await page2.getByRole('button', { name: T.searchAgain }).click()

      // Into the queue, never the lobby. Both screens are accepted on purpose:
      // the seat this press gives up is what leaves the other player alone, so
      // they requeue as well and the two can be handed each other again within
      // the same second. Pinning either page to 'searching' alone would be a
      // test that passes on how fast the queue happened to pair.
      const inQueue = () => {
        const s = window.__LOCO_E2E__?.getState?.()?.screen
        return s === 'searching' || s === 'matchfound'
      }
      await page2.waitForFunction(inQueue, undefined, { timeout: 10_000 })
      // And the seat really was given up: the player still at the table is on
      // their own, which is what puts them back in the queue too.
      await page1.waitForFunction(inQueue, undefined, { timeout: 10_000 })
    } finally {
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
    }
  })

  // A matchmade room has no host and no lobby: the controls that belong to one
  // are refused, and the UI never offers them in the first place.
  test('a matchmade match has no host controls', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()
    // The one server-global this suite contends on. See helpers/matchmakingQueue.ts.
    const queue = await claimMatchmakingQueue()

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
      // One string for both hostless shapes — a matchmade pair and a solo game
      // — because neither has anybody with standing over the table, and a player
      // can see which of the two they are in.
      expect((await getState(page1)).errorMsg).toContain('not available in this game')
    } finally {
      // The contexts go first: this test can end with somebody still searching,
      // and a searcher still in the queue when the next test claims it is
      // exactly the ghost the lock exists to prevent.
      await ctx1.close()
      await ctx2.close()
      queue.release()
    }
  })
})
