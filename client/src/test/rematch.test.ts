import { describe, it, expect, beforeEach } from 'vitest'
import * as v from 'valibot'
import { gameStore } from '../hooks/gameStore'
import { PlayerDTO } from '../types/protocol'
import { serverMsgSchema } from '../types/protocolSchemas'

const players: PlayerDTO[] = [
  { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
  { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
]

// Puts the store in the state a client is left in right after a match ends.
function seedFinishedMatch() {
  gameStore.setState({
    screen: 'gameover',
    roomCode: 'ABC123',
    myIndex: 1,
    myHand: [{ color: 'red', kind: 'number', value: 5 }],
    players,
    discard: { color: 'blue', kind: 'skip' },
    activeColor: 'blue',
    currentTurn: 1,
    pendingDraw: 4,
    hasDrawn: true,
    matchWinner: 'Alice',
    matchOver: true,
    scoreboard: [
      { player_index: 0, nickname: 'Alice', score: 42, rounds_won: 1 },
      { player_index: 1, nickname: 'Bob', score: 0, rounds_won: 0 },
    ],
    roundNumber: 3,
    roundWinner: 'Alice',
    roundScores: [{ player_index: 0, nickname: 'Alice', round_points: 42, cumulative_score: 42, rounds_won: 1 }],
    showRoundSummary: true,
    unoDeclared: true,
    unoTimerEnd: Date.now() + 5000,
    turnDeadline: Date.now() + 20000,
    errorMsg: 'stale',
  })
}

beforeEach(seedFinishedMatch)

describe('applyRematch', () => {
  it('returns the player to the waiting room of the same room', () => {
    gameStore.getState().applyRematch(1, players, 'BO3', 6)
    const s = gameStore.getState()
    expect(s.screen).toBe('waiting')
    expect(s.roomCode).toBe('ABC123')
    expect(s.players).toEqual(players)
    expect(s.matchFormat).toBe('BO3')
    expect(s.maxPlayers).toBe(6)
  })

  it('adopts the server-assigned index, which may shift when seats are pruned', () => {
    gameStore.getState().applyRematch(0, [players[0]], 'BO1', 10)
    expect(gameStore.getState().myIndex).toBe(0)
  })

  it('clears every trace of the finished match', () => {
    gameStore.getState().applyRematch(1, players, 'BO1', 10)
    const s = gameStore.getState()
    expect(s.matchOver).toBe(false)
    expect(s.matchWinner).toBe('')
    expect(s.scoreboard).toEqual([])
    expect(s.roundWinner).toBe('')
    expect(s.roundScores).toEqual([])
    expect(s.showRoundSummary).toBe(false)
    expect(s.roundNumber).toBe(1)
    expect(s.myHand).toEqual([])
    expect(s.discard).toBeNull()
    expect(s.pendingDraw).toBe(0)
    expect(s.hasDrawn).toBe(false)
    expect(s.unoDeclared).toBe(false)
    expect(s.unoTimerEnd).toBeNull()
    expect(s.turnDeadline).toBeNull()
    expect(s.errorMsg).toBe('')
  })

  it('keeps the session token so a drop during the new match can still reclaim the slot', () => {
    gameStore.setState({ sessionToken: 'deadbeef' })
    gameStore.getState().applyRematch(1, players, 'BO1', 10)
    expect(gameStore.getState().sessionToken).toBe('deadbeef')
  })
})

describe('rematch_started wire message', () => {
  it('validates against the inbound schema', () => {
    const parsed = v.safeParse(serverMsgSchema, {
      type: 'rematch_started',
      room_code: 'ABC123',
      player_id: 1,
      players,
      match_format: 'BO3',
      max_players: 6,
    })
    expect(parsed.success).toBe(true)
  })
})

describe('rematch offers', () => {
  it('validates the wire message it arrives on', () => {
    const parsed = v.safeParse(serverMsgSchema, {
      type: 'rematch_offered',
      player_index: 1,
      rematch_offers: [0, 1],
      rematch_needed: 3,
    })
    expect(parsed.success).toBe(true)
  })

  // The server sends the whole state, never the increment: a seat leaving
  // retires its ask and re-bases the ones above it, so a client that added
  // names one at a time would keep a departed player's ask forever and wait on
  // a count that can never complete.
  it('stores the offers as sent rather than accumulating them', () => {
    const store = gameStore.getState()
    store.applyRematchOffers([0, 1], 3)
    expect(gameStore.getState().rematchOffers).toEqual([0, 1])
    expect(gameStore.getState().rematchNeeded).toBe(3)

    // Seat 0 left: seat 1's ask moved down to 0, and the table is smaller.
    store.applyRematchOffers([0], 2)
    expect(gameStore.getState().rematchOffers).toEqual([0])
    expect(gameStore.getState().rematchNeeded).toBe(2)
  })

  it('clears the count with the offers, so no stale x/y survives', () => {
    const store = gameStore.getState()
    store.applyRematchOffers([0], 2)
    store.clearRematchOffers()
    expect(gameStore.getState().rematchOffers).toEqual([])
    expect(gameStore.getState().rematchNeeded).toBe(0)
  })
})

describe('seat re-indexing after someone leaves', () => {
  it('follows our own nickname so a promoted player gains host controls', () => {
    gameStore.setState({
      myIndex: 1,
      players: [
        { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
        { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
      ],
    })
    // Alice (the host) leaves; the server re-bases Bob to seat 0.
    gameStore.getState().setPlayers([{ index: 0, nickname: 'Bob', hand_size: 0, connected: true }])
    expect(gameStore.getState().myIndex).toBe(0)
  })

  it('leaves myIndex alone when we are not in the new roster', () => {
    gameStore.setState({
      myIndex: 1,
      players: [
        { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
        { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
      ],
    })
    gameStore.getState().setPlayers([{ index: 0, nickname: 'Alice', hand_size: 0, connected: true }])
    expect(gameStore.getState().myIndex).toBe(1)
  })

  it('keeps our index when the roster grows below us', () => {
    gameStore.setState({
      myIndex: 0,
      players: [{ index: 0, nickname: 'Alice', hand_size: 0, connected: true }],
    })
    gameStore.getState().setPlayers([
      { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
      { index: 1, nickname: 'Bob', hand_size: 0, connected: true },
    ])
    expect(gameStore.getState().myIndex).toBe(0)
  })
})
