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
  winner: string
  errorMsg: string
  unoDeclared: boolean
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

  // Reconnect animation state
  isReconnecting: boolean

  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  setSessionToken: (token: string) => void
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number, activeColor: CardColor | undefined, players?: PlayerDTO[]) => void
  applyCardDrawn: (card: CardDTO | null, playerIndex: number, turn: number, hasDrawn?: boolean) => void
  setPlayers: (players: PlayerDTO[]) => void
  setWinner: (name: string) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  setUnoTimerEnd: (ts: number | null) => void
  setTurnDeadline: (ts: number | null) => void
  setLobbyConfig: (format: MatchFormat, maxPlayers: number) => void
  applyRoundEnd: (roundWinner: string, roundNumber: number, scoreboard: ScoreboardEntryDTO[]) => void
  applyMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  setPendingGameState: (state: GameStateDTO) => void
  applyPendingGameState: () => void
  dismissRoundSummary: () => void
  setIsReconnecting: (val: boolean) => void
  clearError: () => void
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
  winner: '',
  errorMsg: '',
  unoDeclared: false,
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
  isReconnecting: false,

  setScreen: (screen) => set({ screen }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),

  applyGameState: (state) =>
    set({ ...gameStateSliceFromDTO(state), roundWinner: '', showRoundSummary: false, pendingGameState: null }),

  applyCardPlayed: (playerIndex, card, turn, pendingDraw, activeColor, players) =>
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
      return {
        myHand: updatedHand,
        discard: card,
        activeColor: resolvedColor,
        currentTurn: turn,
        pendingDraw,
        hasDrawn: false,
        players: updatedPlayers,
        unoDeclared: false,
      }
    }),

  applyCardDrawn: (card, playerIndex, turn, hasDrawn) =>
    set((s) => {
      if (card) {
        // Own draw: add card to hand, update hasDrawn from server
        return { myHand: [...s.myHand, card], currentTurn: turn, hasDrawn: hasDrawn ?? s.hasDrawn }
      }
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + 1 } : p
      )
      // Turn changed (penalty draw advances turn): reset hasDrawn
      const newHasDrawn = turn !== s.currentTurn ? false : s.hasDrawn
      return { players, currentTurn: turn, hasDrawn: newHasDrawn }
    }),

  setPlayers: (players) => set({ players }),
  setWinner: (winner) => set({ winner, screen: 'gameover' }),
  setError: (errorMsg) => set({ errorMsg }),
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
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
      }
    }),

  applyMatchEnd: (matchWinner, scoreboard) =>
    set({ matchWinner, matchOver: true, scoreboard, screen: 'gameover' }),

  setPendingGameState: (pendingGameState) => set({ pendingGameState }),

  applyPendingGameState: () => {
    if (!get().pendingGameState) return
    get().dismissRoundSummary()
  },

  dismissRoundSummary: () => {
    const s = get()
    if (s.pendingGameState) {
      set({ ...gameStateSliceFromDTO(s.pendingGameState), roundWinner: '', showRoundSummary: false, pendingGameState: null })
    } else {
      set({ showRoundSummary: false })
    }
  },

  setIsReconnecting: (isReconnecting) => set({ isReconnecting }),

  clearError: () => set({ errorMsg: '' }),
}))
