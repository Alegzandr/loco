/**
 * The link preview is the one part of the UI nobody on the team ever looks at:
 * it renders inside Discord and X, from tags no screen displays and an image no
 * route serves to a human. Nothing else would go red if a PNG were deleted, if a
 * tag lost its absolute URL, or if the declared dimensions drifted from the
 * file — the preview would just quietly stop rendering.
 *
 * The tags come from `src/seo/meta.ts` as data, so the values are asserted
 * directly here; the layout is read only to prove it still emits every one of
 * them. Regenerate the images with `make og` (tools/og/shoot.mjs).
 */
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { OG_W, OG_H } from '../dev/OgCard'
import { ORIGIN, OG_IMAGE, HOME, LANGS, absolute, social, type Lang } from '../seo/meta'

const CLIENT = path.resolve(__dirname, '..', '..')
const layout = readFileSync(path.join(CLIENT, 'src', 'layouts', 'Base.astro'), 'utf8')

/** The PNG a language's `og:image` points at, stripped of its cache buster. */
function imageFor(lang: Lang): string {
  return path.join(CLIENT, 'public', OG_IMAGE.path[lang].replace(/^\//, '').replace(/\?.*$/, ''))
}

/** Width/height out of a PNG's IHDR chunk — bytes 16..24, big-endian. */
function pngSize(buf: Buffer): { width: number; height: number } {
  expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG')
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

describe('link preview (Open Graph / X)', () => {
  it.each(LANGS)('ships a %s image at the size the tags promise', (lang) => {
    const file = imageFor(lang)
    // A tag pointing at a missing file is the failure mode with no symptom: the
    // preview simply does not render, and nothing in the app ever asks for it.
    expect(existsSync(file), `${path.relative(CLIENT, file)} is missing — run make og`).toBe(true)
    const { width, height } = pngSize(readFileSync(file))
    // Three sources agree or the platform crops it: the file on disk, the scene
    // that draws it, and the numbers the tags declare.
    expect({ width, height }).toEqual({ width: OG_W, height: OG_H })
    expect({ width: OG_IMAGE.width, height: OG_IMAGE.height }).toEqual({ width, height })
  })

  it('declares every tag Discord and X need', () => {
    // summary_large_image is what turns X's preview from a thumbnail into the
    // full 1.91:1 card. Without it the artwork is a 120px square.
    expect(layout).toContain('content="summary_large_image"')
    for (const key of [
      'og:type',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:alt',
      'og:locale',
      'twitter:image',
    ]) {
      expect(layout, key).toContain(`"${key}"`)
    }
    for (const lang of LANGS) {
      const { title, description } = social(HOME, lang)
      expect(title, lang).toBeTruthy()
      expect(description, lang).toBeTruthy()
      expect(OG_IMAGE.alt[lang], lang).toBeTruthy()
    }
  })

  it('points at absolute URLs', () => {
    // Crawlers resolve og:image against nothing; a relative path is not fetched.
    // The origin is baked in at build time, so what has to hold is that every
    // one of these is absolute rather than site-relative.
    expect(ORIGIN).toMatch(/^https?:\/\/[^/]+$/)
    for (const lang of LANGS) {
      expect(absolute(OG_IMAGE.path[lang])).toMatch(/^https?:\/\//)
      expect(absolute(HOME.path[lang])).toMatch(/^https?:\/\//)
    }
    // The layout must build them through `absolute()` rather than writing a
    // path straight into the tag, which is the failure this guards.
    expect(layout).toContain('absolute(')
  })

  it('cache-busts each image URL', () => {
    // Both platforms cache a preview by URL for days. The ?v= is the only way
    // to make them re-fetch after the art changes.
    for (const lang of LANGS) {
      expect(OG_IMAGE.path[lang], lang).toMatch(/\?v=\d+$/)
    }
  })
})
