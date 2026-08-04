/**
 * Type declarations for the dev-only E2E helpers exposed on window
 * by the Loco client application (client/src/App.tsx and GameView.tsx).
 *
 * These helpers are only present when the client is built in dev mode
 * (import.meta.env.DEV === true), which is the case for all E2E test runs.
 */

/** Minimal representation of a card for E2E purposes. */
interface E2ECard {
  color: string
  kind: string
  value?: number
}

/** Per-player scoreboard entry. */
interface E2EScoreEntry {
  player_index: number
  nickname: string
  score: number
  rounds_won: number
}

/** Per-player round-score delta entry. */
interface E2ERoundScore {
  player_index: number
  nickname: string
  round_points: number
  cumulative_score: number
  rounds_won: number
}

/** Full game-store state snapshot returned by getState(). */
interface LocoE2EState {
  // Screen
  screen: string
  // Player identity
  myIndex: number
  sessionToken: string
  roomCode: string
  // Game state
  currentTurn: number
  myHand: E2ECard[]
  discard: E2ECard | null
  activeColor: string
  direction: number
  pendingDraw: number
  hasDrawn: boolean
  // UNO / catch window
  unoDeclared: boolean
  /** True once *we* have called it on the card we hold: one card, one call. */
  myDeclared: boolean
  /** Player the server is tracking as catchable for a missed LOCO!; null = nobody. */
  catchTarget: number | null
  unoTimerEnd: number | null
  /** Seat whose Contre-LOCO! missed and drew a card for it (rules §14.6). */
  catchFailed: { seat: number; at: number } | null
  /** Seat a Contre-LOCO! just landed on (drives the verdict stamp + penalty cards). */
  catchFlash: { seat: number; at: number } | null
  /** Last successful out-of-turn slam (drives the interception banner). */
  interruptFlash: { actorIndex: number; count: number; at: number } | null
  // Per-turn deadline
  turnDeadline: number | null
  /** The room this match is played in; '' = the built-in felt. */
  mapId: string
  /**
   * Set while the table is shut waiting for every client's map to decode, and
   * null once the server opens it. Gameplay messages are refused until then, so
   * a test that acts too early gets "waiting for every player to load the
   * table". See helpers/game.ts `waitForTableOpen`.
   */
  mapLoading: { ready: number[] } | null
  // Match / round
  matchFormat: string
  maxPlayers: number
  roundNumber: number
  roundNumber_completed: number
  scoreboard: E2EScoreEntry[]
  roundScores: E2ERoundScore[]
  roundWinner: string
  matchWinner: string
  matchOver: boolean
  /**
   * Every match this table has finished, oldest first. Kept across a rematch,
   * which is the whole point of it: the scoreboard beside it restarts.
   */
  matchHistory: Array<{ rounds_won: number[]; scores: number[]; winner_index: number }>
  showRoundSummary: boolean
  // 1v1 matchmaking
  /** True for a match that came out of the queue: no host, no rematch. */
  isMatchmade: boolean
  /** True for a 1v1 against the server: no host, and nobody to ask for another. */
  isSolo: boolean
  /** Seat that abandoned, when the match ended that way; null otherwise. */
  forfeitBy: number | null
  /** An opponent who dropped, and when their match is given away. */
  opponentAway: { seat: number; deadline: number } | null
  /** What the table is saying on the game-over screen. Dropped after a few seconds. */
  emotes: Array<{ seat: number; emote: string; at: number }>
  /** Seats that have asked for another match, and how many asks deal it. */
  rematchOffers: number[]
  rematchNeeded: number
  // Error
  errorMsg: string
  // Reconnect animation
  isReconnecting: boolean
  // Players list
  players: Array<{
    index: number
    nickname: string
    hand_size: number
    connected?: boolean
  }>
}

/** Shape of window.__LOCO_E2E__ as set by the client application. */
interface LocoE2EHelper {
  /** Send a WebSocket message through the live connection. */
  send: (msg: object) => void
  /** Return the current Zustand store state snapshot. */
  getState: () => LocoE2EState
  /** Return the current WebSocket connection status from webSocket. */
  getWsStatus: () => 'connecting' | 'open' | 'closed'
  /** Force-close the active WebSocket (dev/test seam). */
  forceCloseWs: () => void
  /**
   * Simulate clicking a card in the player's hand.
   * Calls handleCardClick which animates and dispatches play_card via WebSocket.
   * For wild cards this opens the ColorPicker; use send() with chosen_color instead.
   * For swap cards this opens the PlayerPicker; use send() with chosen_player instead.
   */
  playCard: (card: E2ECard) => void
  /**
   * Start recording every distinct `currentTurn` the store passes through.
   * Call before an action whose turn *sequence* matters, then read the result
   * with getRecordedTurns(). Avoids sampling a turn value that a bot may have
   * already moved past. Calling again resets the recording.
   */
  startTurnRecorder: () => void
  /** Distinct turn values observed since startTurnRecorder(), in order. */
  getRecordedTurns: () => number[]
}

declare interface Window {
  __LOCO_E2E__?: LocoE2EHelper
}
