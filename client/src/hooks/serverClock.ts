import type { ServerMsg } from '../types/protocol'

/**
 * The server's clock, as seen from here.
 *
 * Every deadline the server sends is an absolute instant on *its* clock — the
 * turn's `turn_deadline`, a catch window's `ends_at`, a matchmade hold's
 * `forfeit_deadline` — and every bar and capsule on screen counts it down against
 * `Date.now()`. Those two clocks are not the same clock. A phone six seconds fast
 * saw every five-second catch window already shut the moment it arrived: the
 * armed capsule never drew, and the player was told nobody was on the hook. Six
 * seconds slow, the capsule stayed up after the server's window had closed, and
 * the press it invited cost a card. Neither is latency, and no amount of it
 * explains what the player saw.
 *
 * So the server stamps every message with its own clock (`server_now`), and this
 * keeps the difference. A sample is `server_now - Date.now()` at arrival, which
 * undershoots the true offset by exactly the one-way latency of that message;
 * the largest of the recent samples is therefore the closest, and it errs on the
 * side of a window shown a few tens of milliseconds longer than it is. Clock skew
 * was seconds either way.
 *
 * Framework-free on purpose: it is read by the message handler and by nothing
 * that renders, and a test drives it with numbers.
 */

/** How many arrivals the estimate is taken over. Enough to ride out one slow
 * packet, few enough to follow a clock that steps. */
export const CLOCK_SAMPLES = 8

let samples: number[] = []

/** Records one arrival. A message with no stamp (an old server, a test fixture)
 * says nothing about the clock. */
export function noteServerNow(serverNow: number | undefined, localNow: number = Date.now()): void {
  if (typeof serverNow !== 'number' || serverNow <= 0) return
  samples.push(serverNow - localNow)
  if (samples.length > CLOCK_SAMPLES) samples = samples.slice(-CLOCK_SAMPLES)
}

/** `server clock - local clock`, in milliseconds. Zero until the server has
 * said anything, which keeps a fixture's deadlines exactly where it wrote them. */
export function serverOffset(): number {
  let best = -Infinity
  for (const s of samples) if (s > best) best = s
  return best === -Infinity ? 0 : best
}

/** An instant on the server's clock, on ours. */
export function toLocalTime(serverMs: number): number {
  return serverMs - serverOffset()
}

/** Forgets every sample. Tests, and nothing else. */
export function resetServerClock(): void {
  samples = []
}

/**
 * The message with every deadline it carries moved onto our clock, after its
 * stamp has been taken. One door for all of them, so a new deadline field is
 * added here and nowhere else — a deadline the handler forgot to convert would
 * fail exactly the way the whole class used to, silently and only on a device
 * whose clock is off.
 *
 * An absent or zero deadline stays what it is: zero means "no timer", and moving
 * it would invent one.
 */
export function localizeDeadlines(msg: ServerMsg): ServerMsg {
  noteServerNow(msg.server_now)
  const offset = serverOffset()
  if (offset === 0) return msg
  const shift = (ms: number | undefined) => (ms ? ms - offset : ms)
  const out: ServerMsg = { ...msg }
  if (msg.turn_deadline) out.turn_deadline = shift(msg.turn_deadline)
  if (msg.forfeit_deadline) out.forfeit_deadline = shift(msg.forfeit_deadline)
  if (msg.catch_locked_until) out.catch_locked_until = shift(msg.catch_locked_until)
  if (msg.catch_seats) {
    out.catch_seats = msg.catch_seats.map((c) => ({ ...c, ends_at: c.ends_at - offset }))
  }
  if (msg.state) {
    out.state = { ...msg.state }
    if (msg.state.turn_deadline) out.state.turn_deadline = shift(msg.state.turn_deadline)
    if (msg.state.catch_locked_until)
      out.state.catch_locked_until = shift(msg.state.catch_locked_until)
    if (msg.state.catch_seats) {
      out.state.catch_seats = msg.state.catch_seats.map((c) => ({ ...c, ends_at: c.ends_at - offset }))
    }
  }
  return out
}
