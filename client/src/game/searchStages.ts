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

/**
 * When the copy admits the search is taking longer than usual.
 *
 * The stages are also the only exit this screen offers, and the exit used to
 * arrive far too late: 45 s to be told a table is an option is 45 s a first-time
 * visitor does not spend. They spend about ten, and then they close the tab —
 * so the door is at 20 s now, and the second stage that leads up to it at 10.
 * What the numbers cannot change is the rule above: at every one of the three
 * stages the queue is still a queue somebody may be joining.
 */
export const SEARCH_PATIENT_MS = 10_000
/** When it stops promising anything about the wait and offers a private table. */
export const SEARCH_LONG_MS = 20_000

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
