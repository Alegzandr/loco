#!/usr/bin/env node
/**
 * Game cover generator, 3:4 portrait.
 *
 * Renders the `cover-*` showcase scenes — the real <LocoLogo /> and the real
 * <Card />, not a redrawn copy — and writes them to `brand/`. That art is
 * uploaded to IGDB, which is where Twitch takes a category's box art from, so
 * it leaves this repository and lands somewhere nothing here can watch it go
 * stale. Re-run it after touching the mark or a card face, and re-upload.
 *
 * **`brand/` is not `client/public/`.** These files are not served by the site
 * and must not be: a cover is an upload, and shipping it would add a megabyte
 * to the image for nobody. They are committed for the reason the OG cards are —
 * CI has no browser, and this cannot be regenerated there.
 *
 * The capture runs at deviceScaleFactor 2, so the files are 1200×1600 for a
 * 600×800 drawing. IGDB states 600×800 as a *minimum* and downsamples anything
 * larger, which beats handing it the floor and letting Twitch's own resizing
 * work from it.
 *
 * Usage (from repo root):
 *   node tools/cover/shoot.mjs                    # all three cuts
 *   node tools/cover/shoot.mjs --variant=duck
 *   node tools/cover/shoot.mjs --variant=mark --out=brand/cover.png
 *   node tools/cover/shoot.mjs --port=5199
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

const PORT = Number(args.port ?? 5199)

/** The drawing's own size, in CSS pixels. `CoverCard.svelte` holds the same pair. */
const W = 600
const H = 800
/** Captured at 2×, so the PNG is 1200×1600. See the header. */
const SCALE = 2

// The whole set. `scene` is the showcase id (src/dev/scenes.ts); `file` is what
// lands in brand/. With no argument every cut is re-shot, because they are one
// set: a change to the mark lands in all three, and two regenerated covers
// beside a third that was forgotten is the failure this default prevents.
const COVERS = [
  { scene: 'cover-duck', variant: 'duck', file: 'cover-duck.png' },
  { scene: 'cover-fan', variant: 'fan', file: 'cover-fan.png' },
  { scene: 'cover-mark', variant: 'mark', file: 'cover-mark.png' },
]

const wanted = COVERS.filter((c) => args.variant === undefined || c.variant === String(args.variant))
if (!wanted.length) {
  console.error(`no cover matches --variant=${args.variant} (duck | fan | mark)`)
  process.exit(1)
}
// `--out` names one file, so it is refused rather than quietly writing three
// images over one path.
if (args.out && wanted.length > 1) {
  console.error('--out names one file: narrow the set with --variant')
  process.exit(1)
}

const dev = await startDevServer(PORT)
try {
  const browser = await chromium.launch()

  for (const { scene, variant, file } of wanted) {
    const out = path.resolve(ROOT, String(args.out ?? path.join('brand', file)))
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: SCALE,
      // A cover is a still. Anything mid-animation is a bug in a picture nobody
      // can re-render — and the lobby's wordmark breathes.
      reducedMotion: 'reduce',
      locale: 'en-US',
    })

    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(`http://localhost:${PORT}/?showcase=${scene}`, {
      waitUntil: 'domcontentloaded',
    })
    await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })
    // The wordmark is Fredoka; capturing before it loads ships a cover in the
    // fallback face, and nothing downstream would ever tell us.
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)

    // Screenshot the cover element rather than the viewport: the element is the
    // 600×800 drawing, so its own box is the frame whatever the page does
    // around it.
    const cover = page.locator('[data-cover-card]')
    await fs.mkdir(path.dirname(out), { recursive: true })
    await cover.screenshot({ path: out })

    const box = await cover.boundingBox()
    if (Math.round(box.width) !== W || Math.round(box.height) !== H) {
      throw new Error(`cover is ${box.width}×${box.height}, expected ${W}×${H}`)
    }
    if (errors.length) {
      console.warn('⚠ page errors:')
      for (const e of [...new Set(errors)]) console.warn(`   ${e.split(/\r?\n/)[0]}`)
    }

    await ctx.close()
    console.log(
      `✓ ${W * SCALE}×${H * SCALE} (${scene}) → ${path.relative(ROOT, out).replace(/\\/g, '/')}`,
    )
  }

  await browser.close()
  console.log('  Jugez-les à 40px de large avant de choisir : c’est la taille où une catégorie se repère.')
} finally {
  dev.kill()
}
