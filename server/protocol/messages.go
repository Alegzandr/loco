// Package protocol defines the WebSocket message types between client and server.
package protocol

// ClientMsgType enumerates message types sent from client to server.
type ClientMsgType string

const (
	// Lobby
	CMsgCreateRoom     ClientMsgType = "create_room"
	CMsgJoinRoom       ClientMsgType = "join_room"
	CMsgStartGame      ClientMsgType = "start_game"
	CMsgAddBot         ClientMsgType = "add_bot"
	CMsgSetMatchFormat ClientMsgType = "set_match_format"
	CMsgSetMaxPlayers  ClientMsgType = "set_max_players"
	// CMsgSetStreamerMode is the host saying the table code must not be readable
	// on anybody's screen, because it is on theirs and theirs is being captured.
	// The one preference in this game that is not purely local: see
	// hub.handleSetStreamerMode.
	CMsgSetStreamerMode ClientMsgType = "set_streamer_mode"
	// CMsgKickPlayer frees a seat at the host's table, named by TargetIndex. The
	// only lobby control that acts on somebody else, and the only way to take a
	// bot's seat back. Lobby only: once the cards are out a seat belongs to a
	// match, not to the roster.
	CMsgKickPlayer ClientMsgType = "kick_player"
	// CMsgTransferHost hands the table to the seat named by TargetIndex. The host
	// is seat 0 and nothing else, so this is a seat swap and every host control
	// answers to the other player from the acknowledgement onwards. Lobby only,
	// never to a bot: a table nobody can start is the one thing this must not be
	// able to produce.
	CMsgTransferHost ClientMsgType = "transfer_host"
	// CMsgRematch returns a finished room to the lobby with the same players.
	CMsgRematch ClientMsgType = "rematch"
	// CMsgSendEmote says one of three fixed things, on the game-over screen and
	// nowhere else. The set is closed and lives in enums.go: a client cannot
	// invent a fourth, and there is no free text anywhere in this game.
	CMsgSendEmote ClientMsgType = "send_emote"
	// Matchmaking: a 1v1 against whoever is looking for the same thing. The
	// queue is anonymous and its size is never on the wire. See
	// SMsgMatchmakingQueued.
	CMsgFindMatch         ClientMsgType = "find_match"
	CMsgCancelMatchmaking ClientMsgType = "cancel_matchmaking"
	// CMsgPlayBot deals a 1v1 against the server, immediately. It is the queue's
	// shape without the queue: a nickname, one press, a hand — no code, no
	// waiting room, no host and nothing to configure. The table it opens has no
	// host for that reason, exactly like a matchmade one.
	CMsgPlayBot ClientMsgType = "play_bot"
	// CMsgLeaveRoom gives up the seat this socket holds without dropping the
	// connection. It is what "search for another opponent" is built on, and in a
	// matchmade match in progress it is a deliberate forfeit.
	CMsgLeaveRoom ClientMsgType = "leave_room"
	// Gameplay
	CMsgPlayCard    ClientMsgType = "play_card"
	CMsgDrawCard    ClientMsgType = "draw_card"
	CMsgPassTurn    ClientMsgType = "pass_turn"
	CMsgDeclareUno  ClientMsgType = "declare_uno"
	CMsgCatchUno    ClientMsgType = "catch_uno"
	CMsgCounterDraw ClientMsgType = "counter_draw"
	// CMsgMapReady tells the server this client has the match's map decoded and
	// is ready to play. Sent once per match, in answer to SMsgMatchLoading.
	CMsgMapReady ClientMsgType = "map_ready"
	// CMsgInterruptPlay is the realtime "lead-taking" / jump-in message.
	// Body may carry either a singular Card OR a PlayCards array (batch identical-card
	// interrupt). interrupt_play_card is accepted as an alias for the same handler.
	CMsgInterruptPlay     ClientMsgType = "interrupt_play"
	CMsgInterruptPlayCard ClientMsgType = "interrupt_play_card"
	// Dev / E2E only (requires LOCO_E2E=1 env var on the server)
	CMsgDebugSetState ClientMsgType = "debug_set_state"
)

// ServerMsgType enumerates message types sent from server to client.
type ServerMsgType string

