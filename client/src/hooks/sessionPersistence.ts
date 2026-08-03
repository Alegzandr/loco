import type { ClientMsg } from '../types/protocol'

/**
 * Session persistence: what makes a reload survivable.
 *
 * The socket-level reconnect (webSocket + App.getReconnectMsg) only ever
 * covered a dropped connection: the store was still in memory, so it still knew
 * the room, the seat and the token. A refresh, a crashed tab, an accidental
 * navigation or a phone that killed the page throws all of that away, and the
 * player lands back on the lobby while the server holds their seat, their hand
 * and their score for another minute with nobody able to claim it. That is the
 * disconnect people actually have, and it was the one that could not be undone.
 *
 * Storage is sessionStorage, deliberately, not localStorage:
 *   - it is per tab, so two seats played from one browser (the ordinary way this
 *     game is tested, and how a lot of people play with a friend on one machine)
 *     cannot overwrite each other's token and reclaim the wrong seat;
 *   - it survives a reload, a back/forward navigation and a crash restore, which
 *     is every case this exists for;
 *   - it dies with the tab, so a shared machine does not hand the next person a
 *     live seat.
 */

export const SESSION_KEY = 'loco_session'

/**
 * Beyond this, a stored session is treated as scenery and dropped without a
 * round trip. It is a staleness guard, not a correctness one: the server is the
 * only authority on whether a slot can still be claimed (60 s for an in-match
 * seat, and the room itself is cleaned up 5 min after it empties). Its job is to
 * keep a cold open days later from flashing a reconnect screen at somebody who
 * just wants the lobby.
 */
export const SESSION_TTL_MS = 30 * 60 * 1000

/** The screens worth coming back to. A lobby has nothing to reclaim, and a
 *  finished match has already released the seat. */
export type RestoreTarget = 'waiting' | 'game'

export interface PersistedSession {
  roomCode: string
  nickname: string
  sessionToken: string
  /** Which screen the tab was on, i.e. which rejoin the server expects. */
  target: RestoreTarget
  /** Last time this record was known to be live (see touchSession). */
  at: number
}

function storage(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    // Private modes and embedded webviews can throw on access alone.
    return null
  }
}

function isTarget(v: unknown): v is RestoreTarget {
  return v === 'waiting' || v === 'game'
}

/**
 * Reads the stored session, or null if there is none, it is malformed, or it is
 * older than SESSION_TTL_MS. Anything unreadable is also cleared: a record we
 * cannot parse will never become parseable.
 */
export function readSession(now = Date.now()): PersistedSession | null {
  const s = storage()
  if (!s) return null
  const raw = s.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedSession>
    if (
      typeof parsed.roomCode !== 'string' || !parsed.roomCode ||
      typeof parsed.nickname !== 'string' || !parsed.nickname ||
      typeof parsed.sessionToken !== 'string' ||
      typeof parsed.at !== 'number' ||
      !isTarget(parsed.target)
    ) {
      s.removeItem(SESSION_KEY)
      return null
    }
    // A game seat is reclaimed with a token; without one there is nothing to
    // authenticate with and the server would refuse the rejoin.
    if (parsed.target === 'game' && !parsed.sessionToken) {
      s.removeItem(SESSION_KEY)
      return null
    }
    if (now - parsed.at > SESSION_TTL_MS) {
      s.removeItem(SESSION_KEY)
      return null
    }
    return parsed as PersistedSession
  } catch {
    s.removeItem(SESSION_KEY)
    return null
  }
}

export function writeSession(session: Omit<PersistedSession, 'at'>, now = Date.now()): void {
  const s = storage()
  if (!s) return
  try {
    s.setItem(SESSION_KEY, JSON.stringify({ ...session, at: now }))
  } catch {
    // A full or disabled quota is not worth taking the app down for.
  }
}

/**
 * Re-stamps the record's timestamp without touching its contents.
 *
 * The persisted fields (room, nickname, token) are written once, when the player
 * joins, so `at` would otherwise be the join time and the TTL would refuse a
 * perfectly legitimate reload half an hour into a long match. This is called as
 * the page goes away, which is the moment the TTL is actually measuring from.
 */
export function touchSession(now = Date.now()): void {
  const s = storage()
  if (!s) return
  const raw = s.getItem(SESSION_KEY)
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as PersistedSession
    s.setItem(SESSION_KEY, JSON.stringify({ ...parsed, at: now }))
  } catch {
    s.removeItem(SESSION_KEY)
  }
}

export function clearSession(): void {
  const s = storage()
  if (!s) return
  try {
    s.removeItem(SESSION_KEY)
  } catch {
    // See writeSession.
  }
}

/** The slice of store state the rejoin message is built from. */
export interface ReconnectContext {
  screen: string
  restoreTarget: RestoreTarget | null
  roomCode: string
  sessionToken: string
  myIndex: number
  myNickname: string
  players: { index: number; nickname: string }[]
}

/**
 * The message to send the instant a socket opens, or null when there is nothing
 * to rejoin. One pure function for all three cases (a socket that dropped
 * mid-match, one that dropped in the lobby, and a tab that was reloaded), so
 * they cannot drift apart.
 *
 * A restoring tab has no player list yet, which is why the nickname falls back
 * to the persisted one: deriving it from `players` alone (the only source before
 * this existed) yields '' on a cold boot and silently sends a nameless join.
 */
export function reconnectMessageFor(ctx: ReconnectContext): ClientMsg | null {
  const target: RestoreTarget | null =
    ctx.screen === 'restoring'
      ? ctx.restoreTarget
      : ctx.screen === 'game' || ctx.screen === 'waiting'
        ? ctx.screen
        : null
  if (!target || !ctx.roomCode) return null

  const nickname = ctx.players.find((p) => p.index === ctx.myIndex)?.nickname || ctx.myNickname
  if (!nickname) return null

  // Active gameplay: token-authenticated, or the server refuses the reclaim and
  // the seat stays held for a stranger.
  if (target === 'game') {
    if (!ctx.sessionToken) return null
    return { type: 'join_room', nickname, room_code: ctx.roomCode, session_token: ctx.sessionToken }
  }

  // Lobby: the seat was released the moment the socket closed, so this is an
  // ordinary join and needs no token.
  return { type: 'join_room', nickname, room_code: ctx.roomCode }
}
