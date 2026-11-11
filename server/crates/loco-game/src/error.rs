//! Every refusal the domain can give, worded as the wire carries it.
//!
//! The text of each variant is a wire contract, byte for byte: the client maps
//! refusals to copy by regex (`client/src/i18n/serverErrors.ts`), so a reworded
//! message is a refusal the player reads as raw English. Each refusal also has
//! exactly one [`ErrorKind`], which is what the hub decides on.

use crate::Seat;
use std::fmt;

/// The one nickname refusal that reaches a player.
pub const NICKNAME_REJECTED: &str = "nickname not allowed";

/// A refused action. Nothing was changed by it.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum GameError {
    // --- The refusals a correct client cannot produce: its board is stale ---
    /// The seat moved on between the tap and the message.
    #[error("not your turn")]
    NotYourTurn,
    /// The card matches neither the top nor the colour.
    #[error("illegal card play")]
    IllegalPlay,
    /// The hand the client plays from is not ours.
    #[error("card not in hand")]
    CardNotInHand,
    /// A play arrived under a pending draw stack.
    #[error("must counter or draw pending penalty cards first")]
    MustAnswerPenalty,
    /// A batch longer than the copies held.
    #[error("hand has {have} copies, need {need}")]
    NotEnoughCopies { have: usize, need: usize },

    // --- LOCO! ---
    #[error("must call LOCO! before playing your last card")]
    MustDeclareLoco,
    #[error("can only declare with exactly 1 card in hand")]
    DeclareNeedsOneCard,

    // --- The catch ---
    /// The target's LOCO! reached the server first.
    #[error("player already declared")]
    AlreadyDeclared,
    /// The 5s window closed before the message.
    #[error("catch window expired")]
    CatchWindowExpired,
    /// The target's hand grew in between.
    #[error("target does not have exactly 1 card")]
    TargetNotSingleCard,
    /// The target was never on the hook.
    #[error("target did not just play their last card")]
    NoCatchWindow,
    /// The caller is inside its own lockout.
    #[error("catch is locked after a failed call")]
    CatchLocked,
    #[error("invalid target {0}")]
    InvalidTarget(Seat),
    #[error("invalid catcher {0}")]
    InvalidCatcher(Seat),
    #[error("cannot catch yourself")]
    CannotCatchYourself,

    // --- Draw and pass ---
    #[error("you have already drawn this turn")]
    AlreadyDrawn,
    #[error("you must draw a card before passing")]
    MustDrawBeforePass,

    // --- Interrupts ---
    #[error("interrupt window closed")]
    InterruptWindowClosed,
    /// Losing an interrupt race *is* this.
    #[error("interrupt card must exactly match the top discard card")]
    InterruptMismatch,
    #[error("cannot interrupt active draw chain except with an identical draw card")]
    InterruptNotADrawCard,
    /// An interject is one card.
    #[error("an interject is one card")]
    InterruptBatch,

    // --- Plays ---
    #[error("game not in progress")]
    GameNotInProgress,
    #[error("must choose a color for a wild card")]
    MustChooseColor,
    #[error("invalid chosen_player {} for swap", signed_seat(.0))]
    InvalidSwapTarget(Option<Seat>),
    #[error("cannot swap with yourself")]
    CannotSwapWithYourself,
    /// A Swap aimed at a retired seat.
    #[error("that seat has left the match")]
    SeatHasLeft,
    #[error("no cards specified")]
    NoCardsSpecified,
    #[error("batch cards must be identical")]
    BatchNotIdentical,
    #[error("Swap and GlobalSwitch cannot be batch-played")]
    BatchOfRearrangers,
    #[error("no pending draw to counter")]
    NoPendingDraw,
    #[error("no draw card to counter")]
    NoDrawCardToCounter,
    #[error("counter card must match kind of draw card")]
    CounterKindMismatch,
    #[error("counter card must match color of draw card")]
    CounterColorMismatch,

    // --- Lobby ---
    #[error("game already in progress")]
    GameAlreadyInProgress,
    #[error("room is full (max {0} players)")]
    RoomFull(usize),
    #[error("nickname {} already taken", quoted(.0))]
    NicknameTaken(String),
    #[error("game already started")]
    GameAlreadyStarted,
    #[error("need at least {0} players to start")]
    NotEnoughPlayers(usize),
    #[error("cannot change format after game starts")]
    FormatLocked,
    #[error("invalid match format: {0}")]
    InvalidMatchFormat(i64),
    #[error("cannot change max players after game starts")]
    MaxPlayersLocked,
    #[error("max players cannot be less than {0}")]
    MaxPlayersTooLow(usize),
    #[error("max players cannot exceed {0}")]
    MaxPlayersTooHigh(usize),
    #[error("cannot set max players to {n}: {seated} players already in room")]
    MaxPlayersBelowRoster { n: usize, seated: usize },
    #[error("can only reorder seats in the lobby")]
    ReorderOnlyInLobby,
    #[error("invalid player index")]
    InvalidSeatPair,
    #[error("can only remove players in the lobby")]
    RemoveOnlyInLobby,
    #[error("invalid player index {0}")]
    InvalidPlayerIndex(Seat),

    // --- Match lifecycle ---
    #[error("forfeit is only possible during a match")]
    ForfeitNotPlaying,
    #[error("that seat has already left the match")]
    SeatAlreadyRetired,
    #[error("BeginNextRound called after match over")]
    NextRoundAfterMatchOver,
    #[error("BeginNextRound called when game not in progress")]
    NextRoundNotPlaying,
    #[error("rematch is only available once the match is over")]
    RematchUnavailable,

    // --- Nicknames: all three reach the player as NICKNAME_REJECTED ---
    #[error("nickname not allowed (length)")]
    NicknameLength,
    #[error("nickname not allowed (charset)")]
    NicknameCharset,
    #[error("nickname not allowed (blocked term)")]
    NicknameBlocked,
}

/// What a refusal says about the client that sent it. A refusal has exactly
/// one kind, and the hub matches on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ErrorKind {
    /// The client acted on a board the server no longer has: worth answering
    /// with a fresh snapshot.
    StaleState,
    /// What a correct client produces all match long by pressing the right
    /// button at the wrong millisecond: never suspicious.
    LostRace,
    /// A Contre-LOCO! that came too late or found the hand already moved: a
    /// wager lost, charged a card, and a lost race too.
    MissedCatch,
    /// A nickname refused; the wire says only [`NICKNAME_REJECTED`].
    NicknameRejected,
    /// Anything else: a message a correct client does not compose.
    Invalid,
}

impl ErrorKind {
    /// Whether an honest client produces this in ordinary play, so the hub
    /// must not count it as suspicious. A missed catch is one: the wager was
    /// honest, it simply lost.
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

/// A seat as the refusal text prints it: -1 for nobody, which the client's
/// copy already matches.
struct SignedSeat(Option<Seat>);

impl fmt::Display for SignedSeat {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.0 {
            Some(s) => write!(f, "{s}"),
            None => f.write_str("-1"),
        }
    }
}

fn signed_seat(s: &Option<Seat>) -> SignedSeat {
    SignedSeat(*s)
}

/// The quoting the refusal texts use for a nickname: double quotes, with `"`, `\`
/// and control characters escaped.
struct Quoted<'a>(&'a str);

impl fmt::Display for Quoted<'_> {
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

fn quoted(s: &str) -> Quoted<'_> {
    Quoted(s)
}