const (
	// Lobby
	SMsgRoomCreated        ServerMsgType = "room_created"
	SMsgRoomJoined         ServerMsgType = "room_joined"
	SMsgPlayerJoined       ServerMsgType = "player_joined"
	SMsgPlayerLeft         ServerMsgType = "player_left"
	SMsgPlayerDisconnected ServerMsgType = "player_disconnected"
	SMsgPlayerReconnected  ServerMsgType = "player_reconnected"
	SMsgLobbyConfigChanged ServerMsgType = "lobby_config_changed"
	// SMsgStreamerModeChanged says the host's streamer mode moved. It is not a
	// lobby config: the host can be streaming a match that is already running, so
	// it travels on its own message rather than beside the format and the seat
	// count, which are refused once the table has dealt.
	SMsgStreamerModeChanged ServerMsgType = "streamer_mode_changed"
	// SMsgGameStarted hands every seat its dealt state. A solo table's copy also
	// carries RoomCode, PlayerID and SessionToken: that mode has no message
	// before this one — no room_created, no match_found — because it has no
	// screen before this one either, and a client still needs those three to
	// reclaim the seat after a reload.
	SMsgGameStarted ServerMsgType = "game_started"
	// SMsgMatchmakingQueued acknowledges a find_match. It carries no queue size,
	// no position and no estimate, on purpose: how many people are looking for a
	// game is nobody's business but the operator's, and a number that reads "1"
	// tells a player to give up. The client times its own wait instead.
	SMsgMatchmakingQueued ServerMsgType = "matchmaking_queued"
	// SMsgMatchmakingCancelled acknowledges leaving the queue. Also sent when the
	// server drops somebody from it (a pairing that fell apart before it began).
	SMsgMatchmakingCancelled ServerMsgType = "matchmaking_cancelled"
	// SMsgMatchFound seats both players at once. It carries everything
	// room_joined carries, plus StartsInMs: the match deals itself after that
	// delay, and nobody has to press anything.
	SMsgMatchFound ServerMsgType = "match_found"
	// SMsgLeftRoom acknowledges leave_room. The client is seatless again and
	// back on the home screen.
	SMsgLeftRoom ServerMsgType = "left_room"
	// SMsgHostChanged announces the table's new owner after a transfer_host.
	// Sent per-recipient, like SMsgRematchStarted and for the same reason: the
	// swap moves two seats, so half the room's own player_id changes with it and
	// a broadcast would leave the two players who moved reading somebody else's
	// row as their own. Nickname names the new host, Players carries the roster
	// in its new order, PlayerID the recipient's own seat.
	SMsgHostChanged ServerMsgType = "host_changed"
	// SMsgKicked tells a client the host freed its seat. Everything left_room
	// means — seatless, back home — plus the one thing the player did not
	// choose, so the screen changing under them is explained rather than
	// mysterious. Sent to the removed client only; the table sees player_left.
	SMsgKicked ServerMsgType = "kicked"
	// SMsgMatchLoading is sent right after game_started while the table waits for
	// everybody to finish downloading the map, and again on each arrival so the
	// loading screen can show who is still missing. PlayersReady names the seats
	// that are in.
	SMsgMatchLoading ServerMsgType = "match_loading"
	// SMsgMatchReady releases the table: the clock starts here, not at
	// game_started. Carries the turn deadline armed in the same instant.
	SMsgMatchReady ServerMsgType = "match_ready"
	// Gameplay state
	SMsgGameState   ServerMsgType = "game_state"
	SMsgCardPlayed  ServerMsgType = "card_played"
	SMsgCardDrawn   ServerMsgType = "card_drawn"
	SMsgTurnChanged ServerMsgType = "turn_changed"
	SMsgUnoDeclared ServerMsgType = "uno_declared"
	SMsgUnoCaught   ServerMsgType = "uno_caught"
	// SMsgCatchFailed names the seat whose Contre-LOCO! arrived too late and was
	// charged a card for it. Broadcast to the whole room: the wager is public,
	// like the catch it lost to.
	SMsgCatchFailed ServerMsgType = "catch_failed"
	// SMsgCatchLocked says when this seat's Contre-LOCO! becomes pressable
	// again after a call that found nobody, and it is sent to that seat alone.
	//
	// The lockout is rationed per press where the card is rationed per offer
	// (game.catchLockout), so a held button re-arms its own lock and is never
	// live at the instant a window opens. That only reaches the player if every
	// press is answered: the button has to be able to say *why* it is dead and
	// for how long, or a control that goes quiet under a thumb is indistinguishable
	// from one that is broken. Caller-only, deliberately — a lockout is a price
	// the table does not have to render, and a broadcast per press would be the
	// amplification catchGrace was written to stop.
	SMsgCatchLocked      ServerMsgType = "catch_locked"
	SMsgInterruptSuccess ServerMsgType = "interrupt_success"
	// Round / match lifecycle
	SMsgRoundEnd ServerMsgType = "round_end"
	SMsgMatchEnd ServerMsgType = "match_end"

	// SMsgLatency carries every seat's measured round-trip time. Broadcast on a
	// timer to rooms that are playing, so the in-game score table can show a
	// live ping per player without any client self-reporting.
	SMsgLatency ServerMsgType = "latency"

	// SMsgEmote carries one seat saying one of the three things. Broadcast,
	// shown for a few seconds and forgotten: nothing about it is stored, logged
	// or snapshotted.
	SMsgEmote ServerMsgType = "emote"
	// SMsgRematchOffered names a seat that has asked for another match. In a
	// matchmade room a rematch is an agreement between two strangers rather than
	// a host's decision, so both offers are public: the player who has not
	// answered yet needs to know somebody is waiting on them.
	SMsgRematchOffered ServerMsgType = "rematch_offered"
	// SMsgRematchStarted tells every remaining member that the finished room is
	// back in the lobby. Sent per-recipient because pruning absent players can
	// shift player indices.
	SMsgRematchStarted ServerMsgType = "rematch_started"
	// SMsgPlayersOnline is how many sockets this server is holding, sent to the
	// ones that are not sitting at a table. It is a sign of life on the home
	// screen and nothing else: it names nobody, it is not the matchmaking queue
	// (whose size is never on the wire, see SMsgMatchmakingQueued), and no
	// decision anywhere is taken on it. Sent on arrival and then only when the
	// number moves.
	SMsgPlayersOnline ServerMsgType = "players_online"
	// SMsgLiveStreams names the channels streaming this game right now, the
	// biggest first, and is sent only to the sockets that are not sitting at a
	// table — the same rule as SMsgPlayersOnline and for the same reason: it is
	// drawn on the home screen and nowhere else, and a match in progress has no
	// use for it.
	//
	// Pushed and never asked for, so this whole feature adds no client message
	// and nothing new can cost the dispatcher anything. Absent end to end when
	// the server has no gateway key, which is every environment but production.
	SMsgLiveStreams ServerMsgType = "live_streams"
	// SMsgServerUpdating tells a table in progress that this process is being
	// replaced. It is information, not an instruction: the match plays out to
	// its end, and nothing about it changes. Sent once, when the drain starts,
	// and again to anyone who reconnects into a draining server.
	SMsgServerUpdating ServerMsgType = "server_updating"
	// Errors
	SMsgError ServerMsgType = "error"
)

