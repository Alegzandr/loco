//! Every refusal the domain can give, with Go's exact wording.
//!
//! The text of each variant is the string the Go server put on the wire, byte
//! for byte: the client maps refusals to copy by regex
//! (`client/src/i18n/serverErrors.ts`), so a reworded message is a refusal the
//! player reads as raw English. Where Go wrapped a sentinel to give it a kind
//! (`staleState`, `errors.Is`), the kind is a method here: [`GameError::is_state_mismatch`],
//! [`GameError::is_lost_race`], [`GameError::is_missed_catch`],
//! [`GameError::is_nickname_rejected`].

use std::fmt;

/// The one nickname refusal that reaches a player (Go: `ErrNicknameRejected`).
pub const NICKNAME_REJECTED: &str = "nickname not allowed";

/// A refused action. Nothing was changed by it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GameError {
    // --- The four refusals a correct client cannot produce (Go: stale(...)) ---
    /// Go: `ErrNotYourTurn` — the seat moved on between the tap and the message.
    #[error("not your turn")]
    NotYourTurn,
    /// Go: `ErrIllegalPlay` — the card matches neither the top nor the colour.
    #[error("illegal card play")]
    IllegalPlay,
    /// Go: `ErrCardNotInHand` — the hand the client plays from is not ours.
    #[error("card not in hand")]
    CardNotInHand,
    /// Go: `ErrMustAnswerPenalty` — a play arrived under a pending draw stack.
    #[error("must counter or draw pending penalty cards first")]
    MustAnswerPenalty,
    /// Go: `stale(fmt.Errorf("hand has %d copies, need %d"))` — a batch longer
    /// than the copies held.
    #[error("hand has {have} copies, need {need}")]
    NotEnoughCopies { have: usize, need: usize },

    // --- LOCO! ---
    /// Go: `ErrMustDeclareLoco`.
    #[error("must call LOCO! before playing your last card")]
    MustDeclareLoco,
    /// Go: `"can only declare with exactly 1 card in hand"`.
    #[error("can only declare with exactly 1 card in hand")]
    DeclareNeedsOneCard,

    // --- The catch ---
    /// Go: `ErrAlreadyDeclared` — the target's LOCO! reached the server first.
    #[error("player already declared")]
    AlreadyDeclared,
    /// Go: `ErrCatchWindowExpired` — the 5s window closed before the message.
    #[error("catch window expired")]
    CatchWindowExpired,
    /// Go: `ErrTargetNotSingleCard` — the target's hand grew in between.
    #[error("target does not have exactly 1 card")]
    TargetNotSingleCard,
    /// Go: `ErrNoCatchWindow` — the target was never on the hook.
    #[error("target did not just play their last card")]
    NoCatchWindow,
    /// Go: `ErrCatchLocked` — the caller is inside its own lockout.
    #[error("catch is locked after a failed call")]
    CatchLocked,
    /// Go: `fmt.Errorf("invalid target %d")`.
    #[error("invalid target {0}")]
    InvalidTarget(i32),
    /// Go: `fmt.Errorf("invalid catcher %d")`.
    #[error("invalid catcher {0}")]
    InvalidCatcher(i32),
    /// Go: `"cannot catch yourself"`.
    #[error("cannot catch yourself")]
    CannotCatchYourself,

    // --- Draw and pass ---
    /// Go: `ErrAlreadyDrawn`.
    #[error("you have already drawn this turn")]
    AlreadyDrawn,
    /// Go: `ErrMustDrawBeforePass`.
    #[error("you must draw a card before passing")]
    MustDrawBeforePass,

    // --- Interrupts ---
    /// Go: `ErrInterruptWindowClosed`.
    #[error("interrupt window closed")]
    InterruptWindowClosed,
    /// Go: `ErrInterruptMismatch` — losing an interrupt race *is* this.
    #[error("interrupt card must exactly match the top discard card")]
    InterruptMismatch,
    /// Go: `ErrInterruptNotADrawCard`.
    #[error("cannot interrupt active draw chain except with an identical draw card")]
    InterruptNotADrawCard,
    /// Go: `ErrInterruptBatch` — an interject is one card.
    #[error("an interject is one card")]
    InterruptBatch,

    // --- Plays ---
    /// Go: `"game not in progress"`.
    #[error("game not in progress")]
    GameNotInProgress,
    /// Go: `"must choose a color for a wild card"`.
    #[error("must choose a color for a wild card")]
    MustChooseColor,
    /// Go: `fmt.Errorf("invalid chosen_player %d for swap")`.
    #[error("invalid chosen_player {0} for swap")]
    InvalidSwapTarget(i32),
    /// Go: `"cannot swap with yourself"`.
    #[error("cannot swap with yourself")]
    CannotSwapWithYourself,
    /// Go: `"that seat has left the match"` — a Swap aimed at a retired seat.
    #[error("that seat has left the match")]
    SeatHasLeft,
    /// Go: `"no cards specified"`.
    #[error("no cards specified")]
    NoCardsSpecified,
    /// Go: `"batch cards must be identical"`.
    #[error("batch cards must be identical")]
    BatchNotIdentical,
    /// Go: `"Swap and GlobalSwitch cannot be batch-played"`.
    #[error("Swap and GlobalSwitch cannot be batch-played")]
    BatchOfRearrangers,
    /// Go: `"no pending draw to counter"`.
    #[error("no pending draw to counter")]
    NoPendingDraw,
    /// Go: `"no draw card to counter"`.
    #[error("no draw card to counter")]
    NoDrawCardToCounter,
    /// Go: `"counter card must match kind of draw card"`.
    #[error("counter card must match kind of draw card")]
    CounterKindMismatch,
    /// Go: `"counter card must match color of draw card"`.
    #[error("counter card must match color of draw card")]
    CounterColorMismatch,

    // --- Lobby ---
    /// Go: `"game already in progress"` (Join).
    #[error("game already in progress")]
    GameAlreadyInProgress,
    /// Go: `fmt.Errorf("room is full (max %d players)")`.
    #[error("room is full (max {0} players)")]
    RoomFull(i32),
    /// Go: `fmt.Errorf("nickname %q already taken")`.
    #[error("nickname {} already taken", go_quote(.0))]
    NicknameTaken(String),
    /// Go: `"game already started"`.
    #[error("game already started")]
    GameAlreadyStarted,
    /// Go: `fmt.Errorf("need at least %d players to start")`.
    #[error("need at least {0} players to start")]
    NotEnoughPlayers(i32),
    /// Go: `"cannot change format after game starts"`.
    #[error("cannot change format after game starts")]
    FormatLocked,
    /// Go: `fmt.Errorf("invalid match format: %d")`.
    #[error("invalid match format: {0}")]
    InvalidMatchFormat(i32),
    /// Go: `"cannot change max players after game starts"`.
    #[error("cannot change max players after game starts")]
    MaxPlayersLocked,
    /// Go: `fmt.Errorf("max players cannot be less than %d")`.
    #[error("max players cannot be less than {0}")]
    MaxPlayersTooLow(i32),
    /// Go: `fmt.Errorf("max players cannot exceed %d")`.
    #[error("max players cannot exceed {0}")]
    MaxPlayersTooHigh(i32),
    /// Go: `fmt.Errorf("cannot set max players to %d: %d players already in room")`.
    #[error("cannot set max players to {n}: {seated} players already in room")]
    MaxPlayersBelowRoster { n: i32, seated: usize },
    /// Go: `"can only reorder seats in the lobby"`.
    #[error("can only reorder seats in the lobby")]
    ReorderOnlyInLobby,
    /// Go: `fmt.Errorf("invalid player index")` (SwapLobbyPlayers, no number).
    #[error("invalid player index")]
    InvalidSeatPair,
    /// Go: `"can only remove players in the lobby"`.
    #[error("can only remove players in the lobby")]
    RemoveOnlyInLobby,
    /// Go: `fmt.Errorf("invalid player index %d")`.
    #[error("invalid player index {0}")]
    InvalidPlayerIndex(i32),

    // --- Match lifecycle ---
    /// Go: `"forfeit is only possible during a match"`.
    #[error("forfeit is only possible during a match")]
    ForfeitNotPlaying,
    /// Go: `ErrSeatAlreadyRetired`.
    #[error("that seat has already left the match")]
    SeatAlreadyRetired,
    /// Go: `"BeginNextRound called after match over"`.
    #[error("BeginNextRound called after match over")]
    NextRoundAfterMatchOver,
    /// Go: `"BeginNextRound called when game not in progress"`.
    #[error("BeginNextRound called when game not in progress")]
    NextRoundNotPlaying,
    /// Go: `"rematch is only available once the match is over"`.
    #[error("rematch is only available once the match is over")]
    RematchUnavailable,

    // --- Nicknames: all three reach the player as NICKNAME_REJECTED ---
    /// Go: `ErrNicknameLength`.
    #[error("nickname not allowed (length)")]
    NicknameLength,
    /// Go: `ErrNicknameCharset`.
    #[error("nickname not allowed (charset)")]
    NicknameCharset,
    /// Go: `ErrNicknameBlocked`.
    #[error("nickname not allowed (blocked term)")]
    NicknameBlocked,

    // --- Rust only ---
    /// A room restored from a snapshot has no source of randomness until the
    /// hub reseeds it (`Room::reseed`): Go's `ensureRNG` read the OS on the
    /// spot, which a pure crate cannot do. `Room::apply` refuses rather than
    /// deal off a source nobody chose.
    #[error("room has no source of randomness: reseed it after a restore")]
    Unseeded,
}

