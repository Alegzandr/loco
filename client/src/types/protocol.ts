// Protocol types matching server/protocol/messages.go
//
// Inbound (Server → Client) shapes are inferred from Zod schemas in
// protocolSchemas.ts so runtime validation and the static type cannot drift
// apart. Outbound (Client → Server) shapes stay hand-typed.
import type { z } from 'zod'
import type {
  cardSchema,
  playerSchema,
  scoreboardEntrySchema,
  gameEventSchema,
  gameStateSchema,
  serverMsgSchema,
  serverMsgTypeSchema,
} from './protocolSchemas'

export type CardColor = 'red' | 'yellow' | 'green' | 'blue' | 'wild'
export type CardKind = 'number' | 'skip' | 'reverse' | 'draw_two' | 'wild' | 'wild_draw_four' | 'swap' | 'global_switch'
export type MatchFormat = 'BO1' | 'BO3' | 'BO5' | 'BO7'

export type CardDTO = z.infer<typeof cardSchema>
export type PlayerDTO = z.infer<typeof playerSchema>
export type ScoreboardEntryDTO = z.infer<typeof scoreboardEntrySchema>
export type GameEventDTO = z.infer<typeof gameEventSchema>
export type GameStateDTO = z.infer<typeof gameStateSchema>

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
  | 'debug_set_state'

export interface DebugHandOverrideDTO {
  player_index: number
  hand: CardDTO[]
}

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
  // debug_set_state — dev/E2E only (server requires LOCO_E2E=1)
  debug_hand?: CardDTO[]
  debug_hands?: DebugHandOverrideDTO[]
  debug_discard?: CardDTO
  debug_active_color?: CardColor
  debug_pending_draw?: number
  debug_current_turn?: number
}

// Server → Client
export type ServerMsgType = z.infer<typeof serverMsgTypeSchema>
export type ServerMsg = z.infer<typeof serverMsgSchema>
