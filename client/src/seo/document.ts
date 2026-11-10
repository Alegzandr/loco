/**
 * What a document says about itself on `<html>` and `<body>`, for a given path.
 *
 * Under Astro each page was its own layout and wrote these attributes into its
 * own markup. SvelteKit renders one template (`src/app.html`) for every page,
 * and `<html>` and `<body>` are outside anything a component can render, so the
 * same answer has to be given twice: once by the server hook when the page is
 * prerendered (`hooks.server.ts`, through `transformPageChunk`), and once in the
 * browser when the router swaps one page for another without a document load
 * (`applyDocument`, from the page layouts). One function is what keeps those
 * two from disagreeing — a page that arrived by a link and the same page
 * arrived by a reload must be the same document.
 *
 * Framework-free and pure, so `seo.test.ts` can walk every path in the
 * registry through it.
 */
import { HOME, INVITE, LANGS, PAGES, type Lang } from './meta'

export interface DocumentAttrs {
  /** `<html lang>`. The app rewrites it on a language change; this is the start. */
  lang: Lang
  /**
   * What the page was *built* as (`data-served-lang`), or none for the one page
   * that is no language at all: the invite page has a single URL for both, so
   * there is nothing for `initLang` to disagree with and it must not move the
   * address bar. `langUrl` already reads a missing attribute as "stay".
   */
  servedLang?: Lang
  /**
   * This page's title in the other language, for the one page that changes
   * language without being reloaded (`langSwap.ts` exchanges the two). Only the
   * home page has one.
   */
  altTitle?: string
  /**
   * `doc` for a content page: text selection back on, the canvas flat. `game`
   * for the page the game is played on: one viewport, never scrolled. The 404
   * wears neither.
   */
  bodyClass?: 'doc' | 'game'
}

/** The registry's paths are slashed; a request may not be. */
function slashed(pathname: string): string {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

export function documentFor(pathname: string): DocumentAttrs {
  const p = slashed(pathname)
  if (p === INVITE.path.en) return { lang: 'en', bodyClass: 'game' }
  for (const lang of LANGS) {
    if (p === HOME.path[lang]) {
      const alt: Lang = lang === 'en' ? 'fr' : 'en'
      return { lang, servedLang: lang, altTitle: HOME.title[alt], bodyClass: 'game' }
    }
  }
  for (const page of PAGES) {
    for (const lang of LANGS) {
      if (p === page.path[lang]) return { lang, servedLang: lang, bodyClass: 'doc' }
    }
  }
  // The 404, and anything else that is not a page of the site.
  return { lang: 'en', servedLang: 'en' }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * The attributes as markup, for the server hook. Each one carries its own
 * leading space so an absent one leaves no trace in the tag.
 */
export function htmlAttrs(doc: DocumentAttrs): string {
  let out = ''
  if (doc.servedLang) out += ` data-served-lang="${doc.servedLang}"`
  if (doc.altTitle !== undefined) out += ` data-alt-title="${escapeAttr(doc.altTitle)}"`
  return out
}

export function bodyAttrs(doc: DocumentAttrs): string {
  return doc.bodyClass ? ` class="${doc.bodyClass}"` : ''
}

/**
 * The same attributes, written onto the live document by a page that the router
 * rendered in place of another one. On the first load they are already there —
 * the server wrote them — and writing the same values again changes nothing.
 *
 * Called from the page layout's script, synchronously, so it lands before any
 * of that page's effects read `data-served-lang` (which `initLang` does).
 */
export function applyDocument(doc: DocumentAttrs): void {
  const html = document.documentElement
  html.lang = doc.lang
  if (doc.servedLang) html.dataset.servedLang = doc.servedLang
  else delete html.dataset.servedLang
  if (doc.altTitle !== undefined) html.dataset.altTitle = doc.altTitle
  else delete html.dataset.altTitle
  const body = document.body
  body.classList.toggle('doc', doc.bodyClass === 'doc')
  body.classList.toggle('game', doc.bodyClass === 'game')
}
