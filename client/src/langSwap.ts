/**
 * The home page, translated where it stands.
 *
 * `/` is half application and half markup Astro served, and only the first half
 * speaks both languages. This is the second half: every string and every link
 * the layout renders per language also carries the other one, in `data-alt`,
 * `data-alt-href` and `data-alt-aria`, and this walks them.
 *
 * ## Why the copy is in the markup rather than in this module
 *
 * The obvious implementation imports `content/ui.ts` and `seo/meta.ts` and
 * rebuilds the footer from them. Both are build-time modules today: `ui.ts` is
 * 240 lines of bilingual copy for pages the player is not on, `seo/meta.ts` is
 * the registry of every page on the site, and `lang.ts` already refuses to
 * import the second one for exactly this reason. Importing them here would put
 * all of it in the bundle every player downloads, to translate a footer most of
 * them never open.
 *
 * Carrying the alternative in the markup costs about a kilobyte of HTML on one
 * page, compressed with the rest of the document, and it costs the bundle
 * nothing at all. It also makes the swap total by construction: there is no list
 * of keys here to fall out of step with the layout, only "whatever the layout
 * marked", and `homeLangSwap.test.ts` fails when the layout marks less than it
 * renders.
 *
 * ## Why the values are exchanged rather than overwritten
 *
 * After the swap the document still carries both languages, so nothing about it
 * is one-way: the attribute now holds the language that was served. That is what
 * a second call would put back, which is the honest behaviour for a pair of
 * values being traded, and it is why this is safe to reason about at all — the
 * document is never left holding one language twice.
 */
import { chooseLang, langUrl, readStoredLang, type Lang } from './lang'

/**
 * Text nodes. Never `innerHTML`: these are strings, not markup.
 *
 * Trimmed on the way out, because the value being put back came from a template
 * that is free to wrap a long line — and an attribute that collected a newline
 * and twelve spaces on the first swap would hand them to `textContent` on the
 * second, where they are no longer whitespace between tags.
 */
function swapText(root: ParentNode): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-alt]')) {
    const alt = el.dataset.alt ?? ''
    el.dataset.alt = (el.textContent ?? '').trim()
    el.textContent = alt
  }
}

/**
 * Attribute pairs. The links matter more than the labels: a footer left pointing
 * at `/rules/` sends a French player to the English page, and that page is
 * static markup with no bundle to correct it. There is no second chance.
 */
function swapAttr(root: ParentNode, data: string, attr: string): void {
  const key = data.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
  for (const el of root.querySelectorAll<HTMLElement>(`[data-${data}]`)) {
    const alt = el.dataset[key] ?? ''
    el.dataset[key] = el.getAttribute(attr) ?? ''
    el.setAttribute(attr, alt)
  }
}

/**
 * Swaps the served document into the language it is not showing, and moves the
 * address bar to `url` when there is one to move it to.
 *
 * `replaceState`, for the two reasons `location.replace` was used before it:
 * Back must not point at a URL that would send the player straight here again,
 * and the entry this replaces is the one the browser is already on. What it adds
 * over a navigation is that Google reads it as neither a redirect nor a
 * canonicalisation — the request for `/` was answered with the English page, and
 * that is still what a crawler is holding.
 */
export function swapServedLang(url: string | null, root: ParentNode = document): void {
  swapText(root)
  swapAttr(root, 'alt-href', 'href')
  swapAttr(root, 'alt-aria', 'aria-label')

  // The tab's own label, and the name a bookmark takes. `<html>` carries it
  // because the <title> element cannot hold an attribute the layout would have
  // to invent a wrapper for.
  const html = document.documentElement
  if (html.dataset.altTitle !== undefined) {
    const alt = html.dataset.altTitle
    html.dataset.altTitle = document.title
    document.title = alt
  }

  if (url) history.replaceState(history.state, '', url)
  // Deliberately not `data-served-lang`: that attribute is what the page was
  // *built* as, which is still true and still what a reload would hand back.
  // `<html lang>` is the app's to write, and `initI18n()` does it a line later.
}

/**
 * Reads the three signals, adopts the answer, and returns it.
 *
 * Nothing is stored. A detection that wrote itself down would become a choice,
 * and a choice outranks the URL — so the next French link this player was sent
 * would open in English, permanently. See `lang.ts`.
 */
export function initLang(): Lang {
  const served = document.documentElement.dataset.servedLang
  const lang = chooseLang(served, readStoredLang(), navigator.language)
  // `served` twice, and it is not redundant: nothing has swapped yet, so what
  // this document shows *is* what it was served. The language switcher is where
  // the two come apart.
  const url = langUrl(lang, served, served, window.location.search, window.location.hash)
  if (url) swapServedLang(url)
  return lang
}
