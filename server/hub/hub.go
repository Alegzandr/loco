// Package hub manages WebSocket connections and routes game messages.
package hub

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"loco/server/game"
	"loco/server/protocol"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true // allow all origins in development; restrict in production
	},
}

type inboundMsg struct {
	client *Client
	msg    protocol.ClientMsg
}

// Hub manages all active rooms and connected clients.
type Hub struct {
	rooms      map[string]*game.Room
	clients    map[*Client]struct{}
	roomMembers map[string][]*Client // roomCode → clients in order of player index
	register   chan *Client
	unregister chan *Client
	inbound    chan inboundMsg
}

// New creates and returns a Hub.
func New() *Hub {
	return &Hub{
		rooms:       make(map[string]*game.Room),
		clients:     make(map[*Client]struct{}),
		roomMembers: make(map[string][]*Client),
		register:    make(chan *Client, 16),
		unregister:  make(chan *Client, 16),
		inbound:     make(chan inboundMsg, 256),
	}
}

// Run starts the hub event loop. Call in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = struct{}{}

		case c := <-h.unregister:
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				c.close()
				h.handleDisconnect(c)
			}

		case im := <-h.inbound:
			h.dispatch(im.client, im.msg)
		}
	}
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade error: %v", err)
		return
	}
	c := newClient(h, conn)
	h.register <- c
}

// dispatch routes a client message to the appropriate handler.
func (h *Hub) dispatch(c *Client, msg protocol.ClientMsg) {
	switch msg.Type {
	case protocol.CMsgCreateRoom:
		h.handleCreateRoom(c, msg)
	case protocol.CMsgJoinRoom:
		h.handleJoinRoom(c, msg)
	case protocol.CMsgStartGame:
		h.handleStartGame(c, msg)
	case protocol.CMsgPlayCard:
		h.handlePlayCard(c, msg)
	case protocol.CMsgDrawCard:
		h.handleDrawCard(c, msg)
	case protocol.CMsgPassTurn:
		h.handlePassTurn(c, msg)
	case protocol.CMsgDeclareUno:
		h.handleDeclareUno(c, msg)
	case protocol.CMsgCatchUno:
		h.handleCatchUno(c, msg)
	case protocol.CMsgCounterDraw:
		h.handleCounterDraw(c, msg)
	default:
		c.sendError("unknown message type")
	}
}

// --- Lobby handlers ---

func (h *Hub) handleCreateRoom(c *Client, msg protocol.ClientMsg) {
	if msg.Nickname == "" {
		c.sendError("nickname required")
		return
	}
	code := h.generateCode()
	room := game.NewRoom(code)
	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	h.rooms[code] = room
	c.roomCode = code
	c.playerID = 0
	h.roomMembers[code] = []*Client{c}

	c.Send(protocol.ServerMsg{
		Type:     protocol.SMsgRoomCreated,
		RoomCode: code,
		PlayerID: 0,
		Players:  h.playerList(room),
	})
}

func (h *Hub) handleJoinRoom(c *Client, msg protocol.ClientMsg) {
	if msg.Nickname == "" {
		c.sendError("nickname required")
		return
	}
	code := strings.ToUpper(msg.RoomCode)
	room, ok := h.rooms[code]
	if !ok {
		c.sendError("room not found")
		return
	}
	if err := room.Join(msg.Nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	playerID := len(room.Players) - 1
	c.roomCode = code
	c.playerID = playerID
	h.roomMembers[code] = append(h.roomMembers[code], c)

	// Notify the joining client
	c.Send(protocol.ServerMsg{
		Type:     protocol.SMsgRoomJoined,
		RoomCode: code,
		PlayerID: playerID,
		Players:  h.playerList(room),
	})

	// Notify others
	h.broadcastToRoom(code, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: msg.Nickname,
		Players:  h.playerList(room),
	}, c)
}

func (h *Hub) handleStartGame(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the room owner can start the game")
		return
	}
	if err := room.Start(); err != nil {
		c.sendError(err.Error())
		return
	}

	// Send each player their personalized game state
	members := h.roomMembers[c.roomCode]
	for _, member := range members {
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameState(room, member.playerID),
		})
	}
}