// ClientMsg is the envelope for all client-to-server messages.
//
//protocolgen:envelope
type ClientMsg struct {
	Type ClientMsgType `json:"type"`

	// CMsgCreateRoom / CMsgJoinRoom
	Nickname string `json:"nickname,omitempty"`
	RoomCode string `json:"room_code,omitempty"`

	// CMsgJoinRoom reconnect: prove identity
	SessionToken string `json:"session_token,omitempty"`

	// CMsgPlayCard / CMsgCounterDraw
	Card         *CardDTO  `json:"card,omitempty"`
	ChosenColor  CardColor `json:"chosen_color,omitempty"`
	ChosenPlayer *int      `json:"chosen_player,omitempty"` // target player index for Swap cards

	// CMsgPlayCard batch: when the player plays multiple identical cards at once.
	// All cards must be exactly equal; if PlayCards is non-empty it takes precedence
	// over the singular Card field. Swap and GlobalSwitch cannot be batch-played.
	PlayCards []CardDTO `json:"play_cards,omitempty"`

	// CMsgPlayCard / CMsgInterruptPlay batch: the LOCO! call the play carries.
	//
	// Only read when the batch empties the hand, which is the one finish the
	// player had no chance to announce beforehand: a hand of two identical cards
	// put down at once never passes through one card, so no catch window ever
	// opened on it and no declaration was ever possible. The server refuses such
	// a batch without this flag (game.ErrMustDeclareLoco). Every other finish is
	// gated on a declaration that already happened, and ignores this field.
	DeclareLoco bool `json:"declare_loco,omitempty"`

	// CMsgCatchUno: which seat is being caught. Several players can owe a
	// declaration at once (Swap / GlobalSwitch hand a single card to more than
	// one of them), so the catcher names their target. Omitted = the window
	// closest to expiring.
	//
	// CMsgKickPlayer: which seat the host is freeing. Required there — there is
	// no sensible default seat to remove.
	//
	// CMsgTransferHost: which seat is being handed the table. Required there too,
	// and for the same reason.
	TargetIndex *int `json:"target_index,omitempty"`

	// CMsgSetMatchFormat
	MatchFormat MatchFormat `json:"match_format,omitempty"`

	// CMsgSetMaxPlayers
	MaxPlayers int `json:"max_players,omitempty"`

	// CMsgSetStreamerMode: the state the host is asking for, not a toggle. A
	// toggle would come back wrong from a client whose picture of the table is a
	// message behind, and this one is switched from a panel that can be opened on
	// any screen.
	//
	// `omitempty` costs nothing here because absent and false mean the same
	// thing — off — on the one message type that reads it. That is not true of
	// the seat and turn fields above, whose zero is a seat.
	StreamerMode bool `json:"streamer_mode,omitempty"`

	// CMsgSendEmote: which of the three. Validated against AllEmotes, so an
	// identifier this server does not know is refused rather than relayed.
	Emote Emote `json:"emote,omitempty"`

	// CMsgDebugSetState — dev/E2E only (guarded by LOCO_E2E=1 server env var).
	//
	// One pointer, not seven fields. This struct is every message a client can
	// send, so seven flattened fixture fields were carried by play_card and
	// catch_uno too, and a reader of ClientMsg had to know which of the twenty
	// fields in front of them belonged to a message no player's client ever
	// sends. Nested, the fixture is one nil check away from the wire protocol
	// and reads as what it is: a dev-only payload hanging off a dev-only type.
	Debug *DebugStateDTO `json:"debug,omitempty"`
}

