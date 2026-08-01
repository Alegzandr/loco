/**
 * What the searching screen says, and when.
 *
 * Pure, and separate from `<Searching />` for the same reason `scoreTableModel`
 * is separate from `<ScoreTable />`: it is the part with a rule in it, and the
 * rule is worth testing on its own.
 *
 * The rule: the server tells this screen exactly one thing, that the player is
 * in the queue. No count, no position, no estimate, ever. So the wait is timed
 * locally and the copy is staged off elapsed seconds, and none of the three
 * stages may imply the queue is empty. "Nobody is searching" reads as "close the
 * tab", and it is self-fulfilling: the player who leaves on that sentence is the
 * opponent the next one was about to get.
 */

/** When the copy admits the search is taking longer than usual. */
export const SEARCH_PATIENT_MS = 15_000
/** When it stops promising anything about the wait and offers a private table. */
export const SEARCH_LONG_MS = 45_000

export type SearchStage = 'fresh' | 'patient' | 'long'

/** Which of the three things the screen says, from the time spent waiting. */
export function searchStage(elapsedMs: number): SearchStage {
  if (elapsedMs >= SEARCH_LONG_MS) return 'long'
  if (elapsedMs >= SEARCH_PATIENT_MS) return 'patient'
  return 'fresh'
}

/** m:ss, the shape every timer in the game uses. */
export function formatElapsed(elapsedMs: number): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
