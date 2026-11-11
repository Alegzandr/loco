/**
 * What the home screen's live strip draws, and how much of it.
 *
 * Here rather than in the component for the reason `playersOnline.ts` gives:
 * these are product rules, and a product rule should be statable by a test
 * without mounting a screen.
 */
import type { LiveStreamDTO } from '../types/protocol'

/**
 * How many channels the strip shows.
 *
 * Three, because the strip is drawn across the bottom of a screen that is
 * exactly one viewport and never scrolls, and because the point is the biggest
 * few rather than a directory. The server sends six, so a row dropped between
 * two polls does not leave a gap.
 */
export const LIVE_ROWS = 3

/**
 * The top of the list, and nothing else.
 *
 * It cuts and never sorts. The order is Twitch's own, biggest first, carried
 * through the server untouched — re-sorting here would be a second opinion
 * about a ranking that already exists, and the first sign of it going wrong
 * would be a strip that disagrees with the category page it links to.
 */
export function topLiveStreams(list: readonly LiveStreamDTO[], n = LIVE_ROWS): LiveStreamDTO[] {
  if (n <= 0) return []
  return list.slice(0, n)
}

/**
 * How many are live but not drawn, for the "and N more" line.
 *
 * The server caps what it sends, so this counts what arrived rather than what
 * exists: a number that says "12 more" over a list of six would be a promise
 * the link cannot keep.
 */
export function moreLiveCount(list: readonly LiveStreamDTO[], n = LIVE_ROWS): number {
  return Math.max(0, list.length - n)
}

/**
 * Whether anybody is live at all.
 *
 * There is no floor here, unlike the connected-player count: one channel live
 * is one thing to watch, where one player online is "you are alone". And the
 * strip is drawn either way — empty, it invites somebody to be the first,
 * which is the state this shipped in and the reason the feature exists at all.
 */
export function hasLiveStreams(list: readonly LiveStreamDTO[]): boolean {
  return list.length > 0
}

/**
 * A viewer count, in the shortest honest form.
 *
 * Thousands are cut to one decimal because the strip is 96px wide per row and
 * a five-digit number sets the column width for everybody. Below a thousand
 * the exact figure fits, so the exact figure is what is shown — the same rule
 * the connected-player count follows: never rounded when it need not be.
 *
 * The separator is the locale's, so French reads 1,2 k and English 1.2K.
 */
export function formatViewers(count: number, lang: string): string {
  if (count < 1000) return String(count)
  const thousands = Math.floor(count / 100) / 10
  const digits = thousands < 100 ? 1 : 0
  const n = thousands.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
  return lang === 'fr' ? `${n} k` : `${n}K`
}
