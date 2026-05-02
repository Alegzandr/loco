package game

import (
	"errors"
	"fmt"
	"math/rand"
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
	initialHandSize   = 8
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
	PendingDraw      int  // accumulated draw penalty for next player
	HasDrawn         bool // true after a voluntary (non-penalty) draw this turn; reset on turn advance
	LastCardDeclared bool
	LastCardTime     time.Time // when the last card was played (for catch window)
	LastCardPlayer   int       // who played to 1 card
	EventLog         []GameEvent
}

// Room manages a single game session.
type Room struct {
	Code    string
	Status  Status
	Players []*Player
	State   *GameState
	Winner  string // round winner's nickname for the just-completed round

	// Match configuration (host-settable in lobby)
	Format     MatchFormat
	MaxPlayers int

	// Match state (persists across rounds)
	RoundNumber   int   // current round (1-based, set to 1 on Start)
	Scores        []int // cumulative match scores per playerID
	RoundsWon     []int // rounds won per playerID
	LostHandTotal []int // sum of remaining hand values for the round losers (tiebreaker)

	// Signals for the hub to act on (set by endRound, cleared by hub)
	RoundEnded  bool
	MatchOver   bool
	MatchWinner string

	// rng is overridable in tests; defaults to a time-seeded source.
	rng *rand.Rand
}

// NewRoom creates an empty lobby room.
func NewRoom(code string) *Room {
	return &Room{
		Code:       code,
		Status:     StatusLobby,
		Format:     BO1,
		MaxPlayers: defaultMaxPlayers,
		rng:        rand.New(rand.NewSource(time.Now().UnixNano())),
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
// the remaining players, and returns true if the removed player was the host.
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
// Round 1 starting player is chosen at random.
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
	if r.rng == nil {
		r.rng = rand.New(rand.NewSource(time.Now().UnixNano()))
	}

	r.Status = StatusPlaying
	r.dealRound(r.rng.Intn(n))
	return nil
}

// dealRound sets up a fresh GameState for the current round.
// startingPlayer is the player index who plays first; the first card's effect
// (if it is an action card) is applied from that player's seat.
func (r *Room) dealRound(startingPlayer int) {
	n := len(r.Players)
	deck := NewDeck()
	deck.Shuffle()

	hands := make([]Hand, n)
	for i := range hands {
		cards, _ := deck.DrawN(initialHandSize)
		hands[i].Add(cards...)
	}

	// Flip first card; per ruleset the round must begin on a number card.
	var firstCard Card
	var spill []Card
	for {
		c, ok := deck.Draw()
		if !ok {
			break
		}
		if c.Kind == Number {
			firstCard = c
			break
		}
		spill = append(spill, c)
	}
	deck.Cards = append(spill, deck.Cards...)

	if startingPlayer < 0 || startingPlayer >= n {
		startingPlayer = 0
	}

	r.State = &GameState{
		Hands:       hands,
		Deck:        deck,
		Discard:     []Card{firstCard},
		CurrentTurn: startingPlayer,
		Direction:   1,
		ActiveColor: firstCard.Color,
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
		// Pass each hand to the next player in the current direction.
		newHands := make([]Hand, n)
		for i := range newHands {
			from := ((i-r.State.Direction)%n + n) % n
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

	// Round ends when a player empties their hand: that player wins the round.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.endRound(playerIndex)
		return nil
	}

	next := r.State.ApplyEffect(card, chosenColor)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	return nil
}

// PlayCards plays a batch of identical cards (same Color, Kind, Value) on the same turn.
// All cards must be present in the player's hand. The first card must be legal on top of
// the current discard. Effects are stacked: N DrawTwos add 2*N pending; N Skips skip N
// players; N Reverses flip direction N times. Swap and GlobalSwitch cannot be batch-played.
// chosenColor and chosenPlayer follow PlayCard semantics.
func (r *Room) PlayCards(playerIndex int, cards []Card, chosenColor Color, chosenPlayer int) error {
	if len(cards) == 0 {
		return errors.New("no cards specified")
	}
	if len(cards) == 1 {
		return r.PlayCard(playerIndex, cards[0], chosenColor, chosenPlayer)
	}
	first := cards[0]
	for i := 1; i < len(cards); i++ {
		if cards[i] != first {
			return errors.New("batch cards must be identical")
		}
	}
	if first.Kind == Swap || first.Kind == GlobalSwitch {
		return errors.New("Swap and GlobalSwitch cannot be batch-played")
	}
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return errors.New("not your turn")
	}
	if r.State.PendingDraw > 0 {
		return errors.New("must counter or draw pending penalty cards first")
	}
	// Verify the player holds at least len(cards) copies.
	have := 0
	for _, c := range r.State.Hands[playerIndex].Cards {
		if c == first {
			have++
		}
	}
	if have < len(cards) {
		return fmt.Errorf("hand has %d copies, need %d", have, len(cards))
	}
	topCard := r.State.Discard[len(r.State.Discard)-1]
	if !CanPlay(first, topCard, r.State.ActiveColor) {
		return errors.New("illegal card play")
	}

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	if !first.IsWild() {
		chosenColor = first.Color
	}
	for _, c := range cards {
		r.State.Discard = append(r.State.Discard, c)
	}

	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}
	for _, c := range cards {
		cc := c
		r.State.logEvent(EventCardPlayed, playerIndex, &cc, chosenColor)
	}

	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.endRound(playerIndex)
		return nil
	}

	// Apply the first card's effect normally (advances turn / sets penalty / flips dir).
	next := r.State.ApplyEffect(first, chosenColor)
	r.State.CurrentTurn = next
	// Then stack the extra (count-1) effects for kinds that compound.
	extra := len(cards) - 1
	switch first.Kind {
	case DrawTwo:
		r.State.PendingDraw += 2 * extra
	case WildDrawFour:
		r.State.PendingDraw += 4 * extra
	case Skip:
		for i := 0; i < extra; i++ {
			r.State.CurrentTurn = r.State.nextTurn(r.State.CurrentTurn)
		}
	case Reverse:
		if extra%2 == 1 {
			r.State.Direction *= -1
		}
	}
	r.State.HasDrawn = false
	return nil
}

