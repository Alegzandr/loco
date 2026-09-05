/**
 * Every component compiles clean.
 *
 * Not a style rule. `make dev` printed thirty-three warnings on boot — one wall
 * of `state_referenced_locally` and four a11y lines — and every one of them was
 * expected: a prop read once at setup is exactly what those components meant,
 * and a card's `role` and `tabindex` are one decision the compiler cannot see
 * agreeing with itself. A boot that always says thirty-three things is a boot
 * nobody reads, which is the whole cost: the thirty-fourth warning, the one
 * about a handler that will never fire or a prop the compiler has decided is
 * static, arrives in the same scroll and is never seen.
 *
 * So the expected ones are written down instead — `untrack(() => prop)` where
 * the capture is deliberate, a closure where it is not, `tabindex="-1"` on the
 * three dialogs, one justified `svelte-ignore` on the card — and this keeps the
 * count at zero so the next one stands alone.
 *
 * `dev: true` because that is what `vite-plugin-svelte` compiles with under
 * `make dev`, and the a11y and state checks only run there.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { compile } from 'svelte/compiler'
import { describe, it, expect } from 'vitest'

const SRC = join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full, out)
      continue
    }
    if (name.endsWith('.svelte')) out.push(full)
  }
  return out
}

describe('the Svelte compiler has nothing to say', () => {
  it('compiles every component with no warnings', () => {
    const files = walk(SRC)
    // A count of zero over a list that turned out empty passes forever.
    expect(files.length).toBeGreaterThan(30)

    const offenders: string[] = []
    for (const file of files) {
      const { warnings } = compile(readFileSync(file, 'utf8'), { filename: file, dev: true })
      for (const w of warnings) {
        offenders.push(`${relative(SRC, file)}:${w.start?.line}  [${w.code}] ${w.message}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
