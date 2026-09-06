package game

import (
	crand "crypto/rand"
	"encoding/binary"
	"errors"
	"fmt"
	"math/rand"
	"sort"
	"strings"
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
	// catchLockout is how long a Contre-LOCO! that found nobody puts its caller
	// out of the mechanic. It is the second half of the price, and it is the
	// half a held thumb pays.
	//
	// The card (failedCatchPenalty) is rationed per *offer*, which bounds what
	// mashing costs but not what it buys: press, pay one card, keep pressing —
	// every later press against the same near-finish picture is silent and free
	// — and the press that happens to land on the frame a window opens takes the
	// catch, because a catch that lands spends no offer. So a spammer paid one
	// card and collected every window at the table, each of them worth two cards
	// to somebody else. The reflex the button is supposed to measure was not in
	// it anywhere.
	//
	// So the card is per offer and **the lockout is per press**: any call that
	// finds nobody arms it, charged or not, and while it runs the button is
	// refused outright — no catch, no card, no broadcast. A thumb that never
	// lets go re-arms its own lock forever and is therefore never live at the
	// instant a window opens; a single aimed press pays it once and has the rest
	// of the window back.
	//
	// Two seconds, and the number is the declaration it has to protect. A seat
	// that plays down to one card needs a beat to notice and call it, and that
	// beat is exactly what a mashed button used to take: this is the stretch
	// CatchHeadStart (1.5s, retired) held open for the seat that owed the call,
	// plus the margin the press may arrive before the play. Against a 5s window
	// it is short enough that a genuine forgotten LOCO! is still catchable by
	// the same player three seconds later — being punished must not be an
	// amnesty for the table.
	catchLockout = 2 * time.Second
	// catchWindow is how long after a player's last card play other players can catch them.
	catchWindow = 5 * time.Second
	// catchGrace is how long past a window a Contre-LOCO! is still a wager: a
	// press made there is a call that came too late, charged like any other
	// miss, rather than a call on a seat that was never on the hook.
	//
	// It is the *late* half of the mistake this button is made of. A press can
	// be too early — the seat had not spoken yet, or never would — and that is a
	// wager anybody can make and win. It has to be possible to be too late in
	// the same way, and it was not: the button went dark on the frame the offer
	// vanished, whether the window ran out or the seat's hand grew, which
	// quietly took the losing half of the wager away and left a control that
	// only ever let you press when pressing was safe. An interface that cannot
	// be got wrong is not measuring anything.
	//
	// **The client offers that late press for less than this** (1s,
	// CATCH_LATE_GRACE_MS, and serverMirrors.test.ts pins the inequality): the
	// difference is the wire. The player is given one second to be late in, and
	// the second second is the round trip that press still has to make — a call
	// the player was allowed to send and this server then dropped in silence
	// would be the same failure as the dark button, arriving from the other
	// side.
	//
	// The distinction is what stops the penalty being a free broadcast. Every
	// timing refusal costs the caller a card, which is what makes the wager
	// honest — but a call on a seat holding five cards was never a wager, and it
	// was answered exactly like a lost race: a catch_failed to every seat at the
	// table, at whatever rate the limiter allows, and free the moment the piles
	// run dry and the penalty draw comes back empty. Outside this grace the call
	// is refused to its sender alone.
	catchGrace = 2 * time.Second
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
	// EventSeatRetired is a seat that walked out of a match in progress. See
	// Room.RetireSeat.
	EventSeatRetired EventKind = "seat_retired"
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

	// CatchPaidFor[i] is the offer (catchOfferKey) seat i last paid a card for
	// with a Contre-LOCO! that found nothing. "" = never. A fruitless call is
	// rationed by the offer and not by the press: the button is live while some
	// other seat is one play from the finish, so a player who presses it twice
	// against the same near-finish picture has made one misread, not two.
	//
	// This is also the whole of what stands between the mechanic and a mashed
	// button, and it is enough because the price follows the *picture* rather
	// than the press: a thumb held down through a round pays a card every time
	// the near-finish picture changes — a seat reaching two, a window opening,
	// another seat joining them — and every card it pays makes the hand it is
	// trying to empty bigger. A catch that lands spends nothing, which is the
	// point: pressing once, at the right instant, is free and is the whole
	// skill the button measures.
	// Indexed by player index like every other seat-keyed slice here, and sized
	// in dealRound.
	CatchPaidFor []string

	// CatchLockedUntil[i] is the instant seat i may press Contre-LOCO! again
	// after a call that found nobody. Zero = not locked.
	//
	// It is the other half of the price, and it is rationed per *press* where
	// CatchPaidFor is rationed per offer (catchLockout). The card bounds the
	// farm; this bounds the snipe — the held button that pays one card and then
	// takes, for free, every window that opens at the table, because a catch
	// that lands spends no offer. Armed by every fruitless call, re-armed by
	// every press made while it runs, so a thumb that never lets go is never
	// live when a window opens; the honest single press pays it once and gets
	// the rest of the window back.
	//
	// Indexed by player index like every other seat-keyed slice here, and sized
	// in dealRound.
	CatchLockedUntil []time.Time

	// Retired marks the seats that have left the match for good, copied from
	// Room.Retired at every deal. The seat stays in every index — hands, scores
	// and turn order are keyed by it, and its score is kept exactly as it was —
	// but it holds no cards, takes no turns and is dealt none. See
	// Room.RetireSeat.
	Retired []bool

	EventLog []GameEvent

	// Interrupt window: explicit state for the realtime "lead taking" / jump-in
	// mechanic. While it is open, ANY player who holds a card identical
	// (color+kind+value) to the top discard may take the lead by sending an
	// interrupt_play — including the player who just played and the player whose
	// turn it currently is. There is deliberately no deadline: the window stays
	// open for as long as that card is on top, so the race is decided by who
	// reacts first, not by an arbitrary timer.
	//
	// InterruptOpen is the window; LastPlayBy is who put the card there. They are
	// two facts and used to be one field, which is what kept the opening discard
	// out of the mechanic: a dealt card has no author, so "closed" was the only
	// thing a seat index could say about it, and a player holding its twin was
	// answered with "somebody was faster" before anybody had played at all. The
	// deal now opens the window with LastPlayBy still -1 — nobody owns that card,
	// and every seat may slam it.
	//
	// Closed (InterruptOpen false) after DrawCard / PassTurn / CounterDraw
	// resolving the chain, and at round end.
	InterruptOpen bool
	LastPlayBy    int
	LastPlayAt    time.Time
}

