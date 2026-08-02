import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, act } from '@testing-library/react'
import { useReconnectAnimation } from '../hooks/useReconnectAnimation'

/**
 * The overlay this hook drives is the last thing between a reloaded tab and its
 * board, and it is the one piece of the reconnect path that has no server
 * message ending it: it ends on a 600ms timer or it never ends at all.
 *
 * A reload mounts <GameView /> with `isReconnecting` already true, so the effect
 * runs for the first time on mount, which is exactly where StrictMode
 * double-invokes it in dev. A guard held in a ref survives that remount while
 * the timer does not: the first pass set the ref and armed the timer, the
 * cleanup cleared the timer, and the second pass returned early on the ref
 * without ever arming another. The overlay then sat over the table for the rest
 * of the match, saying "setting the table back up" over a table that was
 * already up, and `isReconnecting` was never cleared so the board never faded
 * back in.
 */
function Probe({ reconnecting, onDone }: { reconnecting: boolean; onDone: () => void }) {
  const show = useReconnectAnimation(reconnecting, onDone)
  return <div data-testid="state">{show ? 'overlay' : 'board'}</div>
}

describe('useReconnectAnimation', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('clears the overlay when it mounts already reconnecting, under StrictMode', () => {
    const onDone = vi.fn()
    render(
      <StrictMode>
        <Probe reconnecting onDone={onDone} />
      </StrictMode>,
    )

    expect(screen.getByTestId('state').textContent).toBe('overlay')

    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByTestId('state').textContent).toBe('board')
    expect(onDone).toHaveBeenCalled()
  })

  it('takes the overlay down if the reconnect resolves before the timer', () => {
    const onDone = vi.fn()
    const { rerender } = render(
      <StrictMode>
        <Probe reconnecting onDone={onDone} />
      </StrictMode>,
    )
    expect(screen.getByTestId('state').textContent).toBe('overlay')

    rerender(
      <StrictMode>
        <Probe reconnecting={false} onDone={onDone} />
      </StrictMode>,
    )
    act(() => {
      vi.advanceTimersByTime(1_000)
    })

    expect(screen.getByTestId('state').textContent).toBe('board')
  })
})
