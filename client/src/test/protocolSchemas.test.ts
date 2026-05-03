import { describe, it, expect } from 'vitest'
import { serverMsgSchema, gameStateSchema, cardSchema } from '../types/protocolSchemas'

const sampleCard = { color: 'red' as const, kind: 'number' as const, value: 7 }

const sampleGameState = {
  your_index: 0,
  hand: [sampleCard],
  players: [{ index: 0, nickname: 'A', hand_size: 7, connected: true }],
  discard: sampleCard,
  active_color: 'red' as const,
  turn: 0,
  direction: 1,
  round_number: 1,
  match_format: 'BO1' as const,
  max_players: 4,
}

describe('serverMsgSchema', () => {
  it('accepts a minimal error message', () => {
    expect(serverMsgSchema.safeParse({ type: 'error', error: 'nope' }).success).toBe(true)
  })

  it('accepts a game_started message with full state', () => {
    const r = serverMsgSchema.safeParse({ type: 'game_started', state: sampleGameState })
    expect(r.success).toBe(true)
  })

  it('accepts a card_played with direction + chosen_player', () => {
    const r = serverMsgSchema.safeParse({
      type: 'card_played',
      player_index: 1,
      card: { color: 'wild', kind: 'swap' },
      direction: -1,
      chosen_player: 2,
      turn: 2,
    })
    expect(r.success).toBe(true)
  })

  it('rejects unknown ServerMsg type (drift detector)', () => {
    expect(serverMsgSchema.safeParse({ type: 'wat' }).success).toBe(false)
  })

  it('rejects unknown card kind (drift detector)', () => {
    expect(cardSchema.safeParse({ color: 'red', kind: 'turbo' }).success).toBe(false)
  })

  it('rejects game_state missing required fields', () => {
    const { round_number: _omit, ...broken } = sampleGameState
    expect(gameStateSchema.safeParse(broken).success).toBe(false)
  })
})
