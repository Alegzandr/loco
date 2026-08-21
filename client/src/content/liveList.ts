/**
 * The live channels on `/live/`, filled in the browser.
 *
 * Wired from `theme-boot.ts` rather than shipped as a script of its own, for
 * the reason that file states about every other behaviour it has grown: there
 * is only ever one script on these pages, so a second one is a second request
 * and a second thing to remember when counting what a content page loads. This
 * module is imported the way `navMenu.ts` is, and it returns immediately on
 * every page that has no list to fill.
 *
 * Three properties are worth stating, because each is the reason something else
 * in this repository can stay as it is:
 *
 *  - **The fetch is same-origin.** `/live.json` is answered by our own server,
 *    which asked the gateway who is live and fetched the previews itself. So
 *    `connect-src 'self'` is untouched, `img-src 'self'` is untouched, and
 *    Twitch is never told that somebody opened this page.
 *  - **Nothing here is built with `innerHTML`.** Every one of these strings was
 *    written by a stranger. `createElement` and `textContent` are the whole
 *    construction, and `contentPages.test.ts` fails on an `innerHTML` in this
 *    file.
 *  - **What it draws is not indexable, on purpose.** A list of who is streaming
 *    right now is wrong tomorrow; the prose above it is what the page is for,
 *    and it is served in the markup.
 *
 * There is no retry and no polling. A reader who wants a fresher list reloads,
 * and a failed fetch leaves the served paragraph exactly where it is — which
 * already says what an empty list means.
 */
import { EXTERNAL_REL, twitchChannel } from '../components/twitchLinks'

/** Shape of one row in `/live.json`. Kept local: this file must not pull the
 *  generated protocol types onto a content page, which ships no game code. */
interface LiveRow {
  login?: unknown
  name?: unknown
  viewers?: unknown
  thumb?: unknown
}

/** How long to wait before giving up and leaving the served paragraph alone. */
const TIMEOUT_MS = 4000

/**
 * A row is drawn only if the server's own screen left it intact. The server has
 * already dropped anything malformed; this is the second barrier, and it is
 * cheap enough to be worth having on the one surface that renders a stranger's
 * name.
 */
function readRow(raw: LiveRow): { login: string; name: string; viewers: number; thumb: string } | null {
  const login = typeof raw.login === 'string' ? raw.login : ''
  if (!twitchChannel(login)) return null
  const name = typeof raw.name === 'string' && raw.name ? raw.name : login
  const viewers = typeof raw.viewers === 'number' && Number.isFinite(raw.viewers) ? Math.max(0, raw.viewers) : 0
  // A preview is a path on this origin or it is nothing. Anything else and the
  // row keeps its place without a picture.
  const thumb = typeof raw.thumb === 'string' && raw.thumb.startsWith('/live-thumb/') ? raw.thumb : ''
  return { login, name, viewers, thumb }
}

function drawRow(row: NonNullable<ReturnType<typeof readRow>>, watching: string): HTMLLIElement {
  const li = document.createElement('li')

  const link = document.createElement('a')
  link.className = 'liveCard'
  link.href = twitchChannel(row.login)
  link.target = '_blank'
  link.rel = EXTERNAL_REL

  if (row.thumb) {
    const img = document.createElement('img')
    img.className = 'liveThumb'
    img.src = row.thumb
    img.alt = ''
    // Written on the element: a preview that arrives late must not resize the
    // list under somebody who is reading it.
    img.width = 320
    img.height = 180
    img.loading = 'lazy'
    img.decoding = 'async'
    link.append(img)
  }

  const name = document.createElement('span')
  name.className = 'liveName'
  name.textContent = row.name
  link.append(name)

  const count = document.createElement('span')
  count.className = 'liveCount'
  count.textContent = `${row.viewers.toLocaleString(document.documentElement.lang || 'en')} ${watching}`
  link.append(count)

  li.append(link)
  return li
}

export function fillLiveList(): void {
  const section = document.getElementById('liveNow')
  if (!section) return

  const list = section.querySelector<HTMLUListElement>('.liveList')
  const note = section.querySelector<HTMLParagraphElement>('.liveNote')
  if (!list) return

  const watching = list.dataset.watching ?? ''

  fetch('/live.json', { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((payload: { streams?: LiveRow[] }) => {
      const rows = (payload.streams ?? []).map(readRow).filter((r) => r !== null)
      if (!rows.length) return
      for (const row of rows) list.append(drawRow(row, watching))
      list.hidden = false
      // The served paragraph explains an empty list and a browser with no
      // scripts. Neither is true any more once there are rows.
      if (note) note.hidden = true
    })
    .catch(() => {
      // Nothing. The paragraph in the markup already says what this looks like.
    })
}
