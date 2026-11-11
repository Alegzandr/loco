//! Everything the server can say.
//!
//! One variant per message type, each carrying exactly the fields the server
//! writes on it. The Go server wrote every message out of one flat envelope;
//! the bytes it produced are the contract, and the fixtures in
//! `tests/fixtures/` (frames captured from the Go server) are read back and
//! written again by `tests/parity.rs` to prove nothing moved.
//!
//! Two things every message carries:
//!
//! - `server_now`, the server's clock in unix milliseconds at the instant the
//!   message was written, stamped where a message is marshalled
//!   ([`ServerMsg::stamp`]). Every deadline on the wire is an absolute server
//!   instant, and this is what lets a client whose clock is seconds off read
//!   them. Optional, because one message (`live_streams`) is marshalled once and
//!   handed to many sockets over time, and carries no stamp.
//! - `turn` and `drawn_count`. The Go envelope never omitted either (a zero is
//!   a seat, and a draw of nothing is a count), so it wrote both on *every*
//!   message, `0` on the thirty-odd that have no turn and drew nothing. The
//!   messages that mean them (`card_played`, `card_drawn`, `turn_changed`,
//!   `match_ready`) carry them as fields; on every other message the serializer
//!   writes the same `0` the Go server did, so the wire is unchanged. No client
//!   reads them there, and the generated types do not mention them there.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize, Serializer};
use ts_rs::TS;

use crate::dto::{
    CardDTO, CatchSeatDTO, GameStateDTO, LatencyEntryDTO, LiveStreamDTO, MatchRecordDTO, PlayerDTO,
    ScoreboardEntryDTO,
};
use crate::enums::{CardColor, Emote, MatchFormat};
use crate::is_default;

/// What every server message payload knows about itself.
pub trait ServerPayload: Serialize {
    /// Whether the payload carries `turn` itself. When it does not, the
    /// serializer writes `"turn": 0` beside it, as the Go envelope did.
    const OWNS_TURN: bool = false;
    /// Same for `drawn_count`.
    const OWNS_DRAWN_COUNT: bool = false;
    /// The message's `server_now` stamp.
    fn server_now_mut(&mut self) -> &mut Option<i64>;
}

/// Declares a payload struct with its `server_now` field appended, so the stamp
/// is spelled once rather than thirty-six times.
macro_rules! payload {
    (
        $(#[$meta:meta])*
        pub struct $name:ident { $($body:tt)* }
        $(owns($($own:ident),+))?
    ) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
        pub struct $name {
            $($body)*
            /// The server's clock, in unix milliseconds, at the instant the
            /// message was written.
            #[serde(default, skip_serializing_if = "Option::is_none")]
            #[ts(optional)]
            #[ts(type = "number")]
            pub server_now: Option<i64>,
        }

        impl ServerPayload for $name {
            $($(payload!(@own $own);)+)?
            fn server_now_mut(&mut self) -> &mut Option<i64> {
                &mut self.server_now
            }
        }
    };
    (@own turn) => { const OWNS_TURN: bool = true; };
    (@own drawn_count) => { const OWNS_DRAWN_COUNT: bool = true; };
}

/// Declares the enum, its serializer and its accessors from one list, so a
/// variant cannot be added to the type and forgotten by the writer.
macro_rules! server_messages {
    ( $( $(#[$meta:meta])* $variant:ident($payload:ident) = $tag:literal, )* ) => {
        /// A server-to-client message. Tagged by `type` on the wire.
        ///
        /// Written through [`Serialize`] below, never derived: see the module
        /// documentation for the two fields it adds.
        #[derive(Debug, Clone, PartialEq, Eq, Deserialize, TS, JsonSchema)]
        #[serde(tag = "type")]
        pub enum ServerMsg {
            $( $(#[$meta])* #[serde(rename = $tag)] $variant($payload), )*
        }

        impl ServerMsg {
            /// The message's `type` on the wire.
            pub const fn type_name(&self) -> &'static str {
                match self { $( Self::$variant(_) => $tag, )* }
            }

            /// Every `type` the server can send, in declaration order.
            pub const TYPES: &'static [&'static str] = &[ $( $tag, )* ];

            /// The message's `server_now` stamp.
            pub fn server_now_mut(&mut self) -> &mut Option<i64> {
                match self { $( Self::$variant(p) => p.server_now_mut(), )* }
            }

            /// Stamps the message with the server's clock. Called where a message
            /// is marshalled, and nowhere else.
            pub fn stamp(&mut self, now_ms: i64) {
                *self.server_now_mut() = Some(now_ms);
            }
        }

        impl Serialize for ServerMsg {
            fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                match self { $( Self::$variant(p) => Wire::new($tag, p).serialize(s), )* }
            }
        }
    };
}

/// A payload as it travels: its tag, its own fields, and the Go envelope's
/// two always-written zeros where the payload does not carry them itself.
#[derive(Serialize)]
struct Wire<'a, T: ServerPayload> {
    #[serde(rename = "type")]
    tag: &'static str,
    #[serde(flatten)]
    body: &'a T,
    #[serde(skip_serializing_if = "Option::is_none")]
    turn: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    drawn_count: Option<i32>,
}

