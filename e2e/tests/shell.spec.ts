import { test, expect, type Page } from '@playwright/test'

/**
 * The site and the game are one app (SvelteKit's router, `client/src/entry.ts`
 * parking the game across a navigation, one bar and one drawer for both
 * halves). What that promises a player, checked in the browser:
 *
 *  - moving between a content page and the game is a navigation, never a
 *    document load, and the site's bar is the same box on both sides;
 *  - the globe in that bar is on `/` too, and there it translates the page in
 *    place rather than navigating;
 *  - a table survives a trip to another page and back — one document, one
 *    socket, the same seat.
 *
 * Each test opens its own page and its own table; nothing is shared.
 */

/**
 * Waits for the router: until the page has hydrated a link is an ordinary
 * link, and a click on it is the full load this file exists to rule out. The
 * content page's mount reveals its back-to-top control, which is the signal.
 */
async function hydrated(page: Page): Promise<void> {
  await page.locator('.toTop:not([hidden])').waitFor({ state: 'attached' })
}

/** Counts documents loaded into the page from here on. */
function countLoads(page: Page): () => number {
  let loads = 0
  page.on('load', () => loads++)
  return () => loads
}

test.describe('one app', () => {
  test('goes from a content page to the game without a reload, and the bar stays put', async ({ page }) => {
    await page.goto('/rules/')
    await hydrated(page)
    const bar = page.locator('.siteFooter')
    await expect(bar).toBeVisible()
    const before = await bar.boundingBox()
    const loads = countLoads(page)

    await page.locator('.footerPlay').click()
    await page.waitForURL('/')
    await expect(page.getByRole('button', { name: /New table/ })).toBeVisible()
    expect(loads(), 'the move is a navigation, not a document load').toBe(0)

    // The same bar, in the same place, at the same height.
    const after = await page.locator('.siteFooter').boundingBox()
    expect(after!.y).toBeCloseTo(before!.y, 0)
    expect(after!.height).toBeCloseTo(before!.height, 0)
    // And it is the document of the page it shows.
    await expect(page.locator('body')).toHaveClass(/\bgame\b/)
    expect(await page.evaluate(() => document.documentElement.dataset.servedLang)).toBe('en')
  })

  test('changes language in place from the bar on the home page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /New table/ })).toBeVisible()
    const loads = countLoads(page)

    await page.locator('.siteFooter .langBtn').click()
    await page.locator('#langPop a[lang="fr"]').click()

    // The game, the bar and the address bar, together, with nothing reloaded.
    await expect(page.getByRole('button', { name: /Nouvelle table/ })).toBeVisible()
    await expect(page.locator('.footerRow a[href="/fr/regles/"]')).toBeVisible()
    await expect(page).toHaveURL(/\/fr\/$/)
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('fr')
    expect(loads()).toBe(0)
  })

  test('keeps a table across a trip to another page and back', async ({ page }) => {
    const sockets: string[] = []
    page.on('websocket', (ws) => sockets.push(ws.url()))
    await page.goto('/rules/')
    await hydrated(page)
    await page.locator('.footerPlay').click()
    await page.waitForURL('/')
    await page.getByRole('button', { name: /New table/ }).click()
    await page.getByPlaceholder(/Your name/i).fill('Shell')
    await page.getByRole('button', { name: /Open the table/ }).click()
    await page.waitForFunction(() => {
      const s = (window as unknown as { __LOCO_E2E__?: { getState(): { screen: string; roomCode: string } } })
        .__LOCO_E2E__?.getState()
      return s?.screen === 'waiting' && !!s.roomCode
    })
    const room = await page.evaluate(
      () => (window as unknown as { __LOCO_E2E__: { getState(): { roomCode: string } } }).__LOCO_E2E__.getState().roomCode,
    )

    // At a seat there is no site chrome: the way out is the browser's own Back.
    await expect(page.locator('.siteFooter')).toBeHidden()
    await page.goBack()
    await page.waitForURL('/rules/')
    await expect(page.locator('.siteHeader')).toBeVisible()
    // The page being read is a page to read: not seated, selectable, the bar back.
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-seated'))).toBe(false)
    await expect(page.locator('.siteFooter')).toBeVisible()

    await page.goForward()
    await page.waitForURL('/')
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __LOCO_E2E__: { getState(): { screen: string; roomCode: string } } }).__LOCO_E2E__.getState(),
        ),
      )
      .toMatchObject({ screen: 'waiting', roomCode: room })
    await expect.poll(() => page.evaluate(() => document.documentElement.hasAttribute('data-seated'))).toBe(true)
    // The game's socket only: the dev server opens one of its own for hot reload.
    expect(sockets.filter((u) => u.endsWith('/ws')), 'one socket for the whole trip').toHaveLength(1)
  })
})
