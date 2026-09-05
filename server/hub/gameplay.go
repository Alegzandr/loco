// The gameplay messages, each one the same shape: parse, ask the domain, and
// broadcast what the domain decided.
package hub

import (
	"errors"
	"fmt"
	"log"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// parseCardsFromMsg extracts the card(s) the player wants to play from a
// ClientMsg. The batch field (PlayCards) takes precedence over the singular
// Card. Returns (cards, chosenColor, ok); ok=false means an error has already
// been sent to the client and the caller should return.
func (h *Hub) parseCardsFromMsg(c *Client, t *table, msg protocol.ClientMsg) ([]game.Card, game.Color, bool) {
	if len(msg.PlayCards) > 0 {
		// A batch longer than the hand cannot be legal and is refused before a
		// single card of it is decoded: a 4 KB message carries a hundred DTOs,
		// and the domain would otherwise walk every one of them, at the rate
		// limit, to reach the refusal it was always going to give.
		if hand := t.handSize(c.playerID()); len(msg.PlayCards) > hand {
			err := fmt.Errorf("batch of %d cards exceeds the hand", len(msg.PlayCards))
			c.sendError(err.Error())
			c.noteRejection(err)
			return nil, 0, false
		}
		cards := make([]game.Card, len(msg.PlayCards))
		var chosenColor game.Color
		for i, dto := range msg.PlayCards {
			card, cc, err := dtoToCard(&dto, msg.ChosenColor)
			if err != nil {
				c.sendError(err.Error())
				return nil, 0, false
			}
			cards[i] = card
			chosenColor = cc
		}
		return cards, chosenColor, true
	}
	if msg.Card == nil {
		c.sendError("card required")
		return nil, 0, false
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return nil, 0, false
	}
	return []game.Card{card}, chosenColor, true
}

func (h *Hub) handlePlayCard(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	chosenPlayer := -1
	if msg.ChosenPlayer != nil {
		chosenPlayer = *msg.ChosenPlayer
	}
	cards, chosenColor, ok := h.parseCardsFromMsg(c, t, msg)
	if !ok {
		return
	}

	var err error
	if len(cards) > 1 {
		err = room.PlayCards(c.playerID(), cards, chosenColor, chosenPlayer, msg.DeclareLoco)
	} else {
		err = room.PlayCard(c.playerID(), cards[0], chosenColor, chosenPlayer)
	}
	if err != nil {
		h.refuseAction(c, t, err)
		return
	}

	h.announceFinishingLoco(t, c.playerID(), cards)

	// Batch plays don't carry a meaningful chosenPlayer (Swap/GlobalSwitch are
	// excluded from batch); send -1 so card_played's swap target is omitted.
	cpForBroadcast := chosenPlayer
	if len(cards) > 1 {
		cpForBroadcast = -1
	}
	h.broadcastCardPlayed(t, c.playerID(), cpForBroadcast)
	if len(cards) == 1 && (cards[0].Kind == game.Swap || cards[0].Kind == game.GlobalSwitch) {
		h.broadcastPersonalizedGameState(t)
	}
	h.maybeScheduleBotReactions(t)
	h.maybeScheduleBotInterrupt(t)
	h.handleRoundOrMatchEnd(t)
}

// announceFinishingLoco puts the LOCO! a hand-emptying batch carried onto the
// wire, ahead of the cards that carried it, so the table hears the call before
// it sees the round end. Without it the one finish nobody could see coming would
// also be the one that goes out in silence, and the loudest moment in the game
// would be missing from exactly the clip it was designed for.
//
// The condition is read off the domain, never off the message: the batch emptied
// the hand, so the domain has already refused it if the call was absent. There
// is nothing to announce on any other play — a single card that takes the round
// was announced when the seat went down to one.
func (h *Hub) announceFinishingLoco(t *table, playerID int, cards []game.Card) {
	room := t.room
	if len(cards) < 2 || room.State == nil {
		return
	}
	if room.State.Hands[playerID].Size() != 0 {
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: intPtr(playerID),
	})
}

