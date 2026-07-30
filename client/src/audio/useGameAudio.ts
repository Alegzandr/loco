/**
 * Bridges game state to sound.
 *
 * The whole audio layer is driven from one store subscription that diffs the
 * previous and next snapshots, rather than from callbacks scattered through the
 * components. Two reasons: every sound stays in one readable list, and a sound
 * can never fire twice because two components both reacted to the same event.
 *
 * The subscription runs outside React's render cycle, so playing a sound never
 * costs a re-render.
 */
import { useEffect } from 'react'
import { useGameStore } from '../hooks/useGameStore'
import type { CardDTO } from '../types/protocol'
import { audio } from './engine'
import { playSfx, playDeal, SfxName } from './sfx'
import { music } from './music'

type State = ReturnType<typeof useGameStore.getState>

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
 * How tense the table is, 0..1. Drives tempo and layer density in the music bed.
 * Deliberately coarse: the point is that the room *feels* different when someone
 * is about to go out, not that the value is precise.
 */
function intensityOf(s: State): number {
  if (s.screen !== 'game') return 0.2
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

function sceneFor(s: State): 'lobby' | 'game' | 'off' {
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

  // pendingDraw only climbs while a counter chain is live; the drop back to 0
  // is the stack being eaten, which is the penalty, not another stack.
  if (next.pendingDraw > prev.pendingDraw && !out.includes('drawStack')) out.push('drawStack')
  if (prev.pendingDraw > 0 && next.pendingDraw === 0 && next.screen === 'game') out.push('penalty')

  if (next.errorMsg && next.errorMsg !== prev.errorMsg) out.push('error')

  if (next.currentTurn !== prev.currentTurn && next.currentTurn === next.myIndex && next.screen === 'game') {
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

  return out
}

export function useGameAudio(): void {
  useEffect(() => {
    // Browsers only allow an AudioContext to start inside a user gesture. Every
    // gesture retries, because the first one can land before the page is ready.
    const unlock = () => {
      audio.unlock()
      const s = useGameStore.getState()
      const scene = sceneFor(s)
      music.setIntensity(intensityOf(s))
      if (scene !== 'off' && !music.isPlaying()) music.start(scene)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    let prev = useGameStore.getState()

    const unsub = useGameStore.subscribe((next) => {
      const before = prev
      prev = next

      for (const name of soundsForTransition(before, next)) playSfx(name)

      // A fresh hand is a flourish of its own rather than one draw sound.
      if (next.screen === 'game' && before.screen !== 'game' && next.myHand.length > 0) {
        playDeal(next.myHand.length)
      }

      music.setIntensity(intensityOf(next))
      const scene = sceneFor(next)
      // start() is idempotent: it swaps the scene in place when the bed is
      // already running, so moving lobby→game changes the pacing without
      // cutting the pad mid-bar.
      if (scene === 'off') music.stop()
      else music.start(scene)
    })

    return () => {
      unsub()
      music.stop()
    }
  }, [])
}
