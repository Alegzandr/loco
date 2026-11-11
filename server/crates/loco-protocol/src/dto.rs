//! The records the messages carry.
//!
//! The omission rules are the Go server's, mechanically: a field Go tagged
//! `omitempty` is `#[serde(default, skip_serializing_if = ...)]` here and
//! optional in TypeScript; a Go pointer is an `Option` and optional; anything
//! else is always written, zero included, and required.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::enums::{CardColor, CardKind, MatchFormat};
use crate::is_default;

/// The wire representation of a card.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct CardDTO {
    pub color: CardColor,
    pub kind: CardKind,
    #[serde(default, skip_serializing_if = "is_default")]
    pub value: i32,
}

/// Names a seat that owes the table a declaration, and says when its window
/// shuts. `ends_at` is unix milliseconds, like every other deadline on the
/// wire, so a client renders a countdown against its own clock rather than
/// holding a copy of the server's window length.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct CatchSeatDTO {
    pub player_index: i32,
    #[ts(type = "number")]
    pub ends_at: i64,
}

/// One player's match-level score summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct ScoreboardEntryDTO {
    pub player_index: i32,
    pub nickname: String,
    pub score: i32,
    pub rounds_won: i32,
}

/// One finished match at this table, kept so a group playing six in a row can
/// see who actually won the evening.
///
/// Both halves travel because both are read: `rounds_won` is what decided that
/// match, `scores` is the gap it was decided by. Indexed by seat, exactly like
/// the scoreboard, so a client renders one column per match against the roster
/// it already has.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct MatchRecordDTO {
    pub rounds_won: Vec<i32>,
    pub scores: Vec<i32>,
    /// The seat that took the match, or -1 when the seat that took it has since
    /// left the table. Always written: seat 0 is a winner like any other, and
    /// dropping it would hand the match to nobody.
    pub winner_index: i32,
    /// How long the match was played, from the moment the turn clock started
    /// (match_ready, not the deal: the map-loading gate is a wait, not the
    /// game) to the moment it ended. Absent when the server cannot say (a
    /// forfeit inside the loading gate, or a match restored from a snapshot an
    /// older process wrote) and never zero for a match that was played: a
    /// started match reports at least one millisecond.
    #[serde(default, skip_serializing_if = "is_default")]
    #[ts(type = "number")]
    pub duration_ms: i64,
}

/// One seat's measured round-trip time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct LatencyEntryDTO {
    pub player_index: i32,
    /// The smoothed WebSocket ping/pong round trip in milliseconds, or -1 when
    /// nothing has been measured yet (bots, a seat that just connected, a
    /// player inside their reconnect window).
    pub rtt_ms: i32,
    #[serde(default, skip_serializing_if = "is_default")]
    pub bot: bool,
}

/// The public view of a player.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct PlayerDTO {
    pub index: i32,
    pub nickname: String,
    pub hand_size: i32,
    pub connected: bool,
    /// Marks a seat the server plays. Carried because the roster offers
    /// controls a bot cannot answer (the table cannot be handed to one) and the
    /// nickname is not a way to tell: "Bot1" is a name a player is allowed to
    /// take.
    ///
    /// Omitted when false, unlike `connected`: absent and false are the same
    /// statement here, where an absent `connected` would be a player the roster
    /// stopped mentioning.
    #[serde(default, skip_serializing_if = "is_default")]
    pub is_bot: bool,
}

/// The wire representation of a game event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct GameEventDTO {
    /// A bare string, unlike `CardDTO.kind`: these are event kinds from the
    /// domain's own log, they are read only as labels, and a server that logs a
    /// new one must not make a generated client refuse the whole snapshot.
    pub kind: String,
    pub player_index: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card: Option<CardDTO>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_color: Option<CardColor>,
    /// Unix milliseconds.
    #[ts(type = "number")]
    pub at: i64,
}

