# `loco-game` API

This crate is `server/game/` in Rust. The rules, the reasoning and the bugs behind them are in
[`docs/notes/domain-rules.md`](../../../docs/notes/domain-rules.md); this file is the map from the Go
entry points to the Rust ones, and the reasons the Rust ones are shaped differently.

## The shape

- **One way in.** A `Room` is owned by exactly one table task, and every command is a `&mut self`
  method that validates first and mutates second, so a command that returns `Err` has left the room
  exactly as it was (the proptests hold every command to that). The task reads what it broadcasts off
  the room afterwards; a command returns only what the room cannot tell it later (`was_host`, a
  `CatchCharge`, a lockout's end). The first port also had a functional `Room::apply(&self, Action,
  now) -> (Room, Vec<Event>)`. Nothing used it, it cost a clone per message, and two entry points
  that must never disagree are one too many: it is gone. A clone before the call is the "previous
  state" wherever a test or a replay wants one.
- **Time is data.** Every command that stamps or compares an instant takes `now: Millis` (Unix ms)
  last. An instant that may not exist is `Option<Millis>`; Go's zero time survives only in JSON.
- **The room's randomness cannot be missing.** `Room::new(code, seed: [u8; 32])` (the hub draws the
  bytes from the OS) or `Room::from_u64_seed` (tests and fixtures only). `Room` is not serde: the drain
  snapshot is `SavedRoom`, Go's JSON field for field, and `SavedRoom::restore(seed)` is the only way
  back to a `Room`. Go seeded lazily (`ensureRNG`) because a decoded struct could arrive without a
  source; here that state is unrepresentable. Bots take their source as a parameter.
- **Seats are `Seat = usize`, and "nobody" is `Option<Seat>`.** Go's -1 survives only in JSON
  (`gojson::opt_seat`). A newtype was weighed and declined: every seat is a `Vec` index, the hub's
  seats are `usize`, and a wrapper would be unwrapped at every one of those indexes. The sentinel was
  the bug class (`chosen_player >= 0` checks, `LastPlayBy < 0`), and `Option` removes it.
- **One record per seat.** `GameState.seats: Vec<SeatState>` holds what Go kept in six parallel slices
  (`Retired`, `LastCardDeclared`, `LastCardAt`, `CatchPaidFor`, `CatchLockedUntil`, `NearLeftAt`). The
  hands stay apart on purpose: a Swap or a GlobalSwitch moves hands between seats while every
  obligation stays with the chair. The JSON is still Go's struct-of-arrays.
- **Refusals have one kind.** `GameError`'s `Display` is Go's text byte for byte
  (`client/src/i18n/serverErrors.ts` matches it by regex); `GameError::kind()` returns an
  `ErrorKind` where Go asked four `errors.Is` predicates.
- **Values that cannot be wrong.** `MatchFormat` is an enum (`TryFrom<i64>` owns Go's
  `invalid match format: N`); `Color`, `Kind`, `Status` serialise as Go's `iota` integers through
  `serde_repr`; maps, hours and skies are serde enums with `FromStr`/`Display` instead of
  `Valid()`/`String()`.

## Commands (`Room`, `src/room.rs`)

| Go | Rust |
| --- | --- |
| `NewRoom(code)` | `Room::new(code, seed)` |
| `Join(nick)` | `join(&str)` |
| `SetFormat(f)` | `set_format(MatchFormat)`; a bad number is `MatchFormat::try_from(n)`'s refusal |
| `SetMaxPlayers(n)` | `set_max_players(usize)` |
| `SwapLobbyPlayers(a, b)` | `swap_lobby_players(a, b)` |
| `RemoveLobbyPlayer(i) (bool, error)` | `remove_lobby_player(i) -> Result<bool, _>` (was the host) |
| `Start()` | `start(now)` |
| `PlayCard(p, card, color, target)` | `play_card(p, card, color, target: Option<Seat>, now)` |
| `PlayCards(p, cards, color, target, declare)` | `play_cards(p, &cards, color, target, declare, now)` |
| `InterruptPlay`, `InterruptPlayCards` | `interrupt_play(p, &cards, color, target, now)` (one card; a list so a batch can be refused) |
| `CounterDraw(p, card, color)` | `counter_draw(p, card, color, now)` |
| `DrawCard(p)`, `PassTurn(p)` | `draw_card(p, now)`, `pass_turn(p, now)` |
| `DeclareLastCard(p)` | `declare_last_card(p, now)` |
| `CatchUndeclared(c, t, now)` | `catch_undeclared(c, t, now)` |
| `PenalizeFailedCatch(c, now) ([]Card, bool)` | `penalize_failed_catch(c, now) -> CatchCharge::{Free, Charged { drawn }}` |
| `LockCatch(c, now)` | `lock_catch(c, now) -> Option<Millis>` |
| `CatchLocked(c, now)`, `CatchLockedAt(c)` | `catch_locked(c, now)`, `catch_locked_at(c) -> Option<Millis>` |
| `CatchOffered(c, now)` | `catch_offered(c, now)` |
| `ForfeitTo(w)` | `forfeit_to(w, now)` |
| `RetireSeat(p)`, `IsRetired(p)` | `retire_seat(p, now)`, `is_retired(p)` |
| `BeginNextRound()` | `begin_next_round(now)` |
| `ResetForRematch()` | `reset_for_rematch()` |
| `json.Marshal(room)` / `Unmarshal` + `ensureRNG` | `SavedRoom::from(&room)` / `saved.restore(seed)` |

## Reads (`GameState`, `src/state.rs`)

| Go | Rust |
| --- | --- |
| `CatchableTargets(now) []int` | `catchable_targets(now) -> Vec<Seat>` |
| `CatchWindowEnd(i)` | `catch_window_end(i) -> Option<Millis>` |
| `LastCardDeclared[i]`, `LastCardAt[i]`, … | `seat(i).declared`, `seat(i).last_card_at`, … |
| `LastPlayBy` (-1) | `last_play_by: Option<Seat>` |
| `ApplyEffect`, `CanPlay` | `apply_effect`, `rules::can_play` |
| `nextTurn`, `rotateSeats`, `isRetired`, `activeSeats` | `next_turn`, `rotate_seats`, `is_retired`, `active_seats` |

## Errors (`src/error.rs`)

| Go predicate | `ErrorKind` |
| --- | --- |
| `IsStateMismatch` (`ErrNotYourTurn`, `ErrIllegalPlay`, `ErrCardNotInHand`, `ErrMustAnswerPenalty`, the batch copy count) | `StaleState` |
| `IsLostRace` (`ErrAlreadyDrawn`, `ErrMustDrawBeforePass`, the three interrupt refusals, `ErrCatchLocked`, `ErrMustDeclareLoco`) | `LostRace` |
| `IsMissedCatch` (`ErrAlreadyDeclared`, `ErrCatchWindowExpired`, `ErrTargetNotSingleCard`) | `MissedCatch` |
| `errors.Is(err, ErrNicknameRejected)` | `NicknameRejected` (the wire says `error::NICKNAME_REJECTED`) |
| everything else | `Invalid` |

`ErrorKind::is_honest()` is `LostRace | MissedCatch`: what Go's `IsLostRace` answered for the
suspected-cheats metric. Go left two missed catches out of it; the hub charges every missed catch
before it could count one as suspect, so the difference was never observable, and a late catch is
as honest as a lost interject.

## Bots (`src/bot.rs`), nicknames, maps

| Go | Rust |
| --- | --- |
| `BotThink(state, p)` | `bot_think(&state, p, &mut rng) -> BotAction` (`target: Option<Seat>`) |
| `BotInterrupt(state, p)` | `bot_interrupt(&state, p) -> Option<BotInterruptAction>` |
| `ValidateNickname`, `ContainsBlockedTerm` | `validate_nickname`, `contains_blocked_term` |
| `MapIDs`, `MapWeathers`, `MapID.Valid()` | `maps::MAP_IDS`, `maps::MAP_WEATHERS`, `"x".parse::<MapId>()` |

## Constants read by client tests (plain literals, one per line)

`room.rs`: `DEFAULT_MAX_PLAYERS`, `SERVER_MIN_PLAYERS`, `SERVER_MAX_PLAYERS`, `INITIAL_HAND_SIZE`,
`CATCH_NEAR_HAND`, `CATCH_GRACE_MS`, `CATCH_NEAR_GRACE_MS` (and `CATCH_WINDOW_MS`, `CATCH_LOCKOUT_MS`).
`deck.rs`: `DECK_SIZE`, `NUMBER_LOW`, `NUMBER_HIGH`. `card.rs`: `card_value`'s arms.
`nickname.rs`: `NICKNAME_MAX_RUNES`. `maps.rs`: `MAP_IDS`, `MAP_WEATHERS`, each id's `as_str` arm.
