import { create } from 'zustand'
import {
  CardDTO,
  CardColor,
  GameStateDTO,
  PlayerDTO,
  MatchFormat,
  ScoreboardEntryDTO,
  LatencyEntryDTO,
} from '../types/protocol'

// How long other players have to punish a missed LOCO! call (server: catchWindow).
export const UNO_CATCH_WINDOW_MS = 5000

export type AppScreen = 'lobby' | 'waiting' | 'game' | 'gameover'

export interface SwapNotice {
  kind: 'swap' | 'global_switch'
  actorIndex: number
  targetIndex: number  // -1 for global_switch
  direction: number    // game direction at the time of the play (for global_switch arrow)
  at: number           // Date.now() — used as a render key so React re-mounts the banner
}

// One seat's open catch window: they hold a single card and have not declared.
export interface CatchWindow {
  seat: number
  endsAt: number
}

// deriveCatch picks the catch the UI offers: the window closest to expiring
// among the opponents'. Ours never counts: you cannot catch yourself, and at
// one card the action bar is showing us the LOCO! button instead.
function deriveCatch(windows: CatchWindow[], myIndex: number) {
  let best: CatchWindow | null = null
  for (const w of windows) {
    if (w.seat === myIndex) continue
    if (!best || w.endsAt < best.endsAt) best = w
  }
  return { catchTarget: best ? best.seat : null, unoTimerEnd: best ? best.endsAt : null }
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

// Per-player points earned in the most recent round (computed as delta from prevScoreboard).
export interface RoundScoreEntry {
  player_index: number
  nickname: string
  round_points: number
  cumulative_score: number
  rounds_won: number
}

interface GameStore {
  screen: AppScreen
  roomCode: string
  myIndex: number
  sessionToken: string
  myHand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  direction: number
  pendingDraw: number
  hasDrawn: boolean
  errorMsg: string
  unoDeclared: boolean
  unoDeclaredByIndex: number   // playerIndex who declared UNO; -1 = unknown
  // Every seat that currently owes the table a declaration, with the end of its
  // 5 s window. A list rather than a single seat because a Swap or a
  // GlobalSwitch hands a single card to more than one player at once, and each
  // of them is catchable on their own. Mirrors the server's per-seat windows.
  catchWindows: CatchWindow[]
  // Derived from catchWindows for the UI: the most urgent catchable opponent
  // (never ourselves) and the end of that window. null = nobody to catch.
  catchTarget: number | null
  unoTimerEnd: number | null   // end of the 5s catch window (null = closed)
  turnDeadline: number | null  // unix ms when current turn expires (null = no timer)

  // Match / round state
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
  // Per-seat round trips, refreshed by the server's periodic `latency`
  // broadcast. Purely informational: nothing reads it for a rules decision.
  latencies: LatencyEntryDTO[]
  showRoundSummary: boolean
  roundNumber_completed: number   // the round number that just finished (for display)
  roundScores: RoundScoreEntry[]  // per-player points earned this round
  pendingGameState: GameStateDTO | null // buffered next-round state (held while summary is visible)
  // buffered match-end payload (held while the final round summary is visible)
  pendingMatchEnd: { matchWinner: string; scoreboard: ScoreboardEntryDTO[] } | null

  // Transient notice shown when a Swap or GlobalSwitch resolves so players
  // understand why hands changed. Cleared by the GameView after a short timeout.
  swapNotice: SwapNotice | null

  // Last card play, purely for animation. Never used for rules decisions.
  lastPlay: LastPlay | null

  // Last successful out-of-turn interrupt, for its slam banner and sting.
  interruptFlash: InterruptFlash | null

  // Reconnect animation state
  isReconnecting: boolean

  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[], chosenPlayer?: number, direction?: number) => void
  setSwapNotice: (notice: SwapNotice | null) => void
  applyInterrupt: (actorIndex: number, count: number) => void
  clearInterrupt: () => void
  applyCardDrawn: (cards: CardDTO[] | null, playerIndex: number, turn: number, hasDrawn?: boolean, drawnCount?: number, pendingDraw?: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  setUnoDeclaredByIndex: (idx: number) => void
  setUnoTimerEnd: (ts: number | null) => void
  clearCatchWindow: () => void
  closeCatchWindow: (seat: number) => void
  pruneCatchWindows: () => void
  setTurnDeadline: (ts: number | null) => void
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[], roundHistory?: number[][]) => void
  applyLatencies: (latencies: LatencyEntryDTO[]) => void
  applyMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  applyRematch: (myIndex: number, players: PlayerDTO[], format: MatchFormat, maxPlayers: number) => void
  setPendingGameState: (state: GameStateDTO) => void
  setPendingMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  applyPendingGameState: () => void
  dismissRoundSummary: () => void
  setIsReconnecting: (val: boolean) => void
  clearError: () => void
}

