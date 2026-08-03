/**
 * The language, with no framework in it.
 *
 * Split out of the i18n provider for the reason `theme.ts` was split out of its
 * own hook: the content pages have to take part in this decision and
 * they mount nothing, so the storage key and the two home paths could not live
 * inside a provider. There is still exactly one definition of each — `i18n`,
 * `LanguageSwitcher` and `content/theme-boot.ts` all read them from here.
 *
 * ## Why a redirect rather than a translation
 *
 * Half of `/` is markup Astro built per URL — the footer row, the drawer, the
 * prose in the sheet — and no in-app state changes a word of it. A stored choice
 * outranks the URL when the app picks its language (see `detectLang`), so a
 * player who had chosen French and then opened `/` got the game in French under
 * a footer still reading "With friends", on a document whose `<html lang>` had
 * been rewritten to `fr` while half its text was English. That is a lie to a
 * screen reader as much as it is a mess to look at.
 *
 * The lobby's switcher already answers this by *navigating* rather than
 * toggling: following it serves the whole document in the other language. This
 * makes the same thing happen on arrival. The alternative — letting the URL win
 * outright — would mean a player who chose French and then pasted `/` gets an
 * English game, and the alternative to both would put the navigation's copy into
 * the bundle every player downloads.
 *
 * Only an explicit choice is stored, so this only ever acts on one. Landing on a
 * French page from a search result is not a choice and writes nothing.
 */

export type Lang = 'en' | 'fr'

export const LANGS: readonly Lang[] = ['en', 'fr']

export const LANG_STORAGE_KEY = 'loco_lang'

/**
 * Where the game lives in each language. Two constants rather than an import of
 * `seo/meta.ts`, which carries every page on the site and is read at build time
 * by markup no player downloads. `seo.test.ts` pins these against `HOME.path`,
 * so they cannot drift from the pages Astro actually emits.
 */
export const HOME_PATH: Record<Lang, string> = { en: '/', fr: '/fr/' }

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
 * opposed to arrived in.
 */
export function rememberLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // Private mode, or storage disabled. The page is still in a language.
  }
}

/**
 * The URL this document should be at, or null to stay.
 *
 * Pure, so the decision is testable without a navigation. Two guards keep it
 * from ever looping: an unrecognised stored value is not a choice, and a served
 * language that is missing or unknown is not something to disagree with — with
 * no `data-served-lang` to compare against, every load would redirect to the
 * same place it already is.
 */
export function langRedirect(
  served: string | undefined,
  stored: string | null,
  search = '',
  hash = '',
): string | null {
  if (!isLang(stored) || !isLang(served) || served === stored) return null
  return HOME_PATH[stored] + search + hash
}

/**
 * Applies that decision. Returns true when the document is leaving, so the
 * caller can stop booting.
 *
 * The query string and the fragment travel: `?t=CODE` is a table invitation and
 * dropping it would land the guest at a home page with no table in it, and
 * `?showcase=` is how the visual harness drives this page.
 */
export function initLangUrl(): boolean {
  const target = langRedirect(
    document.documentElement.dataset.servedLang,
    readStoredLang(),
    window.location.search,
    window.location.hash,
  )
  if (target === null) return false
  // `replace`, never `assign`: an extra history entry would leave Back pointing
  // at a URL that redirects straight back here, and the way out of the game
  // would be a trap.
  window.location.replace(target)
  return true
}
