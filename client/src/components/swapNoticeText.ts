import { SwapNotice } from '../hooks/gameStore'
import { Translations } from '../i18n/en'

/**
 * The line a Swap or a GlobalSwitch puts on screen.
 *
 * Picks the right template (you-as-actor / you-as-target for a Swap, clockwise
 * or counter-clockwise for a GlobalSwitch) and substitutes the names. Pure, so
 * the wording of the game's most confusing moment is testable without a board.
 */
export function resolveSwapNoticeText(
  notice: SwapNotice,
  myIndex: number,
  players: { index: number; nickname: string }[],
  t: Translations,
): string {
  const actor = players.find((p) => p.index === notice.actorIndex)?.nickname ?? `P${notice.actorIndex}`
  const target = notice.targetIndex >= 0
    ? (players.find((p) => p.index === notice.targetIndex)?.nickname ?? `P${notice.targetIndex}`)
    : ''
  if (notice.kind === 'swap') {
    const tpl = notice.actorIndex === myIndex
      ? t.swapNoticeYouActor
      : notice.targetIndex === myIndex
        ? t.swapNoticeYouTarget
        : t.swapNotice
    return tpl.replace('%actor', actor).replace('%target', target)
  }
  // direction === 1 means clockwise (next-seat); -1 means counter-clockwise.
  const tpl = notice.direction >= 0 ? t.globalSwitchNoticeCw : t.globalSwitchNoticeCcw
  return tpl.replace('%actor', actor)
}
