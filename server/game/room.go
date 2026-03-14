package game

import (
	"errors"
	"fmt"
	"time"
)

// Status represents the lifecycle state of a room.
type Status int

const (
	StatusLobby    Status = iota
	StatusPlaying
	StatusFinished
)

func (s Status) String() string {
	switch s {
	case StatusLobby:
		return "lobby"
	case StatusPlaying:
		return "playing"
	case StatusFinished:
		return "finished"
	}
	return "unknown"
}

const (
	maxPlayers        = 10
	minPlayers        = 2
	initialHandSize   = 7
	undeclaredPenalty = 2
	// catchWindow is how long after a player's last card play other players can catch them.
	catchWindow = 5 * time.Second
)

// Player holds per-player metadata.
type Player struct {
	Nickname string
	Index    int
}

// GameState is the authoritative server-side game state.
type GameState struct {
	Hands            []Hand
	Deck             *Deck
	Discard          []Card
	CurrentTurn      int
	Direction        int // 1 = clockwise, -1 = counter-clockwise
	ActiveColor      Color
	PendingDraw      int // accumulated draw penalty for next player
	LastCardDeclared bool
	LastCardTime     time.Time // when the last card was played (for catch window)
	LastCardPlayer   int       // who played to 1 card
}

// Room manages a single game session.
type Room struct {
	Code    string
	Status  Status
	Players []*Player
	State   *GameState
	Winner  string
}

// NewRoom creates an empty lobby room.
func NewRoom(code string) *Room {
	return &Room{
		Code:   code,
		Status: StatusLobby,
	}
}

// Join adds a player to the lobby.
func (r *Room) Join(nickname string) error {
	if r.Status != StatusLobby {
		return errors.New("game already in progress")
	}
	if len(r.Players) >= maxPlayers {
		return fmt.Errorf("room is full (max %d players)", maxPlayers)
	}
	for _, p := range r.Players {
		if p.Nickname == nickname {
			return fmt.Errorf("nickname %q already taken", nickname)
		}
	}
	r.Players = append(r.Players, &Player{
		Nickname: nickname,
		Index:    len(r.Players),
	})
	return nil
}

// Start begins the game: validates player count, deals hands, flips first card.
func (r *Room) Start() error {
	if r.Status != StatusLobby {
		return errors.New("game already started")
	}
	if len(r.Players) < minPlayers {
		return fmt.Errorf("need at least %d players to start", minPlayers)
	}

	deck := NewDeck()
	deck.Shuffle()

	hands := make([]Hand, len(r.Players))
	for i := range hands {
		cards, ok := deck.DrawN(initialHandSize)
		if !ok {
			return errors.New("deck exhausted while dealing")
		}
		hands[i].Add(cards...)
	}

	// Flip first card; skip wild cards as starting card
	var firstCard Card
	var discard []Card
	for {
		c, ok := deck.Draw()
		if !ok {
			return errors.New("deck exhausted finding first card")
		}
		if !c.IsWild() {
			firstCard = c
			break
		}
		discard = append(discard, c) // put wilds back at bottom later
	}
	// Return wilds to bottom of deck
	deck.Cards = append(discard, deck.Cards...)

	r.State = &GameState{
		Hands:       hands,
		Deck:        deck,
		Discard:     []Card{firstCard},
		CurrentTurn: 0,
		Direction:   1,
		ActiveColor: firstCard.Color,
	}

	// Apply first card effect if it's an action card
	if firstCard.IsAction() {
		next := r.State.ApplyEffect(firstCard, firstCard.Color)
		r.State.CurrentTurn = next
	}

	r.Status = StatusPlaying
	return nil
}

// PlayCard attempts to play a card from playerIndex's hand.
// chosenColor is used when playing a wild card.
func (r *Room) PlayCard(playerIndex int, card Card, chosenColor Color) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return errors.New("card not in hand")
	}

	topCard := r.State.Discard[len(r.State.Discard)-1]
	if !CanPlay(card, topCard, r.State.ActiveColor) {
		return errors.New("illegal card play")
	}

	// Remove card from hand
	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	// Resolve chosen color for non-wild cards
	if !card.IsWild() {
		chosenColor = card.Color
	}

	// Add to discard
	r.State.Discard = append(r.State.Discard, card)

	// Track last-card state
	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	// Check win
	if r.State.Hands[playerIndex].Size() == 0 {
		r.Status = StatusFinished
		r.Winner = r.Players[playerIndex].Nickname
		return nil
	}

	// Apply effect and advance turn
	next := r.State.ApplyEffect(card, chosenColor)
	r.State.CurrentTurn = next

	// If next player has pending draws, they must draw
	return nil
}

