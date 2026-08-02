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

/** Every .astro file: the layouts and pages that produce the served HTML. */
function astroSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) astroSources(full, out)
    else if (entry.endsWith('.astro')) out.push(full)
  }
  return out
}

/** Every .ts/.tsx file: the app that ends up in the bundle. */
function reactSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) reactSources(full, out)
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full)
  }
  return out
}

const astroFiles = astroSources(path.join(CLIENT, 'src'))
/** All of them concatenated, which is what ends up in one page or another. */
const markup = astroFiles.map((f) => readFileSync(f, 'utf8')).join('\n')

/** The value of an `add_header <name> "..."` line, plus whether it is `always`. */
function header(name: string): { value: string; always: boolean } {
  const re = new RegExp(`add_header\\s+${name}\\s+"([^"]*)"\\s*(always)?\\s*;`, 'i')
  const m = re.exec(conf)
  if (!m) throw new Error(`nginx.conf sends no ${name} header`)
  return { value: m[1], always: m[2] === 'always' }
}

const csp = header('Content-Security-Policy').value

/** One directive's source list, e.g. directive('script-src') -> "'self'". */
function directive(name: string): string {
  const m = new RegExp(`(?:^|;)\\s*${name}\\s+([^;]*)`).exec(csp)
  if (!m) throw new Error(`CSP has no ${name} directive: ${csp}`)
  return m[1].trim()
}

/** Every .ts/.tsx/.css file the app ships, tests and the dev showcase aside. */
function appSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'test') appSources(full, out)
    } else if (/\.(tsx?|css)$/.test(entry)) {
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
    // The game is mounted by src/entry.tsx through an ordinary bundled <script>
    // instead, and the content pages need no client JS at all.
    for (const file of astroFiles) {
      const src = readFileSync(file, 'utf8')
      const island = /\bclient:(load|idle|visible|media|only)\b/.exec(src)
      expect(island?.[0], `${path.relative(CLIENT, file)} mounts an island; its runtime is inline`).toBeUndefined()
    }
  })

  it("keeps 'unsafe-inline' in style-src, which the app still needs", () => {
    // Not an oversight: framer-motion writes a style attribute on every animated
    // node, on every frame. Dropping this directive takes the whole board's
    // animation with it. The <style> blocks in the .astro files are extracted to
    // real stylesheets by Astro and are not what keeps this loose.
    expect(directive('style-src')).toContain("'unsafe-inline'")
    // Anchored on the app rather than on one file: the mount point used to hold
    // the <MotionConfig> and now delegates it to <MotionGate />, and neither
    // move should decide whether this directive is still justified. What
    // justifies it is that the library is somewhere in the bundle at all.
    const usesFramerMotion = reactSources(path.join(CLIENT, 'src')).some((f) =>
      readFileSync(f, 'utf8').includes('framer-motion'),
    )
    expect(usesFramerMotion, 'framer-motion is why style-src is loose').toBe(true)
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

  it('keeps Zod off the eval path', async () => {
    // The check above reads our sources; a dependency is free to call
    // `Function()` on its own, and Zod 4 does, to compile a validator the first
    // time a schema runs. Under `script-src 'self'` the call is refused, Zod
    // catches it and interprets instead, so nothing breaks — it just reports a
    // violation on every page load, which is indistinguishable from a real one.
    // Importing the schema module is what applies the setting, so the assertion
    // and the fix are the same statement.
    const { z } = await import('zod')
    await import('../types/protocolSchemas')
    expect(z.config().jitless).toBe(true)
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
