//! One round's state: the hands, the piles, the turn, and what each seat owes
//! or is owed by the LOCO! mechanic (`GameState` in `server/game/room.go`).

use crate::card::{Card, Color, Kind};
use crate::deck::Deck;
use crate::error::GameError;
use crate::event::{EventKind, GameEvent};
use crate::hand::Hand;
use crate::room::{CATCH_GRACE_MS, CATCH_NEAR_GRACE_MS, CATCH_NEAR_HAND, CATCH_WINDOW_MS};
use crate::{Millis, Seat};
use serde::{Deserialize, Serialize};
use std::fmt::Write as _;

/// What one seat owes the table, and is owed, in the current round.
///
/// Go kept these as six parallel slices indexed by seat. They are one record
/// here because they are one seat's: they move together when a seat retires,
/// and nothing ever reads one without the seat's others at hand. The hands are
/// deliberately *not* in it: a Swap or a GlobalSwitch moves hands between
/// seats while every obligation below stays with the chair.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SeatState {
    /// The seat has left the match (copied from `Room::retired` at the deal):
    /// it holds no cards, takes no turns, and is never a target.
    pub retired: bool,
    /// Its current single card has been called (Go: `LastCardDeclared`). A
    /// one-shot: it stays true until a new window opens on the seat.
    pub declared: bool,
    /// When its catch window opened; `None` = closed (Go: `LastCardAt`).
    pub last_card_at: Option<Millis>,
    /// The offer (`GameState::catch_offer_key`) it last paid a card for with a
    /// Contre-LOCO! that found nothing; empty = never (Go: `CatchPaidFor`).
    pub catch_paid_for: String,
    /// The instant it may press Contre-LOCO! again (Go: `CatchLockedUntil`).
    pub catch_locked_until: Option<Millis>,
    /// When its hand last grew out of `CATCH_NEAR_HAND` cards (Go: `NearLeftAt`).
    pub near_left_at: Option<Millis>,
}

/// The authoritative state of one round.
///
/// Its JSON is Go's (`GameStateJson`): the drain snapshot carries it inside
/// the room, and a snapshot written by the Go server must restore here.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(into = "GameStateJson", from = "GameStateJson")]
pub struct GameState {
    pub hands: Vec<Hand>,
    pub deck: Deck,
    pub discard: Vec<Card>,
    pub current_turn: Seat,
    /// 1 = clockwise, -1 = counter-clockwise; the wire carries it as is.
    pub direction: i32,
    pub active_color: Color,
    /// Accumulated draw penalty for the seat at turn.
    pub pending_draw: u32,
    /// True once the seat at turn has drawn; reset when the turn moves.
    pub has_drawn: bool,
    /// One record per seat, indexed like `hands`.
    pub seats: Vec<SeatState>,
    pub event_log: Vec<GameEvent>,
    /// The interrupt window: open from the moment a card lands on the pile
    /// (the opening discard included) until a draw, a pass or the round's end.
    pub interrupt_open: bool,
    /// Who put the top card there; `None` for the deal, or a closed window.
    pub last_play_by: Option<Seat>,
    pub last_play_at: Option<Millis>,
}

/// The colour a played card sets active: a coloured card overrides whatever
/// the caller named with its own.
pub(crate) fn resolve_chosen_color(card: Card, chosen_color: Color) -> Color {
    if card.is_wild() {
        chosen_color
    } else {
        card.color
    }
}

impl GameState {
    /// A state holding these hands with one fresh seat record each, so a
    /// hand-built state is indexed like a dealt one. Everything else is the
    /// default: the caller sets the pile, the turn and the direction.
    pub fn with_hands(hands: Vec<Hand>) -> GameState {
        GameState {
            seats: vec![SeatState::default(); hands.len()],
            hands,
            direction: 1,
            ..GameState::default()
        }
    }

    /// Seat `i`'s record. Every dealt state sizes `seats` like `hands`.
    pub fn seat(&self, i: Seat) -> &SeatState {
        &self.seats[i]
    }

    /// Whether `i` names a seat at this table.
    pub fn has_seat(&self, i: Seat) -> bool {
        i < self.hands.len()
    }

    /// Puts played cards on the pile. Replenish is not a play and does not go
    /// through here.
    pub(crate) fn push_discard(&mut self, cards: &[Card]) {
        self.discard.extend_from_slice(cards);
    }

