import { StateCreator } from './createStore'
import { clearSession } from '../sessionPersistence'
import { AppScreen, GameStore, SessionActions } from './types'

export const createSessionActions: StateCreator<GameStore, SessionActions> = (set) => ({
  // Leaving 'restoring' is what "the reclaim landed" means, and every landing
  // path goes through here (player_reconnected, room_joined, match_loading), so
  // this is the one place the target has to be retired.
  setScreen: (screen) =>
    set((s) => ({ screen, restoreTarget: screen === 'restoring' ? s.restoreTarget : null })),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),
  setMyNickname: (myNickname) => set({ myNickname }),

  // Boot straight into the reclaim, from a record written before the tab went
  // away. Nothing here is authoritative: the seat, the hand and the score all
  // arrive with the server's answer.
  beginRestore: (session) =>
    set({
      screen: 'restoring',
      restoreTarget: session.target,
      roomCode: session.roomCode,
      myNickname: session.nickname,
      sessionToken: session.sessionToken,
      errorMsg: '',
    }),

  // The reclaim could not land: refused, or never answered. Drop the record so
  // the next load does not replay the same refusal, and hand the player back a
  // lobby that says why rather than a spinner that does not end.
  abortRestore: (reason) =>
    set((s) => {
      if (s.screen !== 'restoring') return s
      clearSession()
      return {
        screen: 'lobby' as AppScreen,
        restoreTarget: null,
        roomCode: '',
        sessionToken: '',
        myIndex: -1,
        errorMsg: reason,
      }
    }),

  setError: (errorMsg) => set({ errorMsg }),
  clearError: () => set({ errorMsg: '' }),
  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),
  setServerUpdating: (serverUpdating) => set({ serverUpdating }),
  // Deliberately absent from resetToHome below: the count belongs to the
  // socket, not to the seat, and the screen it is drawn on is the one that
  // reset lands the player back on. Clearing it would blank the chip on every
  // return from a table until the server next said the number moved.
  setPlayersOnline: (playersOnline) => set({ playersOnline }),
  // Out of resetToHome for the same reason, and it matters more here: the
  // strip is on the screen a player lands back on, so blanking it would make
  // leaving a table look like everybody stopped streaming.
  setLiveStreams: (liveStreams) => set({ liveStreams }),

  // Back to the front door with nothing carried over. The seat is gone
  // server-side by the time this runs, so the token and the room code are not
  // stale state, they are wrong state.
  resetToHome: () =>
    set({
      screen: 'lobby',
      roomCode: '',
      sessionToken: '',
      myIndex: -1,
      players: [],
      myHand: [],
      discard: null,
      isMatchmade: false,
      isSolo: false,
      // The table's setting leaves with the table. This player's own preference
      // is in `localStorage` and untouched by any of this.
      tableStreamer: false,
      matchFound: null,
      searchStartedAt: null,
      forfeitBy: null,
      forfeitedByMe: false,
      opponentAway: null,
      goneSeats: [],
      rematchOffers: [],
      rematchNeeded: 0,
      emotes: [],
      matchWinner: '',
      matchOver: false,
      scoreboard: [],
      roundHistory: [],
      roundScores: [],
      latencies: [],
      showRoundSummary: false,
      pendingMatchEnd: null,
      mapId: '',
      mapLoading: null,
      turnDeadline: null,
      catchWindows: [],
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      declaredSeats: [],
      catchFailed: null,
      catchFlash: null,
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      errorMsg: '',
    }),
})
