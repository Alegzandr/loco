//! Every refusal the hub answers with, in one place.
//!
//! The strings are the wire: the client maps each one in
//! `client/src/i18n/serverErrors.ts` (a refused action never shows a wire
//! string), so they are Go's byte for byte and a new one is added there in the
//! same change. A domain refusal travels as its `GameError` (whose `Display`
//! is Go's text too); the few refusals built from a value (`debug.hands:
//! invalid player_index 3`, a batch longer than the hand) are `Other`.

/// A refusal sent to the one socket that asked. Never broadcast.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    /// A table's box or the hub's queue was full: one table is behind.
    #[error("server busy, please retry")]
    ServerBusy,
    #[error("already in a room")]
    AlreadyInRoom,
    /// `Limits::max_rooms` reached.
    #[error("the server is full, try again in a moment")]
    ServerFull,
    /// A handler panicked; the job's `catch_unwind` answers with this.
    #[error("server error")]
    ServerError,
    #[error("room not found")]
    RoomNotFound,
    #[error("not in a room")]
    NotInRoom,
    /// A host control at a table with no host (matchmade, solo).
    #[error("not available in this game")]
    Hostless,
    #[error("invalid player index")]
    InvalidPlayerIndex,
    /// The gameplay gate: no deal, or a seat the deal has no hand for.
    #[error("game not in progress")]
    GameNotInProgress,
    #[error("debug_set_state requires an active game")]
    DebugNeedsActiveGame,
    /// `debug_set_state` without `LOCO_E2E=1`.
    #[error("debug commands are not enabled")]
    DebugDisabled,
    #[error("card required")]
    CardRequired,
    #[error("your opponent has left the table")]
    OpponentLeft,
    /// The map-loading gate is shut.
    #[error("waiting for every player to load the table")]
    TableLoading,
    #[error("unknown message type")]
    UnknownMessageType,
    #[error("unknown emote")]
    UnknownEmote,
    /// The network's wrong-code budget is spent.
    #[error("too many attempts, wait a moment")]
    TooManyAttempts,
    #[error("rematch is only available once the match is over")]
    RematchUnavailable,
    /// Told once a second to a socket over its token bucket.
    #[error("rate limit exceeded")]
    RateLimited,
    #[error("only the room owner can start the game")]
    OwnerOnlyStart,
    #[error("only the room owner can remove players")]
    OwnerOnlyKick,
    #[error("only the room owner can hand over the table")]
    OwnerOnlyTransfer,
    #[error("only the room owner can add bots")]
    OwnerOnlyBots,
    #[error("only the host can change streamer mode")]
    HostOnlyStreamerMode,
    #[error("only the host can change max players")]
    HostOnlyMaxPlayers,
    #[error("only the host can change match format")]
    HostOnlyFormat,
    #[error("invalid room code")]
    InvalidRoomCode,
    /// A join at a table that has dealt, with no valid reclaim: one string either way, or it would name the roster.
    #[error("game already in progress")]
    GameAlreadyInProgress,
    #[error("emotes are only for the end of a match")]
    EmotesAtEndOnly,
    #[error("can only remove players in the lobby")]
    KickLobbyOnly,
    #[error("can only hand over the table in the lobby")]
    TransferLobbyOnly,
    #[error("can only add bots in the lobby")]
    BotsLobbyOnly,
    #[error("already searching for an opponent")]
    AlreadySearching,
    #[error("a bot cannot host the table")]
    BotCannotHost,
    /// Every action that would extend a drain. The client maps it in `i18n/serverErrors.ts`.
    #[error("server updating, try again in a moment")]
    Draining,
    /// Every nickname rule, never saying which fired.
    #[error("nickname not allowed")]
    NicknameRejected,
    /// A domain refusal, in the domain's words.
    #[error(transparent)]
    Game(#[from] loco_game::GameError),
    /// A refusal built from a value.
    #[error("{0}")]
    Other(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    // The strings are the wire: a few pinned here, the rest by the socket tests.
    #[test]
    fn the_refusals_keep_go_s_words() {
        assert_eq!(Refusal::Draining.to_string(), crate::DRAIN_REFUSAL);
        assert_eq!(
            Refusal::NicknameRejected.to_string(),
            loco_game::error::NICKNAME_REJECTED
        );
        assert_eq!(Refusal::ServerBusy.to_string(), "server busy, please retry");
        assert_eq!(
            Refusal::from(loco_game::GameError::NotYourTurn).to_string(),
            "not your turn"
        );
    }
}