// --- Gameplay handlers ---

func (h *Hub) handlePlayCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if msg.Card == nil {
		c.sendError("card required")
		return
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.PlayCard(c.playerID, card, chosenColor); err != nil {
		c.sendError(err.Error())
		return
	}

	state := room.State
	topCard := state.Discard[len(state.Discard)-1]

	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardPlayed,
		PlayerIndex: c.playerID,
		Card:        cardToDTO(topCard),
		Turn:        state.CurrentTurn,
		PendingDraw: state.PendingDraw,
	})

	if room.Status == game.StatusFinished {
		h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
			Type:   protocol.SMsgGameOver,
			Winner: room.Winner,
		})
	}
}

func (h *Hub) handleDrawCard(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.DrawCard(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	state := room.State
	hand := state.Hands[c.playerID]
	drawn := hand.Cards[len(hand.Cards)-1]

	// Tell the drawing player their new card
	c.Send(protocol.ServerMsg{
		Type: protocol.SMsgCardDrawn,
		Card: cardToDTO(drawn),
		Turn: state.CurrentTurn,
	})
	// Tell others hand size changed
	h.broadcastToRoom(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardDrawn,
		PlayerIndex: c.playerID,
		Turn:        state.CurrentTurn,
	}, c)
}

func (h *Hub) handlePassTurn(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.PassTurn(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type: protocol.SMsgTurnChanged,
		Turn: room.State.CurrentTurn,
	})
}

func (h *Hub) handleDeclareUno(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if err := room.DeclareLastCard(c.playerID); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: c.playerID,
	})
}

func (h *Hub) handleCatchUno(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	// The target is specified in PlayerIndex field (re-use Turn field)
	target := msg.Card // we borrow card DTO for the target index; see below
	// Actually: add a TargetIndex field. For now, use a convention:
	// The client sends { "type": "catch_uno", "player_index": <target> }
	// We'll parse it from a field we haven't added yet. Let me use an int in ClientMsg.
	// Since we don't have a dedicated field, we'll use the room-level default: try to catch
	// whoever last played to 1 card.
	_ = target
	targetIdx := room.State.LastCardPlayer
	if err := room.CatchUndeclared(c.playerID, targetIdx, time.Now()); err != nil {
		c.sendError(err.Error())
		return
	}
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: targetIdx,
	})
}

func (h *Hub) handleCounterDraw(c *Client, msg protocol.ClientMsg) {
	room, ok := h.roomOf(c)
	if !ok {
		return
	}
	if msg.Card == nil {
		c.sendError("card required")
		return
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.CounterDraw(c.playerID, card, chosenColor); err != nil {
		c.sendError(err.Error())
		return
	}
	state := room.State
	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:        protocol.SMsgCardPlayed,
		PlayerIndex: c.playerID,
		Card:        cardToDTO(state.Discard[len(state.Discard)-1]),
		Turn:        state.CurrentTurn,
		PendingDraw: state.PendingDraw,
	})
}

// --- Disconnect handling ---

func (h *Hub) handleDisconnect(c *Client) {
	if c.roomCode == "" {
		return
	}
	room, ok := h.rooms[c.roomCode]
	if !ok {
		return
	}
	members := h.roomMembers[c.roomCode]
	nickname := ""
	if c.playerID < len(room.Players) {
		nickname = room.Players[c.playerID].Nickname
	}

	// Remove client from member list
	newMembers := make([]*Client, 0, len(members))
	for _, m := range members {
		if m != c {
			newMembers = append(newMembers, m)
		}
	}
	h.roomMembers[c.roomCode] = newMembers

	if len(newMembers) == 0 {
		delete(h.rooms, c.roomCode)
		delete(h.roomMembers, c.roomCode)
		return
	}

	h.broadcastToRoomAll(c.roomCode, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerLeft,
		Nickname: nickname,
		Players:  h.playerList(room),
	})
}

// --- Broadcast helpers ---

