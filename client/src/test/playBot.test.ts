import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import Lobby from '../components/Lobby.svelte'
import GameOver from '../components/GameOver.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import { NICKNAME_KEY } from '../hooks/nicknameMemory'

/**
 * A 1v1 against the server: the queue's experience with the wait taken out.
 *
 * What is under test is that it stays that shape — a name and one press, never a
 * table — and that the game-over screen offers another press rather than an ask
 * nobody is there to answer.
 */

function renderLobby(onPlayBot = vi.fn()) {
  render(Lobby, {
    onSend: vi.fn(),
    onFindMatch: vi.fn(),
    onPlayBot,
    error: '',
    onClearError: vi.fn(),
  })
  return onPlayBot
}

describe('the way in', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('sits under the 1v1 button, above the two table buttons', () => {
    renderLobby()
    const buttons = [...document.querySelectorAll('.buttonGroup button')].map(
      (b) => b.textContent?.trim() ?? '',
    )
    // The order is a product decision: the human queue leads, the bot line is
    // attached to it, and neither table button moves.
    expect(buttons[0]).toContain(en.findMatch)
    expect(buttons[1]).toContain(en.playBot)
    expect(buttons[2]).toContain(en.createRoom)
    expect(buttons[3]).toContain(en.joinRoom)
  })

  it('asks for a name and nothing else', () => {
    const onPlayBot = renderLobby()
    fireEvent.click(screen.getByText(en.playBot))

    // One field, one button. No table code, no format, no seat count: the whole
    // point of the mode is that there is nothing to decide.
    const field = screen.getByPlaceholderText(en.yourNickname)
    expect(field).toBeTruthy()
    expect(screen.queryByPlaceholderText(en.roomCodeLabel)).toBeNull()

    const go = screen.getByRole('button', { name: en.playBotGo })
    // Greying out may only ever answer shape, and an empty field has none.
    expect(go).toBeDisabled()

    fireEvent.input(field, { target: { value: 'Alice' } })
    expect(go).toBeEnabled()
    fireEvent.click(go)
    expect(onPlayBot).toHaveBeenCalledWith('Alice')
  })

  it('remembers the name like every other entry point', () => {
    localStorage.setItem(NICKNAME_KEY, 'Nova')
    const onPlayBot = renderLobby()
    fireEvent.click(screen.getByText(en.playBot))
    fireEvent.click(screen.getByRole('button', { name: en.playBotGo }))
    expect(onPlayBot).toHaveBeenCalledWith('Nova')
  })
})

describe('the store', () => {
  it('records the identity the deal carried, and marks the table solo', () => {
    gameStore.getState().resetToHome()
    gameStore.getState().applySoloStarted('KX7QP2', 0, 'tok-1')
    const s = gameStore.getState()
    expect(s.isSolo).toBe(true)
    expect(s.isMatchmade).toBe(false)
    expect(s.roomCode).toBe('KX7QP2')
    expect(s.myIndex).toBe(0)
    // The token is the whole reason the identity rides game_started: without it
    // a reload could not reclaim the seat.
    expect(s.sessionToken).toBe('tok-1')
  })

  it('forgets it on the way home', () => {
    gameStore.getState().applySoloStarted('KX7QP2', 0, 'tok-1')
    gameStore.getState().resetToHome()
    expect(gameStore.getState().isSolo).toBe(false)
  })
})

describe('the game-over screen', () => {
  const base = {
    winner: 'Alice',
    myNickname: 'Alice',
    mySeat: 0,
    matchOver: true,
    scoreboard: [
      { player_index: 0, nickname: 'Alice', score: 30, rounds_won: 1 },
      { player_index: 1, nickname: 'Bot1', score: 0, rounds_won: 0 },
    ],
    onRematch: vi.fn(),
    onFindMatch: vi.fn(),
    onLeave: vi.fn(),
  }

  it('offers another press and the queue, never a rematch', () => {
    const onPlayBot = vi.fn()
    const onFindMatch = vi.fn()
    render(GameOver, { ...base, isSolo: true, onPlayBot, onFindMatch })

    // A button reading "waiting on them" over a seat the server is playing would
    // be a lie the screen tells itself.
    expect(screen.queryByText(en.rematch)).toBeNull()
    expect(screen.queryByText(en.rematchWaitingOpponent)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: en.playBotAgain }))
    expect(onPlayBot).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: en.findMatch }))
    expect(onFindMatch).toHaveBeenCalled()
  })

  it('leaves the screen every other table gets exactly as it was', () => {
    render(GameOver, { ...base, isSolo: false })
    expect(screen.getByRole('button', { name: en.rematch })).toBeTruthy()
    expect(screen.queryByText(en.playBotAgain)).toBeNull()
  })
})