impl<'a, T: ServerPayload> Wire<'a, T> {
    fn new(tag: &'static str, body: &'a T) -> Self {
        Wire {
            tag,
            body,
            turn: (!T::OWNS_TURN).then_some(0),
            drawn_count: (!T::OWNS_DRAWN_COUNT).then_some(0),
        }
    }
}

server_messages! {
    // --- Lobby ---
    RoomCreated(RoomCreatedMsg) = "room_created",
    RoomJoined(RoomJoinedMsg) = "room_joined",
    PlayerJoined(PlayerJoinedMsg) = "player_joined",
    PlayerLeft(PlayerLeftMsg) = "player_left",
    PlayerDisconnected(PlayerDisconnectedMsg) = "player_disconnected",
    PlayerReconnected(PlayerReconnectedMsg) = "player_reconnected",
    LobbyConfigChanged(LobbyConfigChangedMsg) = "lobby_config_changed",
    /// The host's streamer mode moved. Not a lobby config: the host can be
    /// streaming a match that is already running.
    StreamerModeChanged(StreamerModeChangedMsg) = "streamer_mode_changed",
    GameStarted(GameStartedMsg) = "game_started",
    /// Acknowledges a find_match. Carries no queue size, no position and no
    /// estimate, on purpose: how many people are looking for a game is nobody's
    /// business but the operator's.
    MatchmakingQueued(EmptyMsg) = "matchmaking_queued",
    /// Acknowledges leaving the queue, or says the server dropped somebody from
    /// it (a pairing that fell apart before it began).
    MatchmakingCancelled(EmptyMsg) = "matchmaking_cancelled",
    MatchFound(MatchFoundMsg) = "match_found",
    /// Acknowledges leave_room: the client is seatless again.
    LeftRoom(EmptyMsg) = "left_room",
    HostChanged(HostChangedMsg) = "host_changed",
    /// The host freed this client's seat. Everything left_room means, plus the
    /// one thing the player did not choose. Sent to the removed client only.
    Kicked(EmptyMsg) = "kicked",
    MatchLoading(MatchLoadingMsg) = "match_loading",
    MatchReady(MatchReadyMsg) = "match_ready",
    // --- Gameplay ---
    GameState(GameStateMsg) = "game_state",
    CardPlayed(CardPlayedMsg) = "card_played",
    CardDrawn(CardDrawnMsg) = "card_drawn",
    TurnChanged(TurnChangedMsg) = "turn_changed",
    UnoDeclared(SeatMsg) = "uno_declared",
    UnoCaught(SeatMsg) = "uno_caught",
    /// Names the seat whose Contre-LOCO! found nobody and was charged a card
    /// for it. Broadcast: the wager is public, like the catch it lost to.
    CatchFailed(SeatMsg) = "catch_failed",
    CatchLocked(CatchLockedMsg) = "catch_locked",
    InterruptSuccess(InterruptSuccessMsg) = "interrupt_success",
    // --- Round / match lifecycle ---
    RoundEnd(RoundEndMsg) = "round_end",
    MatchEnd(MatchEndMsg) = "match_end",
    Latency(LatencyMsg) = "latency",
    Emote(EmoteMsg) = "emote",
    RematchOffered(RematchOfferedMsg) = "rematch_offered",
    RematchStarted(RematchStartedMsg) = "rematch_started",
    PlayersOnline(PlayersOnlineMsg) = "players_online",
    LiveStreams(LiveStreamsMsg) = "live_streams",
    /// This process is being replaced. Information, not an instruction: the
    /// match plays out to its end. Sent once when the drain starts, and again
    /// to anyone who reconnects into a draining server.
    ServerUpdating(EmptyMsg) = "server_updating",
    Error(ErrorMsg) = "error",
}

payload! {
    /// A message that says nothing but its type.
    pub struct EmptyMsg {}
}

payload! {
    /// room_created: the host's own seat at a table that is one message old.
    pub struct RoomCreatedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        /// The recipient's own seat.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        /// Opaque token for reconnect auth.
        #[serde(default, skip_serializing_if = "is_default")]
        pub session_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub match_format: Option<MatchFormat>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub max_players: i32,
    }
}

payload! {
    /// room_joined: a seat at somebody else's table.
    pub struct RoomJoinedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        /// The recipient's own seat.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub session_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub match_format: Option<MatchFormat>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub max_players: i32,
        /// The table's current answer, so somebody arriving mid-stream blurs
        /// the code without waiting for the host to touch the switch again.
        #[serde(default, skip_serializing_if = "is_default")]
        pub streamer_mode: bool,
    }
}

