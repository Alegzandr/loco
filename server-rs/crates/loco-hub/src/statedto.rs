//! What a client is handed: the player list, the scoreboard, the personalised
//! state. Port of `server/hub/statedto.go`.

use crate::clock;
use crate::convert::{card_to_dto, color_name, match_format_string};
use crate::table::Table;
use loco_game::{GameState, Status};
use loco_protocol::{
    CardColor, CardDTO, CardKind, CatchSeatDTO, GameEventDTO, GameStateDTO, MatchRecordDTO,
    PlayerDTO, ScoreboardEntryDTO,
};

/// How many entries of the event log a reconnecting client is handed: enough
/// for the board to explain the last few moves.
pub const MAX_EVENT_LOG_EXPORT: usize = 50;

/// What is the same for every recipient of one broadcast, built once.
#[derive(Clone, Debug, Default)]
pub struct SharedGameState {
    pub scoreboard: Vec<ScoreboardEntryDTO>,
    pub match_history: Vec<MatchRecordDTO>,
    pub catch_seats: Vec<CatchSeatDTO>,
    pub declared: Vec<i32>,
}

/// Who is on the hook right now, and until when: the server's word, rendered
/// and never re-derived by the client.
pub fn catch_seats(state: &GameState) -> Vec<CatchSeatDTO> {
    state
        .catchable_targets(clock::now_ms())
        .into_iter()
        .map(|seat| CatchSeatDTO {
            player_index: seat,
            ends_at: state.catch_window_end(seat).unwrap_or(0),
        })
        .collect()
}

