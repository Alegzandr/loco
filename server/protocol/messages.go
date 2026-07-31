// Package protocol defines the WebSocket message types between client and server.
package protocol

// ClientMsgType enumerates message types sent from client to server.
type ClientMsgType string

const (
	// Lobby
	CMsgCreateRoom     ClientMsgType = "create_room"
	CMsgJoinRoom       ClientMsgType = "join_room"
	CMsgStartGame      ClientMsgType = "start_game"
	CMsgAddBot         ClientMsgType = "add_bot"
	CMsgSetMatchFormat ClientMsgType = "set_match_format"
	CMsgSetMaxPlayers  ClientMsgType = "set_max_players"
	// CMsgRematch returns a finished room to the lobby with the same players.
	CMsgRematch ClientMsgType = "rematch"
	// Gameplay
	CMsgPlayCard    ClientMsgType = "play_card"
	CMsgDrawCard    ClientMsgType = "draw_card"
	CMsgPassTurn    ClientMsgType = "pass_turn"
	CMsgDeclareUno  ClientMsgType = "declare_uno"
	CMsgCatchUno    ClientMsgType = "catch_uno"
	CMsgCounterDraw    ClientMsgType = "counter_draw"
	// CMsgMapReady tells the server this client has the match's map decoded and
	// is ready to play. Sent once per match, in answer to SMsgMatchLoading.
	CMsgMapReady ClientMsgType = "map_ready"
	// CMsgInterruptPlay is the realtime "lead-taking" / jump-in message.
	// Body may carry either a singular Card OR a PlayCards array (batch identical-card
	// interrupt). interrupt_play_card is accepted as an alias for the same handler.
	CMsgInterruptPlay     ClientMsgType = "interrupt_play"
	CMsgInterruptPlayCard ClientMsgType = "interrupt_play_card"
	// Dev / E2E only (requires LOCO_E2E=1 env var on the server)
	CMsgDebugSetState ClientMsgType = "debug_set_state"
)

// ServerMsgType enumerates message types sent from server to client.
type ServerMsgType string

const (
	// Lobby
	SMsgRoomCreated        ServerMsgType = "room_created"
	SMsgRoomJoined         ServerMsgType = "room_joined"
	SMsgPlayerJoined       ServerMsgType = "player_joined"
	SMsgPlayerLeft         ServerMsgType = "player_left"
	SMsgPlayerDisconnected ServerMsgType = "player_disconnected"
	SMsgPlayerReconnected  ServerMsgType = "player_reconnected"
	SMsgLobbyConfigChanged ServerMsgType = "lobby_config_changed"
	SMsgGameStarted        ServerMsgType = "game_started"
	// SMsgMatchLoading is sent right after game_started while the table waits for
	// everybody to finish downloading the map, and again on each arrival so the
	// loading screen can show who is still missing. PlayersReady names the seats
	// that are in.
	SMsgMatchLoading ServerMsgType = "match_loading"
	// SMsgMatchReady releases the table: the clock starts here, not at
	// game_started. Carries the turn deadline armed in the same instant.
	SMsgMatchReady ServerMsgType = "match_ready"
	// Gameplay state
	SMsgGameState   ServerMsgType = "game_state"
	SMsgCardPlayed  ServerMsgType = "card_played"
	SMsgCardDrawn   ServerMsgType = "card_drawn"
	SMsgTurnChanged ServerMsgType = "turn_changed"
	SMsgUnoDeclared ServerMsgType = "uno_declared"
	SMsgUnoCaught   ServerMsgType = "uno_caught"
	// SMsgCatchFailed names the seat whose Contre-LOCO! arrived too late and was
	// charged a card for it. Broadcast to the whole room: the wager is public,
	// like the catch it lost to.
	SMsgCatchFailed ServerMsgType = "catch_failed"
	SMsgDrawPending      ServerMsgType = "draw_pending"
	SMsgInterruptSuccess ServerMsgType = "interrupt_success"
	// Round / match lifecycle
	SMsgRoundEnd ServerMsgType = "round_end"
	SMsgMatchEnd ServerMsgType = "match_end"

	// SMsgLatency carries every seat's measured round-trip time. Broadcast on a
	// timer to rooms that are playing, so the in-game score table can show a
	// live ping per player without any client self-reporting.
	SMsgLatency ServerMsgType = "latency"

	// SMsgRematchStarted tells every remaining member that the finished room is
	// back in the lobby. Sent per-recipient because pruning absent players can
	// shift player indices.
	SMsgRematchStarted ServerMsgType = "rematch_started"
	// Errors
	SMsgError ServerMsgType = "error"
)