// DebugStateDTO is the whole payload of debug_set_state. Any combination of
// fields may be provided; omitted fields leave that part of the state alone.
type DebugStateDTO struct {
	Hand        []CardDTO              `json:"hand,omitempty"`         // replace this player's hand
	Hands       []DebugHandOverrideDTO `json:"hands,omitempty"`        // replace arbitrary players' hands
	Discard     *CardDTO               `json:"discard,omitempty"`      // replace top of discard pile
	ActiveColor CardColor              `json:"active_color,omitempty"` // override active color
	PendingDraw *int                   `json:"pending_draw,omitempty"` // override pending draw count
	CurrentTurn *int                   `json:"current_turn,omitempty"` // override current turn player index
	Direction   *int                   `json:"direction,omitempty"`    // override play direction (1 cw, -1 ccw)
}

// DebugHandOverrideDTO is one per-player hand replacement used by debug_set_state.
type DebugHandOverrideDTO struct {
	PlayerIndex int       `json:"player_index"`
	Hand        []CardDTO `json:"hand"`
}

// CardDTO is the wire representation of a card.
type CardDTO struct {
	Color CardColor `json:"color"`
	Kind  CardKind  `json:"kind"`
	Value int       `json:"value,omitempty"`
}

// CatchSeatDTO names a seat that owes the table a declaration, and says when
// its window shuts. EndsAt is unix milliseconds, like every other deadline on
// the wire, so a client renders a countdown against its own clock rather than
// holding a copy of the server's window length.
type CatchSeatDTO struct {
	PlayerIndex int   `json:"player_index"`
	EndsAt      int64 `json:"ends_at"`
}

// ScoreboardEntryDTO is one player's match-level score summary.
type ScoreboardEntryDTO struct {
	PlayerIndex int    `json:"player_index"`
	Nickname    string `json:"nickname"`
	Score       int    `json:"score"`
	RoundsWon   int    `json:"rounds_won"`
}

// MatchRecordDTO is one finished match at this table, kept so a group playing
// six in a row can see who actually won the evening.
//
// Both halves travel because both are read: RoundsWon is what decided that
// match, Scores is the gap it was decided by. Indexed by seat, exactly like the
// scoreboard, so a client renders one column per match against the roster it
// already has.
type MatchRecordDTO struct {
	RoundsWon []int `json:"rounds_won"`
	Scores    []int `json:"scores"`
	// WinnerIndex is the seat that took the match, or -1 when the seat that took
	// it has since left the table. No omitempty: seat 0 is a winner like any
	// other, and dropping it would hand the match to nobody.
	WinnerIndex int `json:"winner_index"`
	// DurationMs is how long the match was played, from the moment the turn
	// clock started (match_ready, not the deal: the map-loading gate is a wait,
	// not the game) to the moment it ended. Absent when the server cannot say —
	// a forfeit inside the loading gate, or a match restored from a snapshot an
	// older process wrote — and never zero for a match that was played: a
	// started match reports at least one millisecond.
	DurationMs int64 `json:"duration_ms,omitempty"`
}

// LatencyEntryDTO is one seat's measured round-trip time.
type LatencyEntryDTO struct {
	PlayerIndex int `json:"player_index"`
	// RTTMs is the smoothed WebSocket ping/pong round trip in milliseconds,
	// or -1 when nothing has been measured yet (bots, a seat that just
	// connected, a player inside their reconnect window).
	RTTMs int  `json:"rtt_ms"`
	Bot   bool `json:"bot,omitempty"`
}

