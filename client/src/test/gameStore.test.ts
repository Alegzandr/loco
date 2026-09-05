import { describe, it, expect, beforeEach } from 'vitest'
import { gameStore } from '../hooks/gameStore'
import { CardDTO, GameStateDTO, ScoreboardEntryDTO } from '../types/protocol'

// Reset store state between tests
beforeEach(() => {
  gameStore.setState({
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
    declaredSeats: [],
    myDeclared: false,
    catchWindows: [],
    catchTarget: null,
    unoTimerEnd: null,
    scoreboard: [],
    roundWinner: '',
    roundScores: [],
    roundNumber_completed: 0,
    matchWinner: '',
    matchOver: false,
    showRoundSummary: false,
    pendingMatchEnd: null,
    isReconnecting: false,
  })
})

describe('gameStore', () => {
  it('starts at lobby screen', () => {
    const state = gameStore.getState()
    expect(state.screen).toBe('lobby')
  })

  it('setRoomCode updates roomCode', () => {
    gameStore.getState().setRoomCode('ABCD')
    expect(gameStore.getState().roomCode).toBe('ABCD')
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
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.myHand).toHaveLength(2)
    expect(s.players).toHaveLength(2)
    expect(s.activeColor).toBe('red')
    expect(s.currentTurn).toBe(0)
    expect(s.showRoundSummary).toBe(false)
  })

  it('applyCardPlayed advances turn and updates discard', () => {
    gameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
      currentTurn: 0,
      discard: { color: 'red', kind: 'number', value: 3 },
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 7 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)

    const s = gameStore.getState()
    expect(s.discard).toEqual(card)
    expect(s.currentTurn).toBe(1)
    expect(s.players[0].hand_size).toBe(4)
  })

  it('applyCardDrawn adds card to own hand', () => {
    gameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
    })
    gameStore.setState({ myHand: [{ color: 'blue', kind: 'number', value: 2 }], myIndex: 0, currentTurn: 0 })
    const drawn: CardDTO = { color: 'green', kind: 'skip' }
    // Voluntary draw: turn stays on player 0, so currentTurn does not change.
    gameStore.getState().applyCardDrawn([drawn], 0, 0)

    expect(gameStore.getState().myHand).toHaveLength(2)
    expect(gameStore.getState().players.map((p) => p.nickname)).toEqual(['alice', 'bob'])
  })

  it('applyCardDrawn adds multiple cards on penalty draw', () => {
    gameStore.setState({ myHand: [{ color: 'blue', kind: 'number', value: 2 }], myIndex: 0, currentTurn: 0, pendingDraw: 2 })
    const drawn1: CardDTO = { color: 'red', kind: 'number', value: 3 }
    const drawn2: CardDTO = { color: 'green', kind: 'skip' }
    // Penalty draw: turn advances to player 1, the server reports the stack spent.
    gameStore.getState().applyCardDrawn([drawn1, drawn2], 0, 1, true, undefined, 0)

    expect(gameStore.getState().myHand).toHaveLength(3)
    expect(gameStore.getState().pendingDraw).toBe(0)
    expect(gameStore.getState().currentTurn).toBe(1)
    expect(gameStore.getState().hasDrawn).toBe(true)
  })

  it('applyCardDrawn updates opponent hand size', () => {
    gameStore.setState({
      currentTurn: 1,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // null cards means another player drew; turn stays the same (voluntary draw).
    // The count is the server's, never inferred: a draw against exhausted piles
    // sends 0, and guessing 1 would grow a hand that did not grow.
    gameStore.getState().applyCardDrawn(null, 1, 1, undefined, 1)
    expect(gameStore.getState().players[1].hand_size).toBe(6)
  })

  it('applyCardDrawn adds nothing when the draw came up empty', () => {
    gameStore.setState({
      currentTurn: 1,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    gameStore.getState().applyCardDrawn(null, 1, 1, true, 0)
    expect(gameStore.getState().players[1].hand_size).toBe(5)
    expect(gameStore.getState().hasDrawn).toBe(true)
  })

  it('applyCardDrawn resets pendingDraw for observers when penalty draw advances turn', () => {
    gameStore.setState({
      currentTurn: 1,
      pendingDraw: 2,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Bob drew 2 penalty cards; turn advances to alice (0).
    gameStore.getState().applyCardDrawn(null, 1, 0, true, 2, 0)
    expect(gameStore.getState().players[1].hand_size).toBe(7)
    expect(gameStore.getState().pendingDraw).toBe(0)
    expect(gameStore.getState().currentTurn).toBe(0)
  })

  // A card_drawn is not proof that the recipient drew on their turn: the
  // UNO-catch penalty grows a hand while the draw-once flag stays false, and the
  // same message reaches every seat. Reading a missing has_drawn as "true" left
  // the player with a disabled Draw button and a Pass the server refused with
  // "you must draw a card before passing" until the turn timer bailed them out.
  it('applyCardDrawn takes hasDrawn from the message, never from the fact a hand grew', () => {
    gameStore.setState({
      myHand: [{ color: 'red', kind: 'number', value: 1 }],
      myIndex: 0,
      currentTurn: 0,
      pendingDraw: 0,
      hasDrawn: false,
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
    })
    // Caught for not calling LOCO: +2 cards, but our turn has not been used.
    const penalty: CardDTO[] = [
      { color: 'blue', kind: 'number', value: 4 },
      { color: 'green', kind: 'number', value: 9 },
    ]
    gameStore.getState().applyCardDrawn(penalty, 0, 0, false, undefined, 0)

    expect(gameStore.getState().myHand).toHaveLength(3)
    expect(gameStore.getState().hasDrawn).toBe(false)
  })

  it('applyCardDrawn leaves hasDrawn and pendingDraw alone when the message omits them', () => {
    gameStore.setState({
      currentTurn: 0,
      pendingDraw: 2,
      hasDrawn: false,
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
    })
    gameStore.getState().applyCardDrawn(null, 1, 0, undefined, 1)

    expect(gameStore.getState().hasDrawn).toBe(false)
    expect(gameStore.getState().pendingDraw).toBe(2)
    expect(gameStore.getState().players[1].hand_size).toBe(8)
  })

  it('setError and clearError work', () => {
    gameStore.getState().setError('oops')
    expect(gameStore.getState().errorMsg).toBe('oops')
    gameStore.getState().clearError()
    expect(gameStore.getState().errorMsg).toBe('')
  })

  // ──────────────────────────────────────────────────────────────
  // Round summary / buffering tests
  // ──────────────────────────────────────────────────────────────

  it('applyRoundEnd sets showRoundSummary and computes roundScores delta', () => {
    // Pre-round scoreboard
    gameStore.setState({
      scoreboard: [
        { player_index: 0, nickname: 'alice', score: 0, rounds_won: 0 },
        { player_index: 1, nickname: 'bob', score: 0, rounds_won: 0 },
      ],
    })

    const newScoreboard: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
      { player_index: 1, nickname: 'bob', score: 0, rounds_won: 0 },
    ]
    gameStore.getState().applyRoundEnd('alice', 1, newScoreboard)

    const s = gameStore.getState()
    expect(s.showRoundSummary).toBe(true)
    expect(s.roundWinner).toBe('alice')
    expect(s.roundNumber_completed).toBe(1)
    expect(s.scoreboard).toEqual(newScoreboard)

    const aliceEntry = s.roundScores.find((e) => e.nickname === 'alice')
    expect(aliceEntry?.round_points).toBe(30)
    const bobEntry = s.roundScores.find((e) => e.nickname === 'bob')
    expect(bobEntry?.round_points).toBe(0)
  })

  it('applyGameState leaves the round summary standing', () => {
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
    gameStore.setState({ showRoundSummary: true, roundWinner: 'alice' })
    gameStore.getState().applyGameState(dto)

    const s = gameStore.getState()
    // The board is settled the moment it arrives...
    expect(s.myHand).toHaveLength(1)
    expect(s.roundNumber).toBe(2)
    // ...and the card the player is reading is not the board's to take down.
    expect(s.showRoundSummary).toBe(true)
    expect(s.roundWinner).toBe('alice')
  })

  it('dismissRoundSummary never puts a stale board back', () => {
    // The deal, applied on arrival the way the server sends it.
    const deal: GameStateDTO = {
      your_index: 0,
      hand: [{ color: 'blue', kind: 'number', value: 3 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 8, connected: true },
        { index: 1, nickname: 'bob', hand_size: 8, connected: true },
      ],
      discard: { color: 'blue', kind: 'number', value: 3 },
      active_color: 'blue',
      turn: 1,
      direction: 1,
      round_number: 2,
      match_format: 'BO3',
      max_players: 4,
    }
    gameStore.setState({ showRoundSummary: true, roundWinner: 'alice' })
    gameStore.getState().applyGameState(deal)

    // bob plays while the card is still up, and the turn comes round to us.
    gameStore.getState().applyCardPlayed(
      1,
      { color: 'blue', kind: 'number', value: 7 },
      0,
      0,
      'blue',
      [
        { index: 0, nickname: 'alice', hand_size: 8, connected: true },
        { index: 1, nickname: 'bob', hand_size: 7, connected: true },
      ],
    )
    expect(gameStore.getState().currentTurn).toBe(0)

    gameStore.getState().dismissRoundSummary()

    const s = gameStore.getState()
    expect(s.showRoundSummary).toBe(false)
    // The whole point: reading the scores must not roll the table back to the
    // deal. It used to, and a turn rolled back onto somebody else deadlocked
    // the table until the server's turn timer expired.
    expect(s.currentTurn).toBe(0)
    expect(s.discard).toEqual({ color: 'blue', kind: 'number', value: 7 })
    expect(s.players.find((p) => p.index === 1)?.hand_size).toBe(7)
  })

  it('dismissRoundSummary with nothing pending just clears the card', () => {
    gameStore.setState({ showRoundSummary: true, roundWinner: 'alice' })
    gameStore.getState().dismissRoundSummary()
    expect(gameStore.getState().showRoundSummary).toBe(false)
    expect(gameStore.getState().roundWinner).toBe('')
  })

  it('setLobbyConfig updates matchFormat and maxPlayers', () => {
    gameStore.getState().setLobbyConfig('BO3', 6)
    const s = gameStore.getState()
    expect(s.matchFormat).toBe('BO3')
    expect(s.maxPlayers).toBe(6)
  })

  it('applyGameState clears stale UNO state (regression: round-transition leftovers)', () => {
    // Simulate stale UNO state from the previous round.
    gameStore.setState({
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
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.unoDeclared).toBe(false)
    expect(s.unoDeclaredByIndex).toBe(-1)
    expect(s.unoTimerEnd).toBeNull()
  })

  it('applyGameState settles the seat it is built for', () => {
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
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.myIndex).toBe(1)
  })

  it('applyCardPlayed with wild card keeps activeColor from store', () => {
    gameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const wildCard: CardDTO = { color: 'wild', kind: 'wild' }
    gameStore.getState().applyCardPlayed(0, wildCard, 1, 0, undefined)
    // activeColor should remain 'green' since card.color === 'wild'
    expect(gameStore.getState().activeColor).toBe('green')
  })

  it('applyCardPlayed with wild card uses server active_color when provided', () => {
    gameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const wildCard: CardDTO = { color: 'wild', kind: 'wild' }
    gameStore.getState().applyCardPlayed(0, wildCard, 1, 0, 'blue')
    expect(gameStore.getState().activeColor).toBe('blue')
  })

  it('applyCardPlayed takes the chosen colour on a global_switch', () => {
    gameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const gs: CardDTO = { color: 'wild', kind: 'global_switch' }
    // GlobalSwitch is a wild like the other two: the player names the colour.
    gameStore.getState().applyCardPlayed(0, gs, 1, 0, 'yellow')
    expect(gameStore.getState().activeColor).toBe('yellow')
  })

  it('applyCardPlayed ignores an active_color of "wild"', () => {
    gameStore.setState({
      activeColor: 'green',
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const gs: CardDTO = { color: 'wild', kind: 'global_switch' }
    // 'wild' matches no coloured card — accepting it would leave the whole
    // table with wilds as its only legal play.
    gameStore.getState().applyCardPlayed(0, gs, 1, 0, 'wild')
    expect(gameStore.getState().activeColor).toBe('green')
  })

  it('applyCardPlayed removes played card from myHand', () => {
    const hand: CardDTO[] = [
      { color: 'red', kind: 'number', value: 3 },
      { color: 'blue', kind: 'number', value: 5 },
      { color: 'red', kind: 'number', value: 7 },
    ]
    gameStore.setState({
      myIndex: 0,
      myHand: hand,
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const playedCard: CardDTO = { color: 'blue', kind: 'number', value: 5 }
    gameStore.getState().applyCardPlayed(0, playedCard, 1, 0, 'blue')
    expect(gameStore.getState().myHand).toHaveLength(2)
    expect(gameStore.getState().myHand.find(c => c.color === 'blue' && c.value === 5)).toBeUndefined()
  })

  it('setIsReconnecting toggles isReconnecting', () => {
    gameStore.getState().setIsReconnecting(true)
    expect(gameStore.getState().isReconnecting).toBe(true)
    gameStore.getState().setIsReconnecting(false)
    expect(gameStore.getState().isReconnecting).toBe(false)
  })

  it('applyMatchEnd sets matchOver and navigates to gameover', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 80, rounds_won: 2 },
    ]
    gameStore.getState().applyMatchEnd('alice', sb, [])
    const s = gameStore.getState()
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
    gameStore.getState().setPendingMatchEnd('alice', sb, [])
    const s = gameStore.getState()
    expect(s.pendingMatchEnd).toEqual({ matchWinner: 'alice', scoreboard: sb, matchHistory: [] })
    // Screen must NOT have changed yet
    expect(s.screen).toBe('lobby')
    expect(s.matchOver).toBe(false)
  })

  it('dismissRoundSummary with pendingMatchEnd transitions to gameover and clears buffer', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 120, rounds_won: 2 },
    ]
    gameStore.setState({
      showRoundSummary: true,
      pendingMatchEnd: { matchWinner: 'alice', scoreboard: sb, matchHistory: [] },
    })
    gameStore.getState().dismissRoundSummary()
    const s = gameStore.getState()
    expect(s.showRoundSummary).toBe(false)
    expect(s.pendingMatchEnd).toBeNull()
    expect(s.matchOver).toBe(true)
    expect(s.matchWinner).toBe('alice')
    expect(s.scoreboard).toEqual(sb)
    expect(s.screen).toBe('gameover')
  })

  it('dismissRoundSummary takes the match end over the board it is standing on', () => {
    const sb: ScoreboardEntryDTO[] = [
      { player_index: 0, nickname: 'alice', score: 50, rounds_won: 1 },
    ]
    gameStore.setState({
      showRoundSummary: true,
      screen: 'game',
      currentTurn: 1,
      pendingMatchEnd: { matchWinner: 'alice', scoreboard: sb, matchHistory: [] },
    })
    gameStore.getState().dismissRoundSummary()
    const s = gameStore.getState()
    expect(s.screen).toBe('gameover')
    expect(s.matchOver).toBe(true)
    expect(s.pendingMatchEnd).toBeNull()
  })

  it('applyGameState clears pendingMatchEnd', () => {
    gameStore.setState({
      pendingMatchEnd: { matchWinner: 'bob', scoreboard: [], matchHistory: [] },
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
    gameStore.getState().applyGameState(dto)
    expect(gameStore.getState().pendingMatchEnd).toBeNull()
  })

  it('applyRoundEnd clears turnDeadline and unoTimerEnd', () => {
    gameStore.setState({ turnDeadline: 9999999, unoTimerEnd: 8888888, unoDeclared: true })
    gameStore.getState().applyRoundEnd('alice', 1, [])
    const s = gameStore.getState()
    expect(s.turnDeadline).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
    expect(s.unoDeclared).toBe(false)
  })

  // ──────────────────────────────────────────────────────────────
  // Turn deadline
  // ──────────────────────────────────────────────────────────────

  it('setTurnDeadline stores deadline timestamp', () => {
    gameStore.getState().setTurnDeadline(1700000000000)
    expect(gameStore.getState().turnDeadline).toBe(1700000000000)
  })

  it('setTurnDeadline clears deadline with null', () => {
    gameStore.setState({ turnDeadline: 1700000000000 })
    gameStore.getState().setTurnDeadline(null)
    expect(gameStore.getState().turnDeadline).toBeNull()
  })

  // The store deliberately does NOT clear turnDeadline here: the hub sends a
  // fresh one with the same card_played, and clearing it locally would blank the
  // countdown bar for a round trip on every single play. This test therefore
  // asserts what applyCardPlayed really owes (the turn and the pending draw),
  // and that the deadline is left for the transport to set.
  it('applyCardPlayed forwards turn and pendingDraw, leaving turnDeadline to the server', () => {
    gameStore.setState({
      turnDeadline: 1700000000000,
      pendingDraw: 4,
      players: [{ index: 0, nickname: 'alice', hand_size: 3, connected: true }],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 1 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    const s = gameStore.getState()
    expect(s.currentTurn).toBe(1)
    expect(s.pendingDraw).toBe(0)
    expect(s.turnDeadline).toBe(1700000000000)
  })

  // ──────────────────────────────────────────────────────────────
  // UNO state management
  // ──────────────────────────────────────────────────────────────

  it('setUnoDeclared sets and clears unoDeclared flag', () => {
    gameStore.getState().setUnoDeclared(true)
    expect(gameStore.getState().unoDeclared).toBe(true)
    gameStore.getState().setUnoDeclared(false)
    expect(gameStore.getState().unoDeclared).toBe(false)
  })

  // A declaration is spent: the server refuses a second one on the same single
  // card, so the button must stop offering it after the server confirms ours.
  it('applyUnoDeclared spends our own declaration and only ours', () => {
    gameStore.setState({ myIndex: 1 })
    gameStore.getState().applyUnoDeclared(0)
    expect(gameStore.getState().myDeclared).toBe(false)
    gameStore.getState().applyUnoDeclared(1)
    const s = gameStore.getState()
    expect(s.myDeclared).toBe(true)
    expect(s.unoDeclaredByIndex).toBe(1)
  })

  // The flip side: a GlobalSwitch hands us a different single card, which
  // nobody has heard called, so the server puts our seat back on the hook
  // (openCatchWindowsAfterRearrange) and the button comes back live.
  it('applyCardPlayed re-arms our declaration when the server reopens our window', () => {
    gameStore.setState({
      myIndex: 1,
      declaredSeats: [1],
      myHand: [{ color: 'red', kind: 'number', value: 5 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 3, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
      ],
    })
    const gs: CardDTO = { color: 'wild', kind: 'global_switch' }
    gameStore.getState().applyCardPlayed(0, gs, 1, 0, 'red', [
      { index: 0, nickname: 'alice', hand_size: 3, connected: true },
      { index: 1, nickname: 'bob', hand_size: 1, connected: true },
    ], undefined, undefined, [{ player_index: 1, ends_at: Date.now() + 5000 }])
    expect(gameStore.getState().myDeclared).toBe(false)
  })

  // Nothing else may spend it: an unrelated play leaves the single card we
  // already called exactly as it was.
  it('applyCardPlayed keeps our declaration through an unrelated play', () => {
    gameStore.setState({
      myIndex: 1,
      declaredSeats: [1],
      myHand: [{ color: 'red', kind: 'number', value: 5 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 3, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 4 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, 'red')
    expect(gameStore.getState().myDeclared).toBe(true)
  })

  // The same record answers the other half of the question: an opponent sitting
  // on one card everybody heard called cannot be caught until that hand changes,
  // so Contre-LOCO! against them is a card paid for nothing and the centre
  // button stops offering the wager (`components/catchAvailability.ts`).
  it('applyUnoDeclared records the seat that called it, whoever it is', () => {
    gameStore.setState({ myIndex: 0, declaredSeats: [] })
    gameStore.getState().applyUnoDeclared(2)
    expect(gameStore.getState().declaredSeats).toEqual([2])
    // A second confirmation for the same seat is the same one call.
    gameStore.getState().applyUnoDeclared(2)
    expect(gameStore.getState().declaredSeats).toEqual([2])
  })

  // A declaration covers one card. A hand that grew is off it, and that seat
  // owes the table a fresh call on the way back down — so the button has to
  // come back live for it.
  it('applyCardDrawn retires the drawing seat declaration', () => {
    gameStore.setState({
      myIndex: 0,
      declaredSeats: [2],
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 2, nickname: 'carol', hand_size: 1, connected: true },
      ],
    })
    gameStore.getState().applyCardDrawn(null, 2, 0, false, 1, 0)
    expect(gameStore.getState().declaredSeats).toEqual([])
  })

  // Playing the called card away ends the obligation with it: the seat is on
  // zero cards (it won) or on a hand nobody has heard called.
  it('applyCardPlayed retires a declaration whose seat is no longer on one card', () => {
    gameStore.setState({
      myIndex: 0,
      declaredSeats: [2],
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 2, nickname: 'carol', hand_size: 1, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 4 }
    gameStore.getState().applyCardPlayed(2, card, 0, 0, 'red', [
      { index: 0, nickname: 'alice', hand_size: 5, connected: true },
      { index: 2, nickname: 'carol', hand_size: 0, connected: true },
    ])
    expect(gameStore.getState().declaredSeats).toEqual([])
  })

  // An authoritative snapshot settles it like everything else: a fresh deal, a
  // penalty or a swapped hand owes nothing yet.
  it('applyGameState keeps only the declarations its roster still stands behind', () => {
    gameStore.setState({ myIndex: 0, declaredSeats: [1, 2] })
    gameStore.getState().applyGameState({
      your_index: 0,
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
        { index: 2, nickname: 'carol', hand_size: 4, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 4 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    })
    expect(gameStore.getState().declaredSeats).toEqual([1])
  })

  it('applyCardPlayed clears unoDeclared (UNO is consumed when card is played)', () => {
    gameStore.setState({
      unoDeclared: true,
      players: [{ index: 0, nickname: 'alice', hand_size: 2, connected: true }],
    })
    const card: CardDTO = { color: 'green', kind: 'number', value: 4 }
    // The actor is down to one card, so the server opens a window on them, and
    // a fresh window is what retires the previous declaration's banner.
    gameStore
      .getState()
      .applyCardPlayed(0, card, 1, 0, undefined, undefined, undefined, undefined, [
        { player_index: 0, ends_at: Date.now() + 5000 },
      ])
    expect(gameStore.getState().unoDeclared).toBe(false)
  })

  // The catch window is what makes LOCO a race: it opens the moment somebody
  // else lands on a single card, NOT when they declare. Driving it off
  // uno_declared showed the Catch button only in the one situation where the
  // server always refuses the catch. Which seat is on the hook is the server's
  // answer now, carried on card_played; what is tested here is that the client
  // offers it.
  it('applyCardPlayed offers the catch the server named', () => {
    gameStore.setState({
      myIndex: 1,
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    const card: CardDTO = { color: 'green', kind: 'number', value: 4 }
    const endsAt = Date.now() + 5000
    gameStore
      .getState()
      .applyCardPlayed(0, card, 1, 0, undefined, undefined, undefined, undefined, [
        { player_index: 0, ends_at: endsAt },
      ])
    const s = gameStore.getState()
    expect(s.catchTarget).toBe(0)
    expect(s.unoTimerEnd).toBe(endsAt)
  })

  it('applyCardPlayed does not offer a catch on my own last card', () => {
    gameStore.setState({
      myIndex: 0,
      players: [{ index: 0, nickname: 'alice', hand_size: 2, connected: true }],
    })
    const card: CardDTO = { color: 'green', kind: 'number', value: 4 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(gameStore.getState().catchTarget).toBeNull()
  })

  it('applyCardPlayed keeps a declaration alive when an unrelated player plays', () => {
    // Mirrors the server rule: only a NEW player reaching 1 card resets the flag.
    gameStore.setState({
      myIndex: 2,
      unoDeclared: true,
      unoDeclaredByIndex: 0,
      catchTarget: 0,
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 6, connected: true },
        { index: 2, nickname: 'carol', hand_size: 6, connected: true },
      ],
    })
    const card: CardDTO = { color: 'green', kind: 'number', value: 4 }
    gameStore.getState().applyCardPlayed(1, card, 2, 0, undefined)
    const s = gameStore.getState()
    expect(s.unoDeclared).toBe(true)
    expect(s.unoDeclaredByIndex).toBe(0)
  })

  // Receiving your last card owes the table a declaration just like playing
  // down to it, and a Swap puts TWO seats on the hook at once: the actor, who
  // received the opponent's single card, and the opponent, who received the
  // actor's leftover. The server works that out (openCatchWindowsAfterRearrange)
  // and names both seats; this is the client holding both of them open.
  it('applyCardPlayed holds a window open for every seat the server named', () => {
    gameStore.setState({
      myIndex: 2,
      catchWindows: [],
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
        { index: 2, nickname: 'carol', hand_size: 4, connected: true },
      ],
    })
    const swap: CardDTO = { color: 'red', kind: 'swap' }
    const endsAt = Date.now() + 5000
    gameStore.getState().applyCardPlayed(0, swap, 1, 0, 'red', [
      { index: 0, nickname: 'alice', hand_size: 1, connected: true },
      { index: 1, nickname: 'bob', hand_size: 1, connected: true },
      { index: 2, nickname: 'carol', hand_size: 4, connected: true },
    ], 1, undefined, [
      { player_index: 0, ends_at: endsAt },
      { player_index: 1, ends_at: endsAt },
    ])
    const seats = gameStore.getState().catchWindows.map((w) => w.seat).sort()
    expect(seats).toEqual([0, 1])
  })

  // A snapshot says who is on the hook itself now (`catch_seats`), and when it
  // does that list is the answer: a tab reloading into somebody's window has
  // no windows to filter, and used to be told about none at all. A call already
  // spent on the same window stays spent.
  it('applyGameState takes its catch windows from the snapshot when it carries them', () => {
    const endsAt = Date.now() + 4000
    gameStore.setState({
      myIndex: 0,
      catchWindows: [{ seat: 1, endsAt, attempted: true }],
    })
    gameStore.getState().applyGameState({
      your_index: 0,
      hand: [],
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
        { index: 2, nickname: 'carol', hand_size: 1, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 5 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 3,
      catch_seats: [
        { player_index: 1, ends_at: endsAt },
        { player_index: 2, ends_at: endsAt + 500 },
      ],
    })
    const s = gameStore.getState()
    expect(s.catchWindows).toEqual([
      { seat: 1, endsAt, attempted: true },
      { seat: 2, endsAt: endsAt + 500, attempted: undefined },
    ])
    // The one we already called on is spent, so the other is the offered catch.
    expect(s.catchTarget).toBe(2)
  })

  it('applyCardPlayed leaves a seat with a full hand off the hook after a global_switch', () => {
    gameStore.setState({
      myIndex: 0,
      catchWindows: [],
      players: [
        { index: 0, nickname: 'alice', hand_size: 2, connected: true },
        { index: 1, nickname: 'bob', hand_size: 3, connected: true },
        { index: 2, nickname: 'carol', hand_size: 1, connected: true },
      ],
    })
    const gs: CardDTO = { color: 'wild', kind: 'global_switch' }
    const endsAt = Date.now() + 5000
    gameStore.getState().applyCardPlayed(0, gs, 1, 0, 'blue', [
      { index: 0, nickname: 'alice', hand_size: 1, connected: true },
      { index: 1, nickname: 'bob', hand_size: 3, connected: true },
      { index: 2, nickname: 'carol', hand_size: 1, connected: true },
    ], -1, undefined, [
      { player_index: 0, ends_at: endsAt },
      { player_index: 2, ends_at: endsAt },
    ])
    const s = gameStore.getState()
    expect(s.catchWindows.map((w) => w.seat).sort()).toEqual([0, 2])
    // Ours is never the offered catch; carol's is.
    expect(s.catchTarget).toBe(2)
  })

  // Closing one seat's window must not release the others — after a rotation
  // the slow ones would get a free pass.
  it('a caught seat is retired and the next one is promoted', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [
        { seat: 0, endsAt: now + 2000 },
        { seat: 1, endsAt: now + 4000 },
      ],
      catchTarget: 0,
      unoTimerEnd: now + 2000,
    })
    gameStore.getState().applyUnoCaught(0)
    const s = gameStore.getState()
    expect(s.catchWindows.map((w) => w.seat)).toEqual([1])
    expect(s.catchTarget).toBe(1)
  })

  // Drawing takes a seat off one card, and the server refuses every catch on it
  // from that moment ("target does not have exactly 1 card"). A window left open
  // is a Contre-LOCO! button that stays armed on a play that can only be refused.
  it('applyCardDrawn closes the drawing seat window and promotes the next', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [
        { seat: 0, endsAt: now + 2000 },
        { seat: 1, endsAt: now + 4000 },
      ],
      catchTarget: 0,
      unoTimerEnd: now + 2000,
      players: [
        { index: 0, nickname: 'alice', hand_size: 1, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
        { index: 3, nickname: 'dave', hand_size: 5, connected: true },
      ],
    })
    gameStore.getState().applyCardDrawn(null, 0, 1, true, 1, 0)
    const s = gameStore.getState()
    expect(s.catchWindows.map((w) => w.seat)).toEqual([1])
    expect(s.catchTarget).toBe(1)
  })

  // A missed call now costs a card, so the button has to be spent the moment it
  // is pressed rather than when the server answers — otherwise one impatient
  // double tap buys the same opinion twice.
  it('noteCatchAttempt disarms that seat and promotes the next', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [
        { seat: 0, endsAt: now + 2000 },
        { seat: 1, endsAt: now + 4000 },
      ],
      catchTarget: 0,
      unoTimerEnd: now + 2000,
    })
    gameStore.getState().noteCatchAttempt(0)
    const s = gameStore.getState()
    // The window itself stays: it is still somebody else's obligation, and the
    // 5s bar is still counting down. Only our own button is spent.
    expect(s.catchWindows.map((w) => w.seat)).toEqual([0, 1])
    expect(s.catchTarget).toBe(1)
    expect(s.unoTimerEnd).toBe(now + 4000)
  })

  it('noteCatchAttempt on the only open window closes the button', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [{ seat: 0, endsAt: now + 2000 }],
      catchTarget: 0,
      unoTimerEnd: now + 2000,
    })
    gameStore.getState().noteCatchAttempt(0)
    const s = gameStore.getState()
    expect(s.catchTarget).toBeNull()
    expect(s.unoTimerEnd).toBeNull()
  })

  // The mirror of applyCatchFailed, and the one that was missing entirely: a
  // landed Contre-LOCO! used to close the window and announce nothing, so the
  // caught hand simply grew by two with no cause visible anywhere on screen.
  it('applyUnoCaught settles the caught seat and arms the verdict', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [
        { seat: 0, endsAt: now + 2000 },
        { seat: 1, endsAt: now + 4000 },
      ],
      catchTarget: 0,
      unoTimerEnd: now + 2000,
      catchFlash: null,
    })
    gameStore.getState().applyUnoCaught(0)
    const s = gameStore.getState()
    // Seat 0 took the penalty, so nobody else may catch it. Seat 1 still owes
    // the table a declaration and is promoted to the offered catch.
    expect(s.catchWindows.map((w) => w.seat)).toEqual([1])
    expect(s.catchTarget).toBe(1)
    expect(s.catchFlash?.seat).toBe(0)

    gameStore.getState().clearCatchFlash()
    expect(gameStore.getState().catchFlash).toBeNull()
  })

  it('applyCatchFailed names the seat that paid, clearCatchFailed retires it', () => {
    gameStore.getState().applyCatchFailed(2)
    expect(gameStore.getState().catchFailed?.seat).toBe(2)
    gameStore.getState().clearCatchFailed()
    expect(gameStore.getState().catchFailed).toBeNull()
  })

  it('pruneCatchWindows drops only the expired ones', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 3,
      catchWindows: [
        { seat: 0, endsAt: now - 10 },
        { seat: 1, endsAt: now + 4000 },
      ],
      catchTarget: 0,
      unoTimerEnd: now - 10,
    })
    gameStore.getState().pruneCatchWindows()
    const s = gameStore.getState()
    expect(s.catchWindows.map((w) => w.seat)).toEqual([1])
    expect(s.catchTarget).toBe(1)
  })

  // A Swap is followed by a personalised game_state. Wiping the catch windows
  // there made the very rule they exist for unreachable: the player handed
  // their last card was catchable for the few milliseconds before the snapshot
  // landed, and then nobody could touch them.
  it('applyGameState keeps a live catch window whose seat still holds one card', () => {
    const now = Date.now()
    gameStore.setState({
      myIndex: 2,
      catchWindows: [
        { seat: 0, endsAt: now + 4000 },
        { seat: 1, endsAt: now + 4000 },
      ],
    })
    const dto: GameStateDTO = {
      your_index: 2,
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 3, connected: true },
        { index: 1, nickname: 'bob', hand_size: 1, connected: true },
        { index: 2, nickname: 'carol', hand_size: 1, connected: true },
      ],
      discard: { color: 'red', kind: 'swap' },
      active_color: 'red',
      turn: 1,
      direction: 1,
      round_number: 1,
      match_format: 'BO1',
      max_players: 10,
    }
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    // Alice picked up cards in the rearrangement, so her window is gone; Bob is
    // still sitting on one uncalled card.
    expect(s.catchWindows.map((w) => w.seat)).toEqual([1])
    expect(s.catchTarget).toBe(1)
  })

  it('applyGameState clears catch windows on a fresh deal', () => {
    const now = Date.now()
    gameStore.setState({ myIndex: 0, catchWindows: [{ seat: 1, endsAt: now + 4000 }] })
    const dto: GameStateDTO = {
      your_index: 0,
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      players: [
        { index: 0, nickname: 'alice', hand_size: 8, connected: true },
        { index: 1, nickname: 'bob', hand_size: 8, connected: true },
      ],
      discard: { color: 'red', kind: 'number', value: 3 },
      active_color: 'red',
      turn: 0,
      direction: 1,
      round_number: 2,
      match_format: 'BO3',
      max_players: 10,
    }
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.catchWindows).toEqual([])
    expect(s.catchTarget).toBeNull()
  })

  // ──────────────────────────────────────────────────────────────
  // Pending draw accumulation
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed propagates pendingDraw from server', () => {
    gameStore.setState({
      pendingDraw: 0,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Alice plays DrawTwo — server reports pendingDraw=2
    const card: CardDTO = { color: 'red', kind: 'draw_two' }
    gameStore.getState().applyCardPlayed(0, card, 1, 2, undefined)
    expect(gameStore.getState().pendingDraw).toBe(2)
  })

  it('applyCardPlayed stacks pendingDraw when counter played (DrawTwo on +2)', () => {
    gameStore.setState({
      pendingDraw: 2,
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    // Bob counters with another DrawTwo — server reports pendingDraw=4
    const card: CardDTO = { color: 'blue', kind: 'draw_two' }
    gameStore.getState().applyCardPlayed(1, card, 0, 4, undefined)
    expect(gameStore.getState().pendingDraw).toBe(4)
  })

  it('applyCardPlayed adopts server-provided player list (e.g. on round end)', () => {
    gameStore.setState({
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
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined, serverPlayers)
    const s = gameStore.getState()
    expect(s.players[0].hand_size).toBe(0)
    expect(s.players[1].hand_size).toBe(5)
  })

  it('applyCardPlayed falls back to local hand-size decrement when no server player list', () => {
    gameStore.setState({
      players: [
        { index: 0, nickname: 'alice', hand_size: 5, connected: true },
        { index: 1, nickname: 'bob', hand_size: 5, connected: true },
      ],
    })
    const card: CardDTO = { color: 'red', kind: 'number', value: 2 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(gameStore.getState().players[0].hand_size).toBe(4)
    expect(gameStore.getState().players[1].hand_size).toBe(5)
  })

  // ──────────────────────────────────────────────────────────────
  // Interrupt / speed-play scenario
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed handles interrupt play (out-of-turn player plays)', () => {
    // Bob (index 1) plays out of turn interrupting while it is alice's (0) turn.
    // The server resolves the interrupt and reports currentTurn has shifted.
    gameStore.setState({
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
    gameStore.getState().applyCardPlayed(1, card, 0, 0, undefined)
    const s = gameStore.getState()
    expect(s.discard).toEqual(card)
    expect(s.currentTurn).toBe(0)
    expect(s.players[1].hand_size).toBe(2) // bob's local hand reduced
  })

  // ──────────────────────────────────────────────────────────────
  // Swap / GlobalSwitch notice surfacing
  // ──────────────────────────────────────────────────────────────

  it('applyCardPlayed sets swapNotice with target index when a Swap card resolves', () => {
    gameStore.setState({
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
    gameStore.getState().applyCardPlayed(0, card, 1, 0, 'red', undefined, 1)
    const n = gameStore.getState().swapNotice
    expect(n).not.toBeNull()
    expect(n?.kind).toBe('swap')
    expect(n?.actorIndex).toBe(0)
    expect(n?.targetIndex).toBe(1)
  })

  it('applyCardPlayed sets swapNotice with kind=global_switch and direction', () => {
    gameStore.setState({
      myIndex: 1,
      currentTurn: 0,
      direction: -1,
      swapNotice: null,
    })
    const card: CardDTO = { color: 'wild', kind: 'global_switch' }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, 'blue')
    const n = gameStore.getState().swapNotice
    expect(n?.kind).toBe('global_switch')
    expect(n?.actorIndex).toBe(0)
    expect(n?.targetIndex).toBe(-1)
    expect(n?.direction).toBe(-1)
  })

  it('applyCardPlayed does not set swapNotice for ordinary cards', () => {
    gameStore.setState({ swapNotice: null })
    const card: CardDTO = { color: 'red', kind: 'number', value: 7 }
    gameStore.getState().applyCardPlayed(0, card, 1, 0, undefined)
    expect(gameStore.getState().swapNotice).toBeNull()
  })

  // ──────────────────────────────────────────────────────────────
  // Hand replacement (Swap / GlobalSwitch via applyGameState)
  // ──────────────────────────────────────────────────────────────

  it('applyGameState replaces hand completely (models Swap/GlobalSwitch effect)', () => {
    // Before: player has old hand
    gameStore.setState({
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
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.myHand).toHaveLength(2)
    expect(s.myHand[0]).toEqual({ color: 'wild', kind: 'wild' })
    expect(s.myHand[1]).toEqual({ color: 'red', kind: 'skip' })
    expect(s.players.map((p) => p.nickname)).toEqual(['alice', 'bob'])
  })

  it('applyGameState refreshes players on reconnect-style full state', () => {
    gameStore.setState({
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
    gameStore.getState().applyGameState(dto)
    const s = gameStore.getState()
    expect(s.players).toHaveLength(3)
    expect(s.players.find((p) => p.index === 0)?.connected).toBe(true)
    expect(s.currentTurn).toBe(2)
  })

  // The score table is fed by the server: the client never accumulates its own
  // history, so a reconnect and a mid-match join show the same rounds.
  it('takes the round history from round_end without waiting for the next state', () => {
    gameStore.setState({ scoreboard: [], roundHistory: [] })
    gameStore.getState().applyRoundEnd(
      'alice',
      1,
      [
        { player_index: 0, nickname: 'alice', score: 30, rounds_won: 1 },
        { player_index: 1, nickname: 'bob', score: 0, rounds_won: 0 },
      ],
      [[30, 0]],
    )
    expect(gameStore.getState().roundHistory).toEqual([[30, 0]])
  })

  it('keeps the previous history when round_end omits it', () => {
    gameStore.setState({ roundHistory: [[30, 0]] })
    gameStore.getState().applyRoundEnd('bob', 2, [])
    expect(gameStore.getState().roundHistory).toEqual([[30, 0]])
  })

  it('replaces the whole latency snapshot on every broadcast', () => {
    gameStore.getState().applyLatencies([{ player_index: 0, rtt_ms: 40 }])
    gameStore.getState().applyLatencies([{ player_index: 1, rtt_ms: -1, bot: true }])
    expect(gameStore.getState().latencies).toEqual([
      { player_index: 1, rtt_ms: -1, bot: true },
    ])
  })
})

// The roster's count of our own hand moves with the hand: the fallback paths
// in applyCardPlayed index on it, and a stale-low count removed two copies of
// a card for one play.
describe('applyCardDrawn keeps our own roster count honest', () => {
  it('raises hand_size for our seat when the cards arrive', () => {
    gameStore.setState({
      myIndex: 0,
      myHand: [{ color: 'red', kind: 'number', value: 1 }],
      players: [
        { index: 0, nickname: 'Nova', hand_size: 1, connected: true },
        { index: 1, nickname: 'Kiwi', hand_size: 7, connected: true },
      ],
    })
    gameStore.getState().applyCardDrawn(
      [
        { color: 'blue', kind: 'number', value: 2 },
        { color: 'blue', kind: 'number', value: 3 },
      ],
      0,
      0,
      true,
      undefined,
      0,
    )
    const s = gameStore.getState()
    expect(s.myHand).toHaveLength(3)
    expect(s.players.find((p) => p.index === 0)?.hand_size).toBe(3)
  })
})

// A snapshot says who is on the hook and who has called, so a reload two
// seconds into a window lands on a board where that window is still open and
// a spent LOCO! button stays spent.
describe('applyGameState takes the catch state off the snapshot', () => {
  const base = {
    your_index: 0,
    hand: [{ color: 'red', kind: 'number', value: 1 }] as const,
    players: [
      { index: 0, nickname: 'Nova', hand_size: 1, connected: true },
      { index: 1, nickname: 'Kiwi', hand_size: 1, connected: true },
    ],
    discard: { color: 'red', kind: 'number', value: 5 } as const,
    active_color: 'red' as const,
    turn: 0,
    direction: 1,
    round_number: 1,
    match_format: 'BO1' as const,
    max_players: 2,
  }

  it('opens the windows the server names', () => {
    const endsAt = Date.now() + 3000
    gameStore.setState({ myIndex: 0, catchWindows: [], declaredSeats: [] })
    gameStore.getState().applyGameState({
      ...base,
      hand: [...base.hand],
      catch_seats: [{ player_index: 1, ends_at: endsAt }],
      declared_seats: [0],
    })
    const s = gameStore.getState()
    expect(s.catchWindows).toEqual([{ seat: 1, endsAt, attempted: undefined }])
    expect(s.catchTarget).toBe(1)
    expect(s.declaredSeats).toEqual([0])
    expect(s.myDeclared).toBe(true)
  })

  it('keeps a call already spent on the same window', () => {
    const endsAt = Date.now() + 3000
    gameStore.setState({ myIndex: 0, catchWindows: [{ seat: 1, endsAt, attempted: true }] })
    gameStore.getState().applyGameState({
      ...base,
      hand: [...base.hand],
      catch_seats: [{ player_index: 1, ends_at: endsAt }],
    })
    expect(gameStore.getState().catchWindows[0]?.attempted).toBe(true)
  })
})