payload! {
    /// player_joined.
    pub struct PlayerJoinedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub nickname: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
    }
}

payload! {
    /// player_left.
    ///
    /// `player_index` is named only when the seat is gone for good and nothing
    /// re-based (the mid-match expiry). The departures that do re-base the
    /// roster carry the re-based `match_history`, and on a finished table the
    /// `scoreboard` and `round_history` too: every row is indexed by seat, and
    /// the client cannot re-base them itself.
    pub struct PlayerLeftMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub nickname: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub match_history: Vec<MatchRecordDTO>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub scoreboard: Vec<ScoreboardEntryDTO>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub round_history: Vec<Vec<i32>>,
    }
}

payload! {
    /// player_disconnected.
    pub struct PlayerDisconnectedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub nickname: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        /// Unix milliseconds at which the absent seat's match is forfeited if
        /// they have not come back. Only a matchmade room sends one; absent
        /// means the seat is simply held.
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub forfeit_deadline: i64,
    }
}

payload! {
    /// player_reconnected, in two shapes. To the seat that came back: its room
    /// code, its seat (`player_id`), a fresh token (the reclaim spent the old
    /// one) and the whole `state`. To everybody else: the seat
    /// (`player_index`) and its nickname. Both carry the roster.
    pub struct PlayerReconnectedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub session_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub state: Option<GameStateDTO>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub nickname: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
    }
}

payload! {
    /// lobby_config_changed.
    pub struct LobbyConfigChangedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub match_format: Option<MatchFormat>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub max_players: i32,
    }
}

payload! {
    /// streamer_mode_changed. Absent can only mean off: the message always
    /// carries the whole state of the setting, never an increment.
    pub struct StreamerModeChangedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub streamer_mode: bool,
    }
}

payload! {
    /// game_started hands every seat its dealt state. A solo table's copy also
    /// carries `room_code`, `player_id` and `session_token`: that mode has no
    /// message before this one, and a client still needs those three to
    /// reclaim the seat after a reload.
    pub struct GameStartedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub state: Option<GameStateDTO>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub session_token: String,
    }
}

payload! {
    /// match_found seats both players at once: everything room_joined carries,
    /// plus `starts_in_ms`, after which the match deals itself.
    pub struct MatchFoundMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub session_token: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub match_format: Option<MatchFormat>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub max_players: i32,
        /// How long the reveal lasts. Absent means "immediately": the countdown
        /// is presentation, and game_started arriving is what opens the match.
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub starts_in_ms: i64,
    }
}

payload! {
    /// host_changed, sent per recipient: the swap moves two seats, so half the
    /// room's own `player_id` changes with it. `nickname` names the new host.
    pub struct HostChangedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub nickname: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
    }
}

payload! {
    /// match_loading: the seats whose client has the map decoded. Absent means
    /// none yet: the field rides no other message.
    pub struct MatchLoadingMsg {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players_ready: Vec<i32>,
    }
}

payload! {
    /// match_ready releases the table: the clock starts here, not at
    /// game_started.
    pub struct MatchReadyMsg {
        pub turn: i32,
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub turn_deadline: i64,
        /// The deal's interrupt window.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub interrupt_open: Option<bool>,
    }
    owns(turn)
}

payload! {
    /// game_state: a mid-game authoritative snapshot, personalised.
    pub struct GameStateMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub state: Option<GameStateDTO>,
    }
}

payload! {
    /// card_played: the top discard and the turn state after it resolved.
    pub struct CardPlayedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub card: Option<CardDTO>,
        /// The authoritative active colour after the play.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub active_color: Option<CardColor>,
        /// Set only when a Swap resolves: the seat whose hand was exchanged
        /// with the actor's.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub chosen_player: Option<i32>,
        /// Always written: seat 0 is a turn like any other.
        pub turn: i32,
        /// Play direction after the card's effect (1 clockwise, -1 counter).
        #[serde(default, skip_serializing_if = "is_default")]
        pub direction: i32,
        /// Unix milliseconds when the turn expires (absent = no timer).
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub turn_deadline: i64,
        /// Whether a twin of the top discard may still be slammed onto it.
        /// Absent means unchanged; false is the answer that matters.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub interrupt_open: Option<bool>,
        /// Every seat that owes the table a declaration once this play has
        /// resolved, with the instant each window shuts. The server decides it,
        /// so the server sends it: the client renders the list and never
        /// re-derives it.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub catch_seats: Vec<CatchSeatDTO>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub pending_draw: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub has_drawn: Option<bool>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
    }
    owns(turn)
}