// ServerMsg is the envelope for all server-to-client messages.
//
//protocolgen:envelope
type ServerMsg struct {
	Type ServerMsgType `json:"type"`

	// ServerNow is the server's clock, in unix milliseconds, at the instant the
	// message was written. On every message, because it is what makes every
	// deadline below readable.
	//
	// TurnDeadline, CatchSeatDTO.EndsAt and ForfeitDeadline are absolute server
	// instants, and the client counts them down against its own clock. A phone
	// whose clock is six seconds fast sees every five-second catch window already
	// shut, so the armed capsule never draws and the player is told nobody is on
	// the hook; six seconds slow, the capsule stays up after the server's window
	// has closed and the press it invites costs a card. The client reads this
	// against its own clock on arrival, keeps the offset, and converts every
	// deadline it is handed into its own time. One-way latency is the residual
	// error — a few tens of milliseconds, in the direction of a window shown a
	// touch longer than it is — where clock skew is seconds either way.
	ServerNow int64 `json:"server_now,omitempty"`

	// SMsgRoomCreated / SMsgRoomJoined / SMsgPlayerReconnected (self) /
	// SMsgRematchStarted: the recipient's OWN seat.
	//
	// A pointer for exactly the same reason as PlayerIndex below, and it took
	// longer to notice because the client's `?? 0` fallback was right by luck
	// everywhere it mattered: the host is seat 0 on room_created, so an absent
	// field and the default agreed. A tab reloading into a match is where the
	// luck runs out: it has no earlier value to fall back to, so a dropped
	// player_id left the restored client seated at -1, holding a hand it could
	// not match to any seat on the board. Read it with OwnSeat().
	RoomCode     string `json:"room_code,omitempty"`
	PlayerID     *int   `json:"player_id,omitempty"`
	SessionToken string `json:"session_token,omitempty"` // opaque token for reconnect auth

	// Player lists and nicknames
	Players  []PlayerDTO `json:"players,omitempty"`
	Nickname string      `json:"nickname,omitempty"`

	// SMsgGameStarted / SMsgGameState / SMsgPlayerReconnected (self)
	State *GameStateDTO `json:"state,omitempty"`

	// SMsgCardPlayed / SMsgCardDrawn / SMsgUnoDeclared / SMsgUnoCaught /
	// SMsgCatchFailed / SMsgInterruptSuccess / SMsgPlayerDisconnected /
	// SMsgPlayerReconnected:
	// the seat the message is about.
	//
	// A pointer for the same reason as PendingDraw/HasDrawn below: `omitempty`
	// drops a zero, and seat 0 is the host's seat. The client closes the catch
	// window on the seat named by uno_declared, so an absent player_index left
	// it open — Contre-LOCO! stayed armed on a player who had already called it
	// and the server refused every tap with "player already declared".
	// Read it with Seat(); absent means "this message names no seat".
	PlayerIndex *int      `json:"player_index,omitempty"`
	Card        *CardDTO  `json:"card,omitempty"`
	ActiveColor CardColor `json:"active_color,omitempty"` // authoritative active color after card play
	// Set only when a Swap card resolves: the target player index whose hand was exchanged
	// with the actor's hand. Lets clients show a "X swapped with Y" notification without
	// exposing hand contents to non-participants.
	ChosenPlayer *int `json:"chosen_player,omitempty"`

	// SMsgTurnChanged.
	//
	// No omitempty, deliberately: seat 0 is a turn like any other, and dropping
	// it would leave every client to infer whose turn it is from an absence.
	// The client happens to default to 0, so this was correct by luck — the same
	// luck PlayerIndex did not have. A few bytes on every message is the price of
	// never having to think about it again.
	Turn int `json:"turn"`

	// Play direction (1 = clockwise, -1 = counter-clockwise) AFTER any card effect
	// has been applied. Included in card_played so clients can update their
	// direction indicator immediately without waiting for the next game_state.
	Direction int `json:"direction,omitempty"`

	// Per-turn deadline: unix milliseconds when the current turn expires (0 = no timer active)
	// Included in card_played, card_drawn, turn_changed, and game_started to let clients
	// display and reset the countdown when a new turn begins.
	TurnDeadline int64 `json:"turn_deadline,omitempty"`

	// InterruptOpen is whether a twin of the top discard may still be slammed
	// onto it. Carried by every message that can open or shut the window —
	// card_played opens it, a draw or a pass by the seat at turn shuts it, a
	// round end shuts it, match_ready reports the deal's — because the client
	// used to keep no copy of it: it offered the twin for as long as the card was
	// on top, and a slam after somebody had drawn came back "somebody was faster"
	// on a table where nobody had been. A pointer, because false is the answer
	// that matters and omitempty would drop it; absent means "unchanged".
	InterruptOpen *bool `json:"interrupt_open,omitempty"`

	// SMsgCardPlayed: every seat that owes the table a declaration once this
	// play has resolved, with the instant each window shuts.
	//
	// The server sends it because the server decides it. The client used to work
	// it out again from the roster and the card kind (an ordinary play puts the
	// actor on the hook, a Swap or a GlobalSwitch puts every seat left holding
	// one card on it), which is the server's rule living in two places, in two
	// languages, with nothing checking they agree. A drift there does not fail,
	// it just arms Contre-LOCO! on a tap the server will refuse, or leaves it
	// dark on a seat the player was entitled to catch.
	CatchSeats []CatchSeatDTO `json:"catch_seats,omitempty"`

	// SMsgCatchLocked: unix milliseconds when the recipient's Contre-LOCO!
	// lockout ends, absolute on the server's clock like every other deadline
	// here. Zero, and therefore absent, means the seat is not locked — the same
	// convention TurnDeadline uses, and the reason nothing on this side has to
	// know how long a lockout lasts.
	CatchLockedUntil int64 `json:"catch_locked_until,omitempty"`

	// SMsgCardPlayed / SMsgCardDrawn: the authoritative turn state AFTER the
	// event.
	//
	// Pointers, not plain values: `omitempty` drops a false bool and a zero int
	// from the wire, so the receiver has to invent the missing value — and it
	// guesses wrong exactly where it hurts. A hand can grow without the current
	// player having drawn (UNO-catch penalty), and a client that read the absent
	// has_drawn as "true" then disabled its own Draw button and had every Pass
	// refused with "you must draw a card before passing" until the turn timer
	// bailed it out. Absent now means "unchanged", and every sender fills them in.
	PendingDraw *int  `json:"pending_draw,omitempty"`
	HasDrawn    *bool `json:"has_drawn,omitempty"`

	// SMsgCardDrawn: multiple cards drawn at once (penalty draw)
	// Cards holds all drawn cards for the drawing player; DrawnCount tells observers how many.
	//
	// A slice of values, not of pointers. `[]*CardDTO` says a slot can be null,
	// which the server has never produced and no client has ever handled, and it
	// has no honest TypeScript spelling: the generator would have had to either
	// invent `(CardDTO | null)[]` for a case that cannot arise, or quietly drop
	// the nullability and be stricter than the wire. Neither is a decision worth
	// leaving to a code generator.
	Cards []CardDTO `json:"cards,omitempty"`
	// No omitempty for the same reason as Turn, and here it was not luck: a draw
	// against exhausted piles hands over nothing, and the client's fallback for
	// an absent count was 1 — so every observer would have added a card nobody
	// drew, to a hand the server never grew.
	DrawnCount int `json:"drawn_count"`

	// SMsgRoundEnd / SMsgMatchEnd
	RoundNumber int                  `json:"round_number,omitempty"`
	RoundWinner string               `json:"round_winner,omitempty"`
	Scoreboard  []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
	MatchOver   bool                 `json:"match_over,omitempty"`
	MatchWinner string               `json:"match_winner,omitempty"`
	// SMsgMatchEnd: this match ended because somebody stopped being there, not
	// because a round was won. PlayerIndex above names the seat that left, so
	// the survivor's screen can say what happened instead of celebrating a
	// victory nobody played for. Absent means an ordinary end, the one thing an
	// omitted bool can mean here, since the field rides a single message type.
	Forfeit bool `json:"forfeit,omitempty"`

	// SMsgPlayerDisconnected: unix milliseconds at which the absent seat's match
	// is forfeited if they have not come back. Only sent for matchmade rooms,
	// where the wait is short and the player still at the table is owed a number
	// rather than an indefinite "opponent disconnected". 0/absent = no such
	// deadline (an ordinary room, where the seat is simply held).
	ForfeitDeadline int64 `json:"forfeit_deadline,omitempty"`

	// SMsgMatchFound: how long the reveal lasts before the match deals itself.
	// Absent means "immediately", which is the right reading: the countdown is
	// presentation, and game_started arriving is what actually opens the match.
	StartsInMs int64 `json:"starts_in_ms,omitempty"`
	// RoundHistory[k][playerIndex] = points scored in round k+1. Sent with
	// round_end so the score table updates without waiting for the next
	// game_state (which the client buffers behind the round summary).
	RoundHistory [][]int `json:"round_history,omitempty"`

	// SMsgMatchEnd: every match this table has finished, oldest first, the one
	// just ended included. A rematch wipes the scoreboard, so without this a
	// group that plays six matches on one code ends the evening with nobody able
	// to say who won it. Only the game-over screen reads it, so it rides the one
	// message that opens that screen.
	//
	// SMsgPlayerLeft carries it too, and only on the departures that re-base the
	// roster: every row is indexed by seat, so a screen that is already up is
	// reading the wrong column the moment a seat below it goes.
	MatchHistory []MatchRecordDTO `json:"match_history,omitempty"`

	// SMsgLatency
	Latencies []LatencyEntryDTO `json:"latencies,omitempty"`

	// SMsgLobbyConfigChanged
	MatchFormat MatchFormat `json:"match_format,omitempty"`
	MaxPlayers  int         `json:"max_players,omitempty"`

	// SMsgStreamerModeChanged, and the table's current answer on SMsgRoomJoined so
	// somebody arriving mid-stream blurs the code without waiting for the host to
	// touch the switch again. (Not on SMsgRoomCreated: that table is one message
	// old and the host is the client that owns the setting.)
	//
	// `omitempty` for the same reason as Forfeit: absent can only mean off. The
	// field rides message types that always carry the whole state of the setting,
	// never an increment, so there is no earlier value it could be leaving
	// unchanged.
	StreamerMode bool `json:"streamer_mode,omitempty"`

	// SMsgMatchLoading: the seats whose client has the map decoded.
	//
	// `omitempty` is safe here, unlike on PlayerIndex/PendingDraw: this field
	// appears on exactly one message type, so an absent list can only mean "no
	// seat is ready yet": there is no earlier value it could be leaving
	// unchanged. Keeping it omittable also keeps it off every other broadcast.
	PlayersReady []int `json:"players_ready,omitempty"`

	// SMsgRematchOffered: every seat that has asked for another match, and how
	// many asks it takes. The whole state travels rather than the increment,
	// because a seat leaving retires its offer and re-bases the rest: a client
	// accumulating names would keep a departed player's ask forever.
	//
	// A pointer for the same reason PlayerIndex is one: this list has to be able
	// to say "nobody is asking any more", and an empty slice under `omitempty`
	// marshals to nothing, which every other message would then also carry as
	// "no offers" and which the client could not tell from "unchanged".
	// Read it with Offers().
	RematchOffers *[]int `json:"rematch_offers,omitempty"`
	// RematchNeeded is how many of those asks deal the next match: two, one
	// offering and one accepting, or the whole table when it is smaller than
	// that. Bots are not asked. See hub.RematchQuorum.
	RematchNeeded int `json:"rematch_needed,omitempty"`

	// SMsgEmote: what was said, and PlayerIndex above says who said it.
	Emote Emote `json:"emote,omitempty"`

	// SMsgPlayersOnline: how many sockets this server is holding.
	//
	// A pointer, like PlayerIndex and for both of its reasons. The number that
	// most has to reach the home screen is the one that has just dropped, and a
	// plain int under `omitempty` drops a zero — the chip would stay on screen
	// counting people who have gone. Spelling it without `omitempty` instead
	// would put `players_online: 0` on every card_played this server sends, for
	// a field one screen reads and no match ever does.
	PlayersOnline *int `json:"players_online,omitempty"`

	// SMsgLiveStreams: who is streaming this game, biggest first.
	//
	// A pointer for the reason RematchOffers is one: this list has to be able
	// to say "nobody is live any more", and an empty slice under `omitempty`
	// marshals to nothing at all — which every other message would then carry
	// as "nobody" too, indistinguishable from "unchanged". Read it with Live().
	LiveStreams *[]LiveStreamDTO `json:"live_streams,omitempty"`

	// SMsgError
	Error string `json:"error,omitempty"`
}

