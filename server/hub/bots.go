// Bots. game/bot.go decides, this file schedules: every delay here is a
// reaction window somebody is meant to be able to win.
package hub

import (
	"fmt"
	"log"
	mrand "math/rand"
	"os"
	"strconv"
	"time"

	"loco/server/game"
	"loco/server/protocol"
)

// BotThinkDelay is the simulated thinking time before a bot acts.
// Exported so tests can reduce it to speed up bot-game tests.
var BotThinkDelay = 1200 * time.Millisecond

// BotJitterMax is the maximum random jitter added to bot think delays.
// Exported so tests can set it to 0 to make bot timing deterministic.
var BotJitterMax = 1000 * time.Millisecond

// ApplyBotTimingEnv shortens the bot think delay from the environment
// (LOCO_BOT_THINK_MS / LOCO_BOT_JITTER_MS), for CI only.
//
// The think delay is the one bot timing that is pure dead time: nothing races
// it, so a shorter one changes how long a test takes and not what it proves.
// Every *other* bot delay is a reaction window somebody is meant to be able to
// win — BotCatchDelay against a human's Contre-LOCO!, BotUnoDelay against the
// catch it invites, BotInterruptDelay against an open interrupt window — and
// shortening those would quietly rewrite the verdict of the tests that cover
// them. They are deliberately not tunable here.
//
// Gated on LOCO_E2E for the same reason debug_set_state is: a production server
// must not grow instant bots because a stray variable was set on the host.
// Called once from main, before the hub starts.
func ApplyBotTimingEnv() {
	think, jitter, ok := botTimingOverride(os.Getenv, BotThinkDelay, BotJitterMax)
	if !ok {
		return
	}
	BotThinkDelay, BotJitterMax = think, jitter
	log.Printf("WARN bot think delay overridden think_ms=%d jitter_ms=%d (LOCO_E2E=1; test builds only)",
		think.Milliseconds(), jitter.Milliseconds())
}

// botTimingOverride resolves the think-delay override. Pure, so the precedence
// rules are testable without touching package state or the real environment.
// An absent or malformed value leaves that field on its shipped default rather
// than falling back to zero: a typo must not silently produce an instant bot.
func botTimingOverride(getenv func(string) string, defThink, defJitter time.Duration) (think, jitter time.Duration, ok bool) {
	think, jitter = defThink, defJitter
	if getenv("LOCO_E2E") != "1" {
		return think, jitter, false
	}
	if d, valid := millisEnv(getenv, "LOCO_BOT_THINK_MS"); valid {
		think, ok = d, true
	}
	if d, valid := millisEnv(getenv, "LOCO_BOT_JITTER_MS"); valid {
		jitter, ok = d, true
	}
	return think, jitter, ok
}

// millisEnv reads a non-negative millisecond count. Zero is a value (an instant
// bot is a legitimate thing to ask a test harness for); negative is not.
func millisEnv(getenv func(string) string, name string) (time.Duration, bool) {
	raw := getenv(name)
	if raw == "" {
		return 0, false
	}
	ms, err := strconv.Atoi(raw)
	if err != nil || ms < 0 {
		log.Printf("WARN ignoring %s=%q (want a non-negative integer of milliseconds)", name, raw)
		return 0, false
	}
	return time.Duration(ms) * time.Millisecond, true
}

// BotUnoDelay is the base delay before a bot declares its UNO after playing to
// 1 card. It is the window in which a human can beat it to the Contre-LOCO!
// button, so it is measured against a person spotting the one-card seat, moving
// to the button and clicking — not against how fast a machine could react.
// Together with the jitter it spans 1.6–2.8 s of the 5 s catch window: enough to
// be winnable, short enough that a bot still usually declares in time.
// Exported so tests can set it to 0.
var BotUnoDelay = 1600 * time.Millisecond

// BotUnoJitterMax is the max random jitter added to BotUnoDelay, so the moment
// to strike is never the same twice.
// Exported so tests can set it to 0.
var BotUnoJitterMax = 1200 * time.Millisecond

