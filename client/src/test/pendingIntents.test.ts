import { describe, it, expect } from 'vitest'
import { keepPendingIntent, PENDING_INTENT_MAX_AGE_MS } from '../hooks/webSocketPolicy'

// A message queued while the socket was down is flushed when it comes back.
// The backoff never gives up, so "back" can be a minute later against a board
// that has moved on: a gameplay intent that old is not the player's choice
// any more, while a table to join or a search to enter ages fine.
describe('keepPendingIntent', () => {
  it('keeps a fresh gameplay intent', () => {
    expect(keepPendingIntent('play_card', 1000, 1000 + PENDING_INTENT_MAX_AGE_MS)).toBe(true)
  })

  it('drops a gameplay intent aimed at a board that is gone', () => {
    for (const type of ['play_card', 'draw_card', 'pass_turn', 'catch_uno', 'declare_uno', 'counter_draw', 'interrupt_play_card']) {
      expect(keepPendingIntent(type, 1000, 1000 + PENDING_INTENT_MAX_AGE_MS + 1), type).toBe(false)
    }
  })

  it('keeps everything that is not a play, however old', () => {
    for (const type of ['join_room', 'create_room', 'find_match', 'reconnect', 'rematch', 'leave_room']) {
      expect(keepPendingIntent(type, 0, 10 * 60 * 1000), type).toBe(true)
    }
  })
})
