# Game rules and domain model

The pure domain (`server/crates/loco-game/`) and the rules the server enforces. The game itself is
specified in `docs/rules.md`; this note carries the reasons, the edge cases and where each rule lives.
The hub's own machinery (`server/crates/loco-hub/`) is in `server.md`.

## Where the domain lives

`room.rs` (the `Room` and every command, the constants), `state.rs` (one round: `GameState`,
`SeatState`, the catch windows), `rules.rs` (`can_play`, `apply_effect`, `next_turn`,
`rotate_seats`), `deck.rs`, `card.rs`, `hand.rs`, `bot.rs`, `maps.rs`, `nickname.rs` + `screen.rs` +
`wordlists/`, `error.rs`, `event.rs`, `rng.rs`. [`API.md`](../../server/crates/loco-game/API.md) is
the map of entry points.

- **Pure.** No clock, no I/O, no OS randomness. Every command that stamps or compares an instant
  takes `now: Millis` (Unix ms) last: the server decides on the instant it received the message. An
  instant that may not exist is `Option<Millis>`.
- **One way in.** A `Room` belongs to one table task; every command is a `&mut self` method that
  validates before it mutates, so a refusal leaves the room exactly as it was (the proptests hold
  every command to that). A command returns only what the room cannot say afterwards
  (`remove_lobby_player`'s "was the host", a `CatchCharge`, a lockout's end); the table reads
  everything else off the room. There is no second, functional entry point to keep in step.
- **The room's randomness cannot be missing.** `Room::new(code, [u8; 32])`, the hub drawing the
  bytes from the OS; `Room::from_u64_seed` is for tests. The `ChaCha12Rng` is the room's and nothing
  outside can reach it. `Room` is not serde: the drain snapshot is `SavedRoom` (plain serde, snake
  case, integer `Millis`, `null` for nobody), and `SavedRoom::restore(seed)` is the only way back, so
  a restored room without a fresh source is unrepresentable. `src/tests/rng_test.rs` runs the
  clock-seed attack. Bots take their source as an argument (`bot_think(&state, seat, &mut rng)`):
  nothing a bot picks is hidden state.
- **A seat is `Seat = usize`, and nobody is `None`** (`Option<Seat>`). A signed seat with -1 for
  nobody exists only on the wire (`loco-protocol`); the hub converts at that border, and the snapshot
  writes `null`.
- **What a seat owes is one record** (`GameState.seats: Vec<SeatState>`: `retired`, `declared`,
  `last_card_at`, `catch_paid_for`, `catch_locked_until`, `near_left_at`). The hands stay apart
  (`GameState.hands`): a Swap or a GlobalSwitch moves the hand and leaves the obligation with the
  chair.
- **A refusal is a `GameError` with exactly one `ErrorKind`** (`GameError::kind()`): `StaleState`
  (the client acted on a board the server no longer has), `LostRace` (a correct client pressing at the
  wrong millisecond), `MissedCatch` (a Contre-LOCO! too late or after the hand moved),
  `NicknameRejected`, `Invalid`. `ErrorKind::is_honest()` (`LostRace | MissedCatch`) keeps a refusal
  off the suspected-cheats count. The `Display` text is the wire string, matched by regex in
  `client/src/i18n/serverErrors.ts`, so the hub reads the kind and never the string.
- **Constants are plain literals in `room.rs`, one per line** (`INITIAL_HAND_SIZE`,
  `SERVER_MIN_PLAYERS`, `SERVER_MAX_PLAYERS`, `CATCH_WINDOW_MS`, `CATCH_GRACE_MS`,
  `CATCH_NEAR_GRACE_MS`, `CATCH_NEAR_HAND`, `CATCH_LOCKOUT_MS`, `UNDECLARED_PENALTY`,
  `FAILED_CATCH_PENALTY`): the client's tests read several off the source
  (`client/src/test/serverSource.ts`).
- **Tests.** One file per subject under `src/tests/`, plus `proptests.rs` (112 cards conserved,
  `Wild` never active, an owed draw never failing, a refusal changing nothing, the LOCO! gate on all
  four finishing paths) and `scripted_round.rs`, one round's event log pinned with `insta`
  (`src/tests/snapshots/`).

## LOCO deviations from SOLO

The spec is `docs/rules.md` §14; this is where each lives and why.

1. **GlobalSwitch is wild** (`Deck::standard`, 4 copies; `Card::is_wild`) and names a colour like
   the other two wilds. Simpler, and no dead cards.
2. **The starting card is a Number**: `Room::deal_round` turns cards until one comes up and puts the
   rest back under the deck. No first-turn effect without context.
3. **Best-of-N, taken on rounds won** (`MatchFormat`, whose `TryFrom<i64>` refuses anything but
   1/3/5/7). See "Rounds won take the match".
4. **Voluntary draw**: `Room::draw_card` refuses only a second draw (`has_drawn`,
   `GameError::AlreadyDrawn`).
5. **A forced draw does not cost the turn**: the victim of a stack takes it and plays on.
   `Room::draw_card` sets `has_drawn` and never moves `current_turn`, and **`Table::handle_draw_card`
   re-arms the turn timer on every draw** — otherwise the clock armed when the +2 landed auto-passes
   the seat a moment after the draw, and the deviation holds only on paper. One draw per turn bounds
   the extension. Cards *and* the turn for one card played is two punishments and reads as a bug.