// ClientMsg is the envelope for all client-to-server messages.
type ClientMsg struct {
	Type ClientMsgType `json:"type"`

	// CMsgCreateRoom / CMsgJoinRoom
	Nickname string `json:"nickname,omitempty"`
	RoomCode string `json:"room_code,omitempty"`

	// CMsgJoinRoom reconnect: prove identity
	SessionToken string `json:"session_token,omitempty"`

	// CMsgPlayCard / CMsgCounterDraw
	Card         *CardDTO `json:"card,omitempty"`
	ChosenColor  string   `json:"chosen_color,omitempty"`
	ChosenPlayer *int     `json:"chosen_player,omitempty"` // target player index for Swap cards

	// CMsgPlayCard batch: when the player plays multiple identical cards at once.
	// All cards must be exactly equal; if PlayCards is non-empty it takes precedence
	// over the singular Card field. Swap and GlobalSwitch cannot be batch-played.
	PlayCards []CardDTO `json:"play_cards,omitempty"`

	// CMsgCatchUno: which seat is being caught. Several players can owe a
	// declaration at once (Swap / GlobalSwitch hand a single card to more than
	// one of them), so the catcher names their target. Omitted = the window
	// closest to expiring.
	TargetIndex *int `json:"target_index,omitempty"`

	// CMsgSetMatchFormat
	MatchFormat string `json:"match_format,omitempty"`

	// CMsgSetMaxPlayers
	MaxPlayers int `json:"max_players,omitempty"`

	// CMsgDebugSetState — dev/E2E only (guarded by LOCO_E2E=1 server env var).
	// Any combination of fields may be provided; omitted fields are left unchanged.
	DebugHand        []CardDTO              `json:"debug_hand,omitempty"`          // replace this player's hand
	DebugHands       []DebugHandOverrideDTO `json:"debug_hands,omitempty"`         // replace arbitrary players' hands
	DebugDiscard     *CardDTO               `json:"debug_discard,omitempty"`       // replace top of discard pile
	DebugActiveColor string                 `json:"debug_active_color,omitempty"`  // override active color
	DebugPendingDraw *int                   `json:"debug_pending_draw,omitempty"`  // override pending draw count
	DebugCurrentTurn *int                   `json:"debug_current_turn,omitempty"`  // override current turn player index
	DebugDirection   *int                   `json:"debug_direction,omitempty"`     // override play direction (1 cw, -1 ccw)
}

// DebugHandOverrideDTO is one per-player hand replacement used by debug_set_state.
type DebugHandOverrideDTO struct {
	PlayerIndex int       `json:"player_index"`
	Hand        []CardDTO `json:"hand"`
}

// CardDTO is the wire representation of a card.
type CardDTO struct {
	Color string `json:"color"`
	Kind  string `json:"kind"`
	Value int    `json:"value,omitempty"`
}

// ScoreboardEntryDTO is one player's match-level score summary.
type ScoreboardEntryDTO struct {
	PlayerIndex int    `json:"player_index"`
	Nickname    string `json:"nickname"`
	Score       int    `json:"score"`
	RoundsWon   int    `json:"rounds_won"`
}

