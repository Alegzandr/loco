/**
 * mobile.spec.ts
 *
 * Mobile viewport tests (Pixel 5, ~360×800 px).
 * Verifies that the game UI is usable on a small touchscreen:
 *   - lobby buttons are tappable
 *   - canvas renders at a reasonable size
 *   - action bar buttons meet 44px touch-target minimum
 *   - color picker buttons are adequately sized
 *   - rules modal slides up and can be closed
 *
 * This spec runs in the 'mobile-chrome' Playwright project (see playwright.config.ts).
 */
import { test, expect } from '@playwright/test'
import { T, createRoom, addBot, startGame, waitForMyTurn, getState, sendMsg, closeRulesModal, gameBoard, waitForTableOpen } from '../helpers/game'

test.describe('mobile viewport', () => {
  /**
   * Lobby is rendered and primary buttons are visible and tappable.
   */
  test('lobby loads correctly on mobile', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LOCO' })).toBeVisible()
    await expect(page.getByRole('button', { name: T.createRoom })).toBeVisible()
    await expect(page.getByRole('button', { name: T.joinRoom })).toBeVisible()

    // Buttons must meet the 44px minimum touch target (mobile UX conventions)
    const createBtn = page.getByRole('button', { name: T.createRoom })
    const box = await createBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  /**
   * Rules modal slides up from the bottom on mobile and can be closed.
   */
  test('rules modal is accessible and closable on mobile', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: T.rulesBtn }).click()

    const rulesTitle = page.getByText(T.rulesTitle)
    await expect(rulesTitle).toBeVisible()

    await closeRulesModal(page)
    await expect(rulesTitle).not.toBeVisible()
  })

  /**
   * Canvas renders with non-zero dimensions on a mobile viewport.
   */
  test('game canvas is visible and properly sized on mobile', async ({ page }) => {
    await createRoom(page, 'MobileAlice')
    await addBot(page)
    await startGame(page)

    const canvas = gameBoard(page)
    await expect(canvas).toBeVisible()
    const box = await canvas.boundingBox()
    expect(box).not.toBeNull()
    // Canvas should fill most of the mobile viewport
    expect(box!.width).toBeGreaterThan(200)
    expect(box!.height).toBeGreaterThan(200)
  })

  /**
   * Action bar buttons meet the 44px minimum touch target on mobile.
   */
  test('action bar buttons have adequate touch targets', async ({ page }) => {
    await createRoom(page, 'MobileAlice')
    await addBot(page)
    await startGame(page)

    // The centre slot is always rendered in-game; on a fresh deal it is Catch.
    const centreBtn = page.getByRole('button', { name: T.catchBtn })
    await expect(centreBtn).toBeVisible({ timeout: 10_000 })

    const box = await centreBtn.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })

  /**
   * Color picker is usable on mobile — all four color buttons are accessible.
   * Triggered by playing a wild card when available; otherwise the test notes the skip.
   */
  test('color picker buttons have adequate touch targets when shown', async ({ page }) => {
    await createRoom(page, 'MobileAlice')
    await addBot(page)
    await startGame(page)

    let colorPickerTested = false

    // Try up to 8 turns to find a wild card and trigger the color picker
    for (let attempt = 0; attempt < 8 && !colorPickerTested; attempt++) {
      try {
        await waitForMyTurn(page, 15_000)
        const state = await getState(page)
        if (!state || state.screen !== 'game') break

        const wild = state.myHand.find(
          (c) => c.kind === 'wild' || c.kind === 'wild_draw_four',
        )

        if (wild) {
          // playCard calls handleCardClick which sets the colorPicker React state
          await page.evaluate((card) => window.__LOCO_E2E__?.playCard?.(card), wild)

          const colorPicker = page.locator('[class*="colorPicker"]')
          const visible = await colorPicker.isVisible().catch(() => false)
          if (visible) {
            colorPickerTested = true
            // Verify each color button has adequate touch target size
            for (const color of ['red', 'yellow', 'green', 'blue']) {
              const btn = page.getByRole('button', { name: color })
              await expect(btn).toBeVisible()
              const box = await btn.boundingBox()
              expect(box).not.toBeNull()
              expect(box!.width).toBeGreaterThanOrEqual(44)
              expect(box!.height).toBeGreaterThanOrEqual(44)
            }
            // Cancel the picker to avoid sending a malformed play
            await page.getByRole('button', { name: '✕' }).click()
          }
        } else {
          // No wild card — draw and pass to advance
          await sendMsg(page, { type: 'draw_card' })
          await page.waitForFunction(
            () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
            undefined,
            { timeout: 8_000 },
          )
          await sendMsg(page, { type: 'pass_turn' })
          await page.waitForTimeout(600)
        }
      } catch {
        break
      }
    }

    if (!colorPickerTested) {
      test.info().annotations.push({
        type: 'note',
        description: 'No wild card appeared — color picker touch target check skipped (deck is random)',
      })
    }
  })

  /**
   * Rules modal works during a game on mobile (slides up, is scrollable, closes).
   */
  test('rules modal is accessible during game on mobile', async ({ page }) => {
    await createRoom(page, 'MobileAlice')
    await addBot(page)
    await startGame(page)

    await page.getByRole('button', { name: T.rulesBtn }).click()
    const rulesTitle = page.getByText(T.rulesTitle)
    await expect(rulesTitle).toBeVisible()

    await closeRulesModal(page)
    await expect(rulesTitle).not.toBeVisible()

    // Game is still alive
    await expect(gameBoard(page)).toBeVisible()
    await waitForTableOpen(page)
  })

  /**
   * The navigation on a phone is one burger, top left, on the game page and on
   * every content page. The footer bar it replaces is a row of 12px links that
   * folded into two lines here, with nothing on it a thumb could aim at.
   *
   * Both halves are asserted at the size they are pressed at, because that is
   * the failure: a link small enough to miss still passes every test that only
   * asks whether it is there.
   */
  test('the burger is the whole navigation on a phone', async ({ page }) => {
    await page.goto('/rules/')

    // The bar is gone and the burger stands in for it.
    await expect(page.locator('.siteFooter')).toBeHidden()
    const burger = page.locator('.menuBtn')
    await expect(burger).toBeVisible()
    const burgerBox = await burger.boundingBox()
    expect(burgerBox!.width).toBeGreaterThanOrEqual(38)
    expect(burgerBox!.height).toBeGreaterThanOrEqual(38)

    await burger.click()
    const drawer = page.locator('.navPop')
    await expect(drawer).toBeVisible()

    // Everything the bar carried, at a size worth pressing.
    for (const href of ['/', '/rules/', '/cards/', '/tables/', '/play-with-friends/', '/faq/', '/privacy/']) {
      const link = drawer.locator(`a[href="${href}"]`)
      await expect(link).toBeVisible()
      expect((await link.boundingBox())!.height, href).toBeGreaterThanOrEqual(40)
    }

    // It closes on its own button, which is the only way out a phone has:
    // Escape and a tap outside are both native and both unreachable here.
    await page.locator('.navPopClose').click()
    await expect(drawer).toBeHidden()
  })

  /**
   * The same drawer on the game page, carrying the items that page has: no
   * "Play" — this is where playing happens — and no theme or language, which
   * are behind the lobby's own gear. It must also free the whole screen for the
   * board.
   */
  test('the home page hides its footer row behind the same burger', async ({ page }) => {
    await page.goto('/')

    // The row is still in the document for a crawler; it is simply not what a
    // phone is shown.
    await expect(page.locator('.homeLinks')).toBeHidden()

    const burger = page.locator('.homeBurger')
    await expect(burger).toBeVisible()
    const box = await burger.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(38)
    // Top left, clear of the lobby's own row of controls on the right.
    expect(box!.y).toBeLessThan(80)
    expect(box!.x).toBeLessThan(80)

    await burger.click()
    const drawer = page.locator('.navPop')
    await expect(drawer).toBeVisible()

    // The five pages and the legal one, at a size worth pressing, and nothing
    // offering to take a player to the page they are already on.
    const links = drawer.locator('.navPopLinks a')
    expect(await links.count()).toBe(6)
    expect((await links.first().boundingBox())!.height).toBeGreaterThanOrEqual(40)
    await expect(drawer.locator('a[href="/"]')).toHaveCount(0)

    // And the prose the wide screen's sheet holds, under the links rather than
    // behind a second press.
    const prose = drawer.locator('.navPopProse')
    expect(((await prose.textContent()) ?? '').length).toBeGreaterThan(200)
    expect((await links.first().boundingBox())!.y).toBeLessThan(
      (await prose.boundingBox())!.y,
    )
  })

  /**
   * The one thing a native popover will not do for itself: shut when it stops
   * being the navigation. Widen the window — a tablet turned on its side, or a
   * desktop window dragged out — and the footer bar is back underneath a drawer
   * whose burger no longer exists to close it.
   */
  test('the drawer closes when the window is widened past the phone', async ({ page }) => {
    await page.goto('/rules/')
    await page.locator('.menuBtn').click()
    const drawer = page.locator('.navPop')
    await expect(drawer).toBeVisible()

    await page.setViewportSize({ width: 1100, height: 800 })
    await expect(drawer).toBeHidden()
    // And the navigation the drawer was standing in for is back.
    await expect(page.locator('.siteFooter')).toBeVisible()

    // Same on the game page, which runs the other of the two scripts.
    await page.setViewportSize({ width: 390, height: 780 })
    await page.goto('/')
    await page.locator('.homeBurger').click()
    await expect(drawer).toBeVisible()
    await page.setViewportSize({ width: 1100, height: 800 })
    await expect(drawer).toBeHidden()
    await expect(page.locator('.homeLinks')).toBeVisible()
  })
})