// BotCatchDelay is the base delay before a bot attempts to catch an undeclared UNO.
// Must be well under catchWindow (5s). 2s base gives bots time to "notice" without
// being instant. Exported so tests can set it to 0.
var BotCatchDelay = 2000 * time.Millisecond

// BotCatchJitterMax is the max random jitter added to BotCatchDelay, giving a
// total reaction window of BotCatchDelay to BotCatchDelay+BotCatchJitterMax (2–3.5s).
// Exported so tests can set it to 0.
var BotCatchJitterMax = 1500 * time.Millisecond

// BotCatchProb is the probability (0–1) that an eligible bot will catch an undeclared UNO.
// 0.65 means bots catch ~65% of the time, making them fallible like human opponents.
// Exported so tests can set it to a deterministic value.
var BotCatchProb float32 = 0.65

// BotInterruptDelay and BotInterruptJitterMax bound how long a bot takes to
// slam an identical card into an open window (0.7–1.5s).
//
// This is the one bot reaction with no deadline to respect — an interrupt
// window stays open until somebody draws, passes or the round ends — so the
// number is set by fairness, not by a timeout: a human has to see the card
// land, recognise the match and click. Instant would make every contested
// window the bot's, which is worse than the bots never interrupting at all.
// Exported so tests can set them to 0.
var (
	BotInterruptDelay     = 700 * time.Millisecond
	BotInterruptJitterMax = 800 * time.Millisecond
)

// BotInterruptProb is the probability that a bot holding an identical card
// actually uses it. Deliberately below BotCatchProb: an interject takes the
// lead outright, so a bot that always took the one it could see would answer
// every play a human made.
// Exported so tests can set it to a deterministic value.
var BotInterruptProb float32 = 0.40

// handleAddBot adds a bot player to the lobby (host-only).
// nextBotName returns the lowest free "BotN" name (1-based). Scanning for a free
// name rather than counting seats keeps the first bot named Bot1 and avoids
// colliding with a bot that survived a rematch or a human using that nickname.
func nextBotName(room *game.Room) string {
	taken := make(map[string]struct{}, len(room.Players))
	for _, p := range room.Players {
		taken[p.Nickname] = struct{}{}
	}
	for n := 1; ; n++ {
		name := fmt.Sprintf("Bot%d", n)
		if _, clash := taken[name]; !clash {
			return name
		}
	}
}

func (h *Hub) handleAddBot(c *Client, msg protocol.ClientMsg) {
	t, ok := h.requireTable(c)
	if !ok {
		return
	}
	room := t.room
	if refuseInMatchmade(c, t) {
		return
	}
	if c.playerID != 0 {
		c.sendError("only the room owner can add bots")
		return
	}
	if room.Status != game.StatusLobby {
		c.sendError("can only add bots in the lobby")
		return
	}
	nickname := nextBotName(room)
	if err := room.Join(nickname); err != nil {
		c.sendError(err.Error())
		return
	}
	botID := len(room.Players) - 1
	t.bots[botID] = struct{}{}
	h.metrics.botsActive.Add(1)
	// A bot's seat carries no socket, so its members entry stays nil.
	t.members = append(t.members, nil)

	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:     protocol.SMsgPlayerJoined,
		Nickname: nickname,
		Players:  h.playerList(t),
	})
}

