/**
 * The server's source, as the tests that pin a client copy to it read it.
 *
 * Several suites hold a number or a list the server owns against the server's
 * own source (`serverMirrors`, `contentPages`, `maps`, `seatLayout`, `seo`,
 * `legal`): a copy nobody plays against goes wrong silently, so it is checked
 * against the one that is played. Every read goes through here, so the
 * spelling of a Rust constant is decided in one place.
 *
 * Constants are asked for by their old Go names (`catchGrace`), which is how
 * the client copies and the docs name them; `rustConstName` turns one into the
 * crate's spelling. A reader that finds nothing fails its test by name rather
 * than passing on an empty match.
 *
 * Framework-free and test-only: nothing outside `src/test/` imports it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const REPO = path.resolve(__dirname, '..', '..', '..')

/** The two halves of the server a client copy is pinned to. */
export type ServerPackage = 'game' | 'hub'

const CRATE: Record<ServerPackage, string> = { game: 'loco-game', hub: 'loco-hub' }

/** One file of the server, named by its package and its stem (`room`, `deck`). */
export function serverPath(pkg: ServerPackage, stem: string): string {
  return path.join(REPO, 'server', 'crates', CRATE[pkg], 'src', `${stem}.rs`)
}

/** Repo-relative, for a failure message that says where to look. */
export function serverLabel(pkg: ServerPackage, stem: string): string {
  return path.relative(REPO, serverPath(pkg, stem)).replace(/\\/g, '/')
}

// A Windows checkout with core.autocrlf hands these files over in CRLF, and the
// patterns below are written against LF, which is what CI checks out.
export function readServer(pkg: ServerPackage, stem: string): string {
  return readFileSync(serverPath(pkg, stem), 'utf8').replace(/\r\n/g, '\n')
}

/** `catchNearHand` -> `CATCH_NEAR_HAND`: a Go constant's name in Rust. */
export function rustConstName(goName: string): string {
  return goName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}

const RUST_CONST = (goName: string) =>
  new RegExp(`const ${rustConstName(goName)}\\s*:\\s*[^=]+=\\s*([^;]+);`)

const rustInt = (expr: string) => Number(expr.trim().replace(/_/g, '').replace(/(u|i)(8|16|32|64|size)$/, ''))

/** An integer constant, or NaN when the source does not declare it. */
export function serverInt(src: string, goName: string): number {
  const m = src.match(RUST_CONST(goName))
  return m ? rustInt(m[1]) : NaN
}

/** A duration constant in milliseconds, or NaN when the source does not declare it. */
export function serverDurationMs(src: string, goName: string): number {
  // `catchGrace` is `CATCH_GRACE_MS` in loco-game: the unit moved into the name.
  const m = src.match(RUST_CONST(goName)) ?? src.match(RUST_CONST(`${goName}Ms`))
  if (!m) return NaN
  const d = m[1].match(/Duration::from_(secs|millis)\((\d[\d_]*)\)/)
  // A bare integer is a count of milliseconds, the domain's own unit.
  return d ? rustInt(d[2]) * (d[1] === 'secs' ? 1000 : 1) : rustInt(m[1])
}

/**
 * A function's body, from its signature to its closing brace at column 0 or 4
 * (a method sits one level into its `impl`). `rsName` is the Rust name when it
 * is not the Go one in snake case.
 */
export function serverFn(src: string, name: string, rsName = rustName(name)): string | undefined {
  return new RegExp(`fn ${rsName}\\b[^]*?\\n(?: {4})?}`).exec(src)?.[0]
}

/** `NewDeck` -> `new_deck`, `generateCode` -> `generate_code`. */
export function rustName(goName: string): string {
  return goName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** The table code's alphabet and length, as `join_room` validates it. */
export function serverRoomCodeRule(): { chars: string; length: number } | undefined {
  const src = readServer('hub', 'rooms')
  const chars = src.match(/const ROOM_CODE_CHARS\s*:[^=]+=\s*b?"([^"]+)"/)?.[1]
  const length = serverInt(src, 'roomCodeLen')
  return chars && Number.isInteger(length) ? { chars, length } : undefined
}

