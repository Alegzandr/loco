/**
 * The SEO surface has the same problem the link preview has: none of it is ever
 * displayed to anyone on the team. A canonical pointing at the wrong host, a
 * `hreflang` set that does not point back, a page declared in the registry but
 * never built — all four are invisible locally, silent in CI, and only ever
 * observed as "the French page never got indexed", months later.
 *
 * So the registry in `src/seo/meta.ts` is the single source, and this file
 * asserts the properties that make it worth being one. It reads sources rather
 * than `dist/`: `npm run test` runs before `npm run build` in CI, and a test
 * that needed a build would simply not run there.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { UI } from '../content/ui'
import {
  PAGES,
  LANGS,
  DEFAULT_LANG,
  LOCALE,
  ORIGIN,
  HOME,
  absolute,
  alternates,
  homeJsonLd,
  type Lang,
  type PageDef,
} from '../seo/meta'

const CLIENT = path.resolve(__dirname, '..', '..')
const PAGES_DIR = path.join(CLIENT, 'src', 'pages')
const nginx = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')
const astroConfig = readFileSync(path.join(CLIENT, 'astro.config.mjs'), 'utf8')

/** Everything under src/content/: the prose and the data behind the pages. */
function contentSources(dir = path.join(CLIENT, 'src', 'content'), out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) contentSources(full, out)
    else if (/\.(astro|tsx?|css)$/.test(entry)) out.push(full)
  }
  return out
}

/** The two source files Astro would accept for a given URL path. */
function candidateFiles(urlPath: string): string[] {
  const clean = urlPath.replace(/^\/|\/$/g, '')
  if (clean === '') return [path.join(PAGES_DIR, 'index.astro')]
  return [
    path.join(PAGES_DIR, `${clean}.astro`),
    path.join(PAGES_DIR, clean, 'index.astro'),
  ]
}

describe('the page registry', () => {
  it('gives every page a title and a description in every language', () => {
    for (const page of PAGES) {
      for (const lang of LANGS) {
        expect(page.title[lang]?.trim(), `${page.id}/${lang} title`).toBeTruthy()
        expect(page.description[lang]?.trim(), `${page.id}/${lang} description`).toBeTruthy()
      }
    }
  })

  it('never repeats a title or a description', () => {
    // Two pages sharing a title is the classic way to get one of them dropped
    // from the index as a duplicate, and it happens by copy-paste every time a
    // page is added. The same string in both languages means one of them was
    // never translated.
    const titles: string[] = []
    const descriptions: string[] = []
    for (const page of PAGES) {
      for (const lang of LANGS) {
        titles.push(page.title[lang])
        descriptions.push(page.description[lang])
      }
    }
    expect(new Set(titles).size, `duplicate title among ${titles.length}`).toBe(titles.length)
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  it('gives every page a distinct, slashed path per language', () => {
    const seen = new Set<string>()
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const p = page.path[lang]
        expect(p, `${page.id}/${lang}`).toMatch(/^\//)
        // `trailingSlash: 'always'` in astro.config.mjs, and the canonical is
        // built from this: the two must agree or every page canonicalises to a
        // URL that redirects.
        expect(p, `${page.id}/${lang} must end in a slash`).toMatch(/\/$/)
        expect(seen.has(p), `${p} is claimed twice`).toBe(false)
        seen.add(p)
      }
    }
  })

  it('has a source file behind every declared path', () => {
    // The failure this exists for: a page added to the registry, therefore to
    // the sitemap and to every hreflang set, but never actually built. Google
    // is then handed a list of URLs that 404.
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const candidates = candidateFiles(page.path[lang])
        const found = candidates.some(existsSync)
        expect(
          found,
          `${page.id}/${lang} declares ${page.path[lang]} but none of ` +
            candidates.map((c) => path.relative(CLIENT, c)).join(' or ') +
            ' exists',
        ).toBe(true)
      }
    }
  })
})

describe('the trademark position', () => {
  // `legal.test.tsx` asserts this over the i18n copy, and the disclaimer that
  // names the mark in order to disclaim it is only true while nothing else
  // carries it. An indexed page is a player-facing surface too, and it is the
  // one nobody on the team reads back — a `<title>` reaching for the obvious
  // keyword would never be noticed here and would undo the whole position.
  const uno = /\bUNO\b/i

  it('keeps the mark out of every title, description and nav label', () => {
    for (const page of PAGES) {
      for (const lang of LANGS) {
        expect(page.title[lang], `${page.id}/${lang} title`).not.toMatch(uno)
        expect(page.description[lang], `${page.id}/${lang} description`).not.toMatch(uno)
        expect(page.navLabel?.[lang] ?? '', `${page.id}/${lang} navLabel`).not.toMatch(uno)
      }
    }
  })

  it('keeps it out of the shared page copy', () => {
    expect(JSON.stringify(UI)).not.toMatch(uno)
  })

  it('keeps it out of every content source', () => {
    // The prose itself, not only the metadata: these files are the page body.
    // `legal.ts` is the one exemption, and it is the reason for the rule: it
    // carries the disclaimer that names the mark in order to disclaim it, which
    // is only true while nothing else on the site does.
    for (const file of contentSources()) {
      if (path.basename(file) === 'legal.ts') continue
      const src = readFileSync(file, 'utf8')
      expect(src, path.relative(CLIENT, file)).not.toMatch(uno)
    }
  })
})

