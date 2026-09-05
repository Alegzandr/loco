import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../hooks/gameStore'

// An action that hands the state back unchanged is the store's own "nothing to
// do", and the catch middleware has to leave it one: it used to spread the
// state into a fresh object, so every no-op became a full-app invalidation.
describe('store no-ops stay no-ops through the catch middleware', () => {
  beforeEach(() => {
    gameStore.setState({ screen: 'game', catchWindows: [], players: [], goneSeats: [] })
  })

  it('does not notify when a prune finds nothing expired', () => {
    let notified = 0
    const unsub = gameStore.subscribe(() => notified++)
    gameStore.getState().pruneCatchWindows()
    gameStore.getState().noteSeatGone(-1)
    unsub()
    expect(notified).toBe(0)
  })

  it('still notifies for a real change', () => {
    let notified = 0
    const unsub = gameStore.subscribe(() => notified++)
    gameStore.getState().noteSeatGone(1, 'Kiwi')
    unsub()
    expect(notified).toBe(1)
  })
})