payload! {
    /// card_drawn. The drawing player is sent the `cards`; everybody else the
    /// `drawn_count`.
    pub struct CardDrawnMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub cards: Vec<CardDTO>,
        /// Always written: a draw against exhausted piles hands over nothing,
        /// and an absent count would read as one.
        pub drawn_count: i32,
        pub turn: i32,
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub turn_deadline: i64,
        /// The seat at turn drawing shuts the window; a penalty growing a hand
        /// does not. Absent means unchanged.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub interrupt_open: Option<bool>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub pending_draw: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub has_drawn: Option<bool>,
    }
    owns(turn, drawn_count)
}

payload! {
    /// turn_changed: a pass, a timeout or a retirement moved the turn without
    /// a card landing.
    pub struct TurnChangedMsg {
        pub turn: i32,
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub turn_deadline: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub interrupt_open: Option<bool>,
    }
    owns(turn)
}

payload! {
    /// uno_declared, uno_caught and catch_failed: the seat the message is
    /// about.
    pub struct SeatMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
    }
}

payload! {
    /// catch_locked says when this seat's Contre-LOCO! becomes pressable again
    /// after a call that found nobody, and is sent to that seat alone, on every
    /// press made inside the lockout.
    pub struct CatchLockedMsg {
        /// Unix milliseconds, absolute on the server's clock. Absent means the
        /// seat is not locked.
        #[serde(default, skip_serializing_if = "is_default")]
        #[ts(type = "number")]
        pub catch_locked_until: i64,
    }
}

payload! {
    /// interrupt_success, sent immediately before the resulting card_played so
    /// the steal can be presented on its own.
    pub struct InterruptSuccessMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub cards: Vec<CardDTO>,
    }
}

payload! {
    /// round_end.
    pub struct RoundEndMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub round_number: i32,
        #[serde(default, skip_serializing_if = "is_default")]
        pub round_winner: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub scoreboard: Vec<ScoreboardEntryDTO>,
        /// `round_history[k][playerIndex]` = points scored in round k+1.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub round_history: Vec<Vec<i32>>,
    }
}

payload! {
    /// match_end.
    pub struct MatchEndMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub match_winner: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub scoreboard: Vec<ScoreboardEntryDTO>,
        /// Every match this table has finished, oldest first, the one just
        /// ended included.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub match_history: Vec<MatchRecordDTO>,
        /// This match ended because somebody stopped being there, not because
        /// a round was won. `player_index` names the seat that left.
        #[serde(default, skip_serializing_if = "is_default")]
        pub forfeit: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
    }
}

payload! {
    /// latency: every seat's measured round-trip time, broadcast on a timer to
    /// tables that are playing.
    pub struct LatencyMsg {
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub latencies: Vec<LatencyEntryDTO>,
    }
}

payload! {
    /// emote: one seat saying one of the three things. Shown for a few
    /// seconds and forgotten.
    pub struct EmoteMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub emote: Option<Emote>,
    }
}

payload! {
    /// rematch_offered: every seat that has asked for another match, and how
    /// many asks it takes. The whole state travels rather than the increment,
    /// because a departure retires its offer and re-bases the rest.
    /// `player_index` names whoever just asked, and is absent when the change
    /// was a departure.
    pub struct RematchOfferedMsg {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_index: Option<i32>,
        /// Present even when empty: "nobody is asking any more" is an answer.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub rematch_offers: Option<Vec<i32>>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub rematch_needed: i32,
    }
}

payload! {
    /// rematch_started, sent per recipient because pruning absent players can
    /// shift seats.
    pub struct RematchStartedMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub room_code: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub player_id: Option<i32>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pub players: Vec<PlayerDTO>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub match_format: Option<MatchFormat>,
        #[serde(default, skip_serializing_if = "is_default")]
        pub max_players: i32,
    }
}

payload! {
    /// players_online: how many sockets this server is holding, sent to the
    /// ones not sitting at a table. Not the matchmaking queue, whose size is
    /// never on the wire.
    pub struct PlayersOnlineMsg {
        /// Present even at zero: the number that most has to reach the home
        /// screen is the one that has just dropped.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub players_online: Option<i32>,
    }
}

payload! {
    /// live_streams: who is streaming this game, biggest first, sent only to
    /// sockets not sitting at a table.
    pub struct LiveStreamsMsg {
        /// Present even when empty: "nobody is live any more" is an answer.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        pub live_streams: Option<Vec<LiveStreamDTO>>,
    }
}

payload! {
    /// error: a refusal, in the server's own words. The client never shows
    /// them as they are (`i18n/serverErrors.ts`).
    pub struct ErrorMsg {
        #[serde(default, skip_serializing_if = "is_default")]
        pub error: String,
    }
}