describe('hreflang', () => {
  it('is reciprocal, and names every language exactly once', () => {
    // Google ignores a hreflang set whose pages do not point back at each other,
    // which is the single most common way to implement this and get nothing.
    for (const page of PAGES) {
      const links = alternates(page)
      for (const lang of LANGS) {
        const entry = links.filter((l) => l.hreflang === LOCALE[lang])
        expect(entry, `${page.id} → ${lang}`).toHaveLength(1)
        expect(entry[0].href).toBe(absolute(page.path[lang]))
      }
    }
  })

  it('declares exactly one x-default, pointing at the default language', () => {
    for (const page of PAGES) {
      const xd = alternates(page).filter((l) => l.hreflang === 'x-default')
      expect(xd, page.id).toHaveLength(1)
      expect(xd[0].href).toBe(absolute(page.path[DEFAULT_LANG]))
    }
  })

  it('emits absolute URLs from an origin with no trailing slash', () => {
    // A relative hreflang is ignored, and a doubled slash makes a different URL.
    expect(ORIGIN).toMatch(/^https?:\/\/[^/]+$/)
    for (const page of PAGES) {
      for (const link of alternates(page)) {
        expect(link.href, link.hreflang).toMatch(/^https?:\/\/[^/]+\//)
        expect(link.href).not.toMatch(/[^:]\/\//)
      }
    }
  })

  it('is what the in-game language switch navigates by', () => {
    // Half of `/` is markup Astro rendered per URL — the footer row, the
    // burger's drawer, the sheet of prose — so switching language in the app
    // without moving left the game in French under a menu still in English. At
    // the entry screen the switch is two real links instead, and the boot-time
    // redirect follows the same two paths when a stored choice disagrees with
    // the URL it was opened at. They live in `src/lang.ts`, which is the only
    // second copy of these paths in the codebase: `seo/meta.ts` would otherwise
    // bring every page on the site into the bundle every player downloads. A
    // copy is fine; a copy nothing compares is how it rots.
    const src = readFileSync(path.join(CLIENT, 'src', 'lang.ts'), 'utf8')
    const declared = /HOME_PATH: Record<Lang, string> = \{([^}]*)\}/.exec(src)?.[1] ?? ''
    for (const lang of LANGS) {
      expect(declared, `${lang} must be the path the registry emits`).toMatch(
        new RegExp(`${lang}:\\s*'${HOME.path[lang]}'`),
      )
    }
  })
})

describe('structured data', () => {
  it('describes the game as a game, in the page language', () => {
    for (const lang of LANGS) {
      const ld = homeJsonLd(lang) as { '@graph': { '@type': string; inLanguage?: string }[] }
      // Serialisable, because it is written into the document with JSON.stringify
      // and a cycle or an undefined would silently truncate the block.
      expect(() => JSON.stringify(ld)).not.toThrow()
      const types = ld['@graph'].map((n) => n['@type'])
      expect(types).toContain('VideoGame')
      expect(types).toContain('WebSite')
      for (const node of ld['@graph']) {
        expect(node.inLanguage, `${node['@type']} inLanguage`).toBe(LOCALE[lang])
      }
    }
  })

  it('states the two properties this category is actually searched on', () => {
    // Free, and playable by a group in a browser. Saying it in prose only leaves
    // it to be inferred; saying it as data is what a rich result can read.
    const ld = homeJsonLd('en') as {
      '@graph': { '@type': string; offers?: { price: number }; numberOfPlayers?: { minValue: number; maxValue: number } }[]
    }
    const game = ld['@graph'].find((n) => n['@type'] === 'VideoGame')!
    expect(game.offers?.price).toBe(0)
    expect(game.numberOfPlayers).toEqual({ '@type': 'QuantitativeValue', minValue: 2, maxValue: 10 })
  })
})

describe('what the server has to agree with', () => {
  it('points robots.txt at the sitemap Astro actually emits', () => {
    // Two independent files naming one artefact: @astrojs/sitemap writes
    // `sitemap-index.xml`, and nginx advertises a path it was told by hand.
    expect(astroConfig).toContain('sitemap(')
    expect(nginx).toContain('sitemap-index.xml')
  })

  it('keeps dev hosts out of the index, and says nothing else there', () => {
    // A `-d.` host disallowing everything while advertising a sitemap is a
    // contradiction, and it is the branch nobody ever looks at.
    const devBranch = /~\*-d\\\.\s+"([^"]*)"/.exec(nginx)?.[1] ?? ''
    expect(devBranch, 'dev hosts must disallow everything').toContain('Disallow: /')
    expect(devBranch).not.toContain('Sitemap:')
  })

  it('answers a missing page with a real 404', () => {
    // `try_files … /index.html` would answer 200 with the game for any URL: a
    // soft 404, which Google reports as an error and which hides broken links.
    expect(nginx).toMatch(/try_files\s+\$uri\s+\$uri\/\s+=404/)
    expect(nginx).toContain('error_page 404 /404.html')
    expect(existsSync(path.join(PAGES_DIR, '404.astro'))).toBe(true)
  })

  it('compresses what is worth compressing and caches what is immutable', () => {
    expect(nginx).toMatch(/gzip\s+on/)
    expect(nginx).toContain('application/javascript')
    expect(nginx).toMatch(/max-age=31536000,\s*immutable/)
  })
})

describe('the home page', () => {
  it('is in the registry, at the site root in the default language', () => {
    const home: PageDef | undefined = PAGES.find((p) => p.id === HOME.id)
    expect(home).toBeDefined()
    expect(home!.path[DEFAULT_LANG]).toBe('/')
  })

  it('gives each language its own URL', () => {
    const paths = LANGS.map((l: Lang) => HOME.path[l])
    expect(new Set(paths).size).toBe(LANGS.length)
  })
})
