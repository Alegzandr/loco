import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { Lobby } from '../components/Lobby'
import { en } from '../i18n/en'
import { NICKNAME_KEY } from '../hooks/nicknameMemory'

function renderLobby(
  onSend = vi.fn(),
  error = '',
  onClearError = vi.fn(),
  onFindMatch = vi.fn(),
) {
  return render(
    <I18nProvider>
      <Lobby
        onSend={onSend}
        onFindMatch={onFindMatch}
        error={error}
        onClearError={onClearError}
      />
    </I18nProvider>
  )
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
    fireEvent.change(codeInput, { target: { value: 'abc123' } })
    expect((codeInput as HTMLInputElement).value).toBe('ABC123')
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
    fireEvent.change(screen.getByPlaceholderText(en.roomCodeLabel), { target: { value: 'abc123' } })
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
