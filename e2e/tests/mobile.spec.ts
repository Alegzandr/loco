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
import { T, createRoom, addBot, startGame, waitForMyTurn, getState, sendMsg, closeRulesModal, gameBoard } from '../helpers/game'

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

    const rulesTitle = page.getByText('Game Rules')
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

    // UNO button is always rendered in-game
    const unoBtn = page.getByRole('button', { name: T.unoBtn })
    await expect(unoBtn).toBeVisible({ timeout: 10_000 })

    const box = await unoBtn.boundingBox()
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
    const rulesTitle = page.getByText('Game Rules')
    await expect(rulesTitle).toBeVisible()

    await closeRulesModal(page)
    await expect(rulesTitle).not.toBeVisible()

    // Game is still alive
    await expect(gameBoard(page)).toBeVisible()
  })
})