impl GameError {
    /// Whether the refusal proves the client's board had drifted from the
    /// server's, i.e. whether it is worth re-sending the state. (Go:
    /// `IsStateMismatch`.)
    pub const fn is_state_mismatch(&self) -> bool {
        matches!(
            self,
            GameError::NotYourTurn
                | GameError::IllegalPlay
                | GameError::CardNotInHand
                | GameError::MustAnswerPenalty
                | GameError::NotEnoughCopies { .. }
        )
    }

    /// Whether the refusal is one this game produces against correct clients
    /// all match long, rather than a sign of a tampered one. (Go: `IsLostRace`.)
    pub const fn is_lost_race(&self) -> bool {
        matches!(
            self,
            GameError::AlreadyDrawn
                | GameError::MustDrawBeforePass
                | GameError::InterruptWindowClosed
                | GameError::InterruptMismatch
                | GameError::InterruptNotADrawCard
                | GameError::AlreadyDeclared
                | GameError::CatchLocked
                | GameError::MustDeclareLoco
        )
    }

    /// Whether a catch refusal is a lost race — the only class of rejection
    /// that costs the caller a card. (Go: `IsMissedCatch`.)
    pub const fn is_missed_catch(&self) -> bool {
        matches!(
            self,
            GameError::AlreadyDeclared
                | GameError::CatchWindowExpired
                | GameError::TargetNotSingleCard
        )
    }