    /// The top of the discard pile. Always present once a round is dealt; a
    /// hand-built state with an empty pile reads the zero card.
    pub fn top_card(&self) -> Card {
        self.discard.last().copied().unwrap_or_default()
    }

    /// The only way `active_color` is written after the deal. It refuses Wild,
    /// which matches no coloured card: the last line of defence.
    pub(crate) fn set_active_color(&mut self, c: Color) {
        if c != Color::Wild {
            self.active_color = c;
        }
    }

    /// Opens or refreshes the interrupt window for the most recent play.
    pub(crate) fn arm_interrupt_window(&mut self, actor: Seat, now: Millis) {
        self.interrupt_open = true;
        self.last_play_by = Some(actor);
        self.last_play_at = Some(now);
    }

    /// Closes the interrupt window (draw, pass, round end).
    pub(crate) fn close_interrupt_window(&mut self) {
        self.interrupt_open = false;
        self.last_play_by = None;
    }

    /// Puts one seat on the hook: it owes the table a declaration and can be
    /// caught until the window elapses.
    pub(crate) fn open_catch_window(&mut self, i: Seat, now: Millis) {
        let seat = &mut self.seats[i];
        seat.declared = false;
        seat.last_card_at = Some(now);
    }

    /// Opens the actor's catch window when the play left it on one card. Only
    /// that seat is touched.
    pub(crate) fn update_last_card_state(&mut self, i: Seat, now: Millis) {
        if self.hands[i].len() == 1 {
            self.open_catch_window(i, now);
        }
    }

    /// Gates every hand-emptying play on the declaration the seat owes the
    /// table. `playing` is how many cards the play puts down, `declaring`
    /// whether the message carried the call (only read for a batch: a seat
    /// already on one card had its whole window to make it in).
    pub(crate) fn require_loco_to_finish(
        &self,
        i: Seat,
        playing: usize,
        declaring: bool,
    ) -> Result<(), GameError> {
        if self.hands[i].len() != playing {
            return Ok(());
        }
        let called = if playing == 1 {
            self.seats.get(i).is_some_and(|s| s.declared)
        } else {
            declaring
        };
        if called {
            Ok(())
        } else {
            Err(GameError::MustDeclareLoco)
        }
    }

    /// Records the call a hand-emptying batch carried, flag and log both.
    pub(crate) fn declare_for_finish(&mut self, i: Seat, now: Millis) {
        self.seats[i].declared = true;
        self.log_event(EventKind::UnoDeclared, Some(i), None, Color::Red, now);
    }

    /// Puts every seat holding a single card on the hook after a Swap or a
    /// GlobalSwitch, a seat that declared a beat earlier included.
    pub(crate) fn open_catch_windows_after_rearrange(&mut self, now: Millis) {
        for i in 0..self.hands.len() {
            if self.hands[i].len() == 1 {
                self.open_catch_window(i, now);
            }
        }
    }

    fn window_age(&self, i: Seat, now: Millis) -> Option<Millis> {
        self.seats.get(i)?.last_card_at.map(|at| now - at)
    }

    /// Whether seat `i` can still be caught at `now`.
    pub(crate) fn catch_window_open(&self, i: Seat, now: Millis) -> bool {
        self.window_age(i, now)
            .is_some_and(|age| age <= CATCH_WINDOW_MS)
    }

    /// Whether seat `i` was on the hook recently enough for a call on it to be
    /// a race at all (the window plus `CATCH_GRACE_MS`).
    pub(crate) fn catch_race_recent(&self, i: Seat, now: Millis) -> bool {
        self.window_age(i, now)
            .is_some_and(|age| age <= CATCH_WINDOW_MS + CATCH_GRACE_MS)
    }

    /// When seat `i`'s window shuts; `None` when it never opened.
    pub fn catch_window_end(&self, i: Seat) -> Option<Millis> {
        Some(self.seats.get(i)?.last_card_at? + CATCH_WINDOW_MS)
    }

