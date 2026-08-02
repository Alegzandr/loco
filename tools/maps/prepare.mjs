#!/usr/bin/env node
/**
 * Map asset preparation.
 *
 * Turns a folder of raw renders into the two files the client ships per map:
 *
 *   <src>/<Map>/*.png   →   client/public/maps/<map>/room.webp
 *                           client/public/maps/<map>/table.webp   (with alpha)
 *
 * Each map folder holds exactly two images: the room (the lit space the table
 * sits in) and the table itself, already cut out against transparency. The work
 * here is deliberately small (crop, re-encode) because the alpha in the source
 * is the artist's, and anything this script invented would be worse than it.
 *
 * **Which file is which is read off the alpha channel, never off the filename**
 * (the renders come out of the generator named after their timestamp). The table
 * is the one with transparent pixels; the room is fully opaque. An earlier pass
 * guessed by frame brightness on the assumption that the tables sat on a grey
 * backdrop. That grey was the image viewer showing through, and every map came
 * out swapped.
 *
 * The table is cropped to its alpha bounding box, which is what makes the
 * client's placement maths honest: `maps.ts` positions the image by a playfield
 * rectangle expressed as a fraction of the file, so any dead margin in the file
 * is a constant every one of those numbers has to carry.
 *
 * Playwright is resolved from e2e/node_modules and both the decode and the WebP
 * encode happen in the page, the same arrangement as the visual and link-preview
 * harnesses, so this adds no dependency to the client.
 *
 * Usage (from repo root):
 *   node tools/maps/prepare.mjs --src="D:/path/to/Maps"
 *   node tools/maps/prepare.mjs --src=... --only=neon,orbit
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT } from '../lib/devserver.mjs'

const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const OUT_ROOT = path.join(ROOT, 'client', 'public', 'maps')

// ─── Args ───────────────────────────────────────────────────────────────────

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=')
    return [k, v ?? true]
  }),
)

const SRC = args.src ? String(args.src) : path.join(ROOT, 'assets', 'maps')
const ONLY = args.only ? String(args.only).split(',') : null
// The room is a photographic backdrop that never carries a hard edge, so it
// takes lossy compression well. The table has a cut-out silhouette and a glow
// running through partial alpha, and both go blocky several steps earlier.
const ROOM_QUALITY = Number(args.roomQuality ?? 0.86)
const TABLE_QUALITY = Number(args.tableQuality ?? 0.93)
/** Alpha at or below this counts as "not part of the table" when cropping. */
const CROP_ALPHA = 2

// ─── Pixel work (runs inside the page) ──────────────────────────────────────

/**
 * Reads an image's alpha coverage. Serialised into the browser, so it may not
 * close over anything in this module.
 */
function measure(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => reject(new Error('could not decode source image'))
    img.onload = () => {
      const W = img.naturalWidth
      const H = img.naturalHeight
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, W, H).data
      let transparent = 0
      let partial = 0
      let minX = W
      let minY = H
      let maxX = -1
      let maxY = -1
      for (let py = 0; py < H; py++) {
        for (let px = 0; px < W; px++) {
          const a = d[(py * W + px) * 4 + 3]
          if (a === 0) transparent++
          else if (a < 255) partial++
          if (a > 2) {
            if (px < minX) minX = px
            if (py < minY) minY = py
            if (px > maxX) maxX = px
            if (py > maxY) maxY = py
          }
        }
      }
      resolve({ width: W, height: H, transparent, partial, bbox: [minX, minY, maxX, maxY] })
    }
    img.src = dataUrl
  })
}

/** Crops to `box` (omit for the whole image) and re-encodes to WebP. */
function encode([dataUrl, box, quality]) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onerror = () => reject(new Error('could not decode source image'))
    img.onload = () => {
      const [sx, sy, sw, sh] = box ?? [0, 0, img.naturalWidth, img.naturalHeight]
      const c = document.createElement('canvas')
      c.width = sw
      c.height = sh
      // Nothing is resampled here (the crop is pixel-aligned) but the default
      // alpha compositing would still blend the source onto the canvas's own
      // transparent black and darken the glow's semi-transparent fringe.
      const ctx = c.getContext('2d')
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
      resolve({ dataUrl: c.toDataURL('image/webp', quality), width: sw, height: sh })
    }
    img.src = dataUrl
  })
}

// ─── Driver ─────────────────────────────────────────────────────────────────

async function toDataUrl(file) {
  const buf = await fs.readFile(file)
  const ext = path.extname(file).toLowerCase()
  const mime =
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png'
  return `data:${mime};base64,${buf.toString('base64')}`
}

async function writeDataUrl(file, dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  await fs.writeFile(file, Buffer.from(b64, 'base64'))
}

const kb = (n) => `${Math.round(n / 1024)} kB`
const pct = (n, total) => `${((100 * n) / total).toFixed(1)}%`

async function main() {
  const entries = await fs.readdir(SRC, { withFileTypes: true })
  const dirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => !ONLY || ONLY.includes(name.toLowerCase()))
  if (dirs.length === 0) throw new Error(`no map folder found under ${SRC}`)

  const browser = await chromium.launch()
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error(`page error: ${e}`))

  for (const dir of dirs.sort()) {
    const id = dir.toLowerCase()
    const files = (await fs.readdir(path.join(SRC, dir)))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => path.join(SRC, dir, f))
    if (files.length !== 2) {
      throw new Error(`${dir}: expected exactly 2 images (room + table), found ${files.length}`)
    }

    const urls = await Promise.all(files.map(toDataUrl))
    const stats = []
    for (const url of urls) stats.push(await page.evaluate(measure, url))

    const cutOut = stats.map((s) => s.transparent > 0)
    if (cutOut[0] === cutOut[1]) {
      throw new Error(
        `${dir}: cannot tell room from table, ` +
          `${cutOut[0] ? 'both' : 'neither'} image has transparency`,
      )
    }
    const tableIdx = cutOut[0] ? 0 : 1
    const roomIdx = 1 - tableIdx
    const table = stats[tableIdx]
    const [minX, minY, maxX, maxY] = table.bbox

    const outDir = path.join(OUT_ROOT, id)
    await fs.mkdir(outDir, { recursive: true })

    const room = await page.evaluate(encode, [urls[roomIdx], null, ROOM_QUALITY])
    await writeDataUrl(path.join(outDir, 'room.webp'), room.dataUrl)

    const cropped = await page.evaluate(encode, [
      urls[tableIdx],
      [minX, minY, maxX - minX + 1, maxY - minY + 1],
      TABLE_QUALITY,
    ])
    await writeDataUrl(path.join(outDir, 'table.webp'), cropped.dataUrl)

    const roomSize = (await fs.stat(path.join(outDir, 'room.webp'))).size
    const tableSize = (await fs.stat(path.join(outDir, 'table.webp'))).size
    const total = table.width * table.height
    console.log(
      `${id.padEnd(7)} room ${room.width}×${room.height} (${kb(roomSize)})   ` +
        `table ${cropped.width}×${cropped.height} (${kb(tableSize)}), ` +
        `cropped from ${table.width}×${table.height}, ` +
        `${pct(table.transparent, total)} clear / ${pct(table.partial, total)} soft\n` +
        `        sources: room=${path.basename(files[roomIdx])}  ` +
        `table=${path.basename(files[tableIdx])}`,
    )
  }

  await browser.close()
}

await main()