// LatencyEntryDTO is one seat's measured round-trip time.
type LatencyEntryDTO struct {
	PlayerIndex int `json:"player_index"`
	// RTTMs is the smoothed WebSocket ping/pong round trip in milliseconds,
	// or -1 when nothing has been measured yet (bots, a seat that just
	// connected, a player inside their reconnect window).
	RTTMs int  `json:"rtt_ms"`
	Bot   bool `json:"bot,omitempty"`
}

// ServerMsg is the envelope for all server-to-client messages.
type ServerMsg struct {
	Type ServerMsgType `json:"type"`

	// SMsgRoomCreated / SMsgRoomJoined / SMsgPlayerReconnected (self)
	RoomCode     string `json:"room_code,omitempty"`
	PlayerID     int    `json:"player_id,omitempty"`
	SessionToken string `json:"session_token,omitempty"` // opaque token for reconnect auth

	// Player lists and nicknames
	Players  []PlayerDTO `json:"players,omitempty"`
	Nickname string      `json:"nickname,omitempty"`

	// SMsgGameStarted / SMsgGameState / SMsgPlayerReconnected (self)
	State *GameStateDTO `json:"state,omitempty"`

	// SMsgCardPlayed / SMsgCardDrawn / SMsgUnoDeclared / SMsgUnoCaught /
	// SMsgCatchFailed / SMsgInterruptSuccess / SMsgPlayerDisconnected /
	// SMsgPlayerReconnected:
	// the seat the message is about.
	//
	// A pointer for the same reason as PendingDraw/HasDrawn below: `omitempty`
	// drops a zero, and seat 0 is the host's seat. The client closes the catch
	// window on the seat named by uno_declared, so an absent player_index left
	// it open — Contre-LOCO! stayed armed on a player who had already called it
	// and the server refused every tap with "player already declared".
	// Read it with Seat(); absent means "this message names no seat".
	PlayerIndex *int     `json:"player_index,omitempty"`
	Card        *CardDTO `json:"card,omitempty"`
	ActiveColor string   `json:"active_color,omitempty"` // authoritative active color after card play
	// Set only when a Swap card resolves: the target player index whose hand was exchanged
	// with the actor's hand. Lets clients show a "X swapped with Y" notification without
	// exposing hand contents to non-participants.
	ChosenPlayer *int `json:"chosen_player,omitempty"`

	// SMsgTurnChanged.
	//
	// No omitempty, deliberately: seat 0 is a turn like any other, and dropping
	// it would leave every client to infer whose turn it is from an absence.
	// The client happens to default to 0, so this was correct by luck — the same
	// luck PlayerIndex did not have. A few bytes on every message is the price of
	// never having to think about it again.
	Turn int `json:"turn"`

	// Play direction (1 = clockwise, -1 = counter-clockwise) AFTER any card effect
	// has been applied. Included in card_played so clients can update their
	// direction indicator immediately without waiting for the next game_state.
	Direction int `json:"direction,omitempty"`

	// Per-turn deadline: unix milliseconds when the current turn expires (0 = no timer active)
	// Included in card_played, card_drawn, turn_changed, and game_started to let clients
	// display and reset the countdown when a new turn begins.
	TurnDeadline int64 `json:"turn_deadline,omitempty"`

	// SMsgDrawPending / SMsgCardPlayed / SMsgCardDrawn: the authoritative turn
	// state AFTER the event.
	//
	// Pointers, not plain values: `omitempty` drops a false bool and a zero int
	// from the wire, so the receiver has to invent the missing value — and it
	// guesses wrong exactly where it hurts. A hand can grow without the current
	// player having drawn (UNO-catch penalty), and a client that read the absent
	// has_drawn as "true" then disabled its own Draw button and had every Pass
	// refused with "you must draw a card before passing" until the turn timer
	// bailed it out. Absent now means "unchanged", and every sender fills them in.
	PendingDraw *int  `json:"pending_draw,omitempty"`
	HasDrawn    *bool `json:"has_drawn,omitempty"`

	// SMsgCardDrawn: multiple cards drawn at once (penalty draw)
	// Cards holds all drawn cards for the drawing player; DrawnCount tells observers how many.
	Cards []*CardDTO `json:"cards,omitempty"`
	// No omitempty for the same reason as Turn, and here it was not luck: a draw
	// against exhausted piles hands over nothing, and the client's fallback for
	// an absent count was 1 — so every observer would have added a card nobody
	// drew, to a hand the server never grew.
	DrawnCount int `json:"drawn_count"`

	// SMsgRoundEnd / SMsgMatchEnd
	RoundNumber int                  `json:"round_number,omitempty"`
	RoundWinner string               `json:"round_winner,omitempty"`
	Scoreboard  []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
	MatchOver   bool                 `json:"match_over,omitempty"`
	MatchWinner string               `json:"match_winner,omitempty"`
	// RoundHistory[k][playerIndex] = points scored in round k+1. Sent with
	// round_end so the score table updates without waiting for the next
	// game_state (which the client buffers behind the round summary).
	RoundHistory [][]int `json:"round_history,omitempty"`

	// SMsgLatency
	Latencies []LatencyEntryDTO `json:"latencies,omitempty"`

	// SMsgLobbyConfigChanged
	MatchFormat string `json:"match_format,omitempty"`
	MaxPlayers  int    `json:"max_players,omitempty"`

	// SMsgMatchLoading: the seats whose client has the map decoded.
	//
	// `omitempty` is safe here, unlike on PlayerIndex/PendingDraw: this field
	// appears on exactly one message type, so an absent list can only mean "no
	// seat is ready yet": there is no earlier value it could be leaving
	// unchanged. Keeping it omittable also keeps it off every other broadcast.
	PlayersReady []int `json:"players_ready,omitempty"`

	// SMsgError
	Error string `json:"error,omitempty"`
}