6. **A Contre-LOCO! that finds nobody costs the caller 1 card, once per offer, and only while one is
   on the table** (`FAILED_CATCH_PENALTY`, `Room::penalize_failed_catch`, `Room::catch_offered`,
   rationed by `GameState::catch_offer_key`). The button is live from two cards out, so a press is a
   read of the table; unpriced it is free to mash. See "The catch".

## Scoring and the match

- `card_value` (`card.rs`) per `docs/rules.md` §10.
- **Single-finisher round.** `Room::end_round(winner)` writes `Room.winner`, adds one to
  `rounds_won[winner]` and scores the sum of the opponents' hands; the others score 0 and their hand
  value adds to `lost_hand_total` (tiebreak only). It does **not** deal the next round: the table
  calls `Room::begin_next_round` after broadcasting `card_played` and `round_end`, or the winning
  `card_played` reads the new round's discard.
- **Opener**: round 1 random (the room's source), then `Room::biggest_loser` (lowest cumulative
  score, tie → lowest seat).
- **Table flow** (`Table::handle_round_or_match_end`): `round_end` (scoreboard, `round_number` = the
  round just completed) → `Room::begin_next_round` → `game_started` per player; on match end,
  `match_end` (scoreboard, winner, match history).
- `PlayerDTO`: `index`, `nickname`, `hand_size`, `connected`, `is_bot` (omitted when false).

### Rounds won take the match; the score measures the gap

"Best of 5" must not read as "most points after 5": a single round with a Take 4 and a Global Switch
left in a full hand is 90 points, enough to outweigh three rounds won.

- **Tiebreakers**: most rounds won → highest score → lowest lost-hand total → sudden-death extra
  round (`Room::determine_match_winner` returning `None`).
- **The match stops as soon as the lead cannot be caught** (`Room::decisive_leader`): seat `i` is
  decisive when `rounds_won[i] > rounds_won[j] + remaining` for every other `j`, with `remaining =
  max(0, format - round_number)`. One expression covers both endings: the same test stops a BO7 at
  4–0 and ends a BO1 on its only round. "Strictly ahead of everyone", not "reached the majority",
  because six players sharing a BO7 may never reach 4.
- A decisive leader is by construction the unique maximum on rounds won, so "can this stop?" and
  "who took it?" cannot disagree. `room_match_stops_once_the_lead_is_uncatchable` and
  `determine_match_winner_rounds_won_beats_score` (`src/tests/match_format_test.rs`).
- **The score survives**: it breaks the tie, picks the opener, sits on the score table, and is what a
  future rating would be built on. **`biggest_loser` stays on points on purpose**: on rounds won,
  past two players half the table sits on zero and the lowest index would open every round.
- **A forfeit** (`Room::forfeit_to`) awards the match without touching the scoreboard.

### The evening's recap (`Table.match_history`)

One `MatchRecord` per finished match — each seat's rounds won and points, the winner (`Option<usize>`,
`null` in the snapshot, -1 as `winner_index` on the wire) and the duration — on the hub's `Table`
(`server/crates/loco-hub/src/table/mod.rs`), because it must outlive the room's reset.

- `Room::reset_for_rematch` clears `scores` / `rounds_won`; `Table::reset_for_next_match` clears
  everything about the match that ended **except** this, the one field about the matches before it.
- `Table::record_finished_match` is called once per match from both endings: the last round
  (`handle_round_or_match_end`) and a forfeit (`forfeit_match`). It **copies** the room's vectors.
- **Indexed by seat, so it moves with the seats**: `Table::drop_seat` removes the column and re-bases
  the winner (`drop_seat_from_history`: a departed winner becomes `None`, never the player who slid
  into the index); `Table::swap_seats` exchanges both (`swap_seats_in_history`).
- It rides `match_end`, every personalised `game_state` (a reconnect keeps the evening) and the drain
  snapshot (`RoomSnapshot.match_history`). **And the `player_left` that re-bases the roster**, on all
  three paths that shrink it (`release_seat`, `Table::disconnect_at_table` reached from
  `HubCore::handle_disconnect` in `server/crates/loco-hub/src/table/presence.rs`, and the expiry that
  removes the seat): the column that went belongs to a seat in neither roster, so the client cannot
  re-base it. The mid-match expiry `player_left` that names a seat re-bases nothing and carries
  nothing.
- The client draws it only past one record (`hasEveningToShow`): one column is the standings above
  it, said twice.
- **Duration** (`MatchRecord.duration_ms`): from `Table.match_started_at`, stamped by
  `Table::open_gate` (`table/maploading.rs`) at `match_ready` — the loading gate is a wait, not the
  game — to the `now` handed to `record_finished_match` (handed in, so the internal test chooses both
  ends). **Zero means "cannot say" and is omitted from the wire**, so a played match is rounded up to
  at least 1 ms (`match_duration_ms`). The two real zeros: a forfeit inside the loading gate, and a
  match restored without a stamp. The stamp rides the snapshot so a deploy does not restart the
  clock; `reset_for_next_match` clears it. The client (`game/matchDuration.ts`) words it to the
  second with units written out — `12 min 34 s`, `42 s`, `1 h 05 min 12 s` — never `12:34`, which
  reads as a clock; rounded to the nearest second and never below one.

## Deck and draw

- 112 cards (`Deck::standard`, `DECK_SIZE`), per `docs/rules.md` §3. `Card::is_wild` is true only for
  Wild, WildDrawFour, GlobalSwitch; **Swap is coloured** and matches normally. Hands of 8
  (`INITIAL_HAND_SIZE`). GlobalSwitch passes hands in the play direction (`rotate_seats`).
