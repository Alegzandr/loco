// Package protocol defines the WebSocket message types between client and server.
package protocol

// ClientMsgType enumerates message types sent from client to server.
type ClientMsgType string

const (
	// Lobby
	CMsgCreateRoom  ClientMsgType = "create_room"
	CMsgJoinRoom    ClientMsgType = "join_room"
	CMsgStartGame   ClientMsgType = "start_game"
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
	SMsgRoomCreated      ServerMsgType = "room_created"
	SMsgRoomJoined       ServerMsgType = "room_joined"
	SMsgPlayerJoined     ServerMsgType = "player_joined"
	SMsgPlayerLeft       ServerMsgType = "player_left"
	SMsgPlayerDisconnected ServerMsgType = "player_disconnected"
	SMsgPlayerReconnected  ServerMsgType = "player_reconnected"
	SMsgGameStarted      ServerMsgType = "game_started"
	// Gameplay state
	SMsgGameState   ServerMsgType = "game_state"
	SMsgCardPlayed  ServerMsgType = "card_played"
	SMsgCardDrawn   ServerMsgType = "card_drawn"
	SMsgTurnChanged ServerMsgType = "turn_changed"
	SMsgUnoDeclared ServerMsgType = "uno_declared"
	SMsgUnoCaught   ServerMsgType = "uno_caught"
	SMsgDrawPending ServerMsgType = "draw_pending"
	SMsgGameOver    ServerMsgType = "game_over"
	// Errors
	SMsgError ServerMsgType = "error"
)

// ClientMsg is the envelope for all client-to-server messages.
type ClientMsg struct {
	Type ClientMsgType `json:"type"`

	// CMsgCreateRoom / CMsgJoinRoom
	Nickname string `json:"nickname,omitempty"`
	RoomCode string `json:"room_code,omitempty"`

	// CMsgPlayCard / CMsgCounterDraw
	Card        *CardDTO `json:"card,omitempty"`
	ChosenColor string   `json:"chosen_color,omitempty"`
}

// CardDTO is the wire representation of a card.
type CardDTO struct {
	Color string `json:"color"`
	Kind  string `json:"kind"`
	Value int    `json:"value,omitempty"`
}

// ServerMsg is the envelope for all server-to-client messages.
type ServerMsg struct {
	Type ServerMsgType `json:"type"`

	// SMsgRoomCreated / SMsgRoomJoined / SMsgPlayerReconnected (self)
	RoomCode string `json:"room_code,omitempty"`
	PlayerID int    `json:"player_id,omitempty"`

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

	// SMsgGameOver
	Winner string `json:"winner,omitempty"`

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

// GameStateDTO is the per-player view of the game state sent on join/start.
type GameStateDTO struct {
	YourIndex   int         `json:"your_index"`
	Hand        []CardDTO   `json:"hand"`
	Players     []PlayerDTO `json:"players"`
	Discard     CardDTO     `json:"discard"`
	ActiveColor string      `json:"active_color"`
	Turn        int         `json:"turn"`
	Direction   int         `json:"direction"`
	PendingDraw int         `json:"pending_draw,omitempty"`
}