func (h *Hub) handleRoundOrMatchEnd(t *table) {
	code, room := t.code, t.room
	if !room.RoundEnded {
		h.maybeScheduleBot(t)
		return
	}

	room.RoundEnded = false
	scoreboard := h.buildScoreboard(room)

	// Broadcast round_end with scoreboard.
	// At this point room.State still reflects the round-winning play (BeginNextRound
	// has not yet been called), so RoundNumber is the just-completed round.
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgRoundEnd,
		RoundNumber:  room.RoundNumber,
		RoundWinner:  room.Winner,
		Scoreboard:   scoreboard,
		RoundHistory: room.RoundHistory,
	})

	if room.MatchOver {
		h.metrics.matchesFinished.Add(1)
		log.Printf("match finished code=%s winner=%s round=%d of=%s",
			code, room.MatchWinner, room.RoundNumber, matchFormatString(room.Format))
		// Recorded before it is announced: the message carries the recap, and the
		// match that has just ended is the last column of it.
		t.recordFinishedMatch(time.Now())
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:         protocol.SMsgMatchEnd,
			MatchWinner:  room.MatchWinner,
			Scoreboard:   scoreboard,
			MatchHistory: matchHistoryDTO(t),
		})
		return
	}

	// Deal the next round NOW that round_end has been broadcast.
	if err := room.BeginNextRound(); err != nil {
		log.Printf("WARN BeginNextRound failed code=%s err=%v", code, err)
		return
	}

	// New round started: schedule turn timer then send each player their
	// personalized state. Build the player list once and share across recipients.
	h.scheduleTurnTimer(t)
	pl := h.playerList(t)
	shared := h.sharedGameState(t)
	for seat, member := range t.members {
		if member == nil {
			continue
		}
		member.Send(protocol.ServerMsg{
			Type:  protocol.SMsgGameStarted,
			State: h.playerGameStateWith(t, seat, pl, shared),
		})
	}
	h.maybeScheduleBot(t)
}

func (h *Hub) handleDrawCard(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	priorSize := len(room.State.Hands[c.playerID()].Cards)
	if err := room.DrawCard(c.playerID()); err != nil {
		h.refuseAction(c, t, err)
		return
	}
	state := room.State
	hand := state.Hands[c.playerID()]
	newCards := hand.Cards[priorSize:]
	drawnCount := len(newCards)

	// Drawing re-arms the turn clock. A forced draw does not cost the turn
	// (rules.md §14.5), but the timer was armed when the +2 landed, so every
	// second the victim spent deciding whether to counter came off the turn they
	// are owed *after* the draw — take the stack late and the seat is auto-passed
	// moments later, which is the exact double punishment the deviation forbids.
	// A voluntary draw follows the same rule for the same reason: the player
	// still has to decide play-or-pass with cards they have only just seen. There
	// is one draw per turn, so this can extend a turn once and never repeatedly.
	h.scheduleTurnTimer(t)
	dl := turnDeadlineMs(t)

	// Tell the drawing player all their new cards plus the updated turn state.
	c.Send(protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  intPtr(c.playerID()),
		Cards:        cardDTOs(newCards),
		Turn:         state.CurrentTurn,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
		TurnDeadline: dl,
	})
	// Tell others how many cards changed hands so they can update the hand-size
	// counter. They get the same turn state: has_drawn / pending_draw describe
	// the table, not the recipient, and a client left to infer them desyncs.
	h.broadcastToRoom(t, protocol.ServerMsg{
		Type:         protocol.SMsgCardDrawn,
		PlayerIndex:  intPtr(c.playerID()),
		DrawnCount:   drawnCount,
		Turn:         state.CurrentTurn,
		PendingDraw:  intPtr(state.PendingDraw),
		HasDrawn:     boolPtr(state.HasDrawn),
		TurnDeadline: dl,
	}, c)
	h.maybeScheduleBot(t)
}

func (h *Hub) handlePassTurn(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	if err := room.PassTurn(c.playerID()); err != nil {
		h.refuseAction(c, t, err)
		return
	}
	h.scheduleTurnTimer(t)
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:         protocol.SMsgTurnChanged,
		Turn:         room.State.CurrentTurn,
		TurnDeadline: turnDeadlineMs(t),
	})
	h.maybeScheduleBot(t)
}

func (h *Hub) handleDeclareUno(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	if err := room.DeclareLastCard(c.playerID()); err != nil {
		c.sendError(err.Error())
		// A second call on the same single card is a double tap or a message in
		// flight when the first one landed, not an attack — the client already
		// spends its own button. game.IsLostRace covers it (ErrAlreadyDeclared),
		// so this is the same rule every other handler now applies, rather than
		// a string comparison that a reworded error would silently break.
		c.noteRejection(err)
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: intPtr(c.playerID()),
	})
}

