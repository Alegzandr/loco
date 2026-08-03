/**
 * The docs name files. `CLAUDE.md` is a map of the repository before it is
 * anything else, and a map that names a road nobody built is worse than no map:
 * the next reader goes looking, finds nothing, and has to work out whether the
 * file was deleted or never existed.
 *
 * It has happened twice. `shared/` was listed in the structure section and was
 * never on disk. A card-foil system (`.foil`, `.glint`, `holoOffsetMs`) was
 * described in detail and existed nowhere, which is the incident `CLAUDE.md`'s
 * own testing section still carries as a warning.
 *
 * So every path the docs put in backticks has to resolve. They are written at
 * whatever depth the surrounding paragraph makes readable (`hub/rooms.go` in a
 * server section, a bare `layout.ts` in a paragraph already about the card
 * renderer), so a token passes if it names any real file or directory in the
 * repository. What it may not do is name nothing at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const REPO = path.resolve(__dirname, '..', '..', '..')

const SKIP = new Set([
  'node_modules', '.git', 'dist', '.astro', '.visual', 'coverage',
  'test-results', 'playwright-report', '.vscode', '.idea',
])

/** Every file and directory in the repository, as posix paths from the root. */
function walk(dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const abs = path.join(dir, name)
    const rel = prefix ? `${prefix}/${name}` : name
    out.push(rel)
    if (statSync(abs).isDirectory()) out.push(...walk(abs, rel))
  }
  return out
}

const TREE = walk(REPO)

/**
 * Tokens that look like a path but are not one: routes the app serves, CSS and
 * wire values that happen to carry a slash, and glob-ish shapes.
 */
const NOT_A_PATH = [
  /^\//, // a URL the site serves: /fr/, /ws, /metrics, /health
  /[*?<>|${}]/, // globs, placeholders, shell expansions
  /\s/,
  /:/, // docker images, volume mounts, CSS directives, ratios
  /^[@-]/, // npm scopes and CLI flags
  /^[A-Z0-9_]+$/, // env vars
  /^\d/, // versions
  /^\.[^/]*$/, // a bare extension named in prose: .astro, .tsx
]

/**
 * Named by the docs, real, and deliberately not in the tree: one is served by
 * nginx rather than committed, the other is the designer's source file.
 */
const OUTSIDE_THE_REPO = new Set([
  'robots.txt', // served by nginx, never committed
  'logo_canard_geometrique.svg', // the designer's source file
  // Named in order to say the build deliberately has none of them.
  'index.html',
  'vite.config.ts',
  'main.tsx',
  '.visual', // where `make visual` writes its contact sheets
  'xx.ts', // the placeholder in "add a language: create xx.ts"
])

/**
 * A token is only held to account when it says it is a file (an extension we
 * own) or a directory (a trailing slash). Everything else with a slash in it is
 * as likely to be a Go import (`crypto/rand`), a module (`golang.org/x/text`)
 * or a MIME type, and guessing wrong there would make this test a nuisance
 * rather than a guard.
 */
const OURS = /\.(ts|tsx|go|mjs|css|astro|md|yml|json|conf|html|webp|png|svg|txt|ico)$/

const looksLikePath = (t: string) =>
  !NOT_A_PATH.some((re) => re.test(t)) && (OURS.test(t) || t.endsWith('/'))

const resolves = (t: string) => {
  const clean = t.replace(/^\.\//, '').replace(/\/$/, '')
  if (OUTSIDE_THE_REPO.has(clean)) return true
  return TREE.some((p) => p === clean || p.endsWith(`/${clean}`))
}

const docs = [
  'CLAUDE.md',
  'README.md',
  ...readdirSync(path.join(REPO, 'docs', 'notes')).map((f) => `docs/notes/${f}`),
]

describe('every path the docs name exists', () => {
  for (const doc of docs) {
    it(doc, () => {
      const src = readFileSync(path.join(REPO, doc), 'utf8')
      const tokens = [...src.matchAll(/`([^`\n]+)`/g)].map((m) => m[1])
      const missing = [...new Set(tokens.filter(looksLikePath).filter((t) => !resolves(t)))]
      expect(missing, `${doc} names paths that are not on disk`).toEqual([])
    })
  }
})
