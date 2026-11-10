/**
 * The server's source, as the tests that pin a client copy to it read it.
 *
 * Several suites hold a number or a list the server owns against the server's
 * own source (`serverMirrors`, `contentPages`, `maps`, `seatLayout`, `seo`,
 * `legal`): a copy nobody plays against goes wrong silently, so it is checked
 * against the one that is played. The server is moving from Go (`server/`) to
 * Rust (`server-rs/`), and both spell the same constant differently, so every
 * read goes through here and the switch is one constant.
 *
 * `SERVER_SOURCE` stays `'go'` until the cutover. The Rust half of every
 * `game` reader is checked against `loco-game` as it stands
 * (`LOCO_SERVER_SOURCE=rs` passes them all). The three `hub` readers (the room
 * code rule, the code alphabet, the full-address rule) are written against the
 * names `loco-hub` is expected to use and are confirmed when that crate lands;
 * a reader that finds nothing fails its test by name rather than passing on an
 * empty match.
 *
 * Framework-free and test-only: nothing outside `src/test/` imports it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export type ServerSource = 'go' | 'rs'

/**
 * Which server the source-pinning tests read. Flipped once, at the cutover.
 * `LOCO_SERVER_SOURCE=rs npx vitest run` reads the Rust tree ahead of it.
 */
export const SERVER_SOURCE: ServerSource = process.env.LOCO_SERVER_SOURCE === 'rs' ? 'rs' : 'go'

export const REPO = path.resolve(__dirname, '..', '..', '..')

/** The two halves of the server a client copy is pinned to. */
export type ServerPackage = 'game' | 'hub'

const CRATE: Record<ServerPackage, string> = { game: 'loco-game', hub: 'loco-hub' }

/** One file of the server, named by its package and its stem (`room`, `deck`). */
export function serverPath(pkg: ServerPackage, stem: string, source: ServerSource = SERVER_SOURCE): string {
  return source === 'go'
    ? path.join(REPO, 'server', pkg, `${stem}.go`)
    : path.join(REPO, 'server-rs', 'crates', CRATE[pkg], 'src', `${stem}.rs`)
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
  if (SERVER_SOURCE === 'go') return Number(src.match(new RegExp(`\\b${goName}\\s*=\\s*(\\d+)`))?.[1])
  const m = src.match(RUST_CONST(goName))
  return m ? rustInt(m[1]) : NaN
}

/** A duration constant in milliseconds, or NaN when the source does not declare it. */
export function serverDurationMs(src: string, goName: string): number {
  if (SERVER_SOURCE === 'go') {
    const m = src.match(new RegExp(`\\n\\t${goName} = (\\d+) \\* time\\.(Second|Millisecond)\\n`))
    return m ? Number(m[1]) * (m[2] === 'Second' ? 1000 : 1) : NaN
  }
  // `catchGrace` is `CATCH_GRACE_MS` in loco-game: the unit moved into the name.
  const m = src.match(RUST_CONST(goName)) ?? src.match(RUST_CONST(`${goName}Ms`))
  if (!m) return NaN
  const d = m[1].match(/Duration::from_(secs|millis)\((\d[\d_]*)\)/)
  // A bare integer is a count of milliseconds, the domain's own unit.
  return d ? rustInt(d[2]) * (d[1] === 'secs' ? 1000 : 1) : rustInt(m[1])
}

/**
 * A function's body, from its signature to its closing brace: column 0 in Go,
 * column 0 or 4 in Rust (a method sits one level into its `impl`). `rsName` is
 * the Rust name when it is not the Go one in snake case.
 */
export function serverFn(src: string, name: string, rsName = rustName(name)): string | undefined {
  const re =
    SERVER_SOURCE === 'go'
      ? new RegExp(`func (?:\\([^)]*\\) )?${name}\\([^]*?\\n}`)
      : new RegExp(`fn ${rsName}\\b[^]*?\\n(?: {4})?}`)
  return re.exec(src)?.[0]
}

