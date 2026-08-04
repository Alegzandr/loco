/**
 * emotes.spec.ts
 *
 * The three fixed things a player can say, and the two refusals around them.
 *
 * Two browsers, because the whole point is that one of them says something and
 * the other one sees it. Self-contained, and no queue is touched.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  startGame,
  getState,
  debugSetState,
  winWith,
  waitForRoundSummary,
  clickContinue,
  waitForGameOver,
} from '../helpers/game'

test.describe('the three things', () => {
  test('one seat says it, the whole table sees it, and saying another replaces it', async ({
    browser,
  }) => {
    const hostCtx = await browser.newContext()
    const guestCtx = await browser.newContext()
    const host = await hostCtx.newPage()
    const guest = await guestCtx.newPage()

    const code = await createRoom(host, 'Alice')
    await joinRoom(guest, 'Bob', code)
    await startGame(host)

    // Nothing to say while the cards are out: the row does not exist yet.
    await expect(host.getByRole('button', { name: T.emoteGG })).toHaveCount(0)

    await debugSetState(host, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: [{ playerIndex: 1, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: 0,
    })
    await winWith(host, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
    await waitForRoundSummary(host, 20_000)
    await clickContinue(host)
    await waitForGameOver(host, 30_000)
    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
      undefined,
      { timeout: 30_000 },
    )

    await guest.getByRole('button', { name: T.emoteGG }).click()

    // It reaches the other side, named by seat and carried as an identifier.
    await host.waitForFunction(
      () => {
        const said = window.__LOCO_E2E__?.getState?.()?.emotes ?? []
        return said.length === 1 && said[0].seat === 1 && said[0].emote === 'gg'
      },
      undefined,
      { timeout: 10_000 },
    )
    await expect(host.locator('.emoteFeed')).toContainText(T.emoteGG)

    // A second press inside the cooldown is refused to its sender and reaches
    // nobody: what the seat is saying does not change.
    await guest.getByRole('button', { name: T.emoteNice }).click()
    await host.waitForTimeout(600)
    const during = (await getState(host))?.emotes ?? []
    expect(during).toHaveLength(1)
    expect(during[0].emote).toBe('gg')

    // Past the cooldown it is one line per seat, replaced: the second thing
    // said takes the first one's place rather than adding a bubble under it.
    await host.waitForTimeout(2000)
    await guest.getByRole('button', { name: T.emoteNice }).click()
    await host.waitForFunction(
      () => {
        const said = window.__LOCO_E2E__?.getState?.()?.emotes ?? []
        return said.length === 1 && said[0].seat === 1 && said[0].emote === 'nice'
      },
      undefined,
      { timeout: 10_000 },
    )
    await expect(host.locator('.emoteFeed')).toContainText(T.emoteNice)
    await expect(host.locator('.emoteFeed')).not.toContainText(T.emoteGG)

    await hostCtx.close()
    await guestCtx.close()
  })
})