func (h *Hub) handleCatchUno(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	now := time.Now()
	// A Swap or a GlobalSwitch can leave several seats catchable at once, so the
	// catcher names the one they spotted. Older clients send nothing: fall back
	// to the window closest to expiring, which is the catch about to be lost.
	targetIdx := -1
	if msg.TargetIndex != nil {
		targetIdx = *msg.TargetIndex
		// A named seat below zero is the out-of-range case with the sign
		// flipped, not "nobody": refused and counted like the one below, rather
		// than charged as a wager no client of ours composes.
		if targetIdx < 0 {
			c.sendError(game.ErrNoCatchWindow.Error())
			c.noteRejection(game.ErrNoCatchWindow)
			return
		}
	} else if open := room.State.CatchableTargets(now); len(open) > 0 {
		targetIdx = open[0]
	}
	// A seat number the table does not have is not a wager, it is a message no
	// client of ours composes. Refused rather than charged, and counted — a
	// forged target used to be the one gameplay message that cost its sender
	// nothing and told the operator nothing either.
	if targetIdx >= len(room.State.Hands) {
		c.sendError(game.ErrNoCatchWindow.Error())
		c.noteRejection(game.ErrNoCatchWindow)
		return
	}
	catcher := c.playerID()
	// Nothing near the finish: no honest screen has the button live, so this
	// press is a board that moved under a thumb — the seat it was aimed at drew
	// a moment ago — or a client this game did not write. Neither is a wager,
	// so neither is charged, and neither is answered: an answer would be the
	// one thing a dead button could still make the server say.
	if !room.CatchOffered(catcher, now) {
		return
	}
	// Nobody is on the hook and the client said so by naming no seat. That is not
	// a bug: the button is live from the moment any seat is one play from
	// finishing, so pressing it into an empty window is the wager the mechanic
	// is made of, and it costs the same card as losing the race. The domain
	// refuses to charge it twice on the same offer.
	if targetIdx < 0 {
		h.penalizeFailedCatch(t, catcher, now)
		return
	}
	h.resolveCatch(t, c, catcher, targetIdx, now)
}

// resolveCatch is the one road a Contre-LOCO! travels to its verdict, whether
// it arrived on a socket this instant or was held through the head start
// (holdCatch). c is the socket to answer a refusal to, and nil for a held
// press, which has nobody waiting on it.
func (h *Hub) resolveCatch(t *table, c *Client, catcher, targetIdx int, now time.Time) {
	room := t.room
	priorSize := len(room.State.Hands[targetIdx].Cards)
	if err := room.CatchUndeclared(catcher, targetIdx, now); err != nil {
		switch {
		// Inside the target's head start, and it would have landed: held, and
		// resolved again the instant the head start ends. The seat that owes
		// the call always gets the first stretch of its own window; a thumb
		// that was faster than that is not refused, just made to wait its turn.
		case errors.Is(err, game.ErrCatchTooEarly):
			h.holdCatch(t, catcher, targetIdx)
		// A lost race is the mechanic working, not an attack: the button was
		// armed when it was pressed and the target's LOCO! (or a hand that grew,
		// or the last millisecond of the window) simply reached the hub first.
		// It costs the caller a card and nothing else — no error toast, no
		// suspicion, since the client shows the penalty itself.
		// ErrNoCatchWindow joins them: the seat exists but owed nothing, which is
		// the same misread as pressing with no seat named at all.
		case game.IsMissedCatch(err) || errors.Is(err, game.ErrNoCatchWindow):
			h.penalizeFailedCatch(t, catcher, now)
		case c != nil:
			c.sendError(err.Error())
			c.noteRejection(err)
		}
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: intPtr(targetIdx),
	})
	// The penalty cards are a hand change like any other: the caught player must
	// be sent the cards themselves, everyone else the new count.
	h.sendHandGrowth(t, targetIdx, room.State.Hands[targetIdx].Cards[priorSize:])
}

// heldCatch is one Contre-LOCO! waiting out the head start of the window it
// was aimed at. The window is part of the key, so a press held on a window
// that is reopened underneath it is dropped rather than landed on the next.
type heldCatch struct {
	catcher, target int
	windowAt        time.Time
}

// holdCatch keeps an early Contre-LOCO! until the target's head start ends,
// then runs it through resolveCatch exactly as if it had arrived then. One
// press per catcher per window: the second and the tenth inside the same head
// start are the same press, and holding the button down buys nothing that
// pressing it once did not. Several catchers are resolved in arrival order,
// which is the order the table's box keeps — the first lands, the rest lose
// the race and pay for it, as they would have a second later.
func (h *Hub) holdCatch(t *table, catcher, target int) {
	state := t.room.State
	k := heldCatch{catcher: catcher, target: target, windowAt: state.LastCardAt[target]}
	if _, dup := t.heldCatches[k]; dup {
		return
	}
	t.heldCatches[k] = struct{}{}
	wait := time.Until(state.CatchHeadStartEnd(target))
	if wait < 0 {
		wait = 0
	}
	// Lossy on a full box like every other reaction timer: the press is the
	// one thing here a player can simply make again.
	time.AfterFunc(wait, func() {
		t.postFromTimer("held_catch", func() { h.resolveHeldCatch(t, k) })
	})
}

