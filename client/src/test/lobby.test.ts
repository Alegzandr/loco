import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import Lobby from '../components/Lobby.svelte'
import { en } from '../i18n/en'
import { NICKNAME_KEY } from '../hooks/nicknameMemory'

function renderLobby(
  onSend = vi.fn(),
  error = '',
  onClearError = vi.fn(),
  onFindMatch = vi.fn(),
) {
  return render(Lobby, { onSend: onSend, onFindMatch: onFindMatch, error: error, onClearError: onClearError })
}

describe('Lobby', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders title and action buttons', () => {
    renderLobby()
    expect(screen.getByText('LOCO')).toBeInTheDocument()
    expect(screen.getByText(en.createRoom)).toBeInTheDocument()
    expect(screen.getByText(en.joinRoom)).toBeInTheDocument()
  })

  it('shows create form on create button click', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.createRoom))
    expect(screen.getByPlaceholderText(en.yourNickname)).toBeInTheDocument()
  })

  it('shows join form on join button click', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    expect(screen.getByPlaceholderText(en.yourNickname)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(en.roomCodeLabel)).toBeInTheDocument()
  })

  it('empty nickname does not call onSend', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.createRoom))
    fireEvent.submit(screen.getByRole('button', { name: en.createGame }).closest('form')!)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('whitespace-only nickname does not call onSend', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('answers a nickname the client can already refuse, as it is typed', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    // A zero-width space between two ordinary letters: nothing to see, and a
    // seat label that is not the name anybody else can type.
    fireEvent.change(input, { target: { value: 'Ali​ce' } })
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.nicknameRejected)
    fireEvent.submit(input.closest('form')!)
    expect(onSend).not.toHaveBeenCalled()

    // And it clears the moment the field becomes acceptable again.
    fireEvent.change(input, { target: { value: 'Alice' } })
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.submit(input.closest('form')!)
    expect(onSend).toHaveBeenCalledWith({ type: 'create_room', nickname: 'Alice' })
  })

  it('says the same thing for every reason a nickname is refused', () => {
    // The client checks the shape and the server owns the word list, but a
    // player must not be able to tell the two apart: one line, both times.
    // See server/game/nickname.go.
    renderLobby(vi.fn(), 'nickname not allowed')
    fireEvent.click(screen.getByText(en.createRoom))
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.nicknameRejected)
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: 'Alice\u{1f525}' } })
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.nicknameRejected)
  })

  it('sends the canonical nickname, not what sat in the field', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.joinRoom))
    fireEvent.change(screen.getByPlaceholderText(en.yourNickname), {
      target: { value: '  Jean   Luc  ' },
    })
    fireEvent.change(screen.getByPlaceholderText(en.roomCodeLabel), {
      target: { value: 'abcdef' },
    })
    fireEvent.submit(screen.getByPlaceholderText(en.yourNickname).closest('form')!)
    expect(onSend).toHaveBeenCalledWith({
      type: 'join_room',
      nickname: 'Jean Luc',
      room_code: 'ABCDEF',
    })
  })

  it('nickname input has maxLength 20', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    expect(input).toHaveAttribute('maxLength', '20')
  })

  it('room code input normalizes to uppercase', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    const codeInput = screen.getByPlaceholderText(en.roomCodeLabel)
    fireEvent.change(codeInput, { target: { value: 'abc23d' } })
    expect((codeInput as HTMLInputElement).value).toBe('ABC23D')
  })

  it('keeps only what the server draws a code from', () => {
    // I, O, 0 and 1 are outside the alphabet on purpose: a code is read out
    // loud off a stream. See server/hub/hub.go.
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    const codeInput = screen.getByPlaceholderText(en.roomCodeLabel)
    fireEvent.change(codeInput, { target: { value: ' ab-c 1o0i 23d! ' } })
    expect((codeInput as HTMLInputElement).value).toBe('ABC23D')
  })

  it('grays out take a seat until the table code is a whole one', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    const button = screen.getByRole('button', { name: en.joinGame })
    expect(button).toBeDisabled()

    const codeInput = screen.getByPlaceholderText(en.roomCodeLabel)
    fireEvent.change(codeInput, { target: { value: 'ABC2' } })
    expect(button).toBeDisabled()

    fireEvent.change(codeInput, { target: { value: 'ABC23D' } })
    expect(button).toBeEnabled()

    // And back: a player clearing the field is not left with a live button.
    fireEvent.change(codeInput, { target: { value: 'ABC23' } })
    expect(button).toBeDisabled()
  })

  it('an incomplete table code does not call onSend', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.joinRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: 'Alice' } })
    fireEvent.change(screen.getByPlaceholderText(en.roomCodeLabel), { target: { value: 'ABC' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('announces a server error in the player’s own words, never the raw string', () => {
    renderLobby(vi.fn(), 'room not found')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(en.errors.roomNotFound)
    expect(screen.queryByText('room not found')).not.toBeInTheDocument()
  })

  it('falls back to the generic message for an unrecognised server error', () => {
    renderLobby(vi.fn(), 'some future server message')
    expect(screen.getByRole('alert')).toHaveTextContent(en.errors.generic)
  })

  it('clears the error as soon as the player edits the nickname', () => {
    const onClearError = vi.fn()
    renderLobby(vi.fn(), 'nickname "Bob" already taken', onClearError)
    fireEvent.click(screen.getByText(en.createRoom))
    fireEvent.change(screen.getByPlaceholderText(en.yourNickname), { target: { value: 'B' } })
    expect(onClearError).toHaveBeenCalled()
  })

  it('valid create room sends message', () => {
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: 'Alice' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend).toHaveBeenCalledWith({ type: 'create_room', nickname: 'Alice' })
  })

  it('starts with an empty nickname on a first visit', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.createRoom))
    expect((screen.getByPlaceholderText(en.yourNickname) as HTMLInputElement).value).toBe('')
  })

  it('prefills the nickname used on the previous visit', () => {
    localStorage.setItem(NICKNAME_KEY, 'Alice')
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    expect((screen.getByPlaceholderText(en.yourNickname) as HTMLInputElement).value).toBe('Alice')
  })

  it('remembers the nickname a created room was entered with', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: '  Alice  ' } })
    fireEvent.submit(input.closest('form')!)
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('Alice')
  })

  it('remembers the nickname a joined room was entered with', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    fireEvent.change(screen.getByPlaceholderText(en.yourNickname), { target: { value: 'Bob' } })
    fireEvent.change(screen.getByPlaceholderText(en.roomCodeLabel), { target: { value: 'abc23d' } })
    fireEvent.submit(screen.getByPlaceholderText(en.yourNickname).closest('form')!)
    expect(localStorage.getItem(NICKNAME_KEY)).toBe('Bob')
  })

  it('does not remember a name that was never submitted', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.createRoom))
    fireEvent.change(screen.getByPlaceholderText(en.yourNickname), { target: { value: 'Half' } })
    expect(localStorage.getItem(NICKNAME_KEY)).toBeNull()
  })

  it('prefilled or not, an emptied field still refuses to send', () => {
    localStorage.setItem(NICKNAME_KEY, 'Alice')
    const onSend = vi.fn()
    renderLobby(onSend)
    fireEvent.click(screen.getByText(en.createRoom))
    const input = screen.getByPlaceholderText(en.yourNickname)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.submit(input.closest('form')!)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('puts the caret on the room code when the nickname is already known', () => {
    localStorage.setItem(NICKNAME_KEY, 'Alice')
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    expect(screen.getByPlaceholderText(en.roomCodeLabel)).toHaveFocus()
  })

  it('puts the caret on the nickname on a first visit', () => {
    renderLobby()
    fireEvent.click(screen.getByText(en.joinRoom))
    expect(screen.getByPlaceholderText(en.yourNickname)).toHaveFocus()
  })
})
