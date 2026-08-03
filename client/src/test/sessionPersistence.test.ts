import { describe, it, expect, beforeEach } from 'vitest'
import {
  SESSION_KEY,
  SESSION_TTL_MS,
  readSession,
  writeSession,
  touchSession,
  clearSession,
  reconnectMessageFor,
  type ReconnectContext,
} from '../hooks/sessionPersistence'
import { gameStore } from '../hooks/gameStore'

const NOW = 1_700_000_000_000

function ctx(over: Partial<ReconnectContext> = {}): ReconnectContext {
  return {
    screen: 'game',
    restoreTarget: null,
    roomCode: 'ABC123',
    sessionToken: 'deadbeef',
    myIndex: 1,
    myNickname: 'Bob',
    isMatchmade: false,
    players: [
      { index: 0, nickname: 'Alice' },
      { index: 1, nickname: 'Bob' },
    ],
    ...over,
  }
}

describe('sessionPersistence storage', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
  })

  it('round-trips a session', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' }, NOW)
    expect(readSession(NOW)).toEqual({
      roomCode: 'ABC123',
      nickname: 'Bob',
      sessionToken: 'tok',
      target: 'game',
      at: NOW,
    })
  })

  it('returns null when nothing is stored', () => {
    expect(readSession(NOW)).toBeNull()
  })

  it('drops and clears a record older than the TTL', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' }, NOW)
    expect(readSession(NOW + SESSION_TTL_MS + 1)).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('keeps a record right up to the TTL', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' }, NOW)
    expect(readSession(NOW + SESSION_TTL_MS)).not.toBeNull()
  })

  // The persisted fields are written once, at join time. Without a re-stamp on
  // the way out, a long match would age its own record past the TTL and the
  // reload it exists for would be refused before it reached the server.
  it('touchSession re-stamps without changing the payload', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' }, NOW)
    touchSession(NOW + SESSION_TTL_MS - 1)
    const s = readSession(NOW + SESSION_TTL_MS)
    expect(s?.roomCode).toBe('ABC123')
    expect(s?.sessionToken).toBe('tok')
    expect(s?.at).toBe(NOW + SESSION_TTL_MS - 1)
  })

  it('discards a malformed record instead of throwing', () => {
    window.sessionStorage.setItem(SESSION_KEY, '{not json')
    expect(readSession(NOW)).toBeNull()
    expect(window.sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('discards a record missing a field, or with an unknown target', () => {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomCode: 'ABC123', at: NOW, target: 'game' }))
    expect(readSession(NOW)).toBeNull()

    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 't', target: 'gameover', at: NOW }),
    )
    expect(readSession(NOW)).toBeNull()
  })

  // A game seat is reclaimed by token. A tokenless record would send a rejoin
  // the server can only refuse, which is a reconnect screen for nothing.
  it('discards a game record with no token', () => {
    window.sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: '', target: 'game', at: NOW }),
    )
    expect(readSession(NOW)).toBeNull()
  })

  it('clearSession removes the record', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'waiting' }, NOW)
    clearSession()
    expect(readSession(NOW)).toBeNull()
  })
})

