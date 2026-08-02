import { test, expect } from '@playwright/test'
import { createRoom, forceEnglish, waitForSocket, T } from '../helpers/game'

/**
 * The link a table is shared with.
 *
 * A code is six characters somebody has to read out, retype and not mistype;
 * the link removes all three steps. What it cannot carry is who is arriving, so
 * the one thing it may still ask for is a name, and only from a browser that
 * does not already have one.
 */

test.describe('joining on a table link', () => {
  test('asks the arriving player for a name, with the code already in', async ({ browser }) => {
    const host = await browser.newPage()
    const code = await createRoom(host, 'Alice')

    const guest = await browser.newPage()
    await forceEnglish(guest)
    await guest.goto(`/?t=${code}`)
    await guest.waitForLoadState('domcontentloaded')
    await waitForSocket(guest)

    // The join form, opened for them, with the only unknown left to fill.
    const codeField = guest.getByPlaceholder(T.roomCodeLabel)
    await expect(codeField).toHaveValue(code)
    // And the code is out of the address bar: a reload must not re-join, and a
    // copied URL must not keep carrying a table that has since closed.
    expect(new URL(guest.url()).search).toBe('')

    await guest.getByPlaceholder(T.yourNickname).fill('Bob')
    await guest.getByRole('button', { name: T.joinGame }).click()

    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 10_000 },
    )
    await expect(host.getByText('Bob')).toBeVisible()

    await guest.close()
    await host.close()
  })

  test('seats a browser that already knows the player’s name', async ({ browser }) => {
    const host = await browser.newPage()
    const code = await createRoom(host, 'Alice')

    const guest = await browser.newPage()
    await forceEnglish(guest)
    // What a previous visit would have left behind: the lobby writes it on
    // submit (hooks/nicknameMemory.ts).
    await guest.addInitScript(() => {
      try {
        window.localStorage.setItem('loco_nickname', 'Carol')
      } catch {
        // noop
      }
    })
    await guest.goto(`/?t=${code}`)

    await guest.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 10_000 },
    )
    await expect(host.getByText('Carol')).toBeVisible()

    await guest.close()
    await host.close()
  })
})
