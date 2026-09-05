/**
 * The line under the game-over heading that says how long the match took.
 *
 * The number is the server's (`MatchRecordDTO.duration_ms`, measured from the
 * moment the turn clock started to the moment the match ended), and it rides
 * the match's own record in `match_history`, so a reload at the game-over
 * screen and a deploy mid-match both keep it. This module only decides how to
 * word it, and is pure so the three magnitudes are unit-tested rather than
 * eyeballed.
 *
 * Minutes, never seconds: a card game is not timed to the second, and a figure
 * like `7:42` on the screenshot people post reads as a speedrun timer. Under a
 * minute is said in words for the same reason — "0 min" is a number that
 * looks broken.
 */
import type { MatchRecordDTO } from '../types/protocol'
import type { Translations } from '../i18n/en'

const MINUTE_MS = 60_000

/**
 * Words a duration, or returns null when there is nothing honest to say.
 *
 * Null for zero and below: the server omits the field for a match it cannot
 * time (a forfeit inside the loading gate, a match restored from an older
 * snapshot), and a line saying "0 min of play" over a match that was played
 * would be worse than no line.
 */
export function formatMatchDuration(ms: number | undefined, t: Translations): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  if (ms < MINUTE_MS) return t.matchDuration(t.durationUnderMinute)
  // Rounded to the nearest minute, and never below one: 59.6 minutes is an
  // hour, and 60.4 seconds is a minute rather than "under a minute" again.
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS))
  if (minutes < 60) return t.matchDuration(t.durationMinutes(minutes))
  return t.matchDuration(t.durationHours(Math.floor(minutes / 60), minutes % 60))
}

/**
 * The duration of the match that has just ended, off the recap the server sent
 * with `match_end`: the last record is always that match, because the server
 * records it before it announces it.
 */
export function lastMatchDurationMs(history: MatchRecordDTO[]): number | undefined {
  return history.length > 0 ? history[history.length - 1].duration_ms : undefined
}
