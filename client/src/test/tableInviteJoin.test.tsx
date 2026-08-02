import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useGameStore } from '../hooks/useGameStore'
import { initTableInvite, takeTableInvite } from '../hooks/tableInvite'
import { NICKNAME_KEY } from '../hooks/nicknameMemory'
import { en } from '../i18n/en'
import type { ClientMsg } from '../types/protocol'

// A link seats whoever already has a name in this browser, and asks the ones who
// do not. The code is never the missing half: it came in on the URL, so the join
// form opens with it filled and the caret on the one thing still to type.

const sent: ClientMsg[] = []
const stableSend = (msg: ClientMsg) => {
  sent.push(msg)
}
const stableForceClose = () => {}
vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => ({ send: stableSend, wsStatus: 'open', forceClose: stableForceClose }),
}))
vi.mock('../audio/useGameAudio', () => ({ useGameAudio: () => {} }))

const { default: App } = await import('../App')

function arriveOn(code: string) {
  window.history.replaceState(null, '', `/?t=${code}`)
  initTableInvite()
}

beforeEach(() => {
  sent.length = 0
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
  takeTableInvite()
  useGameStore.setState({
    screen: 'lobby',
    roomCode: '',
    myNickname: '',
    players: [],
    errorMsg: '',
    isMatchmade: false,
  })
})

describe('arriving on a table link', () => {
  it('seats a player this browser already has a name for', () => {
    localStorage.setItem(NICKNAME_KEY, 'Alice')
    arriveOn('abc234')

    render(<App />)

    expect(sent).toEqual([{ type: 'join_room', nickname: 'Alice', room_code: 'ABC234' }])
  })

  it('asks for the name first when there is none, with the code already in', () => {
    arriveOn('abc234')

    const { getByPlaceholderText } = render(<App />)

    expect(sent).toHaveLength(0)
    const code = getByPlaceholderText(en.roomCodeLabel) as HTMLInputElement
    expect(code.value).toBe('ABC234')

    const nickname = getByPlaceholderText(en.yourNickname) as HTMLInputElement
    fireEvent.change(nickname, { target: { value: 'Bob' } })
    fireEvent.submit(nickname.closest('form')!)

    expect(sent).toEqual([{ type: 'join_room', nickname: 'Bob', room_code: 'ABC234' }])
  })

  it('asks too when the remembered name is one the server would refuse', () => {
    localStorage.setItem(NICKNAME_KEY, '---')
    arriveOn('abc234')

    const { getByPlaceholderText } = render(<App />)

    expect(sent).toHaveLength(0)
    expect((getByPlaceholderText(en.roomCodeLabel) as HTMLInputElement).value).toBe('ABC234')
  })

  it('does not seat anybody a second time once the table is left', () => {
    localStorage.setItem(NICKNAME_KEY, 'Alice')
    arriveOn('abc234')

    render(<App />)
    expect(sent).toHaveLength(1)

    // Joined, then left: the lobby comes back and must stay a lobby.
    useGameStore.getState().resetToHome()
    expect(sent).toHaveLength(1)
  })
})