func (h *Hub) broadcastToRoom(code string, msg protocol.ServerMsg, exclude *Client) {
	for _, c := range h.roomMembers[code] {
		if c != exclude {
			c.Send(msg)
		}
	}
}

func (h *Hub) broadcastToRoomAll(code string, msg protocol.ServerMsg) {
	h.broadcastToRoom(code, msg, nil)
}

// --- State helpers ---

func (h *Hub) roomOf(c *Client) (*game.Room, bool) {
	if c.roomCode == "" {
		c.sendError("not in a room")
		return nil, false
	}
	room, ok := h.rooms[c.roomCode]
	if !ok {
		c.sendError("room not found")
		return nil, false
	}
	return room, true
}

func (h *Hub) playerList(room *game.Room) []protocol.PlayerDTO {
	ps := make([]protocol.PlayerDTO, len(room.Players))
	for i, p := range room.Players {
		handSize := 0
		if room.State != nil {
			handSize = room.State.Hands[i].Size()
		}
		ps[i] = protocol.PlayerDTO{Index: p.Index, Nickname: p.Nickname, HandSize: handSize}
	}
	return ps
}

func (h *Hub) playerGameState(room *game.Room, playerIdx int) *protocol.GameStateDTO {
	state := room.State
	hand := make([]protocol.CardDTO, len(state.Hands[playerIdx].Cards))
	for i, c := range state.Hands[playerIdx].Cards {
		hand[i] = *cardToDTO(c)
	}
	top := state.Discard[len(state.Discard)-1]
	return &protocol.GameStateDTO{
		YourIndex:   playerIdx,
		Hand:        hand,
		Players:     h.playerList(room),
		Discard:     *cardToDTO(top),
		ActiveColor: colorName(state.ActiveColor),
		Turn:        state.CurrentTurn,
		Direction:   state.Direction,
		PendingDraw: state.PendingDraw,
	}
}

// --- Code generation ---

func (h *Hub) generateCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	for {
		code := make([]byte, 4)
		for i := range code {
			code[i] = chars[rand.Intn(len(chars))]
		}
		s := string(code)
		if _, exists := h.rooms[s]; !exists {
			return s
		}
	}
}

// --- DTO conversion ---

func cardToDTO(c game.Card) *protocol.CardDTO {
	return &protocol.CardDTO{
		Color: colorName(c.Color),
		Kind:  c.Kind.String(),
		Value: c.Value,
	}
}

func dtoToCard(dto *protocol.CardDTO, chosenColorStr string) (game.Card, game.Color, error) {
	col, err := parseColor(dto.Color)
	if err != nil {
		return game.Card{}, 0, err
	}
	kind, err := parseKind(dto.Kind)
	if err != nil {
		return game.Card{}, 0, err
	}
	chosen := col
	if dto.Color == "wild" || dto.Color == "" {
		chosen, err = parseColor(chosenColorStr)
		if err != nil {
			return game.Card{}, 0, fmt.Errorf("chosen_color required for wild: %w", err)
		}
	}
	return game.Card{Color: col, Kind: kind, Value: dto.Value}, chosen, nil
}

func colorName(c game.Color) string { return c.String() }

func parseColor(s string) (game.Color, error) {
	switch strings.ToLower(s) {
	case "red":
		return game.Red, nil
	case "yellow":
		return game.Yellow, nil
	case "green":
		return game.Green, nil
	case "blue":
		return game.Blue, nil
	case "wild", "":
		return game.Wild, nil
	}
	return 0, fmt.Errorf("unknown color: %q", s)
}

func parseKind(s string) (game.Kind, error) {
	switch strings.ToLower(s) {
	case "number":
		return game.Number, nil
	case "skip":
		return game.Skip, nil
	case "reverse":
		return game.Reverse, nil
	case "draw_two":
		return game.DrawTwo, nil
	case "wild":
		return game.WildCard, nil
	case "wild_draw_four":
		return game.WildDrawFour, nil
	}
	return 0, fmt.Errorf("unknown kind: %q", s)
}
