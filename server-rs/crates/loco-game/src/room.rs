//! The room: lobby, match, rounds and every command a seat can issue
//! (`server/game/room.go`).
//!
//! **One way in.** A `Room` is owned by exactly one table task, and every
//! command is a `&mut self` method that validates first and mutates second: a
//! command that returns `Err` has left the room exactly as it was (the
//! proptests hold every command to that). The task reads what it needs to
//! broadcast off the room afterwards, the way the Go hub did, so a command
//! returns only what the room cannot tell it later: whether a removed seat was
//! the host, what a failed catch cost, when a lockout ends. There is no second,
//! functional entry point: a clone of the room before the call is the
//! "previous state" wherever a test or a replay wants one.
//!
//! **Time is data.** Every command that stamps or compares an instant takes
//! `now` (Unix milliseconds); the crate never reads a clock.
//!
//! **Randomness is the room's own.** A `Room` cannot exist without its
//! `ChaCha12Rng`: `Room::new` takes the seed, and the drain snapshot
//! (`SavedRoom`) is restored with a fresh one. Go seeded lazily
//! (`ensureRNG`) because a decoded struct could arrive without a source; here
//! that state is unrepresentable.

use crate::card::{Card, Color, Kind, card_value};
use crate::deck::Deck;
use crate::error::GameError;
use crate::event::EventKind;
use crate::hand::Hand;
use crate::maps::{MapId, TimeOfDay, Weather};
use crate::rules::can_play;
use crate::state::{GameState, SeatState, resolve_chosen_color};
use crate::{Millis, Seat, rng};
use rand_chacha::ChaCha12Rng;
use rand_core::SeedableRng;
use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};

/// The lifecycle state of a room. Go's `iota` integers in JSON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize_repr, Deserialize_repr)]
#[repr(u8)]
pub enum Status {
    #[default]
    Lobby = 0,
    Playing = 1,
    Finished = 2,
}

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

/// How many rounds make up a match. Go kept it an `int` and refused bad values
/// in `SetFormat`; here a bad value cannot be built, and the refusal (with
/// Go's text) is the conversion's.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    PartialOrd,
    Ord,
    Default,
    Serialize_repr,
    Deserialize_repr,
)]
#[repr(u8)]
pub enum MatchFormat {
    #[default]
    Bo1 = 1,
    Bo3 = 3,
    Bo5 = 5,
    Bo7 = 7,
}

impl MatchFormat {
    /// The number of rounds the format names.
    pub const fn rounds(self) -> u32 {
        self as u32
    }
}

impl TryFrom<i64> for MatchFormat {
    type Error = GameError;

    fn try_from(n: i64) -> Result<Self, GameError> {
        match n {
            1 => Ok(MatchFormat::Bo1),
            3 => Ok(MatchFormat::Bo3),
            5 => Ok(MatchFormat::Bo5),
            7 => Ok(MatchFormat::Bo7),
            _ => Err(GameError::InvalidMatchFormat(n)),
        }
    }
}

// The numbers below are read by client tests (serverMirrors, contentPages,
// seatLayout, seo), so each stays a plain literal on its own line.

/// A new table opens at the cap.
pub const DEFAULT_MAX_PLAYERS: usize = 7;
/// The fewest seats a match can be played at.
pub const SERVER_MIN_PLAYERS: usize = 2;
/// The most seats a table can hold.
pub const SERVER_MAX_PLAYERS: usize = 7;
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

/// Per-player metadata.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Player {
    #[serde(rename = "Nickname")]
    pub nickname: String,
    #[serde(rename = "Index")]
    pub index: Seat,
}

/// What a Contre-LOCO! that found nobody cost its caller
/// ([`Room::penalize_failed_catch`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatchCharge {
    /// Nothing: nothing was on offer, the caller is locked out, or it already
    /// paid for this offer. The press is nobody else's business.
    Free,
    /// One card, or nothing at all once both piles are dry: charged all the
    /// same, so the offer is spent.
    Charged { drawn: Vec<Card> },
}

