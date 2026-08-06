/**
 * The Content-Security-Policy is the one piece of configuration that ships to
 * production untested by construction: it lives in `client/nginx.conf`, the E2E
 * suite runs against the Vite dev server (which sends no such header), and a
 * wrong policy produces a *blank page in production* rather than a red build.
 *
 * This file cannot prove the page loads under the policy: only a real browser
 * behind the real nginx can, and CLAUDE.md still asks for that check by hand
 * after any change here. What it can do is pin the two halves together: every
 * assertion below couples a directive to the thing in the app that needs it, so
 * adding an inline script, a CDN or a `new Worker()` goes red here instead of in
 * front of players.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

const CLIENT = path.resolve(__dirname, '..', '..')
const conf = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')
/**
 * The headers themselves live here rather than in nginx.conf, because
 * `add_header` does not merge: see the guard at the bottom of this file, and
 * the comment at the top of the file itself.
 */
const headersConf = readFileSync(path.join(CLIENT, 'security-headers.conf'), 'utf8')

/** Every .astro file: the layouts and pages that produce the served HTML. */
function astroSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) astroSources(full, out)
    else if (entry.endsWith('.astro')) out.push(full)
  }
  return out
}

/** Every .ts/.tsx/.svelte file: the app that ends up in the bundle. */
function bundledSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) bundledSources(full, out)
    else if (/\.(tsx?|svelte)$/.test(entry)) out.push(full)
  }
  return out
}

const astroFiles = astroSources(path.join(CLIENT, 'src'))
/** All of them concatenated, which is what ends up in one page or another. */
const markup = astroFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/** The value of an `add_header <name> "..."` line, plus whether it is `always`. */
function header(name: string): { value: string; always: boolean } {
  const re = new RegExp(`add_header\\s+${name}\\s+"([^"]*)"\\s*(always)?\\s*;`, 'i')
  const m = re.exec(headersConf)
  if (!m) throw new Error(`security-headers.conf sends no ${name} header`)
  return { value: m[1], always: m[2] === 'always' }
}

const csp = header('Content-Security-Policy').value

/** One directive's source list, e.g. directive('script-src') -> "'self'". */
function directive(name: string): string {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp)
  if (!m) throw new Error(`CSP has no ${name} directive: ${csp}`)
  return m[1].trim()
}

/**
 * Every .ts/.tsx/.svelte/.css file the app ships, tests and the dev showcase
 * aside. `.svelte` is in the list because a component written there is markup,
 * script *and* style at once: leaving it out would quietly shrink this scan to
 * whatever has not been migrated yet.
 */
function appSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'test') appSources(full, out)
    } else if (/\.(tsx?|svelte|css)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('Content-Security-Policy (client/nginx.conf)', () => {
  it('keeps script-src closed, and no page inlines a script', () => {
    // These two facts hold each other up. A plain <script> in an .astro file is
    // bundled to an external module, which the policy allows; `is:inline` tells
    // Astro to emit it verbatim into the HTML, which the policy refuses. The
    // difference is one directive in the markup and a blank page in production,
    // and nothing else would catch it: the dev server sends no CSP.
    expect(directive('script-src')).toBe("'self'")
    for (const file of astroFiles) {
      const src = readFileSync(file, 'utf8')
      for (const tag of src.match(/<script[^>]*\bis:inline\b[^>]*>/gi) ?? []) {
        // The one exception, and it is not an exception to the policy: a script
        // whose type is not a JavaScript MIME type is a data block that is never
        // executed, so script-src does not apply to it. Structured data has to
        // be inline to be read at all. Anything else inlined here is refused in
        // production and nowhere else.
        expect(
          /type=["']application\/ld\+json["']/i.test(tag),
          `${path.relative(CLIENT, file)} inlines an executable <script>, which script-src refuses`,
        ).toBe(true)
      }
    }
  })

  it('mounts no Astro island, whose runtime is inlined by construction', () => {
    // This is the trap the migration to Astro walked into once already. A
    // `client:*` directive makes Astro emit its hydration runtime as two inline
    // <script> blocks — not `is:inline`, not opt-in, and not removable by
    // config. `security.csp` answers this with hashes in a <meta>, which does
    // not help: a meta policy and this header are both enforced, so the header
    // still refuses them and the page renders blank in production alone.
    //
    // The game is mounted by src/entry.ts through an ordinary bundled <script>
    // instead, and the content pages need no client JS at all.
    for (const file of astroFiles) {
      const src = readFileSync(file, 'utf8')
      const island = /\bclient:(load|idle|visible|media|only)\b/.exec(src)
      expect(island?.[0], `${path.relative(CLIENT, file)} mounts an island; its runtime is inline`).toBeUndefined()
    }
  })

  it("keeps 'unsafe-inline' in style-src, which the app still needs", () => {
    // Not an oversight. The board is a fixed coordinate space and every card,
    // seat and pile is placed by a `style` attribute holding its pixel position;
    // Astro additionally inlines the stylesheets. Dropping this directive takes
    // the layout with it.
    expect(directive('style-src')).toContain("'unsafe-inline'")

    // Anchored on the thing that actually forces it, in the markup, rather than
    // on the name of whatever wrote it. This assertion used to name
    // framer-motion — and kept passing after framer-motion was removed, because
    // the string survived in the comments explaining its removal. A guard that
    // can be satisfied by prose is not a guard.
    const inlineStyled = bundledSources(path.join(CLIENT, 'src')).filter((f) =>
      /\sstyle=(["'{])/.test(readFileSync(f, 'utf8')),
    )
    expect(
      inlineStyled.length,
      'nothing writes an inline style any more — is style-src still meant to be loose?',
    ).toBeGreaterThan(0)
  })

  it('lets the WebSocket through on the served host, port included', () => {
    const connect = directive('connect-src')
    // A page on http:// and a socket on ws:// are different origins to CSP, so
    // 'self' alone blocks the one connection the game is made of.
    expect(connect).toContain('ws://')
    expect(connect).toContain('wss://')
    // $host drops the port, and a CSP host source with no port means the
    // scheme's default. Identical on :443, blocks everywhere else: a staging
    // host on another port, or anyone running the built image locally.
    expect(connect).not.toMatch(/\$host\b/)
    expect(connect.match(/\$http_host/g)).toHaveLength(2)
  })

  it('names no remote origin anywhere', () => {
    // Fonts are self-hosted via @fontsource and there is no analytics, so the
    // only hosts in the policy are the two WebSocket variables above.
    expect(directive('font-src')).toBe("'self'")
    expect(csp.replace(/wss?:\/\/\$http_host/g, '')).not.toMatch(/[a-z]+:\/\//)
  })

  it('locks down the directives an injected script would reach for', () => {
    expect(directive('default-src')).toBe("'self'")
    expect(directive('object-src')).toBe("'none'")
    expect(directive('base-uri')).toBe("'self'")
    expect(directive('form-action')).toBe("'self'")
    expect(directive('frame-ancestors')).toBe("'none'")
  })

  it('sends every security header on error responses too', () => {
    // Without `always` nginx drops these on anything that is not a 2xx/3xx,
    // i.e. exactly the responses an attacker is most interested in shaping.
    for (const name of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Strict-Transport-Security',
    ]) {
      expect(header(name).always, `${name} is not marked always`).toBe(true)
    }
    expect(header('X-Content-Type-Options').value).toBe('nosniff')
  })

  it('refuses a plaintext first navigation', () => {
    // The response that carries the CSP is also the response that carries the
    // bundle, so an http navigation nobody upgraded is one where both are the
    // attacker's to write. Every entrypoint here is `websecure`, which is what
    // makes this cheap rather than what makes it unnecessary.
    const hsts = header('Strict-Transport-Security').value
    const maxAge = /max-age=(\d+)/.exec(hsts)
    expect(maxAge, 'Strict-Transport-Security carries no max-age').not.toBeNull()
    expect(Number(maxAge![1])).toBeGreaterThanOrEqual(31536000)
    // Both are promises about names this repository does not serve and cannot
    // withdraw once a browser has cached them. See security-headers.conf.
    expect(hsts).not.toMatch(/includeSubDomains|preload/i)
  })

  it('sends them on assets too, not only on the document', () => {
    // The rule nginx enforces and nothing else states: `add_header` is inherited
    // from an outer level *only while the inner level declares none of its own*.
    // One `add_header Cache-Control` inside a location block therefore drops
    // every security header the server block set — for every response that block
    // serves. `location /_astro/` did this, so the whole JS bundle and every
    // optimised asset went out bare while the document response kept all four.
    //
    // Nothing else catches it. `tools/csp/check.mjs` reads headers off the
    // page.goto() response, which is the document; the assertions above read the
    // header values, which were always there. Only the shape of the config says
    // whether they arrive, so this reads the shape.
    const SNIPPET = 'include /etc/nginx/security-headers.conf;'

    // The server block has to include them once, or nothing inherits anything.
    expect(conf, 'nginx.conf never includes the security headers').toContain(SNIPPET)

    // Every `location … { … }` served by this image, by brace matching from its
    // opening. ws-proxy.conf is scanned beside nginx.conf because the socket's
    // location lives there now — two server blocks include it — and a guard that
    // stopped at the file it was written against would have narrowed silently
    // the moment that block moved.
    const sources = [
      { name: 'nginx.conf', text: conf },
      { name: 'ws-proxy.conf', text: readFileSync(path.join(CLIENT, 'ws-proxy.conf'), 'utf8') },
    ]
    const blocks: { spec: string; body: string }[] = []
    for (const { name, text } of sources) {
      const opener = /location\s+([^{]+?)\s*\{/g
      for (let m = opener.exec(text); m; m = opener.exec(text)) {
        let depth = 1
        let i = m.index + m[0].length
        for (; i < text.length && depth > 0; i++) {
          if (text[i] === '{') depth++
          else if (text[i] === '}') depth--
        }
        blocks.push({
          spec: `${m[1].trim()} (${name})`,
          body: text.slice(m.index + m[0].length, i - 1),
        })
      }
    }
    expect(blocks.length, 'no location block was parsed — this guard is asserting nothing').toBeGreaterThan(2)

    for (const { spec, body } of blocks) {
      // proxy_set_header is a different directive and does not break inheritance.
      if (!/^\s*add_header\s/m.test(body)) continue
      expect(
        body.includes(SNIPPET),
        `location ${spec} declares an add_header, which discards every inherited one. ` +
          `Add \`${SNIPPET}\` to that block or its responses ship with no CSP and no nosniff.`,
      ).toBe(true)
    }
  })
})

/**
 * The player's address is what every per-network ceiling in the Go server is
 * keyed on (hub/privacy.go: clientNet, admitConn, joinThrottled), and this proxy
 * is the only thing that decides what the server gets to believe about it.
 *
 * The hole this pins shut: `ws.` is grey-clouded on purpose, so Cloudflare is
 * not on that path and nothing there sets or strips CF-Connecting-IP. While the
 * shared proxy block forwarded `$http_cf_connecting_ip` from both hosts, a
 * client could write its own — and the Go server believed it, because the *peer*
 * it checks against TrustedProxies is this container. One header per socket was
 * one network key per socket: MaxConnsPerNet stops bounding anything, and so
 * does the wrong-code budget that rations a sweep of the table-code space.
 *
 * Nothing else can see it. The header arrives, parses and looks exactly like the
 * real thing at every layer; the only place the truth exists is which host the
 * request came in on, which is this config and nowhere else.
 */
describe('the network key the server is keyed on (ws-proxy.conf)', () => {
  const wsProxy = readFileSync(path.join(CLIENT, 'ws-proxy.conf'), 'utf8')

  /** The `set $name value;` pairs declared directly by each `server { … }`. */
  function serverBlocks(): { name: string; sets: Record<string, string> }[] {
    const out: { name: string; sets: Record<string, string> }[] = []
    const opener = /^server\s*\{/gm
    for (let m = opener.exec(conf); m; m = opener.exec(conf)) {
      let depth = 1
      let i = m.index + m[0].length
      for (; i < conf.length && depth > 0; i++) {
        if (conf[i] === '{') depth++
        else if (conf[i] === '}') depth--
      }
      const body = conf.slice(m.index + m[0].length, i - 1)
      const sets: Record<string, string> = {}
      const setRe = /^\s*set\s+\$(\w+)\s+(.+?);/gm
      for (let s = setRe.exec(body); s; s = setRe.exec(body)) sets[s[1]] = s[2].trim()
      const named = /server_name\s+([^;]+);/.exec(body)
      out.push({ name: named ? named[1].trim() : 'default', sets })
    }
    return out
  }

  it('reads the address from a per-host variable, never from the request', () => {
    // The whole fix is that the shared block cannot decide this: it is shared,
    // and the two hosts guarantee different things. A `$http_…` reappearing on
    // either of these lines is the hole reopening.
    expect(wsProxy).toMatch(/proxy_set_header\s+CF-Connecting-IP\s+\$loco_cf_ip;/)
    expect(wsProxy).toMatch(/proxy_set_header\s+X-Real-IP\s+\$loco_real_ip;/)
    const forwarded = wsProxy.match(/^\s*proxy_set_header\s+(?:CF-Connecting-IP|X-Real-IP)\s+.*$/gm) ?? []
    expect(forwarded).toHaveLength(2)
    for (const line of forwarded) {
      expect(line, `${line.trim()} reads the request directly`).not.toMatch(/\$http_/)
    }
  })

  it('has every host declare both, so neither is inherited by accident', () => {
    // An undefined variable is an nginx startup error rather than an empty
    // string, so a missing `set` fails loudly — but only on the host that lacks
    // it, and only once a request reaches it. Asserting both on every server
    // block is what makes a new host state its own answer instead of copying a
    // neighbour's.
    const blocks = serverBlocks()
    expect(blocks.length, 'no server block was parsed — this guard is asserting nothing').toBe(2)
    for (const { name, sets } of blocks) {
      expect(Object.keys(sets), `server ${name} does not set both address variables`)
        .toEqual(expect.arrayContaining(['loco_cf_ip', 'loco_real_ip']))
    }
  })

  it('trusts CF-Connecting-IP only on the host Cloudflare is actually in front of', () => {
    // `ws.*` is the direct socket hostname, resolved outside the CDN — that is
    // its entire reason to exist (docs/deployment.md). So CF-Connecting-IP is
    // client-written there and must not travel; X-Real-IP is the one Traefik
    // overwrites on that path. The site's host is the mirror image.
    const direct = serverBlocks().find((b) => b.name.startsWith('ws.'))
    expect(direct, 'no ws.* server block found').toBeDefined()
    expect(direct!.sets.loco_cf_ip).toBe('""')
    expect(direct!.sets.loco_real_ip).toBe('$http_x_real_ip')

    const site = serverBlocks().find((b) => b.name === 'default')
    expect(site, 'no default server block found').toBeDefined()
    expect(site!.sets.loco_cf_ip).toBe('$http_cf_connecting_ip')
    expect(site!.sets.loco_real_ip).toBe('""')
  })
})

describe('the app stays inside the policy', () => {
  const sources = appSources(path.join(CLIENT, 'src'))

  it('ships no construct the policy refuses', () => {
    // Each of these needs a directive the CSP does not grant ('unsafe-eval',
    // worker-src, blob: in script-src). They fail in production only, which is
    // the whole reason this file exists.
    const banned = /\beval\(|new Function\(|new Worker\(|blob:/
    const offenders = sources.filter(f => banned.test(readFileSync(f, 'utf8')))
    expect(offenders.map(f => path.relative(CLIENT, f))).toEqual([])
  })

  it('validates a server message without reaching for eval', async () => {
    // The check above reads our sources; a dependency is free to call
    // `Function()` on its own. Zod 4 did, to compile a validator the first time
    // a schema ran: under `script-src 'self'` the call is refused, Zod catches
    // it and interprets instead, so nothing breaks. It just reports a violation
    // on every page load, indistinguishable from a real one. That was pinned by
    // asserting a config flag, which tested the workaround rather than the
    // property the workaround was for.
    //
    // Valibot has no such path, so this asserts the property directly: run a
    // real validation with both eval doors watched, and see that neither opens.
    // A Proxy rather than a replacement, so everything else about Function
    // (prototype, instanceof, the internals of whatever else is loaded) is
    // untouched. This would have caught Zod, and it catches the next one.
    const [{ serverMsgSchema }, v] = await Promise.all([
      import('../types/protocolSchemas'),
      import('valibot'),
    ])

    const compiled: string[] = []
    const realFunction = globalThis.Function
    const record = (args: unknown[]) => compiled.push(String(args[args.length - 1] ?? ''))
    globalThis.Function = new Proxy(realFunction, {
      construct: (target, args, newTarget) => (record(args), Reflect.construct(target, args, newTarget)),
      apply: (target, thisArg, args) => (record(args), Reflect.apply(target, thisArg, args)),
    })

    try {
      const parsed = v.safeParse(serverMsgSchema, { type: 'error', error: 'nope' })
      expect(parsed.success).toBe(true)
    } finally {
      globalThis.Function = realFunction
    }

    expect(compiled).toEqual([])
  })

  it('loads nothing off a remote origin', () => {
    // A CDN font, an analytics snippet or a remote image would be blocked by
    // default-src 'self'. Self-hosting is not a preference here, it is what
    // keeps the policy closed.
    const remote = /(?:src|href|url\()\s*=?\s*["'(]?https?:\/\//
    const offenders = sources.filter(f => remote.test(readFileSync(f, 'utf8')))
    expect(offenders.map(f => path.relative(CLIENT, f))).toEqual([])
    // Same rule for the markup: a literal remote src/href in a page or layout
    // would be fetched by the browser and blocked. The absolute URLs in the
    // link-preview tags are exempt by nature — they are read by crawlers off the
    // page, never fetched by it — and are built from src/seo/meta.ts, not
    // written here.
    expect(/(?:src|href)="https?:\/\//.test(markup)).toBe(false)
  })
})
