import { test, expect } from '@playwright/test'
import { forceEnglish, waitForSocket, T } from '../helpers/game'

/**
 * One tab holds the game.
 *
 * Every other test in this suite opens its clients with `browser.newPage()`,
 * which is a fresh context and therefore a fresh `localStorage` — two players,
 * two browsers, as far as anything here is concerned. This is the one file that
 * deliberately does the opposite, because sharing that storage is the whole
 * subject: it is what a real person does when they middle-click the game a
 * second time.
 *
 * What no unit test can reach is the part that matters: a real second document,
 * with its own module instances and its own socket to not open.
 */

test.describe('a second tab of the same browser', () => {
  test('says where the game is, and hands it over when asked', async ({ browser }) => {
    // One context, two tabs. Not `browser.newPage()`: that would be a second
    // browser and there would be nothing to test.
    const context = await browser.newContext()
    const first = await context.newPage()
    await forceEnglish(first)
    await first.goto('/')
    await first.waitForLoadState('domcontentloaded')
    await waitForSocket(first)

    const second = await context.newPage()
    await forceEnglish(second)
    await second.goto('/')
    await second.waitForLoadState('domcontentloaded')

    // The curtain, and no game behind it.
    await expect(second.getByText(T.tabTakenTitle)).toBeVisible()
    await expect(second.getByRole('button', { name: T.createRoom })).toHaveCount(0)
    // The proof the curtain is worth anything: the app was never mounted, so
    // there is no socket, no second entry in the 1v1 queue and no second player
    // in `players_online`.
    expect(await second.evaluate(() => window.__LOCO_E2E__?.getWsStatus?.())).toBeUndefined()

    await second.getByRole('button', { name: T.tabTakenTake }).click()

    // It arrives here...
    await waitForSocket(second)
    await expect(second.getByRole('button', { name: T.createRoom })).toBeVisible()
    // ...and it leaves there. Two owners would be the bug this whole mechanism
    // exists to prevent, so the handover has to be a move rather than a copy.
    await expect(first.getByText(T.tabTakenTitle)).toBeVisible()

    await context.close()
  })

  test('takes the game back when the tab holding it closes', async ({ browser }) => {
    const context = await browser.newContext()
    const first = await context.newPage()
    await forceEnglish(first)
    await first.goto('/')
    await first.waitForLoadState('domcontentloaded')
    await waitForSocket(first)

    const second = await context.newPage()
    await forceEnglish(second)
    await second.goto('/')
    await second.waitForLoadState('domcontentloaded')
    await expect(second.getByText(T.tabTakenTitle)).toBeVisible()

    // Nothing is pressed. A player who closes the tab they were playing in and
    // goes back to the one they left open must find a game there, not a curtain
    // asking them to claim something nobody is holding.
    await first.close()

    await expect(second.getByRole('button', { name: T.createRoom })).toBeVisible({
      timeout: 15_000,
    })
    await waitForSocket(second)

    await context.close()
  })
})
