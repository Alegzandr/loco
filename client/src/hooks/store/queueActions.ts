import { StateCreator } from './createStore'
import { AppScreen, GameStore, QueueActions } from './types'

export const createQueueActions: StateCreator<GameStore, QueueActions> = (set) => ({
  // The search screen owns its own clock. Nothing about the queue arrives from
  // the server beyond "you are in it", which is the point: a client that could
  // render the queue's size would eventually render "1".
  beginSearch: () =>
    set({ screen: 'searching', searchStartedAt: Date.now(), matchFound: null, errorMsg: '' }),

  // Leaving the queue, whether the player cancelled or the server dropped them
  // out of a pairing that fell apart. Guarded on the screen so an acknowledgement
  // that arrives after a match was found cannot yank a seated player home.
  endSearch: () =>
    set((s) =>
      s.screen === 'searching' ? { screen: 'lobby' as AppScreen, searchStartedAt: null } : s,
    ),

  // An opponent, a seat and a token, all at once: a matchmade room skips the
  // waiting room entirely, so this does the work room_joined does plus the
  // reveal.
  applyMatchFound: (found) =>
    set({
      screen: 'matchfound',
      searchStartedAt: null,
      isMatchmade: true,
      isSolo: false,
      roomCode: found.roomCode,
      myIndex: found.mySeat,
      sessionToken: found.sessionToken,
      players: found.players,
      myNickname: found.players.find((p) => p.index === found.mySeat)?.nickname ?? '',
      matchFormat: found.matchFormat,
      maxPlayers: found.maxPlayers,
      forfeitBy: null,
      opponentAway: null,
      goneSeats: [],
      rematchOffers: [],
      rematchNeeded: 0,
      errorMsg: '',
      matchFound: {
        opponentNickname: found.players.find((p) => p.index !== found.mySeat)?.nickname ?? '',
        mySeat: found.mySeat,
        startsAt: Date.now() + found.startsInMs,
      },
    }),

  // A 1v1 against the server. It has no message before game_started — no room
  // code screen, no versus reveal — so the identity arrives on the deal itself
  // and this is what records it. `isSolo` is what the game-over screen reads to
  // offer another press instead of an ask nobody could answer.
  applySoloStarted: (roomCode, mySeat, sessionToken) =>
    set({
      isSolo: true,
      isMatchmade: false,
      searchStartedAt: null,
      matchFound: null,
      roomCode,
      myIndex: mySeat,
      sessionToken,
      forfeitBy: null,
      opponentAway: null,
      goneSeats: [],
      rematchOffers: [],
      rematchNeeded: 0,
      errorMsg: '',
    }),

  // Only a deadline makes this worth showing: an ordinary room holds the seat
  // for a minute and says so through the roster, where a matchmade one is about
  // to end the match and owes the player at the table a number.
  applyOpponentAway: (seat, deadline) =>
    set(deadline > 0 ? { opponentAway: { seat, deadline } } : {}),

  clearOpponentAway: (seat) =>
    set((s) => (s.opponentAway?.seat === seat ? { opponentAway: null } : s)),
})