// makeSwapNotice returns a fresh notice for a Swap or GlobalSwitch play, or null
// for any other card kind (caller keeps the previous notice in that case).
function makeSwapNotice(
  card: CardDTO,
  actorIndex: number,
  chosenPlayer: number | null | undefined,
  direction: number,
): SwapNotice | null {
  if (card.kind === 'swap') {
    return {
      kind: 'swap',
      actorIndex,
      targetIndex: typeof chosenPlayer === 'number' ? chosenPlayer : -1,
      direction,
      at: Date.now(),
    }
  }
  if (card.kind === 'global_switch') {
    return {
      kind: 'global_switch',
      actorIndex,
      targetIndex: -1,
      direction,
      at: Date.now(),
    }
  }
  return null
}

function gameStateSliceFromDTO(state: GameStateDTO) {
  return {
    myIndex: state.your_index,
    myHand: state.hand,
    players: state.players,
    discard: state.discard,
    activeColor: state.active_color,
    currentTurn: state.turn,
    direction: state.direction,
    pendingDraw: state.pending_draw ?? 0,
    hasDrawn: state.has_drawn ?? false,
    roundNumber: state.round_number ?? 1,
    matchFormat: state.match_format ?? 'BO1',
    maxPlayers: state.max_players ?? 10,
    scoreboard: state.scoreboard ?? [],
    roundHistory: state.round_history ?? [],
    turnDeadline: state.turn_deadline ?? null,
  }
}

