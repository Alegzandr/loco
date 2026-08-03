package game

import (
	crand "crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"time"
)

// Status represents the lifecycle state of a room.
type Status int

const (
	StatusLobby Status = iota
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
	// failedCatchPenalty is what a Contre-LOCO! costs when it arrives too late.
	// The call is a wager: catching an undeclared seat is worth 2 cards to the
	// table, so calling it on a seat that already declared has to cost the
	// caller something, or the correct play is to mash the button on every
	// single card anybody ever holds.
	failedCatchPenalty = 1
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
	EventCatchFailed  EventKind = "catch_failed"
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
	Hands       []Hand
	Deck        *Deck
	Discard     []Card
	CurrentTurn int
	Direction   int // 1 = clockwise, -1 = counter-clockwise
	ActiveColor Color
	PendingDraw int  // accumulated draw penalty for next player
	HasDrawn    bool // true after a voluntary (non-penalty) draw this turn; reset on turn advance

	// Last-card declaration, tracked PER SEAT. A single slot cannot express the
	// board a Swap or a GlobalSwitch produces: both rearrange hands, so several
	// players can land on one card in the same instant and each of them owes the
	// table a declaration. Indexed by player index, sized in dealRound.
	LastCardDeclared []bool
	LastCardAt       []time.Time // when this seat's catch window opened; zero = closed

	EventLog []GameEvent

	// Interrupt window: explicit state for the realtime "lead taking" / jump-in
	// mechanic. After every successful play the window is opened: ANY player who
	// holds a card identical (color+kind+value) to the top discard may take the
	// lead by sending an interrupt_play — including the player who just played
	// and the player whose turn it currently is. There is deliberately no
	// deadline: the window stays open for as long as that card is on top, so the
	// race is decided by who reacts first, not by an arbitrary timer.
	// LastPlayBy < 0 means the window is closed (e.g. after DrawCard / PassTurn
	// / CounterDraw resolves the chain, or after round end).
	LastPlayBy int
	LastPlayAt time.Time
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

// setActiveColor is the ONLY way ActiveColor is written after the deal. It
// refuses Wild: that value matches no coloured card, so it would leave the
// whole table holding wilds as its only legal play (and the discard's colour
// ring would render purple-for-nothing). Every wild, GlobalSwitch included,
// names a real colour before reaching here; this is the last line of defence.
func (s *GameState) setActiveColor(c Color) {
	if c == Wild {
		return
	}
	s.ActiveColor = c
}

// armInterruptWindow opens / refreshes the interrupt window for the most recent play.
// Called by PlayCard, PlayCards, InterruptPlay(Cards), and CounterDraw.
func (s *GameState) armInterruptWindow(actor int) {
	s.LastPlayBy = actor
	s.LastPlayAt = time.Now()
}

// closeInterruptWindow closes the window explicitly (DrawCard / PassTurn / round end).
func (s *GameState) closeInterruptWindow() {
	s.LastPlayBy = -1
}

// openCatchWindow puts one seat on the hook: it owes the table a declaration
// and can be caught until catchWindow elapses.
func (s *GameState) openCatchWindow(playerIndex int) {
	s.LastCardDeclared[playerIndex] = false
	s.LastCardAt[playerIndex] = time.Now()
}

// updateLastCardState refreshes the UNO declaration tracking after a card is
// played: when the actor is now down to a single card their catch window opens
// with the current timestamp.
//
// Only that seat's flag is touched. Resetting a global flag on every play
// voided a legitimate declaration as soon as anybody else discarded inside the
// same 5 s window, which, with interjections, is most plays.
func (s *GameState) updateLastCardState(playerIndex int) {
	if s.Hands[playerIndex].Size() != 1 {
		return
	}
	s.openCatchWindow(playerIndex)
}

// openCatchWindowsAfterRearrange puts EVERY seat holding a single card on the
// hook after a Swap or a GlobalSwitch. Receiving your last card counts exactly
// like playing down to it: what the rule protects is the table's right to know
// somebody is one card from winning, and a hand that arrived by rotation is one
// nobody at the table has heard announced, including a seat that declared a
// moment ago, since the card it declared for is not the card it now holds.
func (s *GameState) openCatchWindowsAfterRearrange() {
	for i := range s.Hands {
		if s.Hands[i].Size() == 1 {
			s.openCatchWindow(i)
		}
	}
}

// catchWindowOpen reports whether targetIndex can still be caught at now.
func (s *GameState) catchWindowOpen(targetIndex int, now time.Time) bool {
	at := s.LastCardAt[targetIndex]
	return !at.IsZero() && now.Sub(at) <= catchWindow
}

// CatchWindowEnd is when seat i's window shuts. Only meaningful for a seat
// CatchableTargets just named: it exists so the server can tell a client how
// long it has, instead of the client keeping its own copy of the duration and
// its own copy of the rule that opens the window.
func (s *GameState) CatchWindowEnd(i int) time.Time {
	return s.LastCardAt[i].Add(catchWindow)
}

// CatchableTargets returns every seat that owes the table a declaration at now,
// oldest window first, i.e. the one about to expire is the one a catcher who
// named no target gets. Several seats at once is the normal case after a Swap
// or a GlobalSwitch.
func (s *GameState) CatchableTargets(now time.Time) []int {
	var out []int
	for i := range s.Hands {
		if s.Hands[i].Size() == 1 && !s.LastCardDeclared[i] && s.catchWindowOpen(i, now) {
			out = append(out, i)
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		return s.LastCardAt[out[a]].Before(s.LastCardAt[out[b]])
	})
	return out
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
	r.State.setActiveColor(activeColor)
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

	// MapID is the room this match is played in: presentation only, drawn once
	// per match by Start(). Empty until then, and again after a rematch reset:
	// a rematch is a new match and gets a new room. See maps.go.
	MapID MapID

	// Match state (persists across rounds)
	RoundNumber   int   // current round (1-based, set to 1 on Start)
	Scores        []int // cumulative match scores per playerID
	RoundsWon     []int // rounds won per playerID
	LostHandTotal []int // sum of remaining hand values for the round losers (tiebreaker)
	// RoundHistory[k][playerID] = points scored by that player in round k+1.
	// Cumulative Scores alone cannot be broken back down per round once a player
	// wins twice, and the in-game score table shows every round played so far,
	// including after a reconnect, which is why this lives on the server.
	RoundHistory [][]int

	// Signals for the hub to act on (set by endRound, cleared by hub)
	RoundEnded  bool
	MatchOver   bool
	MatchWinner string

	// rng is overridable in tests; defaults to a crypto-seeded source.
	rng *rand.Rand
}

// newRNG builds a room's source of randomness, seeded from crypto/rand.
//
// The seed is not the clock, and that is the whole point. This one source
// decides the map, the starting seat and — through dealRound — the shuffle of
// all 112 cards, for this round and every round after it: it *is* the hidden
// state the server exists to protect. A math/rand source seeded from
// time.Now().UnixNano() hands that state to anyone who can time the room's
// creation, because rand.NewSource is deterministic and the observables leak
// the seed. An attacker creates a table, notes the round-trip (a window of a
// few milliseconds, so a few million candidate nanoseconds), then reads back
// the map, the starting seat and their own eight cards from game_started. That
// hand alone is a forty-bit filter over the candidates, so exactly one seed
// survives — and it yields every opponent's hand, the draw order, and the deal
// of every remaining round of a BO7 at leisure. Interrupts, catch windows and
// counter-draws are all built on hands nobody else can see; predictable ones
// make the whole mechanic decoration.
//
// No math/rand fallback on the error path, for the reason tokens.go gives:
// since Go 1.24 crypto/rand.Read does not return an error, it panics if the OS
// entropy source is genuinely broken, and a server that can no longer deal an
// unpredictable hand should stop rather than deal a predictable one.
func newRNG() *rand.Rand {
	var b [8]byte
	_, _ = crand.Read(b[:])
	return rand.New(rand.NewSource(int64(binary.BigEndian.Uint64(b[:]))))
}

// NewRoom creates an empty lobby room.
func NewRoom(code string) *Room {
	return &Room{
		Code:       code,
		Status:     StatusLobby,
		Format:     BO1,
		MaxPlayers: defaultMaxPlayers,
		rng:        newRNG(),
	}
}

// ensureRNG gives the room a source if it has none. A Room built by NewRoom
// always has one; a Room decoded from JSON never does, because rng is
// unexported and no serialisation can carry it.
//
// A snapshot-restored room is the case where a clock seed was worst: the
// restore instant is announced to everyone by the server coming back up.
func (r *Room) ensureRNG() {
	if r.rng == nil {
		r.rng = newRNG()
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
// Allowed in a finished room too: its roster is still mutable because the host
// may call ResetForRematch and start a new match with whoever remains.
func (r *Room) RemoveLobbyPlayer(playerIdx int) (wasHost bool, err error) {
	if r.Status != StatusLobby && r.Status != StatusFinished {
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
	r.RoundHistory = nil
	r.RoundNumber = 1
	r.ensureRNG()

	// Drawn once per match, not per round: the table is the room the whole match
	// is played in, and swapping it between rounds would read as a bug.
	r.MapID = r.pickMap()

	r.Status = StatusPlaying
	r.dealRound(r.rng.Intn(n))
	return nil
}

// dealRound sets up a fresh GameState for the current round.
// startingPlayer is the player index who plays first; the first card's effect
// (if it is an action card) is applied from that player's seat.
func (r *Room) dealRound(startingPlayer int) {
	// Here as well as in Start, because a Room can also arrive from a snapshot
	// (hub/snapshot.go): rng is unexported, so a restored room comes back with a
	// nil source and would deal the next round off the global one without ever
	// saying so.
	r.ensureRNG()
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
		Hands:            hands,
		Deck:             deck,
		Discard:          []Card{firstCard},
		CurrentTurn:      startingPlayer,
		Direction:        1,
		ActiveColor:      firstCard.Color,
		LastPlayBy:       -1,
		LastCardDeclared: make([]bool, n),
		LastCardAt:       make([]time.Time, n),
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
		return ErrNotYourTurn
	}
	if r.State.PendingDraw > 0 {
		return ErrMustAnswerPenalty
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return ErrCardNotInHand
	}

	if !CanPlay(card, r.State.topCard(), r.State.ActiveColor) {
		return ErrIllegalPlay
	}

	// A wild carries no colour of its own; the player must name the one that
	// becomes active. GlobalSwitch is no exception: it rotates the hands *and*
	// sets the colour, so a rotation that also left the colour to chance would
	// be the one card whose outcome nobody chose.
	if card.IsWild() && chosenColor == Wild {
		return errors.New("must choose a color for a wild card")
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
	rearranged := card.Kind == Swap || card.Kind == GlobalSwitch
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

	if rearranged {
		r.State.openCatchWindowsAfterRearrange()
	} else {
		r.State.updateLastCardState(playerIndex)
	}

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
		return ErrNotYourTurn
	}
	if r.State.PendingDraw > 0 {
		return ErrMustAnswerPenalty
	}
	if have := r.State.countInHand(playerIndex, first); have < len(cards) {
		return stale(fmt.Errorf("hand has %d copies, need %d", have, len(cards)))
	}
	if !CanPlay(first, r.State.topCard(), r.State.ActiveColor) {
		return ErrIllegalPlay
	}
	if first.IsWild() && chosenColor == Wild {
		return errors.New("must choose a color for a wild card")
	}

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	chosenColor = resolveChosenColor(first, chosenColor)
	r.State.Discard = append(r.State.Discard, cards...)

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

	// One row per round, in play order: everyone scores 0 except the finisher.
	roundPoints := make([]int, len(r.Players))
	roundPoints[winnerIdx] = score
	r.RoundHistory = append(r.RoundHistory, roundPoints)

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

// ForfeitTo ends the match immediately and awards it to winnerIdx, without a
// round having finished. It is what happens when the other side of a match
// stops being there: a seat whose reconnect window closed, one that timed out
// of enough turns in a row to be declared away, or one that quit on purpose.
//
// The scoreboard is deliberately left exactly as it was. A forfeit is not a win
// on points, and dealing the abandoned round out to the survivor would write a
// row into the score table for a round nobody played to the end. What the
// player sees instead is a match that ended, and the reason for it: the hub
// says who left on the match_end that follows.
func (r *Room) ForfeitTo(winnerIdx int) error {
	if r.Status != StatusPlaying {
		return errors.New("forfeit is only possible during a match")
	}
	if winnerIdx < 0 || winnerIdx >= len(r.Players) {
		return fmt.Errorf("invalid player index %d", winnerIdx)
	}
	r.MatchWinner = r.Players[winnerIdx].Nickname
	r.MatchOver = true
	r.Status = StatusFinished
	if r.State != nil {
		r.State.logEvent(EventMatchEnd, winnerIdx, nil, 0)
	}
	return nil
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

// ResetForRematch returns a finished room to the lobby so the same players can
// play another match without recreating the room. Roster and lobby config
// (format, max players) survive; all per-match state is discarded. Callers must
// follow with Start() once the host confirms.
func (r *Room) ResetForRematch() error {
	if r.Status != StatusFinished {
		return errors.New("rematch is only available once the match is over")
	}
	r.Status = StatusLobby
	r.State = nil
	r.Winner = ""
	r.RoundEnded = false
	r.MatchOver = false
	r.MatchWinner = ""
	r.RoundNumber = 0
	// Cleared, not kept: the next Start() draws a new room. A rematch that opens
	// on the same table reads as "nothing happened", and it is also the moment
	// the loading gate exists for: a map nobody has downloaded yet.
	r.MapID = ""
	// Left nil rather than zeroed: Start() reallocates them sized to whatever
	// roster is present when the next match begins.
	r.Scores = nil
	r.RoundsWon = nil
	r.LostHandTotal = nil
	r.RoundHistory = nil
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

// DrawCard makes the current player draw from the deck: one card, or the whole
// pending stack if there is one. Either way the seat keeps its turn.
func (r *Room) DrawCard(playerIndex int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if r.State.CurrentTurn != playerIndex {
		return ErrNotYourTurn
	}

	// A forced draw does not cost the turn (rules.md §14.5): the victim takes the
	// whole accumulated stack and then plays normally, or passes. Cards *and* the
	// turn for one played card is two punishments, and it reads as a bug — the
	// hand jumps and the seat is gone before the player can act. It is also what
	// makes an off-colour +2 worth holding: it does not counter, but it plays as
	// an ordinary kind-match once the stack has been taken.
	n := 1
	if r.State.PendingDraw > 0 {
		n = r.State.PendingDraw
	} else if r.State.HasDrawn {
		return ErrAlreadyDrawn
	}

	// Nothing above this line has touched the state, and nothing below it can
	// fail. The order is the rule: clearing PendingDraw and setting HasDrawn
	// first, then returning "deck exhausted", evaporated the whole penalty
	// without a single card changing hands, and left the seat holding a turn it
	// had no legal way to end.
	r.ensureDeck(n)
	cards := r.State.Deck.DrawUpTo(n)
	r.State.Hands[playerIndex].Add(cards...)
	// The stack is settled by taking whatever the piles could give: a remainder
	// kept pending is a debt no draw can ever pay off. See DrawUpTo.
	r.State.PendingDraw = 0
	// Set whether or not cards came out: nothing but PlayCard / PassTurn / an
	// effect moves the turn on from here, and PassTurn requires HasDrawn.
	r.State.HasDrawn = true

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
		return ErrNotYourTurn
	}
	if !r.State.HasDrawn {
		return ErrMustDrawBeforePass
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
	// A declaration is spent, exactly like a catch: the flag stays true until a
	// new window opens on this seat (openCatchWindow), which is the only moment
	// the seat owes the table a call again. Without this the same single card
	// could be announced over and over, replaying the banner and the sting.
	if r.State.LastCardDeclared[playerIndex] {
		return ErrAlreadyDeclared
	}
	r.State.LastCardDeclared[playerIndex] = true
	r.State.logEvent(EventUnoDeclared, playerIndex, nil, 0)
	return nil
}

// The three ways a catch loses on timing rather than on legality. They are
// sentinels, not new strings: the wire text is unchanged, only now the hub can
// tell "you were too slow" (charge a card, say nothing about cheating) from
// "that target does not exist" (a client bug or an attack).
var (
	// ErrAlreadyDeclared — the target's LOCO! reached the server first.
	ErrAlreadyDeclared = errors.New("player already declared")
	// ErrCatchWindowExpired — the 5s window closed before the message landed.
	ErrCatchWindowExpired = errors.New("catch window expired")
	// ErrTargetNotSingleCard — the target's hand grew (a draw, a penalty) between
	// the click and the message, which closes the obligation just as effectively.
	ErrTargetNotSingleCard = errors.New("target does not have exactly 1 card")
)

// IsMissedCatch reports whether a CatchUndeclared error is a lost race — the
// only class of rejection that costs the caller a card.
func IsMissedCatch(err error) bool {
	return errors.Is(err, ErrAlreadyDeclared) ||
		errors.Is(err, ErrCatchWindowExpired) ||
		errors.Is(err, ErrTargetNotSingleCard)
}

// The refusals a correct client produces in ordinary play. Same treatment as
// the catch sentinels: the wire strings are unchanged, but the hub can now tell
// a lost race from a forged message.
var (
	// ErrAlreadyDrawn — a second draw in one turn, i.e. a double tap or a
	// message already in flight when the first one landed.
	ErrAlreadyDrawn = errors.New("you have already drawn this turn")
	// ErrMustDrawBeforePass — Pass arrived before the draw it was waiting on.
	ErrMustDrawBeforePass = errors.New("you must draw a card before passing")
	// ErrInterruptWindowClosed — somebody drew, passed or ended the round
	// between the button being armed and the message arriving.
	ErrInterruptWindowClosed = errors.New("interrupt window closed")
	// ErrInterruptMismatch — the discard changed under the interjecter. This is
	// what losing an interrupt race *is*: the card matched the top the player
	// could see, and a faster one landed on it first.
	ErrInterruptMismatch = errors.New("interrupt card must exactly match the top discard card")
	// ErrInterruptNotADrawCard — same race, seen during a draw chain.
	ErrInterruptNotADrawCard = errors.New("cannot interrupt active draw chain except with an identical draw card")
)

// The refusals that can only mean the client was acting on a board the server
// no longer has: the colour in play moved, the turn moved, or the hand it is
// offering is not the hand held for it. They carry the same wire strings as
// before; what is new is that the hub can hand that client a fresh snapshot
// instead of leaving it to re-offer an action the server will refuse again.
//
// A lost race is deliberately NOT one of these. Losing an interrupt is the
// normal outcome of a contested window and the client's board is correct, so
// answering it with a snapshot would put a full personalised game_state on the
// wire at the busiest moment of the busiest table. See IsLostRace.
var ErrStateMismatch = errors.New("client state is stale")

// staleState marks an error as a state mismatch without touching its text: the
// wire string is what the player reads, and it is not this rule's business.
type staleState struct{ err error }

func (e staleState) Error() string        { return e.err.Error() }
func (e staleState) Unwrap() error        { return e.err }
func (e staleState) Is(target error) bool { return target == ErrStateMismatch }

func stale(err error) error { return staleState{err} }

var (
	// ErrNotYourTurn — the seat moved on between the tap and the message.
	ErrNotYourTurn = stale(errors.New("not your turn"))
	// ErrIllegalPlay — the card does not match the top discard or the active
	// colour. A correct client never sends this: it checks the same rule first.
	ErrIllegalPlay = stale(errors.New("illegal card play"))
	// ErrCardNotInHand — the hand the client is playing from is not ours.
	ErrCardNotInHand = stale(errors.New("card not in hand"))
	// ErrMustAnswerPenalty — a play arrived while a draw stack was pending, so
	// the client had not seen the +2/+4 land.
	ErrMustAnswerPenalty = stale(errors.New("must counter or draw pending penalty cards first"))
)

// IsStateMismatch reports whether a refusal proves the client's board had
// drifted from the server's, i.e. whether it is worth re-sending the state.
func IsStateMismatch(err error) bool { return errors.Is(err, ErrStateMismatch) }

// IsLostRace reports whether a refusal is one this game produces against
// correct clients all match long, rather than a sign of a tampered one.
//
// It exists for the suspected_cheats metric. Interrupts are decided by arrival
// order and catches live for five seconds, so losing is the normal outcome of
// pressing the right button at the wrong millisecond; counting those made the
// metric a measure of how contested the table was. A number that rises with
// ordinary play is a number nobody investigates.
func IsLostRace(err error) bool {
	return errors.Is(err, ErrAlreadyDrawn) ||
		errors.Is(err, ErrMustDrawBeforePass) ||
		errors.Is(err, ErrInterruptWindowClosed) ||
		errors.Is(err, ErrInterruptMismatch) ||
		errors.Is(err, ErrInterruptNotADrawCard) ||
		errors.Is(err, ErrAlreadyDeclared)
}

// CatchUndeclared allows catcherIndex to penalize targetIndex for not declaring their last card.
func (r *Room) CatchUndeclared(catcherIndex, targetIndex int, now time.Time) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if targetIndex < 0 || targetIndex >= len(r.State.Hands) {
		return fmt.Errorf("invalid target %d", targetIndex)
	}
	if catcherIndex == targetIndex {
		return errors.New("cannot catch yourself")
	}
	if r.State.LastCardDeclared[targetIndex] {
		return ErrAlreadyDeclared
	}
	if r.State.Hands[targetIndex].Size() != 1 {
		return ErrTargetNotSingleCard
	}
	if !r.State.catchWindowOpen(targetIndex, now) {
		return ErrCatchWindowExpired
	}
	// The penalty shrinks to whatever is left; the catch itself always stands.
	// Cancelling a call that beat its target on time because the piles happen to
	// be empty punishes the one player who did everything right, and it is the
	// opposite of what the failed-catch penalty ten lines below already does.
	r.ensureDeck(undeclaredPenalty)
	cards := r.State.Deck.DrawUpTo(undeclaredPenalty)
	r.State.Hands[targetIndex].Add(cards...)
	// The penalty settles the debt: this seat is no longer catchable, whether it
	// drew the full two cards or the last one the piles had.
	r.State.LastCardDeclared[targetIndex] = true
	r.State.logEvent(EventUnoCaught, catcherIndex, nil, 0)
	return nil
}

// PenalizeFailedCatch charges catcherIndex one card for a Contre-LOCO! that lost
// its race (IsMissedCatch). It returns the cards actually drawn so the hub can
// send them to their owner.
//
// It deliberately touches nothing else: not the turn, not HasDrawn, not the
// target. A failed call is a side bet on somebody else's obligation, and the
// player who made it may not even be in turn.
//
// Like every other draw in this game it cannot fail — once every card sits in a
// hand the caller simply gets away with it, rather than the round freezing on an
// error nobody can act on.
func (r *Room) PenalizeFailedCatch(catcherIndex int) []Card {
	if r.Status != StatusPlaying || r.State == nil {
		return nil
	}
	if catcherIndex < 0 || catcherIndex >= len(r.State.Hands) {
		return nil
	}
	r.ensureDeck(failedCatchPenalty)
	drawn := r.State.Deck.DrawUpTo(failedCatchPenalty)
	if len(drawn) == 0 {
		return nil
	}
	r.State.Hands[catcherIndex].Add(drawn...)
	r.State.logEvent(EventCatchFailed, catcherIndex, nil, 0)
	return drawn
}

// InterruptPlay is the single-card form of InterruptPlayCards.
func (r *Room) InterruptPlay(playerIndex int, card Card, chosenColor Color, chosenPlayer int) error {
	return r.InterruptPlayCards(playerIndex, []Card{card}, chosenColor, chosenPlayer)
}

// InterruptPlayCards allows ANY player to "take the lead" by playing one or more
// identical cards (same color+kind+value) that match the top of the discard pile.
// There is no reaction deadline and no restriction on who may slam: the player
// who just played may take the lead back, and so may the player whose turn it
// currently is. Whoever's message reaches the hub first wins.
//
// Server-authoritative checks (in order):
//   - game in progress
//   - interrupt window still open (LastPlayBy >= 0 — closed by draw / pass / round end)
//   - cards are non-empty and all identical
//   - caller has at least len(cards) copies
//   - first card matches top exactly (color+kind+value)
//   - a wild names a real colour; a Swap names a valid target
//
// EVERY kind can interject, wilds included: a Wild slams onto a Wild, a
// WildDrawFour extends a +4 chain, a GlobalSwitch rotates hands from the
// interjecter's seat. Wilds share the wild colour, so "identical" still means
// the same kind and value — a Wild never lands on a WildDrawFour.
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
func (r *Room) InterruptPlayCards(playerIndex int, cards []Card, chosenColor Color, chosenPlayer int) error {
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
	// The window is open from the moment a card is played until a draw / pass /
	// round end resolves it. No deadline, no exclusion of the last actor or of
	// the current player: any identical card may be slammed at any moment.
	if r.State.LastPlayBy < 0 {
		return ErrInterruptWindowClosed
	}
	// Rule: during an active draw chain, only an identical draw card may be
	// interjected — it extends the chain from the interjecter's seat. In a
	// consistent state the identical-to-top check below already guarantees this;
	// the explicit guard keeps an inconsistent state from swallowing the penalty.
	if r.State.PendingDraw > 0 && first.Kind != DrawTwo && first.Kind != WildDrawFour {
		return ErrInterruptNotADrawCard
	}
	// Swap picks a target and GlobalSwitch rearranges every hand: stacking N of
	// them raises questions (which target? how many rotations?) that the rules
	// do not answer, so they stay single-card — same restriction as PlayCards.
	if (first.Kind == Swap || first.Kind == GlobalSwitch) && len(cards) != 1 {
		return errors.New("Swap and GlobalSwitch cannot be batch-interrupted")
	}
	// A wild carries no colour of its own; the interjecter must name the one
	// that becomes active, exactly as on a normal wild play.
	if first.IsWild() && chosenColor == Wild {
		return errors.New("must choose a color for a wild card")
	}
	if r.State.countInHand(playerIndex, first) < len(cards) {
		return ErrCardNotInHand
	}

	top := r.State.topCard()
	identical := first.Color == top.Color && first.Kind == top.Kind && first.Value == top.Value
	if !identical {
		return ErrInterruptMismatch
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

	chosenColor = resolveChosenColor(first, chosenColor)

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	r.State.Discard = append(r.State.Discard, cards...)

	for _, c := range cards {
		cc := c
		r.State.logEvent(EventCardPlayed, playerIndex, &cc, chosenColor)
	}

	// Per rules.md §13: a round-ending interject (actor empties their hand)
	// aborts the Swap / GlobalSwitch effect — the actor wins before the hands move.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.finishRoundWin(playerIndex, chosenColor)
		return nil
	}

	// Apply the hand-moving effects now that the played card has been removed.
	rearranged := first.Kind == Swap || first.Kind == GlobalSwitch
	if first.Kind == Swap {
		r.State.Hands[playerIndex], r.State.Hands[chosenPlayer] = r.State.Hands[chosenPlayer], r.State.Hands[playerIndex]
	} else if first.Kind == GlobalSwitch {
		newHands := make([]Hand, n)
		for i := range newHands {
			from := ((i-r.State.Direction)%n + n) % n
			newHands[i] = r.State.Hands[from]
		}
		r.State.Hands = newHands
	}

	if rearranged {
		r.State.openCatchWindowsAfterRearrange()
	} else {
		r.State.updateLastCardState(playerIndex)
	}

	// Lead transfers: interrupter becomes current player, then apply the
	// played card's effect from their seat (advances turn / sets penalty / flips dir).
	r.State.CurrentTurn = playerIndex
	r.State.CurrentTurn = r.State.ApplyEffect(first, chosenColor)
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
		return ErrNotYourTurn
	}
	if r.State.PendingDraw == 0 {
		return errors.New("no pending draw to counter")
	}
	if !r.State.Hands[playerIndex].Contains(card) {
		return ErrCardNotInHand
	}

	top := r.State.topCard()
	// The top of the discard has to actually be a draw card. Today it always is
	// whenever PendingDraw > 0 — PlayCard refuses everything under a pending
	// stack, InterruptPlayCards admits only DrawTwo/WildDrawFour into a chain,
	// and stackBatchEffects adds pending for no other kind — so this guard is
	// unreachable, and that is exactly why it is written down. The kind and
	// colour checks below derive "is this a legal counter" from the top card
	// alone; they say nothing on their own about the card being a draw card, so
	// any future kind that sets PendingDraw, or any future path that sets it
	// without landing a draw card on the pile, would silently make a Skip
	// counter a Skip. An invariant the rules rely on belongs in the code that
	// relies on it, not in the reachability argument above it.
	if top.Kind != DrawTwo && top.Kind != WildDrawFour {
		return errors.New("no draw card to counter")
	}
	if card.Kind != top.Kind {
		return errors.New("counter card must match kind of draw card")
	}
	// Same colour only — countering is passing the stack on with the *same* card,
	// so a red +2 is answered by a red +2. (Every +4 is Wild-coloured, so this is
	// automatically satisfied for a +4 chain.) A mismatched +2 is not lost: the
	// forced draw does not cost the turn (§14.5), so its holder takes the stack
	// and can then play it as an ordinary kind-match on the same discard.
	if card.Color != top.Color {
		return errors.New("counter card must match color of draw card")
	}
	// A +4 stacked onto the chain still names the colour that becomes active
	// once the stack resolves, exactly as on a normal wild play.
	if card.IsWild() && chosenColor == Wild {
		return errors.New("must choose a color for a wild card")
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
		r.State.setActiveColor(chosenColor)
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
	r.State.Deck.Replenish(pile)
	r.State.Discard = []Card{top}
}
