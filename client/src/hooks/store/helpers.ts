import { CardDTO, GameStateDTO } from '../../types/protocol'
import { CatchWindow, SwapNotice } from './types'

// deriveCatch picks the catch the UI offers: the window closest to expiring
// among the opponents'. Ours never counts: you cannot catch yourself, and at
// one card the action bar is showing us the LOCO! button instead. A window we
// already called on is spent, exactly like our own LOCO! button.
export function deriveCatch(windows: CatchWindow[], myIndex: number) {
  let best: CatchWindow | null = null
  for (const w of windows) {
    if (w.seat === myIndex || w.attempted) continue
    if (!best || w.endsAt < best.endsAt) best = w
  }
  return { catchTarget: best ? best.seat : null, unoTimerEnd: best ? best.endsAt : null }
}

/**
 * Drop the copies of `card` the server just discarded from our hand.
 *
 * One `card_played` can stand for several discards: a batch play or a batch
 * interrupt slams *every* identical copy the player holds. Removing exactly one
 * left the rest as phantom cards — they rendered, they could be tapped, and the
 * server refused each tap with "card not in hand" until the round ended.
 *
 * `targetSize` is the server's own `hand_size` for our seat and it is the
 * authority: copies come off until the local hand matches it. With no authority
 * to compare against we fall back to a single copy, which is the ordinary play.
 * A server hand that is *larger* than ours removes nothing — that is a desync a
 * `game_state` has to settle, and guessing here would only widen it.
 *
 * Copies come off the end so the survivors keep their `handCardKeys` identity
 * and slide into the gap instead of remounting.
 */
export function removePlayedCards(
  hand: CardDTO[],
  card: CardDTO,
  targetSize?: number,
): CardDTO[] {
  const wanted =
    typeof targetSize === 'number' ? Math.max(0, hand.length - targetSize) : 1
  if (wanted === 0) return hand
  const next = [...hand]
  let removed = 0
  for (let i = next.length - 1; i >= 0 && removed < wanted; i--) {
    const c = next[i]
    if (c.color === card.color && c.kind === card.kind && c.value === card.value) {
      next.splice(i, 1)
      removed++
    }
  }
  return removed > 0 ? next : hand
}

// makeSwapNotice returns a fresh notice for a Swap or GlobalSwitch play, or null
// for any other card kind (caller keeps the previous notice in that case).
export function makeSwapNotice(
  card: CardDTO,
  actorIndex: number,
  chosenPlayer: number | null | undefined,
  direction: number,
): SwapNotice | null {
  if (card.kind === 'swap') {
    return {
      kind: 'swap',
      actorIndex,
      targetIndex: typeof chosenPlayer === 'number' ? chosenPlayer : -1,
      direction,
      at: Date.now(),
    }
  }
  if (card.kind === 'global_switch') {
    return {
      kind: 'global_switch',
      actorIndex,
      targetIndex: -1,
      direction,
      at: Date.now(),
    }
  }
  return null
}

/** The fields an authoritative snapshot settles, straight off the wire. */
export function gameStateSliceFromDTO(state: GameStateDTO) {
  return {
    myIndex: state.your_index,
    myHand: state.hand,
    players: state.players,
    discard: state.discard,
    activeColor: state.active_color,
    currentTurn: state.turn,
    direction: state.direction,
    pendingDraw: state.pending_draw ?? 0,
    hasDrawn: state.has_drawn ?? false,
    roundNumber: state.round_number ?? 1,
    mapId: state.map_id ?? '',
    matchFormat: state.match_format ?? 'BO1',
    maxPlayers: state.max_players ?? 10,
    scoreboard: state.scoreboard ?? [],
    roundHistory: state.round_history ?? [],
    matchHistory: state.match_history ?? [],
    turnDeadline: state.turn_deadline ?? null,
  }
}
