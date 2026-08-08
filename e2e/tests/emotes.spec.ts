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

    // Straight away, with no cooldown to wait out: a seat changes its mind as
    // often as it likes, and it is one line per seat, replaced — the second
    // thing said takes the first one's place rather than adding a bubble under
    // it, which is why the card's height is the table's size and nothing under
    // the thumb moves.
    await guest.getByRole('button', { name: T.emoteLucky }).click()
    await host.waitForFunction(
      () => {
        const said = window.__LOCO_E2E__?.getState?.()?.emotes ?? []
        return said.length === 1 && said[0].seat === 1 && said[0].emote === 'lucky'
      },
      undefined,
      { timeout: 10_000 },
    )
    await expect(host.locator('.emoteFeed')).toContainText(T.emoteLucky)
    await expect(host.locator('.emoteFeed')).not.toContainText(T.emoteGG)

    await hostCtx.close()
    await guestCtx.close()
  })
})
