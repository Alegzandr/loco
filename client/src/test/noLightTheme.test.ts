/**
 * The site has one palette, and nothing may key on a theme again.
 *
 * There used to be two, behind `[data-theme]` on `<html>` and a media query
 * duplicated in `tokens.css` so the first frame was right. The day palette
 * was dropped on purpose (see the head of `styles/tokens.css`), and what this
 * guards is the quiet way it would come back: one rule scoped to
 * `[data-theme='dark']` that matches nothing, one `prefers-color-scheme`
 * block that paints a second palette for a fifth of visitors, one stored key
 * a screen reads and another does not. A source scan, because none of that
 * errors — a selector that matches nothing is merely dead, and a media query
 * merely a second look nobody reviewed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CLIENT = path.resolve(__dirname, '..', '..')
const ROOT = path.resolve(CLIENT, '..')

/** Every source file under `dir`, recursively, minus what a build leaves behind. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.astro' || name.startsWith('.')) continue
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|svelte|astro|css|mjs|js)$/.test(name)) out.push(p)
  }
  return out
}

const SOURCES = [
  ...walk(path.join(CLIENT, 'src')),
  ...walk(path.join(ROOT, 'e2e', 'tests')),
  ...walk(path.join(ROOT, 'tools')),
].filter((p) => !p.endsWith('noLightTheme.test.ts'))

describe('one palette', () => {
  it('keys nothing on a theme attribute, a colour-scheme query or a stored theme', () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      const src = readFileSync(file, 'utf8')
      for (const needle of ['data-theme', 'prefers-color-scheme', 'loco_theme', 'theme-boot']) {
        if (src.includes(needle)) offenders.push(`${path.relative(ROOT, file)}: ${needle}`)
      }
    }
    expect(offenders, 'a second palette is creeping back').toEqual([])
  })

  it('declares the palette once, on :root, for a dark page', () => {
    const css = readFileSync(path.join(CLIENT, 'src', 'styles', 'tokens.css'), 'utf8')
    expect(css).toMatch(/:root\s*\{[^}]*color-scheme:\s*dark/s)
    // The tokens a component reads are the ones on `:root`, and there is no
    // second block to disagree with them.
    expect((css.match(/--color-canvas:/g) ?? []).length).toBe(1)
  })

  it('tells the browser one colour for its own chrome', () => {
    const base = readFileSync(path.join(CLIENT, 'src', 'layouts', 'Base.astro'), 'utf8')
    const metas = base.match(/<meta name="theme-color"[^>]*>/g) ?? []
    expect(metas).toHaveLength(1)
    expect(metas[0]).not.toContain('media=')
  })
})
