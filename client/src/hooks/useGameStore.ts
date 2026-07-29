import { create } from 'zustand'
import {
  CardDTO,
  CardColor,
  GameStateDTO,
  PlayerDTO,
  MatchFormat,
  ScoreboardEntryDTO,
} from '../types/protocol'

export type AppScreen = 'lobby' | 'waiting' | 'game' | 'gameover'

export interface SwapNotice {
  kind: 'swap' | 'global_switch'
  actorIndex: number
  targetIndex: number  // -1 for global_switch
  direction: number    // game direction at the time of the play (for global_switch arrow)
  at: number           // Date.now() — used as a render key so React re-mounts the banner
}

// The most recent card play, used by the renderer to fly the card from the
// acting player's seat to the discard pile. `at` doubles as a trigger key.
export interface LastPlay {
  actorIndex: number
  card: CardDTO
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
  unoTimerEnd: number | null
  turnDeadline: number | null  // unix ms when current turn expires (null = no timer)

  // Match / round state
  matchFormat: MatchFormat
  maxPlayers: number
  roundNumber: number
  scoreboard: ScoreboardEntryDTO[]
  roundWinner: string
  matchWinner: string
  matchOver: boolean
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

  // Reconnect animation state
  isReconnecting: boolean

  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[], chosenPlayer?: number, direction?: number) => void
  setSwapNotice: (notice: SwapNotice | null) => void
  applyCardDrawn: (cards: CardDTO[] | null, playerIndex: number, turn: number, hasDrawn?: boolean, drawnCount?: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  setUnoDeclaredByIndex: (idx: number) => void
  setUnoTimerEnd: (ts: number | null) => void
  setTurnDeadline: (ts: number | null) => void
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[]) => void
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
  unoTimerEnd: null,
  turnDeadline: null,
  matchFormat: 'BO1',
  maxPlayers: 10,
  roundNumber: 1,
  scoreboard: [],
  roundWinner: '',
  matchWinner: '',
  matchOver: false,
  showRoundSummary: false,
  roundNumber_completed: 0,
  roundScores: [],
  pendingGameState: null,
  pendingMatchEnd: null,
  swapNotice: null,
  lastPlay: null,
  isReconnecting: false,

  setScreen: (screen) => set({ screen }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),

  applyGameState: (state) =>
    set({
      ...gameStateSliceFromDTO(state),
      roundWinner: '',
      showRoundSummary: false,
      pendingGameState: null,
      pendingMatchEnd: null,
      // Reset UNO catch-window state — a fresh authoritative snapshot must not
      // leave a stale UNO banner / catch button from the previous round visible.
      unoDeclared: false,
      unoDeclaredByIndex: -1,
      unoTimerEnd: null,
    }),

  applyCardPlayed: (playerIndex, card, turn, pendingDraw, activeColor, players, chosenPlayer, direction) =>
    set((s) => {
      // Prefer server-provided player list (includes Finished/Placement); fall back to local update
      const updatedPlayers = players
        ? players
        : s.players.map((p) =>
            p.index === playerIndex ? { ...p, hand_size: p.hand_size - 1 } : p
          )
      // Use server-authoritative active color; fall back to card color or current
      const resolvedColor: CardColor = activeColor
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
      return {
        myHand: updatedHand,
        discard: card,
        activeColor: resolvedColor,
        currentTurn: turn,
        direction: resolvedDirection,
        pendingDraw,
        hasDrawn: false,
        players: updatedPlayers,
        unoDeclared: false,
        unoDeclaredByIndex: -1,
        swapNotice,
        lastPlay: { actorIndex: playerIndex, card, at: Date.now() },
      }
    }),

  setSwapNotice: (swapNotice) => set({ swapNotice }),

  applyCardDrawn: (cards, playerIndex, turn, hasDrawn, drawnCount) =>
    set((s) => {
      // A penalty draw advances the turn away from the drawing player.
      // Use this to reset pendingDraw to 0 for all clients.
      const isPenaltyDraw = turn !== s.currentTurn
      if (cards && cards.length > 0) {
        // Own draw: add all drawn cards to hand, reset pendingDraw if penalty.
        return {
          myHand: [...s.myHand, ...cards],
          currentTurn: turn,
          hasDrawn: hasDrawn ?? s.hasDrawn,
          pendingDraw: isPenaltyDraw ? 0 : s.pendingDraw,
        }
      }
      // Observer: update hand size by actual drawn count (default 1 for backward compat).
      const count = drawnCount ?? 1
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + count } : p
      )
      // Penalty draw resets hasDrawn and clears pendingDraw stack.
      const newHasDrawn = isPenaltyDraw ? false : s.hasDrawn
      return {
        players,
        currentTurn: turn,
        hasDrawn: newHasDrawn,
        pendingDraw: isPenaltyDraw ? 0 : s.pendingDraw,
      }
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
  setTurnDeadline: (turnDeadline) => set({ turnDeadline }),

  setLobbyConfig: (matchFormat, maxPlayers) => set({ matchFormat, maxPlayers }),

  applyRoundEnd: (roundWinner, roundNumber, newScoreboard) =>
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
        roundScores,
        showRoundSummary: true,
        turnDeadline: null,
        unoDeclared: false,
        unoTimerEnd: null,
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
      unoTimerEnd: null,
      turnDeadline: null,
      swapNotice: null,
      lastPlay: null,
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
        unoTimerEnd: null,
      })
      return
    }
    // Default: just hide the summary (e.g. BO1 game-over path).
    set({ showRoundSummary: false })
  },

  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),

  clearError: () => set({ errorMsg: '' }),
}))
