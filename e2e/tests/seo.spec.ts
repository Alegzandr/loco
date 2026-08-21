import { test, expect } from '@playwright/test'
import { CONTRASTS } from '../../client/src/content/contrasts'
import { en } from '../../client/src/i18n/en'
import { fr } from '../../client/src/i18n/fr'

/**
 * The indexable surface, checked the way a crawler meets it.
 *
 * Every test here runs with **JavaScript disabled**, which is the whole point:
 * the content pages are built to be readable without running a script, and
 * nothing else in the repo can prove that. A unit test reads sources, and the
 * rest of this suite drives an app that only exists once React has mounted.
 *
 * These need no Go server: they never open a socket.
 */

// A context with scripts off. `test.use` applies to the file, so the last case —
// which does need the game to boot — lives in its own describe block below.
test.describe('read without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('the rules page carries every rule, in English', async ({ page }) => {
    await page.goto('/rules/')
    const body = await page.locator('main').innerText()

    for (const section of en.rules) {
      expect(body, `heading: ${section.heading}`).toContain(section.heading)
      for (const item of section.items) {
        // Whole sentences, not keywords: a page that dropped half a rule would
        // still contain every heading.
        expect(body, `rule: ${item.slice(0, 45)}`).toContain(item)
      }
    }
  })

  test('the rules page carries every rule, in French', async ({ page }) => {
    await page.goto('/fr/regles/')
    const body = await page.locator('main').innerText()

    for (const section of fr.rules) {
      expect(body, `titre : ${section.heading}`).toContain(section.heading)
      for (const item of section.items) {
        expect(body, `règle : ${item.slice(0, 45)}`).toContain(item)
      }
    }
  })

  // The delta a visitor arrived looking for, above the rules rather than spread
  // through them — and served rather than mounted, because the reader who needs
  // it most is the one who has not decided to load anything yet.
  test('the rules page opens on what is different, in both languages', async ({ page }) => {
    for (const [url, lang] of [['/rules/', 'en'], ['/fr/regles/', 'fr']] as const) {
      await page.goto(url)
      const body = await page.locator('main').innerText()
      for (const line of CONTRASTS) {
        expect(body, `${lang}: ${line[lang].slice(0, 45)}`).toContain(line[lang])
      }
      // Above the first rule section, which is the whole point of it.
      const first = body.indexOf(CONTRASTS[0][lang])
      const rules = body.indexOf((lang === 'fr' ? fr : en).rules[0].heading)
      expect(first, `${lang}: the block comes first`).toBeLessThan(rules)
    }
  })

  test('the rules page names every card and totals the deck', async ({ page }) => {
    await page.goto('/rules/')
    const body = await page.locator('main').innerText()
    for (const name of Object.values(en.cardNames)) {
      expect(body, `card: ${name}`).toContain(name)
    }
    expect(body, 'the deck total').toContain('112')
  })

  test('each language declares itself and points at the other', async ({ page }) => {
    for (const [url, lang, otherPath] of [
      ['/rules/', 'en', '/fr/regles/'],
      ['/fr/regles/', 'fr', '/rules/'],
    ] as const) {
      await page.goto(url)
      await expect(page.locator('html')).toHaveAttribute('lang', lang)

      // A real link, not an in-app toggle: it is the href that makes the
      // hreflang pair navigable, and a crawler only follows hrefs.
      const link = page.locator(`footer a[href$="${otherPath}"]`)
      await expect(link).toHaveCount(1)

      // Reciprocal alternates plus exactly one x-default. Google drops a set
      // whose pages do not point back at each other.
      const alts = page.locator('link[rel="alternate"]')
      await expect(alts).toHaveCount(3)
      await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveCount(1)
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(1)
    }
  })

  test('the cards page draws the deck rather than describing it', async ({ page }) => {
    await page.goto('/cards/')

    // 36 numbers + 16 actions + 3 wilds: the whole deck without its duplicates.
    // Counted by row children rather than by <svg>, because one card draws
    // several (the face, and a glyph on the ones that have one).
    await expect(page.locator('main .cardRow > *')).toHaveCount(36 + 16 + 3)

    // The art is the game's own React component rendered at build time, so it
    // has to already be in the document rather than mounted later — and this
    // page runs with scripts off, so nothing could mount it.
    //
    // Probed on the art layer rather than on <svg>: a card face is CSS
    // gradients plus a shared mask image now, and only the rule cards still
    // carry an SVG glyph. Counting <svg> would pass on a page showing 28 glyphs
    // over 55 blank cards, which is precisely the failure this guards.
    await expect(page.locator('main .cardRow [style*="--mark-mask"]'))
      .toHaveCount(36 + 16 + 3)

    const body = await page.locator('main').innerText()
    for (const name of Object.values(en.cardNames)) {
      if (name === 'Number') continue // the group has its own heading
      expect(body, `card: ${name}`).toContain(name)
    }
  })

  test('the tables page shows all four rooms', async ({ page }) => {
    await page.goto('/tables/')
    const body = await page.locator('main').innerText()
    for (const id of ['neon', 'rune', 'velvet', 'orbit'] as const) {
      expect(body, `room: ${id}`).toContain(en.maps[id].name)
      expect(body, `tagline: ${id}`).toContain(en.maps[id].tagline)
    }
    // Room plus table for each: the page composites them exactly as the board
    // does, so a missing one is a room with no table in it.
    await expect(page.locator('main img')).toHaveCount(8)
  })

  test('the FAQ answers every question it declares to a search engine', async ({ page }) => {
    await page.goto('/faq/')
    const body = await page.locator('main').innerText()

    const raw = await page.locator('script[type="application/ld+json"]').innerText()
    const ld = JSON.parse(raw) as {
      '@graph': {
        '@type': string
        mainEntity?: { name: string; acceptedAnswer: { text: string } }[]
      }[]
    }
    // FAQPage is the one structured-data type here that can put content straight
    // into a result, so the data and the page have to be the same questions. It
    // sits in the same @graph every other page emits — joined to the site and
    // the game by @id, and carrying the breadcrumb they all carry.
    const faq = ld['@graph'].find((n) => n['@type'] === 'FAQPage')
    expect(faq, 'the FAQ page must declare an FAQPage node').toBeDefined()
    expect(ld['@graph'].some((n) => n['@type'] === 'BreadcrumbList')).toBe(true)
    expect(faq!.mainEntity!.length).toBeGreaterThan(5)
    for (const q of faq!.mainEntity!) {
      expect(body, `question: ${q.name}`).toContain(q.name)
      expect(q.acceptedAnswer.text.length, `answer to: ${q.name}`).toBeGreaterThan(40)
    }
  })

  test('the friends page leads with the three steps', async ({ page }) => {
    await page.goto('/play-with-friends/')
    // Ordered, and there are three: the order is the answer for somebody trying
    // to get a game going right now.
    await expect(page.locator('main ol.steps > li')).toHaveCount(3)
  })

  test('the home page carries one heading, and it is not the logo', async ({ page }) => {
    await page.goto('/')
    // With scripts off nothing has mounted, so this is exactly what a crawler
    // reads: for a long time it was a page with no heading at all, because the
    // only <h1> was one the lobby rendered and the visible title is a drawing.
    const h1 = page.locator('h1')
    await expect(h1).toHaveCount(1)
    const text = ((await h1.textContent()) ?? '').trim()
    expect(text.length, 'the heading has to say what the page is').toBeGreaterThan(20)
    // Both spellings: the name grew a mark, and a heading that is only the name
    // is the wordmark again either way.
    expect(text, 'a heading reading "LOCO!" is the wordmark again').not.toBe('LOCO!')
    expect(text, 'a heading reading "LOCO" is the wordmark again').not.toBe('LOCO')
    // Off the screen, in the accessibility tree: clipped, never display:none.
    await expect(h1).toHaveClass(/sr-only/)
  })

  test('the home page says what the game is, and links to the rest', async ({ page }) => {
    await page.goto('/')
    // In the served HTML: with scripts off nothing has mounted, so anything
    // readable here is what a crawler gets. The prose sits inside the sheet,
    // which is markup either way — hence textContent rather than innerText.
    const intro = page.locator('.homeIntro')
    await expect(intro).toBeVisible()
    expect(((await page.locator('.homeSheetCard').textContent()) ?? '').length)
      .toBeGreaterThan(200)

    // The only links from `/` to the content pages, and they are in the open:
    // the sitemap lists them, but a link is what carries weight between them.
    //
    // `.homeLinks`, not `.homeIntro`: the same links are rendered a second time
    // inside the drawer, which is the phone's menu. Only one of the two is ever
    // on screen — this project runs at a desktop viewport, so it is this one —
    // and both are built from `NAV`, so neither can lose a page on its own.
    //
    // Privacy closes the list rather than standing off at the right-hand end,
    // which is why it is in this loop: held apart it was a second navigation of
    // one item, and the row had two centres.
    for (const href of [
      '/rules/',
      '/cards/',
      '/tables/',
      '/play-with-friends/',
      '/live/',
      '/faq/',
      '/privacy/',
    ]) {
      await expect(page.locator(`.homeLinks a[href="${href}"]`)).toBeVisible()
      await expect(page.locator(`.navPopLinks a[href="${href}"]`)).toHaveCount(1)
    }
  })

  test('the home page never scrolls, and the prose opens without a script', async ({ page }) => {
    await page.goto('/')
    // The complaint this replaced: text parked under the fold. Nothing on this
    // page is reached by scrolling, at the lobby or in a match.
    const scrolls = () =>
      page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1)
    expect(await scrolls()).toBe(false)

    // <details> is why: it opens with scripts disabled, which is the state this
    // whole describe block runs in.
    await expect(page.locator('.homeSheetCard')).toBeHidden()
    await page.locator('.homeSheetBtn').click()
    await expect(page.locator('.homeSheetCard')).toBeVisible()
    expect(await scrolls()).toBe(false)
  })

  test('the footer is gone once a seat is taken', async ({ page }) => {
    await page.goto('/')
    // App writes this attribute (see appSubscription.test.tsx); this is the CSS
    // half of the same contract. A board that scrolls off-screen mid-match is
    // what it prevents.
    await page.evaluate(() => document.documentElement.setAttribute('data-seated', '1'))
    await expect(page.locator('.homeIntro')).toBeHidden()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
  })

  test('the pages are reachable from one another without scripts', async ({ page }) => {
    // The nav is the only path a crawler has from the game to the rules.
    await page.goto('/')
    // The game page is the app shell, so the crawl starts at a content page and
    // has to be able to get back to the game.
    await page.goto('/rules/')
    await expect(page.locator('header a[href="/"]')).not.toHaveCount(0)
  })

  test('every content page carries the whole navigation in its footer bar', async ({ page }) => {
    // The same row the home page has, on every page: a reader who followed a
    // link from `/` finds the other four where they left them, and a crawler
    // that landed on one page can reach the rest without going back.
    await page.goto('/faq/')
    for (const href of ['/rules/', '/cards/', '/tables/', '/play-with-friends/', '/faq/']) {
      await expect(page.locator(`footer nav a[href="${href}"]`), href).toBeVisible()
    }
    // And "Play", where the home page's sheet button stands.
    await expect(page.locator('footer a[href="/"]')).toBeVisible()
  })

  test('the language chooser opens and closes without a script', async ({ page }) => {
    await page.goto('/rules/')
    const panel = page.locator('#langPop')
    // Scoped to the bar: there is a second globe in the mobile drawer, which is
    // the same navigation at a width this project never runs at.
    // A native popover: the button opens it, Escape closes it, and this whole
    // describe block runs with JavaScript disabled. `<dialog>` would need one.
    await expect(panel).toBeHidden()
    await page.locator('.siteFooter .langBtn').click()
    await expect(panel).toBeVisible()
    // The other language is a real link inside it, not a toggle.
    await expect(panel.locator('a[href="/fr/regles/"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // And the way out a phone has: no Escape key, and no outside to click that
    // is not also a link. `popovertargetaction="hide"` is native too, which is
    // the only reason it works in this JavaScript-disabled block.
    await page.locator('.siteFooter .langBtn').click()
    await expect(panel).toBeVisible()
    await panel.locator('.langPopClose').click()
    await expect(panel).toBeHidden()
  })

  test('a content page never scrolls sideways', async ({ page }) => {
    // The deck table and the rows of cards are wider than a phone and scroll
    // inside their own box. The page itself doing it is the bug.
    await page.setViewportSize({ width: 390, height: 844 })
    for (const url of ['/rules/', '/cards/', '/fr/tables/']) {
      await page.goto(url)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
      expect(overflows, url).toBe(false)
    }
  })

  test('an unknown page is not the game with a 200 on it', async ({ page }) => {
    // The dev server has no nginx behind it, so the status code is nginx's job
    // and is asserted in seo.test.ts. What is checked here is the other half: a
    // 404 page exists, says so, and refuses indexing.
    await page.goto('/404.html')
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(1)
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0)
    await expect(page.locator('h1')).not.toBeEmpty()
  })
})

