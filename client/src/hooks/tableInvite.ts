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
 * Two rules hold it together:
 *
 *  - **The code is a query parameter on the home page**, never a path. Every URL
 *    here is a real built page (`client/nginx.conf` answers a miss with a 404 on
 *    purpose, so there is no catch-all to route `/t/ABC234` through), and a path
 *    would need one page per code, which is not a thing a static build can emit.
 *    `?t=` costs two characters over `/t/` and works identically in dev, in the
 *    preview server and in production.
 *  - **It is spent on arrival.** `initTableInvite` takes the parameter straight
 *    back out of the address bar: a reload must not re-join a table the player
 *    has since left (the seat reclaim in `sessionPersistence` is what a reload is
 *    for), a code left in the address bar is a code on stream in a place
 *    `TableCode`'s blur does not reach, and a copied URL would keep carrying a
 *    table long after it closed.
 */

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
  return `${origin}${HOME.path[DEFAULT_LANG]}?${INVITE_PARAM}=${sanitizeTableCode(code)}`
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
  const raw = url.searchParams.get(INVITE_PARAM)
  if (raw === null) return

  // Out of the address bar first, and whatever the code turns out to be: a
  // parameter that is not a table is still a parameter nobody should re-send.
  //
  // Dropped by string, not by `searchParams.delete` + `url.search`: re-encoding
  // the query rewrites every other parameter on the way out, and `?showcase`
  // (the dev-only gallery flag `entry.ts` reads) comes back as `?showcase=`.
  // Nothing here has any business editing a parameter it was not asked about.
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((p) => p !== INVITE_PARAM && !p.startsWith(`${INVITE_PARAM}=`))
    .join('&')
  try {
    window.history.replaceState(null, '', `${url.pathname}${kept ? `?${kept}` : ''}${url.hash}`)
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
