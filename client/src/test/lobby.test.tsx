import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { I18nProvider } from '../i18n'
import { Lobby } from '../components/Lobby'
import { en } from '../i18n/en'

function renderLobby(onSend = vi.fn(), error = '', onClearError = vi.fn()) {
  return render(
    <I18nProvider>
      <Lobby onSend={onSend} error={error} onClearError={onClearError} />
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

  it('displays error message when provided', () => {
    renderLobby(vi.fn(), 'room not found')
    expect(screen.getByText('room not found')).toBeInTheDocument()
  })

  it('calls onClearError when error is clicked', () => {
    const onClearError = vi.fn()
    renderLobby(vi.fn(), 'some error', onClearError)
    fireEvent.click(screen.getByText('some error'))
    expect(onClearError).toHaveBeenCalledOnce()
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
})
