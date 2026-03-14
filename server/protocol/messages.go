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
	// Gameplay
	CMsgPlayCard    ClientMsgType = "play_card"
	CMsgDrawCard    ClientMsgType = "draw_card"
	CMsgPassTurn    ClientMsgType = "pass_turn"
	CMsgDeclareUno  ClientMsgType = "declare_uno"
	CMsgCatchUno    ClientMsgType = "catch_uno"
	CMsgCounterDraw ClientMsgType = "counter_draw"
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
	// Gameplay state
	SMsgGameState   ServerMsgType = "game_state"
	SMsgCardPlayed  ServerMsgType = "card_played"
	SMsgCardDrawn   ServerMsgType = "card_drawn"
	SMsgTurnChanged ServerMsgType = "turn_changed"
	SMsgUnoDeclared ServerMsgType = "uno_declared"
	SMsgUnoCaught   ServerMsgType = "uno_caught"
	SMsgDrawPending ServerMsgType = "draw_pending"
	// Round / match lifecycle
	SMsgRoundEnd ServerMsgType = "round_end"
	SMsgMatchEnd ServerMsgType = "match_end"
	SMsgGameOver ServerMsgType = "game_over"
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
	Card        *CardDTO `json:"card,omitempty"`
	ChosenColor string   `json:"chosen_color,omitempty"`

	// CMsgSetMatchFormat
	MatchFormat string `json:"match_format,omitempty"`

	// CMsgSetMaxPlayers
	MaxPlayers int `json:"max_players,omitempty"`
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

	// SMsgCardPlayed
	PlayerIndex int      `json:"player_index,omitempty"`
	Card        *CardDTO `json:"card,omitempty"`

	// SMsgTurnChanged
	Turn int `json:"turn,omitempty"`

	// SMsgDrawPending
	PendingDraw int `json:"pending_draw,omitempty"`

	// SMsgRoundEnd / SMsgMatchEnd
	RoundNumber int                  `json:"round_number,omitempty"`
	RoundWinner string               `json:"round_winner,omitempty"`
	Scoreboard  []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
	MatchOver   bool                 `json:"match_over,omitempty"`
	MatchWinner string               `json:"match_winner,omitempty"`

	// SMsgGameOver (legacy single-round / match_over)
	Winner string `json:"winner,omitempty"`

	// SMsgLobbyConfigChanged
	MatchFormat string `json:"match_format,omitempty"`
	MaxPlayers  int    `json:"max_players,omitempty"`

	// SMsgError
	Error string `json:"error,omitempty"`
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
	EventLog    []GameEventDTO `json:"event_log,omitempty"`

	// Match info
	RoundNumber int                  `json:"round_number"`
	MatchFormat string               `json:"match_format"`
	MaxPlayers  int                  `json:"max_players"`
	Scoreboard  []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
}
