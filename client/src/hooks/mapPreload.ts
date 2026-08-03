/**
 * How long to keep waiting on a map's images before telling the server we are
 * ready anyway.
 *
 * Shorter than the server's own MapLoadTimeout on purpose: the server's is the
 * backstop for a client that has stopped answering entirely, and if the two were
 * equal every slow connection would look like a dead one. A player whose table is
 * still a rectangle when this fires would rather join a match late than sit alone
 * on a loading screen while the room waits them out.
 */
export const MAP_PRELOAD_TIMEOUT_MS = 12_000

export interface MapPreloadState {
  /** 0–1 across the map's files. Drives the bar, never a rules decision. */
  progress: number
  /** True once every file has settled: decoded, failed, or timed out. */
  done: boolean
}

// The loader is `gamePlay.svelte.ts`'s `mapPreload`. What is left here is the
// contract it fills and the one number the timeout is measured against.
