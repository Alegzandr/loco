/**
 * The game page in the language it should be in: a navigation, not a rewrite.
 *
 * Under Astro, `/` was markup built once per URL with no router behind it, so a
 * document in the wrong language could only be fixed by throwing it away
 * (`location.replace`, a round trip and a redirect on the canonical URL) or by
 * rewriting it where it stood — every string and link carried its other
 * language in `data-alt*` attributes and `langSwap.ts` exchanged them, then
 * moved the address bar with a bare `history.replaceState`. That was the right
 * answer to a static page and the wrong one to an app: the other language's
 * page exists, the router can render it without a round trip, and the game is
 * kept across the move (it lives in the root layout).
 *
 * So the language decision is now a client-side navigation to the page in that
 * language — `goto` with `replaceState`, so Back never points at the URL that
 * would send the player straight here again, and it reads as neither a redirect
 * nor a canonicalisation: the request for `/` was answered with the English
 * page, and that is still what a crawler holds. What decides, and what is
 * allowed to outrank what, is unchanged and lives in `lang.ts`.
 */
import { goto } from '$app/navigation'
import { chooseLang, langUrl, readStoredLang, type Lang } from './lang'

/**
 * Puts the address bar, and the page the router shows, at `url` — in place of
 * the current history entry, leaving the scroll and the focus where they were
 * (`reset: false`).
 */
export function moveTo(url: string): void {
  void goto(url, { replace: true, reset: false })
}

/**
 * Reads the three signals, and moves to the page in the answer's language when
 * this one is not it. Returns the answer.
 *
 * Nothing is stored. A detection that wrote itself down would become a choice,
 * and a choice outranks the URL — so the next French link this player was sent
 * would open in English, permanently. See `lang.ts`.
 *
 * Called when the game boots, and again whenever the router brings it back to a
 * game page: the page arrived at may be the other language's, and a choice may
 * have been recorded on the way (the globe on every page writes it).
 */
export function initLang(): Lang {
  const served = document.documentElement.dataset.servedLang
  const lang = chooseLang(served, readStoredLang(), navigator.language)
  const url = langUrl(lang, served, served, window.location.search, window.location.hash)
  if (url) moveTo(url)
  return lang
}
