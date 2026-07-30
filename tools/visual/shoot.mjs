#!/usr/bin/env node
/**
 * Visual capture harness.
 *
 * Boots the client's Vite dev server, walks the showcase scene registry
 * (client/src/dev/scenes.ts) and screenshots every scene at every requested
 * viewport/theme into `.visual/`. Also renders a single contact sheet so the
 * whole UI can be reviewed in one image.
 *
 * Usage (from repo root):
 *   node tools/visual/shoot.mjs
 *   node tools/visual/shoot.mjs --scenes=game-my-turn,lobby-home
 *   node tools/visual/shoot.mjs --themes=dark --viewports=mobile
 *   node tools/visual/shoot.mjs --motion        # keep animations running
 *   node tools/visual/shoot.mjs --port=5199
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startVite } from '../lib/vite.mjs'

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
}

const themes = String(args.themes ?? 'light,dark').split(',').filter(Boolean)
const viewports = String(args.viewports ?? 'desktop,mobile').split(',').filter(Boolean)
const lang = String(args.lang ?? 'fr')

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

  const browser = await chromium.launch()
  const shots = []

  for (const vpName of viewports) {
    const viewport = VIEWPORTS[vpName]
    if (!viewport) throw new Error(`unknown viewport: ${vpName}`)
    for (const theme of themes) {
      const ctx = await browser.newContext({
        ...viewport,
        reducedMotion: KEEP_MOTION ? 'no-preference' : 'reduce',
        colorScheme: theme === 'dark' ? 'dark' : 'light',
        locale: lang === 'fr' ? 'fr-FR' : 'en-US',
      })
      await ctx.addInitScript(
        ([t, l]) => {
          localStorage.setItem('loco_theme', t)
          localStorage.setItem('loco_lang', l)
        },
        [theme, lang],
      )
      const page = await ctx.newPage()
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))

      for (const scene of list) {
        const file = `${scene.id}__${vpName}__${theme}.png`
        await page.goto(`${BASE}/?showcase=${scene.id}`, { waitUntil: 'domcontentloaded' })
        await page.waitForSelector('html[data-showcase-ready]', { timeout: 15_000 })
        await page.evaluate(() => document.fonts?.ready)
        // One extra frame so late layout (ResizeObserver-driven board) settles.
        await page.waitForTimeout(KEEP_MOTION ? 900 : 250)
        await page.screenshot({ path: path.join(OUT_DIR, file) })
        shots.push({ ...scene, file, viewport: vpName, theme })
      }

      if (errors.length) {
        console.warn(`\n⚠ page errors (${vpName}/${theme}):`)
        for (const e of [...new Set(errors)]) console.warn(`   ${e.split('\n')[0]}`)
      }
      await ctx.close()
    }
  }

  await buildContactSheets(browser, shots)
  await browser.close()
  return shots
}

/** One tall image per viewport/theme combo: every scene, labelled, in a grid. */
async function buildContactSheets(browser, shots) {
  const groups = new Map()
  for (const s of shots) {
    const key = `${s.viewport}__${s.theme}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(s)
  }

  for (const [key, items] of groups) {
    const cols = items[0].viewport === 'mobile' ? 6 : 3
    const cellW = items[0].viewport === 'mobile' ? 200 : 460
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
<h1>LOCO — ${key.replace('__', ' · ')} — ${items.length} scènes</h1>
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

const vite = await startVite(PORT)
try {
  const shots = await capture()
  console.log(`\n✓ ${shots.length} captures → .visual/`)
  for (const [k] of new Set(shots.map((s) => `${s.viewport}__${s.theme}`)).entries()) {
    console.log(`  planche : .visual/_sheet-${k}.png`)
  }
} finally {
  vite.kill()
}
