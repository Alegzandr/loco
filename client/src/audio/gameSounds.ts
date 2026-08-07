/**
 * Decides which sounds a change of game state owes, and nothing else.
 *
 * The whole audio layer is driven from one store subscription that diffs the
 * previous and next snapshots, rather than from callbacks scattered through the
 * components. Two reasons: every sound stays in one readable list, and a sound
 * can never fire twice because two components both reacted to the same event.
 *
 * The half that decides lives here and is pure, which is what makes it a unit
 * test rather than a listening exercise. The half that subscribes and plays is
 * `gameAudio()` in `hooks/appEffects.svelte.ts` — outside any component's update
 * cycle, so a sound never costs a frame.
 */
import { gameStore } from '../hooks/gameStore'
import type { CardDTO } from '../types/protocol'
import type { SfxName } from './sfx'

type State = ReturnType<typeof gameStore.getState>

/** Sounds long enough that the music bed must get out of their way. */
export const FANFARES: ReadonlySet<SfxName> = new Set<SfxName>([
  'roundWin',
  'roundLose',
  'matchWin',
  'matchLose',
])

/** Extra sting layered on top of the generic card-play swish. */
function stingFor(card: CardDTO): SfxName | null {
  switch (card.kind) {
    case 'skip': return 'skip'
    case 'reverse': return 'reverse'
    case 'draw_two':
    case 'wild_draw_four': return 'drawStack'
    case 'wild': return 'wild'
    case 'swap':
    case 'global_switch': return 'swap'
    default: return null
  }
}

/**
 * How tense the table is, 0..1. Picks the music bed's arrangement section.
 * Deliberately coarse: the point is that the room *feels* different when someone
 * is about to go out, not that the value is precise.
 *
 * The thresholds it has to clear live in `music.ts` (`SECTION_AT`): 0.2 buildup,
 * 0.3 groove, 0.58 drop. The round summary is deliberately below all of them —
 * a round ending is the one moment in a match that should sound like a
 * breakdown, and without it the bed's calmest section would be unreachable.
 */
export function intensityOf(s: State): number {
  if (s.screen !== 'game') return 0.2
  if (s.showRoundSummary) return 0.1
  let i = 0.34
  const minHand = s.players.reduce((m, p) => Math.min(m, p.hand_size), Infinity)
  if (minHand <= 1) i += 0.3
  else if (minHand <= 2) i += 0.14
  if (s.pendingDraw > 0) i += Math.min(0.24, 0.08 + s.pendingDraw * 0.02)
  if (s.myHand.length <= 2) i += 0.1
  if (s.unoDeclared) i += 0.12
  return Math.min(1, i)
}

function totalHandSizes(s: State): number {
  return s.players.reduce((n, p) => n + p.hand_size, 0)
}

export function sceneFor(s: State): 'lobby' | 'game' | 'off' {
  switch (s.screen) {
    case 'lobby':
    case 'waiting': return 'lobby'
    case 'game': return 'game'
    default: return 'off'
  }
}

/** Reacts to one state transition. Exported for unit tests. */
export function soundsForTransition(prev: State, next: State): SfxName[] {
  const out: SfxName[] = []

  // A steal is announced before its card_played; play the slam first so the
  // two land as one gesture rather than two taps.
  if (next.interruptFlash && next.interruptFlash.at !== prev.interruptFlash?.at) {
    out.push('interrupt')
  }

  if (next.lastPlay && next.lastPlay.at !== prev.lastPlay?.at) {
    out.push('cardPlay')
    const sting = stingFor(next.lastPlay.card)
    if (sting) out.push(sting)
  }

  // Any hand growing means cards were drawn — by us or by an opponent.
  if (next.screen === 'game' && totalHandSizes(next) > totalHandSizes(prev)) {
    out.push('cardDraw')
  }

  if (next.unoDeclared && !prev.unoDeclared) out.push('unoDeclare')

  // A Contre-LOCO! that landed. The `unoCaught` voice has existed in sfx.ts
  // since the start and nothing ever played it: the game's hardest reaction was
  // silent, and the only thing the table heard was the caught player's two
  // cards being drawn, which is the sound of an ordinary turn.
  if (next.catchFlash && next.catchFlash.at !== prev.catchFlash?.at) out.push('unoCaught')

  // A Contre-LOCO! that missed. It reads as a draw on its own (the caller's hand
  // grew), which is exactly the wrong story: the sting is what says the card was
  // a price paid, not a turn taken.
  if (next.catchFailed && next.catchFailed.at !== prev.catchFailed?.at) out.push('penalty')

  // pendingDraw only climbs while a counter chain is live; the drop back to 0
  // is the stack being eaten, which is the penalty, not another stack.
  if (next.pendingDraw > prev.pendingDraw && !out.includes('drawStack')) out.push('drawStack')
  if (prev.pendingDraw > 0 && next.pendingDraw === 0 && next.screen === 'game') out.push('penalty')

  if (next.errorMsg && next.errorMsg !== prev.errorMsg) out.push('error')

  // The cue has to reach a player who can act on it, and the round summary is
  // eight seconds of a board they cannot see. The next round is dealt behind
  // that card and the clock starts with it, so the turn can become ours while
  // the scores are still up: hold the cue, and play it when the card comes
  // down on a turn that is already ours.
  const summaryLifted = prev.showRoundSummary && !next.showRoundSummary
  const turnBecameMine = next.currentTurn !== prev.currentTurn && next.currentTurn === next.myIndex
  if (
    next.screen === 'game' &&
    !next.showRoundSummary &&
    (turnBecameMine || (summaryLifted && next.currentTurn === next.myIndex))
  ) {
    out.push('yourTurn')
  }

  if (next.showRoundSummary && !prev.showRoundSummary) {
    const myNickname = next.players.find((p) => p.index === next.myIndex)?.nickname
    out.push(next.roundWinner && next.roundWinner === myNickname ? 'roundWin' : 'roundLose')
  }

  if (next.screen === 'gameover' && prev.screen !== 'gameover') {
    const myNickname = next.players.find((p) => p.index === next.myIndex)?.nickname
    out.push(next.matchWinner && next.matchWinner === myNickname ? 'matchWin' : 'matchLose')
  }

  if (next.screen === 'waiting' && next.players.length > prev.players.length) {
    out.push('playerJoin')
  }

  // The queue paid off. This is the one moment in the game the player is most
  // likely to be missing — a search runs for minutes and people go and do
  // something else — so it is also the one that most needs a sound.
  if (next.screen === 'matchfound' && prev.screen !== 'matchfound') out.push('matchFound')

  return out
}