/** The alphabet and length a table code is drawn from. */
export function serverCodeAlphabet(): { chars: string; length: number } | undefined {
  const src = readServer('hub', 'tokens')
  // Scoped to the generator's own body: the session token in the same file
  // draws its own bytes, and matching that one would pin the code's length to
  // a number that has nothing to do with it.
  const body = serverFn(src, 'generateCode')
  if (!body) return undefined
  const chars = body.match(/CHARS\s*:[^=]+=\s*b?"([^"]+)"/)?.[1]
  const length = Number(body.match(/(?:0\.\.|take\()(\d+)/)?.[1])
  return chars && Number.isInteger(length) ? { chars, length } : undefined
}

/** The deck builder's body. */
export function serverDeckBody(): string | undefined {
  // Go's `NewDeck()` is `Deck::standard()` in loco-game.
  return serverFn(readServer('game', 'deck'), 'NewDeck', 'standard')
}

/** The number cards' range, off the deck builder's loop. */
export function serverNumberRange(body: string): { low: number; high: number } | undefined {
  // `for v in NUMBER_LOW..=NUMBER_HIGH`, the bounds declared beside the deck.
  if (!/for v in NUMBER_LOW\.\.=NUMBER_HIGH/.test(body)) return undefined
  const src = readServer('game', 'deck')
  const low = serverInt(src, 'numberLow')
  const high = serverInt(src, 'numberHigh')
  return Number.isInteger(low) && Number.isInteger(high) ? { low, high } : undefined
}

/** How many times the deck builder appends a card of this domain kind. */
export function serverKindAppends(body: string, kind: string): number {
  return (body.match(new RegExp(`kind: Kind::${kind}\\b`, 'g')) ?? []).length
}

/** The points `CardValue` gives a domain kind, or undefined when it has no case. */
export function serverCardValue(kind: string): number | undefined {
  const fn = serverFn(readServer('game', 'card'), 'CardValue', 'card_value')
  if (!fn) return undefined
  const m = new RegExp(`Kind::${kind}\\b[^=\\n]*=>\\s*(\\d+)`).exec(fn)
  return m ? Number(m[1]) : undefined
}

/** Whether `CardValue` scores a number card at its face value. */
export function serverNumberScoresFace(): boolean {
  const fn = serverFn(readServer('game', 'card'), 'CardValue', 'card_value') ?? ''
  return /Kind::Number => c\.value/.test(fn)
}

/**
 * The values of one string enum of the maps module, in the order its list
 * names them: `const MAP_IDS: [MapId; 6] = [MapId::Neon, ...]` + the `as_str`
 * match arm `MapId::Neon => "neon",`. `typeName` is the Go type's name, kept
 * so a caller reads the same either way.
 */
export function serverMapList(src: string, listName: string, _typeName: string): string[] | undefined {
  const list = src.match(new RegExp(`const ${rustConstName(listName)}\\s*:[^=]+=\\s*\\[([^\\]]+)\\]`))
  if (!list) return undefined
  return list[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => rustWire(src, v))
}

/** `MapId::Neon` -> `"neon"`, off the `as_str` match arm that spells it. */
function rustWire(src: string, path: string): string {
  const variant = path.trim().replace(/^\w+::/, '')
  return src.match(new RegExp(`\\b${variant}\\s*(?:=>|=)\\s*"([a-z_]+)"`))?.[1] ?? `<${variant} has no value>`
}

/** Every map's allowed weathers, id -> weathers. */
export function serverMapWeathers(src: string): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  // `const MAP_WEATHERS: [(MapId, &[Weather]); 6] = [(MapId::Neon, &[Weather::Clear, ...]), ...];`
  const block = src.match(/const MAP_WEATHERS\s*:[^=]+=\s*\[([\s\S]+?)\n\];/)
  if (!block) return undefined
  for (const m of block[1].matchAll(/\(\s*(\w+::\w+),\s*&\[([^\]]+)\]/g)) {
    out[rustWire(src, m[1])] = m[2]
      .split(',')
      .filter((w) => w.trim())
      .map((w) => rustWire(src, w))
  }
  return out
}

/**
 * The hub's own source files, tests excluded, minus the one that is allowed to
 * read a peer's address (the truncation itself).
 */
export function serverHubSources(): { file: string; src: string }[] {
  const dir = path.join(REPO, 'server', 'crates', 'loco-hub', 'src')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.rs') && f !== 'privacy.rs')
    .filter((f) => statSync(path.join(dir, f)).isFile())
    .map((f) => ({ file: f, src: readFileSync(path.join(dir, f), 'utf8') }))
}

/** A read of the peer's full address: `remote_addr` / `peer_addr()`. */
export const FULL_ADDRESS_READ: RegExp = /\bremote_addr\b|\bpeer_addr\(\)/