// DrawCard makes the current player draw from the deck.
// If there is a pending draw, they draw that many cards and forfeit their turn.
func (r *Room) DrawCard(playerIndex int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}

	n := 1
	skipTurn := false
	if r.State.PendingDraw > 0 {
		n = r.State.PendingDraw
		r.State.PendingDraw = 0
		skipTurn = true
	}

	r.ensureDeck(n)
	cards, ok := r.State.Deck.DrawN(n)
	if !ok {
		return errors.New("deck exhausted")
	}
	r.State.Hands[playerIndex].Add(cards...)

	if skipTurn {
		r.State.CurrentTurn = r.State.nextTurn(playerIndex)
	}
	// When drawing 1, player may still play or pass; turn doesn't advance here.
	// The client will send a separate pass action if needed.
	return nil
}

// PassTurn advances the turn without playing (after a forced draw).
func (r *Room) PassTurn(playerIndex int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	r.State.CurrentTurn = r.State.nextTurn(playerIndex)
	return nil
}

// DeclareLastCard records that a player is declaring their last card.
func (r *Room) DeclareLastCard(playerIndex int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.Hands[playerIndex].Size() != 1 {
		return errors.New("can only declare with exactly 1 card in hand")
	}
	r.State.LastCardDeclared = true
	r.State.LastCardPlayer = playerIndex
	return nil
}

// CatchUndeclared allows catcherIndex to penalize targetIndex for not declaring their last card.
// The catch must be within the catch window.
func (r *Room) CatchUndeclared(catcherIndex, targetIndex int, now time.Time) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.LastCardDeclared {
		return errors.New("player already declared")
	}
	if r.State.Hands[targetIndex].Size() != 1 {
		return errors.New("target does not have exactly 1 card")
	}
	if r.State.LastCardPlayer != targetIndex {
		return errors.New("target did not just play to 1 card")
	}
	if now.Sub(r.State.LastCardTime) > catchWindow {
		return errors.New("catch window expired")
	}
	// Apply penalty: target draws 2
	r.ensureDeck(undeclaredPenalty)
	cards, ok := r.State.Deck.DrawN(undeclaredPenalty)
	if !ok {
		return errors.New("deck exhausted during penalty")
	}
	r.State.Hands[targetIndex].Add(cards...)
	r.State.LastCardDeclared = true // prevent double-catch
	return nil
}

// CounterDraw allows the current victim of a pending draw to counter with a compatible card.
// Only DrawTwo can counter DrawTwo; WildDrawFour can be countered by WildDrawFour.
func (r *Room) CounterDraw(playerIndex int, card Card, chosenColor Color) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	if r.State.PendingDraw == 0 {
		return errors.New("no pending draw to counter")
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return errors.New("card not in hand")
	}

	topCard := r.State.Discard[len(r.State.Discard)-1]
	// Counter must be same kind as the draw card that created the pending
	if card.Kind != topCard.Kind {
		return errors.New("counter card must match kind of draw card")
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	if !card.IsWild() {
		chosenColor = card.Color
	}

	r.State.Discard = append(r.State.Discard, card)
	next := r.State.ApplyEffect(card, chosenColor)
	r.State.CurrentTurn = next
	return nil
}

// ensureDeck replenishes the deck from discard if it's running low.
func (r *Room) ensureDeck(needed int) {
	if len(r.State.Deck.Cards) >= needed {
		return
	}
	if len(r.State.Discard) <= 1 {
		return // nothing to replenish from
	}
	top := r.State.Discard[len(r.State.Discard)-1]
	pile := r.State.Discard[:len(r.State.Discard)-1]
	r.State.Deck.Replenish(pile, top)
	r.State.Discard = []Card{top}
}
