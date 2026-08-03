// What a client is handed: the player list, the scoreboard, and the
// personalised game state, built per recipient.
package hub

import (
	"log"

	"loco/server/game"
	"loco/server/protocol"
)

func (h *Hub) playerList(t *table) []protocol.PlayerDTO {
	room := t.room
	ps := make([]protocol.PlayerDTO, len(room.Players))

	for i, p := range room.Players {
		handSize := 0
		if room.State != nil {
			handSize = room.State.Hands[i].Size()
		}
		// Two ways a seat is empty, and both have to be read: the socket is
		// inside its reconnect window (awayAt), or that window closed and the
		// seat stayed because a running match indexes everything by it (gone).
		// Reading only the first reported a player as present for the rest of
		// the match, starting with the player_left that announced them gone.
		_, away := t.awayAt[i]
		connected := !away && !t.hasLeft(i)
		ps[i] = protocol.PlayerDTO{
			Index:     p.Index,
			Nickname:  p.Nickname,
			HandSize:  handSize,
			Connected: connected,
		}
	}
	return ps
}

func (h *Hub) buildScoreboard(room *game.Room) []protocol.ScoreboardEntryDTO {
	sb := make([]protocol.ScoreboardEntryDTO, len(room.Players))
	for i, p := range room.Players {
		sb[i] = protocol.ScoreboardEntryDTO{
			PlayerIndex: i,
			Nickname:    p.Nickname,
			Score:       room.Scores[i],
			RoundsWon:   room.RoundsWon[i],
		}
	}
	return sb
}

// playerGameState builds the full recovery snapshot for one player: the
// personalized state plus the event log. Used for the single-recipient sends
// that have to rebuild a client from nothing (reconnect). For broadcast loops
// over every member of a room, use playerGameStateUsing: it skips both the
// per-recipient player list and the log (see exportEventLog).
func (h *Hub) playerGameState(t *table, playerIdx int) *protocol.GameStateDTO {
	dto := h.playerGameStateUsing(t, playerIdx, h.playerList(t))
	dto.EventLog = exportEventLog(t.room.State)
	return dto
}

// maxEventLogExport caps how much history a reconnecting client is handed.
const maxEventLogExport = 50

// exportEventLog converts the tail of the room's event log to the wire format.
//
// It is deliberately NOT part of every game_state. The log is the one
// unbounded field in the snapshot (up to 50 entries, each with a nested card)
// and a personalized game_state is built per recipient, so a GlobalSwitch at a
// ten-seat table used to serialise the same 50 events ten times over. Nothing
// in the client reads it: it exists so a reconnecting player's history can be
// rebuilt, which is exactly the one send that still carries it.
func exportEventLog(state *game.GameState) []protocol.GameEventDTO {
	if state == nil {
		return nil
	}
	src := state.EventLog
	if len(src) > maxEventLogExport {
		src = src[len(src)-maxEventLogExport:]
	}
	out := make([]protocol.GameEventDTO, len(src))
	for i, ev := range src {
		dto := protocol.GameEventDTO{
			Kind:        string(ev.Kind),
			PlayerIndex: ev.PlayerIndex,
			At:          ev.At.UnixMilli(),
		}
		if ev.Card != nil {
			dto.Card = cardToDTO(*ev.Card)
		}
		if ev.ChosenColor != 0 {
			dto.ChosenColor = colorName(ev.ChosenColor)
		}
		out[i] = dto
	}
	return out
}

// playerGameStateUsing builds a personalized game-state DTO with a precomputed
// player list. Broadcast loops should call playerList(t) once and pass the
// result here for every recipient — this skips ~N redundant playerList rebuilds
// per broadcast (each rebuild iterates Players × State.Placements × Finished ×
// the held seats, and allocates a placement map and player slice).
func (h *Hub) playerGameStateUsing(t *table, playerIdx int, players []protocol.PlayerDTO) *protocol.GameStateDTO {
	room := t.room
	state := room.State
	// Defensive bounds. A panic here would kill the hub goroutine and take down
	// every active room, so we degrade gracefully when the inputs are unexpected
	// (e.g. message arrives during a status transition or with a corrupted ID).
	if state == nil || playerIdx < 0 || playerIdx >= len(state.Hands) || len(state.Discard) == 0 {
		hands, discard := 0, 0
		if state != nil {
			hands, discard = len(state.Hands), len(state.Discard)
		}
		log.Printf("WARN playerGameState invalid args code=%s playerIdx=%d state_nil=%t hands=%d discard=%d",
			room.Code, playerIdx, state == nil, hands, discard)
		return &protocol.GameStateDTO{
			YourIndex:   playerIdx,
			Hand:        []protocol.CardDTO{},
			Players:     players,
			MatchFormat: matchFormatString(room.Format),
			MaxPlayers:  room.MaxPlayers,
			RoundNumber: room.RoundNumber,
			MapID:       string(room.MapID),
		}
	}
	hand := make([]protocol.CardDTO, len(state.Hands[playerIdx].Cards))
	for i, c := range state.Hands[playerIdx].Cards {
		hand[i] = *cardToDTO(c)
	}
	top := state.Discard[len(state.Discard)-1]

	var scoreboard []protocol.ScoreboardEntryDTO
	if len(room.Scores) > 0 {
		scoreboard = h.buildScoreboard(room)
	}

	return &protocol.GameStateDTO{
		YourIndex:    playerIdx,
		Hand:         hand,
		Players:      players,
		Discard:      *cardToDTO(top),
		ActiveColor:  colorName(state.ActiveColor),
		Turn:         state.CurrentTurn,
		Direction:    state.Direction,
		PendingDraw:  state.PendingDraw,
		HasDrawn:     state.HasDrawn,
		RoundNumber:  room.RoundNumber,
		MatchFormat:  matchFormatString(room.Format),
		MaxPlayers:   room.MaxPlayers,
		MapID:        string(room.MapID),
		Scoreboard:   scoreboard,
		RoundHistory: room.RoundHistory,
		TurnDeadline: turnDeadlineMs(t),
	}
}