- **Every wild names a real colour, GlobalSwitch included**: the `<ColorPicker />` opens before the
  card leaves the hand and `apply_effect` writes the choice. `play_card`, `play_cards`,
  `counter_draw` and `interrupt_play` refuse a colourless one with `GameError::MustChooseColor`;
  `dto_to_card` (`loco-hub`, `table/convert.rs`) turns an absent `chosen_color` into `Wild`, which is
  exactly what they refuse.
- **`Wild` never reaches `GameState.active_color`**: it matches no coloured card and leaves the table
  only wilds to play. `GameState::set_active_color`, the only writer after the deal, refuses it as a
  last line (a proptest holds it), and `applyCardPlayed` ignores an incoming `active_color:"wild"`.
- **A card landing closes any open picker** (`GameView`, effect on `lastPlay.at`): an interject under
  your colour prompt replaces the board the choice was made against. Same for `<PlayerPicker />`.
- **A draw never fails, and the order inside `Room::draw_card` is the rule.** `Room::ensure_deck`
  reshuffles the discard, then `Deck::draw_up_to` hands over what is left — possibly nothing.
  `draw_card` validates first, draws, and only *then* clears `pending_draw` and sets `has_drawn`:
  nothing above that line touches state, nothing below it can fail. Clearing first and failing after
  makes a stack evaporate with nobody drawing, leaves the client on a stale `pending_draw`, never
  re-arms the timer, and loops a bot forever.
  - **`Deck::replenish` appends the pile to what is left of the deck, never replaces it**: it runs
    when the deck is *short*, not empty, and replacing throws the unseen cards away (hands + deck +
    pile stop summing to 112). `ensure_deck_keeps_the_cards_still_in_the_deck`
    (`src/tests/audit_fixes_test.rs`) and the conservation proptest.
  - **The seat keeps the turn when nothing came out**: it has `has_drawn`, so it can play or pass.
    `Table::bot_draw` passes on its own when it cannot play.
  - The undeclared-card penalty (`Room::catch_undeclared`) shrinks the same way rather than voiding
    the catch, like `penalize_failed_catch`.
  - `Deck::draw_n` is for **dealing only**, where a short hand is worth refusing before any card
    moves.
- **A batch is never longer than the hand it comes from**: `Table::parse_cards` (`loco-hub`,
  `table/gameplay.rs`) refuses one before decoding a card of it, so a 4 KB message of a hundred DTOs
  costs nothing at the rate limit.
- **Removing a seat re-bases everything the scoreboard is drawn from** (`Room::remove_lobby_player`:
  `scores`, `rounds_won`, `lost_hand_total`, `retired`, every row of `round_history`): a finished room
  keeps its scores for the game-over screen. The `player_left` carries the re-based `scoreboard` and
  `round_history`.
- **A one-card interject off a one-card hand logs one declaration**: `declare_for_finish` runs for the
  batch finish alone, so the replayed event log never announces the call twice.

## Answering a draw stack

`Room::play_card` refuses every card while `pending_draw > 0` (`GameError::MustAnswerPenalty`):
stacking is a separate message, `counter_draw` (`Room::counter_draw`). The client's `onCardClick`
(`state/gamePlay.svelte.ts`) routes the tap there whenever `pendingDraw > 0`, and the E2E test taps
through it rather than sending `counter_draw` down the socket, so a client that only flies the card
cannot pass.

**A counter is the same kind *and* the same colour** (`Room::counter_draw`, mirrored by
`isCounterCard`). An off-colour +2 is not dead: the forced draw keeps the turn (deviation 5), so its
holder takes the stack and plays it as an ordinary kind-match on the same discard. E2E-tested both
ways.

`<TurnIndicator />` says "or counter!" (`drawOrCounter`) only when `canCounter`
(`pendingDraw > 0 && hasPlayableCard`, the same question while a penalty is pending); otherwise it
asks for the draw (`drawPenalty`). Most hands cannot counter, and announcing it sends players tapping
cards that will never leave.

## The turn clock's grace (`Timings.turn_timeout_grace`)

The client is shown `Timings.turn_timeout` (30 s); the auto-action fires **400 ms later**
(`Table::schedule_turn_timer`, `server/crates/loco-hub/src/table/turntimer.rs`). A play sent on the
last frame of the bar still has a network to cross, and refusing it "not your turn" is the one
refusal a player can measure against their own screen. **The grace is the server's patience and
never on the wire**: not in the deadline, not in a snapshot, and no client adds its own — a client
that knew about it would spend it.

## Refusals that prove a stale client

`NotYourTurn`, `IllegalPlay`, `CardNotInHand`, `MustAnswerPenalty` and the batch's
`NotEnoughCopies` are refusals a correct client cannot produce on a board it shares with the server.
Their kind is `ErrorKind::StaleState`, and `Table::refuse_action` answers each with a fresh snapshot
(`server.md`). The kind is a `match` the compiler checks, never a reading of a string the server is
free to reword.

## Interrupts and batch play

- **Identical-card interrupt** (`Room::interrupt_play(seat, &cards, chosen_color, target, now)`):
  **anyone** plays **one** card exactly matching the top discard; the effect applies from their seat
  and they lead.
- **No deadline and no excluded player.** The player who just played and the current player may both
  take the lead back. Everything is a race decided by arrival order. **Reinstating either restriction
  makes the mechanic turn-based: do not.**