impl Table {
    pub fn player_list(&self) -> Vec<PlayerDTO> {
        let room = &self.room;
        room.players
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let hand_size = room
                    .state
                    .as_ref()
                    .and_then(|s| s.hands.get(i))
                    .map_or(0, |h| h.size() as i32);
                let away = self.away_at.contains_key(&i);
                PlayerDTO {
                    index: p.index,
                    nickname: p.nickname.clone(),
                    hand_size,
                    connected: !away && !self.has_left(i),
                    is_bot: self.is_bot(i),
                }
            })
            .collect()
    }

    pub fn build_scoreboard(&self) -> Vec<ScoreboardEntryDTO> {
        let room = &self.room;
        room.players
            .iter()
            .enumerate()
            .map(|(i, p)| ScoreboardEntryDTO {
                player_index: i as i32,
                nickname: p.nickname.clone(),
                score: room.scores.get(i).copied().unwrap_or(0),
                rounds_won: room.rounds_won.get(i).copied().unwrap_or(0),
            })
            .collect()
    }

    pub fn match_history_dto(&self) -> Vec<MatchRecordDTO> {
        self.match_history
            .iter()
            .map(|rec| MatchRecordDTO {
                rounds_won: rec.rounds_won.iter().map(|&v| v as i32).collect(),
                scores: rec.scores.iter().map(|&v| v as i32).collect(),
                winner_index: rec.winner as i32,
                duration_ms: rec.duration_ms,
            })
            .collect()
    }

    pub fn shared_game_state(&self) -> SharedGameState {
        let room = &self.room;
        let mut shared = SharedGameState {
            match_history: self.match_history_dto(),
            ..Default::default()
        };
        if !room.scores.is_empty() {
            shared.scoreboard = self.build_scoreboard();
        }
        if let Some(state) = room.state.as_ref()
            && room.status == Status::Playing
        {
            shared.catch_seats = catch_seats(state);
            for (i, &declared) in state.last_card_declared.iter().enumerate() {
                if declared && state.hands.get(i).is_some_and(|h| h.size() == 1) {
                    shared.declared.push(i as i32);
                }
            }
        }
        shared
    }

    /// The personalised state with the event log: what a reclaim is handed.
    pub fn player_game_state(&self, seat: usize) -> GameStateDTO {
        let mut dto =
            self.player_game_state_with(seat, self.player_list(), &self.shared_game_state());
        dto.event_log = self.export_event_log();
        dto
    }

    pub fn player_game_state_using(&self, seat: usize, players: Vec<PlayerDTO>) -> GameStateDTO {
        self.player_game_state_with(seat, players, &self.shared_game_state())
    }

    fn export_event_log(&self) -> Vec<GameEventDTO> {
        let Some(state) = self.room.state.as_ref() else {
            return Vec::new();
        };
        let src = &state.event_log;
        let from = src.len().saturating_sub(MAX_EVENT_LOG_EXPORT);
        src[from..]
            .iter()
            .map(|ev| GameEventDTO {
                kind: ev.kind.as_str().to_owned(),
                player_index: ev.player_index,
                card: ev.card.map(card_to_dto),
                chosen_color: (ev.chosen_color != loco_game::Color::Red)
                    .then(|| color_name(ev.chosen_color)),
                at: ev.at,
            })
            .collect()
    }

    /// One recipient's view. Defensive on purpose: a nil state, a seat out of
    /// range or an empty discard answer with a minimal state and a WARN rather
    /// than a panic.
    pub fn player_game_state_with(
        &self,
        seat: usize,
        players: Vec<PlayerDTO>,
        shared: &SharedGameState,
    ) -> GameStateDTO {
        let room = &self.room;
        let map = |v: Option<String>| v.unwrap_or_default();
        let map_id = map(room.map_id.map(|m| m.as_str().to_owned()));
        let time_of_day = map(room.map_time.map(|m| m.as_str().to_owned()));
        let weather = map(room.map_weather.map(|m| m.as_str().to_owned()));
        let state = match room.state.as_ref() {
            Some(s) if seat < s.hands.len() && !s.discard.is_empty() => s,
            other => {
                tracing::warn!(
                    code = %room.code,
                    player_idx = seat,
                    state_nil = other.is_none(),
                    hands = other.map_or(0, |s| s.hands.len()),
                    discard = other.map_or(0, |s| s.discard.len()),
                    "playerGameState invalid args"
                );
                return GameStateDTO {
                    your_index: seat as i32,
                    hand: Vec::new(),
                    players,
                    discard: CardDTO {
                        color: CardColor::Red,
                        kind: CardKind::Number,
                        value: 0,
                    },
                    active_color: CardColor::Red,
                    turn: 0,
                    direction: 0,
                    pending_draw: 0,
                    has_drawn: false,
                    event_log: Vec::new(),
                    round_number: room.round_number,
                    match_format: match_format_string(room.format),
                    max_players: room.max_players,
                    map_id,
                    time_of_day,
                    weather,
                    scoreboard: Vec::new(),
                    round_history: Vec::new(),
                    match_history: Vec::new(),
                    turn_deadline: 0,
                    interrupt_open: false,
                    catch_seats: Vec::new(),
                    declared_seats: Vec::new(),
                    catch_locked_until: 0,
                    streamer_mode: self.streamer_mode,
                };
            }
        };
        GameStateDTO {
            your_index: seat as i32,
            hand: state.hands[seat]
                .cards
                .iter()
                .copied()
                .map(card_to_dto)
                .collect(),
            players,
            discard: card_to_dto(*state.discard.last().expect("checked above")),
            active_color: color_name(state.active_color),
            turn: state.current_turn,
            direction: state.direction,
            pending_draw: state.pending_draw,
            has_drawn: state.has_drawn,
            event_log: Vec::new(),
            round_number: room.round_number,
            match_format: match_format_string(room.format),
            max_players: room.max_players,
            map_id,
            time_of_day,
            weather,
            scoreboard: shared.scoreboard.clone(),
            round_history: room.round_history.clone(),
            match_history: shared.match_history.clone(),
            turn_deadline: self.turn_deadline_ms(),
            interrupt_open: state.interrupt_open,
            catch_seats: shared.catch_seats.clone(),
            declared_seats: shared.declared.clone(),
            catch_locked_until: room.catch_locked_at(seat as i32).unwrap_or(0),
            streamer_mode: self.streamer_mode,
        }
    }
}
