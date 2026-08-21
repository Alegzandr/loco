/**
 * The language, with no framework in it.
 *
 * Split out of the i18n provider for the reason `theme.ts` was split out of its
 * own hook: the content pages have to take part in this decision and
 * they mount nothing, so the storage key and the two home paths could not live
 * inside a provider. There is still exactly one definition of each — `i18n`,
 * `LanguageSwitcher` and `content/theme-boot.ts` all read them from here.
 *
 * ## Why the home page translates itself rather than navigating
 *
 * Half of `/` is markup Astro built per URL — the footer row, the drawer, the
 * prose in the sheet — and no in-app state changes a word of it. A stored choice
 * outranks the URL when the app picks its language (see `chooseLang`), so a
 * player who had chosen French and then opened `/` got the game in French under
 * a footer still reading "With friends", on a document whose `<html lang>` had
 * been rewritten to `fr` while half its text was English. That is a lie to a
 * screen reader as much as it is a mess to look at.
 *
 * This used to be answered by `location.replace`, which fixed the disagreement
 * by throwing the document away. It cost a round trip on the one page the game
 * is played from, and it put a redirect on the site's canonical English URL —
 * which is the pattern Google names when it asks sites not to redirect on a
 * visitor's presumed language. `langSwap.ts` translates the served markup in
 * place instead and moves the address bar with `history.replaceState`, which is
 * not a canonicalisation signal. The document at the new URL is real: reloading
 * `/fr/` serves the French page, and sharing the link hands over the French
 * page, so the swap is only ever a shortcut to a document that exists.
 *
 * ## What outranks what
 *
 * A stored choice wins everywhere, in both directions. The browser's language
 * only ever wins on the **default** URL: `/` is where a visitor lands without
 * saying anything, and `/fr/` is somebody having asked. Letting the browser win
 * there too would mean a French link, sent to a friend whose browser is in
 * English, opening in English — the URL you were handed overruled by a setting
 * you never touched.
 *
 * **Nothing here persists a detection.** The browser's language is re-read on
 * every boot and gives the same answer, so storing it buys nothing and costs the
 * case above forever: `rememberLang` stays the two switches' to call.
 */

export type Lang = 'en' | 'fr'

export const LANGS: readonly Lang[] = ['en', 'fr']

export const LANG_STORAGE_KEY = 'loco_lang'

/**
 * The language a URL is in when it does not say. `/` is the site's root and the
 * canonical English page at once, which is what makes it the one place a
 * browser setting is allowed to decide anything.
 */
export const DEFAULT_LANG: Lang = 'en'

/**
 * Where the game lives in each language. Two constants rather than an import of
 * `seo/meta.ts`, which carries every page on the site and is read at build time
 * by markup no player downloads. `seo.test.ts` pins these against `HOME.path`,
 * so they cannot drift from the pages Astro actually emits.
 */
export const HOME_PATH: Record<Lang, string> = { en: '/', fr: '/fr/' }

/**
 * Where the live-streams page lives, for the one link the game itself makes
 * into the site. Same two-constants-rather-than-an-import reasoning as above,
 * and pinned against `LIVE.path` by `seo.test.ts` for the same reason.
 */
export const LIVE_PATH: Record<Lang, string> = { en: '/live/', fr: '/fr/en-direct/' }

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as readonly string[]).includes(value)
}

/** The player's own choice, or null. Never the browser's, never the URL's. */
export function readStoredLang(): Lang | null {
  try {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY)
    return isLang(stored) ? stored : null
  } catch {
    return null
  }
}

/**
 * Records a choice a player made. Called by the lobby's switcher and by the
 * globe on every content page — the two places a language is *chosen*, as
 * opposed to arrived in or detected.
 */
export function rememberLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // Private mode, or storage disabled. The page is still in a language.
  }
}

/**
 * Which language this document should be in, most explicit signal first. Pure,
 * so the whole decision is testable without a DOM, a store or a navigation.
 *
 * 1. What the player chose, in both directions and at every URL.
 * 2. What the browser asks for, but **only** on a document that was served as
 *    the default language or as no language at all. On `/fr/` the URL is the
 *    request and the browser does not get to argue with it; on `/i/`, which is
 *    built as neither language, there is nothing to argue with in the first
 *    place.
 * 3. What the page was served as.
 *
 * The last two are what keeps this from ever disagreeing with itself: whatever
 * it returns for a document, it returns again for the document at the URL that
 * answer names.
 */
export function chooseLang(
  served: string | undefined,
  stored: string | null,
  browser: string | undefined,
): Lang {
  if (isLang(stored)) return stored
  const spoken = (browser ?? '').slice(0, 2).toLowerCase()
  if ((!isLang(served) || served === DEFAULT_LANG) && isLang(spoken)) return spoken
  return isLang(served) ? served : DEFAULT_LANG
}

/**
 * The URL this document should be at once `lang` is what it shows, or null to
 * stay.
 *
 * Only ever the home page's two paths: this decides a language, and every other
 * page on the site is reached by following a link that already carries one.
 *
 * `served` and `shown` are two different questions and the swap is why. On
 * arrival they are the same — the document shows what it was served. Afterwards
 * they are not: a page served as English and swapped into French shows French at
 * `/fr/` while `data-served-lang` still, correctly, says English. Asking only
 * the first would leave the language switcher unable to move the address bar
 * back, so the URL would say `/fr/` over an English document until a reload.
 */
export function langUrl(
  lang: Lang,
  served: string | undefined,
  shown: string | undefined,
  search = '',
  hash = '',
): string | null {
  // No `data-served-lang` is the invite page, which is one URL in both
  // languages. There is no other address for it to be at.
  if (!isLang(served) || lang === shown) return null
  return HOME_PATH[lang] + search + hash
}
