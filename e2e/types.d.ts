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
  unoTimerEnd: number | null
  // Per-turn deadline
  turnDeadline: number | null
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
  showRoundSummary: boolean
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
  /** Return the current WebSocket connection status from useWebSocket. */
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
