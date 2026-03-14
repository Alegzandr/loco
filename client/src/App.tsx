import React, { useCallback } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useGameStore } from './hooks/useGameStore'
import { Lobby } from './components/Lobby'
import { WaitingRoom } from './components/WaitingRoom'
import { GameView } from './components/GameView'
import { GameOver } from './components/GameOver'
import { ServerMsg, ClientMsg } from './types/protocol'

export default function App() {
  const store = useGameStore()

  const handleMessage = useCallback(
    (msg: ServerMsg) => {
      switch (msg.type) {
        case 'room_created':
          store.setRoomCode(msg.room_code ?? '')
          store.setMyIndex(msg.player_id ?? 0)
          store.setSessionToken(msg.session_token ?? '')
          store.setPlayers(msg.players ?? [])
          store.setScreen('waiting')
          break

        case 'room_joined':
          store.setRoomCode(msg.room_code ?? '')
          store.setMyIndex(msg.player_id ?? 0)
          store.setSessionToken(msg.session_token ?? '')
          store.setPlayers(msg.players ?? [])
          store.setScreen('waiting')
          break

        case 'player_joined':
        case 'player_left':
        case 'player_disconnected':
          store.setPlayers(msg.players ?? [])
          break

        case 'player_reconnected':
          store.setPlayers(msg.players ?? [])
          // If this message carries game state, this client is the one reconnecting.
          if (msg.state) {
            store.applyGameState(msg.state)
            store.setRoomCode(msg.room_code ?? store.roomCode)
            store.setMyIndex(msg.player_id ?? store.myIndex)
            store.setScreen('game')
          }
          break

        case 'game_started':
          if (msg.state) {
            store.applyGameState(msg.state)
            store.setScreen('game')
          }
          break

        case 'card_played':
          if (msg.card) {
            store.applyCardPlayed(
              msg.player_index ?? 0,
              msg.card,
              msg.turn ?? 0,
              msg.pending_draw ?? 0
            )
          }
          break

        case 'card_drawn':
          store.applyCardDrawn(
            msg.card ?? null, // null when it's another player drawing
            msg.player_index ?? 0,
            msg.turn ?? 0
          )
          break

        case 'turn_changed':
          // handled by card_played/card_drawn; this covers pass_turn
          useGameStore.setState({ currentTurn: msg.turn ?? 0 })
          break

        case 'uno_declared':
          store.setUnoDeclared(true)
          store.setUnoTimerEnd(Date.now() + 5000) // 5-second catch window matches server
          setTimeout(() => {
            store.setUnoDeclared(false)
            store.setUnoTimerEnd(null)
          }, 5000)
          break

        case 'uno_caught':
          // No special client handling needed beyond hand size update via game state
          break

        case 'game_over':
          store.setWinner(msg.winner ?? '')
          break

        case 'error':
          store.setError(msg.error ?? 'Unknown error')
          break
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // On WebSocket reconnect during an active game, re-authenticate with the session token.
  const getReconnectMsg = useCallback(() => {
    const s = useGameStore.getState()
    if (s.screen === 'game' && s.roomCode && s.sessionToken) {
      const nickname = s.players.find((p) => p.index === s.myIndex)?.nickname ?? ''
      return { type: 'join_room' as const, nickname, room_code: s.roomCode, session_token: s.sessionToken }
    }
    return null
  }, [])

  const { send } = useWebSocket(handleMessage, getReconnectMsg)

  const handleSend = useCallback(
    (msg: ClientMsg) => {
      store.clearError()
      send(msg)
    },
    [send, store]
  )

  const myNickname =
    store.players.find((p) => p.index === store.myIndex)?.nickname ?? ''

  return (
    <>
      {store.screen === 'lobby' && (
        <Lobby onSend={handleSend} error={store.errorMsg} onClearError={store.clearError} />
      )}
      {store.screen === 'waiting' && (
        <WaitingRoom
          roomCode={store.roomCode}
          players={store.players}
          myIndex={store.myIndex}
          onSend={handleSend}
        />
      )}
      {store.screen === 'game' && <GameView onSend={handleSend} />}
      {store.screen === 'gameover' && (
        <GameOver winner={store.winner} myNickname={myNickname} />
      )}
    </>
  )
}
