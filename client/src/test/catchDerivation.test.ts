/**
 * `catchTarget` and `unoTimerEnd` are derived from `catchWindows`, and they are
 * completed by the store itself rather than by each action (see
 * `store/deriveCatchMiddleware.ts`). These tests fail if that ever goes back to
 * being every action's job: the failure mode of stored derived state is an
 * action that forgets, and a forgotten derivation costs a reaction silently.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../hooks/useGameStore'

const now = () => Date.now()

describe('the offered catch is completed by the store', () => {
  beforeEach(() => {
    useGameStore.setState({ myIndex: 0, catchWindows: [], players: [] })
  })

  it('is derived from a bare write to catchWindows', () => {
    const endsAt = now() + 5000
    useGameStore.setState({ catchWindows: [{ seat: 2, endsAt }] })
    const s = useGameStore.getState()
    expect(s.catchTarget).toBe(2)
    expect(s.unoTimerEnd).toBe(endsAt)
  })

  it('offers the window closest to expiring, never our own seat', () => {
    useGameStore.setState({
      myIndex: 1,
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 }, // ours: never offered
        { seat: 3, endsAt: now() + 4000 },
        { seat: 2, endsAt: now() + 2000 },
      ],
    })
    expect(useGameStore.getState().catchTarget).toBe(2)
  })

  it('follows our seat moving under a snapshot that re-seats us', () => {
    useGameStore.setState({
      myIndex: 0,
      catchWindows: [
        { seat: 0, endsAt: now() + 1000 },
        { seat: 1, endsAt: now() + 2000 },
      ],
    })
    expect(useGameStore.getState().catchTarget).toBe(1)
    // Pruning absent players re-bases seats: the window we could not take is
    // now somebody else's, and the one we owed is ours.
    useGameStore.setState({ myIndex: 1 })
    expect(useGameStore.getState().catchTarget).toBe(0)
  })

  it('closes when the last window is retired by an action that says nothing about it', () => {
    useGameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    expect(useGameStore.getState().catchTarget).toBe(2)
    useGameStore.getState().applyUnoCaught(2)
    const s = useGameStore.getState()
    expect(s.catchWindows).toEqual([])
    expect(s.catchTarget).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
  })

  it('spends a window we have already called on', () => {
    useGameStore.setState({
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 },
        { seat: 2, endsAt: now() + 3000 },
      ],
    })
    useGameStore.getState().noteCatchAttempt(1)
    expect(useGameStore.getState().catchTarget).toBe(2)
  })

  it('leaves a write that names neither field alone', () => {
    useGameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    const before = useGameStore.getState().unoTimerEnd
    useGameStore.setState({ errorMsg: 'nope' })
    expect(useGameStore.getState().unoTimerEnd).toBe(before)
    expect(useGameStore.getState().catchTarget).toBe(2)
  })
})
