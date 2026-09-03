#!/usr/bin/env node
/**
 * The stills for the rooms page.
 *
 * A content page ships no script, so it cannot render a room; what it can
 * show is a photograph of one. This opens the `room-still-<id>` showcase
 * scene for every room — the diorama alone, at its signature hour, framed
 * 16:9 with the podium under where the page's CSS table sits — waits for the
 * render, and writes each to `client/src/assets/rooms/<id>.webp`. The page
 * lays the same CSS table the board draws over the still, so the room and the
 * table are one object there as they are in a match.
 *
 * The stills are committed: the client is built by `npm run build` in CI,
 * which has no browser. Re-run this after touching a builder, the kit, the
 * light rig or the finishing passes — the rooms page shows what the render
 * showed the day this last ran, and nothing checks that they agree.
 *
 * `?gfx=force` asks the renderer for the full tier on headless Chromium's
 * software GPU, which it would otherwise refuse: it takes a while per room
 * and that is fine here.
 *
 * Usage (from repo root):
 *   node tools/rooms/shoot.mjs            # all six
 *   node tools/rooms/shoot.mjs --rooms=neon,marina
 *   node tools/rooms/shoot.mjs --port=5197
 *
 * Playwright is resolved from e2e/node_modules and sharp from the client's:
 * both already installed, so this adds no dependency.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startDevServer } from '../lib/devserver.mjs'

const requireE2e = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const requireClient = createRequire(path.join(ROOT, 'client', 'package.json'))
const { chromium } = requireE2e('playwright')
const sharp = requireClient('sharp')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const PORT = Number(args.port ?? 5197)
const OUT_DIR = path.join(ROOT, 'client', 'src', 'assets', 'rooms')
/** 16:9, and wide enough that the page's largest rendition is a downscale. */
const W = 1600
const H = 900

/** The rooms, off the scene registry, so a seventh room needs no edit here. */
async function readRooms() {
  const src = await fs.readFile(path.join(ROOT, 'client', 'src', 'dev', 'scenes.ts'), 'utf8')
  const from = src.indexOf('The stills the rooms page')
  const to = src.indexOf('as const', from)
  const block = from >= 0 && to > from ? src.slice(from, to) : ''
  const ids = [...block.matchAll(/\['([a-z]+)', '(?:dawn|day|dusk|night)'\]/g)].map((m) => m[1])
  if (ids.length === 0) throw new Error('no room-still scenes found in client/src/dev/scenes.ts')
  return [...new Set(ids)]
}

const rooms = await readRooms()
const wanted = args.rooms ? String(args.rooms).split(',') : rooms
for (const r of wanted) if (!rooms.includes(r)) throw new Error(`unknown room: ${r} (have ${rooms.join(', ')})`)

const dev = await startDevServer(PORT)
try {
  await fs.mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.LOCO_CHROMIUM || undefined })
  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    colorScheme: 'dark',
    locale: 'en-US',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  for (const id of wanted) {
    const out = path.join(OUT_DIR, `${id}.webp`)
    await page.goto(`http://localhost:${PORT}/?showcase=room-still-${id}&gfx=force`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('html[data-showcase-ready]', { timeout: 30_000 })
    // The render is built on the main thread after the screen mounts, and on
    // a software GPU at the full tier that is a while: the frame is up once
    // `.scene` sheds `bare`, and the fade over it is done a moment later.
    await page.waitForSelector('.scene:not(.bare)', { timeout: 240_000 })
    await page.waitForTimeout(600)
    const png = await page.locator('[data-testid="room-still"]').screenshot({ type: 'png' })
    await sharp(png).webp({ quality: 86 }).toFile(out)
    const { size } = await fs.stat(out)
    console.log(`✓ ${path.relative(ROOT, out)} (${Math.round(size / 1024)} KB)`)
  }

  if (errors.length) {
    console.warn('\n⚠ page errors:')
    for (const e of [...new Set(errors)]) console.warn(`   ${e.split('\n')[0]}`)
  }
  await browser.close()
} finally {
  dev.kill()
}
