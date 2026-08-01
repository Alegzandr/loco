#!/usr/bin/env node
/**
 * App-icon generator.
 *
 * Rasterises `client/public/favicon.svg` — the same mark the tab shows, not a
 * redrawn copy — into the PNG sizes a web app manifest and an old browser ask
 * for, plus a `favicon.ico` for the crawlers and feed readers that still request
 * that exact path and take a 404 as "no icon".
 *
 * The PNGs are committed for the same reason `og.png` is: the client image is
 * built by `npm run build` in CI, which has no browser.
 *
 * Usage (from repo root):
 *   node tools/icons/shoot.mjs
 *
 * Playwright is resolved from e2e/node_modules (already installed for the E2E
 * suite) so this adds no dependency to the client.
 */
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import path from 'node:path'
import { ROOT } from '../lib/devserver.mjs'

const require = createRequire(path.join(ROOT, 'e2e', 'package.json'))
const { chromium } = require('playwright')

const PUBLIC = path.join(ROOT, 'client', 'public')
const SOURCE = path.join(PUBLIC, 'favicon.svg')

/** name → pixel size. 192 and 512 are what a manifest is expected to carry. */
const SIZES = {
  'favicon-32.png': 32,
  'icon-192.png': 192,
  'icon-512.png': 512,
}
/** Which rendered size gets wrapped into favicon.ico. */
const ICO_FROM = 'favicon-32.png'

/**
 * Wraps a PNG in an ICO container.
 *
 * An .ico is a 6-byte directory, one 16-byte entry, then the image bytes, and
 * every browser since Vista reads a PNG payload directly. That is the whole
 * format here: no re-encoding, no dependency, and the file stays the exact
 * pixels Chromium drew.
 */
function pngToIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // one image

  const entry = Buffer.alloc(16)
  // 0 means 256 in this field; nothing here is that large, but be explicit.
  entry.writeUInt8(size >= 256 ? 0 : size, 0)
  entry.writeUInt8(size >= 256 ? 0 : size, 1)
  entry.writeUInt8(0, 2) // palette size: none
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // colour planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(header.length + entry.length, 12)

  return Buffer.concat([header, entry, png])
}

const svg = await fs.readFile(SOURCE, 'utf8')
const browser = await chromium.launch()
try {
  for (const [name, size] of Object.entries(SIZES)) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    })
    // The SVG carries a viewBox and no intrinsic size, so it fills the viewport.
    // Setting the content directly keeps this independent of any dev server.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">
       <style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden}
              svg{display:block;width:100%;height:100%}</style>
       ${svg}`,
      { waitUntil: 'load' },
    )
    const out = path.join(PUBLIC, name)
    await page.screenshot({ path: out })
    await page.close()

    const buf = await fs.readFile(out)
    const w = buf.readUInt32BE(16)
    if (w !== size) throw new Error(`${name} rendered at ${w}px, expected ${size}`)
    console.log(`✓ ${size}×${size} → client/public/${name}`)
  }

  const base = await fs.readFile(path.join(PUBLIC, ICO_FROM))
  await fs.writeFile(path.join(PUBLIC, 'favicon.ico'), pngToIco(base, SIZES[ICO_FROM]))
  console.log(`✓ ${SIZES[ICO_FROM]}×${SIZES[ICO_FROM]} → client/public/favicon.ico`)
} finally {
  await browser.close()
}