- **Every kind can interrupt, wilds included** (Wild on Wild, a +4 extends a +4 chain, GlobalSwitch
  rotates from the interjecter's seat). Wilds share `Color::Wild`, so equality keeps a Wild off a
  WildDrawFour. Every wild interject names a real colour.
- **An interject is one card** (`GameError::InterruptBatch`, `docs/rules.md` §6.8). `interrupt_play`
  takes a list precisely so a batch off the wire reaches the domain and is refused there; the tap
  sends `card` alone and `bot_interrupt` one copy, so a bot has no move a human lacks. Every copy past
  the first is a window somebody else could have won, and a +4 batch would be committed inside a
  colour prompt that says nothing about it. Batch play is the seat's **own turn**
  (`Room::play_cards`), where nothing is raced.
- During a draw chain only DrawTwo / WildDrawFour may interject (`GameError::InterruptNotADrawCard`) —
  implied by identity with the top in a consistent state, kept as a guard.
- **Window state** on `GameState`: `interrupt_open`, `last_play_by: Option<Seat>`, `last_play_at`.
  Armed by `arm_interrupt_window(actor, now)` after `play_card` / `play_cards` / `interrupt_play` /
  `counter_draw`, opened by `deal_round`, closed by `close_interrupt_window()` on `draw_card`,
  `pass_turn`, a round-winning play, a retirement at turn.
- **The opening discard is interceptable, which is why the window and its author are two fields**: a
  dealt card has no author. `deal_round` sets `interrupt_open` with `last_play_by` still `None`, and
  every rule above applies unchanged. `room_interrupt_play_opening_discard_is_interceptable`
  (`src/tests/room_test_part2.rs`) reads it off a real deal.
- **Bots stay out of that one window**: `bot_interrupt` and `Table::maybe_schedule_bot_interrupt`
  gate on `last_play_by` being `Some`. A bot slamming the opening discard takes the first turn off the
  seat the deal handed it before anybody touched anything.
- **Resolution**: the table's task takes its messages one at a time
  (`server/crates/loco-hub/src/table/actor.rs`), so two slams are two commands in arrival order.
- **The window's state is on the wire, because the client cannot derive it.** `interrupt_open`
  rides `card_played` (open unless the play took the round), `card_drawn` (shut when the seat at turn
  drew, unchanged when a penalty grew a hand — same message type, so the flag is what the client
  reads), `turn_changed` (shut), `match_ready` (open) and every `GameStateDTO`. An `Option<bool>`:
  `Some(false)` always written, absent means unchanged. Without it the client offers the twin after a
  draw and the refusal renders as "somebody was faster" on a table where nobody was.
  `interruptWindow.test.ts`, `interrupt_open_rides_the_wire`
  (`server/crates/loco-hub/tests/interrupt_window.rs`).
- **Wire**: `interrupt_play` and its alias `interrupt_play_card` (the spelling the client sends), one
  handler (`InterruptPlayMsg`: `{ card?, chosen_color?, chosen_player?, play_cards? }`, a non-empty
  `play_cards` taking precedence and refused past one entry). No `declare_loco`: only a turn batch
  reads it. `interrupt_success { player_index, cards[] }` goes out right before `card_played`.
- **Batch play** (`Room::play_cards`): N identical cards on the seat's own turn. Effects stack
  (`stack_batch_effects`: DrawTwo `2N`, WildDrawFour `4N`, N skips, Reverse by parity); Swap and
  GlobalSwitch never batch (`GameError::BatchOfRearrangers`).

## Forgetting LOCO! and winning anyway (the gate)

`GameState::require_loco_to_finish(seat, playing, declaring)`, `GameError::MustDeclareLoco`,
`docs/rules.md` §14.7. Enforced by the catch alone, the declaration is a 5 s risk rather than an
obligation, and a hand of two identical cards played as one batch goes 2 → 0 without ever opening a
window: the game's loudest moment never happens.

- `playing == 1`: the seat held that card before this message, so only `seats[seat].declared`
  counts. A flag on the message would fold the obligation into the winning tap.
- `playing >= 2`: no declaration was possible, so the message carries it (`declare_loco`);
  `declare_for_finish` sets the flag **and** logs `EventKind::UnoDeclared` (the log and the broadcast
  read the state, never the message), and `Table::announce_finishing_loco` puts `uno_declared` on the
  wire **before** `card_played`, reading the condition off the domain (two or more cards, hand now
  empty).
- **Nobody is trapped**: `Room::declare_last_card` accepts a late call at any time while the hand is
  one card, so forgetting costs the catch risk and a press, never the round.
  `play_card_last_card_without_the_call_is_refused` (`src/tests/loco_finish_test.rs`).
- **All four win paths ask** (`play_card`, `play_cards`, `interrupt_play`, `counter_draw` — every
  path to `finish_round_win`), **last in each validation block** (an illegal card is still refused as
  illegal) and **before any mutation**. The proptests drive all four.
- **Its kind is `LostRace`**: forgetting is what the rule is about, and counting it would make
  `suspected_cheats` a measure of how badly the table played. Not `StaleState`: the client's board is
  right.
- **Bots**: a bot's declaration is deferred (`BotTimings.uno_delay`) so humans can win the race, so
  `Table::bot_declare_before_finish` calls first on a turn, a counter and an interject; only a bot's
  finishing *turn* batch carries `declare_loco` (`BotAction.declare_loco`). A refused bot move gives
  the turn up (`Table::bot_recover`, `server.md`). That call never comes early: a finish off an
  undeclared last card is held until the bot's own declaration instant (`bot_finish_due`,
  `bot_uno_at`, `server/crates/loco-hub/src/table/bots.rs`), or it would shut the catch window the
  moment the bot found a card (`server.md`, "The move that takes the round").
