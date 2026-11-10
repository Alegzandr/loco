//! The room: lobby, match, rounds and every action a seat can take
//! (`server/game/room.go`).
//!
//! Go mutated a `*Room` in place and read the clock inside. Here every method
//! that stamps or compares an instant takes `now` (Unix milliseconds), and
//! [`Room::apply`] wraps the `&mut self` methods into the `(state, action) ->
//! state` form the hub's table task is built on. A method that refuses leaves
//! the room exactly as it was, the same guarantee Go's validate-then-mutate
//! order gave; `apply` gets it for free by working on a clone.

use crate::card::{Card, Color, Kind, card_value, int_enum_serde};
use crate::deck::Deck;
use crate::error::GameError;
use crate::event::{EventKind, GameEvent};
use crate::hand::Hand;
use crate::maps::{MapId, TimeOfDay, Weather};
use crate::rules::can_play;
use crate::{Millis, Seat, rng};
use rand_chacha::ChaCha12Rng;
use rand_core::SeedableRng;
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;

/// The lifecycle state of a room.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum Status {
    #[default]
    Lobby = 0,
    Playing = 1,
    Finished = 2,
}
int_enum_serde!(Status { Lobby = 0, Playing = 1, Finished = 2 });

impl Status {
    /// Go's `Status.String()`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Status::Lobby => "lobby",
            Status::Playing => "playing",
            Status::Finished => "finished",
        }
    }
}

/// How many rounds make up a match. An integer rather than an enum because
/// the host sends any number and [`Room::set_format`] is what refuses it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct MatchFormat(pub i32);

impl MatchFormat {
    pub const BO1: MatchFormat = MatchFormat(1);
    pub const BO3: MatchFormat = MatchFormat(3);
    pub const BO5: MatchFormat = MatchFormat(5);
    pub const BO7: MatchFormat = MatchFormat(7);
}

impl Default for MatchFormat {
    fn default() -> Self {
        MatchFormat::BO1
    }
}

// The numbers below are read by client tests (serverMirrors, contentPages,
// seatLayout, seo), so each stays a plain literal on its own line.

/// A new table opens at the cap.
pub const DEFAULT_MAX_PLAYERS: i32 = 7;
/// The fewest seats a match can be played at.
pub const SERVER_MIN_PLAYERS: i32 = 2;
/// The most seats a table can hold.
pub const SERVER_MAX_PLAYERS: i32 = 7;
/// Cards dealt to each seat.
pub const INITIAL_HAND_SIZE: usize = 8;
/// What a caught seat draws.
pub const UNDECLARED_PENALTY: usize = 2;
/// What a Contre-LOCO! that finds nobody costs its caller (once per offer).
pub const FAILED_CATCH_PENALTY: usize = 1;
/// How long a call that found nobody locks its caller out (per press).
/// Two seconds is the declaration it protects; see `docs/notes/domain-rules.md`.
pub const CATCH_LOCKOUT_MS: Millis = 2000;
/// How long after a seat reaches its last card the table may catch it.
pub const CATCH_WINDOW_MS: Millis = 5000;
/// How long past a window a Contre-LOCO! is still a wager (a late call,
/// charged) rather than a call on a seat that was never on the hook. The
/// client's `CATCH_LATE_GRACE_MS` sits under it by the round trip.
pub const CATCH_GRACE_MS: Millis = 3000;
/// How long a seat that grew out of the two-card picture is still offered.
/// The client's `CATCH_NEAR_GRACE_MS` sits under it by the round trip.
pub const CATCH_NEAR_GRACE_MS: Millis = 2500;
/// The biggest hand a Contre-LOCO! is offered against: one ordinary play from
/// owing the call. Mirrored by the client's `CATCH_LIVE_MAX_HAND`.
pub const CATCH_NEAR_HAND: usize = 2;

const UNSEEDED: &str = "room has no source of randomness: Room::reseed it after a restore";

/// Per-player metadata.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Player {
    #[serde(rename = "Nickname")]
    pub nickname: String,
    #[serde(rename = "Index")]
    pub index: i32,
}

/// The authoritative server-side state of one round. JSON field names are
/// Go's: the drain snapshot serialises it inside `game.Room`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct GameState {
    #[serde(
        rename = "Hands",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub hands: Vec<Hand>,
    /// Go: `Deck *Deck`; a `null` reads as an empty deck.
    #[serde(rename = "Deck", deserialize_with = "deck_or_empty")]
    pub deck: Deck,
    #[serde(
        rename = "Discard",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub discard: Vec<Card>,
    #[serde(rename = "CurrentTurn")]
    pub current_turn: Seat,
    /// 1 = clockwise, -1 = counter-clockwise.
    #[serde(rename = "Direction")]
    pub direction: i32,
    #[serde(rename = "ActiveColor")]
    pub active_color: Color,
    /// Accumulated draw penalty for the seat at turn.
    #[serde(rename = "PendingDraw")]
    pub pending_draw: i32,
    /// True once the seat at turn has drawn; reset when the turn moves.
    #[serde(rename = "HasDrawn")]
    pub has_drawn: bool,

    /// Last-card declaration, per seat: a Swap or a GlobalSwitch can put
    /// several seats on one card in the same instant.
    #[serde(
        rename = "LastCardDeclared",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub last_card_declared: Vec<bool>,
    /// When each seat's catch window opened; `None` = closed.
    #[serde(rename = "LastCardAt", with = "crate::stamp::opt_vec")]
    pub last_card_at: Vec<Option<Millis>>,
    /// The offer (`catch_offer_key`) each seat last paid a card for with a
    /// Contre-LOCO! that found nothing; "" = never.
    #[serde(
        rename = "CatchPaidFor",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub catch_paid_for: Vec<String>,
    /// The instant each seat may press Contre-LOCO! again; `None` = not locked.
    #[serde(rename = "CatchLockedUntil", with = "crate::stamp::opt_vec")]
    pub catch_locked_until: Vec<Option<Millis>>,
    /// The instant each seat's hand last grew out of `CATCH_NEAR_HAND` cards.
    #[serde(rename = "NearLeftAt", with = "crate::stamp::opt_vec")]
    pub near_left_at: Vec<Option<Millis>>,
    /// The seats that have left the match, copied from `Room::retired` at
    /// every deal.
    #[serde(
        rename = "Retired",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub retired: Vec<bool>,

    #[serde(
        rename = "EventLog",
        deserialize_with = "crate::stamp::nullable::deserialize"
    )]
    pub event_log: Vec<GameEvent>,

    /// The interrupt window: open from the moment a card lands on the pile
    /// (the opening discard included) until a draw, a pass or the round's end.
    #[serde(rename = "InterruptOpen")]
    pub interrupt_open: bool,
    /// Who put the top card there; -1 = nobody (the deal, or a closed window).
    #[serde(rename = "LastPlayBy")]
    pub last_play_by: Seat,
    #[serde(rename = "LastPlayAt", with = "crate::stamp::opt")]
    pub last_play_at: Option<Millis>,
}

fn deck_or_empty<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Deck, D::Error> {
    Ok(Option::<Deck>::deserialize(d)?.unwrap_or_default())
}

/// The colour a played card sets active: a coloured card overrides whatever
/// the caller named with its own.
fn resolve_chosen_color(card: Card, chosen_color: Color) -> Color {
    if card.is_wild() {
        chosen_color
    } else {
        card.color
    }
}

fn seat_index(len: usize, i: Seat) -> Option<usize> {
    (i >= 0 && (i as usize) < len).then_some(i as usize)
}

