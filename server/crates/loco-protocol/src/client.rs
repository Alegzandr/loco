//! Everything a client can send.
//!
//! One variant per message type, each carrying the fields its handler reads
//! and nothing else. Any field is accepted on any message and ignored where it
//! means nothing: serde ignores unknown fields, so a client sending a stray
//! field is answered as if it had not.
//!
//! The defaults are lenient: a missing nickname reads as an empty
//! one (and is refused by the nickname rules, not by the decoder), a missing
//! card as none (refused with "card required"), a missing seat as none.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dto::{CardDTO, DebugStateDTO};
use crate::enums::{CardColor, Emote, MatchFormat};
use crate::is_default;

/// A client-to-server message. Tagged by `type` on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS, JsonSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    // --- Lobby ---
    CreateRoom(NicknameMsg),
    JoinRoom(JoinRoomMsg),
    StartGame,
    AddBot,
    SetMatchFormat(SetMatchFormatMsg),
    SetMaxPlayers(SetMaxPlayersMsg),
    /// The host saying the table code must not be readable on anybody's
    /// screen, because it is on theirs and theirs is being captured. The one
    /// preference in this game that is not purely local.
    SetStreamerMode(SetStreamerModeMsg),
    /// Frees a seat at the host's table, named by `target_index`. The only
    /// lobby control that acts on somebody else, and the only way to take a
    /// bot's seat back. Lobby only.
    KickPlayer(TargetMsg),
    /// Hands the table to the seat named by `target_index`. The host is seat 0
    /// and nothing else, so this is a seat swap. Lobby only, never to a bot.
    TransferHost(TargetMsg),
    /// Asks for another match at a finished table.
    Rematch,
    /// Says one of three fixed things, on the game-over screen and nowhere
    /// else. The set is closed: a client cannot invent a fourth, and there is
    /// no free text anywhere in this game.
    SendEmote(SendEmoteMsg),
    // --- Matchmaking: a 1v1 against whoever is looking for the same thing ---
    FindMatch(NicknameMsg),
    CancelMatchmaking,
    /// Deals a 1v1 against the server, immediately: the queue's shape without
    /// the queue.
    PlayBot(NicknameMsg),
    /// Gives up the seat this socket holds without dropping the connection. In
    /// a matchmade match in progress it is a deliberate forfeit.
    LeaveRoom,
    // --- Gameplay ---
    PlayCard(PlayCardMsg),
    DrawCard,
    PassTurn,
    DeclareUno,
    CatchUno(TargetMsg),
    CounterDraw(CounterDrawMsg),
    /// This client has the match's map decoded and is ready to play. Sent once
    /// per match, in answer to match_loading.
    MapReady,
    /// The realtime jump-in: one card matching the top discard, out of turn.
    /// A batch is refused (an interject is one card).
    InterruptPlay(InterruptPlayMsg),
    /// An alias of `interrupt_play`, answered by the same handler. It is the
    /// spelling the client sends.
    InterruptPlayCard(InterruptPlayMsg),
    /// Dev / E2E only: refused unless the server runs with `LOCO_E2E=1`.
    DebugSetState(DebugSetStateMsg),
}

/// create_room, find_match and play_bot: who is asking.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct NicknameMsg {
    #[serde(default, skip_serializing_if = "is_default")]
    pub nickname: String,
}

/// join_room: a table code, and on a reclaim the token that proves the seat.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct JoinRoomMsg {
    #[serde(default, skip_serializing_if = "is_default")]
    pub nickname: String,
    #[serde(default, skip_serializing_if = "is_default")]
    pub room_code: String,
    /// Proves identity on a reconnect.
    #[serde(default, skip_serializing_if = "is_default")]
    pub session_token: String,
}

/// set_match_format.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct SetMatchFormatMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub match_format: Option<MatchFormat>,
}

/// set_max_players.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct SetMaxPlayersMsg {
    #[serde(default, skip_serializing_if = "is_default")]
    pub max_players: i32,
}

/// set_streamer_mode: the state the host is asking for, not a toggle. A toggle
/// would come back wrong from a client whose picture of the table is a
/// message behind. Absent and false mean the same thing here: off.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct SetStreamerModeMsg {
    #[serde(default, skip_serializing_if = "is_default")]
    pub streamer_mode: bool,
}

/// kick_player, transfer_host and catch_uno: the seat acted on.
///
/// Required by kick_player and transfer_host, which have no sensible default
/// seat. Optional on catch_uno, where several players can owe a declaration at
/// once and an omitted target means the window closest to expiring.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct TargetMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target_index: Option<i32>,
}

/// send_emote: which of the three.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct SendEmoteMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub emote: Option<Emote>,
}

/// play_card: one card, or a batch of identical ones.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct PlayCardMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card: Option<CardDTO>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_color: Option<CardColor>,
    /// The target seat of a Swap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_player: Option<i32>,
    /// Several identical cards at once. When non-empty it takes precedence
    /// over `card`. Swap and GlobalSwitch cannot be batch-played.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub play_cards: Vec<CardDTO>,
    /// The LOCO! call the play carries. Only read when a turn batch empties
    /// the hand, the one finish the player had no chance to announce
    /// beforehand: identical cards put down at once never pass through one
    /// card. The server refuses such a batch without it.
    #[serde(default, skip_serializing_if = "is_default")]
    pub declare_loco: bool,
}

/// counter_draw: the card answering a draw stack, same kind and colour.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct CounterDrawMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card: Option<CardDTO>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_color: Option<CardColor>,
}

/// interrupt_play and interrupt_play_card.
///
/// `play_cards` is read so that a batch can be refused rather than assumed of
/// the client: an interject is one card. There is no `declare_loco`: a finish
/// out of turn comes off a hand that has been sitting at one card, catchable.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct InterruptPlayMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub card: Option<CardDTO>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_color: Option<CardColor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub chosen_player: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub play_cards: Vec<CardDTO>,
}

/// debug_set_state: the fixture, nested so it reads as what it is.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS, JsonSchema)]
pub struct DebugSetStateMsg {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub debug: Option<DebugStateDTO>,
}