- **A bot batches its identical copies on its own turn when a copy buys something** (`BotAction.cards`,
  `bot_batch_for`): two +2s are a +4, two Skips step two seats, its last two identical cards finish
  with the call. Swap and GlobalSwitch never batch; a plain Wild only when the batch empties the hand.
  **Its interject is one card** (`bot_interrupt`), into windows a human can win first.
  > Open decision: no human tap sends `play_cards` on its own turn, so `Room::play_cards` is reachable
  > only by a bot or a hand-written client. Either the tap grows a way to send a turn batch (the rules
  > modal's "Doubles go down together" and `content/contrasts.ts` promise it) or the bot stops making
  > a move nobody at the table can answer with.
- **A bot's Swap goes to the smallest hand, and only when it pays** (`bot_swap_target`,
  `bot_swap_pays`): a Swap is a trade, not a penalty. It skips a retired seat (empty hand, refused by
  the domain) and holds the card when no opponent is below the hand it would keep — another legal
  card if it has one, else a draw, since a draw costs one card and the exchange several. A Swap that
  empties the hand always plays (§13). `bot_interrupt` applies the same test. `src/tests/bot_test.rs`,
  `src/tests/bot_interrupt_test.rs`.
- **A plain Wild that would change nothing is held** (`bot_wild_is_idle`): it is only the colour it
  names, so naming the active one moves nothing; it goes out when nothing else is playable, including
  as the card that empties the hand. The +4 and the GlobalSwitch always pay. **All three break a colour
  tie towards the change** (`bot_preferred_color(hand, active)`), and the tie-break is never bought
  with a colour the hand holds less of.
- **Fixtures**: any test that drives a round to its end makes the call — `declare_last` in the domain
  suite (`src/tests/support.rs`), `declare_before_winning` over the wire
  (`server/crates/loco-hub/src/testkit.rs`). A fixture that asserts a play resolves, not that a round
  can be won, holds a second card so it is not a finish by accident.

## The catch (LOCO! declaration and Contre-LOCO!)

### Windows, per seat

- **Receiving your last card owes a declaration exactly like playing down to it** (`docs/rules.md`
  §8, §11.1): the rule protects the table's right to know somebody is one card from winning.
- **Tracked per seat** (`SeatState.declared`, `SeatState.last_card_at`): a Swap puts **two** players
  on one card at once and a GlobalSwitch can put more; a single slot lets all but one walk free.
- After a Swap or a GlobalSwitch the play calls `open_catch_windows_after_rearrange(now)` (every seat
  on one card, **including one that declared a beat earlier** — it now holds a different card);
  `update_last_card_state(actor, now)` otherwise.
- `Room::catch_undeclared(catcher, target, now)` is per target and refuses self-catching
  (`GameError::CannotCatchYourself`). `GameState::catchable_targets(now)` returns the open windows
  oldest-first. Bots: `Table::maybe_schedule_bot_reactions` arms one attempt per window
  (`bot_catch_attempt`), and `handle_bot_catch` drops a stale one by comparing `last_card_at`.
- **Wire**: `catch_uno` carries `target_index` when the client has one; absent, the table takes the
  window closest to expiring (`catchable_targets(now).first()`), the catch about to be lost.