// Seat returns the seat this message is about, or -1 when it names none.
func (m ServerMsg) Seat() int {
	if m.PlayerIndex == nil {
		return -1
	}
	return *m.PlayerIndex
}

// Offers returns the seats that have asked for another match. An empty list is
// a real answer here ("nobody is asking"), so an absent field reads the same
// way: no message but rematch_offered ever sets it.
func (m ServerMsg) Offers() []int {
	if m.RematchOffers == nil {
		return nil
	}
	return *m.RematchOffers
}

// Live returns the channels streaming this game. An empty list is a real
// answer here ("nobody any more"), so an absent field reads the same way: no
// message other than live_streams ever sets it.
func (m ServerMsg) Live() []LiveStreamDTO {
	if m.LiveStreams == nil {
		return nil
	}
	return *m.LiveStreams
}

// OwnSeat returns the recipient's own seat, or -1 when the message assigns none.
func (m ServerMsg) OwnSeat() int {
	if m.PlayerID == nil {
		return -1
	}
	return *m.PlayerID
}

// PlayerDTO is the public view of a player.
type PlayerDTO struct {
	Index     int    `json:"index"`
	Nickname  string `json:"nickname"`
	HandSize  int    `json:"hand_size"`
	Connected bool   `json:"connected"`
	// IsBot marks a seat the server plays. Carried because the roster offers
	// controls a bot cannot answer — the table cannot be handed to one — and the
	// nickname is not a way to tell: "Bot1" is a name a player is allowed to
	// take.
	//
	// omitempty, unlike Connected: absent and false are the same statement here,
	// where an absent `connected` would be a player the roster stopped
	// mentioning. Most seats are people, so most rosters carry it for none of
	// them.
	IsBot bool `json:"is_bot,omitempty"`
}