impl GameState {
    /// Puts played cards on the pile. Replenish is not a play and does not go
    /// through here.
    pub(crate) fn push_discard(&mut self, cards: &[Card]) {
        self.discard.extend_from_slice(cards);
    }

    /// The top of the discard pile. Always present once a round is dealt;
    /// a hand-built state with an empty pile reads the zero card (Go panicked).
    pub fn top_card(&self) -> Card {
        self.discard.last().copied().unwrap_or_default()
    }

    /// The only way `active_color` is written after the deal. It refuses Wild,
    /// which matches no coloured card: the last line of defence.
    pub(crate) fn set_active_color(&mut self, c: Color) {
        if c == Color::Wild {
            return;
        }
        self.active_color = c;
    }

    /// Opens or refreshes the interrupt window for the most recent play.
    pub(crate) fn arm_interrupt_window(&mut self, actor: Seat, now: Millis) {
        self.interrupt_open = true;
        self.last_play_by = actor;
        self.last_play_at = Some(now);
    }

    /// Closes the interrupt window (draw, pass, round end).
    pub(crate) fn close_interrupt_window(&mut self) {
        self.interrupt_open = false;
        self.last_play_by = -1;
    }

    /// Puts one seat on the hook: it owes the table a declaration and can be
    /// caught until the window elapses.
    pub(crate) fn open_catch_window(&mut self, i: usize, now: Millis) {
        self.last_card_declared[i] = false;
        self.last_card_at[i] = Some(now);
    }

    /// Opens the actor's catch window when the play left it on one card. Only
    /// that seat's flag is touched.
    pub(crate) fn update_last_card_state(&mut self, i: usize, now: Millis) {
        if self.hands[i].size() != 1 {
            return;
        }
        self.open_catch_window(i, now);
    }

    /// Gates every hand-emptying play on the declaration the seat owes the
    /// table. `playing` is how many cards the play puts down, `declaring`
    /// whether the message carried the call (only read for a batch: a seat
    /// already on one card had its whole window to make it in).
    pub(crate) fn require_loco_to_finish(
        &self,
        i: usize,
        playing: usize,
        declaring: bool,
    ) -> Result<(), GameError> {
        if self.hands[i].size() != playing {
            return Ok(());
        }
        if playing == 1 {
            if !self.last_card_declared.get(i).copied().unwrap_or(false) {
                return Err(GameError::MustDeclareLoco);
            }
            return Ok(());
        }
        if !declaring {
            return Err(GameError::MustDeclareLoco);
        }
        Ok(())
    }

    /// Records the call a hand-emptying batch carried, flag and log both.
    pub(crate) fn declare_for_finish(&mut self, i: usize, now: Millis) {
        self.last_card_declared[i] = true;
        self.log_event(EventKind::UnoDeclared, i as Seat, None, Color::Red, now);
    }

    /// Puts every seat holding a single card on the hook after a Swap or a
    /// GlobalSwitch, a seat that declared a beat earlier included.
    pub(crate) fn open_catch_windows_after_rearrange(&mut self, now: Millis) {
        for i in 0..self.hands.len() {
            if self.hands[i].size() == 1 {
                self.open_catch_window(i, now);
            }
        }
    }

    fn window_age(&self, i: usize, now: Millis) -> Option<Millis> {
        self.last_card_at
            .get(i)
            .copied()
            .flatten()
            .map(|at| now - at)
    }

    /// Whether seat `i` can still be caught at `now`.
    pub(crate) fn catch_window_open(&self, i: usize, now: Millis) -> bool {
        self.window_age(i, now)
            .is_some_and(|age| age <= CATCH_WINDOW_MS)
    }

    /// Whether seat `i` was on the hook recently enough for a call on it to be
    /// a race at all (the window plus `CATCH_GRACE_MS`).
    pub(crate) fn catch_race_recent(&self, i: usize, now: Millis) -> bool {
        self.window_age(i, now)
            .is_some_and(|age| age <= CATCH_WINDOW_MS + CATCH_GRACE_MS)
    }

    /// When seat `i`'s window shuts; `None` when it never opened. Only
    /// meaningful for a seat `catchable_targets` just named. (Go:
    /// `CatchWindowEnd`, which returned the zero time plus 5s for a closed one.)
    pub fn catch_window_end(&self, i: Seat) -> Option<Millis> {
        let i = seat_index(self.last_card_at.len(), i)?;
        self.last_card_at[i].map(|at| at + CATCH_WINDOW_MS)
    }

    /// Whether seat `i` makes the Contre-LOCO! button worth pressing at `now`,
    /// seen from `catcher`'s chair: a window still recent enough to race, or a
    /// seat on exactly `CATCH_NEAR_HAND` cards (or just out of it).
    pub(crate) fn catch_offered_seat(&self, catcher: usize, i: usize, now: Millis) -> bool {
        if i == catcher || self.is_retired(i as Seat) {
            return false;
        }
        if self.catch_race_recent(i, now) {
            return true;
        }
        self.hands[i].size() == CATCH_NEAR_HAND || self.near_recent(i, now)
    }

    /// Whether seat `i` left the two-card picture within `CATCH_NEAR_GRACE_MS`.
    pub(crate) fn near_recent(&self, i: usize, now: Millis) -> bool {
        self.near_left_at
            .get(i)
            .copied()
            .flatten()
            .is_some_and(|at| now - at <= CATCH_NEAR_GRACE_MS)
    }

    /// Records seat `i` leaving the two-card picture upwards, given the size
    /// its hand had before the cards went in.
    pub(crate) fn note_hand_grew(&mut self, i: usize, before: usize, now: Millis) {
        if i >= self.near_left_at.len() {
            return;
        }
        if before == CATCH_NEAR_HAND && self.hands[i].size() > before {
            self.near_left_at[i] = Some(now);
        }
    }

    /// Names the offer `catcher` is pressing against: the window of every seat
    /// that has one (keyed on the window, never the hand that moves under it),
    /// and the two-card picture of every seat one play from opening one.
    pub(crate) fn catch_offer_key(&self, catcher: usize, now: Millis) -> String {
        let mut b = String::new();
        for i in 0..self.hands.len() {
            if !self.catch_offered_seat(catcher, i, now) {
                continue;
            }
            if self.catch_race_recent(i, now) {
                // Go wrote UnixNano; the millisecond times a million keeps the
                // shape, so a key written by Go before a restore reads alike.
                let at = self.last_card_at[i].unwrap_or_default();
                let _ = write!(b, "{i}@{};", at.saturating_mul(1_000_000));
                continue;
            }
            let _ = write!(b, "{i}:{CATCH_NEAR_HAND};");
        }
        b
    }

    /// Every seat that owes the table a declaration at `now`, oldest window
    /// first: the one about to expire is the one a catcher who named no target
    /// gets. (Go: `CatchableTargets`.)
    pub fn catchable_targets(&self, now: Millis) -> Vec<Seat> {
        let mut out: Vec<usize> = (0..self.hands.len())
            .filter(|&i| {
                self.hands[i].size() == 1
                    && !self.last_card_declared.get(i).copied().unwrap_or(false)
                    && self.catch_window_open(i, now)
            })
            .collect();
        out.sort_by_key(|&i| self.last_card_at[i]);
        out.into_iter().map(|i| i as Seat).collect()
    }

    /// Applies the `extra` further effects of a batch of identical cards;
    /// `apply_effect` has already run once for the first.
    pub(crate) fn stack_batch_effects(&mut self, card: Card, extra: usize) {
        if extra == 0 {
            return;
        }
        match card.kind {
            Kind::DrawTwo => self.pending_draw += 2 * extra as i32,
            Kind::WildDrawFour => self.pending_draw += 4 * extra as i32,
            Kind::Skip => {
                for _ in 0..extra {
                    self.current_turn = self.next_turn(self.current_turn);
                }
            }
            Kind::Reverse if extra % 2 == 1 => self.direction *= -1,
            _ => {}
        }
    }

