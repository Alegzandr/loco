import { useCallback, useEffect, useRef } from 'react'
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
          if (msg.match_format && msg.max_players) {
            store.setLobbyConfig(msg.match_format, msg.max_players)
          }
          store.setScreen('waiting')
          break

        case 'room_joined':
          store.setRoomCode(msg.room_code ?? '')
          store.setMyIndex(msg.player_id ?? 0)
          store.setSessionToken(msg.session_token ?? '')
          store.setPlayers(msg.players ?? [])
          if (msg.match_format && msg.max_players) {
            store.setLobbyConfig(msg.match_format, msg.max_players)
          }
          store.setScreen('waiting')
          break

        case 'lobby_config_changed':
          if (msg.match_format && msg.max_players) {
            store.setLobbyConfig(msg.match_format, msg.max_players)
          }
          break

        case 'player_joined':
        case 'player_left':
        case 'player_disconnected':
          store.setPlayers(msg.players ?? [])
          break

        case 'player_reconnected':
          store.setPlayers(msg.players ?? [])
          if (msg.state) {
            // Mark reconnecting before applying state so GameView can animate recovery
            store.setIsReconnecting(true)
            store.applyGameState(msg.state)
            store.setRoomCode(msg.room_code ?? store.roomCode)
            store.setMyIndex(msg.player_id ?? store.myIndex)
            store.setScreen('game')
          }
          break

        case 'game_started': {
          if (msg.state) {
            const s = useGameStore.getState()
            if (s.showRoundSummary) {
              // Round summary is visible — buffer the new state; apply when player dismisses
              store.setPendingGameState(msg.state)
            } else {
              store.applyGameState(msg.state)
              store.setScreen('game')
            }
          }
          break
        }

        case 'game_state':
          // Mid-game state refresh (e.g. after Swap or GlobalSwitch)
          if (msg.state) {
            useGameStore.setState({ myHand: msg.state.hand, players: msg.state.players })
          }
          break

        case 'card_played':
          if (msg.card) {
            store.applyCardPlayed(
              msg.player_index ?? 0,
              msg.card,
              msg.turn ?? 0,
              msg.pending_draw ?? 0,
              msg.active_color,
              msg.players
            )
            store.setTurnDeadline(msg.turn_deadline ?? null)
          }
          break

        case 'card_drawn':
          store.applyCardDrawn(
            msg.cards?.length ? msg.cards : (msg.card ? [msg.card] : null),
            msg.player_index ?? 0,
            msg.turn ?? 0,
            msg.has_drawn,
            msg.drawn_count
          )
          store.setTurnDeadline(msg.turn_deadline ?? null)
          break

        case 'turn_changed':
          useGameStore.setState({ currentTurn: msg.turn ?? 0, hasDrawn: false, turnDeadline: msg.turn_deadline ?? null })
          break

        case 'uno_declared':
          store.setUnoDeclared(true)
          store.setUnoDeclaredByIndex(msg.player_index ?? -1)
          store.setUnoTimerEnd(Date.now() + 5000)
          setTimeout(() => {
            store.setUnoDeclared(false)
            store.setUnoDeclaredByIndex(-1)
            store.setUnoTimerEnd(null)
          }, 5000)
          break

        case 'uno_caught':
          break

        case 'round_end':
          store.applyRoundEnd(
            msg.round_winner ?? '',
            msg.round_number ?? 0,
            msg.scoreboard ?? []
          )
          break

        case 'match_end': {
          const s = useGameStore.getState()
          if (s.showRoundSummary) {
            // Final round summary is still visible — buffer the match-end payload so
            // the player sees the full round breakdown before the game over screen.
            store.setPendingMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [])
          } else {
            store.applyMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [])
          }
          break
        }

        case 'game_over':
          // Legacy / BO1 fallback
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

  // Keep a stable ref so the E2E helper always dispatches through the latest send.
  const sendRef = useRef(handleSend)
  sendRef.current = handleSend

  // Expose lightweight E2E helpers on window in dev mode only.
  // Vite tree-shakes this block in production builds (import.meta.env.DEV = false).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__LOCO_E2E__ = {
      ...(window.__LOCO_E2E__ ?? {}),
      send: (msg: ClientMsg) => sendRef.current(msg),
      getState: useGameStore.getState,
    }
  }, [])

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
          matchFormat={store.matchFormat}
          maxPlayers={store.maxPlayers}
          onSend={handleSend}
        />
      )}
      {store.screen === 'game' && <GameView onSend={handleSend} />}
      {store.screen === 'gameover' && (
        <GameOver
          winner={store.matchOver ? store.matchWinner : store.winner}
          myNickname={myNickname}
          scoreboard={store.scoreboard}
          matchOver={store.matchOver}
        />
      )}
    </>
  )
}
