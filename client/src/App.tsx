import { useCallback, useEffect, useRef, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useGameStore, UNO_CATCH_WINDOW_MS } from './hooks/useGameStore'
import { reconnectMessageFor } from './hooks/sessionPersistence'
import { useSessionPersistence, useRestoreTimeout } from './hooks/useSessionRestore'
import { useGameAudio } from './audio/useGameAudio'
import { Lobby } from './components/Lobby'
import { Searching } from './components/Searching'
import { MatchFound } from './components/MatchFound'
import { WaitingRoom } from './components/WaitingRoom'
import { GameView } from './components/GameView'
import { GameOver } from './components/GameOver'
import { Reconnecting } from './components/Reconnecting'
import { ServerMsg, ClientMsg } from './types/protocol'

export default function App() {
  // Actions only, and deliberately NOT a subscription. The store's action
  // functions are created once by the factory, so this snapshot is stable for
  // the life of the app and safe to close over in a deps-free callback.
  //
  // `useGameStore()` here subscribed App to the whole store, so every broadcast
  // (a latency tick every 3s, any card anybody drew) re-rendered App and with
  // it the entire game screen. Worse, it put a new object in handleSend's deps,
  // which rebuilt GameView's memoised callbacks and defeated <GameBoard />'s
  // memo one level down — undoing, from the parent, the exact stabilisation
  // GameView does for itself. State this component renders is read through the
  // narrow selectors below.
  const store = useGameStore.getState()

  // Single owner of every sound in the game: one store subscription, no
  // per-component audio calls. See audio/useGameAudio.ts.
  useGameAudio()

  // Mirrors room + seat + token into sessionStorage so a reload can reclaim the
  // seat, and gives a reclaim that never lands a way out. Both are effects on a
  // narrow (or no) subscription. See the note above about what App may watch.
  useSessionPersistence()
  useRestoreTimeout('reconnect failed')

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
        case 'room_joined': {
          const players = msg.players ?? []
          const myIdx = msg.player_id ?? 0
          store.setRoomCode(msg.room_code ?? '')
          store.setMyIndex(myIdx)
          store.setSessionToken(msg.session_token ?? '')
          store.setPlayers(players)
          // Persisted alongside the token: a reloaded tab has no roster to
          // derive it from, and the rejoin is keyed on the nickname.
          store.setMyNickname(players.find((p) => p.index === myIdx)?.nickname ?? '')
          if (msg.match_format && msg.max_players) {
            store.setLobbyConfig(msg.match_format, msg.max_players)
          }
          store.setScreen('waiting')
          break
        }

        // --- 1v1 matchmaking ---

        // The search screen is entered optimistically when the button is
        // pressed, so this is normally a confirmation. It matters on its own
        // when the server puts somebody back in the queue unprompted: a pairing
        // whose other half closed their tab during the reveal.
        case 'matchmaking_queued':
          if (useGameStore.getState().screen !== 'searching') store.beginSearch()
          break

        case 'matchmaking_cancelled':
          store.endSearch()
          break

        // Two players, a room and a seat in one message: a matchmade match has
        // no waiting room and nobody presses start. The reveal holds until the
        // server deals, which arrives as an ordinary game_started.
        case 'match_found':
          store.applyMatchFound({
            roomCode: msg.room_code ?? '',
            mySeat: msg.player_id ?? 0,
            sessionToken: msg.session_token ?? '',
            players: msg.players ?? [],
            matchFormat: msg.match_format ?? 'BO1',
            maxPlayers: msg.max_players ?? 2,
            startsInMs: msg.starts_in_ms ?? 0,
          })
          break

        // The seat is gone server-side; nothing local may survive it.
        case 'left_room':
          store.resetToHome()
          break

        case 'lobby_config_changed':
          if (msg.match_format && msg.max_players) {
            store.setLobbyConfig(msg.match_format, msg.max_players)
          }
          break

        case 'player_joined':
          store.setPlayers(msg.players ?? [])
          break

        case 'player_left':
          store.setPlayers(msg.players ?? [])
          // Whoever left took every standing rematch offer with them: there is
          // nobody to agree with, and the server would refuse the button.
          store.clearRematchOffers()
          break

        // In a matchmade match the server says when this seat's match is given
        // away, so the board can count it down instead of freezing on an
        // opponent who may never move again. An ordinary room sends no deadline
        // and gets no countdown: there, the seat is simply held.
        case 'player_disconnected':
          store.setPlayers(msg.players ?? [])
          if (msg.forfeit_deadline) {
            store.applyOpponentAway(msg.player_index ?? -1, msg.forfeit_deadline)
          }
          break

        // A deploy is under way. Nothing to do and nothing to decide: the match
        // finishes, and a restart is a one-second reconnect the client already
        // handles. It is a line of text so the board is not silently strange.
        case 'server_updating':
          store.setServerUpdating(true)
          break

        case 'player_reconnected':
          store.setPlayers(msg.players ?? [])
          store.clearOpponentAway(msg.player_index ?? -1)
          // Cleared here rather than left standing: the process answering now
          // may be the new one, and it re-sends server_updating right after
          // this if it is draining too.
          store.setServerUpdating(false)
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
            // `state.your_index` is the same seat by construction and is not
            // omittable, so it is the fallback rather than the previous value:
            // a reloaded tab has no previous value, and the one it defaults to
            // (-1) would seat it nowhere on a board it is otherwise holding a
            // hand for. See protocol: player_id used to drop seat 0 entirely.
            const myIdx = msg.player_id ?? msg.state.your_index ?? live.myIndex
            store.setMyIndex(myIdx)
            // A reloaded tab arrives here with only the persisted nickname; the
            // roster in this message is the authority, and re-reading it keeps
            // the record honest if the seat was re-indexed while we were away.
            const mine = (msg.players ?? []).find((p) => p.index === myIdx)?.nickname
            if (mine) store.setMyNickname(mine)
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

        // The table is shut while the room downloads its map. Arrives right
        // after game_started, and again on every arrival so the loading screen
        // can show who is still missing.
        case 'match_loading':
          store.applyMatchLoading(msg.players_ready ?? [])
          store.setScreen('game')
          break

        // The table is open. This, not game_started, is where the clock
        // starts, which is why the deadline rides this message.
        case 'match_ready':
          store.applyMatchReady(msg.turn ?? 0, msg.turn_deadline ?? null)
          break

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
        // other seat still holding a single card remains fair game. It also
        // arms the slam: the penalty cards arrive through the ordinary
        // card_drawn path, which on its own reads as somebody taking a turn.
        case 'uno_caught':
          store.applyUnoCaught(msg.player_index ?? -1)
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
          // A forfeit is not a round result and does not queue behind one: the
          // opponent has gone, and there is nothing left for the summary to be
          // a summary of.
          if (msg.forfeit) {
            store.applyMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [], msg.player_index ?? -1)
          } else if (s.showRoundSummary) {
            // Final round summary is still visible — buffer the match-end payload so
            // the player sees the full round breakdown before the game over screen.
            store.setPendingMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [])
          } else {
            store.applyMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [])
          }
          break
        }

        // A matchmade rematch is an agreement: this names a seat that has asked
        // for another, and the match is dealt (as another match_found) only once
        // both have.
        case 'rematch_offered':
          store.applyRematchOffer(msg.player_index ?? -1)
          break

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

        case 'error': {
          const reason = msg.error ?? 'Unknown error'
          // A refusal during a seat reclaim is the end of that reclaim, not a
          // toast over a spinner: the room is gone, the match moved on, or the
          // token no longer matches. abortRestore drops the stored record too,
          // so the next load does not walk into the same refusal.
          if (useGameStore.getState().screen === 'restoring') {
            store.abortRestore(reason)
            break
          }
          store.setError(reason)
          break
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  // Sent on every socket open. One pure function covers all three cases: a
  // socket that dropped mid-match, one that dropped in the lobby, and a tab that
  // was reloaded into 'restoring'. A reclaim cannot mean two different
  // things depending on how the connection was lost. See sessionPersistence.ts.
  const getReconnectMsg = useCallback(() => reconnectMessageFor(useGameStore.getState()), [])

  const { send, wsStatus, forceClose } = useWebSocket(handleMessage, getReconnectMsg)

  const handleSend = useCallback(
    (msg: ClientMsg) => {
      useGameStore.getState().clearError()
      send(msg)
    },
    [send]
  )

  // Keep a stable ref so the E2E helper always dispatches through the latest send.
  const sendRef = useRef(handleSend)
  sendRef.current = handleSend

  // Backing store for the dev-only E2E turn recorder (see the helper below).
  // Which sub-screen the lobby opens on. Only ever moved off 'home' by the
  // long-wait escape hatch on the searching screen.
  const [lobbyEntry, setLobbyEntry] = useState<'home' | 'create'>('home')

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

  // One selector per field: App re-renders when what it actually renders
  // changes, and not when the board's state moves. See the note at the top.
  const screen = useGameStore((s) => s.screen)
  const errorMsg = useGameStore((s) => s.errorMsg)
  const roomCode = useGameStore((s) => s.roomCode)
  const playerList = useGameStore((s) => s.players)
  const myIndex = useGameStore((s) => s.myIndex)
  const matchFormat = useGameStore((s) => s.matchFormat)
  const maxPlayers = useGameStore((s) => s.maxPlayers)
  const matchWinner = useGameStore((s) => s.matchWinner)
  const scoreboard = useGameStore((s) => s.scoreboard)
  const matchOver = useGameStore((s) => s.matchOver)
  const restoreTarget = useGameStore((s) => s.restoreTarget)
  const searchStartedAt = useGameStore((s) => s.searchStartedAt)
  const matchFound = useGameStore((s) => s.matchFound)
  const isMatchmade = useGameStore((s) => s.isMatchmade)
  const forfeitBy = useGameStore((s) => s.forfeitBy)
  // The roster is empty on the queue screens and on a cold game-over, so the
  // name we go by is read from the store rather than derived from `players`.
  const storedNickname = useGameStore((s) => s.myNickname)
  const rematchOffers = useGameStore((s) => s.rematchOffers)

  const myNickname = playerList.find((p) => p.index === myIndex)?.nickname || storedNickname

  // The queue screens are entered optimistically: the press is the moment the
  // player committed, and waiting a round trip to acknowledge it would make the
  // one button in the game with nothing behind it feel like the slowest.
  const findMatch = useCallback((nickname: string) => {
    setLobbyEntry('home')
    const store = useGameStore.getState()
    store.setMyNickname(nickname)
    store.beginSearch()
    sendRef.current({ type: 'find_match', nickname })
  }, [])

  const cancelSearch = useCallback(() => {
    useGameStore.getState().endSearch()
    sendRef.current({ type: 'cancel_matchmaking' })
  }, [])

  // Leaving is the server's to confirm (it may be a forfeit), so this only
  // sends. The store is reset when left_room comes back.
  const leaveRoom = useCallback(() => {
    sendRef.current({ type: 'leave_room' })
  }, [])

  // Leaving the queue for a private table lands on the create form, not on the
  // home screen: the player already said what they want. Keyed so the lobby
  // re-mounts on the sub-screen it is being sent to.
  const createTableInstead = useCallback(() => {
    setLobbyEntry('create')
    useGameStore.getState().endSearch()
    sendRef.current({ type: 'cancel_matchmaking' })
  }, [])

  return (
    <>
      {screen === 'restoring' && (
        <Reconnecting
          roomCode={roomCode}
          target={restoreTarget ?? 'game'}
          onCancel={() => useGameStore.getState().abortRestore('reconnect cancelled')}
        />
      )}
      {screen === 'lobby' && (
        <Lobby
          key={lobbyEntry}
          initialMode={lobbyEntry}
          onSend={handleSend}
          onFindMatch={findMatch}
          error={errorMsg}
          onClearError={store.clearError}
        />
      )}
      {screen === 'searching' && (
        <Searching
          startedAt={searchStartedAt ?? Date.now()}
          nickname={myNickname}
          onCancel={cancelSearch}
          onCreateTable={createTableInstead}
        />
      )}
      {screen === 'matchfound' && matchFound && (
        <MatchFound
          myNickname={myNickname}
          opponentNickname={matchFound.opponentNickname}
          mySeat={matchFound.mySeat}
          startsAt={matchFound.startsAt}
          format={matchFormat}
        />
      )}
      {screen === 'waiting' && (
        <WaitingRoom
          roomCode={roomCode}
          players={playerList}
          myIndex={myIndex}
          matchFormat={matchFormat}
          maxPlayers={maxPlayers}
          onSend={handleSend}
          onLeave={leaveRoom}
        />
      )}
      {screen === 'game' && <GameView onSend={handleSend} wsStatus={wsStatus} />}
      {screen === 'gameover' && (
        <GameOver
          winner={matchWinner}
          myNickname={myNickname}
          scoreboard={scoreboard}
          matchOver={matchOver}
          isHost={myIndex === 0}
          isMatchmade={isMatchmade}
          forfeitBy={forfeitBy}
          mySeat={myIndex}
          rematchOffers={rematchOffers}
          onSend={handleSend}
          onRematch={() => handleSend({ type: 'rematch' })}
          onFindMatch={() => findMatch(myNickname)}
          onLeave={leaveRoom}
        />
      )}
    </>
  )
}
