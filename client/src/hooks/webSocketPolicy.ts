export type WsStatus = 'connecting' | 'open' | 'closed'

// Backoff schedule, in milliseconds, indexed by attempt. The first retry is
// deliberately almost immediate: most drops in practice are a single lost
// connection (a wifi hiccup, a proxy recycling), and they come back at once.
// A flat two-second first retry meant that every one of those cost the player two
// seconds of a dead board (an entire interrupt window, a third of a catch window)
// for a socket that would have reopened in a quarter of a second. The tail still
// backs off, so a server that is genuinely down is not hammered.
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000]

export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

// The socket itself is `webSocket.svelte.ts`. The schedule stays here, apart from
// it, because `wsReconnect.test.ts` owns this table and nothing about a backoff
// curve belongs to a framework.