    /// Whether seat `i` makes the Contre-LOCO! button worth pressing at `now`,
    /// seen from `catcher`'s chair: a window still recent enough to race, or a
    /// seat on exactly `CATCH_NEAR_HAND` cards (or just out of it).
    pub(crate) fn catch_offered_seat(&self, catcher: Seat, i: Seat, now: Millis) -> bool {
        if i == catcher || self.is_retired(i) {
            return false;
        }
        self.catch_race_recent(i, now)
            || self.hands[i].len() == CATCH_NEAR_HAND
            || self.near_recent(i, now)
    }

    /// Whether seat `i` left the two-card picture within `CATCH_NEAR_GRACE_MS`.
    pub(crate) fn near_recent(&self, i: Seat, now: Millis) -> bool {
        self.seats
            .get(i)
            .and_then(|s| s.near_left_at)
            .is_some_and(|at| now - at <= CATCH_NEAR_GRACE_MS)
    }

    /// Records seat `i` leaving the two-card picture upwards, given the size
    /// its hand had before the cards went in.
    pub(crate) fn note_hand_grew(&mut self, i: Seat, before: usize, now: Millis) {
        if before == CATCH_NEAR_HAND
            && self.hands[i].len() > before
            && let Some(seat) = self.seats.get_mut(i)
        {
            seat.near_left_at = Some(now);
        }
    }

    /// Names the offer `catcher` is pressing against: the window of every seat
    /// that has one (keyed on the window, never the hand that moves under it),
    /// and the two-card picture of every seat one play from opening one.
    pub(crate) fn catch_offer_key(&self, catcher: Seat, now: Millis) -> String {
        let mut key = String::new();
        for i in 0..self.hands.len() {
            if !self.catch_offered_seat(catcher, i, now) {
                continue;
            }
            match self.seats[i].last_card_at {
                // Go wrote UnixNano; the millisecond times a million keeps the
                // shape, so a key written by Go before a restore reads alike.
                Some(at) if self.catch_race_recent(i, now) => {
                    let _ = write!(key, "{i}@{};", at.saturating_mul(1_000_000));
                }
                _ => {
                    let _ = write!(key, "{i}:{CATCH_NEAR_HAND};");
                }
            }
        }
        key
    }

    /// Every seat that owes the table a declaration at `now`, oldest window
    /// first: the one about to expire is the one a catcher who named no target
    /// gets.
    pub fn catchable_targets(&self, now: Millis) -> Vec<Seat> {
        let mut out: Vec<Seat> = (0..self.hands.len())
            .filter(|&i| {
                self.hands[i].len() == 1
                    && !self.seats.get(i).is_some_and(|s| s.declared)
                    && self.catch_window_open(i, now)
            })
            .collect();
        out.sort_by_key(|&i| self.seats[i].last_card_at);
        out
    }

    /// Applies the `extra` further effects of a batch of identical cards;
    /// `apply_effect` has already run once for the first.
    pub(crate) fn stack_batch_effects(&mut self, card: Card, extra: u32) {
        match card.kind {
            Kind::DrawTwo => self.pending_draw += 2 * extra,
            Kind::WildDrawFour => self.pending_draw += 4 * extra,
            Kind::Skip => {
                for _ in 0..extra {
                    self.current_turn = self.next_turn(self.current_turn);
                }
            }
            Kind::Reverse if extra % 2 == 1 => self.direction = -self.direction,
            _ => {}
        }
    }

    /// How many copies of `card` seat `i` holds.
    pub(crate) fn count_in_hand(&self, i: Seat, card: Card) -> usize {
        self.hands[i].cards.iter().filter(|c| **c == card).count()
    }

    /// Appends an event to the log.
    pub(crate) fn log_event(
        &mut self,
        kind: EventKind,
        player: Option<Seat>,
        card: Option<Card>,
        chosen_color: Color,
        at: Millis,
    ) {
        self.event_log.push(GameEvent {
            kind,
            player,
            card,
            chosen_color,
            at,
        });
    }
}

