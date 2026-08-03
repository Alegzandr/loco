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

// The socket itself is `webSocket.svelte.ts`. The schedule stays here, apart from
// it, because `realtime.test.ts` owns this table and nothing about a backoff
// curve belongs to a framework.
