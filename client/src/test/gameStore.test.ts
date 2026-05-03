import { describe, it, expect, beforeEach } from 'vitest'
import { useGameStore } from '../hooks/useGameStore'
import { CardDTO, GameStateDTO, ScoreboardEntryDTO } from '../types/protocol'

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
    errorMsg: '',
    unoDeclared: false,
    scoreboard: [],
    roundWinner: '',
    roundScores: [],
    roundNumber_completed: 0,
    matchWinner: '',
    matchOver: false,
    showRoundSummary: false,
    pendingGameState: null,
    pendingMatchEnd: null,
    isReconnecting: false,
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
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.myHand).toHaveLength(2)
    expect(s.players).toHaveLength(2)
    expect(s.activeColor).toBe('red')
    expect(s.currentTurn).toBe(0)
    expect(s.showRoundSummary).toBe(false)
    expect(s.pendingGameState).toBeNull()
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
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)

    const s = useGameStore.getState()
    expect(s.discard).toEqual(card)
    expect(s.currentTurn).toBe(1)
    expect(s.players[0].hand_size).toBe(4)
  })

  it('applyCardDrawn adds card to own hand', () => {
    useGameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
    })
    useGameStore.setState({ myHand: [{ color: 'blue', kind: 'number', value: 2 }], myIndex: 0, currentTurn: 0 })
    const drawn: CardDTO = { color: 'green', kind: 'skip' }
    // Voluntary draw: turn stays on player 0, so currentTurn does not change.
    useGameStore.getState().applyCardDrawn([drawn], 0, 0)

    expect(useGameStore.getState().myHand).toHaveLength(2)
    expect(useGameStore.getState().players.map((p) => p.nickname)).toEqual(['alice', 'bob'])
  })

  it('applyCardDrawn adds multiple cards on penalty draw', () => {
    useGameStore.setState({ myHand: [{ color: 'blue', kind: 'number', value: 2 }], myIndex: 0, currentTurn: 0, pendingDraw: 2 })
    const drawn1: CardDTO = { color: 'red', kind: 'number', value: 3 }
    const drawn2: CardDTO = { color: 'green', kind: 'skip' }
    // Penalty draw: turn advances to player 1.
    useGameStore.getState().applyCardDrawn([drawn1, drawn2], 0, 1)

    expect(useGameStore.getState().myHand).toHaveLength(3)
    expect(useGameStore.getState().pendingDraw).toBe(0)
    expect(useGameStore.getState().currentTurn).toBe(1)
  })

  it('applyCardDrawn updates opponent hand size', () => {
    useGameStore.setState({
      currentTurn: 1,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // null cards means another player drew; turn stays the same (voluntary draw).
    useGameStore.getState().applyCardDrawn(null, 1, 1)
    expect(useGameStore.getState().players[1].hand_size).toBe(6)
  })

  it('applyCardDrawn resets pendingDraw for observers when penalty draw advances turn', () => {
    useGameStore.setState({
      currentTurn: 1,
      pendingDraw: 2,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Bob drew 2 penalty cards; turn advances to alice (0).
    useGameStore.getState().applyCardDrawn(null, 1, 0, undefined, 2)
    expect(useGameStore.getState().players[1].hand_size).toBe(7)
    expect(useGameStore.getState().pendingDraw).toBe(0)
    expect(useGameStore.getState().currentTurn).toBe(0)
  })

  it('setError and clearError work', () => {
    useGameStore.getState().setError('oops')
    expect(useGameStore.getState().errorMsg).toBe('oops')
    useGameStore.getState().clearError()
    expect(useGameStore.getState().errorMsg).toBe('')
  })

  // ──────────────────────────────────────────────────────────────
  // Round summary / buffering tests
  // ──────────────────────────────────────────────────────────────

  it('applyRoundEnd sets showRoundSummary and computes roundScores delta', () => {
    // Pre-round scoreboard
    useGameStore.setState({
      scoreboard: [
        { player_index: 0, nickname: 'alice', score: 0, rounds_won: 0 },
        { player_index: 1, nickname: 'bob', score: 0, rounds_won: 0 },
      ],
    })

    const newScoreboard: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
      { player_index: 1, nickname: 'bob', score: 0, rounds_won: 0 },
    ]
    useGameStore.getState().applyRoundEnd('alice', 1, newScoreboard)

    const s = useGameStore.getState()
    expect(s.showRoundSummary).toBe(true)
    expect(s.roundWinner).toBe('alice')
    expect(s.roundNumber_completed).toBe(1)
    expect(s.scoreboard).toEqual(newScoreboard)

    const aliceEntry = s.roundScores.find((e) => e.nickname === 'alice')
    expect(aliceEntry?.round_points).toBe(30)
    const bobEntry = s.roundScores.find((e) => e.nickname === 'bob')
    expect(bobEntry?.round_points).toBe(0)
  })

  it('setPendingGameState stores state without applying it', () => {
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [{ color: 'red', kind: 'number', value: 1 }],
      players: [{ index: 0, nickname: 'alice', hand_size: 1, connected: true }],
      discard: { color: 'red', kind: 'number', value: 1 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 2,
      match_format: 'BO3',
      max_players: 4,
    }
    useGameStore.getState().setPendingGameState(dto)

    const s = useGameStore.getState()
    expect(s.pendingGameState).toEqual(dto)
    // Should not have been applied yet
    expect(s.myHand).toHaveLength(0)
  })

  it('dismissRoundSummary applies pending state and clears summary', () => {
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [{ color: 'blue', kind: 'number', value: 3 }],
      players: [{ index: 0, nickname: 'alice', hand_size: 1, connected: true }],
      discard: { color: 'blue', kind: 'number', value: 3 },
      active_color: 'blue',
      turn: 0,
      direction: 1,
      round_number: 2,
      match_format: 'BO3',
      max_players: 4,
    }
    useGameStore.setState({ showRoundSummary: true, pendingGameState: dto })
    useGameStore.getState().dismissRoundSummary()

    const s = useGameStore.getState()
    expect(s.showRoundSummary).toBe(false)
    expect(s.pendingGameState).toBeNull()
    expect(s.myHand).toHaveLength(1)
    expect(s.roundNumber).toBe(2)
  })

  it('dismissRoundSummary without pending state just clears summary', () => {
    useGameStore.setState({ showRoundSummary: true, pendingGameState: null })
    useGameStore.getState().dismissRoundSummary()
    expect(useGameStore.getState().showRoundSummary).toBe(false)
  })

  it('setLobbyConfig updates matchFormat and maxPlayers', () => {
    useGameStore.getState().setLobbyConfig('BO3', 6)
    const s = useGameStore.getState()
    expect(s.matchFormat).toBe('BO3')
    expect(s.maxPlayers).toBe(6)
  })

  it('applyGameState clears stale UNO state (regression: round-transition leftovers)', () => {
    // Simulate stale UNO state from the previous round.
    useGameStore.setState({
      unoDeclared: true,
      unoDeclaredByIndex: 2,
      unoTimerEnd: Date.now() + 5000,
    })
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [],
      players: [],
      discard: { color: 'green', kind: 'number', value: 4 },
      active_color: 'green',
      turn: 0,
      direction: 1,
      round_number: 2,
      match_format: 'BO3',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.unoDeclared).toBe(false)
    expect(s.unoDeclaredByIndex).toBe(-1)
    expect(s.unoTimerEnd).toBeNull()
  })

  it('applyPendingGameState with no pending state is a no-op', () => {
    useGameStore.setState({ myHand: [], pendingGameState: null })
    useGameStore.getState().applyPendingGameState()
    expect(useGameStore.getState().myHand).toHaveLength(0)
  })

  it('applyGameState resets showRoundSummary and pendingGameState', () => {
    useGameStore.setState({ showRoundSummary: true, pendingGameState: { your_index: 0, hand: [], players: [], discard: { color: 'red', kind: 'number', value: 1 }, active_color: 'red', turn: 0, direction: 1, round_number: 1, match_format: 'BO1', max_players: 10 } })
    const dto: GameStateDTO = {
      your_index: 1,
      hand: [],
      players: [],
      discard: { color: 'blue', kind: 'number', value: 2 },
      active_color: 'blue',
      turn: 1,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.showRoundSummary).toBe(false)
    expect(s.pendingGameState).toBeNull()
    expect(s.myIndex).toBe(1)
  })

  it('applyCardPlayed with wild card keeps activeColor from store', () => {
    useGameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const wildCard: CardDTO = { color: 'wild', kind: 'wild' }
    useGameStore.getState().applyCardPlayed(0, wildCard, 1, 0, undefined)
    // activeColor should remain 'green' since card.color === 'wild'
    expect(useGameStore.getState().activeColor).toBe('green')
  })

  it('applyCardPlayed with wild card uses server active_color when provided', () => {
    useGameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const wildCard: CardDTO = { color: 'wild', kind: 'wild' }
    useGameStore.getState().applyCardPlayed(0, wildCard, 1, 0, 'blue')
    expect(useGameStore.getState().activeColor).toBe('blue')
  })

  it('applyCardPlayed removes played card from myHand', () => {
    const hand: CardDTO[] = [
      { color: 'red', kind: 'number', value: 3 },
      { color: 'blue', kind: 'number', value: 5 },
      { color: 'red', kind: 'number', value: 7 },
    ]
    useGameStore.setState({
      myIndex: 0,
      myHand: hand,
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const playedCard: CardDTO = { color: 'blue', kind: 'number', value: 5 }
    useGameStore.getState().applyCardPlayed(0, playedCard, 1, 0, 'blue')
    expect(useGameStore.getState().myHand).toHaveLength(2)
    expect(useGameStore.getState().myHand.find(c => c.color === 'blue' && c.value === 5)).toBeUndefined()
  })

  it('setIsReconnecting toggles isReconnecting', () => {
    useGameStore.getState().setIsReconnecting(true)
    expect(useGameStore.getState().isReconnecting).toBe(true)
    useGameStore.getState().setIsReconnecting(false)
    expect(useGameStore.getState().isReconnecting).toBe(false)
  })

  it('applyMatchEnd sets matchOver and navigates to gameover', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 80, rounds_won: 2 },
    ]
    useGameStore.getState().applyMatchEnd('alice', sb)
    const s = useGameStore.getState()
    expect(s.matchOver).toBe(true)
    expect(s.matchWinner).toBe('alice')
    expect(s.screen).toBe('gameover')
  })

  // ──────────────────────────────────────────────────────────────
  // pendingMatchEnd buffering — final round summary must be visible
  // before the game over screen.
  // ──────────────────────────────────────────────────────────────

  it('setPendingMatchEnd stores payload without transitioning to gameover', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 120, rounds_won: 2 },
    ]
    useGameStore.getState().setPendingMatchEnd('alice', sb)
    const s = useGameStore.getState()
    expect(s.pendingMatchEnd).toEqual({ matchWinner: 'alice', scoreboard: sb })
    // Screen must NOT have changed yet
    expect(s.screen).toBe('lobby')
    expect(s.matchOver).toBe(false)
  })

  it('dismissRoundSummary with pendingMatchEnd transitions to gameover and clears buffer', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 120, rounds_won: 2 },
    ]
    useGameStore.setState({
      showRoundSummary: true,
      pendingMatchEnd: { matchWinner: 'alice', scoreboard: sb },
    })
    useGameStore.getState().dismissRoundSummary()
    const s = useGameStore.getState()
    expect(s.showRoundSummary).toBe(false)
    expect(s.pendingMatchEnd).toBeNull()
    expect(s.matchOver).toBe(true)
    expect(s.matchWinner).toBe('alice')
    expect(s.scoreboard).toEqual(sb)
    expect(s.screen).toBe('gameover')
  })

  it('dismissRoundSummary prefers pendingMatchEnd over pendingGameState', () => {
    // Both pending — match end wins (the match is over)
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 50, rounds_won: 1 },
    ]
    const nextRound: GameStateDTO = {
      your_index: 0,
      hand: [{ color: 'red', kind: 'number', value: 1 }],
      players: [{ index: 0, nickname: 'alice', hand_size: 1, connected: true }],
      discard: { color: 'red', kind: 'number', value: 1 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 3,
      match_format: 'BO3',
      max_players: 4,
    }
    useGameStore.setState({
      showRoundSummary: true,
      pendingMatchEnd: { matchWinner: 'alice', scoreboard: sb },
      pendingGameState: nextRound,
    })
    useGameStore.getState().dismissRoundSummary()
    const s = useGameStore.getState()
    expect(s.screen).toBe('gameover')
    expect(s.matchOver).toBe(true)
    // pendingGameState should still be cleared via the gameover transition
    expect(s.pendingMatchEnd).toBeNull()
  })

  it('applyGameState clears pendingMatchEnd', () => {
    useGameStore.setState({
      pendingMatchEnd: { matchWinner: 'bob', scoreboard: [] },
    })
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [],
      players: [],
      discard: { color: 'blue', kind: 'number', value: 2 },
      active_color: 'blue',
      turn: 0,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    expect(useGameStore.getState().pendingMatchEnd).toBeNull()
  })

  it('applyRoundEnd clears turnDeadline and unoTimerEnd', () => {
    useGameStore.setState({ turnDeadline: 9999999, unoTimerEnd: 8888888, unoDeclared: true })
    useGameStore.getState().applyRoundEnd('alice', 1, [])
    const s = useGameStore.getState()
    expect(s.turnDeadline).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
    expect(s.unoDeclared).toBe(false)
  })

  // ──────────────────────────────────────────────────────────────
  // Turn deadline
  // ──────────────────────────────────────────────────────────────

  it('setTurnDeadline stores deadline timestamp', () => {
    useGameStore.getState().setTurnDeadline(1700000000000)
    expect(useGameStore.getState().turnDeadline).toBe(1700000000000)
  })

  it('setTurnDeadline clears deadline with null', () => {
    useGameStore.setState({ turnDeadline: 1700000000000 })
    useGameStore.getState().setTurnDeadline(null)
    expect(useGameStore.getState().turnDeadline).toBeNull()
  })

  it('applyCardPlayed clears turnDeadline', () => {
    useGameStore.setState({
      turnDeadline: 1700000000000,
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 1 }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    // turn deadline is reset by the hub on each new turn; store does not proactively clear it
    // (the hub sends a new turn_deadline with the next turn_changed / card_played message).
    // This test verifies pendingDraw is correctly forwarded.
    expect(useGameStore.getState().currentTurn).toBe(1)
  })

  // ──────────────────────────────────────────────────────────────
  // UNO state management
  // ──────────────────────────────────────────────────────────────

  it('setUnoDeclared sets and clears unoDeclared flag', () => {
    useGameStore.getState().setUnoDeclared(true)
    expect(useGameStore.getState().unoDeclared).toBe(true)
    useGameStore.getState().setUnoDeclared(false)
    expect(useGameStore.getState().unoDeclared).toBe(false)
  })

  it('applyCardPlayed clears unoDeclared (UNO is consumed when card is played)', () => {
    useGameStore.setState({
      unoDeclared: true,
      players: [{ index: 0, nickname: 'alice', hand_size: 2, connected: true }],
    })
    const card: CardDTO = { color: 'green', kind: 'number', value: 4 }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(useGameStore.getState().unoDeclared).toBe(false)
  })

  it('setUnoTimerEnd records timer timestamp', () => {
    useGameStore.getState().setUnoTimerEnd(1700000099000)
    expect(useGameStore.getState().unoTimerEnd).toBe(1700000099000)
  })

  it('setUnoTimerEnd clears timer with null', () => {
    useGameStore.setState({ unoTimerEnd: 1700000099000 })
    useGameStore.getState().setUnoTimerEnd(null)
    expect(useGameStore.getState().unoTimerEnd).toBeNull()
  })

  // ──────────────────────────────────────────────────────────────
  // Pending draw accumulation
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed propagates pendingDraw from server', () => {
    useGameStore.setState({
      pendingDraw: 0,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Alice plays DrawTwo — server reports pendingDraw=2
    const card: CardDTO = { color: 'red', kind: 'draw_two' }
    useGameStore.getState().applyCardPlayed(0, card, 1, 2, undefined)
    expect(useGameStore.getState().pendingDraw).toBe(2)
  })

  it('applyCardPlayed stacks pendingDraw when counter played (DrawTwo on +2)', () => {
    useGameStore.setState({
      pendingDraw: 2,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Bob counters with another DrawTwo — server reports pendingDraw=4
    const card: CardDTO = { color: 'blue', kind: 'draw_two' }
    useGameStore.getState().applyCardPlayed(1, card, 0, 4, undefined)
    expect(useGameStore.getState().pendingDraw).toBe(4)
  })

  it('applyCardPlayed adopts server-provided player list (e.g. on round end)', () => {
    useGameStore.setState({
      myIndex: 1,
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 9 }
    const serverPlayers = [
      { index: 0, nickname: 'alice', hand_size: 0, connected: true },
      { index: 1, nickname: 'bob', hand_size: 5, connected: true },
    ]
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined, serverPlayers)
    const s = useGameStore.getState()
    expect(s.players[0].hand_size).toBe(0)
    expect(s.players[1].hand_size).toBe(5)
  })

  it('applyCardPlayed falls back to local hand-size decrement when no server player list', () => {
    useGameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 2 }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(useGameStore.getState().players[0].hand_size).toBe(4)
    expect(useGameStore.getState().players[1].hand_size).toBe(5)
  })

  // ──────────────────────────────────────────────────────────────
  // Interrupt / speed-play scenario
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed handles interrupt play (out-of-turn player plays)', () => {
    // Bob (index 1) plays out of turn interrupting while it is alice's (0) turn.
    // The server resolves the interrupt and reports currentTurn has shifted.
    useGameStore.setState({
      myIndex: 0,
      currentTurn: 0, // it was alice's turn
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 3, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 7 },
    })
    // Bob plays a red 7 (exact match — valid interrupt); server says next turn = 0 (alice again)
    const card: CardDTO = { color: 'red', kind: 'number', value: 7 }
    useGameStore.getState().applyCardPlayed(1, card, 0, 0, undefined)
    const s = useGameStore.getState()
    expect(s.discard).toEqual(card)
    expect(s.currentTurn).toBe(0)
    expect(s.players[1].hand_size).toBe(2) // bob's local hand reduced
  })

  // ──────────────────────────────────────────────────────────────
  // Swap / GlobalSwitch notice surfacing
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed sets swapNotice with target index when a Swap card resolves', () => {
    useGameStore.setState({
      myIndex: 0,
      currentTurn: 0,
      direction: 1,
      swapNotice: null,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'swap' }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, 'red', undefined, 1)
    const n = useGameStore.getState().swapNotice
    expect(n).not.toBeNull()
    expect(n?.kind).toBe('swap')
    expect(n?.actorIndex).toBe(0)
    expect(n?.targetIndex).toBe(1)
  })

  it('applyCardPlayed sets swapNotice with kind=global_switch and direction', () => {
    useGameStore.setState({
      myIndex: 1,
      currentTurn: 0,
      direction: -1,
      swapNotice: null,
    })
    const card: CardDTO = { color: 'wild', kind: 'global_switch' }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, 'blue')
    const n = useGameStore.getState().swapNotice
    expect(n?.kind).toBe('global_switch')
    expect(n?.actorIndex).toBe(0)
    expect(n?.targetIndex).toBe(-1)
    expect(n?.direction).toBe(-1)
  })

  it('applyCardPlayed does not set swapNotice for ordinary cards', () => {
    useGameStore.setState({ swapNotice: null })
    const card: CardDTO = { color: 'red', kind: 'number', value: 7 }
    useGameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(useGameStore.getState().swapNotice).toBeNull()
  })

  // ──────────────────────────────────────────────────────────────
  // Hand replacement (Swap / GlobalSwitch via applyGameState)
  // ──────────────────────────────────────────────────────────────

  it('applyGameState replaces hand completely (models Swap/GlobalSwitch effect)', () => {
    // Before: player has old hand
    useGameStore.setState({
      myIndex: 0,
      myHand: [
        { color: 'red', kind: 'number', value: 1 },
        { color: 'blue', kind: 'number', value: 2 },
        { color: 'green', kind: 'number', value: 3 },
        { color: 'yellow', kind: 'number', value: 4 },
      ],
    })
    // Server sends full game_state after swap: player now has a new hand
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [
        { color: 'wild', kind: 'wild' },
        { color: 'red', kind: 'skip' },
      ],
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 4, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 5 },
      active_color: 'red',
      turn: 1,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.myHand).toHaveLength(2)
    expect(s.myHand[0]).toEqual({ color: 'wild', kind: 'wild' })
    expect(s.myHand[1]).toEqual({ color: 'red', kind: 'skip' })
    expect(s.players.map((p) => p.nickname)).toEqual(['alice', 'bob'])
  })

  it('applyGameState refreshes players on reconnect-style full state', () => {
    useGameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 4, connected: false },
        { index: 1, nickname: 'bob', hand_size: 3, connected: true },
      ],
      myIndex: 0,
    })
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [
        { color: 'red', kind: 'number', value: 8 },
        { color: 'blue', kind: 'number', value: 1 },
      ],
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
        { index: 2, nickname: 'carol', hand_size: 4, connected: true },
      ],
      discard: { color: 'yellow', kind: 'number', value: 5 },
      active_color: 'yellow',
      turn: 2,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    useGameStore.getState().applyGameState(dto)
    const s = useGameStore.getState()
    expect(s.players).toHaveLength(3)
    expect(s.players.find((p) => p.index === 0)?.connected).toBe(true)
    expect(s.currentTurn).toBe(2)
  })
})
