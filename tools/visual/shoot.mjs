#!/usr/bin/env node
/**
 * Visual capture harness.
 *
 * Boots the client's dev server, walks the showcase scene registry
 * (client/src/dev/scenes.ts) and screenshots every scene at every requested
 * viewport into `.visual/`. Also renders a single contact sheet so the whole
 * UI can be reviewed in one image.
 *
 * Usage (from repo root):
 *   node tools/visual/shoot.mjs
 *   node tools/visual/shoot.mjs --scenes=game-my-turn,lobby-home
 *   node tools/visual/shoot.mjs --viewports=mobile
 *   node tools/visual/shoot.mjs --motion        # keep animations running
 *   node tools/visual/shoot.mjs --gfx=force     # the full render tier on this software GPU
 *   node tools/visual/shoot.mjs --port=5199
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startDevServer } from '../lib/devserver.mjs'

const OUT_DIR = path.join(ROOT, '.visual')

const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

// ─── Args ───────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const PORT = Number(args.port ?? 5199)
const KEEP_MOTION = Boolean(args.motion)
const BASE = `http://localhost:${PORT}`
// The graphics tier a room is rendered at: `--gfx=high|medium|light`, or
// `--gfx=force` for the full tier on this headless GPU, which is a CPU and is
// otherwise handed the plain frame. Off by default, so a capture is what a
// player on the same software GPU would see; `force` is how the finishing
// passes are reviewed.
const GFX = args.gfx ? `&gfx=${encodeURIComponent(String(args.gfx))}` : ''

// Playwright takes the size under `viewport`; width/height at the top level of
// the context options are silently ignored and you get the 1280×720 default.
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  // A maximised window on a common monitor. Not redundant with `desktop`: the
  // board scales itself to the viewport, so this is where too-small-table and
  // too-much-background regressions actually show up.
  wide: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
  mobile: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  // The small end of the phone range (iPhone SE / older Android). The board
  // scales *down* here, so this is where "cards too big for the screen"
  // regressions show up — `mobile` alone never catches them.
  small: {
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
  // A notched phone. No desktop browser reports a safe-area inset, so the only
  // way to review the one layout that has to dodge a notch and a home indicator
  // is to say so: `insets` overrides the --safe-* tokens, which the CSS offsets
  // and safeAreaInsets both read. This is the viewport where a control
  // hiding under the status bar shows up.
  notch: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    insets: { top: 59, right: 0, bottom: 34, left: 0 },
  },
  // A phone on its side (iPhone 13 Pro, Safari's bar still showing, so the
  // page is 340px tall). The board turns into its landscape composition here
  // — seats down the left, the action stack up the right, the hand along the
  // bottom — and this is the only viewport that composition is visible in.
  // The notch is on one flank and the home indicator still along the bottom.
  landscape: {
    viewport: { width: 844, height: 340 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    insets: { top: 0, right: 47, bottom: 21, left: 47 },
  },
}

const viewports = String(args.viewports ?? 'desktop,mobile').split(',').filter(Boolean)
const lang = String(args.lang ?? 'fr')

/**
 * The home page **for this language**, and it has to be this rather than `/`.
 *
 * A French screenshot has to be taken of the document a French player is
 * served, not of the English one translated into French: `/` and `/fr/` are two
 * builds, and only one of them is the page being reviewed.
 *
 * It used to matter for a second, harder reason, and the failure is worth
 * keeping written down. A document is never in two languages at once, and the
 * answer then was a navigation — `initLangUrl()` compared the stored choice
 * against the URL and `location.replace`d when they disagreed, so seeding
 * `loco_lang=fr` and asking for `/` loaded every scene twice. Chromium stops
 * honouring navigations on a long-lived page somewhere past a hundred of them:
 * the harness died on scene 52 of 62 with a bare `page.goto` timeout, on
 * whichever scene happened to be 52nd (reverse the list and a different one
 * fails, at the same position). `/` translates itself in place now and never
 * navigates, so the count is halved whatever this asks for — but if the harness
 * ever grows past ~100 scenes, recycle the page rather than hunting the scene it
 * stops on.
 */
const HOME = lang === 'fr' ? '/fr/' : '/'

// ─── Scene registry (parsed from the TS source — no build step needed) ──────