// endRound finalises the current round: the winner scores the sum of all
// other players' remaining card values; everyone else scores 0. Also resolves
// match-over (and, when not yet over, leaves dealing the next round to the
// hub via BeginNextRound).
func (r *Room) endRound(winnerIdx int) {
	r.Winner = r.Players[winnerIdx].Nickname
	r.RoundsWon[winnerIdx]++

	score := 0
	for i, hand := range r.State.Hands {
		if i == winnerIdx {
			continue
		}
		handVal := 0
		for _, c := range hand.Cards {
			handVal += CardValue(c)
		}
		score += handVal
		r.LostHandTotal[i] += handVal
	}
	r.Scores[winnerIdx] += score

	r.State.logEvent(EventRoundEnd, winnerIdx, nil, 0)
	r.RoundEnded = true

	// Match-over check: only after the configured number of rounds AND
	// only if a clear winner exists; otherwise sudden-death continues.
	if r.RoundNumber >= int(r.Format) {
		matchWinner := r.determineMatchWinner()
		if matchWinner != "" {
			r.MatchWinner = matchWinner
			r.MatchOver = true
			r.Status = StatusFinished
			r.State.logEvent(EventMatchEnd, -1, nil, 0)
		}
	}
}

// BeginNextRound advances the room to the next round (incrementing RoundNumber
// and dealing fresh hands). The hub calls this between broadcasting round_end
// and game_started. The starter for round N>1 is the current biggest loser
// (lowest cumulative score; ties broken by lowest playerID).
func (r *Room) BeginNextRound() error {
	if r.MatchOver {
		return errors.New("BeginNextRound called after match over")
	}
	if r.Status != StatusPlaying {
		return errors.New("BeginNextRound called when game not in progress")
	}
	r.RoundNumber++
	r.dealRound(r.biggestLoser())
	return nil
}

// biggestLoser returns the player index with the lowest cumulative score.
// Ties are broken by lowest player index (deterministic).
func (r *Room) biggestLoser() int {
	loser := 0
	for i := 1; i < len(r.Scores); i++ {
		if r.Scores[i] < r.Scores[loser] {
			loser = i
		}
	}
	return loser
}

// determineMatchWinner finds the match winner using tiebreaker rules:
// (1) highest total score, (2) most rounds won, (3) lowest lost-hand total,
// then sudden death (returns "").
func (r *Room) determineMatchWinner() string {
	n := len(r.Players)

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

	n := 1
	skipTurn := false
	if r.State.PendingDraw > 0 {
		n = r.State.PendingDraw
		r.State.PendingDraw = 0
		skipTurn = true
	} else {
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
	// Two interrupt paths:
	//   1. Identical-card interrupt: card matches top in color, kind, AND value.
	//   2. Free +2 interrupt: a DrawTwo card can interrupt regardless of color/value.
	identical := card.Color == topCard.Color && card.Kind == topCard.Kind && card.Value == topCard.Value
	freeDrawTwo := card.Kind == DrawTwo
	if !identical && !freeDrawTwo {
		return errors.New("interrupt card must exactly match the top discard card, or be a +2")
	}

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

	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	c := card
	r.State.logEvent(EventCardPlayed, playerIndex, &c, card.Color)

	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = card.Color
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.endRound(playerIndex)
		return nil
	}

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

	r.State.LastCardDeclared = false
	if r.State.Hands[playerIndex].Size() == 1 {
		r.State.LastCardTime = time.Now()
		r.State.LastCardPlayer = playerIndex
	}

	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.endRound(playerIndex)
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
