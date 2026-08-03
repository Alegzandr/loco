#!/usr/bin/env node
/**
 * Social preview (Open Graph / X card) generator.
 *
 * Renders the `og-card` showcase scene — the real <LocoLogo /> and the real
 * <Card />, not a redrawn copy — and writes it to `client/public/og.png` at
 * exactly 1200×630, the size both Discord and X take without re-cropping.
 *
 * The PNG is committed: the client image is built by `npm run build` in CI,
 * which has no browser, and a link preview that 404s is worse than none.
 * Re-run this after touching the mark, a card face or the tagline.
 *
 * There are four of them: two languages x two cards, the site's and the one a
 * table invitation unfurls into (`/i/CODE`, see src/seo/meta.ts: INVITE). With
 * no argument every one is re-shot, because they are one set: a change to the
 * mark or to a card face lands in all four, and three regenerated PNGs beside a
 * fourth that was forgotten is the failure this default exists to prevent.
 *
 * Usage (from repo root):
 *   node tools/og/shoot.mjs                                  # all four
 *   node tools/og/shoot.mjs --lang=fr                        # both cards, French
 *   node tools/og/shoot.mjs --scene=og-invite --lang=fr --out=...
 *   node tools/og/shoot.mjs --port=5198
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startDevServer } from '../lib/devserver.mjs'

const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const PORT = Number(args.port ?? 5198)

const W = 1200
const H = 630

// The whole set, in the order the site uses them. `scene` is the showcase id
// (src/dev/scenes.ts); `file` is what src/seo/meta.ts points the tags at.
const CARDS = [
  { scene: 'og-card', lang: 'en', file: 'og.png' },
  { scene: 'og-card', lang: 'fr', file: 'og.fr.png' },
  { scene: 'og-invite', lang: 'en', file: 'og.invite.png' },
  { scene: 'og-invite', lang: 'fr', file: 'og.invite.fr.png' },
]

// An explicit argument narrows the set; nothing at all means all of it. `--out`
// only makes sense once the set is down to one card, so it is refused otherwise
// rather than quietly writing four images over one path.
const wanted = CARDS.filter(
  (c) =>
    (args.scene === undefined || c.scene === String(args.scene)) &&
    (args.lang === undefined || c.lang === String(args.lang)),
)
if (!wanted.length) {
  console.error(`no card matches --scene=${args.scene} --lang=${args.lang}`)
  process.exit(1)
}
if (args.out && wanted.length > 1) {
  console.error('--out names one file: narrow the set with --scene and --lang')
  process.exit(1)
}

const dev = await startDevServer(PORT)
try {
  const browser = await chromium.launch()

  for (const { scene, lang, file } of wanted) {
    const out = path.resolve(ROOT, String(args.out ?? path.join('client', 'public', file)))
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      // A link preview is a still. Anything mid-animation is a bug in a picture
      // nobody can re-render.
      reducedMotion: 'reduce',
      locale: lang === 'fr' ? 'fr-FR' : 'en-US',
    })
    // A context per card, not a reused one: `loco_lang` is seeded by an init
    // script, and a second language in the same context would be a stored value
    // the first page already read.
    await ctx.addInitScript((l) => localStorage.setItem('loco_lang', l), lang)

    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    // The home page *of this language*: seeding `loco_lang` and then asking for `/`
    // makes `initLangUrl()` redirect to `/fr/`, so the capture would be taken after
    // a navigation the harness caused. Harmless here — `data-showcase-ready` is
    // waited on below and lands on the final document — but see the same line in
    // `tools/visual/shoot.mjs`, where the doubled navigation count is not harmless.
    const home = lang === 'fr' ? '/fr/' : '/'
    await page.goto(`http://localhost:${PORT}${home}?showcase=${scene}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })
    // The wordmark is Fredoka; capturing before it loads ships a preview in the
    // fallback face, and nothing downstream would ever tell us.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)

    // Screenshot the card element rather than the viewport: the element is the
    // 1200×630 drawing, so its own box is the frame whatever the page does
    // around it.
    const card = page.locator('[data-og-card]')
    await fs.mkdir(path.dirname(out), { recursive: true })
    await card.screenshot({ path: out })

    const box = await card.boundingBox()
    if (Math.round(box.width) !== W || Math.round(box.height) !== H) {
      throw new Error(`og card is ${box.width}×${box.height}, expected ${W}×${H}`)
    }
    if (errors.length) {
      console.warn('⚠ page errors:')
      for (const e of [...new Set(errors)]) console.warn(`   ${e.split(/\r?\n/)[0]}`)
    }

    await ctx.close()
    console.log(`✓ ${W}×${H} (${scene}, ${lang}) → ${path.relative(ROOT, out)}`)
  }

  await browser.close()
  console.log(
    "  Discord et X mettent l'aperçu en cache : bump OG_VERSION dans client/src/seo/meta.ts après un changement d'art.",
  )
} finally {
  dev.kill()
}
