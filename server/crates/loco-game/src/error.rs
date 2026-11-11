//! Every refusal the domain can give, with Go's exact wording.
//!
//! The text of each variant is the string the Go server put on the wire, byte
//! for byte: the client maps refusals to copy by regex
//! (`client/src/i18n/serverErrors.ts`), so a reworded message is a refusal the
//! player reads as raw English. Where Go wrapped a sentinel to give it a kind
//! (`staleState`, `errors.Is`), each refusal has one [`ErrorKind`] here.

use crate::Seat;
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
    InvalidTarget(Seat),
    /// Go: `fmt.Errorf("invalid catcher %d")`.
    #[error("invalid catcher {0}")]
    InvalidCatcher(Seat),
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
    #[error("invalid chosen_player {} for swap", go_seat(.0))]
    InvalidSwapTarget(Option<Seat>),
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
    RoomFull(usize),
    /// Go: `fmt.Errorf("nickname %q already taken")`.
    #[error("nickname {} already taken", go_quote(.0))]
    NicknameTaken(String),
    /// Go: `"game already started"`.
    #[error("game already started")]
    GameAlreadyStarted,
    /// Go: `fmt.Errorf("need at least %d players to start")`.
    #[error("need at least {0} players to start")]
    NotEnoughPlayers(usize),
    /// Go: `"cannot change format after game starts"`.
    #[error("cannot change format after game starts")]
    FormatLocked,
    /// Go: `fmt.Errorf("invalid match format: %d")`.
    #[error("invalid match format: {0}")]
    InvalidMatchFormat(i64),
    /// Go: `"cannot change max players after game starts"`.
    #[error("cannot change max players after game starts")]
    MaxPlayersLocked,
    /// Go: `fmt.Errorf("max players cannot be less than %d")`.
    #[error("max players cannot be less than {0}")]
    MaxPlayersTooLow(usize),
    /// Go: `fmt.Errorf("max players cannot exceed %d")`.
    #[error("max players cannot exceed {0}")]
    MaxPlayersTooHigh(usize),
    /// Go: `fmt.Errorf("cannot set max players to %d: %d players already in room")`.
    #[error("cannot set max players to {n}: {seated} players already in room")]
    MaxPlayersBelowRoster { n: usize, seated: usize },
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
    InvalidPlayerIndex(Seat),

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
}

/// What a refusal says about the client that sent it. Go answered these with
/// four `errors.Is` predicates over wrapped sentinels; here a refusal has
/// exactly one kind and the hub matches on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// The client acted on a board the server no longer has: worth answering
    /// with a fresh snapshot (Go: `IsStateMismatch`).
    StaleState,
    /// What a correct client produces all match long by pressing the right
    /// button at the wrong millisecond: never suspicious (Go: `IsLostRace`).
    LostRace,
    /// A Contre-LOCO! that came too late or found the hand already moved: a
    /// wager lost, charged a card, and a lost race too (Go: `IsMissedCatch`).
    MissedCatch,
    /// A nickname refused; the wire says only [`NICKNAME_REJECTED`].
    NicknameRejected,
    /// Anything else: a message a correct client does not compose.
    Invalid,
}

impl ErrorKind {
    /// Whether an honest client produces this in ordinary play, so the hub
    /// must not count it as suspicious (Go: `IsLostRace`, which also covered
    /// the one missed catch it could be handed).
    pub const fn is_honest(self) -> bool {
        matches!(self, ErrorKind::LostRace | ErrorKind::MissedCatch)
    }
}

impl GameError {
    /// The refusal's kind.
    pub const fn kind(&self) -> ErrorKind {
        use GameError as E;
        match self {
            E::NotYourTurn
            | E::IllegalPlay
            | E::CardNotInHand
            | E::MustAnswerPenalty
            | E::NotEnoughCopies { .. } => ErrorKind::StaleState,
            E::AlreadyDrawn
            | E::MustDrawBeforePass
            | E::InterruptWindowClosed
            | E::InterruptMismatch
            | E::InterruptNotADrawCard
            | E::CatchLocked
            | E::MustDeclareLoco => ErrorKind::LostRace,
            E::AlreadyDeclared | E::CatchWindowExpired | E::TargetNotSingleCard => {
                ErrorKind::MissedCatch
            }
            E::NicknameLength | E::NicknameCharset | E::NicknameBlocked => {
                ErrorKind::NicknameRejected
            }
            _ => ErrorKind::Invalid,
        }
    }
}

/// A seat as Go printed it with `%d`: -1 for nobody.
struct GoSeat(Option<Seat>);

impl fmt::Display for GoSeat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(s) => write!(f, "{s}"),
            None => f.write_str("-1"),
        }
    }
}

fn go_seat(s: &Option<Seat>) -> GoSeat {
    GoSeat(*s)
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
