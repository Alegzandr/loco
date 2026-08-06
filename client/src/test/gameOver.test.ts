import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'svelte'
import { render, screen, fireEvent } from './render'
import GameOver from '../components/GameOver.svelte'
import { en } from '../i18n/en'

const scoreboard = [
  { player_index: 0, nickname: 'Alice', score: 42, rounds_won: 1 },
  { player_index: 1, nickname: 'Bob', score: 0, rounds_won: 0 },
]

// A roster past two seats: the count on the button is drawn from this, because
// the quorum stops at two whatever size the table is.
const tableOfFour = ['Alice', 'Bob', 'Carol', 'Dave'].map((nickname, index) => ({
  index,
  nickname,
  hand_size: 0,
  connected: true,
}))

type Overrides = Partial<ComponentProps<typeof GameOver>>

function renderGameOver(opts: Overrides = {}) {
  const onRematch = opts.onRematch ?? vi.fn()
  render(GameOver, { winner: "Alice", myNickname: "Bob", mySeat: 1, scoreboard: scoreboard, matchOver: true, onRematch: onRematch, onFindMatch: vi.fn(), onLeave: vi.fn(), ...opts })
  return onRematch
}

describe('GameOver rematch', () => {
  it('offers every seat the same ask, host or not', () => {
    const onRematch = renderGameOver()
    fireEvent.click(screen.getByText(en.rematch))
    expect(onRematch).toHaveBeenCalled()
  })

  it('says the ask is in and waits, rather than pretending it started anything', () => {
    renderGameOver({ rematchOffers: [1], rematchNeeded: 2 })
    const btn = screen.getByRole('button', { name: en.rematchWaitingOpponent })
    expect(btn).toBeDisabled()
  })

  it('shows the other side asking, so the answer is one press away', () => {
    renderGameOver({ rematchOffers: [0], rematchNeeded: 2 })
    expect(screen.getByRole('button', { name: en.rematchAccept })).toBeEnabled()
  })

  // Past two seats "waiting on them" names nobody, and how far off the next
  // match is only exists as a count. The count is against the quorum, which is
  // two at any size: four players, two asks, and the room reopens.
  it('counts the asks at a table bigger than a 1v1', () => {
    renderGameOver({ players: tableOfFour, rematchOffers: [0], rematchNeeded: 2 })
    expect(
      screen.getByRole('button', { name: `${en.rematchAccept} 1/2` })
    ).toBeInTheDocument()
  })

  // The wait is on the table rather than on one named opponent, and it says so
  // even though the quorum itself no longer says how many seats there are.
  it('reads the table size off the roster, not off the quorum', () => {
    renderGameOver({ players: tableOfFour, rematchOffers: [1], mySeat: 1, rematchNeeded: 2 })
    expect(
      screen.getByRole('button', { name: `${en.rematchWaitingTable} 1/2` })
    ).toBeInTheDocument()
    expect(screen.queryByText(en.rematchWaitingOpponent)).not.toBeInTheDocument()
  })

  it('keeps the count off a 1v1, where it would only be noise', () => {
    renderGameOver({ rematchOffers: [0], rematchNeeded: 2 })
    expect(screen.getByRole('button', { name: en.rematchAccept })).toBeInTheDocument()
  })

  // The button stays in place: the layout must not reflow around an answer that
  // may still arrive, and a table nobody is left at is still a table.
  it('greys the ask out once nobody is left to agree with', () => {
    renderGameOver({ hasTablemates: false })
    expect(screen.getByRole('button', { name: en.rematch })).toBeDisabled()
  })

  it('greys it out after a forfeit too', () => {
    renderGameOver({ isMatchmade: true, forfeitBy: 0, mySeat: 1 })
    expect(screen.getByRole('button', { name: en.rematch })).toBeDisabled()
  })

  // Only a matchmade table has a next opponent to offer; an ordinary one has a
  // room, a code and the people already in it.
  it('offers the queue only to a matchmade table', () => {
    const { unmount } = render(GameOver, { winner: "Alice", myNickname: "Bob", mySeat: 1, isMatchmade: true, onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() })
    expect(screen.getByText(en.searchAgain)).toBeInTheDocument()
    unmount()

    renderGameOver()
    expect(screen.queryByText(en.searchAgain)).not.toBeInTheDocument()
  })

  it('always offers a way out of the room', () => {
    renderGameOver()
    expect(screen.getByText(en.leaveRoom)).toBeInTheDocument()
  })

  it('still shows the final scoreboard', () => {
    renderGameOver()
    expect(screen.getByText(en.finalScores)).toBeInTheDocument()
    expect(screen.getByText('42 pts')).toBeInTheDocument()
  })
})
