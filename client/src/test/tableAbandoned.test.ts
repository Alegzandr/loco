/**
 * The board's one exit, and the state it exists for.
 *
 * An ordinary match refuses `leave_room` on purpose: walking out is not a move,
 * and the 60s hold is there so a dropped socket is not a departure. That left
 * one state with no in-game action at all — every other seat's hold expired, so
 * the clock draws and passes for empty chairs for the rest of the round while
 * the only way out of the game is closing the browser.
 *
 * Held and gone read identically in the roster (`connected: false`), so what
 * decides this is `goneSeats`, which only the mid-match expiry writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import GameView from '../components/GameView.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'

const seated = {
  screen: 'game' as const,
  myIndex: 0,
  myHand: [{ color: 'red' as const, kind: 'number' as const, value: 5 }],
  players: [
    { index: 0, nickname: 'Alice', hand_size: 1, connected: true },
    { index: 1, nickname: 'Bob', hand_size: 3, connected: false },
  ],
  discard: { color: 'blue' as const, kind: 'number' as const, value: 7 },
  activeColor: 'blue' as const,
  currentTurn: 0,
  pendingDraw: 0,
  isReconnecting: false,
  goneSeats: [] as number[],
}

beforeEach(() => {
  gameStore.setState({ ...seated, goneSeats: [] })
})

describe('an abandoned table', () => {
  // The difference the whole thing turns on: a seat inside its hold looks
  // exactly like a seat that is gone, and one of them is coming back.
  it('offers nothing while the other seat is merely disconnected', () => {
    render(GameView, { onSend: vi.fn(), wsStatus: 'open', onLeave: vi.fn() })
    expect(screen.queryByText(en.tableEmptyTitle)).not.toBeInTheDocument()
  })

  it('offers the way out once every other seat has gone for good', async () => {
    const onLeave = vi.fn()
    gameStore.setState({ ...seated, goneSeats: [1] })
    render(GameView, { onSend: vi.fn(), wsStatus: 'open', onLeave: onLeave })

    expect(screen.getByText(en.tableEmptyTitle)).toBeInTheDocument()
    await fireEvent.click(screen.getByText(en.leaveRoom))
    expect(onLeave).toHaveBeenCalled()
  })

  // Our own socket being down is the more urgent of the two, and it may be the
  // only reason we have not heard from anybody: one curtain at a time.
  it('waits behind the connection curtain', () => {
    gameStore.setState({ ...seated, goneSeats: [1] })
    render(GameView, { onSend: vi.fn(), wsStatus: 'closed', onLeave: vi.fn() })
    expect(screen.queryByText(en.tableEmptyTitle)).not.toBeInTheDocument()
    expect(screen.getByText(en.wsLostConnection)).toBeInTheDocument()
  })

  // A seat that left is not the seat that stayed. Three at the table, one gone,
  // and there is still a match on.
  it('is not offered while somebody is still playing', () => {
    gameStore.setState({
      ...seated,
      players: [
        ...seated.players,
        { index: 2, nickname: 'Carol', hand_size: 4, connected: true },
      ],
      goneSeats: [1],
    })
    render(GameView, { onSend: vi.fn(), wsStatus: 'open', onLeave: vi.fn() })
    expect(screen.queryByText(en.tableEmptyTitle)).not.toBeInTheDocument()
  })
})