/// A single game session: the lobby, the match and its rounds.
#[derive(Debug, Clone, PartialEq)]
pub struct Room {
    pub code: String,
    pub status: Status,
    pub players: Vec<Player>,
    /// The round being played; `None` in the lobby and after a rematch reset.
    pub state: Option<GameState>,
    /// Round winner's nickname for the just-completed round.
    pub winner: String,
    pub format: MatchFormat,
    pub max_players: usize,
    /// The room, hour and sky this match is played under: drawn once per match
    /// by `start`, cleared by a rematch. Presentation only.
    pub map_id: Option<MapId>,
    pub map_time: Option<TimeOfDay>,
    pub map_weather: Option<Weather>,
    /// Current round, 1-based, set to 1 by `start`.
    pub round_number: u32,
    /// Cumulative match scores per seat.
    pub scores: Vec<i32>,
    /// Rounds won per seat.
    pub rounds_won: Vec<u32>,
    /// Sum of remaining hand values for the round losers (a tiebreaker).
    pub lost_hand_total: Vec<i32>,
    /// The seats that walked out of this match. Match-level: survives every
    /// deal, cleared when a new match starts.
    pub retired: Vec<bool>,
    /// `round_history[k][seat]` = points that seat scored in round k+1.
    pub round_history: Vec<Vec<i32>>,
    /// Signals for the hub (set by `end_round`, cleared by the hub).
    pub round_ended: bool,
    pub match_over: bool,
    pub match_winner: String,
    /// The room's one source of randomness: the map, the opening seat and
    /// every shuffle.
    rng: ChaCha12Rng,
}

/// The tiebreak filter: the candidates whose score equals the best.
fn filter_best(candidates: Vec<Seat>, score_of: impl Fn(Seat) -> i64) -> Vec<Seat> {
    let Some(best) = candidates.iter().map(|&i| score_of(i)).max() else {
        return candidates;
    };
    candidates
        .into_iter()
        .filter(|&i| score_of(i) == best)
        .collect()
}

/// Removes index `i` from a per-seat vector too short to hold it untouched.
fn drop_seat<T>(v: &mut Vec<T>, i: Seat) {
    if i < v.len() {
        v.remove(i);
    }
}

impl Room {
    /// An empty lobby, seeded with 32 bytes the caller drew from the OS.
    pub fn new(code: impl Into<String>, seed: [u8; 32]) -> Room {
        Room::with_rng(code.into(), ChaCha12Rng::from_seed(seed))
    }

    /// An empty lobby seeded from a `u64`, for tests and fixtures. Never for a
    /// real table: 64 bits a caller can reproduce is the clock-seed attack
    /// (`tests/rng_test.rs`).
    pub fn from_u64_seed(code: impl Into<String>, seed: u64) -> Room {
        Room::with_rng(code.into(), ChaCha12Rng::seed_from_u64(seed))
    }

    fn with_rng(code: String, rng: ChaCha12Rng) -> Room {
        Room {
            code,
            status: Status::Lobby,
            players: Vec::new(),
            state: None,
            winner: String::new(),
            format: MatchFormat::Bo1,
            max_players: DEFAULT_MAX_PLAYERS,
            map_id: None,
            map_time: None,
            map_weather: None,
            round_number: 0,
            scores: Vec::new(),
            rounds_won: Vec::new(),
            lost_hand_total: Vec::new(),
            retired: Vec::new(),
            round_history: Vec::new(),
            round_ended: false,
            match_over: false,
            match_winner: String::new(),
            rng,
        }
    }

    pub(crate) fn rng_mut(&mut self) -> &mut ChaCha12Rng {
        &mut self.rng
    }

