import {
  CardDTO,
  CardColor,
  GameStateDTO,
  PlayerDTO,
  MatchFormat,
  ScoreboardEntryDTO,
  LatencyEntryDTO,
} from '../../types/protocol'
import type { PersistedSession, RestoreTarget } from '../sessionPersistence'

// How long other players have to punish a missed LOCO! call (server: catchWindow).
export const UNO_CATCH_WINDOW_MS = 5000

// What a missed declaration costs its owner (server: `undeclaredPenalty`). The
// banner and the penalty-card flight both state it, so it is written once here.
// Against fully exhausted piles the server hands over fewer cards (a draw never
// fails, it shrinks); the hand itself always comes from the server, so what is
// approximate in that corner case is the announcement, never the state.
export const CATCH_PENALTY_CARDS = 2

// 'restoring' is the screen a reloaded tab boots onto: we know which room and
// seat to ask for, and we have not heard back yet. It is its own screen rather
// than a flag over 'game' because the board has nothing to render at that point
// (no hand, no discard, no players), and a table drawn from an empty state
// behind an overlay is a broken table with a curtain over it.
// 'searching' and 'matchfound' are the two screens of the 1v1 queue. They are
// screens rather than flags for the same reason 'restoring' is: there is no
// board to render behind either of them, and neither has a room the player
// could act in yet.
export type AppScreen =
  | 'lobby'
  | 'searching'
  | 'matchfound'
  | 'waiting'
  | 'game'
  | 'gameover'
  | 'restoring'

export interface SwapNotice {
  kind: 'swap' | 'global_switch'
  actorIndex: number
  targetIndex: number  // -1 for global_switch
  direction: number    // game direction at the time of the play (for global_switch arrow)
  at: number           // Date.now() — the key that makes a second notice a second banner
}

/**
 * One seat the server says is on the hook, straight off `card_played`. The
 * client turns these into `CatchWindow`s and adds nothing to them but its own
 * memory of which button it has already pressed.
 */
export interface CatchSeatDTO {
  player_index: number
  ends_at: number
}

// One seat's open catch window: they hold a single card and have not declared.
export interface CatchWindow {
  seat: number
  endsAt: number
  // Set the moment we tap Contre-LOCO! on this seat. A missed call now costs a
  // card, and the server answers a few dozen milliseconds later, so a window
  // left armed in the meantime would let one impatient double tap pay twice for
  // a single opinion. The 400ms double-tap guard is not that window.
  attempted?: boolean
}

// The most recent card play, used by the renderer to fly the card from the
// acting player's seat to the discard pile. `at` doubles as a trigger key.
export interface LastPlay {
  actorIndex: number
  card: CardDTO
  at: number
}

// A successful out-of-turn interrupt. The server announces these separately
// from the resulting card_played so the client can give the steal its own
// presentation — it is the most dramatic thing that happens in a round.
export interface InterruptFlash {
  actorIndex: number
  /** Number of identical cards slammed down (batch interrupts stack). */
  count: number
  at: number
}

// A Contre-LOCO! that landed. The server names the caught seat and nothing
// else — who pressed the button is not on the wire — so this is the table's
// news: that seat owed a declaration and just paid for it.
export interface CatchFlash {
  /** The caught seat, i.e. the one taking the penalty. */
  seat: number
  at: number
}

// Per-player points earned in the most recent round (computed as delta from prevScoreboard).
export interface RoundScoreEntry {
  player_index: number
  nickname: string
  round_points: number
  cumulative_score: number
  rounds_won: number
}

/**
 * One state object, because that is what it is: the client's mirror of one
 * match. The transitions are grouped into the five interfaces below, and
 * several of them write across the groups on purpose: an authoritative
 * snapshot settles the board, the declarations and the scoreboard at once.
 */
export interface GameState {
  // --- Who we are and where ---
  screen: AppScreen
  roomCode: string
  myIndex: number
  sessionToken: string
  // Our own nickname, kept separately from `players`. A reloaded tab has no
  // player list yet and the rejoin message is built from the nickname, so
  // deriving it from the roster alone leaves a cold boot with nothing to send.
  myNickname: string
  // While screen === 'restoring', which rejoin the server is being asked for.
  // Null at every other time.
  restoreTarget: RestoreTarget | null
  errorMsg: string
  // Reconnect animation state
  isReconnecting: boolean
  // The server told this table it is being replaced (`server_updating`). The
  // match plays out to its end and nothing about it changes, so this is a line
  // of text and nothing else: no countdown, no disabled control, no urgency.
  // Cleared on reconnect, because the process that comes back may not be the
  // one that said it.
  serverUpdating: boolean

