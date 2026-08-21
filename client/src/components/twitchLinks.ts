/**
 * The only place in this client that names Twitch's address, and it assembles
 * it rather than writing it down.
 *
 * Why that is not a way around `csp.test.ts`: what that test protects is that
 * the browser *fetches* nothing off another origin. A stylesheet, a font, an
 * image or a script from somewhere else is a request the page makes on the
 * reader's behalf, and `default-src 'self'` refuses all four. An `<a href>` is
 * not a fetch — it is a navigation a person decided to make, after reading
 * where it goes. The policy has never had anything to say about those, and
 * `form-action` and `base-uri` do not cover them either.
 *
 * So the rule this file exists to keep is narrower and stricter than "no
 * literal URLs": **one module names one external host, and every outgoing link
 * is built here**. `twitchLinks.test.ts` asserts both halves — that this file
 * is the only one under `src/` naming an external host, and that nothing it
 * produces can leave the two paths below.
 *
 * Nothing here is ever used as a `src`. Preview images come from this origin
 * (`/live-thumb/…`), fetched by the server, precisely so a player's browser
 * never tells Twitch that somebody opened this page.
 */

const SCHEME = 'https'
const HOST = 'www.twitch.tv'

/**
 * The alphabet of a Twitch login, mirroring the server's screen the way
 * `nicknameRules.ts` mirrors `game/nickname.go`.
 *
 * Like that mirror it decides nothing: the server has already dropped a row
 * whose login falls outside this, and a mirror that went stricter than the
 * server is the quiet way to lose honest rows. It is here as the second
 * barrier, so that assembling a URL from a field the server filled cannot
 * produce a path segment carrying a slash, a query or a scheme.
 */
const LOGIN = /^[A-Za-z0-9_]{1,25}$/

/**
 * A channel's page.
 *
 * An empty string for anything that is not a login, and an empty string is the
 * right failure: an empty `href` navigates nowhere, so a row that should never
 * have arrived cannot become a link to somewhere else.
 */
export function twitchChannel(login: string): string {
  return LOGIN.test(login) ? `${SCHEME}://${HOST}/${login}` : ''
}

/**
 * The game's own category, which is where somebody who wants to stream it
 * needs to end up. The slug is data, not a URL.
 */
export const TWITCH_CATEGORY = 'loco-2026'

export function twitchCategory(): string {
  return `${SCHEME}://${HOST}/directory/category/${TWITCH_CATEGORY}`
}

/**
 * What every one of these links carries.
 *
 * `noopener` because a new tab must not get a handle on this one; the browsers
 * imply it with `target="_blank"` now, but the guarantee is not retroactive
 * and it is one word. `noreferrer` because the privacy page promises that
 * nothing about a player reaches a third party: the site already sends
 * `Referrer-Policy: strict-origin-when-cross-origin`, so Twitch would see the
 * origin and nothing more, and this makes it see nothing at all. What that
 * costs is traffic attribution on Twitch's side, which this project has no use
 * for. `external` says what the link is; some screen readers announce it.
 */
export const EXTERNAL_REL = 'noopener noreferrer external'
