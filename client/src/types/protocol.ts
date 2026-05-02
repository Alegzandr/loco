// Protocol types matching server/protocol/messages.go

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild'
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw_two' | 'wild' | 'wild_draw_four' | 'swap' | 'global_switch'
export type MatchFormat = 'BO1' | 'BO3' | 'BO5' | 'BO7'

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

export interface ScoreboardEntryDTO {
  player_index: number
  nickname: string
  score: number
  rounds_won: number
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
  has_drawn?: boolean
  event_log?: GameEventDTO[]
  round_number: number
  match_format: MatchFormat
  max_players: number
  scoreboard?: ScoreboardEntryDTO[]
  turn_deadline?: number  // unix ms when the current turn expires (0 = no timer)
}

export interface GameEventDTO {
  kind: string
  player_index: number
  card?: CardDTO
  chosen_color?: string
  at: number
}

// Client → Server
export type ClientMsgType =
  | 'create_room'
  | 'join_room'
  | 'start_game'
  | 'add_bot'
  | 'set_match_format'
  | 'set_max_players'
  | 'play_card'
  | 'draw_card'
  | 'pass_turn'
  | 'declare_uno'
  | 'catch_uno'
  | 'counter_draw'
  | 'interrupt_play'
  | 'interrupt_play_card'

export interface ClientMsg {
  type: ClientMsgType
  nickname?: string
  room_code?: string
  session_token?: string
  card?: CardDTO
  play_cards?: CardDTO[]  // batch identical-card play (takes precedence over card)
  chosen_color?: CardColor
  chosen_player?: number
  match_format?: MatchFormat
  max_players?: number
}

// Server → Client
export type ServerMsgType =
  | 'room_created'
  | 'room_joined'
  | 'player_joined'
  | 'player_left'
  | 'player_disconnected'
  | 'player_reconnected'
  | 'lobby_config_changed'
  | 'game_started'
  | 'game_state'
  | 'card_played'
  | 'card_drawn'
  | 'turn_changed'
  | 'uno_declared'
  | 'uno_caught'
  | 'draw_pending'
  | 'interrupt_success'
  | 'round_end'
  | 'match_end'
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
  cards?: CardDTO[]     // all drawn cards for the drawing player (card_drawn penalty draw); also: interrupt_success batch cards
  drawn_count?: number  // how many cards an opponent drew (card_drawn observer broadcast)
  active_color?: CardColor
  chosen_player?: number  // swap target index; only set on card_played for Swap kind
  turn?: number
  turn_deadline?: number  // unix ms when the current turn expires; included in card_played, card_drawn, turn_changed, game_started
  pending_draw?: number
  has_drawn?: boolean
  winner?: string
  error?: string
  // round / match
  round_number?: number
  round_winner?: string
  scoreboard?: ScoreboardEntryDTO[]
  match_over?: boolean
  match_winner?: string
  // lobby config
  match_format?: MatchFormat
  max_players?: number
}
