import { DEFAULT_LANG, HOME } from '../seo/meta'
import { isTableCodeValid, sanitizeTableCode } from '../components/tableCodeRules'
import { clearSession, readSession } from './sessionPersistence'

/**
 * The link a table is shared with.
 *
 * A table code is six characters somebody has to read, retype and not mistype,
 * and the person receiving it has to know where to type it. The link removes
 * all three steps: it is the game's own URL with the code on it, so a tap opens
 * the game already pointed at the table. The code stays on screen and is still
 * what a stream reads out loud — this is the other way in, not a replacement.
 *
 * Three rules hold it together:
 *
 *  - **It has a page of its own, `/i/`, and that is what it is for.** An
 *    unfurler reads the *served* HTML and runs no script, so a link on the home
 *    page can only ever preview as the home page — "LOCO, a card game", true and
 *    not what somebody is being handed. `/i/` is `noindex`, carries the
 *    invitation's own title, description and art (`seo/meta.ts`: `INVITE`), and
 *    mounts the same game underneath.
 *  - **The code is a query parameter on that page, never a path segment.** Every
 *    URL here is a page the build emitted, and `/i/ABC234` is not one: a static
 *    build cannot emit a page per table, so resolving a path form would need a
 *    fallback in whoever serves the request. nginx can do that; `astro dev`
 *    cannot be made to — Astro 7 routes ahead of the connect stack, so a Vite
 *    plugin's middleware never sees the URL, `astro:server:setup` at the head of
 *    the stack never sees it either, and a dynamic entry in `redirects` refuses
 *    to start the server without an SSR adapter. A path form would therefore be
 *    a URL that resolves in production and 404s under `make dev` and the whole
 *    Playwright suite. The query costs three characters and is the same URL
 *    everywhere.
 *  - **It is spent on arrival.** `initTableInvite` takes the code straight back
 *    out of the address bar: a reload must not re-join a table the player has
 *    since left (the seat reclaim in `sessionPersistence` is what a reload is
 *    for), a code left in the address bar is a code on stream in a place
 *    `TableCode`'s blur does not reach, and a copied URL would keep carrying a
 *    table long after it closed.
 *
 * **The parameter only means anything on `/i/`.** It used to be read on any page,
 * because `/?t=CODE` is what the button handed out before the invite page
 * existed. It is not read there any more: one URL is an invitation, and a `?t=`
 * on the home page is now an ordinary query parameter that nothing looks at.
 * `initTableInvite` leaves it exactly where it is, the way it leaves every other
 * parameter it was not asked about.
 */

/** The page an invitation is served by. One page, every code. */
export const INVITE_PATH = '/i/'

/** The parameter the code rides on. Short on purpose: it is in a shared URL. */
export const INVITE_PARAM = 't'

/**
 * The code this page was opened on, until something claims it. Module state
 * rather than the store: it is read before the first render, by `entry.ts`,
 * next to the theme and the session record and for the same reason.
 */
let pending = ''

/**
 * The link for a table: the game's address and a code, and nothing else.
 *
 * Deliberately **not** the sender's language. A link is passed around, pasted
 * into a group chat and forwarded, and the sender does not know who ends up
 * pressing it; sending `/fr/` would decide the reader's language for them from
 * the other side of the table. The language belongs to whoever opens it, which
 * is what the i18n provider already resolves (a stored choice first, then the
 * browser). The invite carries the one thing it is for.
 */
export function tableInviteUrl(code: string, origin = window.location.origin): string {
  return `${origin}${INVITE_PATH}?${INVITE_PARAM}=${sanitizeTableCode(code)}`
}

/**
 * Reads the invite off the URL and takes it back out of the address bar. Called
 * once from `entry.ts`, before the store is seeded from the stored session.
 */
export function initTableInvite(): void {
  let url: URL
  try {
    url = new URL(window.location.href)
  } catch {
    return
  }

  // The invite page and nowhere else. A `?t=` anywhere else is somebody else's
  // parameter — and this runs on every page load, so reading it everywhere is
  // how a query string on the home page quietly turned into a join.
  //
  // Both spellings of the page: nginx resolves `/i` through `try_files $uri/`,
  // so a link that lost its slash on the way through a chat client still lands
  // on this document and still has to be read as an invitation.
  const onInvitePage = url.pathname.replace(/\/+$/, '') === INVITE_PATH.replace(/\/+$/, '')
  if (!onInvitePage) return
  const raw = url.searchParams.get(INVITE_PARAM)
  if (raw === null) return

  // Out of the address bar first, and whatever the code turns out to be: a URL
  // that is not a table is still a URL nobody should re-send.
  //
  // The parameter is dropped by string surgery, not by `searchParams.delete` +
  // `url.search`: re-encoding the query rewrites every other parameter on the
  // way out, and `?showcase` (the dev-only gallery flag `entry.ts` reads) comes
  // back as `?showcase=`. Nothing here has any business editing a parameter it
  // was not asked about.
  //
  // Spending the code spends the page with it: `/i/` with no code is a door with
  // nothing behind it, so what is left in the address bar is the home page. The
  // document does not change — this is `replaceState`, not a navigation — so the
  // game carries on uninterrupted and only a *reload* is answered by `/`.
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((p) => p !== INVITE_PARAM && !p.startsWith(`${INVITE_PARAM}=`))
    .join('&')
  try {
    window.history.replaceState(
      null,
      '',
      `${HOME.path[DEFAULT_LANG]}${kept ? `?${kept}` : ''}${url.hash}`,
    )
  } catch {
    // A sandboxed frame can refuse this. The invite is still usable.
  }

  const code = sanitizeTableCode(raw)
  if (!isTableCodeValid(code)) return
  pending = code

  // Following a link is a fresh intent and outranks a stale reclaim: the record
  // would otherwise send this tab back to the table it was last at instead of
  // the one it was just invited to. A record naming *this* table is the better
  // path and is left alone — that is a seat to reclaim, not a seat to take.
  const session = readSession()
  if (session && session.roomCode !== code) clearSession()
}

/** The pending invite, without spending it. Safe to call during a render. */
export function peekTableInvite(): string {
  return pending
}

/** The pending invite, once. Everything after this reads ''. */
export function takeTableInvite(): string {
  const code = pending
  pending = ''
  return code
}