  // --- The board ---
  myHand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  direction: number
  pendingDraw: number
  hasDrawn: boolean
  turnDeadline: number | null  // unix ms when current turn expires (null = no timer)
  // The room this match is played in, straight off the wire. Server-drawn so
  // every seat sees one table; '' means the built-in felt (a lobby, or a map id
  // this client has no art for). See components/cards/maps.ts.
  mapId: string
  // Set while the table is shut waiting for everyone's assets, and null the
  // instant the server opens it. `ready` is the seats that are in, which is the loading
  // screen's whole content, and what tells a player the wait is somebody else's
  // connection rather than their own.
  mapLoading: { ready: number[] } | null
  // Transient notice shown when a Swap or GlobalSwitch resolves so players
  // understand why hands changed. Cleared by the GameView after a short timeout.
  swapNotice: SwapNotice | null
  // Last card play, purely for animation. Never used for rules decisions.
  lastPlay: LastPlay | null
  // Last successful out-of-turn interrupt, for its slam banner and sting.
  interruptFlash: InterruptFlash | null
  // Per-seat round trips, refreshed by the server's periodic `latency`
  // broadcast. Purely informational: nothing reads it for a rules decision.
  latencies: LatencyEntryDTO[]

  // --- Declarations and catches ---
  unoDeclared: boolean
  unoDeclaredByIndex: number   // playerIndex who declared UNO; -1 = unknown
  // True once WE have called it on the card we currently hold. A declaration is
  // spent: the server refuses a second one on the same single card, so the
  // button has to stop offering it. Cleared whenever a fresh obligation opens on
  // our seat (a Swap or a GlobalSwitch hands us a card nobody has heard called)
  // or our hand stops being a single card.
  myDeclared: boolean
  // Every seat that currently owes the table a declaration, with the end of its
  // 5 s window. A list rather than a single seat because a Swap or a
  // GlobalSwitch hands a single card to more than one player at once, and each
  // of them is catchable on their own. Mirrors the server's per-seat windows.
  catchWindows: CatchWindow[]
  // Derived from catchWindows for the UI: the most urgent catchable opponent
  // (never ourselves) and the end of that window. null = nobody to catch.
  catchTarget: number | null
  unoTimerEnd: number | null   // end of the 5s catch window (null = closed)
  // Whose Contre-LOCO! just missed and cost them a card. The penalty is public,
  // like the catch it lost to. Cleared by the GameView after a short timeout.
  catchFailed: { seat: number; at: number } | null
  // The mirror: a Contre-LOCO! that landed, for its slam banner, its sting and
  // the penalty cards flying to the caught seat. Cleared by the banner.
  catchFlash: CatchFlash | null

  // --- Match / round state ---
  matchFormat: MatchFormat
  maxPlayers: number
  roundNumber: number
  scoreboard: ScoreboardEntryDTO[]
  roundWinner: string
  matchWinner: string
  matchOver: boolean
  // roundHistory[k][playerIndex] = points scored in round k+1. Server-owned:
  // a reconnecting player must see the same table as everyone else, and the
  // cumulative scoreboard cannot be split back into rounds locally.
  roundHistory: number[][]
  showRoundSummary: boolean
  roundNumber_completed: number   // the round number that just finished (for display)
  roundScores: RoundScoreEntry[]  // per-player points earned this round
  pendingGameState: GameStateDTO | null // buffered next-round state (held while summary is visible)
  // buffered match-end payload (held while the final round summary is visible)
  pendingMatchEnd: { matchWinner: string; scoreboard: ScoreboardEntryDTO[] } | null
  // Seats that have asked for another match on the game-over screen. A rematch
  // is an agreement in every room, so every ask is public: the button has to be
  // able to say "they are waiting on you" as well as "you are waiting on them".
  rematchOffers: number[]
  // How many asks deal the next match: everybody still at the table. 0 until
  // the first one arrives, which is also when the count first means anything.
  rematchNeeded: number

