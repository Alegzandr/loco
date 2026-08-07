<script lang="ts">
  import { gameStore } from './hooks/gameStore'
  import { game } from './hooks/gameStore.svelte'
  import { createServerMessageHandler, type UnoBannerTimer } from './hooks/serverMessages'
  import { webSocket } from './hooks/webSocket.svelte'
  import { e2eBridge } from './dev/e2eBridge.svelte'
  import { reconnectMessageFor } from './hooks/sessionPersistence'
  import {
    gameAudio,
    sessionPersistence,
    restoreTimeout,
    hostStreamerSync,
  } from './hooks/appEffects.svelte'
  import { tabAlert } from './hooks/tabAlert.svelte'
  import { setTabSeated } from './hooks/tabLock'
  import { peekTableInvite, takeTableInvite } from './hooks/tableInvite'
  import { readNickname } from './hooks/nicknameMemory'
  import { canonicalNickname, isNicknameShapeValid } from './components/nicknameRules'
  import { i18n } from './i18n/i18n.svelte'
  import Lobby from './components/Lobby.svelte'
  import Searching from './components/Searching.svelte'
  import MatchFound from './components/MatchFound.svelte'
  import WaitingRoom from './components/WaitingRoom.svelte'
  import GameView from './components/GameView.svelte'
  import GameOver from './components/GameOver.svelte'
  import Reconnecting from './components/Reconnecting.svelte'
  import type { ClientMsg } from './types/protocol'

  const t = $derived(i18n.t)
  const g = $derived(game.current)
  // The one field the effects below turn on, derived rather than read out of `g`
  // inside them. `g` is a single snapshot replaced on every message, so an effect
  // reading it depends on the whole match and re-runs several times a second —
  // see `hooks/live.svelte.ts`, which is the same rule for everything under
  // `hooks/`.
  const screen = $derived(g.screen)

  // Single owner of every sound in the game: one store subscription, no
  // per-component audio calls. See hooks/appEffects.svelte.ts.
  gameAudio()

  // Mirrors room + seat + token into sessionStorage so a reload can reclaim the
  // seat, and gives a reclaim that never lands a way out.
  sessionPersistence()
  restoreTimeout(() => screen === 'restoring', 'reconnect failed')

  // The LOCO! banner comes down on its own, and a second declaration arriving
  // first has to cancel the first timer rather than let it fire later over fresh
  // state. The timer is the app's because the handler below is not a component.
  let unoTimerId: ReturnType<typeof setTimeout> | null = null
  const unoTimer: UnoBannerTimer = {
    clear: () => {
      if (unoTimerId !== null) {
        clearTimeout(unoTimerId)
        unoTimerId = null
      }
    },
    arm: (ms, fn) => {
      unoTimerId = setTimeout(() => {
        unoTimerId = null
        fn()
      }, ms)
    },
  }

  // Everything the server can say lives in hooks/serverMessages.ts. Created once:
  // it closes over the store's action functions, which the store factory makes
  // once and never replaces.
  const handleMessage = createServerMessageHandler(unoTimer)

  // Sent on every socket open. One pure function covers all three cases: a socket
  // that dropped mid-match, one that dropped in the lobby, and a tab that was
  // reloaded into 'restoring'. A reclaim cannot mean two different things
  // depending on how the connection was lost. See sessionPersistence.ts.
  const socket = webSocket(handleMessage, () => reconnectMessageFor(gameStore.getState()))

  function handleSend(msg: ClientMsg) {
    gameStore.getState().clearError()
    socket.send(msg)
  }

  // The handles Playwright drives the app through, dev builds only. See
  // dev/e2eBridge.svelte.ts: the second half of that surface is the game view's.
  e2eBridge(handleSend, () => socket.wsStatus, socket.forceClose)

  // The host's streamer mode is the table's, so it goes out on the wire. Placed
  // here rather than beside the other two effects because it is the only one
  // that sends anything. See hooks/appEffects.svelte.ts.
  hostStreamerSync(handleSend)

  // Which sub-screen the lobby opens on. Only ever moved off 'home' by the
  // long-wait escape hatch on the searching screen.
  let lobbyEntry = $state<'home' | 'create'>('home')

  // The table this tab was opened on, when it followed a shared link. Peeked at
  // setup rather than taken; the effect further down is the one that spends it.
  let inviteCode = $state(peekTableInvite())

  // The roster is empty on the queue screens and on a cold game-over, so the name
  // we go by is read from the store rather than derived from `players`.
  const myNickname = $derived(
    g.players.find((p) => p.index === g.myIndex)?.nickname || g.myNickname,
  )
  // Somebody to agree with. A roster of one is what a departure leaves behind, and
  // it is the difference between a rematch button that can complete and one that
  // never will.
  const hasTablemates = $derived(g.players.some((p) => p.index !== g.myIndex))

  // A search runs for minutes and people go and do something else. The sound on
  // `matchfound` is for the player who stayed; this is for the one who did not,
  // and it only ever runs while the tab is hidden.
  tabAlert(() => t.matchFoundTab, () => screen === 'matchfound')

  // The queue screens are entered optimistically: the press is the moment the
  // player committed, and waiting a round trip to acknowledge it would make the
  // one button in the game with nothing behind it feel like the slowest.
  function findMatch(nickname: string) {
    lobbyEntry = 'home'
    const store = gameStore.getState()
    store.setMyNickname(nickname)
    store.beginSearch()
    handleSend({ type: 'find_match', nickname })
  }

  // A 1v1 against the server. Nothing is entered optimistically here: there is
  // no wait to fill, the deal comes back on the next frame, and a screen change
  // ahead of it would only have to be undone if the name were refused. The
  // nickname is recorded before the send for the reason findMatch records it —
  // this mode has no message in front of game_started to carry it.
  function playBot(nickname: string) {
    lobbyEntry = 'home'
    gameStore.getState().setMyNickname(nickname)
    handleSend({ type: 'play_bot', nickname })
  }

  function cancelSearch() {
    gameStore.getState().endSearch()
    handleSend({ type: 'cancel_matchmaking' })
  }

  // Leaving is the server's to confirm (it may be a forfeit), so this only sends.
  // The store is reset when left_room comes back.
  function leaveRoom() {
    handleSend({ type: 'leave_room' })
  }

  function createTableInstead() {
    lobbyEntry = 'create'
    gameStore.getState().endSearch()
    handleSend({ type: 'cancel_matchmaking' })
  }

  // A matchmade table with nobody left at it has nothing to offer: the rematch
  // cannot complete, and the screen would be two dead buttons and a scoreboard. So
  // the default is the thing the player came for, another opponent, and the way
  // out is cancelling the search rather than pressing anything here. Ordinary
  // tables are left alone: there is a room, a code and a lobby to reopen, and
  // nobody there queued for a stranger in the first place.
  $effect(() => {
    if (screen !== 'gameover' || !g.isMatchmade || hasTablemates) return
    findMatch(myNickname)
  })

  // A link carries a table, never a player. So a browser that already knows the
  // name this person plays under takes the seat on arrival, and one that does not
  // gets the join form with the code already filled and the caret on the only
  // thing left to type. A remembered name the client can itself tell would be
  // refused counts as no name at all: better the field than a round trip whose
  // only outcome is an error over a form nobody has filled in.
  $effect(() => {
    if (screen !== 'lobby' || !inviteCode) return
    const code = takeTableInvite()
    // Spent either way, and before anything can fail: leaving this table has to
    // land on an ordinary lobby, not back at its door.
    inviteCode = ''
    if (!code) return
    const nickname = readNickname()
    if (!isNicknameShapeValid(nickname)) return
    handleSend({ type: 'join_room', nickname: canonicalNickname(nickname), room_code: code })
  })

  // The home page carries a footer under the game — the links a search engine
  // follows, and the sheet somebody who has never played opens. It has no business
  // being there once a seat has been taken, and it is not the app's to remove: it
  // is markup Astro rendered, so the document is told instead and CSS hides it.
  // Purely presentational, and absent from every other page.
  // Same question, asked by something outside this document: a tab that is not
  // holding the game draws a curtain, and the curtain's copy turns on whether
  // taking the game costs a match or costs nothing. Mirrored here rather than
  // watched from `tabLock.ts` because this is the one place that already knows.
  $effect(() => {
    const root = document.documentElement
    const atTable = screen !== 'lobby'
    if (atTable) root.setAttribute('data-seated', '1')
    else root.removeAttribute('data-seated')
    setTabSeated(atTable)
    return () => {
      root.removeAttribute('data-seated')
      setTabSeated(false)
    }
  })
