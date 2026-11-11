/**
 * What every URL of the site is, in one function.
 *
 * `routeFor(pathname)` answers the questions the rest of the app would
 * otherwise each answer for itself: which page of the registry this is, in
 * which language, whether it is the game or a document, whether it is indexed.
 * Three readers use it and must never disagree:
 *
 *  - `hooks.server.ts`, which writes the `<html>` and `<body>` attributes into
 *    `src/app.html` when a page is prerendered;
 *  - the root layout, which writes the same attributes onto the live document
 *    whenever the router moves to another page (`applyDocument`);
 *  - the two group layouts (`routes/(game)`, `routes/(content)`), which render
 *    the page's head, its chrome and its article from it.
 *
 * Driven by the URL rather than by a `load` per route because the URL is the
 * one thing all three already have, and because the registry is the single
 * source of every path (`seo/meta.ts`): a route that disagreed with it would
 * be a page the sitemap does not know or a sitemap entry with no page.
 * Framework-free and pure, so `seo.test.ts` can walk every path through it.
 */
import { HOME, INVITE, LANGS, PAGES, type Lang, type PageDef } from './meta.ts'

export interface RouteInfo {
  /** The game (`/`, `/fr/`, `/i/`), a content page, or neither (the 404). */
  kind: 'game' | 'content' | 'none'
  page: PageDef | null
  /** The language the document is in. */
  lang: Lang
  /**
   * What the page was *built* as (`data-served-lang`), or none for the one page
   * that is no language at all: the invite page has a single URL for both, so
   * there is nothing for the language decision to disagree with.
   */
  servedLang?: Lang
}

/** The registry's paths are slashed; a request may not be. */
function slashed(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function routeFor(pathname: string): RouteInfo {
  const p = slashed(pathname)
  if (p === INVITE.path.en) return { kind: 'game', page: INVITE, lang: 'en' }
  for (const page of PAGES) {
    for (const lang of LANGS) {
      if (p === page.path[lang]) {
        return { kind: page.id === HOME.id ? 'game' : 'content', page, lang, servedLang: lang }
      }
    }
  }
  return { kind: 'none', page: null, lang: 'en', servedLang: 'en' }
}

/** The page of the registry with this slug in this language, for the param matchers. */
export function contentPageBySlug(slug: string, lang: Lang): PageDef | undefined {
  const prefix = lang === 'en' ? '/' : '/fr/'
  return PAGES.find((p) => p.id !== HOME.id && p.path[lang] === `${prefix}${slug}/`)
}

/** Every content page's slug in one language: what `entries` prerenders. */
export function contentSlugs(lang: Lang): string[] {
  const prefix = lang === 'en' ? '/' : '/fr/'
  return PAGES.filter((p) => p.id !== HOME.id).map((p) => p.path[lang].slice(prefix.length, -1))
}

/**
 * `doc` for a content page: text selection back on, the canvas flat. `game`
 * for the page the game is played on: one viewport, never scrolled. The 404
 * wears neither.
 */
export function bodyClassFor(route: RouteInfo): 'doc' | 'game' | undefined {
  return route.kind === 'content' ? 'doc' : route.kind === 'game' ? 'game' : undefined
}

/**
 * The attributes as markup, for the server hook. Each one carries its own
 * leading space so an absent one leaves no trace in the tag.
 */
export function htmlAttrs(route: RouteInfo): string {
  return route.servedLang ? ` data-served-lang="${route.servedLang}"` : ''
}

export function bodyAttrs(route: RouteInfo): string {
  const cls = bodyClassFor(route)
  return cls ? ` class="${cls}"` : ''
}

/**
 * The same attributes, written onto the live document when the router has put
 * another page in place of this one. On the first load they are already there —
 * the server wrote them — and writing the same values again changes nothing.
 *
 * `<html lang>` is left to the game once it has booted: `i18n/store.ts` writes
 * it with the language the game is actually showing, which on `/i/` is the
 * reader's own and not the page's.
 */
export function applyDocument(route: RouteInfo, writeLang = true): void {
  const html = document.documentElement
  if (writeLang) html.lang = route.lang
  if (route.servedLang) html.dataset.servedLang = route.servedLang
  else delete html.dataset.servedLang
  const cls = bodyClassFor(route)
  document.body.classList.toggle('doc', cls === 'doc')
  document.body.classList.toggle('game', cls === 'game')
}
