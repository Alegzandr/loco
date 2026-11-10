import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { LEGAL, LEGAL_UPDATED } from '../content/legal'
import { LEGAL as LEGAL_PAGE, PAGES, LANGS, type Lang } from '../seo/meta'
import { UI } from '../content/ui'
import { en } from '../i18n/en'
import { fr } from '../i18n/fr'
import { FULL_ADDRESS_READ, serverHubSources } from './serverSource'

const CLIENT = path.resolve(__dirname, '../..')

/** Every string of every document, flattened, for one language. */
function allCopy(lang: Lang): string {
  return LEGAL[lang]
    .flatMap((doc) => [doc.title, ...doc.sections.flatMap((s) => [s.heading, ...s.items])])
    .join('\n')
}

describe('legal copy', () => {
  it('ships the three documents in both languages', () => {
    expect(LEGAL.en).toHaveLength(3)
    expect(LEGAL.fr).toHaveLength(3)
  })

  // The English copy is the source both are written from, and a document
  // translated as an empty shell is the failure nothing else would catch: the
  // page would render, with a heading and no obligation under it.
  it('matches section for section between languages', () => {
    LEGAL.en.forEach((doc, i) => {
      expect(LEGAL.fr[i].sections).toHaveLength(doc.sections.length)
      doc.sections.forEach((section, j) => {
        expect(LEGAL.fr[i].sections[j].items).toHaveLength(section.items.length)
      })
    })
  })

  it('leaves no empty heading or item', () => {
    for (const lang of LANGS) {
      for (const doc of LEGAL[lang]) {
        expect(doc.title.trim().length).toBeGreaterThan(0)
        for (const section of doc.sections) {
          expect(section.heading.trim().length).toBeGreaterThan(0)
          expect(section.items.length).toBeGreaterThan(0)
          for (const item of section.items) expect(item.trim().length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('dates itself in both languages', () => {
    for (const lang of LANGS) expect(LEGAL_UPDATED[lang]).toMatch(/2026/)
  })
})

/**
 * The disclosures below are not stylistic. Each one is something the GDPR, the
 * ePrivacy exemption this game relies on, or Mattel's trademark requires the
 * page to actually say, and each one is stated in `docs/notes/legal.md`.
 * Rewording is fine; deleting the substance fails here.
 */
describe('required disclosures', () => {
  const requirements: Array<{ what: string; en: RegExp; fr: RegExp }> = [
    { what: 'names the legal basis', en: /legitimate interest/i, fr: /intérêt légitime/i },
    { what: 'gives a retention period', en: /30 days/i, fr: /30 jours/i },
    { what: 'lists the data subject rights', en: /erasure/i, fr: /effacement/i },
    { what: 'names a supervisory authority', en: /CNIL/, fr: /CNIL/ },
    { what: 'says data stays in the EU', en: /European Union/i, fr: /Union européenne/i },
    { what: 'discloses browser storage', en: /browser storage/i, fr: /stockage de ton propre navigateur/i },
    { what: 'explains why there is no cookie banner', en: /no cookie banner/i, fr: /pas de bandeau cookies/i },
    { what: 'disclaims any Mattel connection', en: /Mattel/, fr: /Mattel/ },
    // Added with the live-streams strip, and load-bearing from that moment on:
    // the page has always said that nothing is fetched from anyone else's
    // server, and now there is a third party in the picture. What keeps that
    // sentence true is that the *server* asks and the browser never does, so
    // the copy has to say which of the two makes the request. Reword it freely;
    // deleting the substance means the promise above it is no longer checkable.
    { what: 'says the browser itself talks to nobody else', en: /never asks Twitch/i, fr: /ne demande jamais rien à Twitch/i },
    { what: 'names the governing law', en: /French law/i, fr: /droit français/i },
  ]

  for (const req of requirements) {
    it(`the privacy and terms copy ${req.what}`, () => {
      expect(allCopy('en')).toMatch(req.en)
      expect(allCopy('fr')).toMatch(req.fr)
    })
  }

  // Naming the mark to disclaim it is the one place the game may say UNO.
  // Anywhere else and the disclaimer stops being true, so NOTICE.md's claim
  // that no player-facing string carries it needs an assertion of its own.
  // `seo.test.ts` runs the same guard over the pages; this one owns the game.
  it('never says UNO outside the disclaimer that names it', () => {
    for (const t of [en, fr]) {
      expect(JSON.stringify(t)).not.toMatch(/\bUNO\b/i)
    }
    expect(JSON.stringify(UI)).not.toMatch(/\bUNO\b/i)
  })
})

/**
 * A policy nobody can reach is a policy that does not exist. It used to be a
 * modal over the lobby, which made it unreachable from anywhere else and
 * impossible to link to; it is a page now, and these are the properties that
 * make that true: it is built, it is in the registry, and every footer carries
 * the link.
 */
describe('reaching it', () => {
  it('is a real page in both languages', () => {
    for (const lang of LANGS) {
      const clean = LEGAL_PAGE.path[lang].replace(/^\/|\/$/g, '')
      const file = path.join(CLIENT, 'src', 'routes', clean, '+page.svelte')
      expect(readFileSync(file, 'utf8')).toContain('LegalArticle')
    }
  })

  // The jump list is what the modal's tab strip became, and its anchors are the
  // reason the page is worth linking to at all: `#terms` is how somebody sends
  // the terms rather than the page. The slugs were a positional array in the
  // renderer, so a fourth document or a reordering would have produced
  // `#undefined` links and sections with no id, on a page that still looked
  // finished.
  it('anchors each document on its own slug, identically in both languages', () => {
    const en = LEGAL.en.map((d) => d.slug)
    const fr = LEGAL.fr.map((d) => d.slug)

    expect(en).toEqual(fr)
    expect(new Set(en).size, 'two documents share an anchor').toBe(en.length)
    for (const slug of en) expect(slug).toMatch(/^[a-z]+$/)
  })

  // A landmark labelled with the page's own heading tells a screen-reader user
  // nothing they have not just been read.
  it('labels the jump list for what it does', () => {
    for (const lang of LANGS) expect(UI.legalJump[lang]).not.toBe(UI.legalH1[lang])
  })

  it('is in the page registry, so it gets a canonical and a sitemap entry', () => {
    expect(PAGES.map((p) => p.id)).toContain(LEGAL_PAGE.id)
  })

  it('is linked from the footer of the game and of every content page', () => {
    // One bar and one drawer since the site's chrome was unified, and both
    // page layouts render them.
    const layouts = path.join(CLIENT, 'src', 'layouts')
    for (const file of ['SiteFooter.svelte', 'SiteDrawer.svelte']) {
      const src = readFileSync(path.join(layouts, file), 'utf8')
      expect(src, file).toMatch(/LEGAL\.path\[lang\]/)
      expect(src, file).toMatch(/legalNav/)
    }
    for (const file of ['GamePage.svelte', 'ContentPage.svelte']) {
      expect(readFileSync(path.join(layouts, file), 'utf8'), file).toMatch(/<SiteFooter\b/)
    }
  })

  // The whole point of a page over a modal: no name typed, no seat taken, and
  // nothing to run. The page is prerendered, so the policy is in the served
  // HTML: an effect here would draw nothing on the server, and the policy would
  // be behind a script for a reader who has none.
  it('renders without needing any JavaScript of its own', () => {
    const article = readFileSync(
      path.join(CLIENT, 'src', 'content', 'LegalArticle.svelte'),
      'utf8',
    )
    const script = /<script[^>]*>([\s\S]*?)<\/script>/.exec(article)?.[1] ?? ''
    // Built rather than written out: a rune spelled in a plain .ts file is what
    // runeScope.test.ts exists to refuse, even inside a pattern.
    expect(script).not.toMatch(new RegExp(['\\$' + 'effect', 'onMount', '\\$' + 'state'].join('|')))
    expect(article.slice(article.indexOf('</script>'))).not.toMatch(/<script|\{@html/)
  })

  it('keeps the copy out of the bundle every player downloads', () => {
    // `src/i18n/en.ts` is downloaded by everyone who opens the game. The three
    // documents are read by almost nobody, and they are long.
    for (const t of [en, fr]) {
      expect(JSON.stringify(t)).not.toMatch(/CNIL/)
    }
  })
})

/**
 * The privacy copy promises no third-party request and no full IP in a log.
 * Both are properties of files outside the page, so both are asserted here
 * rather than trusted.
 */
describe('the promises the copy makes about the stack', () => {
  it('truncates the visitor address in the nginx access log', () => {
    const conf = readFileSync(path.join(CLIENT, 'nginx.conf'), 'utf8')

    expect(conf).toMatch(/log_format\s+anonymised/)
    expect(conf).toMatch(/access_log\s+\S+\s+anonymised/)
    // $remote_addr is the full address. It may feed the truncating map and
    // nothing else.
    const logFormats = conf.match(/log_format[^;]+;/g) ?? []
    for (const fmt of logFormats) expect(fmt).not.toMatch(/\$remote_addr/)
  })

  it('truncates it in the server too', () => {
    // Every hub file but privacy's, the one that does the truncating.
    const offenders = serverHubSources()
      .filter(({ src }) => FULL_ADDRESS_READ.test(src))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('keeps the font licence with the fonts it ships', () => {
    const notice = readFileSync(path.join(CLIENT, 'public', 'licenses.txt'), 'utf8')
    expect(notice).toMatch(/SIL OPEN FONT LICENSE/i)
    expect(notice).toMatch(/Fredoka/)
    expect(notice).toMatch(/Nunito/)
  })
})
