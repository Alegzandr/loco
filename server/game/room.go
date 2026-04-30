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

// MatchFormat determines how many rounds make up a match.
type MatchFormat int

const (
	BO1 MatchFormat = 1
	BO3 MatchFormat = 3
	BO5 MatchFormat = 5
	BO7 MatchFormat = 7
)

const (
	defaultMaxPlayers = 10
	serverMinPlayers  = 2
	serverMaxPlayers  = 10
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

// EventKind identifies the type of a game event.
type EventKind string

const (
	EventGameStarted  EventKind = "game_started"
	EventCardPlayed   EventKind = "card_played"
	EventCardDrawn    EventKind = "card_drawn"
	EventTurnPassed   EventKind = "turn_passed"
	EventUnoDeclared  EventKind = "uno_declared"
	EventUnoCaught    EventKind = "uno_caught"
	EventCounterDraw  EventKind = "counter_draw"
	EventGameFinished EventKind = "game_finished"
	EventRoundEnd     EventKind = "round_end"
	EventMatchEnd     EventKind = "match_end"
)

// GameEvent records a single action taken during the game.
type GameEvent struct {
	Kind        EventKind `json:"kind"`
	PlayerIndex int       `json:"player_index"`
	Card        *Card     `json:"card,omitempty"`
	ChosenColor Color     `json:"chosen_color,omitempty"`
	At          time.Time `json:"at"`
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
	HasDrawn         bool // true after a voluntary (non-penalty) draw this turn; reset on turn advance
	LastCardDeclared bool
	LastCardTime     time.Time // when the last card was played (for catch window)
	LastCardPlayer   int       // who played to 1 card
	EventLog         []GameEvent

	// Per-round finish tracking (reset each round via dealRound).
	// Finished[i] is true once player i has emptied their hand.
	Finished []bool
	// Placements records the finish order: Placements[0] = 1st place playerIdx, etc.
	Placements []int
}

// Room manages a single game session.
type Room struct {
	Code    string
	Status  Status
	Players []*Player
	State   *GameState
	Winner  string // first-place finisher's nickname for the current round

	// Match configuration (host-settable in lobby)
	Format     MatchFormat
	MaxPlayers int

	// Match state (persists across rounds)
	RoundNumber   int   // current round (1-based, set to 1 on Start)
	Scores        []int // cumulative match scores per playerID
	RoundsWon     []int // rounds won per playerID
	LostHandTotal []int // sum of remaining hand values for the last player each round (tiebreaker)

	// Signals for the hub to act on (set by endRound, cleared by hub)
	RoundEnded  bool
	MatchOver   bool
	MatchWinner string
}

// NewRoom creates an empty lobby room.
func NewRoom(code string) *Room {
	return &Room{
		Code:       code,
		Status:     StatusLobby,
		Format:     BO1,
		MaxPlayers: defaultMaxPlayers,
	}
}

// SetFormat sets the match format (lobby only).
func (r *Room) SetFormat(f MatchFormat) error {
	if r.Status != StatusLobby {
		return errors.New("cannot change format after game starts")
	}
	switch f {
	case BO1, BO3, BO5, BO7:
	default:
		return fmt.Errorf("invalid match format: %d", f)
	}
	r.Format = f
	return nil
}

// SetMaxPlayers sets the player cap (lobby only; cannot drop below current count).
func (r *Room) SetMaxPlayers(n int) error {
	if r.Status != StatusLobby {
		return errors.New("cannot change max players after game starts")
	}
	if n < serverMinPlayers {
		return fmt.Errorf("max players cannot be less than %d", serverMinPlayers)
	}
	if n > serverMaxPlayers {
		return fmt.Errorf("max players cannot exceed %d", serverMaxPlayers)
	}
	if n < len(r.Players) {
		return fmt.Errorf("cannot set max players to %d: %d players already in room", n, len(r.Players))
	}
	r.MaxPlayers = n
	return nil
}

// RemoveLobbyPlayer removes the player at playerIdx from the lobby, re-indexes
// the remaining players, and returns true if the removed player was the host
// (so the caller can promote the new host). Lobby-only: rejected if the game
// has started.
//
// After this call, r.Players[i].Index == i for all remaining i. Callers must
// also re-index any out-of-band per-player state (e.g. bot slots, session
// tokens) keyed on the old playerIdx.
func (r *Room) RemoveLobbyPlayer(playerIdx int) (wasHost bool, err error) {
	if r.Status != StatusLobby {
		return false, errors.New("can only remove players in the lobby")
	}
	if playerIdx < 0 || playerIdx >= len(r.Players) {
		return false, fmt.Errorf("invalid player index %d", playerIdx)
	}
	wasHost = playerIdx == 0
	newPlayers := make([]*Player, 0, len(r.Players)-1)
	for i, p := range r.Players {
		if i == playerIdx {
			continue
		}
		p.Index = len(newPlayers)
		newPlayers = append(newPlayers, p)
	}
	r.Players = newPlayers
	return wasHost, nil
}

// Join adds a player to the lobby.
func (r *Room) Join(nickname string) error {
	if r.Status != StatusLobby {
		return errors.New("game already in progress")
	}
	if len(r.Players) >= r.MaxPlayers {
		return fmt.Errorf("room is full (max %d players)", r.MaxPlayers)
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
	if len(r.Players) < serverMinPlayers {
		return fmt.Errorf("need at least %d players to start", serverMinPlayers)
	}

	n := len(r.Players)
	r.Scores = make([]int, n)
	r.RoundsWon = make([]int, n)
	r.LostHandTotal = make([]int, n)
	r.RoundNumber = 1

	r.Status = StatusPlaying
	r.dealRound()
	return nil
}

// dealRound sets up a fresh GameState for the current round.
func (r *Room) dealRound() {
	n := len(r.Players)
	deck := NewDeck()
	deck.Shuffle()

	hands := make([]Hand, n)
	for i := range hands {
		cards, _ := deck.DrawN(initialHandSize)
		hands[i].Add(cards...)
	}

	// Flip first card; skip wild cards as starting card
	var firstCard Card
	var spill []Card
	for {
		c, ok := deck.Draw()
		if !ok {
			break
		}
		if !c.IsWild() {
			firstCard = c
			break
		}
		spill = append(spill, c)
	}
	deck.Cards = append(spill, deck.Cards...)

	r.State = &GameState{
		Hands:       hands,
		Deck:        deck,
		Discard:     []Card{firstCard},
		CurrentTurn: 0,
		Direction:   1,
		ActiveColor: firstCard.Color,
		Finished:    make([]bool, n),
	}

	if firstCard.IsAction() {
		next := r.State.ApplyEffect(firstCard, firstCard.Color)
		r.State.CurrentTurn = next
	}

	r.State.logEvent(EventGameStarted, -1, nil, 0)
}

// PlayCard attempts to play a card from playerIndex's hand.
// chosenColor is used when playing a wild card.
// chosenPlayer is the target player index for Swap cards (-1 for all other cards).
func (r *Room) PlayCard(playerIndex int, card Card, chosenColor Color, chosenPlayer int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	if r.State.Finished[playerIndex] {
		return errors.New("you have already finished this round")
	}
	if r.State.PendingDraw > 0 {
		return errors.New("must counter or draw pending penalty cards first")
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return errors.New("card not in hand")
	}

	topCard := r.State.Discard[len(r.State.Discard)-1]
	if !CanPlay(card, topCard, r.State.ActiveColor) {
		return errors.New("illegal card play")
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	if !card.IsWild() {
		chosenColor = card.Color
	}

	// Validate and apply Swap / GlobalSwitch hand effects.
	n := len(r.State.Hands)
	if card.Kind == Swap {
		if chosenPlayer < 0 || chosenPlayer >= n {
			return fmt.Errorf("invalid chosen_player %d for swap", chosenPlayer)
		}
		if chosenPlayer == playerIndex {
			return errors.New("cannot swap with yourself")
		}
		r.State.Hands[playerIndex], r.State.Hands[chosenPlayer] = r.State.Hands[chosenPlayer], r.State.Hands[playerIndex]
	} else if card.Kind == GlobalSwitch {
		// Always rotate clockwise (matching the visual seat order where index increases
		// clockwise). Each player receives the hand of the player to their left,
		// regardless of the current game direction.
		newHands := make([]Hand, n)
		for i := range newHands {
			from := (i - 1 + n) % n
			newHands[i] = r.State.Hands[from]
		}
		r.State.Hands = newHands
	}

	r.State.Discard = append(r.State.Discard, card)

	// Track last-card state
	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	c := card
	r.State.logEvent(EventCardPlayed, playerIndex, &c, chosenColor)

	// Check if player has emptied their hand
	if r.State.Hands[playerIndex].Size() == 0 {
		// Set active color now (ApplyEffect won't be called for this play)
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.markPlayerFinished(playerIndex)
		return nil
	}

	next := r.State.ApplyEffect(card, chosenColor)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	return nil
}

// markPlayerFinished marks playerIdx as finished for the round, scores their placement,
// and either ends the round (when 1 player remains) or advances the turn.
func (r *Room) markPlayerFinished(playerIdx int) {
	r.State.Finished[playerIdx] = true
	r.State.Placements = append(r.State.Placements, playerIdx)

	// Score: sum of all currently unfinished players' card values
	score := 0
	for i, hand := range r.State.Hands {
		if r.State.Finished[i] {
			continue
		}
		for _, c := range hand.Cards {
			score += CardValue(c)
		}
	}
	r.Scores[playerIdx] += score

	// First to finish is the round winner
	if len(r.State.Placements) == 1 {
		r.Winner = r.Players[playerIdx].Nickname
		r.RoundsWon[playerIdx]++
	}

	// Count remaining unfinished players
	var unfinished []int
	for i, f := range r.State.Finished {
		if !f {
			unfinished = append(unfinished, i)
		}
	}

	if len(unfinished) <= 1 {
		// Round ends; the last remaining player scores 0
		if len(unfinished) == 1 {
			lastPlayer := unfinished[0]
			handVal := 0
			for _, c := range r.State.Hands[lastPlayer].Cards {
				handVal += CardValue(c)
			}
			r.LostHandTotal[lastPlayer] += handVal
			r.State.Finished[lastPlayer] = true
			r.State.Placements = append(r.State.Placements, lastPlayer)
		}

		r.State.logEvent(EventRoundEnd, playerIdx, nil, 0)
		r.RoundEnded = true

		// Check if match is over.
		// We resolve match-over here (so the hub can broadcast the final state)
		// but DO NOT deal the next round — that is the hub's responsibility via
		// BeginNextRound, called only after card_played + round_end have been
		// broadcast. Otherwise the broadcast would read the new round's state.
		if r.RoundNumber >= int(r.Format) {
			matchWinner := r.determineMatchWinner()
			if matchWinner != "" {
				r.MatchWinner = matchWinner
				r.MatchOver = true
				r.Status = StatusFinished
				r.State.logEvent(EventMatchEnd, -1, nil, 0)
				return
			}
			// Still tied: a sudden-death extra round will be dealt by BeginNextRound.
		}
		return
	}

	// Advance turn to next unfinished player
	r.State.HasDrawn = false
	r.State.CurrentTurn = r.State.nextTurn(playerIdx)
}

// BeginNextRound advances the room to the next round (incrementing RoundNumber
// and dealing fresh hands). The hub calls this between broadcasting round_end
// and game_started so that card_played for the round-winning play sees the
// correct pre-deal state. Refuses to act if the match is already decided or
// the game is not in progress.
func (r *Room) BeginNextRound() error {
	if r.MatchOver {
		return errors.New("BeginNextRound called after match over")
	}
	if r.Status != StatusPlaying {
		return errors.New("BeginNextRound called when game not in progress")
	}
	r.RoundNumber++
	r.dealRound()
	return nil
}

// determineMatchWinner finds the match winner using tiebreaker rules.
// Returns "" if still perfectly tied (sudden death needed).
func (r *Room) determineMatchWinner() string {
	n := len(r.Players)

	// Tiebreaker 0: highest total score
	maxScore := -1
	for i := 0; i < n; i++ {
		if r.Scores[i] > maxScore {
			maxScore = r.Scores[i]
		}
	}
	tied := make([]int, 0, n)
	for i := 0; i < n; i++ {
		if r.Scores[i] == maxScore {
			tied = append(tied, i)
		}
	}
	if len(tied) == 1 {
		return r.Players[tied[0]].Nickname
	}

	// Tiebreaker 1: most rounds won
	maxWins := -1
	for _, i := range tied {
		if r.RoundsWon[i] > maxWins {
			maxWins = r.RoundsWon[i]
		}
	}
	tiedByWins := tied[:0]
	for _, i := range tied {
		if r.RoundsWon[i] == maxWins {
			tiedByWins = append(tiedByWins, i)
		}
	}
	if len(tiedByWins) == 1 {
		return r.Players[tiedByWins[0]].Nickname
	}

	// Tiebreaker 2: lowest total remaining card value across losing rounds
	minLoss := -1
	for _, i := range tiedByWins {
		if minLoss < 0 || r.LostHandTotal[i] < minLoss {
			minLoss = r.LostHandTotal[i]
		}
	}
	tiedByLoss := tiedByWins[:0]
	for _, i := range tiedByWins {
		if r.LostHandTotal[i] == minLoss {
			tiedByLoss = append(tiedByLoss, i)
		}
	}
	if len(tiedByLoss) == 1 {
		return r.Players[tiedByLoss[0]].Nickname
	}

	// Perfectly tied: sudden death needed
	return ""
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
	if r.State.Finished[playerIndex] {
		return errors.New("you have already finished this round")
	}

	n := 1
	skipTurn := false
	if r.State.PendingDraw > 0 {
		n = r.State.PendingDraw
		r.State.PendingDraw = 0
		skipTurn = true
	} else {
		// Voluntary draw: only allowed once per turn
		if r.State.HasDrawn {
			return errors.New("you have already drawn this turn")
		}
		r.State.HasDrawn = true
	}

	r.ensureDeck(n)
	cards, ok := r.State.Deck.DrawN(n)
	if !ok {
		return errors.New("deck exhausted")
	}
	r.State.Hands[playerIndex].Add(cards...)

	if skipTurn {
		r.State.HasDrawn = false
		r.State.CurrentTurn = r.State.nextTurn(playerIndex)
	}
	r.State.logEvent(EventCardDrawn, playerIndex, nil, 0)
	return nil
}

// PassTurn advances the turn without playing (after a voluntary draw).
func (r *Room) PassTurn(playerIndex int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	if r.State.Finished[playerIndex] {
		return errors.New("you have already finished this round")
	}
	if !r.State.HasDrawn {
		return errors.New("you must draw a card before passing")
	}
	r.State.HasDrawn = false
	r.State.CurrentTurn = r.State.nextTurn(playerIndex)
	r.State.logEvent(EventTurnPassed, playerIndex, nil, 0)
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
	r.State.logEvent(EventUnoDeclared, playerIndex, nil, 0)
	return nil
}

// CatchUndeclared allows catcherIndex to penalize targetIndex for not declaring their last card.
func (r *Room) CatchUndeclared(catcherIndex, targetIndex int, now time.Time) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.Finished[catcherIndex] {
		return errors.New("finished players cannot catch")
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
	r.ensureDeck(undeclaredPenalty)
	cards, ok := r.State.Deck.DrawN(undeclaredPenalty)
	if !ok {
		return errors.New("deck exhausted during penalty")
	}
	r.State.Hands[targetIndex].Add(cards...)
	r.State.LastCardDeclared = true
	r.State.logEvent(EventUnoCaught, catcherIndex, nil, 0)
	return nil
}

// InterruptPlay allows a player to play an exact match of the current top discard card
// out of turn (jump-in / speed-play rule). The card must match the top card in color,
// kind, and value. Wild cards and active penalty chains cannot be interrupted.
// After a valid interrupt the game continues from the interrupting player's position.
func (r *Room) InterruptPlay(playerIndex int, card Card, chosenPlayer int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.Finished[playerIndex] {
		return errors.New("you have already finished this round")
	}
	if r.State.CurrentTurn == playerIndex {
		return errors.New("it is your turn; use play_card instead")
	}
	if r.State.PendingDraw > 0 {
		return errors.New("cannot interrupt while a draw penalty is active")
	}
	if card.IsWild() {
		return errors.New("wild cards cannot be used to interrupt")
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return errors.New("card not in hand")
	}

	topCard := r.State.Discard[len(r.State.Discard)-1]
	// Exact match required: same color, kind, and value.
	if card.Color != topCard.Color || card.Kind != topCard.Kind || card.Value != topCard.Value {
		return errors.New("interrupt card must exactly match the top discard card")
	}

	// Validate Swap target if this interrupt card happens to be Swap (non-wild Swap not
	// in the current deck, but guard defensively).
	n := len(r.State.Hands)
	if card.Kind == Swap {
		if chosenPlayer < 0 || chosenPlayer >= n || chosenPlayer == playerIndex {
			return fmt.Errorf("invalid chosen_player %d for swap", chosenPlayer)
		}
		r.State.Hands[playerIndex], r.State.Hands[chosenPlayer] = r.State.Hands[chosenPlayer], r.State.Hands[playerIndex]
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}
	r.State.Discard = append(r.State.Discard, card)

	// Track last-card state.
	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	c := card
	r.State.logEvent(EventCardPlayed, playerIndex, &c, card.Color)

	// Check if the interrupt emptied the player's hand.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = card.Color
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.markPlayerFinished(playerIndex)
		return nil
	}

	// Game continues from the interrupting player's position.
	// Set CurrentTurn to the interrupter before calling ApplyEffect so the
	// direction-aware next-turn calculation is correct.
	r.State.CurrentTurn = playerIndex
	next := r.State.ApplyEffect(card, card.Color)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	return nil
}

// CounterDraw allows the current victim of a pending draw to counter with a compatible card.
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
	c := card
	r.State.logEvent(EventCounterDraw, playerIndex, &c, chosenColor)

	// Track last-card state
	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	// Check if counter emptied the hand
	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.markPlayerFinished(playerIndex)
		return nil
	}

	next := r.State.ApplyEffect(card, chosenColor)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	return nil
}

// logEvent appends an event to the game log.
func (s *GameState) logEvent(kind EventKind, playerIndex int, card *Card, chosenColor Color) {
	s.EventLog = append(s.EventLog, GameEvent{
		Kind:        kind,
		PlayerIndex: playerIndex,
		Card:        card,
		ChosenColor: chosenColor,
		At:          time.Now(),
	})
}

// ensureDeck replenishes the deck from discard if it's running low.
func (r *Room) ensureDeck(needed int) {
	if len(r.State.Deck.Cards) >= needed {
		return
	}
	if len(r.State.Discard) <= 1 {
		return
	}
	top := r.State.Discard[len(r.State.Discard)-1]
	pile := r.State.Discard[:len(r.State.Discard)-1]
	r.State.Deck.Replenish(pile, top)
	r.State.Discard = []Card{top}
}
