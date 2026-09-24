/**
 * `.hit-target`'s `::after` belongs to `.hit-target`, on every control that
 * wears it.
 *
 * The global rule (`styles/tokens.css`) places that pseudo-element with
 * `top: 50%; left: 50%` and centres it with `translate(-50%, -50%)`. A
 * component rule that borrows the same `::after` for a paint of its own
 * overrides the placement and keeps the translation: the turn pill's penalty
 * wash did exactly that, its `inset: 0` pinned the corner and the transform
 * dragged it half a pill up and to the left, where it throbbed beside the
 * "Draw 4" it was meant to light. A paint goes on `::before` or on an element.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

const SRC = join(process.cwd(), 'src')

function svelteFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return svelteFiles(p)
    return p.endsWith('.svelte') ? [p] : []
  })
}

/** The other classes on every element of `markup` that carries `.hit-target`. */
function hitTargetClasses(markup: string): Set<string> {
  const found = new Set<string>()
  // From one `<` to the next: lenient about `>` inside `{…}`, and the class
  // attribute is all that is read off it.
  for (const chunk of markup.split('<')) {
    if (!/\bhit-target\b/.test(chunk)) continue
    const attr = chunk.match(/\bclass="([^"]*)"/)
    for (const c of attr?.[1].split(/\s+/) ?? []) if (c && c !== 'hit-target') found.add(c)
  }
  return found
}

describe('.hit-target owns its ::after', () => {
  const files = svelteFiles(SRC)

  it('finds the controls it is guarding', () => {
    const turnPill = files.find((f) => f.endsWith('TurnIndicator.svelte'))!
    expect(hitTargetClasses(readFileSync(turnPill, 'utf8')).has('penalty')).toBe(true)
  })

  it.each(files.map((f) => [f.slice(SRC.length + 1), f]))('%s', (_name, file) => {
    const src = readFileSync(file, 'utf8')
    const style = src.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
    const markup = src.replace(/<style[\s\S]*?<\/style>/, '').replace(/<script[\s\S]*?<\/script>/g, '')
    const css = style.replace(/\/\*[\s\S]*?\*\//g, '')
    const borrowed = [...hitTargetClasses(markup)].filter((c) =>
      new RegExp(`\\.${c}(?![\\w-])[^{},]*::after`).test(css),
    )
    expect(borrowed).toEqual([])
  })
})
