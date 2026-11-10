# `loco-game` API: the Go domain, function by function

This crate is `server/game/` in Rust. Every entry point the hub called is
reachable under the name below. The rules, the reasoning and the bugs behind
them are in [`docs/notes/domain-rules.md`](../../../docs/notes/domain-rules.md);
this file is only the map.

## What changed in the shape, and why

- **Time is data.** Go read `time.Now()` inside the domain. Every method that
  stamps or compares an instant now takes `now: Millis` (Unix milliseconds,
  `i64`) as its last argument, and every `time.Time` field is an
  `Option<Millis>` (`None` = Go's zero time). The hub passes the instant the
  message was received, which is the rule anyway.
- **Randomness is the room's own `ChaCha12Rng`**, seeded by the caller:
  `Room::new(code, seed: [u8; 32])`, where the hub draws the 32 bytes from the
  OS. It is never serialised (Go's `rng` was unexported, so the snapshot never
  carried it either): a room restored from JSON has none, and the hub must call
  `Room::reseed(seed)` before using it. `Room::apply` refuses an unseeded room
  with `GameError::Unseeded`; the `&mut` methods panic on one (a hub bug, caught
  by the table's `catch_unwind`). Bots take their source as a parameter.
- **Two ways in, one behaviour.** The `&mut self` methods are Go's entry points
  one for one. `Room::apply(&self, Action, now) -> Result<(Room, Vec<Event>),
  GameError>` is the `(state, action) -> state` form built on them: it clones,
  applies, and returns the new room plus the events the action produced. A
  refusal returns only the error. Both are kept because the table task owns its
  room outright (the `&mut` form costs no clone per message on the hot path),
  while `apply` is what a test, a replay or a wasm client wants. Choose one per
  call site; they cannot disagree, `apply` *is* the methods.
- **Errors are one enum, `GameError`**, with Go's message as each variant's
  `Display`, byte for byte (`client/src/i18n/serverErrors.ts` matches them by
  regex). Go's `errors.Is` kinds are methods: `is_state_mismatch`,
  `is_lost_race`, `is_missed_catch`, `is_nickname_rejected`.
- **Seats are `Seat = i32`**, signed because -1 means "nobody" on the wire and
  in the log, and because a seat number from the wire may be anything. Where Go
  would have panicked on an out-of-range seat (`DeclareLastCard`,
  `InterruptPlayCards`), the method returns `GameError::InvalidPlayerIndex`.
- **JSON is Go's.** `Room` and `GameState` serialise with Go's field names
  (`Code`, `State`, `Hands`, `LastCardAt`, …), colours/kinds/status as their
  `iota` integers, instants as RFC 3339 strings (zero time =
  `0001-01-01T00:00:00Z`), `GameEvent` with its json tags. A Go snapshot
  (schema 5) deserialises into `Room`; see `src/tests/serde_test.rs`.

## Types

| Go | Rust |
| --- | --- |
| `Color`, `Red`…`Wild`, `Color.String()` | `Color::{Red,…,Wild}`, `Color::as_str`, `Display`, `Color::parse` |
| `Kind`, `Number`…`GlobalSwitch`, `Kind.String()` | `Kind::{Number,…,GlobalSwitch}`, `Kind::as_str`, `Kind::parse` |
| `Card{Color, Kind, Value}` | `Card { color, kind, value }`, `Card::new/number/action/wild` |
| `Card.IsWild()`, `Card.IsAction()` | `Card::is_wild`, `Card::is_action` |
| `CardValue(c)` | `card_value(c)` |
| `Hand`, `Add`, `Remove`, `Contains`, `Size` | `Hand`, `add(&[Card])`, `remove`, `contains`, `size` |
| `Deck`, `NewDeck()` | `Deck`, `Deck::new()` (`Deck::default()` is an *empty* deck) |
| `Deck.Shuffle(rng)` | `Deck::shuffle(&mut rng)` (no global fallback) |
| `Deck.Draw`, `DrawN`, `DrawUpTo` | `draw() -> Option<Card>`, `draw_n(n) -> Option<Vec<Card>>`, `draw_up_to(n)` |
| `Deck.Replenish(pile, rng)` | `Deck::replenish(&pile, &mut rng)` |
| `Status`, `StatusLobby/Playing/Finished` | `Status::{Lobby, Playing, Finished}`, `Status::as_str` |
| `MatchFormat`, `BO1`…`BO7` | `MatchFormat(i32)`, `MatchFormat::BO1`…`BO7` |
| `Player{Nickname, Index}` | `Player { nickname, index }` |
| `GameState` (all fields) | `GameState` (same fields, snake_case, all `pub`) |
| `Room` (all exported fields) | `Room` (same fields, snake_case, all `pub`; `State` is `Option<GameState>`) |
| `EventKind`, `Event*` constants | `EventKind::{GameStarted,…,SeatRetired}` |
| `GameEvent` | `GameEvent { kind, player_index, card, chosen_color, at }` |
| `MapID`, `MapNeon`… | `MapId::{Neon,…}`; `Room.map_id: Option<MapId>` (`""` = `None`) |
| `TimeOfDay`, `Weather` | `TimeOfDay`, `Weather` (same shape) |
| `MapIDs`, `TimesOfDay`, `Weathers`, `MapWeathers` | `maps::MAP_IDS`, `TIMES_OF_DAY`, `WEATHERS`, `MAP_WEATHERS` |
| `MapID.Valid()`, `MapID.Weathers()` | `maps::map_id_valid(&str)` / `MapId::parse`, `MapId::weathers()` |
| `TimeOfDay.Valid()`, `Weather.Valid()` | `maps::time_of_day_valid`, `maps::weather_valid` |
| `BotActionKind`, `BotPlay/BotDraw/BotCounter` | `BotActionKind::{Play, Draw, Counter}` |
| `BotAction` | `BotAction { kind, card, chosen_color, chosen_player, cards, declare_loco }` (`cards` empty = Go nil) |
| `BotInterruptAction` | `BotInterruptAction { cards, chosen_color, chosen_player }` |

## Room: lobby

| Go | Rust | `Action` |
| --- | --- | --- |
| `NewRoom(code)` | `Room::new(code, seed)` | — |
| (tests: `r.rng = rand.New(…)`) | `Room::from_u64_seed(code, u64)` (tests and fixtures only) | — |
| `ensureRNG` (restore) | `Room::reseed(seed)`, `Room::is_seeded()` | — |
| `Join(nick)` | `join(&str)` | `Join { nickname }` |
| `SetFormat(f)` | `set_format(f)` | `SetFormat(f)` |
| `SetMaxPlayers(n)` | `set_max_players(n)` | `SetMaxPlayers(n)` |
| `SwapLobbyPlayers(a, b)` | `swap_lobby_players(a, b)` | `SwapLobbyPlayers { a, b }` |
| `RemoveLobbyPlayer(i) (bool, error)` | `remove_lobby_player(i) -> Result<bool, _>` | `RemoveLobbyPlayer { seat }` → `Event::SeatRemoved { seat, was_host }` |
| `Start()` | `start(now)` | `Start` |

## Room: the match

| Go | Rust | `Action` |
| --- | --- | --- |
| `PlayCard(p, card, color, target)` | `play_card(p, card, color, target, now)` | `PlayCard {…}` |
| `PlayCards(p, cards, color, target, declare)` | `play_cards(p, &cards, color, target, declare, now)` | `PlayCards {…}` |
| `DrawCard(p)` | `draw_card(p, now)` | `DrawCard { seat }` |
| `PassTurn(p)` | `pass_turn(p, now)` | `PassTurn { seat }` |
| `DeclareLastCard(p)` | `declare_last_card(p, now)` | `DeclareLastCard { seat }` |
| `CatchUndeclared(c, t, now)` | `catch_undeclared(c, t, now)` | `CatchUndeclared { catcher, target }` |
| `PenalizeFailedCatch(c, now) ([]Card, bool)` | `penalize_failed_catch(c, now) -> (Vec<Card>, bool)` | `PenalizeFailedCatch { catcher }` → `Event::FailedCatch { catcher, cards, charged }` |
| `LockCatch(c, now) time.Time` | `lock_catch(c, now) -> Option<Millis>` | `LockCatch { catcher }` → `Event::CatchLocked { catcher, until }` |
| `CatchLocked(c, now)` | `catch_locked(c, now)` | — (read) |
| `CatchLockedAt(c) time.Time` | `catch_locked_at(c) -> Option<Millis>` | — (read) |
| `CatchOffered(c, now)` | `catch_offered(c, now)` | — (read) |
| `InterruptPlay(p, card, color, target)` | `interrupt_play(p, card, color, target, now)` | `InterruptPlayCards` with one card |
| `InterruptPlayCards(p, cards, color, target)` | `interrupt_play_cards(p, &cards, color, target, now)` | `InterruptPlayCards {…}` |
| `CounterDraw(p, card, color)` | `counter_draw(p, card, color, now)` | `CounterDraw {…}` |
| `ForfeitTo(w)` | `forfeit_to(w, now)` | `ForfeitTo { winner }` |
| `RetireSeat(p)` | `retire_seat(p, now)` | `RetireSeat { seat }` |
| `IsRetired(p)` | `is_retired(p)` | — (read) |
| `BeginNextRound()` | `begin_next_round(now)` | `BeginNextRound` |
| `ResetForRematch()` | `reset_for_rematch()` | `ResetForRematch` |

Every action also yields `Event::Logged(GameEvent)` for each entry it appended
to `GameState.event_log`, in order, ahead of the answer events above. `Start`
and `BeginNextRound` report the whole log of the round they dealt.

## GameState (reads the hub makes)

| Go | Rust |
| --- | --- |
| `CatchableTargets(now) []int` | `catchable_targets(now) -> Vec<Seat>` |
| `CatchWindowEnd(i) time.Time` | `catch_window_end(i) -> Option<Millis>` (`None`: no window) |
| `ApplyEffect(card, color) int` | `apply_effect(card, color) -> Seat` |
| `CanPlay(card, top, active)` | `can_play(card, top, active)` |
| unexported helpers (`nextTurn`, `isRetired`, `rotateSeats`, …) | `next_turn`, `is_retired`, `active_seats`, `rotate_seats`, `top_card` are `pub`; the rest are `pub(crate)` |

## Errors

| Go | `GameError` | kinds |
| --- | --- | --- |
| `ErrNotYourTurn` | `NotYourTurn` | state mismatch |
| `ErrIllegalPlay` | `IllegalPlay` | state mismatch |
| `ErrCardNotInHand` | `CardNotInHand` | state mismatch |
| `ErrMustAnswerPenalty` | `MustAnswerPenalty` | state mismatch |
| `stale("hand has %d copies, need %d")` | `NotEnoughCopies { have, need }` | state mismatch |
| `ErrMustDeclareLoco` | `MustDeclareLoco` | lost race |
| `ErrAlreadyDrawn` | `AlreadyDrawn` | lost race |
| `ErrMustDrawBeforePass` | `MustDrawBeforePass` | lost race |
| `ErrInterruptWindowClosed` | `InterruptWindowClosed` | lost race |
| `ErrInterruptMismatch` | `InterruptMismatch` | lost race |
| `ErrInterruptNotADrawCard` | `InterruptNotADrawCard` | lost race |
| `ErrAlreadyDeclared` | `AlreadyDeclared` | lost race, missed catch |
| `ErrCatchLocked` | `CatchLocked` | lost race |
| `ErrCatchWindowExpired` | `CatchWindowExpired` | missed catch |
| `ErrTargetNotSingleCard` | `TargetNotSingleCard` | missed catch |
| `ErrNoCatchWindow` | `NoCatchWindow` | — |
| `ErrInterruptBatch` | `InterruptBatch` | — |
| `ErrSeatAlreadyRetired` | `SeatAlreadyRetired` | — |
| `ErrNicknameRejected` | `error::NICKNAME_REJECTED` (the wire string) | — |
| `ErrNicknameLength/Charset/Blocked` | `NicknameLength/Charset/Blocked` | nickname rejected |
| `ErrStateMismatch` | (the `is_state_mismatch` kind) | — |
| every ad-hoc `errors.New` / `fmt.Errorf` | one variant each, same text (see `src/error.rs`) | — |
| — | `Unseeded` (Rust only: a restored room not yet reseeded) | — |
| `IsStateMismatch(err)` | `err.is_state_mismatch()` / `error::is_state_mismatch(&err)` | |
| `IsLostRace(err)` | `err.is_lost_race()` / `error::is_lost_race(&err)` | |
| `IsMissedCatch(err)` | `err.is_missed_catch()` / `error::is_missed_catch(&err)` | |

## Bots

| Go | Rust |
| --- | --- |
| `BotThink(state, p)` | `bot_think(&state, p, &mut rng)` |
| `BotInterrupt(state, p) *BotInterruptAction` | `bot_interrupt(&state, p) -> Option<BotInterruptAction>` |

## Nicknames

| Go | Rust |
| --- | --- |
| `ValidateNickname(raw) (string, error)` | `validate_nickname(raw) -> Result<String, GameError>` |
| `ContainsBlockedTerm(name)` | `contains_blocked_term(name)` |
| `NicknameMaxRunes` | `nickname::NICKNAME_MAX_RUNES` |

## Constants (read by client tests; plain literals, one per line)

| Go (`room.go`, `deck.go`, `nickname.go`) | Rust |
| --- | --- |
| `defaultMaxPlayers = 7` | `room::DEFAULT_MAX_PLAYERS` |
| `serverMinPlayers = 2`, `serverMaxPlayers = 7` | `room::SERVER_MIN_PLAYERS`, `room::SERVER_MAX_PLAYERS` |
| `initialHandSize = 8` | `room::INITIAL_HAND_SIZE` |
| `undeclaredPenalty`, `failedCatchPenalty` | `room::UNDECLARED_PENALTY`, `room::FAILED_CATCH_PENALTY` |
| `catchLockout`, `catchWindow`, `catchGrace`, `catchNearGrace` | `room::CATCH_LOCKOUT_MS`, `CATCH_WINDOW_MS`, `CATCH_GRACE_MS`, `CATCH_NEAR_GRACE_MS` |
| `catchNearHand = 2` | `room::CATCH_NEAR_HAND` |
| the number loop `1..9` in `NewDeck` | `deck::NUMBER_LOW`, `deck::NUMBER_HIGH` |
| `CardValue`'s switch | `card::card_value`'s match |
| `NicknameMaxRunes = 20` | `nickname::NICKNAME_MAX_RUNES` |
| `MapIDs`, `MapWeathers` | `maps::MAP_IDS`, `maps::MAP_WEATHERS` |