</script>

{#if g.screen === 'restoring'}
  <Reconnecting
    roomCode={g.roomCode}
    target={g.restoreTarget ?? 'game'}
    onCancel={() => gameStore.getState().abortRestore('reconnect cancelled')}
  />
{:else if g.screen === 'lobby'}
  <!-- Keyed on the entry point alone. The invite must not be part of it: spending
       it would change the key, remount the lobby and take the prefilled code back
       out from under the player. -->
  {#key lobbyEntry}
    <Lobby
      initialMode={inviteCode ? 'join' : lobbyEntry}
      initialCode={inviteCode}
      onSend={handleSend}
      onFindMatch={findMatch}
      onPlayBot={playBot}
      error={g.errorMsg}
      playersOnline={g.playersOnline}
      onClearError={() => gameStore.getState().clearError()}
    />
  {/key}
{:else if g.screen === 'searching'}
  <Searching
    startedAt={g.searchStartedAt ?? Date.now()}
    nickname={myNickname}
    onCancel={cancelSearch}
    onCreateTable={createTableInstead}
  />
{:else if g.screen === 'matchfound' && g.matchFound}
  <MatchFound
    myNickname={myNickname}
    opponentNickname={g.matchFound.opponentNickname}
    mySeat={g.matchFound.mySeat}
    startsAt={g.matchFound.startsAt}
    format={g.matchFormat}
  />
{:else if g.screen === 'waiting'}
  <WaitingRoom
    roomCode={g.roomCode}
    players={g.players}
    myIndex={g.myIndex}
    matchFormat={g.matchFormat}
    maxPlayers={g.maxPlayers}
    onSend={handleSend}
    onLeave={leaveRoom}
  />
{:else if g.screen === 'game'}
  <GameView
    onSend={handleSend}
    wsStatus={socket.wsStatus}
    onRetryConnection={socket.reconnectNow}
    onLeave={leaveRoom}
  />
{:else if g.screen === 'gameover'}
  <GameOver
    winner={g.matchWinner}
    myNickname={myNickname}
    scoreboard={g.scoreboard}
    players={g.players}
    matchHistory={g.matchHistory}
    matchOver={g.matchOver}
    isMatchmade={g.isMatchmade}
    isSolo={g.isSolo}
    onPlayBot={() => playBot(myNickname)}
    onEmote={(emote) => handleSend({ type: 'send_emote', emote })}
    forfeitBy={g.forfeitBy}
    forfeitedByMe={g.forfeitedByMe}
    mySeat={g.myIndex}
    rematchOffers={g.rematchOffers}
    rematchNeeded={g.rematchNeeded}
    {hasTablemates}
    onRematch={() => handleSend({ type: 'rematch' })}
    onFindMatch={() => findMatch(myNickname)}
    onLeave={leaveRoom}
  />
{/if}
