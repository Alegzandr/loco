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
const html = readFileSync(path.join(CLIENT, 'index.html'), 'utf8')

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
  it('keeps script-src closed, and the page keeps no inline script', () => {
    // These two facts hold each other up. The policy can stay this tight only
    // because index.html carries nothing but a module <script src>, and adding
    // an inline one would fail in production alone.
    expect(directive('script-src')).toBe("'self'")
    const inlineScript = /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(html)
    expect(inlineScript, 'index.html gained an inline <script>, which script-src refuses').toBe(false)
  })

  it("keeps 'unsafe-inline' in style-src, which the page still needs", () => {
    // Not an oversight: index.html has a pre-hydration <style> block and
    // framer-motion writes a style attribute on every animated node. Dropping
    // this directive takes the whole board's animation with it.
    expect(directive('style-src')).toContain("'unsafe-inline'")
    expect(/<style[^>]*>/i.test(html), 'the pre-hydration <style> block is why style-src is loose').toBe(true)
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

  it('loads nothing off a remote origin', () => {
    // A CDN font, an analytics snippet or a remote image would be blocked by
    // default-src 'self'. Self-hosting is not a preference here, it is what
    // keeps the policy closed.
    const remote = /(?:src|href|url\()\s*=?\s*["'(]?https?:\/\//
    const offenders = sources.filter(f => remote.test(readFileSync(f, 'utf8')))
    expect(offenders.map(f => path.relative(CLIENT, f))).toEqual([])
    expect(/(?:src|href)="https?:\/\//.test(html)).toBe(false)
  })
})