    /// How many copies of `card` seat `i` holds.
    pub(crate) fn count_in_hand(&self, i: usize, card: Card) -> usize {
        self.hands[i].cards.iter().filter(|c| **c == card).count()
    }

    /// Appends an event to the log.
    pub(crate) fn log_event(
        &mut self,
        kind: EventKind,
        player_index: Seat,
        card: Option<Card>,
        chosen_color: Color,
        now: Millis,
    ) {
        self.event_log.push(GameEvent {
            kind,
            player_index,
            card,
            chosen_color,
            at: now,
        });
    }
}

/// A single game session: the lobby, the match and its rounds. JSON field
/// names are Go's, because the drain snapshot serialises `game.Room` directly
/// (schema version 5). The source of randomness is not serialised, exactly as
/// Go's unexported `rng` was not: a restored room is reseeded by the hub.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Room {
    #[serde(rename = "Code")]
    pub code: String,
    #[serde(rename = "Status")]
    pub status: Status,
    #[serde(rename = "Players", with = "crate::stamp::nil_when_empty")]
    pub players: Vec<Player>,
    #[serde(rename = "State")]
    pub state: Option<GameState>,
    /// Round winner's nickname for the just-completed round.
    #[serde(rename = "Winner")]
    pub winner: String,

    #[serde(rename = "Format")]
    pub format: MatchFormat,
    #[serde(rename = "MaxPlayers")]
    pub max_players: i32,

    /// The room this match is played in: drawn once per match by `start`,
    /// cleared by a rematch. Presentation only.
    #[serde(rename = "MapID", with = "crate::maps::empty_is_none")]
    pub map_id: Option<MapId>,
    #[serde(rename = "MapTime", with = "crate::maps::empty_is_none")]
    pub map_time: Option<TimeOfDay>,
    #[serde(rename = "MapWeather", with = "crate::maps::empty_is_none")]
    pub map_weather: Option<Weather>,

    /// Current round, 1-based, set to 1 by `start`.
    #[serde(rename = "RoundNumber")]
    pub round_number: i32,
    /// Cumulative match scores per seat.
    #[serde(rename = "Scores", with = "crate::stamp::nil_when_empty")]
    pub scores: Vec<i32>,
    /// Rounds won per seat.
    #[serde(rename = "RoundsWon", with = "crate::stamp::nil_when_empty")]
    pub rounds_won: Vec<i32>,
    /// Sum of remaining hand values for the round losers (a tiebreaker).
    #[serde(rename = "LostHandTotal", with = "crate::stamp::nil_when_empty")]
    pub lost_hand_total: Vec<i32>,
    /// The seats that walked out of this match. Match-level: survives every
    /// deal, cleared when a new match starts.
    #[serde(rename = "Retired", with = "crate::stamp::nil_when_empty")]
    pub retired: Vec<bool>,
    /// `round_history[k][seat]` = points that seat scored in round k+1.
    #[serde(rename = "RoundHistory", with = "crate::stamp::nil_when_empty")]
    pub round_history: Vec<Vec<i32>>,

    /// Signals for the hub (set by `end_round`, cleared by the hub).
    #[serde(rename = "RoundEnded")]
    pub round_ended: bool,
    #[serde(rename = "MatchOver")]
    pub match_over: bool,
    #[serde(rename = "MatchWinner")]
    pub match_winner: String,

    /// The room's one source of randomness: the map, the opening seat and
    /// every shuffle. The hub seeds it from the OS.
    #[serde(skip)]
    pub(crate) rng: Option<ChaCha12Rng>,
}

impl PartialEq for Room {
    /// Rooms compare on what they hold, the source of randomness included.
    fn eq(&self, other: &Self) -> bool {
        self.code == other.code
            && self.status == other.status
            && self.players == other.players
            && self.state == other.state
            && self.winner == other.winner
            && self.format == other.format
            && self.max_players == other.max_players
            && self.map_id == other.map_id
            && self.map_time == other.map_time
            && self.map_weather == other.map_weather
            && self.round_number == other.round_number
            && self.scores == other.scores
            && self.rounds_won == other.rounds_won
            && self.lost_hand_total == other.lost_hand_total
            && self.retired == other.retired
            && self.round_history == other.round_history
            && self.round_ended == other.round_ended
            && self.match_over == other.match_over
            && self.match_winner == other.match_winner
            && self.rng == other.rng
    }
}

/// `dropSeat` in Go: `s` without index `i`, re-based; a vector too short to
/// hold the seat is left as it was.
fn drop_seat<T>(s: &mut Vec<T>, i: usize) {
    if i < s.len() {
        s.remove(i);
    }
}

/// The tiebreak filter: the candidates whose score equals the best.
fn filter_best(candidates: Vec<usize>, score_of: impl Fn(usize) -> i32) -> Vec<usize> {
    let Some(best) = candidates.iter().map(|&i| score_of(i)).max() else {
        return candidates;
    };
    candidates
        .into_iter()
        .filter(|&i| score_of(i) == best)
        .collect()
}

impl Room {
    /// An empty lobby, seeded with 32 bytes the caller drew from the OS.
    /// (Go: `NewRoom`, which read crypto/rand itself.)
    pub fn new(code: impl Into<String>, seed: [u8; 32]) -> Room {
        Room {
            code: code.into(),
            status: Status::Lobby,
            format: MatchFormat::BO1,
            max_players: DEFAULT_MAX_PLAYERS,
            rng: Some(ChaCha12Rng::from_seed(seed)),
            ..Room::default()
        }
    }

    /// An empty lobby seeded from a `u64`, for tests and fixtures. Never for a
    /// real table: 64 bits a caller can reproduce is the clock-seed attack
    /// (`tests/rng_test.rs`).
    pub fn from_u64_seed(code: impl Into<String>, seed: u64) -> Room {
        let mut r = Room::new(code, [0; 32]);
        r.rng = Some(ChaCha12Rng::seed_from_u64(seed));
        r
    }

    /// Gives the room a fresh source. A room decoded from a snapshot has none,
    /// because the source is never serialised (Go: `ensureRNG`).
    pub fn reseed(&mut self, seed: [u8; 32]) {
        self.rng = Some(ChaCha12Rng::from_seed(seed));
    }

    /// Whether the room has a source of randomness.
    pub fn is_seeded(&self) -> bool {
        self.rng.is_some()
    }

    pub(crate) fn rng_mut(&mut self) -> &mut ChaCha12Rng {
        self.rng.as_mut().expect(UNSEEDED)
    }

    /// The round's state, if one is dealt.
    pub fn state(&self) -> Option<&GameState> {
        self.state.as_ref()
    }

    fn playing_state(&mut self) -> Result<&mut GameState, GameError> {
        if self.status != Status::Playing {
            return Err(GameError::GameNotInProgress);
        }
        self.state.as_mut().ok_or(GameError::GameNotInProgress)
    }

    // --- Lobby -------------------------------------------------------------

