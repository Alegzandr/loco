/**
 * How long a match is likely to take, from the format and the number of seats.
 *
 * It exists because the decision and the advice were in different places: the
 * host picks a format in the waiting room, and the only thing that said what a
 * best-of-7 costs was the FAQ. A host who has not played one has no way to know
 * that seven rounds at six seats is most of an hour.
 *
 * **It returns a range, not a number, and that is the rule the LOT it belongs to
 * turns on**: a match ends the moment the lead in rounds won cannot be caught
 * (`Room.decisiveLeader`), so a best-of-7 finishes anywhere between four rounds
 * and seven. A single figure would be wrong at both ends, and it would be wrong
 * in the direction that matters — a host reading "≈ 30 min" and getting sixteen
 * is a host who stops offering long formats.
 *
 * Pure and separate from `<WaitingRoom />` for the same reason `scoreTableModel`
 * is separate from its table: it is the part with arithmetic in it.
 */
import type { MatchFormat } from '../types/protocol'

/**
 * Minutes one round takes, per seat.
 *
 * A round is every seat playing until somebody empties a hand of eight, so the
 * cost is roughly linear in the number of players. The constant is measured
 * rather than derived: it is the shape of a real round at the 30 s turn clock,
 * with the clock almost never being the thing that ends a turn. It is
 * deliberately generous — an estimate that runs short is the one that costs a
 * host the evening.
 */
const MINUTES_PER_SEAT_PER_ROUND = 0.85

/** Rounds in the format, i.e. the most that can be played before sudden death. */
export function formatRounds(format: MatchFormat): number {
  switch (format) {
    case 'BO3':
      return 3
    case 'BO5':
      return 5
    case 'BO7':
      return 7
    default:
      return 1
  }
}

/**
 * The fewest rounds that can settle the format.
 *
 * The match stops as soon as one seat's rounds won cannot be caught by the
 * rounds left, so at two seats a best-of-7 can be over at 4–0. Past two seats it
 * is the same number: one seat has to be strictly ahead of every other plus the
 * rounds remaining, and the fastest way there is still winning every round.
 */
export function fastestRounds(format: MatchFormat): number {
  const n = formatRounds(format)
  return Math.ceil(n / 2)
}

/** A match length estimate, in whole minutes. Both ends inclusive. */
export interface MatchLength {
  minMinutes: number
  maxMinutes: number
  /** True when the format cannot end early, so the range is a single number. */
  exact: boolean
}

/**
 * Estimated length of one match. `seats` is how many people are at the table.
 *
 * Rounded to whole minutes, and never to zero: "≈ 0 min" reads as broken rather
 * than as fast.
 */
export function matchLength(format: MatchFormat, seats: number): MatchLength {
  const players = Math.max(2, Math.round(seats))
  const perRound = players * MINUTES_PER_SEAT_PER_ROUND
  const min = Math.max(1, Math.round(fastestRounds(format) * perRound))
  const max = Math.max(min, Math.round(formatRounds(format) * perRound))
  return { minMinutes: min, maxMinutes: max, exact: min === max }
}

/**
 * The estimate as the string the waiting room draws.
 *
 * The `≈` is carried by the copy on purpose: this is an estimate about a game
 * whose rounds end when somebody empties a hand, and a bare number would be
 * read as a promise.
 */
export function matchLengthLabel(format: MatchFormat, seats: number, unit: string): string {
  const { minMinutes, maxMinutes, exact } = matchLength(format, seats)
  return exact ? `≈ ${minMinutes} ${unit}` : `≈ ${minMinutes}-${maxMinutes} ${unit}`
}
