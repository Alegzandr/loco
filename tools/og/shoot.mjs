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
 * Usage (from repo root):
 *   node tools/og/shoot.mjs
 *   node tools/og/shoot.mjs --lang=fr --out=client/public/og.fr.png
 *   node tools/og/shoot.mjs --port=5198
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startVite } from '../lib/vite.mjs'

const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const PORT = Number(args.port ?? 5198)
// English by default: the preview is what a stranger sees on X or in a Discord
// server that is not necessarily French. The app itself still auto-detects.
const LANG = String(args.lang ?? 'en')
const OUT = path.resolve(ROOT, String(args.out ?? path.join('client', 'public', 'og.png')))

const W = 1200
const H = 630

const vite = await startVite(PORT)
try {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    // A link preview is a still. Anything mid-animation is a bug in a picture
    // nobody can re-render.
    reducedMotion: 'reduce',
    locale: LANG === 'fr' ? 'fr-FR' : 'en-US',
  })
  await ctx.addInitScript((l) => localStorage.setItem('loco_lang', l), LANG)

  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(`http://localhost:${PORT}/?showcase=og-card`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })
  // The wordmark is Fredoka; capturing before it loads ships a preview in the
  // fallback face, and nothing downstream would ever tell us.
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(300)

  // Screenshot the card element rather than the viewport: the element is the
  // 1200×630 drawing, so its own box is the frame whatever the page does
  // around it.
  const card = page.locator('[data-og-card]')
  await fs.mkdir(path.dirname(OUT), { recursive: true })
  await card.screenshot({ path: OUT })

  const box = await card.boundingBox()
  if (Math.round(box.width) !== W || Math.round(box.height) !== H) {
    throw new Error(`og card is ${box.width}×${box.height}, expected ${W}×${H}`)
  }
  if (errors.length) {
    console.warn('⚠ page errors:')
    for (const e of [...new Set(errors)]) console.warn(`   ${e.split('\n')[0]}`)
  }

  await browser.close()
  console.log(`✓ ${W}×${H} (${LANG}) → ${path.relative(ROOT, OUT)}`)
  console.log('  Discord et X mettent l\'aperçu en cache : bump ?v= dans client/index.html après un changement d\'art.')
} finally {
  vite.kill()
}
