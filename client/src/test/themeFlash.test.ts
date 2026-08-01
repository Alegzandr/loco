/**
 * The dark palette has to be true of the first frame, not of the first script.
 *
 * A content page is a stylesheet and one deferred module. The module writes
 * `[data-theme]`, and until it runs the browser paints the light palette — so
 * every navigation between pages flashed white for a player whose system is set
 * to dark. `tokens.css` answers that with the same palette behind
 * `@media (prefers-color-scheme: dark)`, which the browser knows at parse time.
 *
 * That is a duplicated block, and a duplicated palette drifts. This is the only
 * thing standing between the two, so it compares them declaration by
 * declaration rather than checking the media query merely exists.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CSS = readFileSync(
  path.resolve(__dirname, '..', 'styles', 'tokens.css'),
  'utf8',
)

/** Every `--token: value` pair inside a block, in source order. */
function declarations(block: string): string[] {
  return [...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(
    (m) => `${m[1]}: ${m[2].replace(/\s+/g, ' ').trim()}`,
  )
}

describe('the dark palette', () => {
  const attribute = /\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(CSS)?.[1]
  const media = /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme='light'\]\)\s*\{([^}]*)\}/
    .exec(CSS)?.[1]

  it('is applied before any script runs', () => {
    expect(attribute, "no [data-theme='dark'] block — is this the right file?").toBeTruthy()
    expect(media, 'the system-preference block is gone: dark systems flash white again').toBeTruthy()
  })

  it('says exactly the same thing in both places', () => {
    // Not a subset either way: a token added to one and not the other is a
    // colour that changes the moment the script lands, which is the flash in a
    // different disguise.
    expect(declarations(media!)).toEqual(declarations(attribute!))
  })

  it('lets an explicit choice beat the system', () => {
    // `:not([data-theme='light'])` is the whole mechanism: without it a player
    // on a dark system who picked the light theme would be handed dark tokens
    // at a higher specificity and never get their choice back.
    expect(CSS).toContain(":root:not([data-theme='light'])")
  })
})
