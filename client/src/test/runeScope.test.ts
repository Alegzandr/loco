/**
 * A rune only exists where the compiler looks for one.
 *
 * `src/hooks/` splits in two on purpose: `.svelte.ts` is anything owning
 * reactive state or an effect, and everything else is framework-free so a
 * content page can import it without dragging Svelte onto a document that mounts
 * nothing. The extension is the whole declaration — and it is enforced by the
 * compiler in one direction only.
 *
 * That is the reason this file exists. Svelte compiles runes in `.svelte` and
 * `.svelte.ts` files and nowhere else, so `$state()` written in a plain `.ts`
 * is not a build error: it survives the transform untouched and becomes a call
 * to a global that does not exist, thrown at whatever moment that line first
 * runs. In a preference module read once at boot that is a blank page; in a
 * branch reached only mid-match it is a table that dies on a card nobody has
 * played yet. Nothing between writing it and a player hitting it says a word.
 *
 * Comments are stripped before matching, deliberately: half the value of the
 * split is written down in prose next to the code that obeys it, and a file
 * explaining why it holds no `$state` may say so.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CLIENT = path.resolve(__dirname, '..', '..')
const SRC = path.join(CLIENT, 'src')

/** Every plain `.ts` under src/ — the half of the split that must stay inert. */
function plainModules(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) plainModules(full, out)
    else if (entry.endsWith('.ts') && !entry.endsWith('.svelte.ts')) out.push(full)
  }
  return out
}

/** Block and line comments out, string bodies left alone. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
}

// `$host` is deliberately not in this list. It is the one rune this client has
// no use for — it addresses a custom element's host node — and the spelling
// collides with nginx's own `$host`, which `csp.test.ts` asserts against. A
// check that fires on the config language next door is a check people switch off.
const RUNE = /\$(state|derived|effect|props|bindable|inspect)\b/

describe('runes stay where they are compiled', () => {
  it('no plain .ts module reaches for one', () => {
    const offenders = plainModules(SRC)
      .filter((f) => f !== __filename)
      .filter((f) => RUNE.test(code(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(CLIENT, f))

    expect(
      offenders,
      'these are not compiled by Svelte, so the rune becomes an undefined global at runtime — rename the file to .svelte.ts, or take the reactivity out of it',
    ).toEqual([])
  })

  // The check above is only worth anything if it can actually see a rune, and a
  // regex over stripped source is exactly the kind of assertion that passes
  // forever after a silent mistake. So: prove it fires, and prove the comment
  // exemption is an exemption rather than a hole.
  it('would catch one', () => {
    expect(RUNE.test(code('const open = $state(false)'))).toBe(true)
    expect(RUNE.test(code('$effect(() => {})'))).toBe(true)
    expect(RUNE.test(code('let { a }: Props = $props()'))).toBe(true)
  })

  it('lets a comment name one', () => {
    expect(RUNE.test(code('// this module holds no $state on purpose'))).toBe(false)
    expect(RUNE.test(code('/** Wrapped by a $derived in the caller. */'))).toBe(false)
  })

  // The reactive half has to be non-empty, or the test above is passing over an
  // empty set: a rename that turned every `.svelte.ts` into a plain module would
  // otherwise read as compliance.
  it('finds the reactive half where it belongs', () => {
    const reactive = readdirSync(path.join(SRC, 'hooks')).filter((f) => f.endsWith('.svelte.ts'))
    expect(reactive.length).toBeGreaterThan(5)
  })
})
