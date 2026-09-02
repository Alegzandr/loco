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

  // Any hand growing means cards were drawn — by us or by an opponent. A deal
  // is the exception: `dealFor` plays those cards one by one.
  if (
    next.screen === 'game' &&
    totalHandSizes(next) > totalHandSizes(prev) &&
    dealFor(prev, next) === 0
  ) {
    out.push('cardDraw')
  }

  // Keyed on the stamp, not the latch: `unoDeclared` stays up for as long as
  // the banner does, so a second seat calling it under the first one's banner
  // — routine after a Global Switch — used to make no sound at all.
  if (next.unoDeclaredAt !== prev.unoDeclaredAt && next.unoDeclaredByIndex >= 0) {
    out.push('unoDeclare')
  }

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

  // The same refusal twice is two refusals: the toast is already up, so the
  // buzz is the only feedback the second tap gets.
  if (next.errorMsg && next.errorAt !== prev.errorAt) out.push('error')

  // The cue has to reach a player who can act on it, and the round summary is
  // eight seconds of a board they cannot see. The next round is dealt behind
  // that card and the clock starts with it, so the turn can become ours while
  // the scores are still up: hold the cue, and play it when the card comes
  // down on a turn that is already ours.
  const summaryLifted = prev.showRoundSummary && !next.showRoundSummary
  const turnBecameMine = next.currentTurn !== prev.currentTurn && next.currentTurn === next.myIndex
  // The table opening is the one turn change that changes no number: the deal
  // put `currentTurn` on our seat while the room was still loading, and the
  // clock only starts at `match_ready`. Without this the seat that opens the
  // match — every solo game, one table in n otherwise — heard nothing.
  const tableOpened = prev.mapLoading !== null && next.mapLoading === null
  if (
    next.screen === 'game' &&
    !next.showRoundSummary &&
    (turnBecameMine || ((summaryLifted || tableOpened) && next.currentTurn === next.myIndex))
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

  // An opponent's seat went quiet mid-match: the forfeit clock started on
  // them, or a seat is gone for good. Both draw a line on the board, and both
  // used to draw it silently — the one moment a player who looked away most
  // needs to look back. Their return is the arrival sound: somebody sat down.
  if (next.screen === 'game') {
    const awayStarted =
      next.opponentAway !== null && next.opponentAway.deadline !== prev.opponentAway?.deadline
    const seatGone = next.departureNotice !== null && next.departureNotice.at !== prev.departureNotice?.at
    if (awayStarted || seatGone) out.push('playerAway')
    if (prev.opponentAway !== null && next.opponentAway === null && prev.screen === 'game') {
      out.push('playerJoin')
    }
  }

  // The queue paid off. This is the one moment in the game the player is most
  // likely to be missing — a search runs for minutes and people go and do
  // something else — so it is also the one that most needs a sound.
  if (next.screen === 'matchfound' && prev.screen !== 'matchfound') out.push('matchFound')

  // One voice per name per transition. Two branches above can both owe the
  // penalty (a missed Contre-LOCO! in the same message as a stack being eaten),
  // and two copies of one cue started on the same sample are one cue at twice
  // the level, on a bus with no limiter.
  return out.filter((name, i) => out.indexOf(name) === i)
}

/**
 * How many cards a fresh hand should be dealt in with the flourish, or 0 when
 * this transition is not a deal.
 *
 * A deal is a hand appearing from nothing: the first round, and every round
 * after it — the next round's `game_started` lands under the round summary and
 * used to arrive as a single opponent's draw, because only the screen change
 * was counted. Decided here, beside the sounds, so the draw swish the same
 * transition would otherwise owe is dropped: the cards are the flourish.
 */
export function dealFor(prev: State, next: State): number {
  if (next.screen !== 'game' || next.myHand.length === 0) return 0
  const enteredGame = prev.screen !== 'game'
  const newRound = next.roundNumber !== prev.roundNumber && prev.myHand.length <= 1
  return enteredGame || newRound ? next.myHand.length : 0
}

