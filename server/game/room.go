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

// InterruptWindow is how long after a card is played any other player may
// jump in with an exact-match interrupt. Exposed as a var so tests can override.
var InterruptWindow = 1500 * time.Millisecond

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

	// Interrupt window: explicit state for the realtime "lead taking" / jump-in
	// mechanic. After every successful play the window is opened: any non-actor
	// player who holds a card identical (color+kind+value) to the top discard
	// may take the lead by sending an interrupt_play within InterruptWindow.
	// LastPlayBy < 0 means the window is closed (e.g. after DrawCard / PassTurn
	// / CounterDraw resolves the chain, or after round end).
	LastPlayBy        int
	LastPlayAt        time.Time
	InterruptDeadline time.Time
}

// topCard returns the current top of the discard pile. Callers must ensure
// Discard is non-empty (always true once dealRound has run).
func (s *GameState) topCard() Card {
	return s.Discard[len(s.Discard)-1]
}

// resolveChosenColor returns the color the played card sets active. Non-wild
// cards override the caller-supplied chosenColor with their own color.
func resolveChosenColor(card Card, chosenColor Color) Color {
	if !card.IsWild() {
		return card.Color
	}
	return chosenColor
}

// armInterruptWindow opens / refreshes the interrupt window for the most recent play.
// Called by PlayCard, PlayCards, InterruptPlay(Cards), and CounterDraw.
func (s *GameState) armInterruptWindow(actor int) {
	now := time.Now()
	s.LastPlayBy = actor
	s.LastPlayAt = now
	s.InterruptDeadline = now.Add(InterruptWindow)
}

// closeInterruptWindow closes the window explicitly (DrawCard / PassTurn / round end).
func (s *GameState) closeInterruptWindow() {
	s.LastPlayBy = -1
	s.InterruptDeadline = time.Time{}
}

// updateLastCardState refreshes the UNO declaration tracking after a card is
// played: the previous declaration is invalidated, and if the actor is now down
// to a single card, the catch window opens with the current timestamp.
func (s *GameState) updateLastCardState(playerIndex int) {
	s.LastCardDeclared = false
	if s.Hands[playerIndex].Size() == 1 {
		s.LastCardTime = time.Now()
		s.LastCardPlayer = playerIndex
	}
}

// stackBatchEffects applies the (count-1) extra effects of a batch identical-card
// play. ApplyEffect must already have been called once for the leading card.
// Wild kinds are no-ops in the interrupt batch path (interrupt rejects wilds),
// but included here so PlayCards and InterruptPlayCards can share this helper.
func (s *GameState) stackBatchEffects(card Card, extra int) {
	if extra <= 0 {
		return
	}
	switch card.Kind {
	case DrawTwo:
		s.PendingDraw += 2 * extra
	case WildDrawFour:
		s.PendingDraw += 4 * extra
	case Skip:
		for i := 0; i < extra; i++ {
			s.CurrentTurn = s.nextTurn(s.CurrentTurn)
		}
	case Reverse:
		if extra%2 == 1 {
			s.Direction *= -1
		}
	}
}

// countInHand returns how many copies of card the player currently holds.
func (s *GameState) countInHand(playerIndex int, card Card) int {
	n := 0
	for _, c := range s.Hands[playerIndex].Cards {
		if c == card {
			n++
		}
	}
	return n
}

