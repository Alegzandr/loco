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
  applyRoundEnd: (roundWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  applyMatchEnd: (matchWinner: string, scoreboard: ScoreboardEntryDTO[]) => void
  clearError: () => void
}

export const useGameStore = create<GameStore>((set) => ({
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

  setScreen: (screen) => set({ screen }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),
  setSessionToken: (sessionToken) => set({ sessionToken }),

  applyGameState: (state) =>
    set({
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
      roundWinner: '',
      showRoundSummary: false,
    }),

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

  applyRoundEnd: (roundWinner, scoreboard) =>
    set({ roundWinner, scoreboard, showRoundSummary: true }),

  applyMatchEnd: (matchWinner, scoreboard) =>
    set({ matchWinner, matchOver: true, scoreboard, screen: 'gameover' }),

  clearError: () => set({ errorMsg: '' }),
}))