/// `GameState` as Go's `json.Marshal` wrote it: the per-seat records as six
/// parallel arrays, seats as Go ints (-1 for nobody), instants as RFC 3339.
#[derive(Clone, Serialize, Deserialize)]
struct GameStateJson {
    #[serde(
        rename = "Hands",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    hands: Vec<Hand>,
    #[serde(rename = "Deck", deserialize_with = "deck_or_empty")]
    deck: Deck,
    #[serde(
        rename = "Discard",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    discard: Vec<Card>,
    #[serde(rename = "CurrentTurn")]
    current_turn: Seat,
    #[serde(rename = "Direction")]
    direction: i32,
    #[serde(rename = "ActiveColor")]
    active_color: Color,
    #[serde(rename = "PendingDraw")]
    pending_draw: u32,
    #[serde(rename = "HasDrawn")]
    has_drawn: bool,
    #[serde(
        rename = "LastCardDeclared",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    last_card_declared: Vec<bool>,
    #[serde(rename = "LastCardAt", with = "crate::gojson::opt_vec")]
    last_card_at: Vec<Option<Millis>>,
    #[serde(
        rename = "CatchPaidFor",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    catch_paid_for: Vec<String>,
    #[serde(rename = "CatchLockedUntil", with = "crate::gojson::opt_vec")]
    catch_locked_until: Vec<Option<Millis>>,
    #[serde(rename = "NearLeftAt", with = "crate::gojson::opt_vec")]
    near_left_at: Vec<Option<Millis>>,
    #[serde(
        rename = "Retired",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    retired: Vec<bool>,
    #[serde(
        rename = "EventLog",
        deserialize_with = "crate::gojson::nullable::deserialize"
    )]
    event_log: Vec<GameEvent>,
    #[serde(rename = "InterruptOpen")]
    interrupt_open: bool,
    #[serde(rename = "LastPlayBy", with = "crate::gojson::opt_seat")]
    last_play_by: Option<Seat>,
    #[serde(rename = "LastPlayAt", with = "crate::gojson::opt")]
    last_play_at: Option<Millis>,
}

fn deck_or_empty<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Deck, D::Error> {
    Ok(Option::<Deck>::deserialize(d)?.unwrap_or_default())
}

impl From<GameState> for GameStateJson {
    fn from(s: GameState) -> Self {
        let col = |f: fn(&SeatState) -> _| s.seats.iter().map(f).collect();
        GameStateJson {
            last_card_declared: s.seats.iter().map(|x| x.declared).collect(),
            last_card_at: col(|x| x.last_card_at),
            catch_paid_for: s.seats.iter().map(|x| x.catch_paid_for.clone()).collect(),
            catch_locked_until: col(|x| x.catch_locked_until),
            near_left_at: col(|x| x.near_left_at),
            retired: s.seats.iter().map(|x| x.retired).collect(),
            hands: s.hands,
            deck: s.deck,
            discard: s.discard,
            current_turn: s.current_turn,
            direction: s.direction,
            active_color: s.active_color,
            pending_draw: s.pending_draw,
            has_drawn: s.has_drawn,
            event_log: s.event_log,
            interrupt_open: s.interrupt_open,
            last_play_by: s.last_play_by,
            last_play_at: s.last_play_at,
        }
    }
}

impl From<GameStateJson> for GameState {
    fn from(j: GameStateJson) -> Self {
        // Go sized every slice at the deal; a hand-written fixture may not have.
        let n = [
            j.hands.len(),
            j.last_card_declared.len(),
            j.last_card_at.len(),
            j.catch_paid_for.len(),
            j.catch_locked_until.len(),
            j.near_left_at.len(),
            j.retired.len(),
        ]
        .into_iter()
        .max()
        .unwrap_or(0);
        let seats = (0..n)
            .map(|i| SeatState {
                retired: j.retired.get(i).copied().unwrap_or(false),
                declared: j.last_card_declared.get(i).copied().unwrap_or(false),
                last_card_at: j.last_card_at.get(i).copied().flatten(),
                catch_paid_for: j.catch_paid_for.get(i).cloned().unwrap_or_default(),
                catch_locked_until: j.catch_locked_until.get(i).copied().flatten(),
                near_left_at: j.near_left_at.get(i).copied().flatten(),
            })
            .collect();
        GameState {
            hands: j.hands,
            deck: j.deck,
            discard: j.discard,
            current_turn: j.current_turn,
            direction: j.direction,
            active_color: j.active_color,
            pending_draw: j.pending_draw,
            has_drawn: j.has_drawn,
            seats,
            event_log: j.event_log,
            interrupt_open: j.interrupt_open,
            last_play_by: j.last_play_by,
            last_play_at: j.last_play_at,
        }
    }
}
