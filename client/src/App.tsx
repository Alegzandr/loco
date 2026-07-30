import { useCallback, useEffect, useRef } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useGameStore, UNO_CATCH_WINDOW_MS } from './hooks/useGameStore'
import { useGameAudio } from './audio/useGameAudio'
import { Lobby } from './components/Lobby'
import { WaitingRoom } from './components/WaitingRoom'
import { GameView } from './components/GameView'
import { GameOver } from './components/GameOver'
import { ServerMsg, ClientMsg } from './types/protocol'

export default function App() {
  const store = useGameStore()

  // Single owner of every sound in the game: one store subscription, no
  // per-component audio calls. See audio/useGameAudio.ts.
  useGameAudio()

  // Tracks the in-flight UNO catch-window timer so a new declaration cancels
  // the old one. Without this, an earlier setTimeout fires later and clobbers
  // a fresh declaration's UNO state (e.g. across rapid back-to-back UNOs or
  // after a round transition).
  const unoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearUnoTimer = useCallback(() => {
    if (unoTimerRef.current !== null) {
      clearTimeout(unoTimerRef.current)
      unoTimerRef.current = null
    }
  }, [])

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
            // Read live state via getState() — handleMessage is created with
            // an empty deps array, so the destructured `store` snapshot is
            // frozen at first render and would lose any updates that happened
            // after mount (e.g. roomCode/myIndex from room_created arriving
            // before this branch fires).
            const live = useGameStore.getState()
            // Mark reconnecting before applying state so GameView can animate recovery
            clearUnoTimer()
            store.setIsReconnecting(true)
            store.applyGameState(msg.state)
            store.setRoomCode(msg.room_code ?? live.roomCode)
            store.setMyIndex(msg.player_id ?? live.myIndex)
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
              clearUnoTimer()
              store.applyGameState(msg.state)
              store.setScreen('game')
            }
          }
          break
        }

        case 'game_state':
          // Mid-game authoritative refresh (e.g. debug_set_state, swap/global_switch effects).
          // Apply the full state snapshot so discard/turn/pendingDraw remain in sync.
          if (msg.state) {
            clearUnoTimer()
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
              msg.pending_draw ?? 0,
              msg.active_color,
              msg.players,
              msg.chosen_player,
              msg.direction
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
            msg.drawn_count,
            msg.pending_draw
          )
          store.setTurnDeadline(msg.turn_deadline ?? null)
          break

        case 'turn_changed':
          useGameStore.setState({ currentTurn: msg.turn ?? 0, hasDrawn: false, turnDeadline: msg.turn_deadline ?? null })
          break

        // A declaration closes the catch window on the declarer: from here on the
        // server answers every catch with "player already declared". The banner
        // stays up on its own timer so the table still sees who called it.
        case 'uno_declared': {
          clearUnoTimer()
          const declarer = msg.player_index ?? -1
          // Only that seat is off the hook: after a Swap or a GlobalSwitch
          // somebody else may still owe a call. If it is ours, the call is now
          // spent and the button goes with it.
          store.applyUnoDeclared(declarer)
          unoTimerRef.current = setTimeout(() => {
            unoTimerRef.current = null
            store.setUnoDeclared(false)
            store.setUnoDeclaredByIndex(-1)
          }, UNO_CATCH_WINDOW_MS)
          break
        }

        // Penalty applied, so that target is no longer catchable by anyone. Any
        // other seat still holding a single card remains fair game.
        case 'uno_caught':
          store.closeCatchWindow(msg.player_index ?? -1)
          break

        // A Contre-LOCO! that lost its race. The penalty card arrives through
        // the ordinary card_drawn path; this only names the seat that paid, for
        // the notice and so the caller learns why their hand grew.
        case 'catch_failed':
          store.applyCatchFailed(msg.player_index ?? -1)
          break

        // Sent immediately before the resulting card_played so the steal can be
        // presented on its own — banner, sting, screen shake — instead of
        // looking like an ordinary turn.
        case 'interrupt_success':
          store.applyInterrupt(msg.player_index ?? 0, msg.cards?.length || 1)
          break

        case 'round_end':
          clearUnoTimer()
          store.applyRoundEnd(
            msg.round_winner ?? '',
            msg.round_number ?? 0,
            msg.scoreboard ?? [],
            msg.round_history,
          )
          break

        // Periodic per-seat ping, fed to the TAB score table. Informational
        // only, never consulted for a rules decision.
        case 'latency':
          store.applyLatencies(msg.latencies ?? [])
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

        case 'rematch_started':
          // The host reopened the finished room. player_id is authoritative: seats
          // may have been re-based when absent players were pruned.
          store.applyRematch(
            msg.player_id ?? 0,
            msg.players ?? [],
            msg.match_format ?? 'BO1',
            msg.max_players ?? 10,
          )
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
    // Active gameplay reconnect: token-authenticated to reclaim the slot.
    if (s.screen === 'game' && s.roomCode && s.sessionToken) {
      const nickname = s.players.find((p) => p.index === s.myIndex)?.nickname ?? ''
      return { type: 'join_room' as const, nickname, room_code: s.roomCode, session_token: s.sessionToken }
    }
    // Lobby reconnect: rejoin by nickname so the user does not have to reload
    // and re-enter the room code after a transient WS drop. The server treats
    // this as a fresh lobby join (no token needed before the game starts).
    if (s.screen === 'waiting' && s.roomCode) {
      const nickname = s.players.find((p) => p.index === s.myIndex)?.nickname ?? ''
      if (nickname) {
        return { type: 'join_room' as const, nickname, room_code: s.roomCode }
      }
    }
    return null
  }, [])

  const { send, wsStatus, forceClose } = useWebSocket(handleMessage, getReconnectMsg)

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

  // Backing store for the dev-only E2E turn recorder (see the helper below).
  const recordedTurns = useRef<number[]>([])
  const turnRecorderStop = useRef<(() => void) | null>(null)

  // Expose lightweight E2E helpers on window in dev mode only.
  // Vite tree-shakes this block in production builds (import.meta.env.DEV = false).
  useEffect(() => {
    if (!import.meta.env.DEV) return
    window.__LOCO_E2E__ = {
      ...(window.__LOCO_E2E__ ?? {}),
      send: (msg: ClientMsg) => sendRef.current(msg),
      getState: useGameStore.getState,
      // Turn recorder: captures every distinct currentTurn the store passes
      // through, so tests can assert on a turn *sequence* rather than sampling a
      // transient value a bot may already have moved past. Results are read back
      // via getRecordedTurns() — the recorder itself has to stay in the page.
      startTurnRecorder: () => {
        turnRecorderStop.current?.()
        recordedTurns.current = [useGameStore.getState().currentTurn]
        turnRecorderStop.current = useGameStore.subscribe((s) => {
          const seen = recordedTurns.current
          if (s.currentTurn !== seen[seen.length - 1]) seen.push(s.currentTurn)
        })
      },
      getRecordedTurns: () => [...recordedTurns.current],
      getWsStatus: () => wsStatus,
      forceCloseWs: forceClose,
    }
  }, [wsStatus, forceClose])

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
      {store.screen === 'game' && <GameView onSend={handleSend} wsStatus={wsStatus} />}
      {store.screen === 'gameover' && (
        <GameOver
          winner={store.matchWinner}
          myNickname={myNickname}
          scoreboard={store.scoreboard}
          matchOver={store.matchOver}
          isHost={store.myIndex === 0}
          onSend={handleSend}
        />
      )}
    </>
  )
}