describe('reconnectMessageFor', () => {
  it('sends a token-authenticated join from an active game', () => {
    expect(reconnectMessageFor(ctx())).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'deadbeef',
    })
  })

  it('sends a plain join from the waiting room', () => {
    expect(reconnectMessageFor(ctx({ screen: 'waiting' }))).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
    })
  })

  // The whole point of a reload: the store is empty, so the nickname can only
  // come from the persisted record.
  it('uses the persisted nickname when the player list is empty', () => {
    expect(
      reconnectMessageFor(ctx({ screen: 'restoring', restoreTarget: 'game', players: [], myIndex: -1 })),
    ).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'deadbeef',
    })
  })

  it('restores into the waiting room without a token', () => {
    expect(
      reconnectMessageFor(ctx({ screen: 'restoring', restoreTarget: 'waiting', players: [], sessionToken: '' })),
    ).toEqual({ type: 'join_room', nickname: 'Bob', room_code: 'ABC123' })
  })

  // The versus reveal is a real seat with a real token, two seconds from a
  // deal. Saying nothing there left a player watching a screen that was never
  // going to resolve.
  it('reclaims the seat from the versus reveal', () => {
    expect(reconnectMessageFor(ctx({ screen: 'matchfound' }))).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'deadbeef',
    })
  })

  // There is no seat to reclaim while searching: the server drops a queued
  // socket when it goes, so the ask has to be made again. A screen that goes on
  // timing a wait in a queue nobody is in is the one thing searchStages forbids.
  it('asks again from the searching screen', () => {
    expect(reconnectMessageFor(ctx({ screen: 'searching', roomCode: '' }))).toEqual({
      type: 'find_match',
      nickname: 'Bob',
    })
  })

  // The match is over and the rematch is not: the server holds that seat, so it
  // is reclaimed like any other.
  it('reclaims the seat from an ordinary game-over screen', () => {
    expect(reconnectMessageFor(ctx({ screen: 'gameover' }))).toEqual({
      type: 'join_room',
      nickname: 'Bob',
      room_code: 'ABC123',
      session_token: 'deadbeef',
    })
  })

  it('sends nothing from the lobby, from a matchmade game over, or with no room', () => {
    expect(reconnectMessageFor(ctx({ screen: 'lobby' }))).toBeNull()
    // Two strangers are done with each other: the seat is released outright and
    // the client goes back to the queue rather than reclaiming a table that is
    // over. See hub.disconnectAtTable.
    expect(reconnectMessageFor(ctx({ screen: 'gameover', isMatchmade: true }))).toBeNull()
    expect(reconnectMessageFor(ctx({ roomCode: '' }))).toBeNull()
    expect(reconnectMessageFor(ctx({ screen: 'restoring', restoreTarget: null }))).toBeNull()
  })

  it('sends nothing for a game with no token or no nickname', () => {
    expect(reconnectMessageFor(ctx({ sessionToken: '' }))).toBeNull()
    expect(reconnectMessageFor(ctx({ players: [], myNickname: '' }))).toBeNull()
  })
})

describe('store restore actions', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    gameStore.setState({
      screen: 'lobby',
      roomCode: '',
      sessionToken: '',
      myNickname: '',
      myIndex: -1,
      restoreTarget: null,
      errorMsg: '',
    })
  })

  it('beginRestore seats the tab on the restoring screen with the persisted identity', () => {
    gameStore.getState().beginRestore({
      roomCode: 'ABC123',
      nickname: 'Bob',
      sessionToken: 'tok',
      target: 'game',
      at: NOW,
    })
    const s = gameStore.getState()
    expect(s.screen).toBe('restoring')
    expect(s.restoreTarget).toBe('game')
    expect(s.roomCode).toBe('ABC123')
    expect(s.myNickname).toBe('Bob')
    expect(s.sessionToken).toBe('tok')
  })

  // A restore that cannot land must not strand the player on a spinner, and it
  // must not leave a record behind that retries the same refusal on every load.
  it('abortRestore drops the record and returns to the lobby', () => {
    writeSession({ roomCode: 'ABC123', nickname: 'Bob', sessionToken: 'tok', target: 'game' }, NOW)
    gameStore.getState().beginRestore(readSession(NOW)!)
    gameStore.getState().abortRestore('room not found')

    const s = gameStore.getState()
    expect(s.screen).toBe('lobby')
    expect(s.restoreTarget).toBeNull()
    expect(s.sessionToken).toBe('')
    expect(s.roomCode).toBe('')
    expect(s.errorMsg).toBe('room not found')
    expect(readSession(NOW)).toBeNull()
  })

  it('abortRestore does nothing once the restore has landed', () => {
    gameStore.setState({ screen: 'game', restoreTarget: null, roomCode: 'ABC123', sessionToken: 'tok' })
    gameStore.getState().abortRestore('too late')
    const s = gameStore.getState()
    expect(s.screen).toBe('game')
    expect(s.sessionToken).toBe('tok')
    expect(s.errorMsg).toBe('')
  })
})
