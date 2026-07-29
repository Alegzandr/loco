// Zod schemas for inbound (Server → Client) protocol messages.
// ServerMsg type is inferred from these schemas in protocol.ts so that
// runtime validation and the static type stay in lockstep.
//
// Outbound ClientMsg stays hand-typed: validating what we send to ourselves
// adds little, while validating what we receive from the wire catches drift
// between Go (server/protocol/messages.go) and TS the moment a test runs.
import { z } from 'zod'

export const cardColorSchema = z.enum(['red', 'yellow', 'green', 'blue', 'wild'])
export const cardKindSchema = z.enum([
  'number',
  'skip',
  'reverse',
  'draw_two',
  'wild',
  'wild_draw_four',
  'swap',
  'global_switch',
])
export const matchFormatSchema = z.enum(['BO1', 'BO3', 'BO5', 'BO7'])

export const cardSchema = z.object({
  color: cardColorSchema,
  kind: cardKindSchema,
  value: z.number().optional(),
})

export const playerSchema = z.object({
  index: z.number(),
  nickname: z.string(),
  hand_size: z.number(),
  connected: z.boolean(),
})

export const scoreboardEntrySchema = z.object({
  player_index: z.number(),
  nickname: z.string(),
  score: z.number(),
  rounds_won: z.number(),
})

export const gameEventSchema = z.object({
  kind: z.string(),
  player_index: z.number(),
  card: cardSchema.optional(),
  chosen_color: z.string().optional(),
  at: z.number(),
})

export const gameStateSchema = z.object({
  your_index: z.number(),
  hand: z.array(cardSchema),
  players: z.array(playerSchema),
  discard: cardSchema,
  active_color: cardColorSchema,
  turn: z.number(),
  direction: z.number(),
  pending_draw: z.number().optional(),
  has_drawn: z.boolean().optional(),
  event_log: z.array(gameEventSchema).optional(),
  round_number: z.number(),
  match_format: matchFormatSchema,
  max_players: z.number(),
  scoreboard: z.array(scoreboardEntrySchema).optional(),
  turn_deadline: z.number().optional(),
})

export const serverMsgTypeSchema = z.enum([
  'room_created',
  'room_joined',
  'player_joined',
  'player_left',
  'player_disconnected',
  'player_reconnected',
  'lobby_config_changed',
  'game_started',
  'game_state',
  'card_played',
  'card_drawn',
  'turn_changed',
  'uno_declared',
  'uno_caught',
  'draw_pending',
  'interrupt_success',
  'round_end',
  'match_end',
  'rematch_started',
  'error',
])

export const serverMsgSchema = z.object({
  type: serverMsgTypeSchema,
  room_code: z.string().optional(),
  player_id: z.number().optional(),
  session_token: z.string().optional(),
  players: z.array(playerSchema).optional(),
  nickname: z.string().optional(),
  state: gameStateSchema.optional(),
  player_index: z.number().optional(),
  card: cardSchema.optional(),
  cards: z.array(cardSchema).optional(),
  drawn_count: z.number().optional(),
  active_color: cardColorSchema.optional(),
  chosen_player: z.number().optional(),
  turn: z.number().optional(),
  direction: z.number().optional(),
  turn_deadline: z.number().optional(),
  pending_draw: z.number().optional(),
  has_drawn: z.boolean().optional(),
  error: z.string().optional(),
  round_number: z.number().optional(),
  round_winner: z.string().optional(),
  scoreboard: z.array(scoreboardEntrySchema).optional(),
  match_over: z.boolean().optional(),
  match_winner: z.string().optional(),
  match_format: matchFormatSchema.optional(),
  max_players: z.number().optional(),
})
