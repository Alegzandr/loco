import { gameStore, UNO_CATCH_WINDOW_MS } from './gameStore'
import { ServerMsg } from '../types/protocol'
import { localizeDeadlines } from './serverClock'

/**
 * The LOCO! banner's own timer, owned by the caller.
 *
 * A declaration puts a line on screen that has to come down on its own, and a
 * second declaration arriving first must cancel the first timer rather than let
 * it fire later over fresh state. The control is passed in rather than kept
 * here so the handler stays a pure function of its inputs and a test can drive
 * the timer without a fake clock.
 */
export interface UnoBannerTimer {
  clear: () => void
  arm: (ms: number, fn: () => void) => void
}

/**
 * Everything the server can say, applied to the store.
 *
 * The store snapshot is taken once, at creation: the action functions come from
 * the store's own factory and are stable for the life of the app, so closing over
 * them costs nothing. Anything that reads *state* calls `getState()` at the
 * moment it needs it: a frozen snapshot would be reading the store as it was
 * at mount, which is a different value on every branch below that asks a
 * question about the current screen.
 */
export function createServerMessageHandler(unoTimer: UnoBannerTimer) {
  const store = gameStore.getState()

  return (raw: ServerMsg) => {
    // Every deadline below is read on our clock from here on: the server's stamp
    // is taken off this message and the instants it carries are moved by the
    // difference. See serverClock.ts for why a deadline compared to Date.now()
    // as it arrived was wrong by seconds on a device whose clock was.
    const msg = localizeDeadlines(raw)
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
        // The host may have been streaming for an hour before this player typed
        // the code. Absent on room_created, where the table is one message old
        // and this client is the host that owns the setting.
        store.setTableStreamer(msg.streamer_mode ?? false)
        store.setScreen('waiting')
        break
      }

      // --- 1v1 matchmaking ---

      // The search screen is entered optimistically when the button is
      // pressed, so this is normally a confirmation. It matters on its own
      // when the server puts somebody back in the queue unprompted: a pairing
      // whose other half closed their tab during the reveal.
      case 'matchmaking_queued':
        if (gameStore.getState().screen !== 'searching') store.beginSearch()
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

      // Same reset, one difference: this player pressed nothing. Without the
      // line the table simply vanishes from under them and the lobby they
      // land on looks like a bug. resetToHome clears errorMsg, so the reason
      // goes on after it, never before.
      case 'kicked':
        store.resetToHome()
        store.setError('removed by the host')
        break

      // The host started or stopped streaming. Not a lobby config: it is
      // accepted at every status, because a host streams the match and not the
      // wait.
      case 'streamer_mode_changed':
        store.setTableStreamer(msg.streamer_mode ?? false)
        break

      case 'lobby_config_changed':
        if (msg.match_format && msg.max_players) {
          store.setLobbyConfig(msg.match_format, msg.max_players)
        }
        break

      case 'player_joined':
        store.setPlayers(msg.players ?? [])
        break

      // The table changed hands. player_id is authoritative and this message is
      // personalised for it: a transfer swaps two seats, so for the two players
      // who moved the roster alone would not say which row is theirs.
      case 'host_changed':
        store.applyHostChange(msg.player_id ?? 0, msg.players ?? [])
        break

      case 'player_left':
        store.setPlayers(msg.players ?? [])
        // The recap is indexed by seat, and this is the message that re-bases
        // them. It is carried only by the departures that shrink the roster, so
        // an absent field means nothing moved — never an empty evening.
        if (msg.match_history) store.setMatchHistory(msg.match_history)
        // A seat is named here only when it is gone for good and nothing
        // re-based, which is the mid-match expiry: the roster still shows it,
        // because a running match indexes hands by it, and `connected: false`
        // alone cannot say whether it is held or finished.
        // The nickname rides it so the table can be told who left rather than
        // watching a bubble go quiet: held and gone both read `connected: false`.
        store.noteSeatGone(msg.player_index ?? -1, msg.nickname)
        // The offers that survive a departure are the server's to say: it
        // retires the leaver's, re-bases the rest and republishes them in a
        // rematch_offered right behind this message. Clearing here is what
        // holds until then, and it is the whole answer in a matchmade room,
        // where an opponent leaving ends the agreement outright.
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
        // The reclaim spent the token it was made with, and this is the
        // replacement (`hub.handleReconnect` rotates it and counts on the client
        // keeping whatever it is handed). Without this the record kept a token
        // that was already worthless: the seat came back once, and the next
        // reclaim of that tab — a second reload, a dropped socket, a deploy —
        // was refused with `game already in progress`. Guarded because the same
        // message is broadcast to everyone else at the table, carrying neither a
        // token nor a state, and blanking ours on somebody else's return is the
        // same bug with more steps.
        if (msg.session_token) store.setSessionToken(msg.session_token)
        // Cleared here rather than left standing: the process answering now
        // may be the new one, and it re-sends server_updating right after
        // this if it is draining too.
        store.setServerUpdating(false)
        if (msg.state) {
          // Read live state via getState(): the snapshot above is frozen at
          // creation and would lose any updates that happened after mount
          // (e.g. roomCode/myIndex from room_created arriving before this
          // branch fires).
          const live = gameStore.getState()
          // Mark reconnecting before applying state so GameView can animate recovery
          unoTimer.clear()
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
        // The solo mode has no message in front of this one — no room_created,
        // no match_found — because it has no screen in front of the board
        // either. So its game_started carries the identity the other two would
        // have carried, and this is where the client picks it up. Absent on
        // every other path, which is how the store tells the two apart.
        if (msg.room_code && msg.session_token) {
          const mySeat = msg.player_id ?? msg.state?.your_index ?? 0
          store.applySoloStarted(msg.room_code, mySeat, msg.session_token)
          // The roster is the authority on our own name, exactly as it is on
          // every other seating path: the client sent what the player typed and
          // the server canonicalised it, and the reclaim is keyed on the result.
          const mine = msg.state?.players.find((p) => p.index === mySeat)?.nickname
          if (mine) store.setMyNickname(mine)
        }
        // Applied the moment it lands, round summary or not. The server deals
        // the next round in the same breath as it announces the last one and
        // starts the turn clock with the deal, so the table is already moving
        // while the card is up: buffering this and replaying it on dismissal
        // rolled the board back to the deal. See `dismissRoundSummary`, which
        // no longer puts a board back, and `applyGameState`, which no longer
        // takes the card down.
        if (msg.state) {
          unoTimer.clear()
          store.applyGameState(msg.state)
          store.setScreen('game')
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
        // The deal's window is open: the opening discard is a card like any other.
        gameStore.setState({ interruptOpen: msg.interrupt_open ?? true })
        break

      case 'game_state':
        // Mid-game authoritative refresh (e.g. debug_set_state, swap/global_switch effects).
        // Apply the full state snapshot so discard/turn/pendingDraw remain in sync.
        if (msg.state) {
          unoTimer.clear()
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
            msg.direction,
            msg.catch_seats,
          )
          store.setTurnDeadline(msg.turn_deadline ?? null)
          // A card on the pile opens the window unless the server says the play
          // shut it (the round-winning card). Absent is an older server or a
          // fixture, and a play opens the window.
          gameStore.setState({ interruptOpen: msg.interrupt_open ?? true })
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
        // The seat at turn drawing shuts the window; a penalty growing a hand
        // does not. The server says which, so absent means unchanged.
        if (typeof msg.interrupt_open === 'boolean') gameStore.setState({ interruptOpen: msg.interrupt_open })
        break

      case 'turn_changed':
        gameStore.setState({
          currentTurn: msg.turn ?? 0,
          hasDrawn: false,
          turnDeadline: msg.turn_deadline ?? null,
          // A pass, a timeout or a retirement moved the turn without a card
          // landing, and every one of those shuts the window.
          interruptOpen: msg.interrupt_open ?? false,
        })
        break

      // A declaration closes the catch window on the declarer: from here on the
      // server answers every catch with "player already declared". The banner
      // stays up on its own timer so the table still sees who called it.
      case 'uno_declared': {
        unoTimer.clear()
        const declarer = msg.player_index ?? -1
        // Only that seat is off the hook: after a Swap or a GlobalSwitch
        // somebody else may still owe a call. If it is ours, the call is now
        // spent and the button goes with it.
        store.applyUnoDeclared(declarer)
        unoTimer.arm(UNO_CATCH_WINDOW_MS, () => {
          store.setUnoDeclared(false)
          store.setUnoDeclaredByIndex(-1)
        })
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

      // Our own call put us out of the mechanic for a moment, and this says
      // until when. Sent to the caller alone and on *every* press made inside
      // the lockout, not only the one that armed it, so the button's countdown
      // restarts exactly when the server's does — which is what makes holding
      // it down buy nothing. Absent means the seat is free again.
      case 'catch_locked':
        store.applyCatchLocked(msg.catch_locked_until ?? 0)
        break

      // Sent immediately before the resulting card_played so the steal can be
      // presented on its own — banner, sting, screen shake — instead of
      // looking like an ordinary turn.
      case 'interrupt_success':
        store.applyInterrupt(msg.player_index ?? 0, msg.cards?.length || 1)
        break

      case 'round_end':
        unoTimer.clear()
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

      // How many of us are here, for the home screen's chip. Sent on arrival
      // and then only when the number moves, and only to a socket that is not
      // sitting at a table. `?? 0` is the honest fallback: a message carrying
      // no count says nothing, and nothing is what the chip draws.
      case 'players_online':
        store.setPlayersOnline(msg.players_online ?? 0)
        break

      // Who is streaming the game, for the home screen's strip. Pushed on
      // arrival and then only when the answer changes, and only to a socket
      // with no seat. `?? []` is the honest fallback and it is also a real
      // answer: an empty list means nobody is live, which is what a server
      // with no gateway key says every time.
      case 'live_streams':
        store.setLiveStreams(msg.live_streams ?? [])
        break

      case 'match_end': {
        const s = gameStore.getState()
        // A forfeit is not a round result and does not queue behind one: the
        // opponent has gone, and there is nothing left for the summary to be
        // a summary of.
        if (msg.forfeit) {
          store.applyMatchEnd(
            msg.match_winner ?? '',
            msg.scoreboard ?? [],
            msg.match_history ?? [],
            msg.player_index ?? -1,
          )
        } else if (s.showRoundSummary) {
          // Final round summary is still visible — buffer the match-end payload so
          // the player sees the full round breakdown before the game over screen.
          store.setPendingMatchEnd(
            msg.match_winner ?? '',
            msg.scoreboard ?? [],
            msg.match_history ?? [],
          )
        } else {
          store.applyMatchEnd(msg.match_winner ?? '', msg.scoreboard ?? [], msg.match_history ?? [])
        }
        break
      }

      // One of the three things somebody said. Nothing is kept: it is rendered
      // for a few seconds and dropped, here as on the server.
      case 'emote':
        if (msg.emote) store.applyEmote(msg.player_index ?? -1, msg.emote)
        break

      // A rematch is an agreement in every room: this carries every seat that
      // has asked and how many asks it takes. The next match is dealt only
      // once they match: as another match_found in a matchmade room, as a
      // rematch_started back to the waiting room in an ordinary one.
      case 'rematch_offered':
        store.applyRematchOffers(msg.rematch_offers ?? [], msg.rematch_needed ?? 0)
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
        const screen = gameStore.getState().screen
        if (screen === 'restoring') {
          store.abortRestore(reason)
          break
        }
        // The versus reveal is the one screen in the game with nothing on it to
        // press. An error there is the end of the pairing, not a toast over it:
        // the deal is not coming, and a player left holding a countdown that
        // expires into nothing has no way to find that out. Every other screen
        // has a way off itself, searching included.
        if (screen === 'matchfound') {
          store.resetToHome()
          store.setError(reason)
          break
        }
        store.setError(reason)
        break
      }
    }
  }
}
