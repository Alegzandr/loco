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
    ]) {
      expect(header(name).always, `${name} is not marked always`).toBe(true)
    }
    expect(header('X-Content-Type-Options').value).toBe('nosniff')
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
