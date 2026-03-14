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
  winner: string
  errorMsg: string
  unoDeclared: boolean
  unoTimerEnd: number | null

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
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number) => void
  applyCardDrawn: (card: CardDTO | null, playerIndex: number, turn: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  setWinner: (name: string) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  setUnoTimerEnd: (ts: number | null) => void
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
    roundNumber: state.round_number ?? 1,
    matchFormat: state.match_format ?? 'BO1',
    maxPlayers: state.max_players ?? 10,
    scoreboard: state.scoreboard ?? [],
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
  winner: '',
  errorMsg: '',
  unoDeclared: false,
  unoTimerEnd: null,
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

  applyCardPlayed: (playerIndex, card, turn, pendingDraw) =>
    set((s) => {
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size - 1 } : p
      )
      return {
        discard: card,
        activeColor: card.color === 'wild' ? s.activeColor : card.color,
        currentTurn: turn,
        pendingDraw,
        players,
        unoDeclared: false,
      }
    }),

  applyCardDrawn: (card, playerIndex, turn) =>
    set((s) => {
      if (card) {
        return { myHand: [...s.myHand, card], currentTurn: turn }
      }
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + 1 } : p
      )
      return { players, currentTurn: turn }
    }),

  setPlayers: (players) => set({ players }),
  setWinner: (winner) => set({ winner, screen: 'gameover' }),
  setError: (errorMsg) => set({ errorMsg }),
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
  setUnoTimerEnd: (unoTimerEnd) => set({ unoTimerEnd }),

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