// resolveHeldCatch is the head start ending on one held press.
func (h *Hub) resolveHeldCatch(t *table, k heldCatch) {
	delete(t.heldCatches, k)
	room := t.room
	if room.Status != game.StatusPlaying || room.State == nil {
		return
	}
	state := room.State
	if k.target >= len(state.Hands) || k.catcher >= len(state.Hands) {
		return
	}
	// Reopened underneath the press: the seat is on a different last card
	// now, with a head start of its own. The press was about the old one.
	if !state.LastCardAt[k.target].Equal(k.windowAt) {
		return
	}
	h.resolveCatch(t, nil, k.catcher, k.target, time.Now())
}

// penalizeFailedCatch charges one card for a Contre-LOCO! that found nothing and
// tells the room whose call it was. Shared by the human and the bot path — a bot
// that guesses wrong pays the same price, or the two are playing different games.
func (h *Hub) penalizeFailedCatch(t *table, catcherIdx int, now time.Time) {
	room := t.room
	drawn, charged := room.PenalizeFailedCatch(catcherIdx, now)
	// The seat already paid for this offer — or nothing was offered — and the
	// domain declined to charge it. Nothing happened, so nothing is said: an
	// answer here would be a second notice for one mistake, and a spammed
	// button would still be a way to make the table talk.
	if !charged {
		return
	}
	msg := protocol.ServerMsg{
		Type:        protocol.SMsgCatchFailed,
		PlayerIndex: intPtr(catcherIdx),
	}
	// A penalty that drew nothing — both piles dry — is not the table's business,
	// and announcing it anyway was the last corner where a Contre-LOCO! was free.
	// catchGrace made a call outside the window cost its sender a refusal and
	// nobody else a message; a call *inside* somebody's window against an
	// exhausted deck still cost nothing and still went out to everyone, so a
	// client at the rate limit could turn its ten messages a second into ten
	// table-wide broadcasts for the whole seven seconds the window is open.
	// The caller is still told — their button did something — but a penalty
	// nobody paid is not a thing the rest of the table has to render.
	if len(drawn) == 0 {
		if c := t.client(catcherIdx); c != nil {
			c.Send(msg)
		}
		return
	}
	h.broadcastToRoomAll(t, msg)
	h.sendHandGrowth(t, catcherIdx, drawn)
}

func (h *Hub) handleCounterDraw(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	if msg.Card == nil {
		c.sendError("card required")
		return
	}
	card, chosenColor, err := dtoToCard(msg.Card, msg.ChosenColor)
	if err != nil {
		c.sendError(err.Error())
		return
	}
	if err := room.CounterDraw(c.playerID(), card, chosenColor); err != nil {
		h.refuseAction(c, t, err)
		return
	}
	h.broadcastCardPlayed(t, c.playerID(), -1)
	h.maybeScheduleBotReactions(t)
	h.maybeScheduleBotInterrupt(t)
	h.handleRoundOrMatchEnd(t)
}

func (h *Hub) handleInterruptPlay(t *table, c *Client, msg protocol.ClientMsg) {
	room := t.room
	chosenPlayer := -1
	if msg.ChosenPlayer != nil {
		chosenPlayer = *msg.ChosenPlayer
	}
	cards, chosenColor, ok := h.parseCardsFromMsg(c, t, msg)
	if !ok {
		return
	}

	if err := room.InterruptPlayCards(c.playerID(), cards, chosenColor, chosenPlayer, msg.DeclareLoco); err != nil {
		h.refuseAction(c, t, err)
		return
	}

	h.announceFinishingLoco(t, c.playerID(), cards)
	h.broadcastInterrupt(t, c.playerID(), cards, chosenPlayer)
	h.maybeScheduleBotReactions(t)
	h.maybeScheduleBotInterrupt(t)
	h.handleRoundOrMatchEnd(t)
}

// broadcastInterrupt announces a successful interject. Shared by the human and
// the bot path so both produce the same sequence on the wire — a bot that took
// the lead has to look exactly like a player who did.
func (h *Hub) broadcastInterrupt(t *table, playerID int, cards []game.Card, chosenPlayer int) {
	// Emit a typed interrupt_success notification (in addition to the standard
	// card_played broadcast) so clients can render distinct lead-taking visuals.
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgInterruptSuccess,
		PlayerIndex: intPtr(playerID),
		Cards:       cardDTOs(cards),
	})
	h.broadcastCardPlayed(t, playerID, chosenPlayer)
	// Same rule as handlePlayCard: Swap and GlobalSwitch rearrange hands, so every
	// client needs a fresh personalised snapshot. A GlobalSwitch interject is
	// ordinary play (the deck ships four of them); the Swap case is only reachable
	// if the deck ever ships two copies of a coloured Swap (today it ships one),
	// but the domain permits it and a silent hand desync — the client keeps a hand
	// it can no longer play and every tap comes back "card not in hand" — is
	// exactly the bug this guards against.
	if len(cards) == 1 && (cards[0].Kind == game.Swap || cards[0].Kind == game.GlobalSwitch) {
		h.broadcastPersonalizedGameState(t)
	}
}