// scheduleBotMove fires a bot turn after a short think delay.
// Uses time.AfterFunc to avoid spawning long-lived goroutines.
// If the botMove channel is full, retries once after 1s; dropping permanently
// would stall the game (no player would act on that turn).
func (h *Hub) scheduleBotMove(code string, playerID int) {
	bm := botMoveMsg{roomCode: code, playerID: playerID}
	// Add random jitter so bots don't all act at the same instant and feel more
	// like human reaction times. BotJitterMax can be set to 0 in tests.
	var jitter time.Duration
	if jm := int(BotJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	time.AfterFunc(BotThinkDelay+jitter, func() {
		select {
		case h.botMove <- bm:
		default:
			h.metrics.channelRetries.Add(1)
			log.Printf("botMove channel full, retrying in 1s code=%s player=%d", code, playerID)
			time.AfterFunc(1*time.Second, func() {
				select {
				case h.botMove <- bm:
				default:
					log.Printf("WARN botMove retry dropped, game may stall code=%s player=%d", code, playerID)
				}
			})
		}
	})
}

// maybeScheduleBot checks whether the current turn belongs to a bot and schedules its move.
func (h *Hub) maybeScheduleBot(t *table) {
	code, room := t.code, t.room
	if room.Status != game.StatusPlaying {
		return
	}
	if turn := room.State.CurrentTurn; t.isBot(turn) {
		h.scheduleBotMove(code, turn)
	}
}

// scheduleBotUnoAnnounce defers a bot's UNO declaration for a bot that just
// played to 1 card. The declaration itself is deferred, not just its broadcast:
// declaring on the spot settled the seat server-side while every client was
// still showing the 5 s catch window it opened on the same card_played, so a
// bot's LOCO! could never be caught and every Contre-LOCO! tap came back
// "player already declared".
func (h *Hub) scheduleBotUnoAnnounce(code string, playerIndex int, lastCardTime time.Time) {
	var jitter time.Duration
	if jm := int(BotUnoJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	um := unoMsg{roomCode: code, playerIndex: playerIndex, lastCardTime: lastCardTime}
	time.AfterFunc(BotUnoDelay+jitter, func() {
		select {
		case h.unoAnnounce <- um:
		default:
			// Non-critical: drop if channel full; the bot simply never declares
			// and stays catchable until its window expires.
		}
	})
}

// handleUnoAnnounce declares and broadcasts a bot's UNO if the situation it was
// scheduled for still holds. Every guard here is a way the bot can lose the
// race: it was caught (hand no longer at 1), the round moved on, or this seat
// opened a different window in the meantime (a Swap handed it another single
// card, which is a declaration it has not made yet).
func (h *Hub) handleUnoAnnounce(um unoMsg) {
	t, ok := h.tables[um.roomCode]
	if !ok {
		return // room deleted between schedule and fire
	}
	room := t.room
	if room.Status != game.StatusPlaying || room.State == nil {
		return
	}
	if um.playerIndex < 0 || um.playerIndex >= len(room.State.Hands) {
		return // seat pruned between schedule and fire
	}
	if !room.State.LastCardAt[um.playerIndex].Equal(um.lastCardTime) {
		return // different one-card moment
	}
	if err := room.DeclareLastCard(um.playerIndex); err != nil {
		return // caught, or no longer on one card
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgUnoDeclared,
		PlayerIndex: intPtr(um.playerIndex),
	})
}

// maybeScheduleBotCatch checks whether the most recent card play left anybody at
// 1 card without declaring UNO, and if so, schedules a bot catch attempt per
// catchable seat, because a Swap or a GlobalSwitch puts several of them on the
// hook at once and a bot that only ever saw the first would let the rest walk.
// Must be called immediately after broadcastCardPlayed while room state is fresh.
func (h *Hub) maybeScheduleBotCatch(t *table) {
	code, room := t.code, t.room
	if room.Status != game.StatusPlaying {
		return
	}
	bots := t.bots
	if len(bots) == 0 {
		return
	}
	state := room.State
	for _, target := range state.CatchableTargets(time.Now()) {
		// Check at least one eligible bot exists (not the target).
		anyEligible := false
		for botID := range bots {
			if botID != target {
				anyEligible = true
				break
			}
		}
		if !anyEligible {
			continue
		}

		var jitter time.Duration
		if jm := int(BotCatchJitterMax.Milliseconds()); jm > 0 {
			jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
		}
		cm := botCatchMsg{roomCode: code, targetPlayer: target, lastCardTime: state.LastCardAt[target]}
		time.AfterFunc(BotCatchDelay+jitter, func() {
			select {
			case h.botCatch <- cm:
			default:
				// Non-critical: drop if channel full; catch window just closes naturally.
			}
		})
	}
}

// maybeScheduleBotInterrupt arms one interject attempt against the card that
// was just played. Called at the same points as maybeScheduleBotCatch, i.e.
// after a *human* action: bots deliberately do not answer each other, which is
// the existing rule for catches and also what keeps an all-bot table from
// slamming cards back and forth with nobody watching.
//
// One message per play, not one per bot: the handler picks among whoever can
// actually answer, so a table with four bots does not get four rolls of the die
// on the same card.
func (h *Hub) maybeScheduleBotInterrupt(t *table) {
	code, room := t.code, t.room
	if room.Status != game.StatusPlaying || room.RoundEnded || room.State == nil {
		return
	}
	if room.State.LastPlayBy < 0 {
		return // window already closed (round-winning play, draw, pass)
	}
	if len(t.bots) == 0 {
		return
	}
	var jitter time.Duration
	if jm := int(BotInterruptJitterMax.Milliseconds()); jm > 0 {
		jitter = time.Duration(mrand.Intn(jm)) * time.Millisecond
	}
	bim := botInterruptMsg{roomCode: code, lastPlayAt: room.State.LastPlayAt}
	time.AfterFunc(BotInterruptDelay+jitter, func() {
		select {
		case h.botInterrupt <- bim:
		default:
			// Non-critical: dropping it means the bot did not react in time,
			// which is a legal outcome of the mechanic rather than a fault.
		}
	})
}

// handleBotInterrupt fires when a scheduled interject is due. Every guard is a
// way the moment can have passed between the schedule and the fire, and each
// one simply means the bot lost the race.
func (h *Hub) handleBotInterrupt(bim botInterruptMsg) {
	t, ok := h.tables[bim.roomCode]
	if !ok {
		return
	}
	room := t.room
	if room.Status != game.StatusPlaying || room.State == nil || room.RoundEnded {
		return
	}
	state := room.State
	// Stale check: a different card is on the pile, so this answer is to a
	// board that no longer exists. Interjecting anyway would be answering the
	// wrong play with the right card.
	if !state.LastPlayAt.Equal(bim.lastPlayAt) {
		return
	}
	bots := t.bots
	if len(bots) == 0 {
		return
	}
	// Probabilistic, like every other bot reaction: they do not always spot it.
	if mrand.Float32() >= BotInterruptProb {
		return
	}

	// Whoever can actually answer, minus the seat that just played — taking the
	// lead back from itself is legal for a human but pointless for a bot, and
	// it would let two bots trade a pair of identical cards on one play.
	//
	// The seat holding the turn is deliberately NOT excluded. In a two-player
	// game the bot is always the next player, so excluding it would mean the
	// mechanic stays one-way in the single most common setup. It is also not
	// redundant with its ordinary turn: an interject slams *every* identical
	// copy at once, where BotThink plays one.
	type candidate struct {
		seat   int
		action *game.BotInterruptAction
	}
	candidates := make([]candidate, 0, len(bots))
	for botID := range bots {
		if botID == state.LastPlayBy {
			continue
		}
		if action := game.BotInterrupt(state, botID); action != nil {
			candidates = append(candidates, candidate{botID, action})
		}
	}
	if len(candidates) == 0 {
		return
	}
	picked := candidates[mrand.Intn(len(candidates))]
	botID, action := picked.seat, picked.action
	if err := room.InterruptPlayCards(botID, action.Cards, action.ChosenColor, action.ChosenPlayer); err != nil {
		// Lost the race to a human or to the state moving on. Nothing to do:
		// the bot simply did not get there, exactly like a mistimed click.
		log.Printf("bot interrupt refused code=%s player=%d err=%v", bim.roomCode, botID, err)
		return
	}
	h.broadcastInterrupt(t, botID, action.Cards, action.ChosenPlayer)
	h.maybeScheduleBotDeclarations(t)
	h.handleRoundOrMatchEnd(t)
}

// handleBotCatch fires when a bot's catch-UNO timer expires. It re-validates game state,
// rolls the probability die, selects a random eligible bot, and issues the catch.
func (h *Hub) handleBotCatch(cm botCatchMsg) {
	t, ok := h.tables[cm.roomCode]
	if !ok {
		return // room deleted
	}
	room := t.room
	if room.Status != game.StatusPlaying {
		return
	}
	state := room.State
	if cm.targetPlayer < 0 || cm.targetPlayer >= len(state.Hands) {
		return // seat pruned between schedule and fire
	}
	// Stale check: if this seat's window was reopened, it is a different one.
	if !state.LastCardAt[cm.targetPlayer].Equal(cm.lastCardTime) {
		return
	}
	if state.LastCardDeclared[cm.targetPlayer] {
		return // target declared in time — no catch
	}
	if state.Hands[cm.targetPlayer].Size() != 1 {
		return // target no longer at 1 card (e.g. drew penalty cards)
	}
	// Probabilistic: bots don't always notice.
	if mrand.Float32() >= BotCatchProb {
		return
	}
	// Pick a random eligible bot.
	bots := t.bots
	if len(bots) == 0 {
		return
	}
	eligible := make([]int, 0, len(bots))
	for botID := range bots {
		if botID != cm.targetPlayer {
			eligible = append(eligible, botID)
		}
	}
	if len(eligible) == 0 {
		return
	}
	catcherID := eligible[mrand.Intn(len(eligible))]
	priorSize := len(state.Hands[cm.targetPlayer].Cards)
	if err := room.CatchUndeclared(catcherID, cm.targetPlayer, time.Now()); err != nil {
		// Window may have expired or state changed — normal race condition, and
		// the bot pays for it exactly like a human who mistimed the button.
		if game.IsMissedCatch(err) {
			h.penalizeFailedCatch(t, catcherID)
		}
		return
	}
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgUnoCaught,
		PlayerIndex: intPtr(cm.targetPlayer),
	})
	h.sendHandGrowth(t, cm.targetPlayer, state.Hands[cm.targetPlayer].Cards[priorSize:])
}