- **Who is on the hook is the server's answer and rides `card_played`** (`catch_seats:
  [{player_index, ends_at}]`, `CatchSeatDTO`, built by `catch_seats` in
  `server/crates/loco-hub/src/table/statedto.rs` from `catchable_targets` + `catch_window_end`). The
  client never re-derives it: a second derivation drifts silently, arming a tap the server refuses or
  leaving a catchable seat dark.
- **Every `player_index` on the wire is an `Option`**, like `pending_draw` and `has_drawn`, so seat 0
  — the host — is always written. A dropped zero reads as seat -1 on `uno_declared` and leaves the
  catch armed on a player who already called it. `a_zero_behind_an_option_is_written`
  (`server/crates/loco-protocol/tests/parity.rs`), beside the replay of the golden frames.

### The price of a call that finds nobody

`FAILED_CATCH_PENALTY` (1 card), `docs/rules.md` §14.6. Without a price, mashing at every seat on one
card is always correct and the hardest reaction becomes a reflex nobody aims. The button is live from
two cards out (`client/src/game/catchAvailability.ts`), because a control unlocked by the server's
permission can only answer a window, never anticipate one — which makes the wrong press ordinary, and
the price is what keeps it honest. Three misses are timing (`ErrorKind::MissedCatch`): the target
declared first (`AlreadyDeclared`), its hand grew (`TargetNotSingleCard`), the window closed
(`CatchWindowExpired`). The fourth is a wrong read (`GameError::NoCatchWindow`, or no seat named), and
it is charged like the rest.

- **The threshold is what keeps the price from being buyable, and that is why it is two and not
  three** (`CATCH_NEAR_HAND`). A card is a punishment only while it stays in the hand: a player about
  to Swap away their hand can take penalties as ammunition, paid twice by the scoring. From two cards
  the window is one ordinary play away, so a miss is a spasm; from three nothing reaches a window in
  one action, and the button would be live through long stretches where a press can only miss. **The
  criterion if this is re-tuned: a failed Contre-LOCO! must never be a faster source of cards than
  the voluntary draw, and the wager must never be offered longer than it can plausibly pay off.**
- **The card is per offer, not per press and not per card played** (`GameState::catch_offer_key`,
  `SeatState.catch_paid_for`). The offer is the near-finish picture from the catcher's chair: every
  other seat on exactly two cards (`i:2`), every other seat on its last card with the instant its
  window opened (`i@instant`). Charged once per key; `Room::penalize_failed_catch` returns
  `CatchCharge::Free` after that, and `Table::penalize_failed_catch` answers with silence. Per card
  played was a farm: press, play a card of your own, press again — two cards a turn off one opponent.
  The catcher's own play is not in the key, nor is a play from far out; what moves it is the near seat
  moving or another seat arriving at two. **A press that lands spends no key**, so a Swap that puts
  two seats on one card can be answered twice.
- **The other half of the price is a lockout, paid per press** (`CATCH_LOCKOUT_MS` = 2 s,
  `SeatState.catch_locked_until`, `Room::lock_catch` / `catch_locked` / `catch_locked_at`,
  `GameError::CatchLocked`). The card bounds what mashing *costs*, not what it *buys*: a held thumb
  pays one card and its free presses then land on the millisecond the next window opens, before any
  human could declare — a successful catch, spending nothing. So **every fruitless press arms the
  lock, charged or not, and every press made while it runs re-arms it**: a thumb that never lets go is
  never live when a window opens, and one aimed press pays once. While it runs the press **wins
  nothing and costs nothing**: `catch_undeclared` refuses with `CatchLocked` above every charging
  refusal, `penalize_failed_catch` returns `Free`, and the caller alone gets `catch_locked` (a silent
  refusal would leave a button that goes quiet for no visible reason, and the player would keep
  pressing). A press where nothing is offered arms nothing (`Table::penalize_failed_catch` asks
  `Room::catch_offered` first). **Two seconds is the declaration it protects** — the beat a seat needs
  to notice and call — and short enough against a 5 s window that a seat that genuinely forgot is
  still catchable by the same player.
- **Ordering is load-bearing**: `Table::penalize_failed_catch` arms the lock *after*
  `Room::penalize_failed_catch` decides the card (armed first, the domain's own guard refunds every
  miss) and after the `catch_failed` broadcast. `CatchLocked` is a `LostRace`, not a `MissedCatch`:
  it pays no card, and both clocks are honest. Bots take it on the same terms; they attempt once per
  window anyway. `src/tests/catch_window_test.rs` (the exploit played end to end),
  `server/crates/loco-hub/tests/catch_immediate.rs` (six presses cost one card and six lockouts).
- **And only while something is offered** (`Room::catch_offered`): no other seat on two cards or on a
  last card inside `CATCH_WINDOW_MS + CATCH_GRACE_MS` means the press is a board that moved under a
  thumb or a forged message. `Table::handle_catch_uno` asks first and calls `refuse_silently` (no
  answer, counted against the AFK reset, `server.md`). Charged, it reopens the farm to anybody
  forging the message; toasted, it scolds a player whose button was live a round trip earlier.
  `catchAvailability.test.ts` and the `room_penalize_failed_catch_*` cases in
  `src/tests/room_test_part2.rs` pin each side.
- **A seat number the table does not have is refused, not charged** (`handle_catch_uno`, with a
  `note_rejection`): no client of ours composes it. A press naming *nobody* is what the live button
  produces, and it is charged.
- `Room::penalize_failed_catch(catcher, now)` draws the card and touches **nothing else** — not the
  turn, not `has_drawn`, not the target. A dry deck draws nothing and still spends the offer
  (`CatchCharge::Charged { drawn }` empty).
- `Table::penalize_failed_catch` broadcasts `catch_failed { player_index }` (the *caller*) then
  `send_hand_growth`, for humans (`handle_catch_uno`) and bots (`handle_bot_catch`) alike. A miss does
  not `note_suspect` and sends no error toast: the button was armed when pressed.
- **A penalty that drew nothing is told to its caller and nobody else**: otherwise it is a free
  message that fans out at ten a second for a window's eight seconds, announcing a penalty nobody
  paid.

### Both ways to lose

A press is answered on the instant it arrives — the faster of two presses wins — and the offer lasts
long enough that arriving late is a mistake a player can make. Nothing holds a press back: the
per-offer ration and the lockout stop the mashing, at no cost to the single honest press. A server
that delays a reaction is not measuring it.

- **The offer is the window, not the hand.** A control that goes dark the frame a seat leaves the
  picture (it drew, swallowed a stack, was caught) makes the read for the player, in their favour.
  `GameState::catch_offered_seat` asks `catch_race_recent` before the hand, and `catch_offer_key` is
  keyed on `last_card_at` so the ration survives the hand moving. `catch_race_recent` also separates
  a lost race from `NoCatchWindow`: the window must have opened inside `CATCH_WINDOW_MS +
  CATCH_GRACE_MS` (5 s + 3 s; the grace is a round trip plus the frame the button was drawn in).
- **The client offers the late press for less than the server charges for it**:
  `CATCH_LATE_GRACE_MS` 2 s against `CATCH_GRACE_MS` 3 s. Longer is a button that does nothing;
  exactly as long puts a press on the last live frame outside the server's window by one hop.
  `serverMirrors.test.ts` pins the inequality, not the numbers.
- **The two-card offer has the same late half, shorter.** `GameState::note_hand_grew` stamps
  `SeatState.near_left_at` when a hand grows *from exactly* `CATCH_NEAR_HAND`; `catch_offered_seat`
  keeps the seat offered `CATCH_NEAR_GRACE_MS` (2.5 s) past it (`near_recent`), the client 1.5 s.
  Long enough for a human thumb that sees the hand grow when the card's flight lands, short enough to
  be a spasm's worth and not a second look. Inside it `catch_offer_key` writes the picture left
  (`i:2`), so a press before and after the draw is one misread and one card. Only a draw and the
  failed-call penalty stamp it; a Swap or GlobalSwitch leaves it alone.
- `src/tests/catch_window_test.rs` owns the domain half of both, `catch_immediate.rs` the socket
  half. **The race itself is not an E2E test and must not become one**: a 6 ms head start given to
  one page's `WebSocket.send` does not survive Playwright, so the harness would decide it.

### The client's half

- **A catch that lands is announced** (`applyUnoCaught` → `store.catchFlash` → `<CatchBanner />`, the
  penalty cards flying to the caught seat; `visual.md`, "Streamable moments").
- **The wager is spent on press, not on the reply** (`noteCatchAttempt` sets
  `CatchWindow.attempted`, which `deriveCatch` skips, **and** `store.catchSpent`): a target left
  armed for a round trip lets a double tap pay twice. The window stays open (another player can still
  take it) and **the button stays pressable**.
- **`store.catchSpent` is the client's copy of the server's ration**, cleared by `applyCardPlayed`,
  the one event that can put a new offer on the table. It gates the *blind* press only: with a target
  named the press always goes. Without it, the second tap of a double tap on a catch that landed
  would leave naming nobody and be charged — the server's guard misses that one, since a landed catch
  spends no offer.
- **`store.catchLockedUntil` is the other ration, and not a mirror**: the server sends the instant
  (`catch_locked { catch_locked_until }` to the caller, `GameStateDTO.catch_locked_until` in every
  personalised snapshot, so a reloaded tab gets it back); nothing here knows the duration.
  `localizeDeadlines` moves it onto our clock. `applyCatchLocked` writes it and lowers `catchPending`.
  - **`store.catchLocked` is derived beside `catchLive`** by the same middleware, never written by an
    action. `catchLiveUntil` becomes the lock's end while it runs, so `GameView`'s one timer brings
    the button back on the clock rather than on the next message.
  - **It is drawn, not merely dead** (`ActionBar`'s padlock + `loco-slide` drain, scene
    `game-catch-locked`): the one dead state the player caused and can wait out. No digits. **It takes
    the halo off** too. The capsule above still names the window.
- `store.catchFailed { seat, at }` (`applyCatchFailed`) drives a red pill in `<GameView />` for
  `CATCH_FAIL_NOTICE_MS` (2800) plus the `penalty` sting, so the card reads as a price and not a
  draw. i18n `catchFailedYou` / `catchFailedOther`; scene `game-catch-failed`.
- **Catch windows**: `gameStore.catchWindows: { seat, endsAt, attempted? }[]`, the server's list plus
  the client's memory of what it pressed. `catchTarget` / `unoTimerEnd` are **derived** (`deriveCatch`:
  the most urgent opponent window, never our own seat) and completed by the store
  (`store/deriveCatchMiddleware.ts`), never by each action — an action that forgets to recompute
  fails silently. `applyUnoCaught(seat)` on `uno_declared` / `uno_caught` retires one seat;
  `pruneCatchWindows()` drops expired ones. **A hand that grows closes that seat's window**
  (`applyCardDrawn`). **`applyGameState` filters windows, it does not wipe them**: a Swap is followed
  by a personalised `game_state`, and wiping there makes the seat handed its last card untouchable.
- **What the table heard: `gameStore.declaredSeats`**, every seat whose current single card has been
  called (`applyUnoDeclared`; retired by `applyCardDrawn`, `applyCardPlayed`, `applyGameState` through
  `store/helpers.ts: keepDeclarations`). One thing reads it: **`myDeclared`**, our own seat, which
  spends the LOCO! chip, derived like `catchTarget`.
- **`isCatchLive` deliberately does not read declarations.** It reads hand sizes, our own seat and
  the clock. The button answers "is a seat near the finish", never "is somebody catchable": going dead
  on the last opponent's call would **report the call** to a player who was not listening for it, and
  refuse the spasm §14.6 charges for. A declared seat stays offered until its window ends.
  (`catchAvailability.test.ts`: live inside the window, dead past it and its grace.)
  - **The clock is `store.onHookUntil`** (seat → the window end from `catch_seats`, written by
    `applyCardPlayed` and `applyGameState` via `updateOnHook`, plus `CATCH_LATE_GRACE_MS`), separate
    from `catchWindows` because it must survive `uno_declared`, `uno_caught`, a draw **and the hand
    growing**. A reloaded tab holds no clock, so an unnamed last card is dark there; absence of a
    window is never read as a declaration.
- **What ends the offer is the clock, never the next card** (`isCatchLive` + `catchLiveUntil`;
  `GameView` arms one timer and calls `rereadCatchLive`). Held until the next card, the offer is
  farmed (press against a seat on two, watch it draw, wait for any play, press again); read off the
  hand, it goes dark on the committed thumb. `catchDerivation.test.ts`; `penalties.spec.ts` plays it
  against a real server.

## Swap / GlobalSwitch notices

- `card_played` carries `chosen_player` only for `swap`, and `direction` (1 cw, -1 ccw, post-effect)
  on every play, which `applyCardPlayed` writes immediately.
- `applyCardPlayed` derives `swapNotice` (`kind`, `actorIndex`, `targetIndex` (-1 for
  global_switch), `direction`, `at` — the key that makes a second notice a second pill). `GameView`
  shows it as `.noticeSwap` for `SWAP_NOTICE_MS` (3500); i18n `swapNotice`, `swapNoticeYouActor`,
  `swapNoticeYouTarget`, `globalSwitchNoticeCw`, `globalSwitchNoticeCcw`. `<GameBoard />` watches
  `swapNotice.at` and flies the hands through `<AnimationLayer />`.

## Game event log

- `GameState.event_log: Vec<GameEvent>`, append-only (`GameState::log_event`), written inside the
  commands: the deal, every play, draw and pass, `declare_last_card` / `declare_for_finish`,
  `catch_undeclared`, `penalize_failed_catch` (when it drew), `retire_seat`, the round's and match's
  end. `GameEvent.at` is the command's `now`, the same clock as every deadline.
- **It rides the reconnect snapshot and nothing else**: `export_event_log` (last 50,
  `MAX_EVENT_LOG_EXPORT`, `table/statedto.rs`) is called by `Table::player_game_state`, the
  single-recipient recovery send, never by `player_game_state_using`, which every broadcast loop
  uses. It is the one unbounded field in a payload built once per recipient, and nothing reads it
  during play.

## Per-round history (`Room.round_history`)

`round_history[k][seat]` = points scored in round k+1, appended by `end_round` (only the finisher
scores, so one non-zero column per row); cleared by `start` and `reset_for_rematch`. Exported in every
`GameStateDTO` and in `round_end`, the message the round summary is drawn from. Server-owned because
cumulative scores cannot be split back into rounds, and a client-side accumulator diverges after a
reconnect.

## A seat that walks out of a match

`Room::retire_seat`. Which ending a departure gets is the table's (`server.md`); this is what the
domain does when the round carries on. `src/tests/retire_test.rs`.

- **The seat stays and stops playing**: hands, scores, rounds won and the turn order are indexed by
  it. `Room.retired` is match-level; `SeatState.retired` is each round's copy (`deal_round` deals a
  retired seat an empty hand).
- **The hand goes back into the deck, shuffled** — hidden cards, so their position tells nobody
  anything, and the deck does not shrink with every departure.
- **Everything that walks the table skips it**: `next_turn` (and `apply_effect` counts
  `active_seats`, so a Reverse with one of three gone acts as a duel's Skip), `rotate_seats`,
  `biggest_loser`, the Swap target (`GameError::SeatHasLeft`).
- **A pending draw aimed at it is cleared**, not passed on.
- **Its catch window is shut and its declaration marked spent** (`last_card_at = None`,
  `declared = true`).
- **The scoreboard is untouched**: a departure is not a forfeit. A seat that banked the rounds can
  still take the match on the tiebreak chain.

## Rematch

- **`rematch` is an ask every seat makes**, and two asks deal the next match; the quorum, the
  broadcast and the shapes the deal can take are in `server.md` ("A rematch by agreement").
- `Room::reset_for_rematch()` requires `Status::Finished` (`GameError::RematchUnavailable`); clears
  `state`, `winner`, `round_ended`, `match_over`, `match_winner`, `round_number`, the map, and empties
  `scores` / `rounds_won` / `lost_hand_total` / `retired` / `round_history` (so `start` sizes them to
  the roster then present). Keeps `players`, `format`, `max_players`.
- `Table::open_rematched_lobby` (`server/crates/loco-hub/src/table/rematch.rs`) first calls
  `prune_absent_players` (every non-bot seat with no socket, high → low, through
  `Room::remove_lobby_player` and `Table::drop_seat`); `promote_rematch_host` may move two more; then
  `Table::reset_for_next_match`. **Seats can shift, so `rematch_started { room_code, player_id,
  players, match_format, max_players }` is per recipient.**
- **A finished room's roster is mutable like a lobby's**: `Room::remove_lobby_player` accepts
  `Status::Finished`, and a disconnect there goes through `Table::reindex_lobby_disconnect` (+
  `player_left`), or a phantom is dealt a hand in the rematch.
- Client: `applyRematch(myIndex, players, format, maxPlayers)` wipes match state, the rematch asks
  included (`client.md`), → `screen:'waiting'`; it **keeps `sessionToken`**. `store.setPlayers`
  re-resolves `myIndex` by our nickname (unique per room) after any server-side re-index, or a
  promoted player never gets host controls.
- `GameOver` gives every seat the same button in three states, off `rematchOffers` + `rematchNeeded`;
  past two seats it carries the count (`rematchWaitingTable`), at two it does not
  (`rematchWaitingOpponent`). **The table's size is read off the roster, not off the quorum.**
- Bots survive a rematch. `next_bot_name` (`server/crates/loco-hub/src/table/bots.rs`) takes the
  lowest free `BotN`, so a surviving bot cannot collide with a new one.

## Lobby config

- Host messages `set_match_format`, `set_max_players` (lobby only; `Room::set_format`,
  `Room::set_max_players`), each answered by a broadcast `lobby_config_changed`. `room_created` /
  `room_joined` include both. Defaults BO1, 7 seats (`DEFAULT_MAX_PLAYERS`); `SERVER_MIN_PLAYERS` (2)
  ≤ n ≤ `SERVER_MAX_PLAYERS` (7), never below the current count.
- **A lobby disconnect re-indexes everything**: `Room::remove_lobby_player` re-indexes
  `Player.index`; `Table::drop_client` re-bases the members, each client's seat, the bot set and the
  tokens in one move. The first remaining player is seat 0, the host. A lobby left with no humans
  schedules its cleanup immediately.

## Room codes

Six characters from `ROOM_CODE_CHARS` (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`: no 0/O/1/I/l), about a
billion combinations. `tokens::generate_code` (`server/crates/loco-hub/src/tokens.rs`) draws again
until no live table holds the code; `HubCore::generate_code` (`router/rooms.rs`) hands it the table
map.
