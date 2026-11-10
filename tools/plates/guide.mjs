/**
 * The guide a room's plate is painted from.
 *
 * A painted room (`client/src/components/scene/plates.ts`) is one picture laid
 * under the table by its lens. It is painted over a render of the block room,
 * so the camera in the painting is the game's and not one a model made up.
 * This shoots that render: the `game-map-<id>` showcase scene with `?bare=1`
 * (no table, no inlay round its foot: both follow the felt, and the felt
 * changes with the frame), read straight off the scene's canvas so no card,
 * seat or chip is in it.
 *
 * 2304x1296 by default: a 16:9 frame, the widest lens the camera uses, so the
 * painting has every column any frame asks for. The plate's entry carries
 * what `solveView` gives for this size (`scenePlates.test.ts` pins the two).
 *
 * Then `paint.py` turns the guide into the painting, in two passes, on a
 * local ComfyUI. See the top of that file.
 *
 * Usage (from repo root):
 *   node tools/plates/guide.mjs --room=velvet --out=.assets-in/plates
 *   node tools/plates/guide.mjs --room=velvet --scene=game-map-velvet-fog --w=2304 --h=1296
 *
 * Playwright is resolved from e2e/node_modules: nothing new to install.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT, startDevServer } from '../lib/devserver.mjs'

const requireE2e = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = requireE2e('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)
if (!args.room) throw new Error('usage: node tools/plates/guide.mjs --room=<id> [--scene=game-map-<id>] [--out=dir] [--w=2304 --h=1296]')

const PORT = Number(args.port ?? 5198)
const W = Number(args.w ?? 2304)
const H = Number(args.h ?? 1296)
const scene = String(args.scene ?? `game-map-${args.room}`)
const outDir = path.resolve(ROOT, String(args.out ?? '.assets-in/plates'))
const out = path.join(outDir, `guide-${args.room}.png`)

const dev = await startDevServer(PORT)
try {
  await fs.mkdir(outDir, { recursive: true })
  // The full tier needs a GPU to be quick; the flags are harmless without one.
  const browser = await chromium.launch({
    executablePath: process.env.LOCO_CHROMIUM || undefined,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=d3d11'],
  })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'reduce', colorScheme: 'dark' })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.warn(`⚠ ${String(e).split('\n')[0]}`))
  await page.goto(`http://localhost:${PORT}/?showcase=${scene}&gfx=force&bare=1`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('html[data-showcase-ready]', { timeout: 30_000 })
  await page.waitForSelector('.scene:not(.bare)', { timeout: 240_000 })
  await page.waitForTimeout(1500)
  // The frame on top of the two the backdrop cross-fades between.
  const url = await page.evaluate(() => {
    const frames = [...document.querySelectorAll('.scene canvas.frame')]
    const top = frames.find((c) => c.classList.contains('top')) ?? frames[0]
    return top.toDataURL('image/png')
  })
  await fs.writeFile(out, Buffer.from(url.split(',')[1], 'base64'))
  console.log(`✓ ${path.relative(ROOT, out)} (${W}x${H})`)
  await browser.close()
} finally {
  dev.kill()
}
