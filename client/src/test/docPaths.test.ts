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
  // Astro's dev lock, inside a directory `SKIP` walks past. It exists only while
  // a dev server does, and the note that names it names it in order to say the
  // client command deletes it on every boot.
  '.astro/dev.json',
  'xx.ts', // the placeholder in "add a language: create xx.ts"
  // The CC0 kits `make models` packs from. Git ignores the whole directory: it
  // is an input the maintainer unpacks by hand, and the docs name it in order
  // to say where to put them.
  '.assets-in/unpacked',
  // Retired by the move to SvelteKit and named by the notes in order to say what
  // replaced them — the history of a rule is half its reasoning. A file listed
  // here that comes back into the tree is fine; one the docs name that is in
  // neither place is still a failure.
  'src/entry.ts',
  'entry.ts',
  'src/langSwap.ts',
  'langSwap.ts',
  'src/homeSheet.ts',
  'homeSheet.ts',
  'content/page-boot.ts',
  'page-boot.ts',
  'content/navMenu.ts',
  'navMenu.ts',
  'homeLangSwap.test.ts',
  'GamePage.svelte',
  'ContentPage.svelte',
  // Named in order to say the boot is deliberately not there.
  'hooks.client.ts',
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

/**
 * Built by `npm run build` and never committed, so absent from a fresh
 * checkout (which is where CI runs this, before the build).
 */
const BUILD_OUTPUT = new Set(['client/build', 'csp-hashes.conf', 'version.json'])

/**
 * The Go server, deleted at the cutover to Rust, is still what much of the
 * prose names (`hub/rooms.go`, `server/hub/`), and rewriting that prose is its
 * own pass. Until it lands, a Go path counts as resolved when the Rust module
 * that replaced it is on disk — one module per Go file, so `hub/rooms.go` is
 * `server/crates/loco-hub/src/rooms.rs` — and a Go package directory when its
 * crate is. A Go name with no Rust twin still fails, so the guard keeps
 * catching a name that points at nothing. Delete this with the last Go path.
 */
const GO_PACKAGE_CRATE: Record<string, string> = {
  game: 'loco-game',
  hub: 'loco-hub',
  protocol: 'loco-protocol',
  janus: 'loco-janus',
  twitch: 'loco-twitch',
  'cmd/protocolgen': 'protocolgen',
}
/** Go files whose Rust module took another name, or that became no module. */
const GO_RENAMED: Record<string, string> = {
  'converter.go': 'convert.rs',
  'config.go': 'config.rs',
  'enums.go': 'enums.rs',
  'messages.go': 'dto.rs',
  'rules.go': 'rules.rs',
  'client.go': 'client.rs',
  'loop_bench_test.go': 'benches/hub.rs',
  'messages_test.go': 'tests/parity.rs',
}
const RUST_FILES = TREE.filter((p) => p.startsWith('server/') && p.endsWith('.rs'))
const RETIRED_GO = new Set(['server/.golangci.yml', '.golangci.yml'])

function goTwinResolves(clean: string): boolean {
  if (RETIRED_GO.has(clean)) return true
  const dir = clean.replace(/^server\//, '')
  if (dir in GO_PACKAGE_CRATE) return TREE.includes(`server/crates/${GO_PACKAGE_CRATE[dir]}`)
  // Something kept inside a package, a word list say: the same path in its crate.
  const pkg = Object.keys(GO_PACKAGE_CRATE).find((k) => dir.startsWith(`${k}/`))
  if (pkg && !dir.endsWith('.go')) {
    return TREE.includes(`server/crates/${GO_PACKAGE_CRATE[pkg]}/${dir.slice(pkg.length + 1)}`)
  }
  if (!clean.endsWith('.go')) return false
  const base = clean.split('/').pop()!
  const renamed = GO_RENAMED[base]
  if (renamed) return TREE.some((p) => p.startsWith('server/') && p.endsWith(renamed))
  // A Go test file is a Rust test of the same name, under tests/ or
  // src/internal_tests/, or a unit test inside the module it tests.
  const stem = base.replace(/(_internal)?_test\.go$/, '').replace(/\.go$/, '')
  return RUST_FILES.some((p) =>
    [`/${stem}.rs`, `/${stem}_internal.rs`, `/${stem}_test.rs`].some((end) => p.endsWith(end)),
  )
}

const resolves = (t: string) => {
  const clean = t
    .replace(/^\.\//, '')
    .replace(/\/$/, '')
    // The Rust tree was server-rs/ until it replaced the Go one.
    .replace(/^server-rs\//, 'server/')
  if (clean === 'server-rs') return true
  if (OUTSIDE_THE_REPO.has(clean) || BUILD_OUTPUT.has(clean)) return true
  if (TREE.some((p) => p === clean || p.endsWith(`/${clean}`))) return true
  return goTwinResolves(clean)
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
