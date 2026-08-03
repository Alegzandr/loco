export type WsStatus = 'connecting' | 'open' | 'closed'

// Backoff schedule, in milliseconds, indexed by attempt. The first retry is
// deliberately almost immediate: most drops in practice are a single lost
// connection (a wifi hiccup, a proxy recycling), and they come back at once.
// A flat two-second first retry meant that every one of those cost the player two
// seconds of a dead board (an entire interrupt window, a third of a catch window)
// for a socket that would have reopened in a quarter of a second. The tail still
// backs off, so a server that is genuinely down is not hammered.
// The tail is longer than the cap it used to stop at, and the schedule no longer
// ends. It used to run out after ten attempts — 27.75 s, and then the client sat
// on a "Reconnecting…" curtain that would never come down again, for the rest of
// the tab's life. A deploy does not produce that (compose holds the old server
// for its whole drain), but everything around one does: a slow image pull, a
// crash loop, a stop_grace_period reached, a phone that suspended the tab for an
// hour. The player's own 27.75 s could also expire before the server had started
// counting the 60 s it holds their seat for, which is the case where giving up
// cost a seat that was still there.
//
// So it backs off further instead of stopping. 15 s is the floor of politeness
// to a server that is genuinely down, and it is not the recovery path anyway:
// coming back online, coming back to the tab and pressing the button all
// reconnect on the spot. See webSocket.svelte.ts.
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 15000]

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

// --- Where the socket dials ---
//
// The game used to open its socket on the page's own origin, which put it
// behind the CDN with everything else. Measured from Paris, against a server in
// Paris: 8.5 ms of round trip on a direct socket, 389 ms through the proxy, on a
// connection already established. That is not a page-load cost paid once, it is
// every card, every interrupt and every catch — and interrupts are decided by
// arrival order, so it is the mechanic rather than the polish.
//
// So production points the socket at a hostname that resolves to the origin
// directly, and the site keeps the CDN. Only the socket leaves; the HTML, the
// bundle and the images all still want the cache and the edge.

export interface WsEndpoints {
  /** The hostname that bypasses the CDN, or null when the build named none. */
  direct: string | null
  /** Same-origin, through whatever serves the page. Always available. */
  proxied: string
}

/** The three fields of `window.location` this needs, so a test needs no DOM. */
export interface WsLocation {
  protocol: string
  hostname: string
  host: string
}

export interface WsEnv {
  VITE_WS_PORT?: string
  VITE_WS_ORIGIN?: string
}

/**
 * VITE_WS_PORT is dev: docker-compose.dev.yml points it at the Go server's own
 * port, because Vite's WebSocket proxy is unreliable under Docker networking.
 * It wins over everything and leaves no direct endpoint, since there is no CDN
 * in front of a dev server to escape.
 *
 * VITE_WS_ORIGIN is production, baked in at build time like VITE_PUBLIC_ORIGIN
 * and for the same reason: the image is built per environment. Its scheme is
 * taken from the page rather than from the value, so a `wss://` written into an
 * http:// deployment (or the reverse) cannot produce a socket the browser
 * refuses to open at all — mixed content fails silently and looks like the
 * server being down.
 */
export function wsEndpoints(loc: WsLocation, env: WsEnv): WsEndpoints {
  const proto = loc.protocol === 'https:' ? 'wss' : 'ws'

  const devPort = env.VITE_WS_PORT?.trim()
  if (devPort) return { direct: null, proxied: `${proto}://${loc.hostname}:${devPort}/ws` }

  const proxied = `${proto}://${loc.host}/ws`
  const origin = env.VITE_WS_ORIGIN?.trim()
  if (!origin) return { direct: null, proxied }

  const bare = origin.replace(/^wss?:\/\//i, '').replace(/\/+$/, '')
  if (!bare) return { direct: null, proxied }
  return { direct: `${proto}://${bare}/ws`, proxied }
}

/**
 * How many sockets may fail to open on the direct hostname before the game
 * gives up on it for the rest of the page's life.
 *
 * The direct hostname is the one part of this stack whose certificate nothing
 * renews on its own and nothing here can see expire. A dead socket is a dead
 * game, and a game at 389 ms is a bad game: the second is worth having.
 */
export const DIRECT_FAILURES_BEFORE_FALLBACK = 3

/**
 * The fallback is one-way on purpose. Resetting it on every successful proxied
 * connection would spend the three failures again on each reconnect, so an
 * expired certificate would cost a stall at every drop instead of once. A page
 * reload is what tries the direct hostname again.
 */
export function wsUrl(endpoints: WsEndpoints, fellBack: boolean): string {
  if (fellBack || endpoints.direct === null) return endpoints.proxied
  return endpoints.direct
}

// The socket itself is `webSocket.svelte.ts`. The schedule stays here, apart from
// it, because `realtime.test.ts` owns this table and nothing about a backoff
// curve belongs to a framework.