test.describe('with JavaScript, it is still the game', () => {
  test('the theme switch follows the reader from page to page', async ({ page }) => {
    await page.goto('/rules/')
    const button = page.locator('.siteFooter .themeBtn')
    // Hidden in the markup and revealed by theme-boot: a switch that cannot
    // store a choice is a button that does nothing.
    await expect(button).toBeVisible()

    const theme = async () => page.locator('html').getAttribute('data-theme')
    const before = await theme()
    await button.click()
    expect(await theme()).not.toBe(before)

    // There are two of these — one in the bar, one in the drawer — and they are
    // painted together, so the one in the drawer is already showing the theme
    // the reader is on by the time they open it.
    await expect(page.locator('.navPop .themeBtn')).toHaveAttribute(
      'data-theme-state',
      (await theme())!,
    )

    // Stored under the key `src/theme.ts` reads, so the choice survives the walk
    // back to the game as well as the walk to the next page.
    const chosen = await theme()
    await page.goto('/faq/')
    expect(await theme()).toBe(chosen)
    expect(await page.evaluate(() => localStorage.getItem('loco_theme'))).toBe(chosen)
  })


  test('the home page boots the app', async ({ page }) => {
    await page.goto('/')
    // The lobby's tagline only exists once React has mounted, so this is the
    // proof that turning the site into pages did not turn the game into one.
    await expect(page.locator('#root')).toContainText(en.tagline, { timeout: 15_000 })
  })
})

