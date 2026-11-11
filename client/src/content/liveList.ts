/**
 * Who is live on Twitch, for `/live/`: fetched in the browser, screened, and
 * handed to `LiveArticle.svelte` to draw.
 *
 * Three properties are worth stating, because each is the reason something else
 * in this repository can stay as it is:
 *
 *  - **The fetch is same-origin.** `/live.json` is answered by our own server,
 *    which asked the gateway who is live and fetched the previews itself. So
 *    `connect-src 'self'` is untouched, `img-src 'self'` is untouched, and
 *    Twitch is never told that somebody opened this page.
 *  - **Nothing is built as markup.** Every one of these strings was written by a
 *    stranger. The article renders them as Svelte text and attributes, which are
 *    escaped by construction, and nothing anywhere takes `innerHTML` or
 *    `{@html}` (`livePage.test.ts`).
 *  - **What it draws is not indexable, on purpose.** A list of who is streaming
 *    right now is wrong tomorrow; the prose above it is what the page is for,
 *    and it is served in the markup.
 *
 * There is no retry and no polling. A reader who wants a fresher list reloads,
 * and a failed fetch leaves the served paragraph exactly where it is — which
 * already says what an empty list means.
 */
import { twitchChannel } from '../components/twitchLinks'

/** Shape of one row in `/live.json`. Kept local: this file must not pull the
 *  generated protocol types onto a content page. */
interface RawRow {
  login?: unknown
  name?: unknown
  viewers?: unknown
  thumb?: unknown
}

export interface LiveRow {
  login: string
  name: string
  viewers: number
  /** A path on this origin (`/live-thumb/…`), or empty. */
  thumb: string
}

/** How long to wait before giving up and leaving the served paragraph alone. */
const TIMEOUT_MS = 4000

/**
 * A row is drawn only if the server's own screen left it intact. The server has
 * already dropped anything malformed; this is the second barrier, and it is
 * cheap enough to be worth having on the one surface that renders a stranger's
 * name.
 */
export function readRow(raw: RawRow): LiveRow | null {
  const login = typeof raw.login === 'string' ? raw.login : ''
  if (!twitchChannel(login)) return null
  const name = typeof raw.name === 'string' && raw.name ? raw.name : login
  const viewers = typeof raw.viewers === 'number' && Number.isFinite(raw.viewers) ? Math.max(0, raw.viewers) : 0
  // A preview is a path on this origin or it is nothing. Anything else and the
  // row keeps its place without a picture.
  const thumb = typeof raw.thumb === 'string' && raw.thumb.startsWith('/live-thumb/') ? raw.thumb : ''
  return { login, name, viewers, thumb }
}

/** The rows, or none — on a timeout, an error status or a payload with nothing usable. */
export async function fetchLiveRows(): Promise<LiveRow[]> {
  try {
    const r = await fetch('/live.json', {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    })
    if (!r.ok) return []
    const payload = (await r.json()) as { streams?: RawRow[] }
    return (payload.streams ?? []).map(readRow).filter((row) => row !== null)
  } catch {
    // Nothing. The paragraph in the markup already says what this looks like.
    return []
  }
}
