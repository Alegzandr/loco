/**
 * Per-seat identity colours.
 *
 * A player keeps the same colour everywhere they appear — lobby avatar, round
 * summary row, final scoreboard — so a viewer can follow "the orange player"
 * across a whole match without re-reading nicknames. Derived from the seat
 * index, which the server guarantees is stable for the duration of a match.
 */
const SEAT_COLORS = [
  '#ff3d68', // rose
  '#2b7fff', // blue
  '#17b877', // green
  '#ffa41f', // orange
  // Kept in step with `--color-tertiary`, or a seat and the interface disagree
  // about what that colour is.
  '#6c5cff', // indigo
  '#ff5cc8', // pink
  '#14b8c4', // teal
  '#9b5cff', // violet
  '#e5b800', // gold
  '#ff6b3d', // coral
] as const

export function seatColor(index: number): string {
  const i = Number.isFinite(index) && index >= 0 ? index : 0
  return SEAT_COLORS[i % SEAT_COLORS.length]
}

/** First character of a nickname, uppercased — the avatar glyph. */
export function seatInitial(nickname: string): string {
  return (nickname.trim()[0] ?? '?').toUpperCase()
}
