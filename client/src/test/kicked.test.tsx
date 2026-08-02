import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act, screen } from '@testing-library/react'
import { useGameStore } from '../hooks/useGameStore'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import { serverMsgTypeSchema } from '../types/protocolSchemas'
import { resolveServerError } from '../i18n/serverErrors'
import type { ClientMsg, ServerMsg } from '../types/protocol'

/**
 * Being removed from a table is the one screen change a player did not ask for,
 * so it is the one that most needs a reason attached. The seat is gone
 * server-side either way; what this pins is that the client lets nothing local
 * survive it, and that the player lands on the lobby knowing why.
 */

const sent: ClientMsg[] = []
const stableSend = (msg: ClientMsg) => {
  sent.push(msg)
}
const stableForceClose = () => {}
let capturedOnMessage: ((msg: ServerMsg) => void) | undefined

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: (onMessage: (msg: ServerMsg) => void) => {
    capturedOnMessage = onMessage
    return { send: stableSend, wsStatus: 'open', forceClose: stableForceClose }
  },
}))
vi.mock('../audio/useGameAudio', () => ({ useGameAudio: () => {} }))

const { default: App } = await import('../App')

beforeEach(() => {
  sent.length = 0
  capturedOnMessage = undefined
  window.sessionStorage.clear()
  useGameStore.setState({
    screen: 'waiting',
    roomCode: 'ABC123',
    myIndex: 1,
    myNickname: 'Bob',
    sessionToken: 'tok',
    errorMsg: '',
    players: [
      { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
      { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
    ],
  })
})

describe('being removed from a table', () => {
  it('is a message type the client accepts', () => {
    // useWebSocket drops anything the schema does not name, so a `kicked` that
    // is not in here leaves the player sitting at a table they no longer have.
    expect(serverMsgTypeSchema.safeParse('kicked').success).toBe(true)
  })

  it('puts the player back on the lobby with the reason', () => {
    render(
      <I18nProvider>
        <App />
      </I18nProvider>,
    )
    act(() => capturedOnMessage?.({ type: 'kicked' }))

    const state = useGameStore.getState()
    expect(state.screen).toBe('lobby')
    expect(state.roomCode).toBe('')
    expect(state.sessionToken).toBe('')
    // resetToHome clears errorMsg, so the reason has to outlive it.
    expect(resolveServerError(state.errorMsg, en.errors)).toBe(en.errors.kicked)
    expect(screen.getByText(en.errors.kicked)).toBeInTheDocument()
  })
})