// Seat returns the seat this message is about, or -1 when it names none.
func (m ServerMsg) Seat() int {
	if m.PlayerIndex == nil {
		return -1
	}
	return *m.PlayerIndex
}

// PlayerDTO is the public view of a player.
type PlayerDTO struct {
	Index     int    `json:"index"`
	Nickname  string `json:"nickname"`
	HandSize  int    `json:"hand_size"`
	Connected bool   `json:"connected"`
}

// GameEventDTO is the wire representation of a game event.
type GameEventDTO struct {
	Kind        string   `json:"kind"`
	PlayerIndex int      `json:"player_index"`
	Card        *CardDTO `json:"card,omitempty"`
	ChosenColor string   `json:"chosen_color,omitempty"`
	At          int64    `json:"at"` // unix milliseconds
}

// GameStateDTO is the per-player view of the game state sent on join/start.
type GameStateDTO struct {
	YourIndex   int            `json:"your_index"`
	Hand        []CardDTO      `json:"hand"`
	Players     []PlayerDTO    `json:"players"`
	Discard     CardDTO        `json:"discard"`
	ActiveColor string         `json:"active_color"`
	Turn        int            `json:"turn"`
	Direction   int            `json:"direction"`
	PendingDraw int            `json:"pending_draw,omitempty"`
	HasDrawn    bool           `json:"has_drawn,omitempty"`
	EventLog    []GameEventDTO `json:"event_log,omitempty"`

	// Match info
	RoundNumber int                  `json:"round_number"`
	MatchFormat string               `json:"match_format"`
	MaxPlayers  int                  `json:"max_players"`
	// MapID names the room this match is played in (see game/maps.go). Rides
	// every snapshot rather than only game_started so a reconnecting player
	// rebuilds the same table as everybody else. Empty = the built-in felt.
	MapID string `json:"map_id,omitempty"`
	Scoreboard  []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
	// RoundHistory[k][playerIndex] = points scored in round k+1 (see ServerMsg).
	// Included in every snapshot so a reconnecting player recovers the table.
	RoundHistory [][]int `json:"round_history,omitempty"`

	// Per-turn deadline: unix milliseconds when the current turn expires (0 = no timer active)
	TurnDeadline int64 `json:"turn_deadline,omitempty"`
}