/** `NewDeck` -> `new_deck`, `generateCode` -> `generate_code`. */
export function rustName(goName: string): string {
  return goName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

/** The table code's alphabet and length, as `join_room` validates it. */
export function serverRoomCodeRule(): { chars: string; length: number } | undefined {
  const src = readServer('hub', 'rooms')
  if (SERVER_SOURCE === 'go') {
    const m = src.match(/roomCodeRe = regexp\.MustCompile\(`\^\[([^\]]+)\]\{(\d+)\}\$`\)/)
    return m ? { chars: m[1], length: Number(m[2]) } : undefined
  }
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
  const chars = body.match(SERVER_SOURCE === 'go' ? /const chars = "([^"]+)"/ : /CHARS\s*:[^=]+=\s*b?"([^"]+)"/)?.[1]
  const length =
    SERVER_SOURCE === 'go'
      ? Number(body.match(/make\(\[\]byte, (\d+)\)/)?.[1])
      : Number(body.match(/(?:0\.\.|take\()(\d+)/)?.[1])
  return chars && Number.isInteger(length) ? { chars, length } : undefined
}

/** The deck builder's body. */
export function serverDeckBody(): string | undefined {
  // Go's `NewDeck()` is `Deck::new()` in loco-game.
  return serverFn(readServer('game', 'deck'), 'NewDeck', 'new')
}

/** The number cards' range, off the deck builder's loop. */
export function serverNumberRange(body: string): { low: number; high: number } | undefined {
  if (SERVER_SOURCE === 'go') {
    const m = /for v := (\d+); v <= (\d+); v\+\+/.exec(body)
    return m ? { low: Number(m[1]), high: Number(m[2]) } : undefined
  }
  // `for v in NUMBER_LOW..=NUMBER_HIGH`, the bounds declared beside the deck.
  if (!/for v in NUMBER_LOW\.\.=NUMBER_HIGH/.test(body)) return undefined
  const src = readServer('game', 'deck')
  const low = serverInt(src, 'numberLow')
  const high = serverInt(src, 'numberHigh')
  return Number.isInteger(low) && Number.isInteger(high) ? { low, high } : undefined
}

/** How many times the deck builder appends a card of this domain kind. */
export function serverKindAppends(body: string, kind: string): number {
  const re = SERVER_SOURCE === 'go' ? new RegExp(`Kind: ${kind}\\b`, 'g') : new RegExp(`kind: Kind::${kind}\\b`, 'g')
  return (body.match(re) ?? []).length
}

/** The points `CardValue` gives a domain kind, or undefined when it has no case. */
export function serverCardValue(kind: string): number | undefined {
  const fn = serverFn(readServer('game', 'card'), 'CardValue', 'card_value')
  if (!fn) return undefined
  const m =
    SERVER_SOURCE === 'go'
      ? new RegExp(`case[^:\\n]*\\b${kind}\\b[^:\\n]*:\\s*\\n\\s*return (\\d+)`).exec(fn)
      : new RegExp(`Kind::${kind}\\b[^=\\n]*=>\\s*(\\d+)`).exec(fn)
  return m ? Number(m[1]) : undefined
}

/** Whether `CardValue` scores a number card at its face value. */
export function serverNumberScoresFace(): boolean {
  const fn = serverFn(readServer('game', 'card'), 'CardValue', 'card_value') ?? ''
  return SERVER_SOURCE === 'go' ? /case Number:\s*\n\s*return c\.Value/.test(fn) : /Kind::Number => c\.value/.test(fn)
}

/**
 * The values of one string enum of the maps module, in the order its list
 * names them: Go's `var MapIDs = []MapID{MapNeon, ...}` + `MapNeon MapID =
 * "neon"`, Rust's `const MAP_IDS: [MapId; 6] = [MapId::Neon, ...]` + the
 * `string_enum!` line `Neon = "neon",`.
 */
export function serverMapList(src: string, listName: string, typeName: string): string[] | undefined {
  if (SERVER_SOURCE === 'go') {
    const slice = src.match(new RegExp(`var ${listName} = \\[\\]${typeName}\\{([^}]+)\\}`))
    if (!slice) return undefined
    return slice[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((name) => src.match(new RegExp(`${name}\\s+${typeName} = "([a-z]+)"`))?.[1] ?? `<${name} has no value>`)
  }
  const list = src.match(new RegExp(`const ${rustConstName(listName)}\\s*:[^=]+=\\s*\\[([^\\]]+)\\]`))
  if (!list) return undefined
  return list[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((v) => rustWire(src, v))
}

/** `MapId::Neon` -> `"neon"`, off the `string_enum!` block that spells it. */
function rustWire(src: string, path: string): string {
  const variant = path.trim().replace(/^\w+::/, '')
  return src.match(new RegExp(`\\b${variant} = "([a-z_]+)"`))?.[1] ?? `<${variant} has no value>`
}

/** Every map's allowed weathers, id -> weathers. */
export function serverMapWeathers(src: string): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  if (SERVER_SOURCE === 'go') {
    const block = src.match(/var MapWeathers = map\[MapID\]\[\]Weather\{([\s\S]+?)\n\}/)
    if (!block) return undefined
    for (const line of block[1].split('\n')) {
      const m = line.match(/(Map[A-Z][a-z]+):\s*\{([^}]+)\}/)
      if (!m) continue
      const id = src.match(new RegExp(`${m[1]}\\s+MapID = "([a-z]+)"`))![1]
      out[id] = m[2].split(',').map((w) => src.match(new RegExp(`${w.trim()}\\s+Weather = "([a-z]+)"`))![1])
    }
    return out
  }
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
  const dir = SERVER_SOURCE === 'go' ? path.join(REPO, 'server', 'hub') : path.join(REPO, 'server-rs', 'crates', 'loco-hub', 'src')
  const ext = SERVER_SOURCE === 'go' ? '.go' : '.rs'
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext) && !f.endsWith('_test.go') && f !== `privacy${ext}`)
    .filter((f) => statSync(path.join(dir, f)).isFile())
    .map((f) => ({ file: f, src: readFileSync(path.join(dir, f), 'utf8') }))
}

/** A read of the peer's full address: Go's `RemoteAddr`, Rust's `remote_addr` / `peer_addr`. */
export const FULL_ADDRESS_READ: RegExp =
  SERVER_SOURCE === 'go' ? /RemoteAddr\(\)|[^(]r\.RemoteAddr/ : /\bremote_addr\b|\bpeer_addr\(\)/