// pushDiscard puts played cards on the pile. Replenish is not a play and
// deliberately does not go through here.
func (s *GameState) pushDiscard(cards ...Card) {
	s.Discard = append(s.Discard, cards...)
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
	s.InterruptOpen = true
	s.LastPlayBy = actor
	s.LastPlayAt = time.Now()
}

// closeInterruptWindow closes the window explicitly (DrawCard / PassTurn / round end).
func (s *GameState) closeInterruptWindow() {
	s.InterruptOpen = false
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

// ErrMustDeclareLoco is a play that would empty the hand of a seat that never
// called LOCO! for the cards it is putting down. Forgetting the call and winning
// anyway is the one combination the rule exists to forbid (docs/rules.md §8):
// without this gate the declaration was only ever a 5 s risk, and a seat that
// survived its window — or, by emptying a two-card hand in one batch, never
// opened one — took the round having told the table nothing.
var ErrMustDeclareLoco = errors.New("must call LOCO! before playing your last card")

// requireLocoToFinish gates every hand-emptying play on the declaration the
// seat owes the table. `playing` is how many cards this play puts down and
// `declaring` whether the message itself carried the call.
//
// The two branches are not the same rule wearing two shapes, and the difference
// is who had the opportunity:
//
//   - Down to one card already: the seat has held that card since before this
//     message, so it had a call to make and a whole window to make it in. Only a
//     declaration that already happened counts. A flag on this message would let
//     the client fold the obligation into the winning tap, which is the same as
//     not having the rule.
//   - Emptying two or more in one batch: the hand never passed through one card,
//     so no declaration was ever possible and none can be demanded of the past.
//     This message is the only place the call can be made, so it has to carry
//     it, and the server refuses the batch that does not.
//
// A seat is never trapped by the first branch: DeclareLastCard accepts a late
// call at any point while the hand is one card, so forgetting costs the catch
// risk and a press, never the round.
func (s *GameState) requireLocoToFinish(playerIndex, playing int, declaring bool) error {
	if s.Hands[playerIndex].Size() != playing {
		return nil
	}
	if playing == 1 {
		if !s.LastCardDeclared[playerIndex] {
			return ErrMustDeclareLoco
		}
		return nil
	}
	if !declaring {
		return ErrMustDeclareLoco
	}
	return nil
}

// declareForFinish records the call a hand-emptying batch carried, so the round
// the table is about to lose ends on an announcement rather than on silence. The
// flag is set for the same reason every other declaration sets it — the log and
// the broadcast read the state, not the message.
func (s *GameState) declareForFinish(playerIndex int) {
	s.LastCardDeclared[playerIndex] = true
	s.logEvent(EventUnoDeclared, playerIndex, nil, 0)
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

// catchRaceRecent reports whether targetIndex has been on the hook recently
// enough for a call on it to be a race at all. A seat whose window never opened,
// or opened long enough ago that no client is still drawing the button, is not
// one somebody can lose a race against.
func (s *GameState) catchRaceRecent(targetIndex int, now time.Time) bool {
	at := s.LastCardAt[targetIndex]
	return !at.IsZero() && now.Sub(at) <= catchWindow+catchGrace
}

// CatchWindowEnd is when seat i's window shuts. Only meaningful for a seat
// CatchableTargets just named: it exists so the server can tell a client how
// long it has, instead of the client keeping its own copy of the duration and
// its own copy of the rule that opens the window.
func (s *GameState) CatchWindowEnd(i int) time.Time {
	return s.LastCardAt[i].Add(catchWindow)
}

// catchNearHand is the biggest hand a Contre-LOCO! is offered against: one
// ordinary play from owing the call. Mirrored by the client's
// CATCH_LIVE_MAX_HAND, and the reasoning is the same on both sides: nothing
// takes a seat from three cards to one in a single action, so from three cards
// out the button would be live through a long stretch of round where pressing
// it can only ever miss — and a miss a player can schedule is a card drawn on
// purpose. It used to be reachable, by an interject of two identical cards;
// an interject is one card now, so the threshold is exact rather than nearly
// exact.
const catchNearHand = 2

// catchOffered reports whether seat i is what makes the Contre-LOCO! button
// worth pressing at now, as seen from catcher's chair: a seat whose window is
// still recent enough for a call on it to be a race (catchRaceRecent), or a
// seat on exactly catchNearHand cards, which is one ordinary play from opening
// one. A seat that has been sitting on a card long after its window shut is
// neither, and nothing a correct client shows lights up on it.
//
// **The window outlives the hand it opened on, deliberately.** A seat on its
// last card can leave the near-finish picture without a card being played —
// it draws, it swallows a stack of four, a Contre-LOCO! lands on it and its
// hand grows by two — and read off the hand alone, the offer vanished on that
// frame and a press a moment later was answered by nobody and charged to
// nobody. That is the losing half of the wager being taken away from the
// player: the thumb was already on its way down, and it is the thumb this
// mechanic exists to measure. So the offer is the window, and it runs its
// course whatever the hand does inside it.
func (s *GameState) catchOffered(catcher, i int, now time.Time) bool {
	if i == catcher || s.Retired[i] {
		return false
	}
	if s.catchRaceRecent(i, now) {
		return true
	}
	return s.Hands[i].Size() == catchNearHand
}

// CatchOffered reports whether a Contre-LOCO! from catcher is a wager at now —
// whether any other seat is near enough the finish for the button to be live
// on an honest screen. A press against a table where it is not is a client
// whose board moved under its thumb, or a client this game did not write;
// either way there is nothing to charge and nobody to tell.
func (r *Room) CatchOffered(catcher int, now time.Time) bool {
	if r.Status != StatusPlaying || r.State == nil {
		return false
	}
	if catcher < 0 || catcher >= len(r.State.Hands) {
		return false
	}
	for i := range r.State.Hands {
		if r.State.catchOffered(catcher, i, now) {
			return true
		}
	}
	return false
}

// CatchLockedAt is when catcher's lockout ends: the instant its Contre-LOCO!
// becomes pressable again after a call that found nobody. A zero time means
// the seat is not locked, and so does an instant already past — the lock ends
// on the clock, like every other deadline in this mechanic. Out-of-range seats
// answer zero rather than panicking: this is read on the way to the wire.
func (r *Room) CatchLockedAt(catcher int) time.Time {
	if r.State == nil || catcher < 0 || catcher >= len(r.State.CatchLockedUntil) {
		return time.Time{}
	}
	return r.State.CatchLockedUntil[catcher]
}

// CatchLocked reports whether catcher is inside its lockout at now, i.e.
// whether every Contre-LOCO! from that seat is refused outright.
func (r *Room) CatchLocked(catcher int, now time.Time) bool {
	at := r.CatchLockedAt(catcher)
	return !at.IsZero() && now.Before(at)
}

// LockCatch arms — or re-arms — catcher's lockout and returns the instant it
// now ends. Called for every call that finds nobody and for every press made
// while one is already running: the card is rationed per offer, this is
// rationed per press, and that asymmetry is the whole of what a held button
// costs (catchLockout). It touches nothing else, so a seat may be locked out
// of the mechanic while it plays its turn normally.
func (r *Room) LockCatch(catcher int, now time.Time) time.Time {
	if r.State == nil || catcher < 0 || catcher >= len(r.State.CatchLockedUntil) {
		return time.Time{}
	}
	until := now.Add(catchLockout)
	r.State.CatchLockedUntil[catcher] = until
	return until
}

// catchOfferKey names the offer catcher is pressing against: the window of
// every seat that has one, and the hand size of every seat that is one play
// from opening one. A fruitless call is charged once per key
// (PenalizeFailedCatch), which is the whole of "only the first press counts".
// What is deliberately NOT in it is the catcher's own hand and the cards other
// seats play from far out: a seat that takes a penalty and then plays a card of
// its own has not been offered a second wager, and neither has one that watched
// a six-card hand become five.
// Rationed by cards played, a press before and a press after the catcher's own
// play bought two cards per turn off one seat sitting on two, which is faster
// than the voluntary draw and is what a hand stocked up for a Swap was made of.
func (s *GameState) catchOfferKey(catcher int, now time.Time) string {
	var b strings.Builder
	for i := range s.Hands {
		if !s.catchOffered(catcher, i, now) {
			continue
		}
		// A seat with a window is keyed on the window and never on its hand,
		// because the hand is exactly what moves underneath it: a draw, or the
		// two cards a catch that landed just cost it. Keyed on the size, the
		// second press of one misread — the one made a beat too late, at the
		// board the player was actually looking at — came out as a fresh offer
		// and was charged a second card for the same mistake.
		if s.catchRaceRecent(i, now) {
			fmt.Fprintf(&b, "%d@%d;", i, s.LastCardAt[i].UnixNano())
			continue
		}
		fmt.Fprintf(&b, "%d:%d;", i, s.Hands[i].Size())
	}
	return b.String()
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
// ends the round. Used by every path that can empty a hand: PlayCard,
// PlayCards, InterruptPlayCards and CounterDraw.
//
// CounterDraw used to carry its own copy of the first, third and fourth lines,
// and the missing one was this one: a counter that won the round left the
// interrupt window armed over a round that was already over. Nothing could be
// interjected into it, but only because of the order the hub happens to run its
// checks in — an argument about a caller standing in for a rule about the
// state. There is one win path now, and it is this.
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
	// MapTime and MapWeather are the hour and the sky the match is dealt under,
	// drawn beside MapID and cleared with it. Presentation only, like the map:
	// the client renders the scene from the three ids, so every seat has to be
	// handed the same three.
	MapTime    TimeOfDay
	MapWeather Weather

	// Match state (persists across rounds)
	RoundNumber   int   // current round (1-based, set to 1 on Start)
	Scores        []int // cumulative match scores per playerID
	RoundsWon     []int // rounds won per playerID
	LostHandTotal []int // sum of remaining hand values for the round losers (tiebreaker)
	// Retired marks the seats that walked out of this match. Match-level, not
	// per round: leaving is for the rest of the match, so it survives every deal
	// and is cleared only when a new match starts. See RetireSeat.
	Retired []bool
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

// SwapLobbyPlayers exchanges two seats (lobby only).
//
// It exists for one caller, transfer_host, and it is a swap rather than a move
// to the front because a move re-bases every seat between the two and a swap
// moves exactly two. The hub mirrors it seat for seat: whatever this does to the
// roster, table.swapSeats does to the members, the tokens and the bot set.
//
// Lobby only, and deliberately not allowed in a finished room the way
// RemoveLobbyPlayer is: Scores, RoundsWon and LostHandTotal are indexed by seat
// and would follow the wrong player into the next match.
func (r *Room) SwapLobbyPlayers(a, b int) error {
	if r.Status != StatusLobby {
		return errors.New("can only reorder seats in the lobby")
	}
	if a < 0 || a >= len(r.Players) || b < 0 || b >= len(r.Players) {
		return fmt.Errorf("invalid player index")
	}
	if a == b {
		return nil
	}
	r.Players[a], r.Players[b] = r.Players[b], r.Players[a]
	r.Players[a].Index = a
	r.Players[b].Index = b
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
	// Everything the scoreboard is drawn from is indexed by seat, and a
	// finished room keeps its scores for the game-over screen: re-basing the
	// roster without them showed the leaver's column under the seat above it.
	r.Scores = dropSeat(r.Scores, playerIdx)
	r.RoundsWon = dropSeat(r.RoundsWon, playerIdx)
	r.LostHandTotal = dropSeat(r.LostHandTotal, playerIdx)
	r.Retired = dropSeat(r.Retired, playerIdx)
	for k := range r.RoundHistory {
		r.RoundHistory[k] = dropSeat(r.RoundHistory[k], playerIdx)
	}
	return wasHost, nil
}

// dropSeat is `s` without index `i`, re-based; a slice too short to hold the
// seat is returned as it was.
func dropSeat[T any](s []T, i int) []T {
	if i < 0 || i >= len(s) {
		return s
	}
	out := make([]T, 0, len(s)-1)
	out = append(out, s[:i]...)
	return append(out, s[i+1:]...)
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
	r.Retired = make([]bool, n)
	r.RoundHistory = nil
	r.RoundNumber = 1
	r.ensureRNG()

	// Drawn once per match, not per round: the table is the room the whole match
	// is played in, and swapping it between rounds would read as a bug. The hour
	// and the sky are drawn with it, for the same reason.
	r.MapID = r.pickMap()
	r.MapTime = r.pickTime()
	r.MapWeather = r.pickWeather(r.MapID)

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

	// A seat that walked out is dealt nothing. It keeps its index — the scores,
	// the roster and the turn order are all keyed by it — and holds no cards, so
	// it can neither be caught, be swapped with, nor score.
	retired := make([]bool, n)
	copy(retired, r.Retired)
	hands := make([]Hand, n)
	for i := range hands {
		if retired[i] {
			continue
		}
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
		// The opening discard is live like any other top card: a seat holding its
		// twin may slam it before the round's first turn is taken. Nobody played
		// it, so LastPlayBy stays -1 and LastPlayAt stays zero — the window is
		// open and belongs to no seat. That pair is also what keeps the bots out
		// of this one window: they read LastPlayBy, and the hub only ever
		// schedules them off a human's move.
		InterruptOpen:    true,
		LastPlayBy:       -1,
		LastCardDeclared: make([]bool, n),
		LastCardAt:       make([]time.Time, n),
		CatchPaidFor:     make([]string, n),
		CatchLockedUntil: make([]time.Time, n),
		Retired:          retired,
	}

	// The seat that opens the round has to be one that can play. biggestLoser
	// already skips the retired, and this is the belt: startingPlayer also
	// arrives from the random draw of round 1 and from a caller.
	if r.State.isRetired(r.State.CurrentTurn) {
		r.State.CurrentTurn = r.State.nextTurn(r.State.CurrentTurn)
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
		if r.State.isRetired(chosenPlayer) {
			return errors.New("that seat has left the match")
		}
	}

	// Last in the validation block and last for a reason: an illegal card is
	// refused as illegal, and only a card that would otherwise take the round is
	// asked whether the table was told it was coming.
	if err := r.State.requireLocoToFinish(playerIndex, 1, false); err != nil {
		return err
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	chosenColor = resolveChosenColor(card, chosenColor)

	r.State.pushDiscard(card)
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
		// Through rotateSeats, not the modular step it looks like: a retired seat
		// is not in the circle, and handing it a hand would take the next
		// player's away into a seat nobody can play from.
		src := r.State.rotateSeats(r.State.Direction)
		for i := range newHands {
			newHands[i] = r.State.Hands[src[i]]
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
// chosenColor and chosenPlayer follow PlayCard semantics. declareLoco is the
// call the message carried, and it is only ever consulted when the batch would
// empty the hand — see requireLocoToFinish.
func (r *Room) PlayCards(playerIndex int, cards []Card, chosenColor Color, chosenPlayer int, declareLoco bool) error {
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
	finishing := r.State.Hands[playerIndex].Size() == len(cards)
	if err := r.State.requireLocoToFinish(playerIndex, len(cards), declareLoco); err != nil {
		return err
	}

	for i := 0; i < len(cards); i++ {
		if err := r.State.Hands[playerIndex].Remove(first); err != nil {
			return err
		}
	}
	chosenColor = resolveChosenColor(first, chosenColor)
	r.State.pushDiscard(cards...)

	// The call is recorded before the cards, so the log reads in the order the
	// table hears it: LOCO!, then the cards, then the round.
	if finishing {
		r.State.declareForFinish(playerIndex)
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

	// One row per round, in play order: everyone scores 0 except the finisher.
	roundPoints := make([]int, len(r.Players))
	roundPoints[winnerIdx] = score
	r.RoundHistory = append(r.RoundHistory, roundPoints)

	r.State.logEvent(EventRoundEnd, winnerIdx, nil, 0)
	r.RoundEnded = true

	// Match-over check. Two ways a match can stop, and only one of them is the
	// format running out: a lead in rounds won that the rounds left cannot catch
	// ends it on the spot, which is what "best of 3" has always meant everywhere
	// else and what the format labels now say. See decisiveLeader.
	//
	// Sudden death is still the answer when the last round lands on a table
	// nothing separates: determineMatchWinner returns "" and the room keeps
	// dealing.
	if r.decisiveLeader() >= 0 || r.RoundNumber >= int(r.Format) {
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

// IsRetired reports whether a seat has walked out of the match. Read off the
// match-level flags rather than the round's, so it answers the same between two
// deals; bounds-checked because seat numbers arrive from the wire.
func (r *Room) IsRetired(playerIndex int) bool {
	return playerIndex >= 0 && playerIndex < len(r.Retired) && r.Retired[playerIndex]
}

// ErrSeatAlreadyRetired is a second departure from the same seat: a duplicate
// message, or one already in flight when the first landed.
var ErrSeatAlreadyRetired = errors.New("that seat has already left the match")

// RetireSeat takes a seat out of the match it is in the middle of, for good.
//
// A player who has to go has no other exit but the turn clock, which auto-draws
// and auto-passes for them until the AFK threshold — two rounds spoiled for
// everybody else rather than one player leaving. Whether the match goes on
// afterwards is the hub's question (two playable seats must remain, or it ends
// the match instead); this is what happens when the answer is yes.
//
//   - **The hand goes back to the deck**, shuffled in. Those cards were hidden,
//     so nothing is learnt by their new position, and leaving them in a hand
//     nobody holds would shrink the deck for everybody else every time somebody
//     left.
//   - **The seat stays.** Hands, scores, rounds won and the turn order are all
//     indexed by it, and the scoreboard keeps the row exactly as it stood: this
//     is a departure, not a forfeit, and the player neither wins nor loses the
//     match by it.
//   - **The turn moves on immediately** if it was theirs. Waiting for the clock
//     to notice is the thing this exists to stop.
//   - **It closes their catch window**, because a seat that cannot be caught and
//     cannot declare must not be sitting on an obligation the table can press a
//     button at.
func (r *Room) RetireSeat(playerIndex int) error {
	if r.Status != StatusPlaying || r.State == nil {
		return errors.New("game not in progress")
	}
	if playerIndex < 0 || playerIndex >= len(r.State.Hands) {
		return fmt.Errorf("invalid player index %d", playerIndex)
	}
	if r.State.isRetired(playerIndex) {
		return ErrSeatAlreadyRetired
	}

	returned := r.State.Hands[playerIndex].Cards
	r.State.Hands[playerIndex] = Hand{}
	if len(returned) > 0 {
		r.ensureRNG()
		r.State.Deck.Cards = append(r.State.Deck.Cards, returned...)
		r.State.Deck.Shuffle(r.rng)
	}

	if playerIndex < len(r.Retired) {
		r.Retired[playerIndex] = true
	}
	r.State.Retired[playerIndex] = true

	// No cards, so no obligation and no window. Set rather than left alone: the
	// flag is what CatchableTargets reads, and a stale one would arm
	// Contre-LOCO! on a seat that is not there.
	r.State.LastCardDeclared[playerIndex] = true
	r.State.LastCardAt[playerIndex] = time.Time{}

	if r.State.CurrentTurn == playerIndex {
		r.State.HasDrawn = false
		// A pending stack dies with the seat it was aimed at: passing it on would
		// be a penalty the next player never earned, and holding it would be a
		// debt nobody can pay.
		r.State.PendingDraw = 0
		r.State.CurrentTurn = r.State.nextTurn(playerIndex)
		r.State.closeInterruptWindow()
	}

	r.State.logEvent(EventSeatRetired, playerIndex, nil, 0)
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
	// the loading gate exists for: a scene nobody has rendered yet.
	r.MapID = ""
	r.MapTime = ""
	r.MapWeather = ""
	// Left nil rather than zeroed: Start() reallocates them sized to whatever
	// roster is present when the next match begins.
	r.Scores = nil
	r.RoundsWon = nil
	r.LostHandTotal = nil
	r.Retired = nil
	r.RoundHistory = nil
	return nil
}

// decisiveLeader returns the seat whose lead in rounds won can no longer be
// caught, or -1 when the match is still open.
//
// One expression covers both endings the match has. A seat is decisive when its
// rounds won are strictly greater than every other seat's plus every round still
// to be played, and `remaining` is zero once the format is exhausted — so the
// same test that stops a best-of-7 at 4–0 is the one that says a best-of-1 ended
// on its only round. What it deliberately does not answer is a table it cannot
// separate: that is determineMatchWinner's chain, and past it, sudden death.
//
// Written as "strictly greater than everyone else" rather than "reached the
// majority" because the majority is only the right number at two seats. Six
// players sharing a best-of-7 never reach 4, and the match still has to end.
func (r *Room) decisiveLeader() int {
	remaining := int(r.Format) - r.RoundNumber
	if remaining < 0 {
		remaining = 0
	}
	for i := range r.RoundsWon {
		decisive := true
		for j := range r.RoundsWon {
			if i == j {
				continue
			}
			if r.RoundsWon[i] <= r.RoundsWon[j]+remaining {
				decisive = false
				break
			}
		}
		if decisive {
			return i
		}
	}
	return -1
}

// biggestLoser returns the player index with the lowest cumulative score, i.e.
// the seat that opens the next round. Ties are broken by lowest player index
// (deterministic).
//
// **It stays indexed on points, and that is deliberate now that points no longer
// decide the match.** Rounds won is exactly the wrong signal here: only one seat
// per round wins one, so past two players half the table sits on zero and the
// "biggest loser" would be whichever of them happens to hold the lowest index,
// every round, all match. The score is the fine-grained measure of how far behind
// somebody is — which is the whole reason it survived the rule change — and that
// is what this question is asking for.
func (r *Room) biggestLoser() int {
	loser := -1
	for i := range r.Scores {
		// A seat that walked out cannot open a round. It is skipped here rather
		// than corrected afterwards so the answer is a seat that can actually
		// play, whatever the caller does with it.
		if i < len(r.Retired) && r.Retired[i] {
			continue
		}
		if loser < 0 || r.Scores[i] < r.Scores[loser] {
			loser = i
		}
	}
	if loser < 0 {
		return 0
	}
	return loser
}

// determineMatchWinner finds the match winner using tiebreaker rules:
// (1) most rounds won, (2) highest total score, (3) lowest lost-hand total,
// then sudden death (returns "").
//
// **Rounds won decides the match, and the score is what measures the gap.** It
// used to be the other way round, which meant a player could take three rounds
// of a best-of-5 and lose the match to somebody who took one expensive one — a
// result nothing on screen explained, because "best of 5" does not read as "most
// points after 5". The score is still computed, still kept and still shown: it
// is the finer measure of how far apart two seats are, it is what breaks a tie
// here, it is what picks the seat that opens the next round (see biggestLoser),
// and it is what a rating would be built on.
//
// A decisive leader (see decisiveLeader) is by construction strictly ahead of
// every other seat on rounds won, so the first filter below resolves them and
// this can be asked at any point in a match, not only at the end of the format.
func (r *Room) determineMatchWinner() string {
	n := len(r.Players)
	candidates := make([]int, n)
	for i := range candidates {
		candidates[i] = i
	}

	candidates = filterBest(candidates, func(i int) int { return r.RoundsWon[i] })
	if len(candidates) == 1 {
		return r.Players[candidates[0]].Nickname
	}
	candidates = filterBest(candidates, func(i int) int { return r.Scores[i] })
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

// ErrNoCatchWindow is a Contre-LOCO! on a seat that has not been catchable at
// all: no window open, none shut inside catchGrace. It is deliberately NOT a
// missed catch, so it costs nothing and tells nobody: a correct client only
// arms the button on a seat the server named in catch_seats, so this is a
// message that client did not make.
var ErrNoCatchWindow = errors.New("target did not just play their last card")

// ErrCatchLocked is a Contre-LOCO! sent by a seat still inside the lockout its
// own last fruitless call armed (catchLockout). Like ErrNoCatchWindow it is
// deliberately NOT a missed catch — the press cost a card once already, and
// billing every press of a held button is the farm this exists to close — and
// like it, it is not suspicious either: the client's lock ends on a clock, and
// a press made a few milliseconds before the server agrees is one honest
// button beating one honest button by a round trip. What it is, and what
// ErrNoCatchWindow is not, is a press worth answering: the caller is told when
// their lock ends so their own countdown restarts (hub.lockCatch).
var ErrCatchLocked = errors.New("catch is locked after a failed call")

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
		errors.Is(err, ErrAlreadyDeclared) ||
		// A press that beat its own lockout by a round trip. Both clocks are
		// honest and the client's is the one that has to guess at the wire.
		errors.Is(err, ErrCatchLocked) ||
		// Tapping the last card before calling LOCO! is a player forgetting, and
		// forgetting is what the rule is about. Counting it would make the
		// cheat metric a measure of how often the table played badly.
		errors.Is(err, ErrMustDeclareLoco)
}

// CatchUndeclared allows catcherIndex to penalize targetIndex for not declaring their last card.
func (r *Room) CatchUndeclared(catcherIndex, targetIndex int, now time.Time) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if targetIndex < 0 || targetIndex >= len(r.State.Hands) {
		return fmt.Errorf("invalid target %d", targetIndex)
	}
	if catcherIndex < 0 || catcherIndex >= len(r.State.Hands) {
		return fmt.Errorf("invalid catcher %d", catcherIndex)
	}
	if catcherIndex == targetIndex {
		return errors.New("cannot catch yourself")
	}
	// Above every refusal that costs a card, and above the catch itself: a seat
	// inside its own lockout is out of the mechanic entirely, so this press
	// neither wins nor pays (catchLockout). It is the belt on the hub's own
	// check — the rule belongs to the domain, and the bot path calls straight
	// in here.
	if r.CatchLocked(catcherIndex, now) {
		return ErrCatchLocked
	}
	// Before the three timing refusals below, and above them for a reason: each
	// of those costs the caller a card and announces the miss to the table, which
	// is right for a race and wrong for a call on a seat that was never on the
	// hook. See catchGrace.
	if !r.State.catchRaceRecent(targetIndex, now) {
		return ErrNoCatchWindow
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
	// Nothing below this line waits for anything. A Contre-LOCO! that beats the
	// target's LOCO! to the hub lands on the instant it arrives, however early
	// in the window that is: the mechanic measures a reaction, and a server that
	// held the fastest press back until the seat it caught had been given its
	// chance was answering the reflex it asked for with a delay. What stops the
	// button being mashed is the ration below (PenalizeFailedCatch), not a
	// stretch of window nobody may win in.
	//
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

// PenalizeFailedCatch charges catcherIndex one card for a Contre-LOCO! that
// found nothing: a race lost to a faster LOCO! (IsMissedCatch), or a press made
// against a table where no seat owed the call at all. Both are the same wager
// misread, so both cost the same card. It returns the cards actually drawn so
// the hub can send them to their owner, and whether the seat was charged at all.
//
// **It charges at most once per offer, and only while one is on the table.**
// The offer is the near-finish picture the button is live for (catchOfferKey):
// a seat on two cards, or a seat on its last card inside its window. A player
// who presses twice against the same picture is repeating one misread rather
// than making a second one — and a game that answered the second press with
// another card would be taxing the reflex it spends the whole match asking
// for. A press against a table where nothing is offered (CatchOffered) is not
// a wager at all: the board moved under the thumb, or the client is not ours,
// and neither is worth a card. `charged == false` means exactly that: the
// press cost nothing, changed nothing, and is nobody else's business.
//
// It deliberately touches nothing else: not the turn, not HasDrawn, not the
// target. A failed call is a side bet on somebody else's obligation, and the
// player who made it may not even be in turn.
//
// Like every other draw in this game it cannot fail — once every card sits in a
// hand the caller simply gets away with it, rather than the round freezing on an
// error nobody can act on.
func (r *Room) PenalizeFailedCatch(catcherIndex int, now time.Time) ([]Card, bool) {
	if !r.CatchOffered(catcherIndex, now) {
		return nil, false
	}
	// A seat inside its lockout pays nothing: the press it is being charged for
	// was already paid for, and a lock that also billed would be the per-press
	// price this mechanic spent two rewrites getting rid of. The belt on the
	// hub's own check — and the reason the caller arms the lock *after* this
	// runs and never before it (LockCatch).
	if r.CatchLocked(catcherIndex, now) {
		return nil, false
	}
	key := r.State.catchOfferKey(catcherIndex, now)
	if r.State.CatchPaidFor[catcherIndex] == key {
		return nil, false
	}
	r.State.CatchPaidFor[catcherIndex] = key
	r.ensureDeck(failedCatchPenalty)
	drawn := r.State.Deck.DrawUpTo(failedCatchPenalty)
	if len(drawn) == 0 {
		// Both piles dry: the call was charged — the epoch is spent either way —
		// and the table simply had no card left to charge it with.
		return nil, true
	}
	r.State.Hands[catcherIndex].Add(drawn...)
	r.State.logEvent(EventCatchFailed, catcherIndex, nil, 0)
	return drawn, true
}

// ErrInterruptBatch is a multi-card interject. An interject is one card: see
// InterruptPlayCards for why the rule is here and not in the client's tap.
var ErrInterruptBatch = errors.New("an interject is one card")

// InterruptPlay is the single-card form of InterruptPlayCards, which is the only
// form there is. It survives as the name every caller that already holds one
// card reads better with.
func (r *Room) InterruptPlay(playerIndex int, card Card, chosenColor Color, chosenPlayer int) error {
	return r.InterruptPlayCards(playerIndex, []Card{card}, chosenColor, chosenPlayer)
}

// InterruptPlayCards allows ANY player to "take the lead" by playing ONE card
// (same color+kind+value) matching the top of the discard pile. There is no
// reaction deadline and no restriction on who may slam: the player who just
// played may take the lead back, and so may the player whose turn it currently
// is. Whoever's message reaches the hub first wins.
//
// One card, and the wire shape is still a list because the rule has to be
// refused rather than assumed: `play_cards` reaches this function from the
// network. An interject is a reaction, and a press that puts three cards down is
// three reactions charged to one — a seat holding three +4 emptied the whole
// chain onto the table on a single tap and never had to make the read again.
// Sending the copies one press at a time is what keeps each of them a reaction
// somebody at the table could still beat. Batch play survives where it is a
// choice rather than a reflex: PlayCards, on your own turn.
//
// The opening discard counts as a card on the pile, so the window is open from
// the deal: a seat dealt the twin of the card the round opens on may slam it
// before anybody has taken a turn. Refusing that read as "somebody was faster"
// on a table where nothing had happened yet.
//
// Server-authoritative checks (in order):
//   - game in progress
//   - exactly one card
//   - interrupt window still open (InterruptOpen — closed by draw / pass / round end)
//   - caller holds the card
//   - it matches top exactly (color+kind+value)
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
// On success, the card is appended to discard, the interrupter becomes the
// current turn, the card's effect is applied, and the interrupt window is
// re-armed for the new top card.
//
// There is no call for this play to carry. One card can only empty a hand that
// was already down to one, and that seat owed the table its LOCO! before this
// message — requireLocoToFinish says so, and it is the same gate as everywhere
// else.
//
// On any rejection, no state is mutated.
func (r *Room) InterruptPlayCards(playerIndex int, cards []Card, chosenColor Color, chosenPlayer int) error {
	if r.Status != StatusPlaying {
		return errors.New("game not in progress")
	}
	if len(cards) == 0 {
		return errors.New("no cards specified")
	}
	if len(cards) > 1 {
		return ErrInterruptBatch
	}
	first := cards[0]
	// The window is open from the moment a card lands on the pile — the opening
	// discard included — until a draw / pass / round end resolves it. No
	// deadline, no exclusion of the last actor or of the current player: any
	// identical card may be slammed at any moment.
	if !r.State.InterruptOpen {
		return ErrInterruptWindowClosed
	}
	// Rule: during an active draw chain, only an identical draw card may be
	// interjected — it extends the chain from the interjecter's seat. In a
	// consistent state the identical-to-top check below already guarantees this;
	// the explicit guard keeps an inconsistent state from swallowing the penalty.
	if r.State.PendingDraw > 0 && first.Kind != DrawTwo && first.Kind != WildDrawFour {
		return ErrInterruptNotADrawCard
	}
	// A wild carries no colour of its own; the interjecter must name the one
	// that becomes active, exactly as on a normal wild play.
	if first.IsWild() && chosenColor == Wild {
		return errors.New("must choose a color for a wild card")
	}
	if !r.State.Hands[playerIndex].Contains(first) {
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
		if r.State.isRetired(chosenPlayer) {
			return errors.New("that seat has left the match")
		}
	}

	// A card off a single-card hand takes the round, and that seat has been
	// catchable since before this message: the call is one it already had the
	// window and the button to make.
	if err := r.State.requireLocoToFinish(playerIndex, 1, false); err != nil {
		return err
	}

	chosenColor = resolveChosenColor(first, chosenColor)

	if err := r.State.Hands[playerIndex].Remove(first); err != nil {
		return err
	}
	r.State.pushDiscard(first)
	r.State.logEvent(EventCardPlayed, playerIndex, &first, chosenColor)

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
		// Through rotateSeats, not the modular step it looks like: a retired seat
		// is not in the circle, and handing it a hand would take the next
		// player's away into a seat nobody can play from.
		src := r.State.rotateSeats(r.State.Direction)
		for i := range newHands {
			newHands[i] = r.State.Hands[src[i]]
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
	// A counter is a single card like any other, so a counter that takes the
	// round is a seat that has been on one card since before this message. It
	// owed the call and the fourth win path is not an exemption from it.
	if err := r.State.requireLocoToFinish(playerIndex, 1, false); err != nil {
		return err
	}

	if err := r.State.Hands[playerIndex].Remove(card); err != nil {
		return err
	}

	chosenColor = resolveChosenColor(card, chosenColor)

	r.State.pushDiscard(card)
	c := card
	r.State.logEvent(EventCounterDraw, playerIndex, &c, chosenColor)

	r.State.updateLastCardState(playerIndex)

	// The same win as every other: through finishRoundWin, not through a copy of
	// its three lines. The copy left out closeInterruptWindow, and the only thing
	// keeping that from arming a window over a finished round was the order the
	// hub happens to run its checks in — an argument about a caller, standing in
	// for a rule about the state.
	if r.State.Hands[playerIndex].Size() == 0 {
		r.finishRoundWin(playerIndex, chosenColor)
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
	// The room's source, not the global one: a room decoded from a snapshot has
	// none until this asks for it. See newRNG.
	r.ensureRNG()
	r.State.Deck.Replenish(pile, r.rng)
	r.State.Discard = []Card{top}
}
