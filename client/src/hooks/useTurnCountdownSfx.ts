import { useEffect } from 'react'
import { playSfx } from '../audio/sfx'

/** Seconds of remaining turn time at which the countdown ticks start. */
const TURN_COUNTDOWN_FROM = 5

/**
 * Ticks over the last few seconds of our own turn.
 *
 * Time pressure is the one piece of state a spectator cannot read off the
 * board, and the bar at the top of the screen is not where anyone is looking.
 */
export function useTurnCountdownSfx(turnDeadline: number | null, isMyTurn: boolean) {
  useEffect(() => {
    if (turnDeadline === null || !isMyTurn) return
    let lastTick = -1
    const id = setInterval(() => {
      const left = Math.ceil((turnDeadline - Date.now()) / 1000)
      if (left <= 0 || left > TURN_COUNTDOWN_FROM || left === lastTick) return
      lastTick = left
      playSfx('countdown')
    }, 200)
    return () => clearInterval(id)
  }, [turnDeadline, isMyTurn])
}