    /// Sets the match format (lobby only). (Go: `SetFormat`.)
    pub fn set_format(&mut self, f: MatchFormat) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::FormatLocked);
        }
        if !matches!(f.0, 1 | 3 | 5 | 7) {
            return Err(GameError::InvalidMatchFormat(f.0));
        }
        self.format = f;
        Ok(())
    }

    /// Sets the seat cap (lobby only; never below the seats taken). (Go:
    /// `SetMaxPlayers`.)
    pub fn set_max_players(&mut self, n: i32) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::MaxPlayersLocked);
        }
        if n < SERVER_MIN_PLAYERS {
            return Err(GameError::MaxPlayersTooLow(SERVER_MIN_PLAYERS));
        }
        if n > SERVER_MAX_PLAYERS {
            return Err(GameError::MaxPlayersTooHigh(SERVER_MAX_PLAYERS));
        }
        if (n as usize) < self.players.len() {
            return Err(GameError::MaxPlayersBelowRoster {
                n,
                seated: self.players.len(),
            });
        }
        self.max_players = n;
        Ok(())
    }

    /// Exchanges two seats (lobby only), for `transfer_host`. A swap rather
    /// than a move because it re-bases exactly two seats. (Go:
    /// `SwapLobbyPlayers`.)
    pub fn swap_lobby_players(&mut self, a: Seat, b: Seat) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::ReorderOnlyInLobby);
        }
        let n = self.players.len();
        let (Some(ai), Some(bi)) = (seat_index(n, a), seat_index(n, b)) else {
            return Err(GameError::InvalidSeatPair);
        };
        if ai == bi {
            return Ok(());
        }
        self.players.swap(ai, bi);
        self.players[ai].index = a;
        self.players[bi].index = b;
        Ok(())
    }

    /// Removes a seat from the lobby (or a finished room), re-indexes the rest
    /// and re-bases everything the scoreboard is drawn from. Returns whether
    /// the removed seat was the host. (Go: `RemoveLobbyPlayer`.)
    pub fn remove_lobby_player(&mut self, seat: Seat) -> Result<bool, GameError> {
        if self.status != Status::Lobby && self.status != Status::Finished {
            return Err(GameError::RemoveOnlyInLobby);
        }
        let Some(i) = seat_index(self.players.len(), seat) else {
            return Err(GameError::InvalidPlayerIndex(seat));
        };
        let was_host = i == 0;
        self.players.remove(i);
        for (k, p) in self.players.iter_mut().enumerate() {
            p.index = k as i32;
        }
        drop_seat(&mut self.scores, i);
        drop_seat(&mut self.rounds_won, i);
        drop_seat(&mut self.lost_hand_total, i);
        drop_seat(&mut self.retired, i);
        for row in &mut self.round_history {
            drop_seat(row, i);
        }
        Ok(was_host)
    }

    /// Adds a player to the lobby. (Go: `Join`.)
    pub fn join(&mut self, nickname: &str) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::GameAlreadyInProgress);
        }
        if self.players.len() as i64 >= self.max_players as i64 {
            return Err(GameError::RoomFull(self.max_players));
        }
        if self.players.iter().any(|p| p.nickname == nickname) {
            return Err(GameError::NicknameTaken(nickname.to_string()));
        }
        self.players.push(Player {
            nickname: nickname.to_string(),
            index: self.players.len() as i32,
        });
        Ok(())
    }

    /// Begins the match: deals the first round, the opener drawn at random.
    /// (Go: `Start`.)
    pub fn start(&mut self, now: Millis) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::GameAlreadyStarted);
        }
        if (self.players.len() as i64) < SERVER_MIN_PLAYERS as i64 {
            return Err(GameError::NotEnoughPlayers(SERVER_MIN_PLAYERS));
        }
        let n = self.players.len();
        self.scores = vec![0; n];
        self.rounds_won = vec![0; n];
        self.lost_hand_total = vec![0; n];
        self.retired = vec![false; n];
        self.round_history = Vec::new();
        self.round_number = 1;

        // Drawn once per match, not per round, with the hour and the sky.
        let map = self.pick_map();
        self.map_id = Some(map);
        self.map_time = Some(self.pick_time());
        self.map_weather = Some(self.pick_weather(map));

        self.status = Status::Playing;
        let opener = rng::below(self.rng_mut(), n) as Seat;
        self.deal_round(opener, now);
        Ok(())
    }

    /// Sets up a fresh round. A retired seat is dealt nothing and keeps its
    /// index. The opening discard is always a Number, and the interrupt window
    /// is open on it with nobody as its author. (Go: `dealRound`.)
    pub(crate) fn deal_round(&mut self, starting_player: Seat, now: Millis) {
        let n = self.players.len();
        let mut deck = Deck::new();
        deck.shuffle(self.rng_mut());

        let mut retired = vec![false; n];
        for (i, r) in self.retired.iter().take(n).enumerate() {
            retired[i] = *r;
        }
        let mut hands = vec![Hand::default(); n];
        for (i, hand) in hands.iter_mut().enumerate() {
            if retired[i] {
                continue;
            }
            if let Some(cards) = deck.draw_n(INITIAL_HAND_SIZE) {
                hand.add(&cards);
            }
        }

        // Flip the first card: the round must begin on a number.
        let mut first = Card::default();
        let mut spill = Vec::new();
        while let Some(c) = deck.draw() {
            if c.kind == Kind::Number {
                first = c;
                break;
            }
            spill.push(c);
        }
        spill.extend_from_slice(&deck.cards);
        deck.cards = spill;

        let starting_player = if starting_player < 0 || starting_player as usize >= n {
            0
        } else {
            starting_player
        };

        let mut st = GameState {
            hands,
            deck,
            discard: vec![first],
            current_turn: starting_player,
            direction: 1,
            active_color: first.color,
            interrupt_open: true,
            last_play_by: -1,
            last_card_declared: vec![false; n],
            last_card_at: vec![None; n],
            catch_paid_for: vec![String::new(); n],
            catch_locked_until: vec![None; n],
            near_left_at: vec![None; n],
            retired,
            ..GameState::default()
        };
        // The seat that opens the round has to be one that can play.
        if st.is_retired(st.current_turn) {
            st.current_turn = st.next_turn(st.current_turn);
        }
        st.log_event(EventKind::GameStarted, -1, None, Color::Red, now);
        self.state = Some(st);
    }

    // --- Plays -------------------------------------------------------------

    /// Plays one card from `seat`'s hand. `chosen_color` names the colour for
    /// a wild; `chosen_player` is the Swap target (-1 otherwise). (Go:
    /// `PlayCard`.)
    pub fn play_card(
        &mut self,
        seat: Seat,
        card: Card,
        chosen_color: Color,
        chosen_player: Seat,
        now: Millis,
    ) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat {
            return Err(GameError::NotYourTurn);
        }
        let n = st.hands.len();
        let p = seat_index(n, seat).ok_or(GameError::NotYourTurn)?;
        if st.pending_draw > 0 {
            return Err(GameError::MustAnswerPenalty);
        }
        if !st.hands[p].contains(card) {
            return Err(GameError::CardNotInHand);
        }
        if !can_play(card, st.top_card(), st.active_color) {
            return Err(GameError::IllegalPlay);
        }
        // Every wild names the colour that becomes active, GlobalSwitch too.
        if card.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        // The Swap target is validated before anything moves.
        let mut target = 0;
        if card.kind == Kind::Swap {
            target =
                seat_index(n, chosen_player).ok_or(GameError::InvalidSwapTarget(chosen_player))?;
            if target == p {
                return Err(GameError::CannotSwapWithYourself);
            }
            if st.is_retired(chosen_player) {
                return Err(GameError::SeatHasLeft);
            }
        }
        // Last in the validation block: an illegal card is refused as illegal,
        // and only a card that would take the round is asked about the call.
        st.require_loco_to_finish(p, 1, false)?;

        st.hands[p].remove(card)?;
        let chosen = resolve_chosen_color(card, chosen_color);
        st.push_discard(&[card]);
        st.log_event(EventKind::CardPlayed, seat, Some(card), chosen, now);

        // A Swap or GlobalSwitch that empties the hand ends the round before
        // any hand moves (rules.md §11.1).
        if st.hands[p].size() == 0 {
            self.finish_round_win(p, chosen, now);
            return Ok(());
        }

        let rearranged = matches!(card.kind, Kind::Swap | Kind::GlobalSwitch);
        if card.kind == Kind::Swap {
            st.hands.swap(p, target);
        } else if card.kind == Kind::GlobalSwitch {
            rotate_hands(st);
        }
        if rearranged {
            st.open_catch_windows_after_rearrange(now);
        } else {
            st.update_last_card_state(p, now);
        }

        let next = st.apply_effect(card, chosen);
        st.has_drawn = false;
        st.current_turn = next;
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// Plays a batch of identical cards on the seat's own turn. Effects stack
    /// (N DrawTwos add 2N, N Skips skip N seats, N Reverses flip N times);
    /// Swap and GlobalSwitch never batch. `declare_loco` is the call the
    /// message carried, read only when the batch empties the hand. (Go:
    /// `PlayCards`.)
    pub fn play_cards(
        &mut self,
        seat: Seat,
        cards: &[Card],
        chosen_color: Color,
        chosen_player: Seat,
        declare_loco: bool,
        now: Millis,
    ) -> Result<(), GameError> {
        let Some(&first) = cards.first() else {
            return Err(GameError::NoCardsSpecified);
        };
        if cards.len() == 1 {
            return self.play_card(seat, first, chosen_color, chosen_player, now);
        }
        if cards.iter().any(|c| *c != first) {
            return Err(GameError::BatchNotIdentical);
        }
        if matches!(first.kind, Kind::Swap | Kind::GlobalSwitch) {
            return Err(GameError::BatchOfRearrangers);
        }
        let st = self.playing_state()?;
        if st.current_turn != seat {
            return Err(GameError::NotYourTurn);
        }
        let p = seat_index(st.hands.len(), seat).ok_or(GameError::NotYourTurn)?;
        if st.pending_draw > 0 {
            return Err(GameError::MustAnswerPenalty);
        }
        let have = st.count_in_hand(p, first);
        if have < cards.len() {
            return Err(GameError::NotEnoughCopies {
                have,
                need: cards.len(),
            });
        }
        if !can_play(first, st.top_card(), st.active_color) {
            return Err(GameError::IllegalPlay);
        }
        if first.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        let finishing = st.hands[p].size() == cards.len();
        st.require_loco_to_finish(p, cards.len(), declare_loco)?;

        for _ in 0..cards.len() {
            st.hands[p].remove(first)?;
        }
        let chosen = resolve_chosen_color(first, chosen_color);
        st.push_discard(cards);

        // The call is logged before the cards, in the order the table hears it.
        if finishing {
            st.declare_for_finish(p, now);
        }
        st.update_last_card_state(p, now);
        for c in cards {
            st.log_event(EventKind::CardPlayed, seat, Some(*c), chosen, now);
        }

        if st.hands[p].size() == 0 {
            self.finish_round_win(p, chosen, now);
            return Ok(());
        }

        st.current_turn = st.apply_effect(first, chosen);
        st.stack_batch_effects(first, cards.len() - 1);
        st.has_drawn = false;
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// The one win path every hand-emptying play goes through: locks in the
    /// colour, closes the interrupt window, logs the finish, ends the round.
    /// (Go: `finishRoundWin`.)
    fn finish_round_win(&mut self, winner: usize, active_color: Color, now: Millis) {
        if let Some(st) = self.state.as_mut() {
            st.set_active_color(active_color);
            st.close_interrupt_window();
            st.log_event(
                EventKind::GameFinished,
                winner as Seat,
                None,
                Color::Red,
                now,
            );
        }
        self.end_round(winner, now);
    }

    /// Finalises the round: the winner scores the sum of every other hand,
    /// everyone else scores 0 (their hand value goes to the tiebreak). Then the
    /// match stops if the lead can no longer be caught or the format has run
    /// out with somebody separable; otherwise the hub deals the next round.
    /// (Go: `endRound`.)
    pub(crate) fn end_round(&mut self, winner: usize, now: Millis) {
        let Some(st) = self.state.as_mut() else {
            return;
        };
        self.winner = self.players[winner].nickname.clone();
        self.rounds_won[winner] += 1;

        let mut score = 0;
        for (i, hand) in st.hands.iter().enumerate() {
            if i == winner {
                continue;
            }
            let value: i32 = hand.cards.iter().map(|c| card_value(*c)).sum();
            score += value;
            self.lost_hand_total[i] += value;
        }
        self.scores[winner] += score;

        // One row per round: everyone 0 but the finisher.
        let mut row = vec![0; self.players.len()];
        row[winner] = score;
        self.round_history.push(row);

        st.log_event(EventKind::RoundEnd, winner as Seat, None, Color::Red, now);
        self.round_ended = true;

        // Two ways a match stops: a lead the rounds left cannot catch, or the
        // format running out on a table the tiebreak can separate. Otherwise
        // sudden death: the room keeps dealing.
        if (self.decisive_leader() >= 0 || self.round_number >= self.format.0)
            && let Some(w) = self.determine_match_winner()
        {
            self.match_winner = w;
            self.match_over = true;
            self.status = Status::Finished;
            if let Some(st) = self.state.as_mut() {
                st.log_event(EventKind::MatchEnd, -1, None, Color::Red, now);
            }
        }
    }

    /// Ends the match now and awards it to `winner`, leaving the scoreboard
    /// exactly as it stood. (Go: `ForfeitTo`.)
    pub fn forfeit_to(&mut self, winner: Seat, now: Millis) -> Result<(), GameError> {
        if self.status != Status::Playing {
            return Err(GameError::ForfeitNotPlaying);
        }
        let Some(w) = seat_index(self.players.len(), winner) else {
            return Err(GameError::InvalidPlayerIndex(winner));
        };
        self.match_winner = self.players[w].nickname.clone();
        self.match_over = true;
        self.status = Status::Finished;
        if let Some(st) = self.state.as_mut() {
            st.log_event(EventKind::MatchEnd, winner, None, Color::Red, now);
        }
        Ok(())
    }

    /// Whether a seat has walked out of the match, read off the match-level
    /// flags. (Go: `IsRetired`.)
    pub fn is_retired(&self, seat: Seat) -> bool {
        seat_index(self.retired.len(), seat).is_some_and(|i| self.retired[i])
    }

    /// Takes a seat out of the match for good: its hand goes back into the
    /// deck, the turn steps over it, its catch window shuts, and the
    /// scoreboard is left exactly as it stood. (Go: `RetireSeat`.)
    pub fn retire_seat(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        if self.status != Status::Playing || self.state.is_none() {
            return Err(GameError::GameNotInProgress);
        }
        let Self {
            state,
            rng,
            retired,
            ..
        } = self;
        let st = state.as_mut().ok_or(GameError::GameNotInProgress)?;
        let Some(p) = seat_index(st.hands.len(), seat) else {
            return Err(GameError::InvalidPlayerIndex(seat));
        };
        if st.is_retired(seat) {
            return Err(GameError::SeatAlreadyRetired);
        }

        let returned = std::mem::take(&mut st.hands[p].cards);
        if !returned.is_empty() {
            st.deck.cards.extend_from_slice(&returned);
            st.deck.shuffle(rng.as_mut().expect(UNSEEDED));
        }

        if p < retired.len() {
            retired[p] = true;
        }
        if p < st.retired.len() {
            st.retired[p] = true;
        }

        // No cards, so no obligation and no window.
        st.last_card_declared[p] = true;
        st.last_card_at[p] = None;

        if st.current_turn == seat {
            st.has_drawn = false;
            // A stack aimed at the seat dies with it.
            st.pending_draw = 0;
            st.current_turn = st.next_turn(seat);
            st.close_interrupt_window();
        }

        st.log_event(EventKind::SeatRetired, seat, None, Color::Red, now);
        Ok(())
    }

    /// Deals the next round, opened by the biggest loser. The hub calls it
    /// between `round_end` and `game_started`. (Go: `BeginNextRound`.)
    pub fn begin_next_round(&mut self, now: Millis) -> Result<(), GameError> {
        if self.match_over {
            return Err(GameError::NextRoundAfterMatchOver);
        }
        if self.status != Status::Playing {
            return Err(GameError::NextRoundNotPlaying);
        }
        self.round_number += 1;
        let opener = self.biggest_loser();
        self.deal_round(opener, now);
        Ok(())
    }

    /// Returns a finished room to the lobby: roster and lobby config survive,
    /// everything about the match is dropped, the map included. (Go:
    /// `ResetForRematch`.)
    pub fn reset_for_rematch(&mut self) -> Result<(), GameError> {
        if self.status != Status::Finished {
            return Err(GameError::RematchUnavailable);
        }
        self.status = Status::Lobby;
        self.state = None;
        self.winner.clear();
        self.round_ended = false;
        self.match_over = false;
        self.match_winner.clear();
        self.round_number = 0;
        self.map_id = None;
        self.map_time = None;
        self.map_weather = None;
        self.scores = Vec::new();
        self.rounds_won = Vec::new();
        self.lost_hand_total = Vec::new();
        self.retired = Vec::new();
        self.round_history = Vec::new();
        Ok(())
    }

    /// The seat whose lead in rounds won can no longer be caught, or -1. One
    /// expression for both endings: `remaining` is zero once the format is
    /// exhausted. (Go: `decisiveLeader`.)
    pub(crate) fn decisive_leader(&self) -> Seat {
        let remaining = (self.format.0 - self.round_number).max(0);
        let rw = &self.rounds_won;
        for i in 0..rw.len() {
            let decisive = (0..rw.len()).all(|j| i == j || rw[i] > rw[j] + remaining);
            if decisive {
                return i as Seat;
            }
        }
        -1
    }

    /// The seat with the lowest cumulative score, which opens the next round;
    /// ties go to the lowest index, retired seats are skipped. Deliberately on
    /// points, not rounds won. (Go: `biggestLoser`.)
    pub(crate) fn biggest_loser(&self) -> Seat {
        let mut loser: Option<usize> = None;
        for i in 0..self.scores.len() {
            if self.retired.get(i).copied().unwrap_or(false) {
                continue;
            }
            if loser.is_none_or(|l| self.scores[i] < self.scores[l]) {
                loser = Some(i);
            }
        }
        loser.map_or(0, |l| l as Seat)
    }

    /// The match winner by the tiebreak chain: most rounds won, then highest
    /// score, then lowest lost-hand total. `None` means sudden death. (Go:
    /// `determineMatchWinner`, which returned "".)
    pub(crate) fn determine_match_winner(&self) -> Option<String> {
        let mut c: Vec<usize> = (0..self.players.len()).collect();
        c = filter_best(c, |i| self.rounds_won[i]);
        if c.len() == 1 {
            return Some(self.players[c[0]].nickname.clone());
        }
        c = filter_best(c, |i| self.scores[i]);
        if c.len() == 1 {
            return Some(self.players[c[0]].nickname.clone());
        }
        c = filter_best(c, |i| -self.lost_hand_total[i]);
        if c.len() == 1 {
            return Some(self.players[c[0]].nickname.clone());
        }
        None
    }

    // --- Draw, pass, declare ----------------------------------------------

    /// The seat at turn draws one card, or the whole pending stack. Either way
    /// it keeps the turn (rules.md §14.5). Never fails once validated: the
    /// draw shrinks to what the piles hold. (Go: `DrawCard`.)
    pub fn draw_card(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat {
            return Err(GameError::NotYourTurn);
        }
        let p = seat_index(st.hands.len(), seat).ok_or(GameError::NotYourTurn)?;
        let n = if st.pending_draw > 0 {
            st.pending_draw as usize
        } else if st.has_drawn {
            return Err(GameError::AlreadyDrawn);
        } else {
            1
        };

        // Nothing above this line touched the state, nothing below can fail.
        self.ensure_deck(n);
        let st = self.state.as_mut().expect("validated above");
        let cards = st.deck.draw_up_to(n);
        let before = st.hands[p].size();
        st.hands[p].add(&cards);
        st.note_hand_grew(p, before, now);
        // The stack is settled by whatever the piles could give.
        st.pending_draw = 0;
        st.has_drawn = true;
        st.close_interrupt_window();
        st.log_event(EventKind::CardDrawn, seat, None, Color::Red, now);
        Ok(())
    }

    /// Moves the turn on after a draw. (Go: `PassTurn`.)
    pub fn pass_turn(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat {
            return Err(GameError::NotYourTurn);
        }
        if !st.has_drawn {
            return Err(GameError::MustDrawBeforePass);
        }
        st.has_drawn = false;
        st.current_turn = st.next_turn(seat);
        st.close_interrupt_window();
        st.log_event(EventKind::TurnPassed, seat, None, Color::Red, now);
        Ok(())
    }

    /// Records a seat calling LOCO! on its last card. A late call is always
    /// accepted while the hand is one card; a declaration is a one-shot until a
    /// new window opens. (Go: `DeclareLastCard`; an out-of-range seat is
    /// refused here where Go would have panicked.)
    pub fn declare_last_card(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let st = self.playing_state()?;
        let Some(p) = seat_index(st.hands.len(), seat) else {
            return Err(GameError::InvalidPlayerIndex(seat));
        };
        if st.hands[p].size() != 1 {
            return Err(GameError::DeclareNeedsOneCard);
        }
        if st.last_card_declared[p] {
            return Err(GameError::AlreadyDeclared);
        }
        st.last_card_declared[p] = true;
        st.log_event(EventKind::UnoDeclared, seat, None, Color::Red, now);
        Ok(())
    }

    // --- The catch ---------------------------------------------------------

    /// Whether a Contre-LOCO! from `catcher` is a wager at `now`: whether any
    /// other seat is near enough the finish for the button to be live on an
    /// honest screen. (Go: `CatchOffered`.)
    pub fn catch_offered(&self, catcher: Seat, now: Millis) -> bool {
        if self.status != Status::Playing {
            return false;
        }
        let Some(st) = self.state.as_ref() else {
            return false;
        };
        let Some(c) = seat_index(st.hands.len(), catcher) else {
            return false;
        };
        (0..st.hands.len()).any(|i| st.catch_offered_seat(c, i, now))
    }

    /// When `catcher`'s lockout ends; `None` when it is not locked or the seat
    /// is out of range. (Go: `CatchLockedAt`, zero time for "none".)
    pub fn catch_locked_at(&self, catcher: Seat) -> Option<Millis> {
        let st = self.state.as_ref()?;
        let i = seat_index(st.catch_locked_until.len(), catcher)?;
        st.catch_locked_until[i]
    }

    /// Whether `catcher` is inside its lockout at `now`. (Go: `CatchLocked`.)
    pub fn catch_locked(&self, catcher: Seat, now: Millis) -> bool {
        self.catch_locked_at(catcher).is_some_and(|at| now < at)
    }

    /// Arms or re-arms `catcher`'s lockout and returns when it now ends.
    /// Touches nothing else. (Go: `LockCatch`.)
    pub fn lock_catch(&mut self, catcher: Seat, now: Millis) -> Option<Millis> {
        let st = self.state.as_mut()?;
        let i = seat_index(st.catch_locked_until.len(), catcher)?;
        let until = now + CATCH_LOCKOUT_MS;
        st.catch_locked_until[i] = Some(until);
        Some(until)
    }

    /// `catcher` penalises `target` for not declaring its last card. The catch
    /// lands on the instant it arrives; the penalty shrinks to what the piles
    /// hold and the catch always stands. (Go: `CatchUndeclared`.)
    pub fn catch_undeclared(
        &mut self,
        catcher: Seat,
        target: Seat,
        now: Millis,
    ) -> Result<(), GameError> {
        let locked = self.catch_locked(catcher, now);
        let st = self.playing_state()?;
        let n = st.hands.len();
        let Some(t) = seat_index(n, target) else {
            return Err(GameError::InvalidTarget(target));
        };
        if seat_index(n, catcher).is_none() {
            return Err(GameError::InvalidCatcher(catcher));
        }
        if catcher == target {
            return Err(GameError::CannotCatchYourself);
        }
        // Above every refusal that costs a card: a locked seat is out of the
        // mechanic and this press neither wins nor pays.
        if locked {
            return Err(GameError::CatchLocked);
        }
        // Before the three timing refusals, which charge: a seat never on the
        // hook is not a race.
        if !st.catch_race_recent(t, now) {
            return Err(GameError::NoCatchWindow);
        }
        if st.last_card_declared[t] {
            return Err(GameError::AlreadyDeclared);
        }
        if st.hands[t].size() != 1 {
            return Err(GameError::TargetNotSingleCard);
        }
        if !st.catch_window_open(t, now) {
            return Err(GameError::CatchWindowExpired);
        }

        self.ensure_deck(UNDECLARED_PENALTY);
        let st = self.state.as_mut().expect("validated above");
        let cards = st.deck.draw_up_to(UNDECLARED_PENALTY);
        st.hands[t].add(&cards);
        // The penalty settles the debt, however many cards it came to.
        st.last_card_declared[t] = true;
        st.log_event(EventKind::UnoCaught, catcher, None, Color::Red, now);
        Ok(())
    }

    /// Charges `catcher` one card for a Contre-LOCO! that found nothing, at
    /// most once per offer and only while one is on the table. Returns the
    /// cards drawn and whether the seat was charged at all (`false` = the
    /// press cost nothing and is nobody else's business). Touches nothing but
    /// the caller's hand and ration. (Go: `PenalizeFailedCatch`.)
    pub fn penalize_failed_catch(&mut self, catcher: Seat, now: Millis) -> (Vec<Card>, bool) {
        if !self.catch_offered(catcher, now) {
            return (Vec::new(), false);
        }
        // Inside its lockout a seat pays nothing: that press was paid for.
        if self.catch_locked(catcher, now) {
            return (Vec::new(), false);
        }
        let Some(st) = self.state.as_mut() else {
            return (Vec::new(), false);
        };
        let c = catcher as usize;
        let key = st.catch_offer_key(c, now);
        if st.catch_paid_for[c] == key {
            return (Vec::new(), false);
        }
        st.catch_paid_for[c] = key;
        self.ensure_deck(FAILED_CATCH_PENALTY);
        let st = self.state.as_mut().expect("checked above");
        let drawn = st.deck.draw_up_to(FAILED_CATCH_PENALTY);
        if drawn.is_empty() {
            // Both piles dry: charged all the same, with nothing to charge.
            return (Vec::new(), true);
        }
        let before = st.hands[c].size();
        st.hands[c].add(&drawn);
        st.note_hand_grew(c, before, now);
        st.log_event(EventKind::CatchFailed, catcher, None, Color::Red, now);
        (drawn, true)
    }

    // --- Interrupts and counters ------------------------------------------

    /// The single-card form of [`Room::interrupt_play_cards`], which is the
    /// only form there is. (Go: `InterruptPlay`.)
    pub fn interrupt_play(
        &mut self,
        seat: Seat,
        card: Card,
        chosen_color: Color,
        chosen_player: Seat,
        now: Millis,
    ) -> Result<(), GameError> {
        self.interrupt_play_cards(seat, &[card], chosen_color, chosen_player, now)
    }

    /// Any seat takes the lead by slamming ONE card identical to the top
    /// discard. No deadline, nobody excluded; the first message to arrive
    /// wins. The list form exists so a batch can be refused rather than
    /// assumed. (Go: `InterruptPlayCards`; an out-of-range seat is refused
    /// where Go would have panicked.)
    pub fn interrupt_play_cards(
        &mut self,
        seat: Seat,
        cards: &[Card],
        chosen_color: Color,
        chosen_player: Seat,
        now: Millis,
    ) -> Result<(), GameError> {
        let st = self.playing_state()?;
        let Some(&first) = cards.first() else {
            return Err(GameError::NoCardsSpecified);
        };
        if cards.len() > 1 {
            return Err(GameError::InterruptBatch);
        }
        if !st.interrupt_open {
            return Err(GameError::InterruptWindowClosed);
        }
        if st.pending_draw > 0 && first.kind != Kind::DrawTwo && first.kind != Kind::WildDrawFour {
            return Err(GameError::InterruptNotADrawCard);
        }
        if first.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        let n = st.hands.len();
        let Some(p) = seat_index(n, seat) else {
            return Err(GameError::InvalidPlayerIndex(seat));
        };
        if !st.hands[p].contains(first) {
            return Err(GameError::CardNotInHand);
        }
        let top = st.top_card();
        if first != top {
            return Err(GameError::InterruptMismatch);
        }
        let mut target = 0;
        if first.kind == Kind::Swap {
            target = match seat_index(n, chosen_player) {
                Some(t) if t != p => t,
                _ => return Err(GameError::InvalidSwapTarget(chosen_player)),
            };
            if st.is_retired(chosen_player) {
                return Err(GameError::SeatHasLeft);
            }
        }
        // One card off a one-card hand takes the round, and that seat owed the
        // call before this message.
        st.require_loco_to_finish(p, 1, false)?;

        let chosen = resolve_chosen_color(first, chosen_color);
        st.hands[p].remove(first)?;
        st.push_discard(&[first]);
        st.log_event(EventKind::CardPlayed, seat, Some(first), chosen, now);

        // A round-ending interject aborts the Swap / GlobalSwitch (rules.md §13).
        if st.hands[p].size() == 0 {
            self.finish_round_win(p, chosen, now);
            return Ok(());
        }

        let rearranged = matches!(first.kind, Kind::Swap | Kind::GlobalSwitch);
        if first.kind == Kind::Swap {
            st.hands.swap(p, target);
        } else if first.kind == Kind::GlobalSwitch {
            rotate_hands(st);
        }
        if rearranged {
            st.open_catch_windows_after_rearrange(now);
        } else {
            st.update_last_card_state(p, now);
        }

        // The lead transfers: the effect applies from the interjecter's seat.
        st.current_turn = seat;
        st.current_turn = st.apply_effect(first, chosen);
        st.has_drawn = false;
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// The seat facing a pending draw passes it on with the same card: same
    /// kind and same colour. (Go: `CounterDraw`.)
    pub fn counter_draw(
        &mut self,
        seat: Seat,
        card: Card,
        chosen_color: Color,
        now: Millis,
    ) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat {
            return Err(GameError::NotYourTurn);
        }
        let p = seat_index(st.hands.len(), seat).ok_or(GameError::NotYourTurn)?;
        if st.pending_draw == 0 {
            return Err(GameError::NoPendingDraw);
        }
        if !st.hands[p].contains(card) {
            return Err(GameError::CardNotInHand);
        }
        let top = st.top_card();
        // Unreachable today, written down because the checks below derive
        // "legal counter" from the top card alone.
        if top.kind != Kind::DrawTwo && top.kind != Kind::WildDrawFour {
            return Err(GameError::NoDrawCardToCounter);
        }
        if card.kind != top.kind {
            return Err(GameError::CounterKindMismatch);
        }
        if card.color != top.color {
            return Err(GameError::CounterColorMismatch);
        }
        if card.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        // The fourth win path is not an exemption from the call.
        st.require_loco_to_finish(p, 1, false)?;

        st.hands[p].remove(card)?;
        let chosen = resolve_chosen_color(card, chosen_color);
        st.push_discard(&[card]);
        st.log_event(EventKind::CounterDraw, seat, Some(card), chosen, now);
        st.update_last_card_state(p, now);

        if st.hands[p].size() == 0 {
            self.finish_round_win(p, chosen, now);
            return Ok(());
        }

        let next = st.apply_effect(card, chosen);
        st.has_drawn = false;
        st.current_turn = next;
        // A counter is a play like any other: a third seat may stack on it.
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// Shuffles the discard (minus its top) back under the deck when fewer
    /// than `needed` cards are left. (Go: `ensureDeck`.)
    pub(crate) fn ensure_deck(&mut self, needed: usize) {
        let Self { state, rng, .. } = self;
        let Some(st) = state.as_mut() else {
            return;
        };
        if st.deck.cards.len() >= needed || st.discard.len() <= 1 {
            return;
        }
        let top = st.top_card();
        let pile = st.discard[..st.discard.len() - 1].to_vec();
        st.deck.replenish(&pile, rng.as_mut().expect(UNSEEDED));
        st.discard = vec![top];
    }
}

/// Turns every hand one active seat on in the play direction, through
/// `rotate_seats` so a retired seat is never handed one.
fn rotate_hands(st: &mut GameState) {
    let src = st.rotate_seats(st.direction);
    let old = std::mem::take(&mut st.hands);
    st.hands = src.iter().map(|&i| old[i].clone()).collect();
}

// --- The (state, action) -> state form ----------------------------------------

/// Every action the hub can ask of a room, one per Go entry point.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Action {
    Join {
        nickname: String,
    },
    SetFormat(MatchFormat),
    SetMaxPlayers(i32),
    SwapLobbyPlayers {
        a: Seat,
        b: Seat,
    },
    RemoveLobbyPlayer {
        seat: Seat,
    },
    Start,
    PlayCard {
        seat: Seat,
        card: Card,
        chosen_color: Color,
        chosen_player: Seat,
    },
    PlayCards {
        seat: Seat,
        cards: Vec<Card>,
        chosen_color: Color,
        chosen_player: Seat,
        declare_loco: bool,
    },
    DrawCard {
        seat: Seat,
    },
    PassTurn {
        seat: Seat,
    },
    DeclareLastCard {
        seat: Seat,
    },
    CatchUndeclared {
        catcher: Seat,
        target: Seat,
    },
    PenalizeFailedCatch {
        catcher: Seat,
    },
    LockCatch {
        catcher: Seat,
    },
    InterruptPlayCards {
        seat: Seat,
        cards: Vec<Card>,
        chosen_color: Color,
        chosen_player: Seat,
    },
    CounterDraw {
        seat: Seat,
        card: Card,
        chosen_color: Color,
    },
    ForfeitTo {
        winner: Seat,
    },
    RetireSeat {
        seat: Seat,
    },
    BeginNextRound,
    ResetForRematch,
}

