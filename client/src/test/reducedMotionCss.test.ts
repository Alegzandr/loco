import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

function cssFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) cssFiles(p, out)
    else if (name.endsWith('.css')) out.push(p)
  }
  return out
}

/**
 * The motion preference has to be able to win over the system setting in both
 * directions, and a media query cannot be overridden from the app. So every
 * reduced-motion rule hangs off `data-motion`, which `useMotionPref` writes on
 * <html> from the OS setting *and* the player's answer.
 *
 * A new `@media (prefers-reduced-motion: reduce)` block would still work for
 * the OS half and silently ignore the preference, which is the kind of thing
 * nobody notices until somebody reports that the switch does nothing.
 */
describe('reduced-motion styling', () => {
  const files = cssFiles('src')

  it('scopes every rule to data-motion rather than to the media query', () => {
    // The at-rule itself, not the words: the feature is still worth naming in
    // a comment.
    const offenders = files.filter((f) =>
      /@media[^{]*prefers-reduced-motion/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('still has the rules it is supposed to have', () => {
    const withRules = files.filter((f) =>
      readFileSync(f, 'utf8').includes('[data-motion="reduce"]'),
    )
    // The blanket rule in tokens.css plus every screen that opted out of its
    // own animation. A refactor that drops them all would otherwise pass the
    // test above by deleting the feature.
    expect(withRules.length).toBeGreaterThan(20)
  })
})
