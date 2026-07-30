/**
 * The link preview is the one part of the UI nobody on the team ever looks at:
 * it renders inside Discord and X, from tags no screen displays and an image no
 * route serves to a human. Nothing else would go red if `og.png` were deleted,
 * if a tag lost its absolute URL, or if the declared dimensions drifted from the
 * file — the preview would just quietly stop rendering.
 *
 * Regenerate the image with `make og` (tools/og/shoot.mjs).
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { OG_W, OG_H } from '../dev/OgCard'

const CLIENT = path.resolve(__dirname, '..', '..')
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8')
const og = readFileSync(path.join(CLIENT, 'public', 'og.png'))

/** Width/height out of a PNG's IHDR chunk — bytes 16..24, big-endian. */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** Value of a <meta property|name="..." content="..."> in index.html. */
function meta(key: string): string | undefined {
  const re = new RegExp(`<meta[^>]*(?:property|name)="${key}"[^>]*content="([^"]*)"`, 'i')
  return re.exec(html)?.[1]
}

describe('link preview (Open Graph / X)', () => {
  it('ships an og.png at the size the tags promise', () => {
    const { width, height } = pngSize(og)
    expect({ width, height }).toEqual({ width: OG_W, height: OG_H })
    expect(meta('og:image:width')).toBe(String(width))
    expect(meta('og:image:height')).toBe(String(height))
  })

  it('declares every tag Discord and X need', () => {
    // summary_large_image is what turns X's preview from a thumbnail into the
    // full 1.91:1 card. Without it the artwork is a 120px square.
    expect(meta('twitter:card')).toBe('summary_large_image')
    for (const key of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image:alt']) {
      expect(meta(key), key).toBeTruthy()
    }
  })

  it('points at absolute URLs', () => {
    // Crawlers resolve og:image against nothing; a relative path is not fetched.
    // The origin is substituted at build time (vite.config.ts), so the token
    // itself must survive in the source.
    for (const key of ['og:image', 'twitter:image', 'og:url']) {
      expect(meta(key), key).toMatch(/^%OG_ORIGIN%\//)
    }
  })

  it('cache-busts the image URL', () => {
    // Both platforms cache a preview by URL for days. The ?v= is the only way
    // to make them re-fetch after the art changes.
    expect(meta('og:image')).toMatch(/\?v=\d+$/)
    expect(meta('twitter:image')).toBe(meta('og:image'))
  })
})