// finishRoundWin handles the "actor emptied their hand" branch: it locks in the
// chosen color, closes the interrupt window, logs the game-finished event, and
// ends the round. Used by PlayCard, PlayCards, and InterruptPlayCards.
//
// CounterDraw deliberately does NOT use this helper — its win path historically
// omits the closeInterruptWindow call.
func (r *Room) finishRoundWin(playerIndex int, activeColor Color) {
	r.State.ActiveColor = activeColor
	r.State.closeInterruptWindow()
	r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
	r.endRound(playerIndex)
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
	deck.Shuffle(r.rng)

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
		LastPlayBy:  -1,
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

	if !CanPlay(card, r.State.topCard(), r.State.ActiveColor) {
		return errors.New("illegal card play")
	}

	// Validate Swap target before any state mutation so an invalid request
	// can't half-apply (card removed but swap rejected).
	n := len(r.State.Hands)
	if card.Kind == Swap {
		if chosenPlayer < 0 || chosenPlayer >= n {
			return fmt.Errorf("invalid chosen_player %d for swap", chosenPlayer)
		}
		if chosenPlayer == playerIndex {
			return errors.New("cannot swap with yourself")
		}
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	chosenColor = resolveChosenColor(card, chosenColor)

	r.State.Discard = append(r.State.Discard, card)
	c := card
	r.State.logEvent(EventCardPlayed, playerIndex, &c, chosenColor)

	// Per rules.md §11.1: if the actor empties their hand by playing Swap or
	// GlobalSwitch, the round ends immediately — the hand-rearranging effect
	// is aborted. The win check must run before the swap/rotation, otherwise
	// the actor would receive opponent cards and the win would not register.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.finishRoundWin(playerIndex, chosenColor)
		return nil
	}

	// Apply Swap / GlobalSwitch hand effects only when the actor still has cards.
	if card.Kind == Swap {
		r.State.Hands[playerIndex], r.State.Hands[chosenPlayer] = r.State.Hands[chosenPlayer], r.State.Hands[playerIndex]
	} else if card.Kind == GlobalSwitch {
		newHands := make([]Hand, n)
		for i := range newHands {
			from := ((i-r.State.Direction)%n + n) % n
			newHands[i] = r.State.Hands[from]
		}
		r.State.Hands = newHands
	}

	r.State.updateLastCardState(playerIndex)

	next := r.State.ApplyEffect(card, chosenColor)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	r.State.armInterruptWindow(playerIndex)
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
	if have := r.State.countInHand(playerIndex, first); have < len(cards) {
		return fmt.Errorf("hand has %d copies, need %d", have, len(cards))
	}
	if !CanPlay(first, r.State.topCard(), r.State.ActiveColor) {
		return errors.New("illegal card play")
	}

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	chosenColor = resolveChosenColor(first, chosenColor)
	for _, c := range cards {
		r.State.Discard = append(r.State.Discard, c)
	}

	r.State.updateLastCardState(playerIndex)
	for _, c := range cards {
		cc := c
		r.State.logEvent(EventCardPlayed, playerIndex, &cc, chosenColor)
	}

	if r.State.Hands[playerIndex].Size() == 0 {
		r.finishRoundWin(playerIndex, chosenColor)
		return nil
	}

	// Apply the first card's effect normally (advances turn / sets penalty / flips dir).
	r.State.CurrentTurn = r.State.ApplyEffect(first, chosenColor)
	r.State.stackBatchEffects(first, len(cards)-1)
	r.State.HasDrawn = false
	r.State.armInterruptWindow(playerIndex)
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
	candidates := make([]int, n)
	for i := range candidates {
		candidates[i] = i
	}

	candidates = filterBest(candidates, func(i int) int { return r.Scores[i] })
	if len(candidates) == 1 {
		return r.Players[candidates[0]].Nickname
	}
	candidates = filterBest(candidates, func(i int) int { return r.RoundsWon[i] })
	if len(candidates) == 1 {
		return r.Players[candidates[0]].Nickname
	}
	candidates = filterBest(candidates, func(i int) int { return -r.LostHandTotal[i] })
	if len(candidates) == 1 {
		return r.Players[candidates[0]].Nickname
	}
	return ""
}