export const useGameStore = create<GameStore>((set, get) => ({
  screen: 'lobby',
  roomCode: '',
  myIndex: -1,
  sessionToken: '',
  myHand: [],
  players: [],
  discard: null,
  activeColor: 'red',
  currentTurn: 0,
  direction: 1,
  pendingDraw: 0,
  hasDrawn: false,
  errorMsg: '',
  unoDeclared: false,
  unoDeclaredByIndex: -1,
  catchWindows: [],
  catchTarget: null,
  unoTimerEnd: null,
  turnDeadline: null,
  matchFormat: 'BO1',
  maxPlayers: 10,
  roundNumber: 1,
  scoreboard: [],
  roundWinner: '',
  matchWinner: '',
  matchOver: false,
  roundHistory: [],
  latencies: [],
  showRoundSummary: false,
  roundNumber_completed: 0,
  roundScores: [],
  pendingGameState: null,
  pendingMatchEnd: null,
  swapNotice: null,
  lastPlay: null,
  interruptFlash: null,
  isReconnecting: false,

  setScreen: (screen) => set({ screen }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),

  applyGameState: (state) =>
    set((s) => {
      // Open catch windows are FILTERED against the snapshot, not wiped. A Swap
      // or a GlobalSwitch is followed by a personalised game_state, so clearing
      // here meant the one situation this rule exists for, a player handed
      // their last card, was never catchable by anyone. A window survives only
      // while it is unexpired and its seat still holds exactly one card, so a
      // fresh deal (nobody on one card) still clears everything.
      const now = Date.now()
      const catchWindows = s.catchWindows.filter(
        (w) =>
          w.endsAt > now &&
          state.players.find((p) => p.index === w.seat)?.hand_size === 1,
      )
      return {
        ...gameStateSliceFromDTO(state),
        roundWinner: '',
        showRoundSummary: false,
        pendingGameState: null,
        pendingMatchEnd: null,
        // The banner is cosmetic and announces the previous one-card moment; a
        // fresh authoritative snapshot must not leave it hanging.
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        catchWindows,
        ...deriveCatch(catchWindows, state.your_index),
      }
    }),

  applyCardPlayed: (playerIndex, card, turn, pendingDraw, activeColor, players, chosenPlayer, direction) =>
    set((s) => {
      // Prefer server-provided player list (includes Finished/Placement); fall back to local update
      const updatedPlayers = players
        ? players
        : s.players.map((p) =>
            p.index === playerIndex ? { ...p, hand_size: p.hand_size - 1 } : p
          )
      // Use server-authoritative active color; fall back to card color or current.
      // 'wild' is never a playable colour — it matches nothing, so the colour in
      // play carries over (this is exactly what a GlobalSwitch does).
      const resolvedColor: CardColor =
        activeColor && activeColor !== 'wild'
          ? activeColor
          : card.color === 'wild'
            ? s.activeColor
            : card.color
      // Remove the played card from local hand if it was our play
      let updatedHand = s.myHand
      if (playerIndex === s.myIndex) {
        const idx = s.myHand.findIndex(
          (c) => c.color === card.color && c.kind === card.kind && c.value === card.value
        )
        if (idx >= 0) {
          updatedHand = [...s.myHand.slice(0, idx), ...s.myHand.slice(idx + 1)]
        }
      }
      // Surface a transient notice when a hand-swapping card resolves so non-actors
      // understand why their (or others') card counts just changed.
      const resolvedDirection = typeof direction === 'number' && direction !== 0 ? direction : s.direction
      const swapNotice = makeSwapNotice(card, playerIndex, chosenPlayer, resolvedDirection) ?? s.swapNotice
      // Catch windows, mirroring the server. An ordinary play only puts the
      // actor on the hook; a Swap or a GlobalSwitch rearranges hands, so EVERY
      // seat left holding a single card owes the table a declaration: the hand
      // it holds is not one anybody has heard announced.
      const rearranged = card.kind === 'swap' || card.kind === 'global_switch'
      const onTheHook = rearranged
        ? updatedPlayers.filter((p) => p.hand_size === 1).map((p) => p.index)
        : updatedPlayers.find((p) => p.index === playerIndex)?.hand_size === 1
          ? [playerIndex]
          : []
      const now = Date.now()
      const catchWindows: CatchWindow[] = [
        ...s.catchWindows.filter((w) => w.endsAt > now && !onTheHook.includes(w.seat)),
        ...onTheHook.map((seat) => ({ seat, endsAt: now + UNO_CATCH_WINDOW_MS })),
      ]
      // Any fresh window retires the declaration banner: it announced the
      // previous one-card situation, and the table has moved on.
      const voidsBanner = onTheHook.length > 0
      return {
        myHand: updatedHand,
        discard: card,
        activeColor: resolvedColor,
        currentTurn: turn,
        direction: resolvedDirection,
        pendingDraw,
        hasDrawn: false,
        players: updatedPlayers,
        unoDeclared: voidsBanner ? false : s.unoDeclared,
        unoDeclaredByIndex: voidsBanner ? -1 : s.unoDeclaredByIndex,
        catchWindows,
        ...deriveCatch(catchWindows, s.myIndex),
        swapNotice,
        lastPlay: { actorIndex: playerIndex, card, at: Date.now() },
      }
    }),

  setSwapNotice: (swapNotice) => set({ swapNotice }),

  applyInterrupt: (actorIndex, count) =>
    set({ interruptFlash: { actorIndex, count, at: Date.now() } }),

  clearInterrupt: () => set({ interruptFlash: null }),

  applyCardDrawn: (cards, playerIndex, turn, hasDrawn, drawnCount, pendingDraw) =>
    set((s) => {
      // `has_drawn` / `pending_draw` are taken from the message, never guessed.
      // Not every card_drawn is a turn action: the UNO-catch penalty grows a hand
      // while somebody else's draw-once state is what it was, and the same
      // message reaches the whole table. Defaulting the missing flag to "drawn"
      // is what stuck a player with a disabled Draw button and a Pass the server
      // answered "you must draw a card before passing" until the turn timer ran
      // out. Absent means unchanged; the server fills both in on every card_drawn.
      const turnState = {
        currentTurn: turn,
        hasDrawn: hasDrawn ?? s.hasDrawn,
        pendingDraw: pendingDraw ?? s.pendingDraw,
      }
      if (cards && cards.length > 0) {
        return { ...turnState, myHand: [...s.myHand, ...cards] }
      }
      // Observer: update hand size by actual drawn count (default 1 for backward compat).
      const count = drawnCount ?? 1
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + count } : p
      )
      return { ...turnState, players }
    }),

  // Re-resolves myIndex from our own nickname on every roster update. The server
  // re-indexes seats when someone leaves a lobby or a finished room, so a client
  // that holds a stale index would lose host controls (or claim someone else's).
  // Nicknames are unique per room, so the match is unambiguous.
  setPlayers: (players) =>
    set((s) => {
      const myNickname = s.players.find((p) => p.index === s.myIndex)?.nickname
      if (!myNickname) return { players }
      const mine = players.find((p) => p.nickname === myNickname)
      return mine ? { players, myIndex: mine.index } : { players }
    }),
  setError: (errorMsg) => set({ errorMsg }),
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
  setUnoDeclaredByIndex: (unoDeclaredByIndex) => set({ unoDeclaredByIndex }),
  setUnoTimerEnd: (unoTimerEnd) => set({ unoTimerEnd }),
  clearCatchWindow: () => set({ catchWindows: [], catchTarget: null, unoTimerEnd: null }),

  // One seat is settled (it declared, or it was caught and took the penalty).
  // The others stay on the hook: after a GlobalSwitch there can be several, and
  // closing them all would hand the slow ones a free pass.
  closeCatchWindow: (seat) =>
    set((s) => {
      const catchWindows = s.catchWindows.filter((w) => w.seat !== seat)
      return { catchWindows, ...deriveCatch(catchWindows, s.myIndex) }
    }),

  // Drops windows whose 5 s ran out. The server enforces the same deadline, so
  // a late click would only earn an error toast.
  pruneCatchWindows: () =>
    set((s) => {
      const now = Date.now()
      const catchWindows = s.catchWindows.filter((w) => w.endsAt > now)
      if (catchWindows.length === s.catchWindows.length) return s
      return { catchWindows, ...deriveCatch(catchWindows, s.myIndex) }
    }),
  setTurnDeadline: (turnDeadline) => set({ turnDeadline }),

  setLobbyConfig: (matchFormat, maxPlayers) => set({ matchFormat, maxPlayers }),

  applyLatencies: (latencies) => set({ latencies }),

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
        catchWindows: [],
        unoTimerEnd: null,
        catchTarget: null,
      }
    }),

  applyMatchEnd: (matchWinner, scoreboard) =>
    set({ matchWinner, matchOver: true, scoreboard, screen: 'gameover' }),

  // The host reopened the finished room: drop all match state and go back to the
  // waiting room. myIndex comes from the server because pruning absent players
  // can re-seat everyone. sessionToken is deliberately kept — the room is the
  // same, so it still authenticates a reconnect during the next match.
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
      scoreboard: [],
      roundHistory: [],
      latencies: [],
      roundWinner: '',
      roundScores: [],
      roundNumber_completed: 0,
      matchWinner: '',
      matchOver: false,
      showRoundSummary: false,
      pendingGameState: null,
      pendingMatchEnd: null,
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      catchWindows: [],
      unoTimerEnd: null,
      catchTarget: null,
      turnDeadline: null,
      swapNotice: null,
      lastPlay: null,
      interruptFlash: null,
      isReconnecting: false,
      errorMsg: '',
    }),

  setPendingGameState: (pendingGameState) => set({ pendingGameState }),

  setPendingMatchEnd: (matchWinner, scoreboard) =>
    set({ pendingMatchEnd: { matchWinner, scoreboard } }),

  applyPendingGameState: () => {
    if (!get().pendingGameState) return
    get().dismissRoundSummary()
  },

  dismissRoundSummary: () => {
    const s = get()
    // Priority 1: final round — transition to game over screen.
    if (s.pendingMatchEnd) {
      set({
        matchWinner: s.pendingMatchEnd.matchWinner,
        matchOver: true,
        scoreboard: s.pendingMatchEnd.scoreboard,
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
        catchWindows: [],
        unoTimerEnd: null,
        catchTarget: null,
      })
      return
    }
    // Default: just hide the summary (e.g. BO1 game-over path).
    set({ showRoundSummary: false })
  },

  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),

  clearError: () => set({ errorMsg: '' }),
}))
