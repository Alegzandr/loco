import { StateCreator } from './createStore'
import { gameStateSliceFromDTO } from './helpers'
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
        // The next game_state (which also carries the history) is buffered
        // behind the round summary, so take it here or the score table would
        // be one round stale for as long as the summary is up.
        roundHistory: roundHistory ?? s.roundHistory,
        roundScores,
        showRoundSummary: true,
        turnDeadline: null,
        unoDeclared: false,
        declaredSeats: [],
        catchWindows: [],
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

  setPendingGameState: (pendingGameState) => set({ pendingGameState }),

  setPendingMatchEnd: (matchWinner, scoreboard, matchHistory) =>
    set({ pendingMatchEnd: { matchWinner, scoreboard, matchHistory } }),

  dismissRoundSummary: () => {
    const s = get()
    // Priority 1: final round — transition to game over screen.
    if (s.pendingMatchEnd) {
      set({
        matchWinner: s.pendingMatchEnd.matchWinner,
        matchOver: true,
        scoreboard: s.pendingMatchEnd.scoreboard,
        matchHistory: s.pendingMatchEnd.matchHistory,
        screen: 'gameover',
        showRoundSummary: false,
        pendingMatchEnd: null,
      })
      return
    }
    // Priority 2: mid-match — apply the buffered next-round state.
    if (s.pendingGameState) {
      set({
        ...gameStateSliceFromDTO(s.pendingGameState),
        roundWinner: '',
        showRoundSummary: false,
        pendingGameState: null,
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        declaredSeats: [],
        catchWindows: [],
        catchFailed: null,
        catchFlash: null,
      })
      return
    }
    // Default: just hide the summary (e.g. BO1 game-over path).
    set({ showRoundSummary: false })
  },

  // One entry per seat: speaking again replaces what that seat was saying, it
  // never adds a line. The screen draws one slot per player and its height is
  // the table's size, so a table that keeps talking moves nothing.
  applyEmote: (seat, emote) =>
    set((s) => ({
      emotes: [...s.emotes.filter((e) => e.seat !== seat), { seat, emote, at: Date.now() }],
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
      pendingGameState: null,
      pendingMatchEnd: null,
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      declaredSeats: [],
      catchWindows: [],
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