/// The per-player view of the game state sent on join, start and correction.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct GameStateDTO {
    pub your_index: i32,
    pub hand: Vec<CardDTO>,
    pub players: Vec<PlayerDTO>,
    pub discard: CardDTO,
    pub active_color: CardColor,
    pub turn: i32,
    pub direction: i32,
    #[serde(default, skip_serializing_if = "is_default")]
    pub pending_draw: i32,
    #[serde(default, skip_serializing_if = "is_default")]
    pub has_drawn: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub event_log: Vec<GameEventDTO>,

    pub round_number: i32,
    pub match_format: MatchFormat,
    pub max_players: i32,
    /// Names the room this match is played in. Rides every snapshot rather
    /// than only game_started so a reconnecting player rebuilds the same table
    /// as everybody else. Empty = the built-in felt.
    #[serde(default, skip_serializing_if = "is_default")]
    pub map_id: String,
    /// The hour and the sky the match is dealt under, drawn beside `map_id`
    /// and travelling with it on every snapshot. Bare strings like `map_id`,
    /// for the same reason: a value this client does not know must degrade to
    /// a default sky, never drop the whole game_state.
    #[serde(default, skip_serializing_if = "is_default")]
    pub time_of_day: String,
    #[serde(default, skip_serializing_if = "is_default")]
    pub weather: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scoreboard: Vec<ScoreboardEntryDTO>,
    /// `round_history[k][playerIndex]` = points scored in round k+1. Included
    /// in every snapshot so a reconnecting player recovers the table.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub round_history: Vec<Vec<i32>>,
    /// The table's finished matches. Carried here too so a player who
    /// reconnects mid-match still has the evening behind them when this match
    /// ends.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub match_history: Vec<MatchRecordDTO>,

    /// Unix milliseconds when the current turn expires (absent = no timer).
    #[serde(default, skip_serializing_if = "is_default")]
    #[ts(type = "number")]
    pub turn_deadline: i64,

    /// Whether the top discard may still be slammed. A plain bool, unlike on
    /// the messages that carry it: a snapshot says the whole board, so omitted
    /// means shut, and the client reads it that way.
    #[serde(default, skip_serializing_if = "is_default")]
    pub interrupt_open: bool,

    /// Who owes the table a declaration right now, exactly as card_played
    /// carries it. A tab that reloads two seconds into a five-second window
    /// used to rebuild a board on which nobody was catchable.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub catch_seats: Vec<CatchSeatDTO>,
    /// Every seat whose single card has already been called. Without it a
    /// reload put the LOCO! button back in front of a player whose call was
    /// already spent.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub declared_seats: Vec<i32>,

    /// The recipient's own Contre-LOCO! lockout, personalised like the hand
    /// and absolute on the server's clock. Absent means not locked.
    #[serde(default, skip_serializing_if = "is_default")]
    #[ts(type = "number")]
    pub catch_locked_until: i64,

    /// The host's streamer mode, carried in every snapshot for the same reason
    /// `map_id` is: a tab that reloads mid-match rebuilds the table from this
    /// and nothing else.
    #[serde(default, skip_serializing_if = "is_default")]
    pub streamer_mode: bool,
}

/// One channel streaming this game, as this server saw it at the last poll.
///
/// Nothing in it is ours: the channel name is written by a stranger and shown
/// to players. Every row is screened server-side before it gets here and a
/// name that does not survive is dropped whole rather than masked.
///
/// There is deliberately no title field: a stream title is the largest piece
/// of unmoderated text this feature could put on the home screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct LiveStreamDTO {
    /// The channel's URL segment, and the only thing a client builds the
    /// outgoing link from. Guaranteed to match `^[A-Za-z0-9_]{1,25}$` by the
    /// screen, which is what makes the link safe to assemble without escaping.
    pub login: String,
    /// The display name. It differs from `login` by case, and entirely for a
    /// channel that is not written in Latin script.
    pub name: String,
    /// The BCP-47 tag Twitch announces. Presentation only.
    #[serde(default, skip_serializing_if = "is_default")]
    pub lang: String,
    /// What makes this list a ranking. Always written: zero viewers is a
    /// channel that is live.
    pub viewers: i32,
    /// A path on this origin (`/live-thumb/<key>`), never a Twitch URL. Empty
    /// when the picture could not be fetched: the row stays, without one.
    #[serde(default, skip_serializing_if = "is_default")]
    pub thumb: String,
}

/// The whole payload of debug_set_state. Any combination of fields may be
/// provided; omitted fields leave that part of the state alone.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct DebugStateDTO {
    /// Replace this player's hand.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hand: Vec<CardDTO>,
    /// Replace arbitrary players' hands.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hands: Vec<DebugHandOverrideDTO>,
    /// Replace the top of the discard pile.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub discard: Option<CardDTO>,
    /// Override the active colour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub active_color: Option<CardColor>,
    /// Override the pending draw count.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub pending_draw: Option<i32>,
    /// Override the current turn's player index.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub current_turn: Option<i32>,
    /// Override the play direction (1 clockwise, -1 counter-clockwise).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub direction: Option<i32>,
}

/// One per-player hand replacement used by debug_set_state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct DebugHandOverrideDTO {
    pub player_index: i32,
    pub hand: Vec<CardDTO>,
}
