import { test, expect } from '@playwright/test'
import { UI } from '../../client/src/content/ui'
import { LIVE } from '../../client/src/seo/meta'

/**
 * The live-streams page, met the way a crawler and a quiet evening both meet
 * it: with no channels to show.
 *
 * That is the state this shipped in and the one that has to hold up. The page
 * is prose first and a list second precisely because a list of who is streaming
 * right now is wrong tomorrow — so everything asserted here is served in the
 * markup, and none of it depends on the list ever arriving.
 *
 * Needs no Go server: nothing here opens a socket, and the list's own fetch is
 * allowed to fail. Self-contained, and it takes no shared resource — the
 * matchmaking queue least of all.
 */
test.describe('the live page, read without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('explains how to appear on it, in both languages', async ({ page }) => {
    for (const lang of ['en', 'fr'] as const) {
      await page.goto(LIVE.path[lang])
      const body = await page.locator('main').innerText()

      expect(body, `${lang}: heading`).toContain(UI.liveH1[lang])
      // The three steps are the point of the page for somebody who wants to be
      // on it: the category, streamer mode, and playing with a chat.
      expect(body, `${lang}: step 1`).toContain(UI.liveHowStep1[lang])
      expect(body, `${lang}: step 2`).toContain(UI.liveHowStep2[lang])
      expect(body, `${lang}: step 3`).toContain(UI.liveHowStep3[lang])
      // And what the game gives a stream, which is what somebody deciding
      // whether to bother reads first.
      expect(body, `${lang}: why`).toContain(UI.liveWhyH2[lang])
    }
  })

  // Two readers, one paragraph: somebody arriving when nobody is live, and
  // somebody whose browser runs no scripts. Neither is ever shown the word
  // "loading", and neither is left looking at an empty section.
  test('says what an empty list means rather than saying it is loading', async ({ page }) => {
    for (const lang of ['en', 'fr'] as const) {
      await page.goto(LIVE.path[lang])
      const section = page.locator('#liveNow')
      await expect(section).toHaveCount(1)
      await expect(section.locator('.liveNote')).toBeVisible()
      await expect(section.locator('.liveList')).toBeHidden()
      expect(await section.innerText()).toContain(UI.liveNowNote[lang])
    }
  })

  // The one link on the site that leaves for somewhere else. It carries the
  // attributes that make an outgoing link safe, and it is the only shape of
  // Twitch address anywhere in the served markup.
  test('links out to the category, and does it safely', async ({ page }) => {
    await page.goto(LIVE.path.en)
    const out = page.locator('#liveNow a[href^="https://www.twitch.tv/"]')
    await expect(out).toHaveCount(1)
    await expect(out).toHaveAttribute('rel', /noopener/)
    await expect(out).toHaveAttribute('rel', /noreferrer/)
    await expect(out).toHaveAttribute('target', '_blank')

    // No preview and no other asset is ever fetched from Twitch: img-src is
    // 'self', and the server is what talks to them.
    await expect(page.locator('img[src*="twitch"], img[src*="jtvnw"]')).toHaveCount(0)
  })

  test('declares itself in each language and points at the other', async ({ page }) => {
    for (const [lang, otherPath] of [
      ['en', LIVE.path.fr],
      ['fr', LIVE.path.en],
    ] as const) {
      await page.goto(LIVE.path[lang])
      await expect(page.locator('html')).toHaveAttribute('lang', lang)
      await expect(page.locator(`footer a[href$="${otherPath}"]`)).toHaveCount(1)
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1)
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    }
  })

  // It is in the navigation on every content page, which is what makes it
  // reachable by a reader who arrived somewhere else entirely.
  test('is in the site navigation', async ({ page }) => {
    await page.goto('/rules/')
    await expect(page.locator(`footer a[href$="${LIVE.path.en}"]`).first()).toHaveCount(1)
  })
})

/**
 * With scripts on, and still with nobody live: the list stays hidden and the
 * paragraph stays put. A page that swapped an explanation for an empty box the
 * moment JavaScript ran would be worse than one that never tried.
 */
test.describe('the live page, with the script running', () => {
  test('leaves the served paragraph in place when nobody is streaming', async ({ page }) => {
    await page.goto(LIVE.path.en)
    // The fetch either answers an empty list or fails; both end here.
    await expect(page.locator('#liveNow .liveNote')).toBeVisible()
    await expect(page.locator('#liveNow .liveList')).toBeHidden()
  })
})