// GameEventDTO is the wire representation of a game event.
type GameEventDTO struct {
	// Kind stays a bare string, unlike CardDTO.Kind: these are event kinds from
	// the domain's own log, they are read only as labels, and a server that logs
	// a new one must not make a generated client refuse the whole snapshot.
	Kind        string    `json:"kind"`
	PlayerIndex int       `json:"player_index"`
	Card        *CardDTO  `json:"card,omitempty"`
	ChosenColor CardColor `json:"chosen_color,omitempty"`
	At          int64     `json:"at"` // unix milliseconds
}

// GameStateDTO is the per-player view of the game state sent on join/start.
type GameStateDTO struct {
	YourIndex   int            `json:"your_index"`
	Hand        []CardDTO      `json:"hand"`
	Players     []PlayerDTO    `json:"players"`
	Discard     CardDTO        `json:"discard"`
	ActiveColor CardColor      `json:"active_color"`
	Turn        int            `json:"turn"`
	Direction   int            `json:"direction"`
	PendingDraw int            `json:"pending_draw,omitempty"`
	HasDrawn    bool           `json:"has_drawn,omitempty"`
	EventLog    []GameEventDTO `json:"event_log,omitempty"`

	// Match info
	RoundNumber int         `json:"round_number"`
	MatchFormat MatchFormat `json:"match_format"`
	MaxPlayers  int         `json:"max_players"`
	// MapID names the room this match is played in (see game/maps.go). Rides
	// every snapshot rather than only game_started so a reconnecting player
	// rebuilds the same table as everybody else. Empty = the built-in felt.
	MapID string `json:"map_id,omitempty"`
	// TimeOfDay and Weather are the hour and the sky the match is dealt under
	// (see game/maps.go), drawn beside MapID and travelling with it on every
	// snapshot. Bare strings like MapID, for the same reason: a value this
	// client does not know must degrade to a default sky, never drop the whole
	// game_state.
	TimeOfDay  string               `json:"time_of_day,omitempty"`
	Weather    string               `json:"weather,omitempty"`
	Scoreboard []ScoreboardEntryDTO `json:"scoreboard,omitempty"`
	// RoundHistory[k][playerIndex] = points scored in round k+1 (see ServerMsg).
	// Included in every snapshot so a reconnecting player recovers the table.
	RoundHistory [][]int `json:"round_history,omitempty"`
	// MatchHistory is the table's finished matches (see ServerMsg). Carried here
	// too so a player who reconnects mid-match still has the evening behind them
	// when this match ends.
	MatchHistory []MatchRecordDTO `json:"match_history,omitempty"`

	// Per-turn deadline: unix milliseconds when the current turn expires (0 = no timer active)
	TurnDeadline int64 `json:"turn_deadline,omitempty"`

	// InterruptOpen is whether the top discard may still be slammed. See
	// ServerMsg.InterruptOpen; here a plain bool, since a snapshot says the whole
	// board: omitted means shut, and the client reads it that way.
	InterruptOpen bool `json:"interrupt_open,omitempty"`

	// CatchSeats is who owes the table a declaration right now, exactly as
	// card_played carries it. A tab that reloads two seconds into a five-second
	// window used to rebuild a board on which nobody was catchable, and lose the
	// three seconds it could still have won.
	CatchSeats []CatchSeatDTO `json:"catch_seats,omitempty"`
	// DeclaredSeats is every seat whose single card has already been called.
	// Without it a reload put the LOCO! button back in front of a player whose
	// call was already spent, and the press came back "player already declared".
	DeclaredSeats []int `json:"declared_seats,omitempty"`

	// CatchLockedUntil is the recipient's own Contre-LOCO! lockout, personalised
	// like the hand above it and absolute on the server's clock. A snapshot is
	// how a reloaded tab and a corrected one learn a board, and without this one
	// they came back with a live button over a press the server refuses in
	// silence — the one failure the whole mechanic is written around. Zero, and
	// absent, means not locked. See ServerMsg.CatchLockedUntil.
	CatchLockedUntil int64 `json:"catch_locked_until,omitempty"`

	// StreamerMode is the host's answer, carried in every snapshot for the same
	// reason MapID is: a tab that reloads mid-match rebuilds the table from this
	// and nothing else, and a table code that comes back readable on a stream is
	// the one failure this setting exists to prevent. See ServerMsg.StreamerMode.
	StreamerMode bool `json:"streamer_mode,omitempty"`
}