// filterBest returns the subset of candidates whose score (per scoreOf) equals
// the maximum. Used to chain tiebreakers in determineMatchWinner.
func filterBest(candidates []int, scoreOf func(int) int) []int {
	if len(candidates) == 0 {
		return candidates
	}
	best := scoreOf(candidates[0])
	for _, i := range candidates[1:] {
		if s := scoreOf(i); s > best {
			best = s
		}
	}
	out := candidates[:0]
	for _, i := range candidates {
		if scoreOf(i) == best {
			out = append(out, i)
		}
	}
	return out
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
	// A draw is not an interruptable event; close the window so the next
	// player can act normally without a stale jump-in opportunity.
	r.State.closeInterruptWindow()
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
	r.State.closeInterruptWindow()
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

// InterruptPlay is the single-card form of InterruptPlayCards.
func (r *Room) InterruptPlay(playerIndex int, card Card, chosenPlayer int) error {
	return r.InterruptPlayCards(playerIndex, []Card{card}, chosenPlayer)
}

// InterruptPlayCards allows any non-current player to "take the lead" by playing
// one or more identical cards (same color+kind+value) that match the top of the
// discard pile.
//
// Server-authoritative checks (in order):
//   - game in progress
//   - interrupt window still open (LastPlayBy >= 0 and now < InterruptDeadline)
//   - caller is NOT the player who just played
//   - no pending draw penalty active
//   - cards are non-empty and all identical
//   - first card is not a Wild (wilds can't be used to interrupt)
//   - caller has at least len(cards) copies
//   - first card matches top exactly (color+kind+value)
//
// Resolution order ("fastest valid wins") is enforced naturally by the hub's
// single-goroutine event loop: the first message dequeued mutates state and
// closes/resets the window; later attempts are evaluated against post-mutation
// state.
//
// On success, the cards are appended to discard, the interrupter becomes the
// current turn, the played card's effect is applied (stacked for batch +2 /
// Skip / Reverse), and the interrupt window is re-armed for the new top card.
//
// On any rejection, no state is mutated.
func (r *Room) InterruptPlayCards(playerIndex int, cards []Card, chosenPlayer int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if len(cards) == 0 {
		return errors.New("no cards specified")
	}
	first := cards[0]
	for i := 1; i < len(cards); i++ {
		if cards[i] != first {
			return errors.New("batch cards must be identical")
		}
	}
	// Explicit interrupt window check.
	if r.State.LastPlayBy < 0 {
		return errors.New("interrupt window closed")
	}
	if !time.Now().Before(r.State.InterruptDeadline) {
		return errors.New("interrupt window expired")
	}
	if r.State.LastPlayBy == playerIndex {
		return errors.New("you just played; cannot interrupt yourself")
	}
	// Rule: a player whose normal turn is active must use play_card, not the
	// interrupt path. Interjecting is reserved for non-current players.
	if r.State.CurrentTurn == playerIndex {
		return errors.New("it is your turn; play normally instead of interrupting")
	}
	if first.IsWild() {
		// Black/wild cards have no fixed color identity and can never be
		// interjected (Wild, WildDrawFour, GlobalSwitch).
		return errors.New("wild cards cannot be used to interrupt")
	}
	// Rule: during an active Take2 chain, interjection is only permitted with
	// an identical DrawTwo, which extends the chain from the interjecter's seat.
	// All other interjects must wait for the pending penalty to resolve.
	if r.State.PendingDraw > 0 && first.Kind != DrawTwo {
		return errors.New("cannot interrupt active draw chain except with an identical DrawTwo")
	}
	if first.Kind == Swap || first.Kind == GlobalSwitch {
		// Swap is a colored card, but allowing batch + interrupt with Swap creates
		// nasty edge cases (multiple targets, swap order). Restrict to single
		// non-batch Swap interrupt for now.
		if len(cards) != 1 {
			return errors.New("Swap and GlobalSwitch cannot be batch-interrupted")
		}
		if first.Kind == GlobalSwitch {
			return errors.New("wild cards cannot be used to interrupt")
		}
	}
	if r.State.countInHand(playerIndex, first) < len(cards) {
		return errors.New("card not in hand")
	}

	top := r.State.topCard()
	identical := first.Color == top.Color && first.Kind == top.Kind && first.Value == top.Value
	if !identical {
		return errors.New("interrupt card must exactly match the top discard card")
	}

	// Validate Swap target up front; defer the actual hand exchange until
	// after the played card has been removed from the interjecter's hand
	// (otherwise Remove() would search the swapped-in opponent hand and fail).
	n := len(r.State.Hands)
	if first.Kind == Swap {
		if chosenPlayer < 0 || chosenPlayer >= n || chosenPlayer == playerIndex {
			return fmt.Errorf("invalid chosen_player %d for swap", chosenPlayer)
		}
	}

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	for _, c := range cards {
		r.State.Discard = append(r.State.Discard, c)
	}

	for _, c := range cards {
		cc := c
		r.State.logEvent(EventCardPlayed, playerIndex, &cc, first.Color)
	}

	// Per rules.md §13: a round-ending interject (actor empties their hand)
	// aborts the Swap effect — the actor wins before the hand exchange.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.finishRoundWin(playerIndex, first.Color)
		return nil
	}

	// Apply Swap hand exchange now that the played card has been removed.
	if first.Kind == Swap {
		r.State.Hands[playerIndex], r.State.Hands[chosenPlayer] = r.State.Hands[chosenPlayer], r.State.Hands[playerIndex]
	}

	r.State.updateLastCardState(playerIndex)

	// Lead transfers: interrupter becomes current player, then apply the
	// played card's effect from their seat (advances turn / sets penalty / flips dir).
	r.State.CurrentTurn = playerIndex
	r.State.CurrentTurn = r.State.ApplyEffect(first, first.Color)
	r.State.stackBatchEffects(first, len(cards)-1)
	r.State.HasDrawn = false
	r.State.armInterruptWindow(playerIndex)
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

	if card.Kind != r.State.topCard().Kind {
		return errors.New("counter card must match kind of draw card")
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	chosenColor = resolveChosenColor(card, chosenColor)

	r.State.Discard = append(r.State.Discard, card)
	c := card
	r.State.logEvent(EventCounterDraw, playerIndex, &c, chosenColor)

	r.State.updateLastCardState(playerIndex)

	if r.State.Hands[playerIndex].Size() == 0 {
		r.State.ActiveColor = chosenColor
		r.State.logEvent(EventGameFinished, playerIndex, nil, 0)
		r.endRound(playerIndex)
		return nil
	}

	next := r.State.ApplyEffect(card, chosenColor)
	r.State.HasDrawn = false
	r.State.CurrentTurn = next
	// Counter is also an interruptable play; arm the window so a third party
	// can stack another identical DrawTwo on top.
	r.State.armInterruptWindow(playerIndex)
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
	top := r.State.topCard()
	pile := r.State.Discard[:len(r.State.Discard)-1]
	r.State.Deck.Replenish(pile, top)
	r.State.Discard = []Card{top}
}
