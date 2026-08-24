/**
 * Where a public URL sends a visitor, and whether it ever stops sending them.
 *
 * The redirect chain is the other piece of configuration that ships untested by
 * construction. `client/nginx.conf` declares no redirect at all — the rule at
 * the bottom of it says so on purpose — but nginx redirects anyway: `try_files
 * $uri/` resolving a directory makes the static module answer `/fr` with a 301
 * to `/fr/`, and it builds that `Location` out of `$scheme`. TLS is terminated
 * two hops upstream (Cloudflare, then Traefik on `websecure`), so `$scheme` is
 * `http` for every request this container ever sees: the visitor asks over
 * https and is sent back to plaintext, and the only thing that brings them back
 * is an edge setting nothing in this repository declares or can test.
 *
 * That is the shape of every "too many redirects" a static site produces: two
 * ends each convinced the other one is wrong about the scheme.
 * `absolute_redirect off;` is what settles it — nginx then answers with a path,
 * the client keeps the scheme it already had, and the chain is one hop whatever
 * sits in front.
 *
 * So this file models the thing rather than asserting a line: it reads the
 * emitted page tree, replays every public URL through nginx's own rules and an
 * edge that upgrades plaintext, and fails if a chain revisits a URL, leaves
 * https, or ends anywhere but a page that exists. The reasoning, the
 * measurements and the alternative that was rejected are in `docs/notes/seo.md`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

import { PAGES, INVITE, LANGS } from '../seo/meta'

const CLIENT = path.resolve(__dirname, '..', '..')
const conf = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')

/** Comments are prose about redirects, not redirects. */
const directives = conf
  .split('\n')
  .map((l) => l.replace(/#.*$/, ''))
  .join('\n')

/**
 * The `server { ... }` blocks, by brace depth. Two of them: the site and the
 * direct socket host.
 */
function serverBlocks(source: string): string[] {
  const out: string[] = []
  const re = /server\s*\{/g
  while (re.exec(source)) {
    let depth = 1
    let i = re.lastIndex
    while (i < source.length && depth > 0) {
      if (source[i] === '{') depth++
      else if (source[i] === '}') depth--
      i++
    }
    out.push(source.slice(re.lastIndex, i - 1))
  }
  return out
}

const blocks = serverBlocks(directives)
/** The one that serves the pages: it is the one that resolves a URL to a file. */
const site = blocks.find((b) => /\btry_files\b/.test(b))!

/**
 * Every URL the build emits, derived from the pages themselves rather than from
 * `PAGES`: a chain has to be replayed against what nginx will actually find on
 * disk. `index.astro` is the directory itself, `rules.astro` is `/rules/`, and
 * `404.astro` is an error document rather than a URL anybody is sent to.
 */
function emittedRoutes(dir: string, prefix = '/', out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) emittedRoutes(full, `${prefix}${entry}/`, out)
    else if (entry.endsWith('.astro')) {
      if (entry === '404.astro') continue
      out.add(entry === 'index.astro' ? prefix : `${prefix}${entry.replace(/\.astro$/, '')}/`)
    }
  }
  return out
}

const routes = emittedRoutes(path.join(CLIENT, 'src', 'pages'))

const HOST = 'ohloco.com'
/** Whether nginx builds its own `Location` out of `$scheme://$host`. */
const absoluteRedirect = !/\babsolute_redirect\s+off\s*;/.test(site)

interface Hop {
  url: string
  status: number
  location?: string
}

/** What this nginx answers for one URL, by its own rules. */
function origin(url: URL): Hop {
  const p = url.pathname
  if (routes.has(p)) return { url: url.href, status: 200 }
  if (!p.endsWith('/') && routes.has(`${p}/`)) {
    // The static module's directory redirect: the one redirect this file emits.
    const target = absoluteRedirect ? `http://${HOST}${p}/` : `${p}/`
    return { url: url.href, status: 301, location: target }
  }
  return { url: url.href, status: 404 }
}

/**
 * The edge in front of it, as it is configured today: plaintext is sent back to
 * https, path untouched. It is modelled because it is half of the loop — a
 * downgrade at the origin is only ever seen through whatever undoes it.
 */
function edge(url: URL): Hop | null {
  if (url.protocol === 'http:') {
    return {
      url: url.href,
      status: 301,
      location: `https://${url.host}${url.pathname}${url.search}`,
    }
  }
  return null
}

/** Follows one URL to its end, or to the point where it stops making progress. */
function chain(start: string, max = 6): Hop[] {
  const hops: Hop[] = []
  const seen = new Set<string>()
  let url = new URL(start)
  for (let i = 0; i < max; i++) {
    if (seen.has(url.href)) {
      hops.push({ url: url.href, status: -1 })
      return hops
    }
    seen.add(url.href)
    const hop = edge(url) ?? origin(url)
    hops.push(hop)
    if (!hop.location) return hops
    url = new URL(hop.location, url)
  }
  hops.push({ url: url.href, status: -2 })
  return hops
}

function trace(hops: Hop[]): string {
  return hops.map((h) => `${h.status} ${h.url}${h.location ? ` -> ${h.location}` : ''}`).join('\n')
}

/** Every public URL: the registry, the invitation, and both spellings of each. */
const publicPaths = [
  ...PAGES.flatMap((page) => LANGS.map((lang) => page.path[lang])),
  ...LANGS.map((lang) => INVITE.path[lang]),
]
const spellings = [
  ...new Set(publicPaths.flatMap((p) => (p === '/' ? [p] : [p, p.replace(/\/$/, '')]))),
]

describe('the redirect chain', () => {
  it('never builds a Location out of the scheme nginx was reached on', () => {
    // The whole bug in one line. Behind the TLS terminator `$scheme` is `http`
    // for every request, so the default `absolute_redirect on` answers an https
    // visitor with a plaintext URL and hands the chain to whatever the edge is
    // configured to do with it. Relative, the same redirect carries no scheme
    // and no host, so it cannot disagree with the request that produced it.
    expect(site).toMatch(/absolute_redirect\s+off\s*;/)
  })

  it('declares no redirect of its own that could answer its own target', () => {
    // Nothing here redirects explicitly today, and the comment in nginx.conf
    // explains why a redirect on the 404 branch would be a loop. If one is ever
    // added, it has to name a path rather than an origin: an absolute target is
    // how a rule reaches back across the edge and finds itself.
    const explicit = [
      ...directives.matchAll(/\breturn\s+30[1278]\s+(\S+?)\s*;/g),
      ...directives.matchAll(/\brewrite\s+\S+\s+(\S+)\s+(?:permanent|redirect)\s*;/g),
    ].map((m) => m[1])
    for (const target of explicit) {
      expect(target, `${target} must be a path, not an origin`).toMatch(/^\//)
    }
  })

  for (const p of spellings) {
    it(`resolves ${p} to a 200 without looping or leaving https`, () => {
      const hops = chain(`https://${HOST}${p}`)
      const seen = trace(hops)

      // A revisited URL (-1) or a chain still going after six hops (-2) is the
      // failure a browser reports as ERR_TOO_MANY_REDIRECTS.
      expect(hops.map((h) => h.status), seen).not.toContain(-1)
      expect(hops.map((h) => h.status), seen).not.toContain(-2)
      // No hop may drop out of https: a target that does is a target the edge
      // sends straight back, so where the chain ends stops being this file's
      // decision and becomes somebody else's setting.
      for (const hop of hops) {
        expect(hop.url.startsWith('https://'), seen).toBe(true)
      }
      expect(hops.at(-1)!.status, seen).toBe(200)
      // One hop at most: the slash, and nothing else.
      expect(hops.length, seen).toBeLessThanOrEqual(2)
    })
  }

  it('names the settled URL everywhere a page names itself', () => {
    // The canonical, the hreflang pairs and the sitemap are all built from these
    // paths. A page whose canonical names a redirect is reported as invalid by
    // Google and looks perfectly fine to every human, because both URLs load.
    for (const p of publicPaths) {
      const hops = chain(`https://${HOST}${p}`)
      expect(hops.length, `${p} must be the end of its own chain`).toBe(1)
      expect(hops[0].status, p).toBe(200)
    }
  })
})
