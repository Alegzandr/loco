import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  CLOCK_SAMPLES,
  localizeDeadlines,
  noteServerNow,
  resetServerClock,
  serverOffset,
  toLocalTime,
} from '../hooks/serverClock'
import { createServerMessageHandler } from '../hooks/serverMessages'
import { gameStore } from '../hooks/gameStore'
import type { ServerMsg } from '../types/protocol'

/**
 * Every deadline the server sends is on the server's clock, and every bar on
 * screen counts it down against ours. The difference used to be nobody's: a
 * device six seconds fast saw every catch window already shut, one six seconds
 * slow kept the capsule up past the server's window and paid a card for the
 * press it invited. The stamp on every message is what closes that, and this
 * pins both halves: the estimate, and every field it is applied to.
 */

beforeEach(() => resetServerClock())
afterEach(() => vi.useRealTimers())

describe('serverClock', () => {
  it('reads zero until the server has said anything', () => {
    expect(serverOffset()).toBe(0)
    expect(toLocalTime(1000)).toBe(1000)
  })

  it('takes the largest recent sample, which is the one with the least latency in it', () => {
    // Server clock 5000 ahead. Three arrivals: 40, 200 and 60 ms in flight.
    noteServerNow(10_000 + 5000, 10_000 + 40)
    noteServerNow(10_100 + 5000, 10_100 + 200)
    noteServerNow(10_200 + 5000, 10_200 + 60)
    expect(serverOffset()).toBe(5000 - 40)
  })

  it('follows a clock that steps once the old samples have aged out', () => {
    for (let i = 0; i < CLOCK_SAMPLES; i++) noteServerNow(1000 + i, i)
    expect(serverOffset()).toBe(1000)
    for (let i = 0; i < CLOCK_SAMPLES; i++) noteServerNow(200 + i, i)
    expect(serverOffset()).toBe(200)
  })

  it('ignores a message with no stamp', () => {
    noteServerNow(undefined, 5)
    noteServerNow(0, 5)
    expect(serverOffset()).toBe(0)
  })

  it('moves every deadline a message carries, and leaves an absent one absent', () => {
    // Local clock at 100_000; server at 106_000: six seconds fast.
    const msg: ServerMsg = {
      type: 'card_played',
      server_now: 106_000,
      turn: 0,
      turn_deadline: 106_000 + 30_000,
      forfeit_deadline: 106_000 + 15_000,
      catch_seats: [{ player_index: 1, ends_at: 106_000 + 5000 }],
      state: {
        your_index: 0,
        hand: [],
        players: [],
        discard: { color: 'red', kind: 'number', value: 5 },
        active_color: 'red',
        turn: 0,
        direction: 1,
        round_number: 1,
        match_format: 'BO1',
        max_players: 2,
        turn_deadline: 106_000 + 30_000,
        catch_seats: [{ player_index: 1, ends_at: 106_000 + 5000 }],
      },
    }
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const out = localizeDeadlines(msg)
    expect(out.turn_deadline).toBe(130_000)
    expect(out.forfeit_deadline).toBe(115_000)
    expect(out.catch_seats?.[0].ends_at).toBe(105_000)
    expect(out.state?.turn_deadline).toBe(130_000)
    expect(out.state?.catch_seats?.[0].ends_at).toBe(105_000)
    // The input is not written to: a message is data the socket handed over.
    expect(msg.turn_deadline).toBe(136_000)

    const bare = localizeDeadlines({ type: 'turn_changed', server_now: 106_000, turn: 1 })
    expect(bare.turn_deadline).toBeUndefined()
  })
})

describe('the message handler', () => {
  it('stores deadlines on our clock, so a fast device still sees the window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    gameStore.setState({ myIndex: 0, players: [], catchWindows: [], turnDeadline: null })
    const handle = createServerMessageHandler({ clear: () => {}, arm: () => {} })
    handle({
      type: 'card_played',
      server_now: 106_000,
      player_index: 1,
      card: { color: 'red', kind: 'number', value: 5 },
      turn: 0,
      turn_deadline: 136_000,
      catch_seats: [{ player_index: 1, ends_at: 111_000 }],
      players: [
        { index: 0, nickname: 'Me', hand_size: 3, connected: true },
        { index: 1, nickname: 'Them', hand_size: 1, connected: true },
      ],
    })
    const s = gameStore.getState()
    expect(s.turnDeadline).toBe(130_000)
    expect(s.catchWindows).toEqual([{ seat: 1, endsAt: 105_000, attempted: undefined }])
    // Read against Date.now() the way every bar does: still five seconds away.
    expect(s.unoTimerEnd! - Date.now()).toBe(5000)
  })
})
