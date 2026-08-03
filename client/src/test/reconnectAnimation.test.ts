import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from './render'
import { act } from './renderHook'
import Probe from './ReconnectProbe.svelte'

/**
 * The overlay this hook drives is the last thing between a reloaded tab and its
 * board, and it is the one piece of the reconnect path that has no server
 * message ending it: it ends on a 600ms timer or it never ends at all.
 *
 * A reload mounts the board with `isReconnecting` already true, so the effect
 * runs for the first time on mount — the case a "has it changed?" guard gets
 * wrong. One such guard, held outside the effect, once survived a remount that
 * the timer did not: the first pass set the guard and armed the timer, the
 * cleanup cleared the timer, and the second pass returned early on the guard
 * without ever arming another. The overlay then sat over the table for the rest
 * of the match, saying "setting the table back up" over a table that was
 * already up, and `isReconnecting` was never cleared so the board never faded
 * back in. Both cases below are that one: arriving already true, and going
 * false before the timer.
 */
describe('reconnectAnimation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('clears the overlay when it mounts already reconnecting', () => {
    const onDone = vi.fn()
    render(Probe, { reconnecting: true, onDone })

    expect(screen.getByTestId('state').textContent).toBe('overlay')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByTestId('state').textContent).toBe('board')
    expect(onDone).toHaveBeenCalled()
  })

  it('takes the overlay down if the reconnect resolves before the timer', () => {
    const onDone = vi.fn()
    const { rerender } = render(Probe, { reconnecting: true, onDone })
    expect(screen.getByTestId('state').textContent).toBe('overlay')

    rerender({ reconnecting: false })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByTestId('state').textContent).toBe('board')
  })
})
