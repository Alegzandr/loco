import { create } from 'zustand'
import { CardDTO, CardColor, GameStateDTO, PlayerDTO } from '../types/protocol'

export type AppScreen = 'lobby' | 'waiting' | 'game' | 'gameover'

interface GameStore {
  screen: AppScreen
  roomCode: string
  myIndex: number
  myHand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO | null
  activeColor: CardColor
  currentTurn: number
  direction: number
  pendingDraw: number
  winner: string
  errorMsg: string
  unoDeclared: boolean // whether someone has declared UNO this round

  setScreen: (s: AppScreen) => void
  setRoomCode: (code: string) => void
  setMyIndex: (idx: number) => void
  applyGameState: (state: GameStateDTO) => void
  applyCardPlayed: (playerIndex: number, card: CardDTO, turn: number, pendingDraw: number) => void
  applyCardDrawn: (card: CardDTO | null, playerIndex: number, turn: number) => void
  setPlayers: (players: PlayerDTO[]) => void
  setWinner: (name: string) => void
  setError: (msg: string) => void
  setUnoDeclared: (val: boolean) => void
  clearError: () => void
}

export const useGameStore = create<GameStore>((set) => ({
  screen: 'lobby',
  roomCode: '',
  myIndex: -1,
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

  setScreen: (screen) => set({ screen }),
  setRoomCode: (roomCode) => set({ roomCode }),
  setMyIndex: (myIndex) => set({ myIndex }),

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
        // This client drew a card; add to own hand
        return { myHand: [...s.myHand, card], currentTurn: turn }
      }
      // Another player drew; update their hand size
      const players = s.players.map((p) =>
        p.index === playerIndex ? { ...p, hand_size: p.hand_size + 1 } : p
      )
      return { players, currentTurn: turn }
    }),

  setPlayers: (players) => set({ players }),
  setWinner: (winner) => set({ winner, screen: 'gameover' }),
  setError: (errorMsg) => set({ errorMsg }),
  setUnoDeclared: (unoDeclared) => set({ unoDeclared }),
  clearError: () => set({ errorMsg: '' }),
}))
