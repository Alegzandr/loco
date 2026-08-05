/**
 * The home page translated where it stands.
 *
 * `/` is the one document on this site that changes language without being
 * reloaded: a browser set to French lands on the root and gets the French game
 * under a French footer, at `/fr/` in the address bar, without a round trip. The
 * app half of that page speaks both languages already. This is about the other
 * half — the markup Astro served — and about the one way it can go wrong.
 *
 * That way is a **link**. A label left in English is a wart; a footer link left
 * pointing at `/rules/` sends a French visitor to a static page that mounts
 * nothing and cannot correct itself. So the second half of this file counts:
 * anything the layout renders per language must carry its counterpart, and a
 * string added six months from now without one fails here rather than leaking
 * quietly.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import { swapServedLang } from '../langSwap'

const CLIENT = path.resolve(__dirname, '..', '..')
const read = (...p: string[]) => readFileSync(path.join(CLIENT, 'src', ...p), 'utf8')

describe('swapping the served markup', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    delete document.documentElement.dataset.altTitle
  })

  it('exchanges text, links and accessible names in one pass', () => {
    document.body.innerHTML = `
      <h1 data-alt="LOCO, le jeu">LOCO, the game</h1>
      <nav aria-label="Read more" data-alt-aria="En savoir plus">
        <a href="/rules/" data-alt-href="/fr/regles/" data-alt="Règles">Rules</a>
      </nav>
    `

    swapServedLang(null)

    expect(document.querySelector('h1')!.textContent).toBe('LOCO, le jeu')
    const link = document.querySelector('a')!
    expect(link.textContent).toBe('Règles')
    expect(link.getAttribute('href')).toBe('/fr/regles/')
    expect(document.querySelector('nav')!.getAttribute('aria-label')).toBe('En savoir plus')
  })

  it('leaves the document holding both languages, never one of them twice', () => {
    // The values are exchanged rather than overwritten, so what was served is
    // still there under `data-alt`. A second pass puts it back, which is the
    // honest behaviour for a pair being traded and the reason this is safe to
    // reason about at all.
    document.body.innerHTML = `<a href="/cards/" data-alt-href="/fr/cartes/" data-alt="Cartes">Cards</a>`

    swapServedLang(null)
    const link = document.querySelector('a')!
    expect(link.dataset.alt).toBe('Cards')
    expect(link.dataset.altHref).toBe('/cards/')

    swapServedLang(null)
    expect(link.textContent).toBe('Cards')
    expect(link.getAttribute('href')).toBe('/cards/')
  })

  it('trims what a wrapped template left in the markup', () => {
    // The value going into the attribute came out of `textContent`, and a
    // template is free to wrap a long line. Collected once, that whitespace
    // would come back as part of the string on the next swap, where it is no
    // longer whitespace between tags.
    document.body.innerHTML = `<h3 data-alt="Ce qui le distingue">\n        What makes it different\n      </h3>`

    swapServedLang(null)
    expect(document.querySelector('h3')!.dataset.alt).toBe('What makes it different')
  })

  it('takes the tab’s own label with it', () => {
    document.title = 'LOCO — play in your browser'
    document.documentElement.dataset.altTitle = 'LOCO — jouer dans le navigateur'

    swapServedLang(null)

    expect(document.title).toBe('LOCO — jouer dans le navigateur')
    expect(document.documentElement.dataset.altTitle).toBe('LOCO — play in your browser')
  })

  it('moves the address bar without adding a history entry', () => {
    const before = history.length
    swapServedLang('/fr/?showcase=lobby')
    expect(window.location.pathname).toBe('/fr/')
    expect(window.location.search).toBe('?showcase=lobby')
    expect(history.length).toBe(before)
  })

  it('leaves `data-served-lang` alone', () => {
    // It says what the page was *built* as, which stays true after the swap and
    // is what a reload hands back. `i18n/store.ts` reads it to detect the
    // language, and a swap that rewrote it would make the app read its own
    // output.
    document.documentElement.dataset.servedLang = 'en'
    swapServedLang('/fr/')
    expect(document.documentElement.dataset.servedLang).toBe('en')
    delete document.documentElement.dataset.servedLang
  })
})

describe('the served markup carries both languages', () => {
  const sources = [
    ['layouts', 'GamePage.astro'],
    ['content', 'HomeProse.astro'],
  ] as const

  for (const file of sources) {
    const name = file.join('/')
    const src = read(...file)

    it(`${name}: every string it renders has its counterpart`, () => {
      // `ui('homeH1', lang)` without `ui('homeH1', alt)` beside it is a line
      // that stays in English on a French home page.
      const keys = [...src.matchAll(/ui\('(\w+)',\s*lang\)/g)].map((m) => m[1])
      expect(keys.length, 'nothing to check means the scan broke').toBeGreaterThan(0)
      for (const key of new Set(keys)) {
        expect(src, `${key} is rendered but never translated`).toMatch(
          new RegExp(`ui\\('${key}',\\s*alt\\)`),
        )
      }
    })

    it(`${name}: every localised path has its counterpart`, () => {
      // The half with no second chance: a link left behind lands the visitor on
      // a static page in the wrong language, with no bundle to fix it.
      const refs = [...src.matchAll(/([\w.?]+)\[lang\]/g)].map((m) => m[1])
      for (const ref of new Set(refs)) {
        expect(src, `${ref}[lang] is rendered but never translated`).toContain(`${ref}[alt]`)
      }
    })

    it(`${name}: every link carries an alternative href`, () => {
      // `(?<!-)` because `data-alt-href={` ends in `href={` too, and counting
      // those would make every link look like it already had its pair.
      const hrefs = (src.match(/(?<![-\w])href=\{/g) ?? []).length
      const alts = (src.match(/\bdata-alt-href=\{/g) ?? []).length
      expect(alts, 'a link with no data-alt-href leaks to the other language').toBe(hrefs)
    })
  }

  it('the swap reads the markup rather than the site’s copy', () => {
    // `content/ui.ts` is 240 lines of bilingual copy for pages the player is not
    // on and `seo/meta.ts` is the registry of every page on the site — both are
    // build-time modules, and `lang.ts` already refuses to import the second one
    // for this reason. Importing either here would put all of it in the bundle
    // every player downloads, to translate a footer most never open.
    const swap = read('langSwap.ts')
    expect(swap).not.toMatch(/from '\.\/content\/ui'|from '\.\/seo\/meta'/)
    expect(swap, 'strings are exchanged, never rendered from a table').toMatch(/data-alt/)
  })
})