/// What an applied action produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    /// An entry the action appended to the round's event log, in order.
    Logged(GameEvent),
    /// `RemoveLobbyPlayer`'s answer: whether the seat removed was the host.
    SeatRemoved { seat: Seat, was_host: bool },
    /// `PenalizeFailedCatch`'s answer: the cards drawn and whether the seat was
    /// charged at all (`charged == false` is a press nobody hears about).
    FailedCatch {
        catcher: Seat,
        cards: Vec<Card>,
        charged: bool,
    },
    /// `LockCatch`'s answer: when the lockout now ends (`None` for a seat the
    /// table does not have).
    CatchLocked {
        catcher: Seat,
        until: Option<Millis>,
    },
}

impl Room {
    /// Applies one action at `now` and returns the next room and what the
    /// action produced, leaving `self` untouched. A refusal returns the error
    /// and nothing else: there is no half-applied room to observe.
    pub fn apply(&self, action: Action, now: Millis) -> Result<(Room, Vec<Event>), GameError> {
        if self.rng.is_none() {
            return Err(GameError::Unseeded);
        }
        let mut next = self.clone();
        let log_before = match action {
            // A deal replaces the log: everything in the new one is news.
            Action::Start | Action::BeginNextRound => 0,
            _ => self.state.as_ref().map_or(0, |s| s.event_log.len()),
        };
        let mut events = Vec::new();
        match action {
            Action::Join { nickname } => next.join(&nickname)?,
            Action::SetFormat(f) => next.set_format(f)?,
            Action::SetMaxPlayers(n) => next.set_max_players(n)?,
            Action::SwapLobbyPlayers { a, b } => next.swap_lobby_players(a, b)?,
            Action::RemoveLobbyPlayer { seat } => {
                let was_host = next.remove_lobby_player(seat)?;
                events.push(Event::SeatRemoved { seat, was_host });
            }
            Action::Start => next.start(now)?,
            Action::PlayCard {
                seat,
                card,
                chosen_color,
                chosen_player,
            } => next.play_card(seat, card, chosen_color, chosen_player, now)?,
            Action::PlayCards {
                seat,
                cards,
                chosen_color,
                chosen_player,
                declare_loco,
            } => next.play_cards(seat, &cards, chosen_color, chosen_player, declare_loco, now)?,
            Action::DrawCard { seat } => next.draw_card(seat, now)?,
            Action::PassTurn { seat } => next.pass_turn(seat, now)?,
            Action::DeclareLastCard { seat } => next.declare_last_card(seat, now)?,
            Action::CatchUndeclared { catcher, target } => {
                next.catch_undeclared(catcher, target, now)?
            }
            Action::PenalizeFailedCatch { catcher } => {
                let (cards, charged) = next.penalize_failed_catch(catcher, now);
                events.push(Event::FailedCatch {
                    catcher,
                    cards,
                    charged,
                });
            }
            Action::LockCatch { catcher } => {
                let until = next.lock_catch(catcher, now);
                events.push(Event::CatchLocked { catcher, until });
            }
            Action::InterruptPlayCards {
                seat,
                cards,
                chosen_color,
                chosen_player,
            } => next.interrupt_play_cards(seat, &cards, chosen_color, chosen_player, now)?,
            Action::CounterDraw {
                seat,
                card,
                chosen_color,
            } => next.counter_draw(seat, card, chosen_color, now)?,
            Action::ForfeitTo { winner } => next.forfeit_to(winner, now)?,
            Action::RetireSeat { seat } => next.retire_seat(seat, now)?,
            Action::BeginNextRound => next.begin_next_round(now)?,
            Action::ResetForRematch => next.reset_for_rematch()?,
        }
        let logged: Vec<Event> = next
            .state
            .as_ref()
            .map(|s| {
                s.event_log
                    .iter()
                    .skip(log_before)
                    .cloned()
                    .map(Event::Logged)
                    .collect()
            })
            .unwrap_or_default();
        // Log entries first, in the order they were recorded, then the answer.
        let mut out = logged;
        out.extend(events);
        Ok((next, out))
    }
}
