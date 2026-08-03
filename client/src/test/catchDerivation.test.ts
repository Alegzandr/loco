/**
 * `catchTarget` and `unoTimerEnd` are derived from `catchWindows`, and they are
 * completed by the store itself rather than by each action (see
 * `store/deriveCatchMiddleware.ts`). These tests fail if that ever goes back to
 * being every action's job: the failure mode of stored derived state is an
 * action that forgets, and a forgotten derivation costs a reaction silently.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../hooks/gameStore'

const now = () => Date.now()

describe('the offered catch is completed by the store', () => {
  beforeEach(() => {
    gameStore.setState({ myIndex: 0, catchWindows: [], players: [] })
  })

  it('is derived from a bare write to catchWindows', () => {
    const endsAt = now() + 5000
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt }] })
    const s = gameStore.getState()
    expect(s.catchTarget).toBe(2)
    expect(s.unoTimerEnd).toBe(endsAt)
  })

  it('offers the window closest to expiring, never our own seat', () => {
    gameStore.setState({
      myIndex: 1,
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 }, // ours: never offered
        { seat: 3, endsAt: now() + 4000 },
        { seat: 2, endsAt: now() + 2000 },
      ],
    })
    expect(gameStore.getState().catchTarget).toBe(2)
  })

  it('follows our seat moving under a snapshot that re-seats us', () => {
    gameStore.setState({
      myIndex: 0,
      catchWindows: [
        { seat: 0, endsAt: now() + 1000 },
        { seat: 1, endsAt: now() + 2000 },
      ],
    })
    expect(gameStore.getState().catchTarget).toBe(1)
    // Pruning absent players re-bases seats: the window we could not take is
    // now somebody else's, and the one we owed is ours.
    gameStore.setState({ myIndex: 1 })
    expect(gameStore.getState().catchTarget).toBe(0)
  })

  it('closes when the last window is retired by an action that says nothing about it', () => {
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    expect(gameStore.getState().catchTarget).toBe(2)
    gameStore.getState().applyUnoCaught(2)
    const s = gameStore.getState()
    expect(s.catchWindows).toEqual([])
    expect(s.catchTarget).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
  })

  it('spends a window we have already called on', () => {
    gameStore.setState({
      catchWindows: [
        { seat: 1, endsAt: now() + 1000 },
        { seat: 2, endsAt: now() + 3000 },
      ],
    })
    gameStore.getState().noteCatchAttempt(1)
    expect(gameStore.getState().catchTarget).toBe(2)
  })

  it('leaves a write that names neither field alone', () => {
    gameStore.setState({ catchWindows: [{ seat: 2, endsAt: now() + 5000 }] })
    const before = gameStore.getState().unoTimerEnd
    gameStore.setState({ errorMsg: 'nope' })
    expect(gameStore.getState().unoTimerEnd).toBe(before)
    expect(gameStore.getState().catchTarget).toBe(2)
  })
})