    /// Whether this is a nickname refusal, which the hub sends as
    /// [`NICKNAME_REJECTED`] and nothing more specific. (Go:
    /// `errors.Is(err, ErrNicknameRejected)`.)
    pub const fn is_nickname_rejected(&self) -> bool {
        matches!(
            self,
            GameError::NicknameLength | GameError::NicknameCharset | GameError::NicknameBlocked
        )
    }
}

/// Free-function forms, for call sites ported from Go.
pub fn is_state_mismatch(err: &GameError) -> bool {
    err.is_state_mismatch()
}
/// See [`GameError::is_lost_race`].
pub fn is_lost_race(err: &GameError) -> bool {
    err.is_lost_race()
}
/// See [`GameError::is_missed_catch`].
pub fn is_missed_catch(err: &GameError) -> bool {
    err.is_missed_catch()
}

/// Go's `%q` for the strings this crate quotes: double quotes, with `"`, `\`
/// and control characters escaped.
struct GoQuoted<'a>(&'a str);

impl fmt::Display for GoQuoted<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("\"")?;
        for c in self.0.chars() {
            match c {
                '"' => f.write_str("\\\"")?,
                '\\' => f.write_str("\\\\")?,
                '\n' => f.write_str("\\n")?,
                '\r' => f.write_str("\\r")?,
                '\t' => f.write_str("\\t")?,
                c if (c as u32) < 0x20 || c as u32 == 0x7f => write!(f, "\\x{:02x}", c as u32)?,
                c => write!(f, "{c}")?,
            }
        }
        f.write_str("\"")
    }
}

fn go_quote(s: &str) -> GoQuoted<'_> {
    GoQuoted(s)
}