  // --- 1v1 matchmaking ---
  // When this search began, so the searching screen can time its own wait. It
  // times it locally on purpose: the server never says how many people are in
  // the queue, and an honest "this can take a while" beats a number that reads
  // like an instruction to give up.
  searchStartedAt: number | null
  // The opponent we drew, held for the versus reveal. `startsAt` is when the
  // server deals, so the reveal counts down to something real.
  matchFound: { opponentNickname: string; mySeat: number; startsAt: number } | null
  // This match came out of the queue: no host controls, a short abandon window,
  // and a game-over screen that offers another opponent rather than a rematch.
  isMatchmade: boolean
  // The seat that abandoned, when the match ended because somebody stopped
  // being there. null = the match ended on the cards.
  forfeitBy: number | null
  // An opponent who dropped and the instant their match is given away, so the
  // board can say how long this lasts instead of freezing with no explanation.
  opponentAway: { seat: number; deadline: number } | null
  // Seats whose reconnect window ran out mid-match. Held and gone read the same
  // in the roster — both are `connected: false` — and only one of them can come
  // back, so the difference has to be remembered rather than derived. It is what
  // decides whether this player still has anybody to play against, and the
  // server answers the same question the same way (hub: table.abandonedBy).
  goneSeats: number[]
}

/** Identity, screen and the two ways out of a table. */
export interface SessionActions {
  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  setMyNickname: (nickname: string) => void
  beginRestore: (session: PersistedSession) => void
  abortRestore: (reason: string) => void
  setError: (msg: string) => void
  clearError: () => void
  setIsReconnecting: (val: boolean) => void
  setServerUpdating: (val: boolean) => void
  resetToHome: () => void
}

/** The board: what the server says is on it, and what just moved. */
export interface TableActions {
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[], chosenPlayer?: number, direction?: number, catchSeats?: CatchSeatDTO[]) => void
  applyCardDrawn: (cards: CardDTO[] | null, playerIndex: number, turn: number, hasDrawn?: boolean, drawnCount?: number, pendingDraw?: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  applyHostChange: (myIndex: number, players: PlayerDTO[]) => void
  noteSeatGone: (seat: number) => void
  setTurnDeadline: (ts: number | null) => void
  setSwapNotice: (notice: SwapNotice | null) => void
  applyInterrupt: (actorIndex: number, count: number) => void
  clearInterrupt: () => void
  applyMatchLoading: (ready: number[]) => void
  applyMatchReady: (turn: number, turnDeadline: number | null) => void
  applyLatencies: (latencies: LatencyEntryDTO[]) => void
}

/** LOCO! and Contre-LOCO!: who owes a declaration and who may punish it. */
export interface LocoActions {
  setUnoDeclared: (val: boolean) => void
  setUnoDeclaredByIndex: (idx: number) => void
  applyUnoDeclared: (declarer: number) => void
  applyUnoCaught: (seat: number) => void
  clearCatchFlash: () => void
  pruneCatchWindows: () => void
  noteCatchAttempt: (seat: number) => void
  applyCatchFailed: (seat: number) => void
  clearCatchFailed: () => void
}

/** Rounds, the summary they queue behind, the end of a match and the next one. */
export interface MatchActions {
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[], roundHistory?: number[][]) => void
  applyMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[], forfeitBy?: number) => void
  setPendingGameState: (state: GameStateDTO) => void
  setPendingMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  dismissRoundSummary: () => void
  applyRematchOffers: (offers: number[], needed: number) => void
  clearRematchOffers: () => void
  applyRematch: (myIndex: number, players: PlayerDTO[], format: MatchFormat, maxPlayers: number) => void
}

/** The 1v1 queue: the wait, the reveal, and an opponent who stopped being there. */
export interface QueueActions {
  beginSearch: () => void
  endSearch: () => void
  applyMatchFound: (found: {
    roomCode: string
    mySeat: number
    sessionToken: string
    players: PlayerDTO[]
    matchFormat: MatchFormat
    maxPlayers: number
    startsInMs: number
  }) => void
  applyOpponentAway: (seat: number, deadline: number) => void
  clearOpponentAway: (seat: number) => void
}

export type GameStore = GameState &
  SessionActions &
  TableActions &
  LocoActions &
  MatchActions &
  QueueActions
