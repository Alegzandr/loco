import { StateCreator } from './createStore'
import { stamp } from './helpers'
import { GameStore, MatchActions, RoundScoreEntry } from './types'

export const createMatchActions: StateCreator<GameStore, MatchActions> = (set, get) => ({
  setLobbyConfig: (matchFormat, maxPlayers) => set({ matchFormat, maxPlayers }),

  applyRoundEnd: (roundWinner, roundNumber, newScoreboard, roundHistory) =>
    set((s) => {
      // Compute per-player round points as the delta vs current scoreboard
      const roundScores: RoundScoreEntry[] = newScoreboard.map((entry) => {
        const prev = s.scoreboard.find((p) => p.player_index === entry.player_index)
        return {
          player_index: entry.player_index,
          nickname: entry.nickname,
          round_points: prev ? entry.score - prev.score : entry.score,
          cumulative_score: entry.score,
          rounds_won: entry.rounds_won,
        }
      })
      return {
        roundWinner,
        roundNumber_completed: roundNumber,
        scoreboard: newScoreboard,
        // Taken from this message rather than waited for: `round_end` is the
        // one that names the round that just finished, and the summary is
        // drawn from it. The next `game_state` carries the same history a
        // moment later.
        roundHistory: roundHistory ?? s.roundHistory,
        roundScores,
        showRoundSummary: true,
        turnDeadline: null,
        unoDeclared: false,
        declaredSeats: [],
        catchWindows: [],
        catchLive: false,
        catchFailed: null,
        catchFlash: null,
      }
    }),

  applyMatchEnd: (matchWinner, scoreboard, matchHistory, forfeitBy) =>
    set((s) => ({
      matchWinner,
      matchOver: true,
      scoreboard,
      matchHistory,
      screen: 'gameover',
      // A forfeit is the one match end that can land while a round summary is
      // still up: the opponent quits, and nothing is waiting on a dismissal any
      // more. The ordinary path never gets here with a summary showing.
      showRoundSummary: false,
      forfeitBy: typeof forfeitBy === 'number' ? forfeitBy : null,
      // Answered here, against the roster this message was composed for. The
      // player_left right behind it re-bases the seats, and by then no index can
      // say which of the two this was. See forfeitedByMe.
      forfeitedByMe: typeof forfeitBy === 'number' && forfeitBy === s.myIndex,
      // A fresh screen says nothing yet.
      emotes: [],
      // The countdown is over one way or the other: either they came back or
      // the match was given away, and both end the notice.
      opponentAway: null,
      goneSeats: [],
    })),

  setMatchHistory: (matchHistory) => set({ matchHistory }),

  setPendingMatchEnd: (matchWinner, scoreboard, matchHistory) =>
    set({ pendingMatchEnd: { matchWinner, scoreboard, matchHistory } }),

  /**
   * Takes the card down. It does not put a board back.
   *
   * The next round's `game_started` used to be buffered here and applied on
   * dismissal, so that the summary would not vanish the instant the server
   * dealt. But the server deals immediately, the turn clock starts with the
   * deal, and every `card_played` of the new round is applied to the store
   * while the card is still up — so the buffer was a snapshot of the deal
   * replayed over a board that had moved on for up to the full eight seconds.
   * Whoever read the scores had their table rolled back: the discard, the hand
   * sizes and, worst of all, `currentTurn`. If the rolled-back turn happened to
   * be theirs, the desync healed nothing on its own — nobody else could play,
   * they were shown somebody else's turn, and the table sat there until the
   * server's own turn timer expired.
   *
   * A snapshot is authoritative when it arrives and never afterwards. The
   * board is applied on arrival now (`applyGameState`), and the summary is what
   * it looks like: an overlay with its own dismissal.
   *
   * The match end is still buffered, and that one is safe: nothing follows it.
   */
  dismissRoundSummary: () => {
    const s = get()
    if (s.pendingMatchEnd) {
      set({
        matchWinner: s.pendingMatchEnd.matchWinner,
        matchOver: true,
        scoreboard: s.pendingMatchEnd.scoreboard,
        matchHistory: s.pendingMatchEnd.matchHistory,
        screen: 'gameover',
        showRoundSummary: false,
        pendingMatchEnd: null,
        // A fresh screen says nothing yet, and this is the door it almost always
        // opens through: `round_end` puts the summary up, `match_end` waits
        // behind it, and only a forfeit reaches `applyMatchEnd` directly. Left
        // out here, what a table said about the first match was still on the
        // card at the end of the second.
        emotes: [],
      })
      return
    }
    set({ showRoundSummary: false, roundWinner: '' })
  },

  // One entry per seat: speaking again replaces what that seat was saying, it
  // never adds a line. The screen draws one slot per player and its height is
  // the table's size, so a table that keeps talking moves nothing.
  applyEmote: (seat, emote) =>
    set((s) => ({
      emotes: [...s.emotes.filter((e) => e.seat !== seat), { seat, emote, at: stamp() }],
    })),

  // The server sends the whole offer state, not the increment, and this stores
  // it as sent. A seat leaving retires its ask and re-bases the ones above it,
  // so a client accumulating seat numbers would keep a departed player's ask
  // forever and show a count that never completes.
  applyRematchOffers: (offers, needed) => set({ rematchOffers: offers, rematchNeeded: needed }),

  // A matchmade table has no offer state left once the opponent is gone: there
  // is nobody to agree with, and a button still reading "accept" would refuse.
  clearRematchOffers: () => set({ rematchOffers: [], rematchNeeded: 0 }),

  // The table agreed and reopened as a lobby: drop all match state and go back
  // to the waiting room. myIndex comes from the server because pruning absent
  // players can re-seat everyone. sessionToken is deliberately kept — the room
  // is the same, so it still authenticates a reconnect during the next match.
  applyRematch: (myIndex, players, matchFormat, maxPlayers) =>
    set({
      screen: 'waiting',
      myIndex,
      players,
      matchFormat,
      maxPlayers,
      myHand: [],
      discard: null,
      activeColor: 'red',
      currentTurn: 0,
      direction: 1,
      pendingDraw: 0,
      hasDrawn: false,
      roundNumber: 1,
      // The next match draws its own room, and its assets are ones this client
      // may not hold yet, so the gate re-arms and the map is unknown until then.
      mapId: '',
      mapTime: '',
      mapWeather: '',
      mapLoading: null,
      scoreboard: [],
      roundHistory: [],
      // matchHistory is deliberately NOT cleared: it belongs to the table, not
      // to the match, and the whole point of it is that a rematch does not wipe
      // the evening. The server re-sends it on the next game_state anyway, so
      // clearing here would only produce a window where the table forgets.
      latencies: [],
      roundWinner: '',
      roundScores: [],
      roundNumber_completed: 0,
      matchWinner: '',
      matchOver: false,
      // The asks belonged to the match that has just been agreed away, and the
      // server drops them in the same breath (`table.resetForNextMatch`). Kept
      // here they were still ours at the *next* game over: `iOffered` read true
      // off a set nobody had asked into, so the button greeted the second match
      // disabled and waiting on an opponent who had not been asked anything —
      // and there was no ask left to send, since the offer was ours already.
      // The matchmade path clears them in `applyMatchFound`; this is the
      // ordinary table's half of the same reset.
      rematchOffers: [],
      rematchNeeded: 0,
      emotes: [],
      showRoundSummary: false,
      pendingMatchEnd: null,
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      declaredSeats: [],
      catchWindows: [],
      catchLive: false,
      catchFailed: null,
      catchFlash: null,
      turnDeadline: null,
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      errorMsg: '',
    }),
})