    /// The round being played, refusing like Go did when there is none.
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
        self.format = f;
        Ok(())
    }

    /// Sets the seat cap (lobby only; never below the seats taken). (Go:
    /// `SetMaxPlayers`.)
    pub fn set_max_players(&mut self, n: usize) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::MaxPlayersLocked);
        }
        if n < SERVER_MIN_PLAYERS {
            return Err(GameError::MaxPlayersTooLow(SERVER_MIN_PLAYERS));
        }
        if n > SERVER_MAX_PLAYERS {
            return Err(GameError::MaxPlayersTooHigh(SERVER_MAX_PLAYERS));
        }
        if n < self.players.len() {
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
        if a >= self.players.len() || b >= self.players.len() {
            return Err(GameError::InvalidSeatPair);
        }
        self.players.swap(a, b);
        self.players[a].index = a;
        self.players[b].index = b;
        Ok(())
    }

    /// Removes a seat from the lobby (or a finished room), re-indexes the rest
    /// and re-bases everything the scoreboard is drawn from. Returns whether
    /// the removed seat was the host. (Go: `RemoveLobbyPlayer`.)
    pub fn remove_lobby_player(&mut self, seat: Seat) -> Result<bool, GameError> {
        if self.status != Status::Lobby && self.status != Status::Finished {
            return Err(GameError::RemoveOnlyInLobby);
        }
        if seat >= self.players.len() {
            return Err(GameError::InvalidPlayerIndex(seat));
        }
        self.players.remove(seat);
        for (k, p) in self.players.iter_mut().enumerate() {
            p.index = k;
        }
        drop_seat(&mut self.scores, seat);
        drop_seat(&mut self.rounds_won, seat);
        drop_seat(&mut self.lost_hand_total, seat);
        drop_seat(&mut self.retired, seat);
        for row in &mut self.round_history {
            drop_seat(row, seat);
        }
        Ok(seat == 0)
    }

    /// Adds a player to the lobby. (Go: `Join`.)
    pub fn join(&mut self, nickname: &str) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::GameAlreadyInProgress);
        }
        if self.players.len() >= self.max_players {
            return Err(GameError::RoomFull(self.max_players));
        }
        if self.players.iter().any(|p| p.nickname == nickname) {
            return Err(GameError::NicknameTaken(nickname.to_string()));
        }
        self.players.push(Player {
            nickname: nickname.to_string(),
            index: self.players.len(),
        });
        Ok(())
    }

    /// Begins the match: deals the first round, the opener drawn at random.
    /// (Go: `Start`.)
    pub fn start(&mut self, now: Millis) -> Result<(), GameError> {
        if self.status != Status::Lobby {
            return Err(GameError::GameAlreadyStarted);
        }
        if self.players.len() < SERVER_MIN_PLAYERS {
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
        let opener = rng::below(&mut self.rng, n);
        self.deal_round(opener, now);
        Ok(())
    }

    /// Sets up a fresh round. A retired seat is dealt nothing and keeps its
    /// index. The opening discard is always a Number, and the interrupt window
    /// is open on it with nobody as its author. (Go: `dealRound`.)
    pub(crate) fn deal_round(&mut self, opener: Seat, now: Millis) {
        let n = self.players.len();
        let mut deck = Deck::standard();
        deck.shuffle(&mut self.rng);

        let seats: Vec<SeatState> = (0..n)
            .map(|i| SeatState {
                retired: self.retired.get(i).copied().unwrap_or(false),
                ..SeatState::default()
            })
            .collect();
        let hands = seats
            .iter()
            .map(|s| match s.retired {
                true => Hand::default(),
                false => Hand::of(deck.draw_n(INITIAL_HAND_SIZE).unwrap_or_default()),
            })
            .collect();

        // Flip the first card: the round must begin on a number. The cards
        // turned over on the way go back under the deck.
        let mut first = Card::default();
        let mut spill = Vec::new();
        while let Some(c) = deck.draw() {
            if c.kind == Kind::Number {
                first = c;
                break;
            }
            spill.push(c);
        }
        spill.append(&mut deck.cards);
        deck.cards = spill;

        let mut st = GameState {
            hands,
            deck,
            discard: vec![first],
            current_turn: if opener < n { opener } else { 0 },
            direction: 1,
            active_color: first.color,
            interrupt_open: true,
            last_play_by: None,
            seats,
            ..GameState::default()
        };
        // The seat that opens the round has to be one that can play.
        if st.is_retired(st.current_turn) {
            st.current_turn = st.next_turn(st.current_turn);
        }
        st.log_event(EventKind::GameStarted, None, None, Color::Red, now);
        self.state = Some(st);
    }

    // --- Plays -------------------------------------------------------------

    /// Plays one card from `seat`'s hand. `chosen_color` names the colour for
    /// a wild; `target` is the Swap's other seat. (Go: `PlayCard`.)
    pub fn play_card(
        &mut self,
        seat: Seat,
        card: Card,
        chosen_color: Color,
        target: Option<Seat>,
        now: Millis,
    ) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat || !st.has_seat(seat) {
            return Err(GameError::NotYourTurn);
        }
        if st.pending_draw > 0 {
            return Err(GameError::MustAnswerPenalty);
        }
        if !st.hands[seat].contains(card) {
            return Err(GameError::CardNotInHand);
        }
        if !can_play(card, st.top_card(), st.active_color) {
            return Err(GameError::IllegalPlay);
        }
        // Every wild names the colour that becomes active, GlobalSwitch too.
        if card.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        let swap_with = match card.kind {
            Kind::Swap => Some(swap_target(st, seat, target, false)?),
            _ => None,
        };
        // Last in the validation block: an illegal card is refused as illegal,
        // and only a card that would take the round is asked about the call.
        st.require_loco_to_finish(seat, 1, false)?;

        st.hands[seat].remove(card)?;
        let chosen = resolve_chosen_color(card, chosen_color);
        st.push_discard(&[card]);
        st.log_event(EventKind::CardPlayed, Some(seat), Some(card), chosen, now);

        // A Swap or GlobalSwitch that empties the hand ends the round before
        // any hand moves (rules.md §11.1).
        if st.hands[seat].is_empty() {
            self.finish_round_win(seat, chosen, now);
            return Ok(());
        }
        rearrange(st, seat, card, swap_with, now);
        st.current_turn = st.apply_effect(card, chosen);
        st.has_drawn = false;
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
        target: Option<Seat>,
        declare_loco: bool,
        now: Millis,
    ) -> Result<(), GameError> {
        let (first, rest) = match cards {
            [] => return Err(GameError::NoCardsSpecified),
            [one] => return self.play_card(seat, *one, chosen_color, target, now),
            [first, rest @ ..] => (*first, rest),
        };
        if rest.iter().any(|c| *c != first) {
            return Err(GameError::BatchNotIdentical);
        }
        if matches!(first.kind, Kind::Swap | Kind::GlobalSwitch) {
            return Err(GameError::BatchOfRearrangers);
        }
        let st = self.playing_state()?;
        if st.current_turn != seat || !st.has_seat(seat) {
            return Err(GameError::NotYourTurn);
        }
        if st.pending_draw > 0 {
            return Err(GameError::MustAnswerPenalty);
        }
        let have = st.count_in_hand(seat, first);
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
        let finishing = st.hands[seat].len() == cards.len();
        st.require_loco_to_finish(seat, cards.len(), declare_loco)?;

        for _ in cards {
            st.hands[seat].remove(first)?;
        }
        let chosen = resolve_chosen_color(first, chosen_color);
        st.push_discard(cards);
        // The call is logged before the cards, in the order the table hears it.
        if finishing {
            st.declare_for_finish(seat, now);
        }
        st.update_last_card_state(seat, now);
        for c in cards {
            st.log_event(EventKind::CardPlayed, Some(seat), Some(*c), chosen, now);
        }

        if st.hands[seat].is_empty() {
            self.finish_round_win(seat, chosen, now);
            return Ok(());
        }
        st.current_turn = st.apply_effect(first, chosen);
        st.stack_batch_effects(first, rest.len() as u32);
        st.has_drawn = false;
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// The one win path every hand-emptying play goes through: locks in the
    /// colour, closes the interrupt window, logs the finish, ends the round.
    /// (Go: `finishRoundWin`.)
    fn finish_round_win(&mut self, winner: Seat, active_color: Color, now: Millis) {
        if let Some(st) = self.state.as_mut() {
            st.set_active_color(active_color);
            st.close_interrupt_window();
            st.log_event(EventKind::GameFinished, Some(winner), None, Color::Red, now);
        }
        self.end_round(winner, now);
    }

    /// Finalises the round: the winner scores the sum of every other hand,
    /// everyone else scores 0 (their hand value goes to the tiebreak). Then the
    /// match stops if the lead can no longer be caught or the format has run
    /// out with somebody separable; otherwise the hub deals the next round.
    /// (Go: `endRound`.)
    pub(crate) fn end_round(&mut self, winner: Seat, now: Millis) {
        let Some(st) = self.state.as_mut() else {
            return;
        };
        self.winner = self.players[winner].nickname.clone();
        self.rounds_won[winner] += 1;

        let mut score = 0;
        for (i, hand) in st.hands.iter().enumerate() {
            if i != winner {
                let value: i32 = hand.cards.iter().map(|c| card_value(*c)).sum();
                score += value;
                self.lost_hand_total[i] += value;
            }
        }
        self.scores[winner] += score;

        // One row per round: everyone 0 but the finisher.
        let mut row = vec![0; self.players.len()];
        row[winner] = score;
        self.round_history.push(row);

        st.log_event(EventKind::RoundEnd, Some(winner), None, Color::Red, now);
        self.round_ended = true;

        // Two ways a match stops: a lead the rounds left cannot catch, or the
        // format running out on a table the tiebreak can separate. Otherwise
        // sudden death: the room keeps dealing.
        if (self.decisive_leader().is_some() || self.round_number >= self.format.rounds())
            && let Some(w) = self.determine_match_winner()
        {
            self.match_winner = self.players[w].nickname.clone();
            self.match_over = true;
            self.status = Status::Finished;
            if let Some(st) = self.state.as_mut() {
                st.log_event(EventKind::MatchEnd, None, None, Color::Red, now);
            }
        }
    }

    /// Ends the match now and awards it to `winner`, leaving the scoreboard
    /// exactly as it stood. (Go: `ForfeitTo`.)
    pub fn forfeit_to(&mut self, winner: Seat, now: Millis) -> Result<(), GameError> {
        if self.status != Status::Playing {
            return Err(GameError::ForfeitNotPlaying);
        }
        let Some(player) = self.players.get(winner) else {
            return Err(GameError::InvalidPlayerIndex(winner));
        };
        self.match_winner = player.nickname.clone();
        self.match_over = true;
        self.status = Status::Finished;
        if let Some(st) = self.state.as_mut() {
            st.log_event(EventKind::MatchEnd, Some(winner), None, Color::Red, now);
        }
        Ok(())
    }

    /// Whether a seat has walked out of the match, read off the match-level
    /// flags. (Go: `IsRetired`.)
    pub fn is_retired(&self, seat: Seat) -> bool {
        self.retired.get(seat).copied().unwrap_or(false)
    }

    /// Takes a seat out of the match for good: its hand goes back into the
    /// deck, the turn steps over it, its catch window shuts, and the
    /// scoreboard is left exactly as it stood. (Go: `RetireSeat`.)
    pub fn retire_seat(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let Self {
            status,
            state,
            rng,
            retired,
            ..
        } = self;
        let st = state
            .as_mut()
            .filter(|_| *status == Status::Playing)
            .ok_or(GameError::GameNotInProgress)?;
        if !st.has_seat(seat) {
            return Err(GameError::InvalidPlayerIndex(seat));
        }
        if st.is_retired(seat) {
            return Err(GameError::SeatAlreadyRetired);
        }

        let returned = std::mem::take(&mut st.hands[seat].cards);
        if !returned.is_empty() {
            st.deck.cards.extend(returned);
            st.deck.shuffle(rng);
        }
        if let Some(r) = retired.get_mut(seat) {
            *r = true;
        }
        // No cards, so no obligation and no window.
        let s = &mut st.seats[seat];
        s.retired = true;
        s.declared = true;
        s.last_card_at = None;

        if st.current_turn == seat {
            st.has_drawn = false;
            // A stack aimed at the seat dies with it.
            st.pending_draw = 0;
            st.current_turn = st.next_turn(seat);
            st.close_interrupt_window();
        }
        st.log_event(EventKind::SeatRetired, Some(seat), None, Color::Red, now);
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
        self.scores.clear();
        self.rounds_won.clear();
        self.lost_hand_total.clear();
        self.retired.clear();
        self.round_history.clear();
        Ok(())
    }

    /// The seat whose lead in rounds won can no longer be caught. One
    /// expression for both endings: `remaining` is zero once the format is
    /// exhausted. (Go: `decisiveLeader`.)
    pub(crate) fn decisive_leader(&self) -> Option<Seat> {
        let remaining = self.format.rounds().saturating_sub(self.round_number);
        let rw = &self.rounds_won;
        (0..rw.len()).find(|&i| (0..rw.len()).all(|j| i == j || rw[i] > rw[j] + remaining))
    }

    /// The seat with the lowest cumulative score, which opens the next round;
    /// ties go to the lowest index, retired seats are skipped. Deliberately on
    /// points, not rounds won. (Go: `biggestLoser`.)
    pub(crate) fn biggest_loser(&self) -> Seat {
        (0..self.scores.len())
            .filter(|&i| !self.is_retired(i))
            .min_by_key(|&i| (self.scores[i], i))
            .unwrap_or(0)
    }

    /// The match winner by the tiebreak chain: most rounds won, then highest
    /// score, then lowest lost-hand total. `None` means sudden death. (Go:
    /// `determineMatchWinner`, which returned the nickname or "".)
    pub(crate) fn determine_match_winner(&self) -> Option<Seat> {
        let mut c: Vec<Seat> = (0..self.players.len()).collect();
        let chain: [&dyn Fn(Seat) -> i64; 3] = [
            &|i| i64::from(self.rounds_won[i]),
            &|i| i64::from(self.scores[i]),
            &|i| -i64::from(self.lost_hand_total[i]),
        ];
        for score_of in chain {
            c = filter_best(c, score_of);
            if let [only] = c[..] {
                return Some(only);
            }
        }
        None
    }

    // --- Draw, pass, declare ----------------------------------------------

    /// The seat at turn draws one card, or the whole pending stack. Either way
    /// it keeps the turn (rules.md §14.5). Never fails once validated: the
    /// draw shrinks to what the piles hold. (Go: `DrawCard`.)
    pub fn draw_card(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if st.current_turn != seat || !st.has_seat(seat) {
            return Err(GameError::NotYourTurn);
        }
        let n = match st.pending_draw {
            0 if st.has_drawn => return Err(GameError::AlreadyDrawn),
            0 => 1,
            stack => stack as usize,
        };

        // Nothing above this line touched the state, nothing below can fail.
        let st = self.ensure_deck(n);
        let cards = st.deck.draw_up_to(n);
        let before = st.hands[seat].len();
        st.hands[seat].add(&cards);
        st.note_hand_grew(seat, before, now);
        // The stack is settled by whatever the piles could give.
        st.pending_draw = 0;
        st.has_drawn = true;
        st.close_interrupt_window();
        st.log_event(EventKind::CardDrawn, Some(seat), None, Color::Red, now);
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
        st.log_event(EventKind::TurnPassed, Some(seat), None, Color::Red, now);
        Ok(())
    }

    /// Records a seat calling LOCO! on its last card. A late call is always
    /// accepted while the hand is one card; a declaration is a one-shot until a
    /// new window opens. (Go: `DeclareLastCard`.)
    pub fn declare_last_card(&mut self, seat: Seat, now: Millis) -> Result<(), GameError> {
        let st = self.playing_state()?;
        if !st.has_seat(seat) {
            return Err(GameError::InvalidPlayerIndex(seat));
        }
        if st.hands[seat].len() != 1 {
            return Err(GameError::DeclareNeedsOneCard);
        }
        if st.seats[seat].declared {
            return Err(GameError::AlreadyDeclared);
        }
        st.seats[seat].declared = true;
        st.log_event(EventKind::UnoDeclared, Some(seat), None, Color::Red, now);
        Ok(())
    }

    // --- The catch ---------------------------------------------------------

    /// Whether a Contre-LOCO! from `catcher` is a wager at `now`: whether any
    /// other seat is near enough the finish for the button to be live on an
    /// honest screen. (Go: `CatchOffered`.)
    pub fn catch_offered(&self, catcher: Seat, now: Millis) -> bool {
        match &self.state {
            Some(st) if self.status == Status::Playing && st.has_seat(catcher) => {
                (0..st.hands.len()).any(|i| st.catch_offered_seat(catcher, i, now))
            }
            _ => false,
        }
    }

    /// When `catcher`'s lockout ends; `None` when it is not locked or the seat
    /// is out of range. (Go: `CatchLockedAt`.)
    pub fn catch_locked_at(&self, catcher: Seat) -> Option<Millis> {
        self.state.as_ref()?.seats.get(catcher)?.catch_locked_until
    }

    /// Whether `catcher` is inside its lockout at `now`. (Go: `CatchLocked`.)
    pub fn catch_locked(&self, catcher: Seat, now: Millis) -> bool {
        self.catch_locked_at(catcher).is_some_and(|at| now < at)
    }

    /// Arms or re-arms `catcher`'s lockout and returns when it now ends.
    /// Touches nothing else. (Go: `LockCatch`.)
    pub fn lock_catch(&mut self, catcher: Seat, now: Millis) -> Option<Millis> {
        let seat = self.state.as_mut()?.seats.get_mut(catcher)?;
        let until = now + CATCH_LOCKOUT_MS;
        seat.catch_locked_until = Some(until);
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
        if !st.has_seat(target) {
            return Err(GameError::InvalidTarget(target));
        }
        if !st.has_seat(catcher) {
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
        if !st.catch_race_recent(target, now) {
            return Err(GameError::NoCatchWindow);
        }
        if st.seats[target].declared {
            return Err(GameError::AlreadyDeclared);
        }
        if st.hands[target].len() != 1 {
            return Err(GameError::TargetNotSingleCard);
        }
        if !st.catch_window_open(target, now) {
            return Err(GameError::CatchWindowExpired);
        }

        let st = self.ensure_deck(UNDECLARED_PENALTY);
        let cards = st.deck.draw_up_to(UNDECLARED_PENALTY);
        st.hands[target].add(&cards);
        // The penalty settles the debt, however many cards it came to.
        st.seats[target].declared = true;
        st.log_event(EventKind::UnoCaught, Some(catcher), None, Color::Red, now);
        Ok(())
    }

    /// Charges `catcher` one card for a Contre-LOCO! that found nothing, at
    /// most once per offer and only while one is on the table. Touches nothing
    /// but the caller's hand and ration. (Go: `PenalizeFailedCatch`.)
    pub fn penalize_failed_catch(&mut self, catcher: Seat, now: Millis) -> CatchCharge {
        // Inside its lockout a seat pays nothing: that press was paid for.
        if !self.catch_offered(catcher, now) || self.catch_locked(catcher, now) {
            return CatchCharge::Free;
        }
        let Some(st) = self.state.as_mut() else {
            return CatchCharge::Free;
        };
        let key = st.catch_offer_key(catcher, now);
        if st.seats[catcher].catch_paid_for == key {
            return CatchCharge::Free;
        }
        st.seats[catcher].catch_paid_for = key;
        let st = self.ensure_deck(FAILED_CATCH_PENALTY);
        let drawn = st.deck.draw_up_to(FAILED_CATCH_PENALTY);
        if !drawn.is_empty() {
            let before = st.hands[catcher].len();
            st.hands[catcher].add(&drawn);
            st.note_hand_grew(catcher, before, now);
            st.log_event(EventKind::CatchFailed, Some(catcher), None, Color::Red, now);
        }
        CatchCharge::Charged { drawn }
    }

    // --- Interrupts and counters ------------------------------------------

    /// Any seat takes the lead by slamming ONE card identical to the top
    /// discard. No deadline, nobody excluded; the first message to arrive
    /// wins. The list form exists so a batch off the wire is refused rather
    /// than assumed. (Go: `InterruptPlayCards` / `InterruptPlay`.)
    pub fn interrupt_play(
        &mut self,
        seat: Seat,
        cards: &[Card],
        chosen_color: Color,
        target: Option<Seat>,
        now: Millis,
    ) -> Result<(), GameError> {
        let st = self.playing_state()?;
        let card = match cards {
            [] => return Err(GameError::NoCardsSpecified),
            [one] => *one,
            _ => return Err(GameError::InterruptBatch),
        };
        if !st.interrupt_open {
            return Err(GameError::InterruptWindowClosed);
        }
        if st.pending_draw > 0 && !matches!(card.kind, Kind::DrawTwo | Kind::WildDrawFour) {
            return Err(GameError::InterruptNotADrawCard);
        }
        if card.is_wild() && chosen_color == Color::Wild {
            return Err(GameError::MustChooseColor);
        }
        if !st.has_seat(seat) {
            return Err(GameError::InvalidPlayerIndex(seat));
        }
        if !st.hands[seat].contains(card) {
            return Err(GameError::CardNotInHand);
        }
        if card != st.top_card() {
            return Err(GameError::InterruptMismatch);
        }
        let swap_with = match card.kind {
            Kind::Swap => Some(swap_target(st, seat, target, true)?),
            _ => None,
        };
        // One card off a one-card hand takes the round, and that seat owed the
        // call before this message.
        st.require_loco_to_finish(seat, 1, false)?;

        let chosen = resolve_chosen_color(card, chosen_color);
        st.hands[seat].remove(card)?;
        st.push_discard(&[card]);
        st.log_event(EventKind::CardPlayed, Some(seat), Some(card), chosen, now);

        // A round-ending interject aborts the Swap / GlobalSwitch (rules.md §13).
        if st.hands[seat].is_empty() {
            self.finish_round_win(seat, chosen, now);
            return Ok(());
        }
        rearrange(st, seat, card, swap_with, now);
        // The lead transfers: the effect applies from the interjecter's seat.
        st.current_turn = seat;
        st.current_turn = st.apply_effect(card, chosen);
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
        if st.current_turn != seat || !st.has_seat(seat) {
            return Err(GameError::NotYourTurn);
        }
        if st.pending_draw == 0 {
            return Err(GameError::NoPendingDraw);
        }
        if !st.hands[seat].contains(card) {
            return Err(GameError::CardNotInHand);
        }
        let top = st.top_card();
        // Unreachable today, written down because the checks below derive
        // "legal counter" from the top card alone.
        if !matches!(top.kind, Kind::DrawTwo | Kind::WildDrawFour) {
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
        st.require_loco_to_finish(seat, 1, false)?;

        st.hands[seat].remove(card)?;
        let chosen = resolve_chosen_color(card, chosen_color);
        st.push_discard(&[card]);
        st.log_event(EventKind::CounterDraw, Some(seat), Some(card), chosen, now);
        st.update_last_card_state(seat, now);

        if st.hands[seat].is_empty() {
            self.finish_round_win(seat, chosen, now);
            return Ok(());
        }
        st.current_turn = st.apply_effect(card, chosen);
        st.has_drawn = false;
        // A counter is a play like any other: a third seat may stack on it.
        st.arm_interrupt_window(seat, now);
        Ok(())
    }

    /// Shuffles the discard (minus its top) back under the deck when fewer
    /// than `needed` cards are left, and hands back the round. Only called
    /// with a round dealt. (Go: `ensureDeck`.)
    pub(crate) fn ensure_deck(&mut self, needed: usize) -> &mut GameState {
        let st = self.state.as_mut().expect("a round is dealt");
        if st.deck.cards.len() < needed && st.discard.len() > 1 {
            let top = st.discard.pop().expect("pile is not empty");
            let pile = std::mem::replace(&mut st.discard, vec![top]);
            st.deck.replenish(&pile, &mut self.rng);
        }
        st
    }
}

/// Validates a Swap's other seat before anything moves. The interject path
/// folds the "yourself" refusal into the bad-target one, as Go's did.
fn swap_target(
    st: &GameState,
    seat: Seat,
    target: Option<Seat>,
    interject: bool,
) -> Result<Seat, GameError> {
    let bad = || GameError::InvalidSwapTarget(target);
    let t = target.filter(|&t| st.has_seat(t)).ok_or_else(bad)?;
    if t == seat {
        return Err(if interject {
            bad()
        } else {
            GameError::CannotSwapWithYourself
        });
    }
    if st.is_retired(t) {
        return Err(GameError::SeatHasLeft);
    }
    Ok(t)
}

/// Moves hands for a Swap or a GlobalSwitch, then opens whatever catch windows
/// the play owes: every seat left on one card after a rearrangement, the actor
/// alone otherwise.
fn rearrange(st: &mut GameState, seat: Seat, card: Card, swap_with: Option<Seat>, now: Millis) {
    match card.kind {
        Kind::Swap => {
            if let Some(t) = swap_with {
                st.hands.swap(seat, t);
            }
            st.open_catch_windows_after_rearrange(now);
        }
        Kind::GlobalSwitch => {
            // Through rotate_seats, so a retired seat is never handed one.
            let from = st.rotate_seats();
            let mut old: Vec<Option<Hand>> = std::mem::take(&mut st.hands)
                .into_iter()
                .map(Some)
                .collect();
            st.hands = from
                .iter()
                .map(|&i| old[i].take().unwrap_or_default())
                .collect();
            st.open_catch_windows_after_rearrange(now);
        }
        _ => st.update_last_card_state(seat, now),
    }
}

// --- The drain snapshot -------------------------------------------------------

/// A room as the drain snapshot writes it: Go's `json.Marshal(game.Room)`,
/// field for field (schema version 5), so a snapshot written by either server
/// restores on the other. It carries no source of randomness, exactly as Go's
/// unexported `rng` was never written: [`SavedRoom::restore`] takes a fresh
/// seed, which is the only way back to a [`Room`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SavedRoom {
    #[serde(rename = "Code")]
    pub code: String,
    #[serde(rename = "Status")]
    pub status: Status,
    #[serde(rename = "Players", with = "crate::gojson::nil_when_empty")]
    pub players: Vec<Player>,
    #[serde(rename = "State")]
    pub state: Option<GameState>,
    #[serde(rename = "Winner")]
    pub winner: String,
    #[serde(rename = "Format")]
    pub format: MatchFormat,
    #[serde(rename = "MaxPlayers")]
    pub max_players: usize,
    #[serde(rename = "MapID", with = "crate::maps::empty_is_none")]
    pub map_id: Option<MapId>,
    #[serde(rename = "MapTime", with = "crate::maps::empty_is_none")]
    pub map_time: Option<TimeOfDay>,
    #[serde(rename = "MapWeather", with = "crate::maps::empty_is_none")]
    pub map_weather: Option<Weather>,
    #[serde(rename = "RoundNumber")]
    pub round_number: u32,
    #[serde(rename = "Scores", with = "crate::gojson::nil_when_empty")]
    pub scores: Vec<i32>,
    #[serde(rename = "RoundsWon", with = "crate::gojson::nil_when_empty")]
    pub rounds_won: Vec<u32>,
    #[serde(rename = "LostHandTotal", with = "crate::gojson::nil_when_empty")]
    pub lost_hand_total: Vec<i32>,
    #[serde(rename = "Retired", with = "crate::gojson::nil_when_empty")]
    pub retired: Vec<bool>,
    #[serde(rename = "RoundHistory", with = "crate::gojson::nil_when_empty")]
    pub round_history: Vec<Vec<i32>>,
    #[serde(rename = "RoundEnded")]
    pub round_ended: bool,
    #[serde(rename = "MatchOver")]
    pub match_over: bool,
    #[serde(rename = "MatchWinner")]
    pub match_winner: String,
}

impl From<&Room> for SavedRoom {
    fn from(r: &Room) -> Self {
        SavedRoom {
            code: r.code.clone(),
            status: r.status,
            players: r.players.clone(),
            state: r.state.clone(),
            winner: r.winner.clone(),
            format: r.format,
            max_players: r.max_players,
            map_id: r.map_id,
            map_time: r.map_time,
            map_weather: r.map_weather,
            round_number: r.round_number,
            scores: r.scores.clone(),
            rounds_won: r.rounds_won.clone(),
            lost_hand_total: r.lost_hand_total.clone(),
            retired: r.retired.clone(),
            round_history: r.round_history.clone(),
            round_ended: r.round_ended,
            match_over: r.match_over,
            match_winner: r.match_winner.clone(),
        }
    }
}

impl SavedRoom {
    /// The room again, with a source the caller drew from the OS: the restore
    /// instant is announced to everyone by the server coming back up, so it is
    /// the one moment a predictable seed would be worst.
    pub fn restore(self, seed: [u8; 32]) -> Room {
        Room {
            code: self.code,
            status: self.status,
            players: self.players,
            state: self.state,
            winner: self.winner,
            format: self.format,
            max_players: self.max_players,
            map_id: self.map_id,
            map_time: self.map_time,
            map_weather: self.map_weather,
            round_number: self.round_number,
            scores: self.scores,
            rounds_won: self.rounds_won,
            lost_hand_total: self.lost_hand_total,
            retired: self.retired,
            round_history: self.round_history,
            round_ended: self.round_ended,
            match_over: self.match_over,
            match_winner: self.match_winner,
            rng: ChaCha12Rng::from_seed(seed),
        }
    }
}