// executeBotMove runs the bot's chosen action on behalf of its player slot.
func (h *Hub) executeBotMove(bm botMoveMsg) {
	t, ok := h.tables[bm.roomCode]
	if !ok {
		// Room was deleted between scheduling and firing — normal after match end or cleanup.
		log.Printf("bot move skipped, room gone code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}
	room := t.room
	if room.Status != game.StatusPlaying {
		// Game ended or not yet started between scheduling and firing.
		log.Printf("bot move skipped, room not playing code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}
	if room.State.CurrentTurn != bm.playerID {
		// Turn advanced (e.g. human played or another scheduled move already fired).
		// Very common during normal play — log only at debug level (omitted in prod).
		return
	}
	if !t.isBot(bm.playerID) {
		// Slot is no longer a bot (should not happen under current logic).
		log.Printf("bot move skipped, not a bot slot code=%s player=%d", bm.roomCode, bm.playerID)
		return
	}

	action := game.BotThink(room.State, bm.playerID)

	switch action.Kind {
	case game.BotPlay:
		h.botPlay(t, bm.playerID, action)
		return
	case game.BotCounter:
		h.botCounter(t, bm.playerID, action)
		return
	case game.BotDraw:
		if h.botDraw(t, bm.playerID) {
			return // self-rescheduled to play the drawn card
		}
	}

	h.maybeScheduleBot(t)
}

// botPlay handles a BotPlay action: PlayCard + post-play broadcasts + auto-UNO + round-end check.
func (h *Hub) botPlay(t *table, playerID int, action game.BotAction) {
	room := t.room
	if err := room.PlayCard(playerID, action.Card, action.ChosenColor, action.ChosenPlayer); err != nil {
		log.Printf("bot play error: %v", err)
		return
	}
	h.broadcastCardPlayed(t, playerID, action.ChosenPlayer)
	if action.Card.Kind == game.Swap || action.Card.Kind == game.GlobalSwitch {
		h.broadcastPersonalizedGameState(t)
	}
	h.maybeScheduleBotDeclarations(t)
	h.handleRoundOrMatchEnd(t)
}

// botCounter handles a BotCounter action: CounterDraw + broadcast + auto-UNO + round-end check.
func (h *Hub) botCounter(t *table, playerID int, action game.BotAction) {
	room := t.room
	if err := room.CounterDraw(playerID, action.Card, action.ChosenColor); err != nil {
		log.Printf("bot counter error: %v", err)
		return
	}
	h.broadcastCardPlayed(t, playerID, -1)
	h.maybeScheduleBotDeclarations(t)
	h.handleRoundOrMatchEnd(t)
}

// botDraw handles a BotDraw action: DrawCard + broadcast + post-draw turn handling.
// Returns true when it self-reschedules to play the drawn card (caller should NOT
// fall through to maybeScheduleBot).
func (h *Hub) botDraw(t *table, playerID int) (rescheduled bool) {
	code, room := t.code, t.room
	priorSize := len(room.State.Hands[playerID].Cards)
	if err := room.DrawCard(playerID); err != nil {
		log.Printf("bot draw error: %v", err)
		return false
	}
	state := room.State
	h.broadcastToRoomAll(t, protocol.ServerMsg{
		Type:        protocol.SMsgCardDrawn,
		PlayerIndex: intPtr(playerID),
		DrawnCount:  len(state.Hands[playerID].Cards) - priorSize,
		Turn:        state.CurrentTurn,
		PendingDraw: intPtr(state.PendingDraw),
		HasDrawn:    boolPtr(state.HasDrawn),
	})
	// A forced draw does not cost the turn (rules.md §14.5), so the seat is
	// still ours: play the drawn card or pass. The branch that used to handle a
	// penalty draw advancing the turn was unreachable from the day that
	// deviation landed — same dead code as in autoDrawOnTimeout.
	if botCanPlayDrawn(state, playerID) {
		// Schedule another bot move to play the drawn card.
		h.scheduleBotMove(code, playerID)
		return true
	}
	if err := room.PassTurn(playerID); err == nil {
		h.scheduleTurnTimer(t)
		h.broadcastToRoomAll(t, protocol.ServerMsg{
			Type:         protocol.SMsgTurnChanged,
			Turn:         room.State.CurrentTurn,
			TurnDeadline: turnDeadlineMs(t),
		})
	}
	return false
}

// maybeScheduleBotDeclarations arms a deferred LOCO! for every bot seat that
// currently owes one, not only for the seat that happened to act.
//
// Playing down to one card is not the only way to owe a declaration: a Swap or
// a GlobalSwitch hands one over, and receiving your last card is exactly as
// declarable as playing to it (rules.md §8). Keyed on the acting seat, a human
// who swapped a bot down to one card left it silently catchable for the whole
// 5 s window: a free +2 that no human ever offers, since bots do catch humans.
// A bot's own Swap had the same hole against a *second* bot.
//
// CatchableTargets is the same set maybeScheduleBotCatch reads: seats on one
// card, undeclared, window still open. Filtering it to bots is the entire rule.
// Nothing is declared here: see scheduleBotUnoAnnounce. Scheduling twice for
// one moment is harmless: the second announce finds the seat settled and
// returns.
func (h *Hub) maybeScheduleBotDeclarations(t *table) {
	code, room := t.code, t.room
	if room.Status != game.StatusPlaying || room.RoundEnded || room.State == nil {
		return
	}
	if len(t.bots) == 0 {
		return
	}
	for _, seat := range room.State.CatchableTargets(time.Now()) {
		if !t.isBot(seat) {
			continue // a human's own call is theirs to make or lose
		}
		h.scheduleBotUnoAnnounce(code, seat, room.State.LastCardAt[seat])
	}
}

// botCanPlayDrawn reports whether the bot can play any card in its hand against
// the current top discard / active color.
func botCanPlayDrawn(state *game.GameState, playerID int) bool {
	topCard := state.Discard[len(state.Discard)-1]
	for _, c := range state.Hands[playerID].Cards {
		if game.CanPlay(c, topCard, state.ActiveColor) {
			return true
		}
	}
	return false
}
