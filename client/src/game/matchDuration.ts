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
 * To the second. It was minutes only, on the argument that a card game is not
 * timed to the second; the player asked for the seconds, and a recap that says
 * `12 min 34 s` is a record where `12 min` was an estimate. Units are written
 * out (`min`, `s`) rather than `12:34`, which reads as a clock or a speedrun
 * split, and the seconds are padded so the column of an evening's recaps lines
 * up. Never zero: the server omits the field for a match it could not time,
 * and a match that was played is rounded up to a second.
 */
import type { MatchRecordDTO } from '../types/protocol'
import type { Translations } from '../i18n/en'

const SECOND_MS = 1_000

/**
 * Words a duration, or returns null when there is nothing honest to say.
 *
 * Null for zero and below: the server omits the field for a match it cannot
 * time (a forfeit inside the loading gate, a match restored from an older
 * snapshot), and a line saying "0 s of play" over a match that was played
 * would be worse than no line.
 */
export function formatMatchDuration(ms: number | undefined, t: Translations): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null
  // Rounded to the nearest second, and never below one: 59.6 seconds is a
  // minute, and 400 ms of play is a second rather than nothing.
  const total = Math.max(1, Math.round(ms / SECOND_MS))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  if (hours > 0) return t.matchDuration(t.durationHours(hours, minutes, seconds))
  if (minutes > 0) return t.matchDuration(t.durationMinutes(minutes, seconds))
  return t.matchDuration(t.durationSeconds(seconds))
}

/**
 * The duration of the match that has just ended, off the recap the server sent
 * with `match_end`: the last record is always that match, because the server
 * records it before it announces it.
 */
export function lastMatchDurationMs(history: MatchRecordDTO[]): number | undefined {
  return history.length > 0 ? history[history.length - 1].duration_ms : undefined
}
