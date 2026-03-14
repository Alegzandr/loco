import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../hooks/useGameStore'
import { CardDTO, GameStateDTO } from '../types/protocol'

// Reset store state between tests
beforeEach(() => {
  useGameStore.setState({
    screen: 'lobby',
    roomCode: '',
    myIndex: -1,
    myHand: [],
    players: [],
    discard: null,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    winner: '',
    errorMsg: '',
    unoDeclared: false,
  })
})

describe('useGameStore', () => {
  it('starts at lobby screen', () => {
    const state = useGameStore.getState()
    expect(state.screen).toBe('lobby')
  })

  it('setRoomCode updates roomCode', () => {
    useGameStore.getState().setRoomCode('ABCD')
    expect(useGameStore.getState().roomCode).toBe('ABCD')
  })

  it('applyGameState populates hand and players', () => {
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [
        { color: 'red', kind: 'number', value: 5 },
        { color: 'blue', kind: 'skip' },
      ],
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 3 },
      active_color: 'red',
      turn: 0,
      direction: 1,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.myHand).toHaveLength(2)
    expect(s.players).toHaveLength(2)
    expect(s.activeColor).toBe('red')
    expect(s.currentTurn).toBe(0)
  })

  it('applyCardPlayed advances turn and updates discard', () => {
    useGameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
      currentTurn: 0,
      discard: { color: 'red', kind: 'number', value: 3 },
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 7 }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0)

    const s = useGameStore.getState()
    expect(s.discard).toEqual(card)
    expect(s.currentTurn).toBe(1)
    expect(s.players[0].hand_size).toBe(4)
  })

  it('applyCardDrawn adds card to own hand', () => {
    useGameStore.setState({ myHand: [{ color: 'blue', kind: 'number', value: 2 }] })
    const drawn: CardDTO = { color: 'green', kind: 'skip' }
    useGameStore.getState().applyCardDrawn(drawn, 0, 0)

    expect(useGameStore.getState().myHand).toHaveLength(2)
  })

  it('applyCardDrawn updates opponent hand size', () => {
    useGameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // null card means another player drew
    useGameStore.getState().applyCardDrawn(null, 1, 1)
    expect(useGameStore.getState().players[1].hand_size).toBe(6)
  })

  it('setWinner sets screen to gameover', () => {
    useGameStore.getState().setWinner('alice')
    const s = useGameStore.getState()
    expect(s.winner).toBe('alice')
    expect(s.screen).toBe('gameover')
  })

  it('setError and clearError work', () => {
    useGameStore.getState().setError('oops')
    expect(useGameStore.getState().errorMsg).toBe('oops')
    useGameStore.getState().clearError()
    expect(useGameStore.getState().errorMsg).toBe('')
  })
})
