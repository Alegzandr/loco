import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import { useGameStore } from './hooks/useGameStore'
import { createServerMessageHandler, type UnoBannerTimer } from './hooks/serverMessages'
import { useE2EBridge } from './dev/e2eBridge'
import { reconnectMessageFor } from './hooks/sessionPersistence'
import { useSessionPersistence, useRestoreTimeout } from './hooks/useSessionRestore'
import { peekTableInvite, takeTableInvite } from './hooks/tableInvite'
import { readNickname } from './hooks/nicknameMemory'
import { canonicalNickname, isNicknameShapeValid } from './components/nicknameRules'
import { useGameAudio } from './audio/useGameAudio'
import { useTabAlert } from './hooks/useTabAlert'
import { useI18n } from './i18n'
import { Lobby } from './components/Lobby'
import { Searching } from './components/Searching'
import { MatchFound } from './components/MatchFound'
import { WaitingRoom } from './components/WaitingRoom'
import { GameView } from './components/GameView'
import { GameOver } from './components/GameOver'
import { Reconnecting } from './components/Reconnecting'
import { ClientMsg } from './types/protocol'

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

  // The one context App reads. It changes only when the player switches
  // language, so it costs nothing the note above is guarding against.
  const { t } = useI18n()

  // Single owner of every sound in the game: one store subscription, no
  // per-component audio calls. See audio/useGameAudio.ts.
  useGameAudio()

  // Mirrors room + seat + token into sessionStorage so a reload can reclaim the
  // seat, and gives a reclaim that never lands a way out. Both are effects on a
  // narrow (or no) subscription. See the note above about what App may watch.
  useSessionPersistence()
  useRestoreTimeout('reconnect failed')

  // The LOCO! banner comes down on its own, and a second declaration arriving
  // first has to cancel the first timer rather than let it fire later over
  // fresh state. The ref is App's because the handler below is not a component.
  const unoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unoTimer = useMemo<UnoBannerTimer>(
    () => ({
      clear: () => {
        if (unoTimerRef.current !== null) {
          clearTimeout(unoTimerRef.current)
          unoTimerRef.current = null
        }
      },
      arm: (ms, fn) => {
        unoTimerRef.current = setTimeout(() => {
          unoTimerRef.current = null
          fn()
        }, ms)
      },
    }),
    [],
  )

  // Everything the server can say lives in hooks/serverMessages.ts. Created
  // once: it closes over the store's action functions, which the zustand
  // factory makes once and never replaces.
  const handleMessage = useMemo(() => createServerMessageHandler(unoTimer), [unoTimer])

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

  // Which sub-screen the lobby opens on. Only ever moved off 'home' by the
  // long-wait escape hatch on the searching screen.
  const [lobbyEntry, setLobbyEntry] = useState<'home' | 'create'>('home')

  // The table this tab was opened on, when it followed a shared link. Peeked
  // during render rather than taken: StrictMode double-invokes the initialiser,
  // and a one-shot read there would hand the second call nothing. The effect
  // further down is the one that spends it.
  const [inviteCode, setInviteCode] = useState(peekTableInvite)

  // The handles Playwright drives the app through, dev builds only. See
  // dev/e2eBridge.ts: the second half of that surface is GameView's.
  useE2EBridge(sendRef, wsStatus, forceClose)

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
  const rematchNeeded = useGameStore((s) => s.rematchNeeded)

  const myNickname = playerList.find((p) => p.index === myIndex)?.nickname || storedNickname
  // Somebody to agree with. A roster of one is what a departure leaves behind,
  // and it is the difference between a rematch button that can complete and one
  // that never will.
  const hasTablemates = playerList.some((p) => p.index !== myIndex)

  // A search runs for minutes and people go and do something else. The sound on
  // `matchfound` is for the player who stayed; this is for the one who did not,
  // and it only ever runs while the tab is hidden. See hooks/useTabAlert.ts.
  useTabAlert(t.matchFoundTab, screen === 'matchfound')

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
  // A matchmade table with nobody left at it has nothing to offer: the rematch
  // cannot complete, and the screen would be two dead buttons and a scoreboard.
  // So the default is the thing the player came for, another opponent, and the
  // way out is cancelling the search rather than pressing anything here.
  // Ordinary tables are left alone: there is a room, a code and a lobby to
  // reopen, and nobody there queued for a stranger in the first place.
  useEffect(() => {
    if (screen !== 'gameover' || !isMatchmade || hasTablemates) return
    findMatch(myNickname)
  }, [screen, isMatchmade, hasTablemates, myNickname, findMatch])

  // A link carries a table, never a player. So a browser that already knows the
  // name this person plays under takes the seat on arrival, and one that does
  // not gets the join form with the code already filled and the caret on the
  // only thing left to type. A remembered name the client can itself tell would
  // be refused counts as no name at all: better the field than a round trip
  // whose only outcome is an error over a form nobody has filled in.
  useEffect(() => {
    if (screen !== 'lobby' || !inviteCode) return
    const code = takeTableInvite()
    // Spent either way, and before anything can fail: leaving this table has to
    // land on an ordinary lobby, not back at its door.
    setInviteCode('')
    if (!code) return
    const nickname = readNickname()
    if (!isNicknameShapeValid(nickname)) return
    sendRef.current({ type: 'join_room', nickname: canonicalNickname(nickname), room_code: code })
  }, [screen, inviteCode])

  // The home page carries a footer under the game — the links a search engine
  // follows, and the sheet somebody who has never played opens. It has no business
  // being there once a seat has been taken, and it is not React's to remove: it is
  // markup Astro rendered, so the document is told instead and CSS hides it.
  // Purely presentational, and absent from every other page.
  useEffect(() => {
    const root = document.documentElement
    if (screen === 'lobby') root.removeAttribute('data-seated')
    else root.setAttribute('data-seated', '1')
    return () => root.removeAttribute('data-seated')
  }, [screen])

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
          // Keyed on the entry point alone. The invite must not be part of it:
          // spending it would change the key, remount the lobby and take the
          // prefilled code back out from under the player.
          key={lobbyEntry}
          initialMode={inviteCode ? 'join' : lobbyEntry}
          initialCode={inviteCode}
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
          isMatchmade={isMatchmade}
          forfeitBy={forfeitBy}
          mySeat={myIndex}
          rematchOffers={rematchOffers}
          rematchNeeded={rematchNeeded}
          hasTablemates={hasTablemates}
          onRematch={() => handleSend({ type: 'rematch' })}
          onFindMatch={() => findMatch(myNickname)}
          onLeave={leaveRoom}
        />
      )}
    </>
  )
}
