/**
 * LOCO has no gameplay keyboard shortcuts, and it is not going to get any.
 *
 * Aiming a mouse at a button that lights up for a few seconds **is** the skill
 * the game measures. LOCO! and Contre-LOCO! on a key do not assist that gesture,
 * they delete it: you stop aiming and start pressing. The same goes for drawing,
 * passing and playing the n-th card. The action bar is a fixed three-column grid
 * so the cursor can park on the button it is about to need — a shortcut would
 * make that work pointless, which is why the fixed bar and the absence of
 * shortcuts are one decision seen from two sides.
 *
 * **The line this test draws is global vs focused.** A *global* handler acts
 * without anyone having aimed at anything: it is refused. A *focused* control —
 * a card or the draw pile answering Enter/Space once tabbed to, the language
 * listbox answering arrows and Home/End — demands that you got there first, and
 * it is the accessibility path `PRODUCT.md` commits to at WCAG AA. It is
 * mandatory and must never be removed in the name of the rule above. Handlers
 * bound to an element (`onkeydown={...}`) are exactly that, and this test does
 * not look at them.
 *
 * So: a `keydown`/`keyup` listener on `window` or `document` is allowed in three
 * places and nowhere else — the score table held on TAB, the one Escape hook,
 * and the audio unlock that rides the first gesture of any kind. Everywhere
 * else a global key listener may read `Escape` and nothing else, which is the
 * same dismissal the Escape hook provides, reached by a panel that owns its own
 * lifetime.
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

/** The three that may read a key other than Escape off window/document. */
const ALLOWED = [
  // heldKey: the score table, held on TAB. A modifier-free key that shows a
  // read-only panel and moves nothing on the board.
  join('hooks', 'viewEffects.svelte.ts'),
  // The one Escape hook every overlay in the game closes through.
  join('hooks', 'escapeKey.svelte.ts'),
  // Mobile Safari hands the audio context back on a gesture, any gesture. This
  // one listens for a key press as evidence a human is there, and reads nothing.
  join('hooks', 'appEffects.svelte.ts'),
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === 'test' || name === 'types') continue
      walk(full, out)
      continue
    }
    if (/\.(ts|svelte)$/.test(name)) out.push(full)
  }
  return out
}

/** Every `window|document.addEventListener('keydown'|'keyup', …)` in a file. */
function globalKeyListeners(src: string): { handler: string; index: number }[] {
  const re = /(?:window|document)\.addEventListener\(\s*['"]key(?:down|up)['"]\s*,\s*/g
  const out: { handler: string; index: number }[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    out.push({ handler: src.slice(m.index + m[0].length), index: m.index })
  }
  return out
}

/**
 * The source of the handler at a registration site: the inline arrow's body, or
 * the body of the named function declared above it. Falls back to the whole file
 * when it cannot tell, which fails loud rather than passing quietly.
 */
function handlerBody(src: string, atCall: string): string {
  const named = atCall.match(/^([A-Za-z_$][\w$]*)\s*[,)]/)
  const start = named
    ? src.search(new RegExp(`(?:const|let|function)\\s+${named[1]}\\b`))
    : -1
  const from = named ? start : 0
  if (named && start < 0) return src
  const body = named ? src.slice(start) : atCall
  const open = body.indexOf('{')
  if (open < 0) return src
  let depth = 0
  for (let i = open; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}') {
      depth--
      if (depth === 0) return body.slice(open, i + 1)
    }
  }
  return src.slice(from)
}

const files = walk(SRC)

describe('no gameplay keyboard shortcuts', () => {
  it('finds the three listeners that are allowed to read a key globally', () => {
    // A guard whose allowlist has gone stale passes forever. This is the
    // assertion that fails when one of them is renamed or moved.
    for (const rel of ALLOWED) {
      const full = join(SRC, rel)
      const src = readFileSync(full, 'utf8')
      expect(globalKeyListeners(src).length, `${rel} registers no global key listener`)
        .toBeGreaterThan(0)
    }
  })

  it('lets no other global key listener read anything but Escape', () => {
    const offenders: string[] = []
    for (const file of files) {
      const rel = file.slice(SRC.length + 1)
      if (ALLOWED.some((a) => rel.endsWith(a))) continue
      const src = readFileSync(file, 'utf8')
      for (const site of globalKeyListeners(src)) {
        const body = handlerBody(src, site.handler)
        // Every key the handler names. Anything but Escape is a shortcut: it
        // acts on a press nobody aimed, which is the whole thing being refused.
        const keys = [...body.matchAll(/\.(?:key|code)\s*[=!]==?\s*['"]([^'"]+)['"]/g)].map(
          (m) => m[1],
        )
        const bad = keys.filter((k) => k !== 'Escape')
        if (bad.length > 0 || keys.length === 0) {
          offenders.push(`${rel}: ${bad.length ? bad.join(', ') : 'reads no key at all'}`)
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('leaves handlers bound to an element alone: that is the accessibility path', () => {
    // Not a shortcut. A card and the draw pile are reachable by TAB and act on
    // Enter/Space once focused, and the language listbox answers arrows and
    // Home/End on its own button. Removing any of it in the name of the rule
    // above would be reading the rule backwards.
    const card = readFileSync(join(SRC, 'components', 'cards', 'Card.svelte'), 'utf8')
    const deck = readFileSync(join(SRC, 'components', 'cards', 'Deck.svelte'), 'utf8')
    const lang = readFileSync(join(SRC, 'components', 'LanguageSwitcher.svelte'), 'utf8')
    expect(card).toMatch(/onkeydown=/)
    expect(deck).toMatch(/onkeydown=/)
    expect(lang).toMatch(/onkeydown=/)
  })
})