// LiveStreamDTO is one channel streaming this game, as this server saw it at
// the last poll.
//
// Nothing in it is ours: the channel name is written by a stranger and shown to
// players. Every row is screened server-side before it gets here (twitch.screen)
// and a name that does not survive is dropped whole rather than masked — the
// name is the link, so there would be nothing left to show.
//
// There is deliberately no title field. A stream title is the largest piece of
// unmoderated text this feature could put on the home screen, and a name, a
// viewer count and a picture are enough to decide whether to click.
type LiveStreamDTO struct {
	// Login is the channel's URL segment, and the only thing a client builds
	// the outgoing link from. Guaranteed to match ^[A-Za-z0-9_]{1,25}$ by the
	// screen: a row whose login falls outside that alphabet is dropped whole,
	// which is what makes the link safe to assemble without escaping.
	Login string `json:"login"`
	// Name is the display name. It differs from Login by case, and entirely for
	// a channel that is not written in Latin script.
	Name string `json:"name"`
	// Lang is the BCP-47 tag Twitch announces ("en", "fr"). Presentation only:
	// the list is never filtered on the reader's language, because an English
	// stream is a stream.
	Lang string `json:"lang,omitempty"`
	// Viewers is what makes this list a ranking. No omitempty: zero viewers is
	// a channel that is live, and a dropped zero would read as "unknown". Same
	// rule as Turn and DrawnCount.
	Viewers int `json:"viewers"`
	// Thumb is a path on THIS origin (/live-thumb/<key>), never a Twitch URL:
	// img-src is 'self', and a player's browser must not tell Twitch that
	// somebody opened this page. Empty when the picture could not be fetched —
	// the row stays, without one.
	Thumb string `json:"thumb,omitempty"`
}
