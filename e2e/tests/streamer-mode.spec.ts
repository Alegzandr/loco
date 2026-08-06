/**
 * streamer-mode.spec.ts
 *
 * The host's streamer mode is the table's, not their own screen's.
 *
 * A table code is one string shared by everybody who can see it, so a host
 * capturing their screen is exposed by the guest who left the waiting room up on
 * a second monitor. The switch therefore travels: the server holds one answer
 * per table and every seat blurs. This pins the part no unit test can — two real
 * clients, one switch, one broadcast — plus the two things that must *not*
 * happen: a guest's own preference is not touched, and nothing uncovers a
 * blurred code.
 */
import { test, expect, Browser, Page } from '@playwright/test'
import { createRoom, joinRoom, forceEnglish, waitForTableOpen } from '../helpers/game'

/** The element `<TableCode />` renders, whichever screen is printing it. */
function code(page: Page, roomCode: string) {
  return page.getByText(roomCode, { exact: true }).first()
}

/** Flip the host's streamer switch through the panel a player uses. */
async function toggleStreamerMode(page: Page) {
  await page.getByRole('button', { name: 'Preferences' }).first().click()
  await page.getByRole('switch', { name: 'Streamer mode' }).click()
  // Back out of the panel: the code underneath is what every assertion reads.
  await page.keyboard.press('Escape')
}

test.describe('streamer mode travels from the host to the table', () => {
  test("the host's switch blurs the code on the guest's screen", async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxHost = await browser.newContext()
    const ctxGuest = await browser.newContext()
    const host = await ctxHost.newPage()
    const guest = await ctxGuest.newPage()
    await forceEnglish(host)
    await forceEnglish(guest)

    try {
      const roomCode = await createRoom(host, 'Alice')
      await joinRoom(guest, 'Bob', roomCode)
      await waitForTableOpen(guest)

      // Nobody is streaming yet: both screens print the six characters.
      await expect(code(guest, roomCode)).not.toHaveAttribute('data-streamer-hidden', 'true')

      await toggleStreamerMode(host)

      await expect(code(guest, roomCode)).toHaveAttribute('data-streamer-hidden', 'true', {
        timeout: 5_000,
      })
      await expect(code(host, roomCode)).toHaveAttribute('data-streamer-hidden', 'true')

      // The guest's own switch was never touched, so the host stopping their
      // stream gives the code back rather than leaving the table half-hidden.
      await toggleStreamerMode(host)
      await expect(code(guest, roomCode)).not.toHaveAttribute('data-streamer-hidden', 'true', {
        timeout: 5_000,
      })
    } finally {
      await ctxHost.close()
      await ctxGuest.close()
    }
  })

  test('somebody who joins mid-stream arrives blurred', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxHost = await browser.newContext()
    const ctxGuest = await browser.newContext()
    const host = await ctxHost.newPage()
    const guest = await ctxGuest.newPage()
    await forceEnglish(host)
    await forceEnglish(guest)

    try {
      const roomCode = await createRoom(host, 'Alice')
      await toggleStreamerMode(host)
      await expect(code(host, roomCode)).toHaveAttribute('data-streamer-hidden', 'true')

      // Bob's own preference is off, and he still must not print the code: the
      // answer rides room_joined rather than waiting for the switch to move
      // again.
      await joinRoom(guest, 'Bob', roomCode)
      await waitForTableOpen(guest)

      await expect(code(guest, roomCode)).toHaveAttribute('data-streamer-hidden', 'true', {
        timeout: 5_000,
      })
    } finally {
      await ctxHost.close()
      await ctxGuest.close()
    }
  })

  test('nothing uncovers a blurred code', async ({ browser }: { browser: Browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    await forceEnglish(page)

    try {
      const roomCode = await createRoom(page, 'Alice')
      await toggleStreamerMode(page)

      const plate = code(page, roomCode)
      await expect(plate).toHaveAttribute('data-streamer-hidden', 'true')

      // Hover, then the keyboard, then the press that copies the link. Each of
      // these used to be a reveal, and each put the six characters back on a
      // capture. `filter` is what the blur is, so it is what the assertion reads.
      await plate.hover()
      await expect(plate).toHaveCSS('filter', /blur/)

      await page.keyboard.press('Tab')
      await expect(plate).toHaveCSS('filter', /blur/)

      await plate.click()
      await expect(plate).toHaveCSS('filter', /blur/)
    } finally {
      await ctx.close()
    }
  })
})