async function readScenes() {
  const src = await fs.readFile(path.join(ROOT, 'client', 'src', 'dev', 'scenes.ts'), 'utf8')
  const scenes = []
  const re = /id:\s*'([^']+)',\s*\n\s*title:\s*'([^']*)'/g
  let m
  while ((m = re.exec(src)) !== null) scenes.push({ id: m[1], title: m[2] })
  if (scenes.length === 0) throw new Error('no scenes found in client/src/dev/scenes.ts')
  return scenes
}

// ─── Capture ────────────────────────────────────────────────────────────────

async function capture() {
  const scenes = await readScenes()
  const wanted = args.scenes ? String(args.scenes).split(',') : null
  const list = wanted ? scenes.filter((s) => wanted.includes(s.id)) : scenes
  if (list.length === 0) throw new Error(`no scene matched --scenes=${args.scenes}`)

  await fs.rm(OUT_DIR, { recursive: true, force: true })
  await fs.mkdir(OUT_DIR, { recursive: true })

  // A machine with a browser already on it but not the one this Playwright
  // pins can point the harness at it (see tools/audio/verify.mjs).
  const browser = await chromium.launch({ executablePath: process.env.LOCO_CHROMIUM || undefined })
  const shots = []

  for (const vpName of viewports) {
    const viewport = VIEWPORTS[vpName]
    if (!viewport) throw new Error(`unknown viewport: ${vpName}`)
    const { insets, ...contextOptions } = viewport
    const ctx = await browser.newContext({
      ...contextOptions,
      reducedMotion: KEEP_MOTION ? 'no-preference' : 'reduce',
      colorScheme: 'dark',
      locale: lang === 'fr' ? 'fr-FR' : 'en-US',
    })
    await ctx.addInitScript(
      ([l, i]) => {
        localStorage.setItem('loco_lang', l)
        if (!i) return
        const style = document.createElement('style')
        style.textContent =
          `:root{--safe-top:${i.top}px!important;--safe-right:${i.right}px!important;` +
          `--safe-bottom:${i.bottom}px!important;--safe-left:${i.left}px!important}`
        document.addEventListener('DOMContentLoaded', () =>
          document.head.appendChild(style),
        )
      },
      [lang, insets ?? null],
    )
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e)))

    for (const scene of list) {
      const file = `${scene.id}__${vpName}.png`
      await page.goto(`${BASE}${HOME}?showcase=${scene.id}${GFX}`, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })
      // A scene with a rendered room is not ready until the room is: the
      // frame is built on the main thread after the screen mounts, and on
      // this headless GPU that is seconds. Captured before it lands, the
      // room is the sky gradient with the frame mid-fade over it, which
      // reads as a blue veil over the whole city and is nothing but timing.
      if (await page.locator('.scene').count()) {
        await page.waitForSelector('.scene:not(.bare)', { timeout: 60_000 }).catch(() => {})
        await page.waitForTimeout(400)
      }
      await page.evaluate(() => document.fonts?.ready)
      // One extra frame so late layout (ResizeObserver-driven board) settles.
      await page.waitForTimeout(KEEP_MOTION ? 900 : 250)
      await page.screenshot({ path: path.join(OUT_DIR, file) })
      shots.push({ ...scene, file, viewport: vpName })
    }

    if (errors.length) {
      console.warn(`\n⚠ page errors (${vpName}):`)
      for (const e of [...new Set(errors)]) console.warn(`   ${e.split('\n')[0]}`)
    }
    await ctx.close()
  }

  await buildContactSheets(browser, shots)
  await browser.close()
  return shots
}

/** One tall image per viewport: every scene, labelled, in a grid. */
async function buildContactSheets(browser, shots) {
  const groups = new Map()
  for (const s of shots) {
    if (!groups.has(s.viewport)) groups.set(s.viewport, [])
    groups.get(s.viewport).push(s)
  }

  for (const [key, items] of groups) {
    const cols = key === 'mobile' ? 6 : 3
    const cellW = key === 'mobile' ? 200 : 460
    const html = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; background:#111318; font:13px/1.3 system-ui,sans-serif; color:#e8e8ee; padding:16px; }
  h1 { font-size:18px; margin:0 0 14px; }
  .grid { display:grid; grid-template-columns:repeat(${cols}, ${cellW}px); gap:14px; }
  figure { margin:0; }
  img { width:${cellW}px; display:block; border-radius:6px; border:1px solid #33343c; background:#000; }
  figcaption { padding-top:5px; font-size:12px; color:#a9a9b4; }
  b { color:#fff; font-weight:600; }
</style>
<h1>LOCO — ${key} — ${items.length} scènes</h1>
<div class="grid">
${items
  .map(
    (s) =>
      `<figure><img src="${s.file}"><figcaption><b>${escapeHtml(s.title)}</b><br>${s.id}</figcaption></figure>`,
  )
  .join('\n')}
</div>`
    const htmlPath = path.join(OUT_DIR, `_sheet-${key}.html`)
    await fs.writeFile(htmlPath, html, 'utf8')
    const page = await browser.newPage({ viewport: { width: cols * (cellW + 14) + 40, height: 1200 } })
    await page.goto('file://' + htmlPath.replace(/\\/g, '/'))
    await page.waitForTimeout(400)
    await page.screenshot({ path: path.join(OUT_DIR, `_sheet-${key}.png`), fullPage: true })
    await page.close()
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

// ─── Main ───────────────────────────────────────────────────────────────────

const dev = await startDevServer(PORT)
try {
  const shots = await capture()
  console.log(`\n✓ ${shots.length} captures → .visual/`)
  for (const k of new Set(shots.map((s) => s.viewport))) {
    console.log(`  planche : .visual/_sheet-${k}.png`)
  }
} finally {
  dev.kill()
}
