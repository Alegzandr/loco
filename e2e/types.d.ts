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

/** Shape of window.__LOCO_E2E__ as set by the client application. */
interface LocoE2EHelper {
  /** Send a WebSocket message through the live connection. */
  send: (msg: object) => void
  /** Return the current Zustand store state snapshot. */
  getState: () => {
    screen: string
    myIndex: number
    currentTurn: number
    myHand: E2ECard[]
    discard: E2ECard | null
    activeColor: string
    pendingDraw: number
    hasDrawn: boolean
    showRoundSummary: boolean
    matchOver: boolean
    matchWinner: string
    players: Array<{
      index: number
      nickname: string
      hand_size: number
      connected?: boolean
      finished?: boolean
    }>
  }
  /**
   * Simulate clicking a card in the player's hand.
   * Calls handleCardClick which animates and dispatches play_card via WebSocket.
   * For wild cards this opens the ColorPicker; use send() with chosen_color instead.
   */
  playCard: (card: E2ECard) => void
}

declare interface Window {
  __LOCO_E2E__?: LocoE2EHelper
}