/**
 * Arriving without having said anything.
 *
 * `/` is the root and the canonical English page at once, which is what makes it
 * the one URL a browser setting is allowed to decide anything at. A device set
 * to French gets the French game, under a French footer, at `/fr/` — and none of
 * it is a round trip: the served markup carries both languages and
 * `src/langSwap.ts` walks it. Nothing is written to storage, because a detection
 * that stored itself would become a choice and outrank every French link this
 * player is sent afterwards.
 */
test.describe('a browser that asks for French', () => {
  test.use({ locale: 'fr-FR' })

  test('opens the root in French, without a round trip', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('#root')).toContainText(fr.tagline, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/fr\/$/)

    // The half Astro served moved too, links included — that is the half with no
    // second chance, since a content page mounts nothing. Both renderings of the
    // navigation are in this footer, the row and the drawer, so the assertion
    // that means anything is that neither leaks: nothing still points at an
    // English page.
    await expect(page.locator('footer a[href="/rules/"]')).toHaveCount(0)
    await expect(page.locator('footer a[href="/fr/regles/"]').first()).toBeVisible()
    await expect(page.locator('footer')).toContainText('Confidentialité')

    // But the document is still the one that was served: `data-served-lang` says
    // what the page was built as, and a reload is what fetches the real French
    // one. Nothing recorded a choice on the player's behalf.
    await expect(page.locator('html')).toHaveAttribute('data-served-lang', 'en')
    expect(await page.evaluate(() => localStorage.getItem('loco_lang'))).toBeNull()
  })

  test('leaves a French URL alone, and an English one it was handed', async ({ page }) => {
    // `/fr/` is already what this browser would have asked for: nothing to do.
    await page.goto('/fr/')
    await expect(page).toHaveURL(/\/fr\/$/)
    await expect(page.locator('html')).toHaveAttribute('data-served-lang', 'fr')

    // And a content page is reached by following a link that already carries a
    // language, so it is served as it is and stays there.
    await page.goto('/rules/')
    await expect(page).toHaveURL(/\/rules\/$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  })
})

/**
 * The other side of that rule: a French link opening in French for somebody
 * whose browser is in English. The URL is the request, and a setting they never
 * touched does not overrule the one they were handed.
 */
test.describe('a browser that asks for English', () => {
  test.use({ locale: 'en-US' })

  test('keeps a French link French', async ({ page }) => {
    await page.goto('/fr/')
    await expect(page).toHaveURL(/\/fr\/$/)
    await expect(page.locator('#root')).toContainText(fr.tagline, { timeout: 15_000 })
  })
})
