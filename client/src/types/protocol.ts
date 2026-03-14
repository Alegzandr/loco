// Protocol types matching server/protocol/messages.go

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild'
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw_two' | 'wild' | 'wild_draw_four'

export interface CardDTO {
  color: CardColor
  kind: CardKind
  value?: number
}

export interface PlayerDTO {
  index: number
  nickname: string
  hand_size: number
  connected: boolean
}

export interface GameStateDTO {
  your_index: number
  hand: CardDTO[]
  players: PlayerDTO[]
  discard: CardDTO
  active_color: CardColor
  turn: number
  direction: number
  pending_draw?: number
}

// Client → Server
export type ClientMsgType =
  | 'create_room'
  | 'join_room'
  | 'start_game'
  | 'add_bot'
  | 'play_card'
  | 'draw_card'
  | 'pass_turn'
  | 'declare_uno'
  | 'catch_uno'
  | 'counter_draw'

export interface ClientMsg {
  type: ClientMsgType
  nickname?: string
  room_code?: string
  session_token?: string
  card?: CardDTO
  chosen_color?: CardColor
}

// Server → Client
export type ServerMsgType =
  | 'room_created'
  | 'room_joined'
  | 'player_joined'
  | 'player_left'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'game_started'
  | 'game_state'
  | 'card_played'
  | 'card_drawn'
  | 'turn_changed'
  | 'uno_declared'
  | 'uno_caught'
  | 'draw_pending'
  | 'game_over'
  | 'error'

export interface ServerMsg {
  type: ServerMsgType
  room_code?: string
  player_id?: number
  session_token?: string
  players?: PlayerDTO[]
  nickname?: string
  state?: GameStateDTO
  player_index?: number
  card?: CardDTO
  turn?: number
  pending_draw?: number
  winner?: string
  error?: string
}
