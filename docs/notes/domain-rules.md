# Game rules and domain model

The pure domain (`server/crates/loco-game/`) and the rules the server enforces. For the transport
layer and the hub's own machinery (`server/crates/loco-hub/`), see `server.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Where the domain lives

`loco-game` is the whole of the rules and nothing else: `room.rs` (the `Room` and every command),
`state.rs` (one round: `GameState` and `SeatState`), `rules.rs` (`can_play`, `apply_effect`,
`next_turn`, `rotate_seats`), `deck.rs`, `card.rs`, `hand.rs`, `bot.rs`, `maps.rs`, `nickname.rs` +
`screen.rs` + `wordlists/`, `error.rs`, `event.rs`, `rng.rs`, and `gojson.rs`, which keeps the drain
snapshot in the JSON shape the Go server wrote. [`API.md`](../../server/crates/loco-game/API.md)
lists the entry points and maps each to the Go function it replaced; the server was Go until the
cutover, and the history below names a Go function where the bug was found in one.

- **Pure.** No clock, no I/O, no OS randomness. Every command that stamps or compares an instant
  takes `now: Millis` (Unix ms) last, which is the rule anyway: the server decides on the instant it
  received the message. An instant that may not exist is `Option<Millis>`.
- **One way in.** A `Room` belongs to one table task and every command is a `&mut self` method that
  validates before it mutates, so a refusal leaves the room exactly as it was; the proptests hold every
  command to that. A command returns only what the room cannot say afterwards (`remove_lobby_player`'s
  "was the host", a `CatchCharge`, a lockout's end); the table reads everything else it broadcasts off
  the room. The first port also carried a functional `Room::apply`; nothing called it and two entry
  points that must agree are one too many, so it went.
- **The room's randomness cannot be missing.** `Room::new(code, [u8; 32])`, the hub drawing the bytes
  from the OS; `Room::from_u64_seed` is for tests and fixtures. The source is a `ChaCha12Rng` the
  room owns and nothing outside it can reach. `Room` is not serde: the drain snapshot is `SavedRoom`
  (the Go JSON, field for field, schema 5), and `SavedRoom::restore(seed)` is the only way back, so a
  restored room without a source is unrepresentable. `src/tests/rng_test.rs` runs the clock-seed
  attack against it. Bots take their source as an argument (`bot_think(&state, seat, &mut rng)`):
  nothing a bot picks is hidden state.
- **A seat is `Seat = usize`, and nobody is `None`.** "Nobody played the card on top", "no Swap
  target", "an event with no player" are `Option<Seat>`. The wire and the snapshot still write -1 for
  nobody (`gojson::opt_seat`), and nothing else does.
- **What a seat owes is one record** (`GameState.seats: Vec<SeatState>`): `retired`, `declared`,
  `last_card_at`, `catch_paid_for`, `catch_locked_until`, `near_left_at`. The hands stay apart on
  purpose (`GameState.hands`): a Swap or a GlobalSwitch moves the hand and leaves the obligation with
  the chair.
- **A refusal is a `GameError`, and it has exactly one `ErrorKind`** (`GameError::kind()`):
  `StaleState` (the client acted on a board the server no longer has), `LostRace` (a correct client
  pressing at the wrong millisecond), `MissedCatch` (a Contre-LOCO! that came too late or found the
  hand moved), `NicknameRejected`, `Invalid`. `ErrorKind::is_honest()` (`LostRace | MissedCatch`) is
  what keeps a refusal off the suspected-cheats count. The `Display` text is the wire string,
  unchanged from the Go server's, because `client/src/i18n/serverErrors.ts` matches it by regex.
- **Constants are plain literals in `room.rs`** (`INITIAL_HAND_SIZE`, `SERVER_MIN_PLAYERS`,
  `SERVER_MAX_PLAYERS`, `CATCH_WINDOW_MS`, `CATCH_GRACE_MS`, `CATCH_NEAR_GRACE_MS`, `CATCH_NEAR_HAND`,
  `CATCH_LOCKOUT_MS`, `UNDECLARED_PENALTY`, `FAILED_CATCH_PENALTY`), one per line, because the
  client's tests read several of them off the source (`client/src/test/serverSource.ts`).
- **Tests.** One file per subject under `src/tests/`, plus `proptests.rs`, which holds the invariants
  over random play (112 cards conserved, `Wild` never active, a draw the seat is owed never failing, a
  refusal changing nothing, the LOCO! gate on all four finishing paths), and `scripted_round.rs`,
  which pins one round's event log with `insta` (`src/tests/snapshots/`).

## LOCO deviations from original SOLO rules
Authoritative spec: `docs/rules.md` §14. Summary of intentional deviations:
1. **GlobalSwitch (Change Cards All Round) is wild** — 4 copies, no color, plays on anything, and names the new active colour like the other two wilds. SOLO has it as colored 1-per-color. Implemented in `Deck::standard` (`deck.rs`, 4 wild copies) and `Card::is_wild` (`card.rs`). Rationale: simpler, avoids dead cards.
2. **Starting card is always a Number** — `Room::deal_round` turns cards over until a Number comes up and puts the action and wild cards it passed back under the deck. SOLO applies the starting action's effect to the first player. Rationale: avoids first-turn ambiguity (Take 4 with no context, Swap with empty game state).
3. **Best-of-N match format**, not 600-point threshold — BO1/BO3/BO5/BO7 (`MatchFormat`, an enum whose `TryFrom<i64>` refuses any other number), and **the match is taken by rounds won rather than by points**. See "Rounds won take the match" below for the whole rule and the bug it closed. Rationale: predictable online game length, and a format label that is true.
4. **Voluntary draw is allowed** — current player may draw even with a playable card in hand (still 1 draw max per turn). `Room::draw_card` only refuses a second draw (`has_drawn`, `GameError::AlreadyDrawn`). Rationale: strategic depth; matches UNO official rules.
5. **A forced draw does not cost the turn** — the victim of a +2/+4 stack takes the whole accumulated amount and then plays normally (or passes). `Room::draw_card` sets `has_drawn` in both branches and never moves `current_turn`; nothing but a play, a pass or an effect moves the turn. **`Table::handle_draw_card` re-arms the turn timer on every draw** — the domain kept the turn but the clock was still the one armed when the +2 landed, so a victim who took a few seconds to decide against countering drew the stack and was auto-passed right after: the deviation held on paper and the seat still vanished. One draw per turn bounds the extension. Rationale: cards *and* turn for one played card is two punishments, and it reads as a bug — the hand jumps and the seat is gone before the player can act. Stacking (`counter_draw`) is still how you avoid drawing at all.
6. **A Contre-LOCO! that finds nobody costs the caller 1 card, at most once per offer, and only
   while one is on the table** — the call only lands inside the target's 5s window, and a press that
   misses while somebody is one play from the finish is charged: the target's own LOCO! got there
   first, its hand grew, the window had already closed, or no seat owed the call at all. A press
   against a table where nobody is that close is not a wager and is answered by nobody. SOLO ignores
   an unfounded call. `FAILED_CATCH_PENALTY` + `Room::penalize_failed_catch` + `Room::catch_offered`,
   rationed by `GameState::catch_offer_key`; see "LOCO! declaration & catch windows" and
   `docs/rules.md` §14.6.
   Rationale: the button is live from two cards out, so pressing it is a read of the table rather
   than an answer to a cue the server gave — an unpriced one is free to mash and the reaction stops
   being one, and a per-press price would bill the same misread ten times over. Two rather than
   three because the price is only a price while the card stays where it landed: see "The threshold
   is what keeps the price from being buyable" below. **A press is answered on the instant it
   arrives, and the offer outlives the picture that made it**, so the wager can be lost by being too
   late as well as by being too early. See "Both ways to lose" below.

## Scoring & match system
- `card_value(c: Card) -> i32` (`card.rs`): Number=face; Reverse=10; Skip=20; DrawTwo=30; Swap=30; GlobalSwitch=40; WildCard=40; WildDrawFour=50. Matches `docs/rules.md` §10.
- **Single-finisher round**: ends when any player empties hand. `Room::end_round(winner)` writes the winner's nickname to `Room.winner`, adds one to `rounds_won[winner]` and scores the sum of the opponents' remaining values. Others score 0; their hand value adds to `lost_hand_total[i]` (tiebreaker only). No in-round spectating, placements, finished list or placement list.
- `Room::end_round` finalises scoring and sets `round_ended`. It does NOT deal the next round — the table calls `Room::begin_next_round` AFTER broadcasting `card_played` and `round_end` (otherwise the round-winning `card_played` reads the new round's discard top).
- Scores accumulate in `Room.scores`. `Room.match_over` / `match_winner` indicate completion (resolved in `end_round`).
- Round starter: round 1 = random (the room's own source); subsequent = current biggest loser (lowest cumulative score; tie → lowest seat, `Room::biggest_loser`).
- Formats: BO1/3/5/7 (`MatchFormat`, `MatchFormat::rounds`).

### Rounds won take the match; the score measures the gap

**The bug it closed.** The Go server's `determineMatchWinner` used to filter on scores first, so a
seat could take three rounds of a BO5 and lose the match to somebody who took one expensive one — a
Take 4 and a Global Switch left in a full hand is 90 points off a single round. Nothing on screen
could explain that result, because "best of 5" does not read as "most points after 5", and the format
labels (`bestOf3`, "Meilleur des 3") were saying the opposite of what the server did.

- **Tiebreakers, in order**: most rounds won → highest score → lowest lost-hand total →
  sudden-death extra round. `Room::determine_match_winner` returning `None` is what triggers the
  last one.
- **The score survives, and it is not decoration.** It breaks the tie above, it picks the seat that
  opens the next round, it is what the score table shows beside the rounds, and it is the number a
  rating or a skill-based queue would be built on later. What it stopped being is the answer to
  "who won".
- **The match stops as soon as the lead cannot be caught** (`Room::decisive_leader`). A seat is
  decisive when `rounds_won[i] > rounds_won[j] + remaining` for every other `j`, with
  `remaining = max(0, format - round_number)`. **One expression covers both endings**: `remaining` is
  zero once the format is exhausted, so the same test that stops a BO7 at 4–0 is the one that says a
  BO1 ended on its only round. `end_round` asks it, and falls through to the tiebreak chain when the
  format has run out without it being satisfied.
- **"Strictly ahead of everyone" rather than "reached the majority"**, because the majority is only
  the right number at two seats. Six players sharing a BO7 never reach 4 and the match still has to
  end.
- **A decisive leader is by construction the unique maximum on rounds won**, so the first filter of
  the chain resolves them: `end_round` can ask one question ("can this stop?") and then another
  ("who took it?") without the two being able to disagree.
  `room_match_stops_once_the_lead_is_uncatchable` and `determine_match_winner_rounds_won_beats_score`
  (`src/tests/match_format_test.rs`) own the pair.
- **`biggest_loser` deliberately stays on points.** Rounds won is exactly the wrong signal for "who
  opens the next round": only one seat per round wins one, so past two players half the table sits
  on zero and the opener would be whichever of them holds the lowest index, every round, all match.
  The score being the fine-grained measure of how far behind somebody is — the whole reason it
  survived the rule change — is what makes it the right one here.
- **A forfeit is unaffected**: `Room::forfeit_to` awards the match without touching the scoreboard,
  which was already the right semantics and still is.

### The evening's recap (`Table.match_history`)

One record per **match** this table has finished — each seat's rounds won and points, plus the
winning seat — kept on the hub's `Table` (`server/crates/loco-hub/src/table.rs`, `MatchRecord`)
rather than on the `Room`, because it has to outlive the room's reset.

- `Room::reset_for_rematch` clears `scores` / `rounds_won`, so six matches on one code used to leave
  nobody able to say who won the evening. `Table::reset_for_next_match` clears everything belonging
  to the match that just ended; this is the one field there that is *about* the matches before it,
  so it is not cleared.
- `Table::record_finished_match` is called once per match, from both endings: the last round
  (`handle_round_or_match_end`) and a forfeit (`forfeit_match`). A walkover is a finished match as far
  as the evening is concerned, and the scoreboard it ended on is exactly what happened.
- It **copies** the room's vectors. Holding the live ones was the Go bug this rule records: every
  record read as the next match the moment `Start()` reallocated them. In Rust the borrow checker
  would refuse the reference, and the copy is the only way to write it.
- It is indexed by seat, so it moves with the seats: `Table::drop_seat` removes the column and
  re-bases the winner (`drop_seat_from_history`: a departed winner becomes `None`, written -1, never
  the player who slid into the index), `Table::swap_seats` exchanges both (`swap_seats_in_history`).
  No parallel map — a vector of records on the struct.
- It rides `match_end` (the one message that opens the screen reading it) and every personalised
  `game_state` (so a reconnect mid-match still has the evening behind it), and it travels in the
  drain snapshot (`RoomSnapshot.match_history`). Adding it is what bumped the snapshot schema to 2
  (it is at 5 now, `SNAPSHOT_SCHEMA_VERSION`: the interrupt window, and later `near_left_at`, changed
  the shape of the room in turn).
- **And it rides the `player_left` that re-bases the roster**, on all three paths that shrink it
  (`release_seat`, `Table::disconnect_at_table` (reached from `HubCore::handle_disconnect`,
  `server/crates/loco-hub/src/presence.rs`), and the expiry branch that removes the seat for real).
  The screen reading it is already open by then: a seat going takes a column out of every row, and a
  client that keeps the version from before draws each player the *next* player's evening. The
  client cannot re-base it on its own — the column that went belongs to a seat that is in neither
  roster — so the message that moved the seats carries the moved recap. The other `player_left`, the
  mid-match expiry that names a seat, re-bases nothing and carries nothing.
- The client draws it only past one record: a single column is the standings immediately above it,
  said twice (`hasEveningToShow`).
- **Each record carries how long the match was played** (`MatchRecord.duration_ms`, on the wire as
  `duration_ms`). Measured on the table between two stamps: `Table.match_started_at`, written by
  `Table::open_gate` (`maploading.rs`) — `match_ready`, the moment the turn clock starts, and not the
  deal, because the map-loading gate is a wait and not the game — and the `now` handed to
  `record_finished_match`. Handed in rather than read inside, so the internal test chooses both ends.
  **Zero means "cannot say" and is omitted from the wire**, so a match that opened is rounded *up* to
  at least one millisecond (`match_duration_ms`): the client draws nothing for zero, and a played
  match must never read as an untimed one. The two zero cases are real: a forfeit inside the loading
  gate (nothing was played), and a match restored from a snapshot written before the stamp existed.
  The stamp rides the drain snapshot (`RoomSnapshot.match_started_at`) for that reason — a deploy
  mid-match must not restart the clock — and `reset_for_next_match` clears it, because the next
  match is timed from its own open. The client's half is `game/matchDuration.ts`: the last
  record is the match that just ended (recorded before it is announced), worded to the second with
  the units written out — `12 min 34 s`, `42 s` under a minute, `1 h 05 min 12 s` past an hour — and
  never as `12:34`, which reads as a clock or a speedrun split. It was minutes only; the player asked
  for the seconds, and a recap that carries them is a record where the rounded figure was an
  estimate. Rounded to the nearest second and never below one, so a played match never reads `0 s`.

### Round and match plumbing
- Table flow on round end (`Table::handle_round_or_match_end`): broadcast `round_end` (scoreboard, `round_number` = the round just completed) → `Room::begin_next_round` → `game_started` per player. On match end: `match_end` (scoreboard + match winner + match history).
- `PlayerDTO`: `index`, `nickname`, `hand_size`, `connected`, and `is_bot` (omitted when false).

## Deck
- 112 cards (`Deck::standard`, `DECK_SIZE`). Per color (R/Y/G/B) 25: 1–9 ×2 (no 0), Skip ×2, Reverse ×2, DrawTwo ×2, **Swap ×1 (colored)**.
- Wilds (12): Wild ×4, WildDrawFour ×4, **GlobalSwitch ×4**.
- `Card::is_wild` is true only for Wild/WildDrawFour/GlobalSwitch. **Swap is colored** — normal matching.
- Initial hand: **8** (`INITIAL_HAND_SIZE`).
- Opening discard must be a Number (action/wild/Swap skipped during the deal).
- GlobalSwitch passes hands to next seat in current game direction (`GameState::rotate_seats`).
- **GlobalSwitch names a colour like every other wild**: it opens the `<ColorPicker />` before the
  card leaves the hand, and `apply_effect` writes the choice. It used to be the one wild that chose
  nothing (the colour in play carried over): a card that rearranges the whole table and then leaves
  its most consequential outcome to whatever happened to be on the discard reads as an unfinished
  card, not as a rule. Every entry point rejects a colourless one: `play_card`, `play_cards`,
  `counter_draw` and `interrupt_play` refuse with `GameError::MustChooseColor` (`must choose a color
  for a wild card`). At the wire boundary `dto_to_card` (`loco-hub`, `convert.rs`) turns an absent
  `chosen_color` into `Wild`, which is exactly what those four refuse.
- `Wild` must never reach `GameState.active_color`: it matches no coloured card, so the whole table
  is left holding wilds as its only legal plays and the discard's colour ring goes purple-for-nothing.
  `GameState::set_active_color`, the only writer after the deal, still refuses it as a last line of
  defence (and a proptest holds it), and `applyCardPlayed` ignores an incoming `active_color:"wild"`
  client-side.
- **A card landing closes any open picker** (`GameView`, effect on `lastPlay.at`). The case that
  forced it: you tap a GlobalSwitch, the colour prompt is up, and somebody interjects a second one.
  The board under your prompt no longer exists (the lead, the discard and the colour are theirs), so
  a choice made against it would only earn a server rejection. Same for `<PlayerPicker />`.
- **A draw never fails, and the order inside `Room::draw_card` is the rule.** `Room::ensure_deck`
  reshuffles the discard, then `Deck::draw_up_to` hands over whatever is left — possibly nothing,
  once every card sits in a hand. `draw_card` validates first, then draws, and only *then* clears
  `pending_draw` and sets `has_drawn`: nothing above that line touches the state and nothing below
  it can fail (the comment in the code says so on the line itself).
  - **`Deck::replenish` appends the pile to what is left of the deck, it never replaces it.** The
    replenish runs when the deck is *short*, which is exactly when it is not empty: the Go version
    built a fresh slice from the pile, so the unseen cards still in the deck were thrown away — a
    +6 against a two-card deck cost the round two cards for good, and hands + deck + pile no longer
    summed to 112. `ensure_deck_keeps_the_cards_still_in_the_deck` (`src/tests/audit_fixes_test.rs`)
    counts them, and the proptest conserves all 112 over random play.
  - **A batch is never longer than the hand it comes from**, and `Table::parse_cards`
    (`loco-hub`, `gameplay.rs`) refuses one that is before it decodes a single card of it: a 4 KB
    message carries a hundred DTOs, and the domain would otherwise walk every one of them, at the
    rate limit, to reach the refusal it was always going to give.
  - It used to clear the pending draw and set the drawn flag **before** calling the all-or-nothing
    `DrawN`, and return `"deck exhausted"` on an already-mutated state. A 16-card stack against 10
    remaining cards evaporated with nobody drawing anything, and since the handler returns before
    any broadcast, the client kept `pending_draw: 16 / has_drawn: false`, the turn timer was never
    re-armed, and a bot in that seat re-scheduled itself forever (the bot's draw returned false on
    the error, the hub scheduled it again, and the bot asked to draw again). `DrawUpTo` was
    documented here for months before it existed.
  - **The seat keeps the turn when nothing came out.** It still has `has_drawn`, so it can play or
    pass; auto-passing for it would take away a card it might have been holding to play.
    `Table::bot_draw` already passes on its own when it cannot play.
  - The undeclared-card penalty (`Room::catch_undeclared`) shrinks the same way rather than voiding
    the catch — the same rule `penalize_failed_catch` next to it already followed.
- `Deck::draw_n` survives for **dealing only**, where a short hand is worth refusing before any card
  moves. Every in-play draw goes through `draw_up_to`.
- **Removing a seat re-bases everything the scoreboard is drawn from** (`Room::remove_lobby_player`:
  `scores`, `rounds_won`, `lost_hand_total`, `retired`, every row of `round_history`), because a
  finished room keeps its scores for the game-over screen and re-basing the roster alone showed the
  leaver's column under the seat above it. The `player_left` that shrinks the roster carries the
  re-based `scoreboard` and `round_history` for the same reason it carries `match_history`.
- **A one-card interject off a one-card hand logs one declaration.** `require_loco_to_finish` has
  already established the seat called it before the message; `declare_for_finish` runs for the batch
  finish alone, so the event log a reconnecting client replays never announces the call twice.

## Answering a draw stack
`Room::play_card` refuses every card while `pending_draw > 0` (`GameError::MustAnswerPenalty`, "must
counter or draw pending penalty cards first") — stacking a +2/+4 is a **separate message**,
`counter_draw` (`Room::counter_draw`). `GameView.handleCardClick` routes the tap there whenever
`pendingDraw > 0` (the wild picker carries a `counter` flag for +4). Sending `play_card` looked legal
client-side, flew the card, and bounced: the mechanic was unreachable for humans while bots used the
domain call directly. The E2E test now taps through `handleCardClick` instead of sending
`counter_draw` down the socket, which is why it stayed green.

**A counter is the same card — same kind *and* same colour** (`Room::counter_draw`, mirrored by
`isCounterCard`). Every +4 is Wild-coloured, so the colour test is free on a +4 chain. An off-colour
+2 is not a dead card: the forced draw does not cost the turn (deviation 5), so its holder takes the
stack and then plays it as an ordinary kind-match on the very same discard. That two-step path is
what the rule buys, and it is E2E-tested — refusing the tap under the penalty *and* accepting it
after the draw.

`<TurnIndicator />` takes `canCounter` and only then says "or counter!" (`drawOrCounter`); otherwise
it asks for the draw alone (`drawPenalty`). Only the same card stacks — a +4 does not answer a +2,
and a blue +2 does not answer a red one — so most hands cannot counter, and announcing it
unconditionally sent players tapping cards that
were never going to leave. `canCounter` is `pendingDraw > 0 && hasPlayableCard`: while a penalty is
pending the only legal cards are the ones that stack it, so the two questions are the same one.

## The turn clock's grace (`Timings.turn_timeout_grace`)

The deadline the client is shown stays `Timings.turn_timeout` (30s). The auto-action — draw and pass
for a seat that ran out of time — fires **400 ms after it** (`Table::schedule_turn_timer`,
`server/crates/loco-hub/src/turntimer.rs`).

The reason is the wire. A play sent on the last frame of the draining bar still has a network to
cross, and a server acting on the very millisecond of the deadline refused it with *"not your
turn"* — to a player who had beaten their own clock and watched the bar prove it. There is no
reading of that refusal that is not the game lying, and it is the one refusal in the game a player
can measure against something on their own screen.

So the grace is the server's patience and **never on the wire**: it is not in the deadline, it is
not in a snapshot, and no client may add its own. Two clients disagreeing about how much slack there
is would be worse than none, and a client that knew about the 400 ms would spend it.

**A forced draw does not cost the turn**, so `Table::handle_draw_card` re-arms the timer on every
draw: the victim takes the stack and then plays or passes, on a fresh clock.

## Refusals that prove a stale client
`play_card` / `play_cards` / `counter_draw` / `draw_card` / `pass_turn` / `interrupt_play` refuse
with **one variant each, not with new strings**, for the refusals a correct client cannot produce on a
board it shares with the server: `GameError::NotYourTurn`, `IllegalPlay`, `CardNotInHand`,
`MustAnswerPenalty`, and the batch's `NotEnoughCopies` ("hand has N copies, need M"). Their kind is
`ErrorKind::StaleState`, and `Table::refuse_action` answers each one with a fresh snapshot rather
than a bare "no" (see `server.md`). Same treatment, and same reason, as `MissedCatch` and `LostRace`:
a refusal has a *kind*, and the hub cannot read one off a string it is free to reword. In Go the kind
was a wrapper marking the sentinel and four `errors.Is` predicates; here it is a `match` the compiler
checks for exhaustiveness.

## Interrupts & batch play
- **Identical-card interrupt** (`Room::interrupt_play(seat, &cards, chosen_color, target, now)`): **anyone** plays **one** card exactly matching top discard. Effect applies from interrupter's seat; they become turn leader.
- **There is no deadline and no excluded player.** The player who just played may take the lead back with a second copy, and so may the current player. Everything is a race decided by arrival order. Removing those two restrictions is what makes the mechanic feel realtime instead of turn-based — do not reinstate them.
- **Every kind can interrupt, wilds included**: Wild on Wild, WildDrawFour extends a +4 chain, GlobalSwitch rotates hands from the interjecter's seat. Wilds share `Color::Wild`, so plain equality still keeps a Wild off a WildDrawFour. **Every** wild interject must name a real colour (`chosen_color != Color::Wild`), GlobalSwitch included.
- **An interject is one card, and it is a rule rather than the tap's manners**
  (`GameError::InterruptBatch`, `docs/rules.md` §6.8). `interrupt_play` takes a list precisely so
  that a batch off the wire (`play_cards` on an `interrupt_play` message) reaches the domain and is
  refused there, rather than trusting the client to build one; the client's tap sends `card` alone,
  and `bot_interrupt` sends one copy, so a bot has no move a human lacks.
  **What it replaced, and why it went.** The tap used to group every identical copy and nobody was
  asked how many were going — an interject is a reaction and a second press is a second reaction —
  and the line was drawn at what an extra copy *buys*: exactly the list `stack_batch_effects` has a
  case for (DrawTwo, WildDrawFour, Skip, Reverse), with a plain Wild excluded because N wilds name
  one colour. **The line was in the wrong place.** A seat holding three +4 played one, took the lead
  back off itself with the second, and the third left on the same press: twelve cards on the next
  player, one reaction, and the read the mechanic is made of never had to be made again. And the +4
  is the one kind on that list which stops to ask for a colour, so the batch was committed inside a
  prompt that said nothing about it — the player answered a question about hue and spent two 50-point
  cards. **Every copy past the first was a window somebody else could have won.** That is what the
  batch was really spending, and it is not the presser's to spend.
  Batch play survives on the seat's **own turn** (`Room::play_cards`), where nothing is being raced.
- During a draw chain (`pending_draw > 0`) only DrawTwo/WildDrawFour may interject (`GameError::InterruptNotADrawCard`) — implied by identical-to-top in a consistent state, kept explicit as a guard.
- Window state on `GameState`: `interrupt_open` (the window), `last_play_by: Option<Seat>` (`None` = nobody played the card on top), `last_play_at` (informational). Armed by `arm_interrupt_window(actor, now)` after `play_card` / `play_cards` / `interrupt_play` / `counter_draw`, and opened by `deal_round`. Closed by `close_interrupt_window()` on `draw_card` / `pass_turn` / a round-winning play / a retirement at turn.
- **The opening discard is interceptable, and that is why the window and its author are two fields.** They used to be one, and a dealt card has no author: a seat holding the twin of the card the round opened on was answered `interrupt window closed`, which the client renders as *"somebody was faster"* — on a table where nobody had played anything yet. `deal_round` sets `interrupt_open: true` with `last_play_by` still `None`: the window is open and belongs to no seat, so every rule below (no deadline, nobody excluded, the current player included) applies to it unchanged. `room_interrupt_play_opening_discard_is_interceptable` (`src/tests/room_test_part2.rs`) reads it off a real deal rather than a fixture, because the bug was in what the deal left behind.
- **Bots are the one exception, and it costs nothing to state twice**: `bot_interrupt` and `Table::maybe_schedule_bot_interrupt` both gate on `last_play_by` being `Some`, not on `interrupt_open`, so they answer plays and not deals. A bot slamming the opening discard would take the round's first turn off the seat the deal handed it, before that player had touched anything — an interject is a reaction, and there is nothing there to react to. The hub half is belt and braces: it only schedules off a move anyway.
- Resolution: fastest-server-received wins. The table's own task takes its messages one at a time (`server/crates/loco-hub/src/actor.rs`), so two slams are two commands in arrival order and the second meets the board the first left.
- **The window's state is on the wire, because the client cannot derive it.** `interrupt_open`
  rides `card_played` (open, unless the play took the round), `card_drawn` (shut when the seat at
  turn drew, unchanged when a penalty merely grew a hand — the two are the same message type, which
  is why the flag and not the type is what the client reads), `turn_changed` (shut: a pass, a
  timeout, a retirement), `match_ready` (the deal's, open) and every `GameStateDTO` (always present
  there). An `Option<bool>` on the message: `Some(false)` is the answer that matters and is always
  written; absent means unchanged, which is also what a fixture says. The client kept no copy at all
  and offered the twin for as long as it was on top, so a slam after somebody had drawn was refused
  `interrupt window closed` and rendered as *"somebody was faster"* on a table where nobody had been
  — the same lie the opening discard used to tell, from the other side.
  `interruptWindow.test.ts`, `interrupt_open_rides_the_wire` (`server/crates/loco-hub/tests/interrupt_window.rs`).
- Wire: `interrupt_play` (legacy) + `interrupt_play_card` both accepted, one handler (`InterruptPlayMsg`). Body: `{ card?, chosen_color?, chosen_player?, play_cards? }` — `play_cards` non-empty takes precedence and is refused past one entry. It carries no `declare_loco`: that is read only by `play_card` (a turn batch). Server emits `interrupt_success { player_index, cards[] }` immediately before `card_played` for distinct lead-taking visuals.
- **Batch play** (`Room::play_cards`): current player plays N identical via `play_cards` (precedence over `card`). Effects stack (`stack_batch_effects`: DrawTwo `2*N`, WildDrawFour `4*N`, Skips skip N, Reverses parity). Swap/GlobalSwitch excluded (`GameError::BatchOfRearrangers`).

## Forgetting LOCO! and winning anyway (the gate)
`GameState::require_loco_to_finish(seat, playing, declaring)` + `GameError::MustDeclareLoco`,
`docs/rules.md` §14.7.

**The hole it closed.** The declaration used to be enforced by the catch alone, which made it a 5 s
risk rather than an obligation: go down to one card, survive the window nobody was watching, win a
turn later having told the table nothing. And there was a second, louder version of the same hole —
a hand of **two identical cards played as one batch**. That hand goes 2 → 0. It never passes through
one card, so `update_last_card_state` never fires, no window ever opens, no `catch_seats` ever names
the seat, and the LOCO! button is never even offered. The game's loudest moment simply did not
happen, and a game built to be watched cannot have its ending arrive unannounced. (It was louder
still when sent as an *interject*, taking the round out of turn off a hand nobody saw drop to one.
That half is gone with the batch interject: an interject is one card, so a finish out of turn now
comes off a hand that has been sitting at one, catchable, with the button on screen.)

**Two branches, and the difference is who had the opportunity.**
- `playing == 1`: the seat has held that card since before this message, so the call was possible
  and a whole window existed to make it in. Only `seats[seat].declared` counts. A flag on the
  message would let the client fold the obligation into the winning tap, which is the same as not
  having the rule at all.
- `playing >= 2`: no declaration was ever possible, so none can be demanded of the past. The message
  carries it (`declare_loco`), the domain records it through `declare_for_finish` — which sets the
  flag **and** logs `EventKind::UnoDeclared`, because the log and the broadcast read the state,
  never the message — and `Table::announce_finishing_loco` puts `uno_declared` on the wire
  **before** `card_played`. That hub-side condition is read off the domain (two or more cards and the
  hand now empty), not off the message's `declare_loco`: the domain has already refused the batch if
  the call was absent.

**Nobody is trapped by it.** `Room::declare_last_card` accepts a late call at any point while the
hand is one card — the window being shut does not close the button. So forgetting costs the risk of
being caught and one extra press, never the round. `play_card_last_card_without_the_call_is_refused`
(`src/tests/loco_finish_test.rs`) owns that recovery, and it is the reason this is a gate rather than
a penalty.

**All four win paths ask.** `play_card`, `play_cards`, `interrupt_play`, `counter_draw` — the four
that can reach `finish_round_win`. The check sits **last in each validation block**, so an illegal
card is still refused as illegal and only an otherwise-good play is asked whether the table was
warned; and it sits **before any mutation**, so a refusal leaves the hand, the pile and the turn
untouched. The proptests drive all four against it.

**It is not a suspicious refusal.** Its kind is `ErrorKind::LostRace`: a player forgetting is what
the rule is about, and counting it would make `suspected_cheats` a measure of how badly the table
played. It is deliberately **not** `StaleState` either — the client's board is correct, so a resync
would answer a question nobody asked.

**Bots.** A bot's declaration is deferred on purpose (`BotTimings.uno_delay`) so humans can win the
race, which leaves a window where a bot holds one undeclared card and its turn has already come
round. `Table::bot_declare_before_finish` makes the call first on the ordinary turn, the counter and
the interject, which is always a single card; only a bot's finishing *turn* batch carries
`declare_loco: true` (`BotAction.declare_loco`). Without it the domain refuses, and in the Go server
the bot's play logged and returned **without rescheduling**, so the seat stopped playing for the rest
of the round — a bot that goes quiet does not fail, it just stops. (A refused bot move now gives the
turn up through `Table::bot_recover`, `server.md`.) **That on-the-spot call never comes early**: a
finish off an undeclared last card is held until the bot's own declaration would have come
(`bot_finish_due`, `bot_uno_at`, `server/crates/loco-hub/src/bots.rs`), or the call made on the way
out shuts the catch window the moment the bot finds a card to play (`server.md`, "The move that
takes the round").

**A bot plays its identical copies together on its own turn when a copy buys something**
(`BotAction.cards`, `bot_batch_for`): two +2s are a +4, two Skips step two seats, and a bot's last two
identical cards take the round with the call on the message (`declare_loco`, announced ahead of the
cards by `announce_finishing_loco`). Swap and GlobalSwitch never batch and a plain Wild only when the
batch empties the hand. Before this a bot stacked +2 where a person stacks +4 and handed the table a
catch window on a hand it could have emptied, which is a visibly weaker game than the one it was
sitting in. **Its interject batches nothing** (`bot_interrupt`): an interject is one card for
everybody, so a bot with three copies answers the pile three times, into three windows a human can
win first.
> The turn batch is the bot's alone today — no human tap sends `play_cards` on its own turn, so
> `Room::play_cards` is reachable only by a bot or a hand-written client. That predates the interject
> rule and is a separate decision: either the tap grows a way to send a turn batch, or the bot stops
> making a move nobody at the table can answer with. The rules modal's "Doubles go down together"
> and `content/contrasts.ts` both promise the player the first of those.

**A bot's Swap goes to the smallest hand, and only when it pays** (`bot_swap_target`,
`bot_swap_pays`). A Swap exchanges the whole hand, so the bot used to be handed the *fullest* hand at
the table on purpose — "put pressure on opponents" read the card as a penalty it deals rather than
the trade it is — and a bot on three cards swapping into nine was the seat everybody wanted at their
table. It now targets the fewest cards, skipping a retired seat (its hand went back to the deck, so
it is the smallest of all and the one target the domain refuses), and holds the card when no opponent
is below the hand it would keep: another legal card if it has one, one card off the deck if it does
not, since a draw costs one card and the exchange would have cost several. A Swap that empties the
hand is the exception and is always played — the round ends before any exchange (§13).
`bot_interrupt` applies the same test before slamming one, so the interject is not a faster way to
make a bad trade. `src/tests/bot_test.rs` and `src/tests/bot_interrupt_test.rs` pin all four cases.

**A plain Wild that would change nothing is held, and every wild breaks a colour tie towards the
change** (`bot_wild_is_idle`, `bot_preferred_color`). It is the Swap's test applied to the other card
whose worth is not written on it. A Wild is *only* the colour it names, so one naming the colour
already active is a colour change the table watches land on the colour it was already on — and
because wilds sit in the preferred pool `bot_think` picks from first, a bot spent every colour change
it drew on the turn it drew it, usually on the colour already showing. It now goes out only when
nothing else is playable, which also keeps the case where it is the card that empties the hand: a
card off the deck is worse than a card leaving the hand. The other two wilds are never held — a +4
draws four and a GlobalSwitch turns every hand whatever colour it names — but all three take the
tie-break: where two colours are level in hand, the one that is not already active wins. The
tie-break is free or it is not taken; a colour the hand holds *less* of is paying for the change,
which is a worse hand bought for a better picture.

**Fixtures.** Any test that drives a round to its end makes the call: `declare_last` in the domain
suite (`src/tests/support.rs`), `declare_before_winning` over the wire in the hub suite
(`server/crates/loco-hub/src/testkit.rs`). Three hub fixtures went the other way and were given a
**second card** instead (the drain and snapshot suites, and `play_card_non_swap_omits_chosen_player`
in `server/crates/loco-hub/tests/hub.rs`): they assert that a play resolves, not that a round can be
won, and a one-card hand had made them finishes by accident.

## LOCO! declaration & catch windows (per seat)
- **Receiving your last card owes the table a declaration, exactly like playing down to it**
  (`docs/rules.md` §8, §11.1). What the rule protects is the table's right to know somebody is one
  card from winning; a hand that arrived by rotation is one nobody has heard announced.
- **The tracking is per seat**: `SeatState.declared` + `SeatState.last_card_at`, one record per seat
  built by `deal_round`. A single "last card player" slot cannot express the board a Swap produces:
  it puts **two** players on one card in the same instant (the actor took the opponent's single
  card, the opponent took the actor's leftover), and a GlobalSwitch can put more. With one slot all
  but one walked free.
- After a Swap or a GlobalSwitch the play calls `open_catch_windows_after_rearrange(now)` (every seat
  at 1 card, **including one that declared a beat earlier**, since the card it declared for is not
  the card it now holds), and `update_last_card_state(actor, now)` otherwise.
- `Room::catch_undeclared(catcher, target, now)` is per target and refuses self-catching
  (`GameError::CannotCatchYourself`). `GameState::catchable_targets(now)` returns the open windows
  oldest-first; `Table::maybe_schedule_bot_reactions` arms `schedule_bot_catch`, one attempt per
  window (`bot_catch_attempt`), and `handle_bot_catch`'s stale check compares the target's
  `last_card_at` with the one it was armed for.
- Wire: `catch_uno` carries `target_index` (the catcher names the seat) **when the client has one to
  name**. Absent means the press was made on a read rather than on a cue — the button is live from
  two cards out — and the table still falls back to the window closest to expiring
  (`catchable_targets(now).first()`), which is the catch about to be lost and may be one the client
  had not been told about yet. No open window at all: charged (below).
- **A catch that lands is announced** (`applyUnoCaught` → `store.catchFlash` → `<CatchBanner />` +
  the penalty cards flying to the caught seat). See "Streamable moments" in `visual.md`: for a long time the *miss*
  had a notice and the *hit* had nothing at all, so the game's hardest reaction was also its most
  silent, and the only thing the table saw was two cards appearing in somebody's hand.
- **A Contre-LOCO! that finds nobody costs its caller 1 card** (`docs/rules.md` §14.6,
  `FAILED_CATCH_PENALTY`). Without a price, mashing the button at every seat holding one card is free
  and therefore always correct, which turns the game's hardest reaction into a reflex nobody has to
  aim. Three of the misses are timing, and their kind is `ErrorKind::MissedCatch`: the target
  declared first (`AlreadyDeclared`), its hand grew (`TargetNotSingleCard`), the window closed
  (`CatchWindowExpired`). The wire text is unchanged; what the kind adds is that the table can tell a
  lost race from an invalid target. The fourth is the press made on a read of the table that was
  simply wrong (`GameError::NoCatchWindow`, or no seat named at all), and it is charged like the rest.
  - **It used to be free, and it was free because the button used to be a cue.** While Contre-LOCO!
    only lit up on the seats the server named in `catch_seats`, a call outside a window could only
    be a message no client of ours composed, so it was refused, charged nothing and told nobody. The
    button is now live from two cards out (`client/src/game/catchAvailability.ts`), because
    a control that unlocks on the server's permission can only ever *answer* a five-second window
    and never *anticipate* one. That makes the wrong press an ordinary part of playing, and the
    thing that keeps it honest is the price.
  - **The threshold is what keeps the price from being buyable, and that is why it is two and not
    three.** A card is a punishment only while it stays in the hand that drew it: a player holding a
    Swap or a Global Switch is about to hand their whole hand to somebody else, so a penalty they
    *chose* to take is ammunition, and the round's scoring pays them for it twice — the big hand
    leaves, and it lands on the seat that was about to win. The rationing (once per offer, and it
    used to be once per card played) bounds the *rate* of that but not its *direction*, and per card
    played the rate was worse the bigger the table: a full turn at four seats was three or four
    cards, a good deal faster than the voluntary draw (deviation 4) which is the legitimate way to
    fatten a hand at one card per turn of your own. Worse, the cards it hands over are what make the
    Swap likelier to be there in the first place, so the penalty finances its own profitability.
    - The fix is at the offer, not at the price. From **two** cards (`CATCH_NEAR_HAND`) the window is
      one ordinary play away, so the miss is the thumb that had already committed when the seat drew
      instead of playing — a spasm, which is what a missed reaction is supposed to be. From **three**
      nothing reaches the window in one action at all, so the button would be live through a long
      stretch of round where pressing it can only ever miss. A long stretch of guaranteed misses is
      what turns the penalty into a menu item. (One thing used to reach it: an interject of two
      identical cards. An interject is one card now, so the threshold is exact rather than nearly
      exact.)
    - The criterion, if this is ever re-tuned: **a failed Contre-LOCO! must never be a faster source
      of cards than the voluntary draw**, and the wager must never be offered for longer than it can
      plausibly pay off.
  - **The price is per offer, not per press and not per card played** (`GameState::catch_offer_key`,
    `SeatState.catch_paid_for`). The offer is the near-finish picture the button is live for, as seen
    from the catcher's chair: every *other* seat on exactly two cards (`i:2`), and every other seat on
    its last card with the instant its window opened (`i@instant`). A seat is charged once per key,
    and `Room::penalize_failed_catch` returns `CatchCharge::Free` for every press after that, which
    `Table::penalize_failed_catch` answers with silence — no card, no broadcast, no notice. Two
    reasons as before: a game that billed each press would be taxing the reflex it spends the whole
    match asking for, and a table-wide `catch_failed` per press is the amplification
    `CATCH_GRACE_MS` was written to stop. **It used to be per card played (a play epoch), and that
    was the farm**: a catcher pressed against a seat sitting on two, played a card of their own, and
    pressed again — two cards a turn off one opponent, faster than the voluntary draw, and every card
    of it stocked a hand for a Swap to hand on. The catcher's own play is deliberately not in the
    key, and neither is a card played from far out by anybody else; what moves the key is the near
    seat moving (down to one, which opens a window; back up, which ends the offer) or another seat
    arriving at two. A press that *lands* spends no key, so a Swap that puts two seats on one card
    can still be answered twice.
  - **And the card is only half the price. The other half is a lockout, and it is the half a held
    thumb pays** (`CATCH_LOCKOUT_MS` = 2s, `SeatState.catch_locked_until`, `Room::lock_catch` /
    `catch_locked` / `catch_locked_at`, `GameError::CatchLocked`).

    **The hole the ration above left open.** Rationing per offer bounds what mashing *costs*; it
    says nothing about what mashing *buys*. Press once against a seat sitting on two: one card, and
    from then on every press against the same picture is silent and free. Now the seat plays its
    second-to-last card. The window opens, and the press already in flight — one of ten a second —
    lands milliseconds later, long before any human could have declared. It is a *successful*
    catch, so it spends no offer and costs nothing at all. A held button therefore paid one card
    and collected every window at the table, each of them worth two cards to the seat it landed on.
    The reflex the button exists to measure was not in it anywhere, and a player who had just been
    charged could simply keep leaning on it until the greyed-out control came back.

    **The fix is a second ration on the other axis.** The card stays per offer; the lockout is per
    *press*. Every call that finds nobody arms it — **charged or not**, which is the point: the
    silent free presses are exactly the ones that were buying windows — and **every press made
    while it runs re-arms it**, so a thumb that never lets go pushes its own deadline out forever
    and is never live at the instant a window opens. A single aimed press pays it once and has the
    rest of the window back.

    While it runs, the press **wins nothing and costs nothing**: `catch_undeclared` refuses with
    `CatchLocked` above every refusal that charges, `penalize_failed_catch` returns
    `CatchCharge::Free`, and the table answers with `catch_locked` to the caller alone. Charging
    there would be the per-press price this mechanic spent two rewrites removing; saying nothing at
    all would leave a button that goes quiet for no reason a player can see, and a player who cannot
    see it keeps pressing — which is what pushes the deadline out. A press against a table where
    nothing is offered arms no lock, because it was never a wager (`Table::penalize_failed_catch`
    returns on `Room::catch_offered` first).

    **Two seconds, and the number is the declaration it protects.** A seat that plays down to one
    card needs a beat to notice and call it, and that beat is exactly what a mashed button used to
    take — it is the stretch `CatchHeadStart` (1.5s, retired) held open for *everybody*, which is
    why that answer cost the honest reflex its own race. Held only against a seat that has just
    misread the table, it costs nothing to anyone who did not. Against a 5s window it is short
    enough that a seat which genuinely forgot is still catchable by the same player three seconds
    later: being punished must not be an amnesty for the table.

    **Ordering is load-bearing in two places.** `Table::penalize_failed_catch` arms the lock *after*
    `Room::penalize_failed_catch` has decided the card — armed first, the domain's own guard would
    refund every miss — and after the `catch_failed` broadcast, so the answer lands behind the news
    it is the consequence of. And `CatchLocked` is deliberately not a `MissedCatch` (a locked press
    is not a lost race and pays no card) while it is a `LostRace` (both clocks are honest, and the
    client's is the one guessing at the wire).

    Bots take it on the same terms: `handle_bot_catch` calls straight into `catch_undeclared`, which
    refuses, and a refusal that is not a miss simply means the bot did not press. In practice they
    attempt once per window, so it costs them nothing they were going to use.

    `src/tests/catch_window_test.rs` owns the domain half, including the exploit played out end to
    end; `server/crates/loco-hub/tests/catch_immediate.rs` owns the socket half, where six presses
    cost one card and six lockouts and the press that used to steal the opening window is refused.
  - **And only while something is offered** (`Room::catch_offered`, `CATCH_NEAR_HAND`): a press
    against a table where no other seat is on two cards or on a last card inside
    `CATCH_WINDOW_MS + CATCH_GRACE_MS` is not a wager. It is a board that moved under a thumb — the
    seat drew a moment before the press landed — or a client this game did not write, and neither is
    charged or answered: `Table::handle_catch_uno` asks `Room::catch_offered` before anything else
    and calls `refuse_silently`, which answers nobody and only keeps the press from counting as play
    on the AFK clock (`server.md`). Charged, it was the farm reopened by the back door to
    anybody forging the message; refused with a toast, it scolded a player whose button had been live
    a round trip earlier. The client's threshold (`CATCH_LIVE_MAX_HAND`) and this are the same shape
    on two sides of the wire, and `catchAvailability.test.ts` and the `room_penalize_failed_catch_*`
    cases in `src/tests/room_test_part2.rs` pin each side.
  - **Both ways to lose.** A press is answered on the instant it arrives — the faster of the two
    presses wins — and it is offered for long enough that arriving late is a mistake a player can
    actually make. Neither half was true, and each was wrong in the same direction: the interface
    and the server between them were deciding the wager on the player's behalf.

    *Too early used to be impossible to win.* The opening 1.5s of every window was held for the seat
    that owed the call (the Go server's `CatchHeadStart`, with a hub-side queue of held catches
    resolved when the stretch ended). It was written against a real abuse — a thumb that never let go
    landed on the millisecond the card touched the pile, before the seat's LOCO! could have crossed
    the wire, which made spamming the way to deny every declaration at the table — and it bought that
    at the price of the mechanic. The reflex that won the race waited more than a second to learn it
    had, watching a button that looked dead, and could be overtaken by the seat it had already
    caught. **The ration above is what stops the mashing now** (one press per offer charged, the rest
    silent), and it is the better answer because it costs a spammer a card every time the
    near-finish picture moves while costing the single honest press nothing at all.

    *Too late used to be impossible to lose.* The offer was read off the hand, so it vanished on the
    frame a seat left the near-finish picture — it drew, it swallowed a stack of four, a catch
    landed on it and its hand grew by two — and the button greyed out under a thumb already on its
    way down. A control that retracts there is making the read for the player and making it in their
    favour, which is the same failure as announcing the call. So the offer is the **window**
    (`GameState::catch_offered_seat` asks `catch_race_recent` before it asks the hand, and
    `catch_offer_key` is keyed on `last_card_at` so the ration survives the hand moving underneath
    it), and the client offers the late press for **less** than the server charges for it:
    `CATCH_LATE_GRACE_MS` is 2s against `CATCH_GRACE_MS`'s 3s, and the difference is the round trip.
    Live *longer* than the server charges is a button that does nothing when pressed; live for
    *exactly* as long puts a press made on the final live frame outside the server's window by one
    network hop, which is the dark button's failure arriving from the other side.
    `serverMirrors.test.ts` pins the inequality rather than either number, so both can move as long
    as the room between them survives.

    **The two-card offer has the same late half, much shorter.** A seat on two that draws instead
    of playing (or pays a fruitless call of its own) went to three, and on that frame both sides
    dropped the offer: the button greyed out under the spasm already on its way down.
    `GameState::note_hand_grew` stamps `SeatState.near_left_at` when a hand grows *from exactly*
    `CATCH_NEAR_HAND`, and `catch_offered_seat` keeps the seat offered for `CATCH_NEAR_GRACE_MS`
    (2.5s) past it (`near_recent`); the client keeps the button live `CATCH_NEAR_GRACE_MS` (1.5s),
    the same inequality pinned the same way. Short on purpose: a spasm's worth of lateness, not a
    second look at a picture that has gone. It started at 600ms and was too short to be pressed by
    anything but an inhuman reaction: the hand is seen to grow when the card's flight lands, a beat
    after the message, and the thumb has to find the button after that. Inside the grace
    `catch_offer_key` writes the seat as the two-card picture it left (`i:2`), so a press before the
    draw and one just after are one misread and one card. Three to four leaves nothing behind. Only
    the draw and the failed-call penalty stamp it; a Swap or a GlobalSwitch rearranges hands without
    anybody choosing to grow one, and leaves it alone.

    `src/tests/catch_window_test.rs` owns the domain half of both,
    `server/crates/loco-hub/tests/catch_immediate.rs` the immediacy and the one-card ration through a
    real socket. **The race itself is not an E2E test and must not become one**: measured through
    Playwright, a 6ms head start given to one page's `WebSocket.send` did not survive to the server,
    so the outcome was decided by the harness rather than by the rule.
  - `GameState::catch_race_recent` still separates the two kinds of failure, and it still matters
    even though both now cost the same card: the target's window must have opened inside
    `CATCH_WINDOW_MS + CATCH_GRACE_MS` (5s + 3s) for the call to count as a lost race, and outside
    that it is `NoCatchWindow`. The grace is a network round trip plus the frame the button was drawn
    in. `src/tests/catch_window_test.rs` owns both sides of the line.
  - **A seat number the table does not have is still refused rather than charged**
    (`Table::handle_catch_uno`), with a `note_rejection`: no client of ours composes it, so it is a
    forged message and not a wager. A press naming *nobody* is the opposite — that is precisely what
    the live button produces — and it is charged.
  - `Room::penalize_failed_catch(catcher, now)` draws the card and touches **nothing else** — not the
    turn, not `has_drawn`, not the target. A failed call is a side bet on somebody else's obligation
    and its caller may not even be in turn. Like every draw it cannot fail: with every card in a hand
    the caller simply gets away with it (see "A draw never fails") — and the offer is spent all the
    same (`CatchCharge::Charged { drawn }` with nothing in it), so a dry deck refunds nothing.
  - `Table::penalize_failed_catch` broadcasts `catch_failed { player_index }` (the *caller's* seat)
    then `send_hand_growth`. Both the human path (`handle_catch_uno`) and the bot path
    (`handle_bot_catch`) go through it — a bot that mistimes pays the same price, or the two are
    playing different games. A miss deliberately does **not** `note_suspect` and sends no error
    toast: the button was armed when it was pressed, and the client shows the penalty itself.
  - **A penalty that drew nothing is told to its caller and to nobody else.** `CATCH_GRACE_MS` closed
    the call from *outside* a window; this is the one from inside it. Once both piles are dry the
    draw comes back empty, so the call costs nothing — and announcing it anyway made it the one
    gameplay message that was free to send *and* free to fan out, at ten a second for the whole eight
    seconds a target's window is open. There is also nothing to announce: the table would be
    rendering a penalty nobody paid. The caller still gets the frame, because their button did do
    something.
- **The client spends the wager on press, not on the reply** (`noteCatchAttempt` sets
  `CatchWindow.attempted`, which `deriveCatch` skips, **and** `store.catchSpent`). The server answers
  a round trip later, and since a miss costs a card, a target left armed in the meantime lets one
  impatient double tap pay twice for a single opinion. The 400ms `guardDoubleTap` is not that window.
  The window itself stays open — it is still somebody else's obligation, and another player can still
  take it — and **the button stays pressable**, because greying out under a thumb already on it is
  the one thing the action bar exists not to do.
- **`store.catchSpent` is the client's copy of the server's ration**, cleared by `applyCardPlayed`,
  the one event that can put a new offer on the table. It gates the *blind* press only: with a
  target named, the press always goes. Without it, the second tap of a double tap on a catch that
  landed would leave naming nobody, and the server would read it as a fresh wager against a window
  that had just shut — a card, charged in the same breath as the win. The server's guard would not
  have caught that one: a successful catch spends no offer.
- **`store.catchLockedUntil` is the client's copy of the *other* ration, and it is not a mirror.**
  The server sends the instant (`catch_locked { catch_locked_until }` to the caller alone, and
  `GameStateDTO.catch_locked_until` in every snapshot, personalised); nothing on this side knows how
  long a lockout lasts, so a re-arm is one message rather than a guess and the two cannot drift.
  `localizeDeadlines` moves it onto our clock with every other deadline — read on the wrong one, a
  phone two seconds fast draws a padlock the server has already lifted, and one two seconds slow
  offers a press it refuses. `applyCatchLocked` writes it and lowers `catchPending`: the verdict is
  in, and it is "not yet".
  - **`store.catchLocked` is derived beside `catchLive`**, off the same clock and through the same
    middleware, never written by an action — an action that raised one and forgot the other leaves a
    live button over a press answered by silence, and nothing fails. `catchLiveUntil` becomes the
    lock's own end while it runs, so `GameView`'s single timer brings the button back on the clock
    rather than on the next message: a lock is two seconds and a quiet table is longer than that.
  - **It is drawn rather than merely dead** (`ActionBar`'s padlock + `loco-slide` drain, scene
    `game-catch-locked`). `:disabled` already cuts the button into the bar like every other
    unavailable control; what the lockout adds is the reason and the clock, because it is the one
    dead state the player caused and can wait out. No digits: the countdown is a window running
    out, this game draws those on the compositor, and "2, 1" is a coarser reading of a smoother
    thing. **And it takes the halo off** — `catchArmed` stays true while a seat owes the call, and
    a control that pulses over a press it will refuse is the one lie a reaction bar cannot afford.
    The capsule above still names the window: the opening is real, it is simply not ours this time.
  - **A reloaded tab gets it back from the snapshot.** Without that, the one board a correction
    exists to settle came back with a live button over a refusal the server answers in silence.
- `store.catchFailed { seat, at }` (set by `applyCatchFailed`) drives a red pill in `<GameView />`,
  auto-cleared after `CATCH_FAIL_NOTICE_MS=2800`, plus the `penalty` sting in `soundsForTransition`.
  The penalty reads as an ordinary draw otherwise, which is exactly the wrong story: the card was a
  price paid, not a turn taken. i18n keys `catchFailedYou` / `catchFailedOther` (`%player`); scene
  `game-catch-failed`.
- **Every `player_index` on the wire is an `Option<i32>`, for the same reason as `pending_draw` and
  `has_drawn`.** In the Go server it was a plain `int` with `omitempty`, which dropped seat **0** —
  the host's seat — off the wire, and the client reads `player_index ?? -1` on `uno_declared`: the
  declaration closed the catch window of seat -1, so Contre-LOCO! stayed armed for the full 5s on a
  player who had already called it and the server refused every tap with "player already declared".
  The same message also drove the banner's name and `myDeclared`, so seat 0's own LOCO! button never
  went out either. `Some(0)` is not `None`, so seat 0 is always written;
  `a_zero_behind_an_option_is_written` (`server/crates/loco-protocol/tests/parity.rs`) pins it, and
  the same file replays every frame the Go server wrote and reads them back unchanged.
- **Who is on the hook is the server's answer, and it rides `card_played`** as
  `catch_seats: [{player_index, ends_at}]` (`CatchSeatDTO`, filled by `catch_seats` in
  `server/crates/loco-hub/src/statedto.rs` from `GameState::catchable_targets` +
  `catch_window_end`). The client used to work it out again from the roster and the card kind, which
  put "a Swap or a GlobalSwitch catches EVERY seat left on one card" in two languages with nothing
  checking they agreed. A drift there does not fail: it arms Contre-LOCO! on a tap the server
  refuses, or leaves it dark on a seat the player could have caught.
- Client holds it as `gameStore.catchWindows: { seat, endsAt, attempted? }[]`, and adds nothing to
  the server's list but its own memory of which button it has already pressed. `catchTarget` /
  `unoTimerEnd` are **derived** (`deriveCatch`: most urgent opponent window, never our own seat) so
  `<ActionBar />` and the timer bar stay single-target, and they are completed by the store itself
  (`store/deriveCatchMiddleware.ts`) rather than by each action: stored derived state fails by an
  action forgetting to recompute it, silently. `applyUnoCaught(seat)` on `uno_declared` /
  `uno_caught` retires one seat only; `pruneCatchWindows()` drops expired ones and promotes the next.
- **A hand that grows closes that seat's window** (`applyCardDrawn`). `catch_undeclared` refuses any
  target that no longer holds exactly one card, so a window kept open past a draw is a Contre-LOCO!
  button armed on a tap that can only come back refused.
- **The client also keeps what the table *heard*: `gameStore.declaredSeats`, every seat whose current
  single card has been called.** A window is an obligation and it closes on its own; a declaration is
  a fact about a hand, and it is what says a seat is out of reach rather than merely not on the hook
  yet. Written by `applyUnoDeclared` from the server's confirmation, retired by `applyCardDrawn`
  (the hand grew), by `applyCardPlayed` (the roster says that seat is no longer on one card, or the
  server opened a fresh window on it) and by `applyGameState` (same question asked of a snapshot) —
  the shared filter is `store/helpers.ts: keepDeclarations`. **One** thing reads it:
  - **`myDeclared`**, our own seat, which spends the LOCO! chip. It is **derived** by
    `deriveCatchMiddleware` like `catchTarget`, for the same reason: an action that forgets to clear
    it leaves a dead button over an obligation the player still owes, and nothing fails.
  - **`isCatchLive` deliberately does not.** It reads hand sizes, our own seat and the clock, and a
    declaration the table has heard is not allowed to reach it. The button answers "is a seat near
    the finish", never "is somebody catchable", and the gap between the two questions is where the
    mechanic lives: a control that went dead the moment the last opponent called it would **report
    that call** to a player who was not listening for it, which is the listening the game is asking
    them to do, and it would refuse the press §14.6 exists to charge for — the thumb already on its
    way down when the seat shouted. That press is the spasm the wager is made of. So a declared seat
    stays offered until its window ends, and goes dark **when the clock says so** — a clock that
    runs the same whether the seat spoke or not, and so reports nothing.
    (`catchAvailability.test.ts` pins the seat on a declared single card as **live** inside its
    window and **dead** past it and its grace.)
  - **The clock is `store.onHookUntil`**, seat → the window end the server sent in `catch_seats`,
    written by `applyCardPlayed` and `applyGameState` (`updateOnHook`), plus `CATCH_LATE_GRACE_MS`.
    It is a separate structure from `catchWindows` on purpose: those are retired by `uno_declared`,
    `uno_caught` and a draw, because they drive the *armed* cue, and the clock must survive all
    three — **and it must survive the hand growing, too**, which is why it is read against the seat
    and never against what the seat is holding now. A reloaded tab holds no clock, so a last card the snapshot does not name is dark there —
    the one reading a tab that was not listening can honestly give.
  - **Absence of a window is not a declaration either**, and it must reach the armed cue even less:
    catch seats ride `card_played` only, so a reloaded tab holds none of them.
- **And what ends it is the clock, never the next card** (`isCatchLive` + `catchLiveUntil`, derived
  by `deriveCatchMiddleware`; `GameView` arms one timer on `store.catchLiveUntil` and calls
  `rereadCatchLive`, which is a write naming `catchLive` and nothing else, enough to come back
  through the derivation). The button was once held live from the moment it rose until the next card
  played, on the argument that a seat escaping — calling it, drawing, swallowing a stack of four —
  was the instant a betting thumb had already committed. The argument was right about the thumb and
  wrong about the price: held, the offer was **farmed**. Press against a seat on two, watch it draw
  to three, wait for anybody to play, press again — a card a play, collected on purpose, for a Swap
  to hand on.

  Read off the hand instead, it was wrong in the other direction: the button went dark on the frame
  the seat left the picture, and that is the committed thumb again, spared. So the offer is the
  **window** and the clock is what ends it — the window plus the client's late grace, inside what the
  server charges for, long enough that a press made a beat too late costs the card it should and
  short enough that nothing can be farmed. `catchDerivation.test.ts` owns both halves;
  `penalties.spec.ts` plays the whole shape out against a real server, catch included.
- **`applyGameState` filters catch windows, it does not wipe them.** Swap and GlobalSwitch are
  followed by a personalised `game_state`, so clearing there made the exact rule this exists for
  unreachable: the player handed their last card was catchable for a few milliseconds and then
  untouchable. A window survives only while unexpired *and* its seat still holds one card, so a
  fresh deal still clears everything.

## Swap / GlobalSwitch notifications
- `card_played` includes `chosen_player` ONLY for `swap` (target's index). Omitted for everything else (incl. `global_switch`).
- `card_played` includes `direction` (1=cw, -1=ccw) — the post-effect play direction, populated on every play (not just Reverse). Lets clients update the direction indicator immediately without waiting for the next `game_state`. Client `applyCardPlayed` writes it to `direction` and uses it for the swap/global_switch notice.
- Client `applyCardPlayed` derives `swapNotice` (`gameStore.SwapNotice`) when `card.kind` is `swap`/`global_switch`. Carries `kind`, `actorIndex`, `targetIndex` (-1 for global_switch), `direction` (game direction at play), `at` (Date.now() — the key that makes a second notice a second banner).
- `GameView` shows it as a pill above the action bar (`.swapNotice`, keyed on `at` so a second notice replays the entrance), auto-clears after `SWAP_NOTICE_MS=3500`. i18n keys: `swapNotice`, `swapNoticeYouActor`, `swapNoticeYouTarget`, `globalSwitchNoticeCw`, `globalSwitchNoticeCcw` (`%actor`/`%target`).
- `<GameBoard />` watches `swapNotice.at` and spawns mini card-back trails (actor↔target for swap, chained seat→next-seat for global_switch) via `<AnimationLayer />`.

## Game event log
- `GameState.event_log: Vec<GameEvent>`, append-only (`GameState::log_event`).
- Recorded inside the domain commands: the deal, `play_card`, `play_cards`, `interrupt_play`, `counter_draw`, `draw_card`, `pass_turn`, `declare_last_card` (and `declare_for_finish`), `catch_undeclared`, `penalize_failed_catch` (when it drew a card), `retire_seat`, and the round's and the match's end.
- Each `GameEvent.at` is the command's own `now` (Unix ms), so the log is on the same clock as every deadline; wire = Unix ms.
- **`GameEventDTO` rides the reconnect snapshot and nothing else.** `export_event_log`
  (last 50, `MAX_EVENT_LOG_EXPORT`, `server/crates/loco-hub/src/statedto.rs`) is called by
  `Table::player_game_state`, the single-recipient recovery send, and never by
  `player_game_state_using`, which is what every broadcast loop uses. The log is the one unbounded
  field in a payload that is built *and* marshalled once per recipient, so a GlobalSwitch at a
  ten-seat table (the cap was ten then; it is 7) used to serialise the same 50 events (each with a
  nested card) ten times over, at the exact moment the table is busiest. Nothing in the client reads
  it during play: it exists so a reconnecting player's history can be rebuilt, which is the one send
  that keeps it.

## Per-round history (`Room.round_history`)
- `round_history[k][seat]` = points scored in round k+1, appended by `end_round`. Only the
  finisher scores, so exactly one column per row is non-zero.
- Cleared by `start` and `reset_for_rematch`.
- Exported in `GameStateDTO.round_history` (every snapshot, so a reconnect rebuilds the table) and
  in `round_end`, which is the message the round summary is drawn from and the only one that names
  the round that just finished.
- Server-owned on purpose: cumulative `scores` cannot be split back into rounds once a player wins
  twice, and a client-side accumulator would differ per client after a reconnect.

## A seat that walks out of a match

`Room::retire_seat`, and which of the two endings a departure gets is the table's (`server.md`:
two seats able to play have to be left, or the match ends and goes to whoever stayed). Leaving itself
is never refused. This is what the domain does when the round carries on without the seat.

- **The seat stays and stops playing.** Hands, scores, rounds won and the turn order are indexed by
  it, so removing it mid-match would re-base every one of them under a running round.
  `Room.retired` is match-level and survives every deal; `SeatState.retired` is the copy each round
  is dealt with (`deal_round` deals a retired seat an empty hand).
- **The hand goes back into the deck, shuffled.** Those cards were hidden, so their new position
  tells nobody anything; left in a hand nobody holds they would shrink the deck for everybody else
  every time somebody left.
- **Everything that walks the table skips it**: `next_turn` (which is also why `apply_effect` counts
  *active* seats, `active_seats`, so a Reverse at three seats with one gone behaves as the Skip a
  duel makes it), `rotate_seats` for a Global Switch (the modular step it replaced handed a hand to a
  seat nobody can play from and the round stalled), `biggest_loser` for the next round's opener, and
  the Swap target (`GameError::SeatHasLeft`).
- **A pending draw aimed at it is cleared**, not passed on: the next player never earned it.
- **Its catch window is shut and its declaration marked spent** (`last_card_at = None`,
  `declared = true`), so no client is left with Contre-LOCO! armed on a seat that is not there.
- **The scoreboard is untouched.** A departure is not a forfeit, and `forfeit_to` is still the only
  thing that ends a match early. A seat that had already banked the rounds can therefore still take
  the match on the tiebreak chain: "neither wins nor loses by this act" is the rule, and excluding
  them would be losing by it. `src/tests/retire_test.rs`.

## Rematch (end of match)
- **`rematch` is an ask every seat makes, not a host decision**, and the next match is dealt as soon
  as two asks are in — one offering, one accepting. The quorum, the broadcast (`rematch_offered`), what a
  departure does to a pending agreement and the two shapes the deal can take all live in
  `server.md` ("A rematch by agreement"); what follows is the domain half alone.
- Reopening a finished room as a lobby replies **per recipient** with
  `rematch_started { room_code, player_id, players, match_format, max_players }`.
- `Room::reset_for_rematch()`: requires `Status::Finished` (`GameError::RematchUnavailable` otherwise). Clears `state`, `winner`, `round_ended`, `match_over`, `match_winner`, `round_number`, the map, and empties `scores` / `rounds_won` / `lost_hand_total` / `retired` / `round_history` (so `start` re-sizes them to the roster present at that moment). Keeps `players`, `format`, `max_players`.
- `Table::open_rematched_lobby` (`server/crates/loco-hub/src/rematch.rs`) first calls `prune_absent_players` — drops every seat with no socket behind it that is not a bot (i.e. humans who never came back), high→low, through `Room::remove_lobby_player` and `Table::drop_seat`, which re-bases the members, each surviving client's seat, the bot set and the session tokens together. **This is why `rematch_started` is per-recipient: seats can shift.** `promote_rematch_host` shifts two more when seat 0 is not one of the players who asked, and then `Table::reset_for_next_match` clears everything the finished match left, the map gate included.
- **A finished room's roster is mutable, exactly like a lobby.** `Room::remove_lobby_player` accepts `Status::Finished`, and a disconnect from a finished room goes through `Table::reindex_lobby_disconnect` (+ `player_left` broadcast). Without this a phantom player would be dealt a hand in the rematch.
- Client: `applyRematch(myIndex, players, format, maxPlayers)` wipes all match state → `screen:'waiting'`, **the rematch asks included** (see `client.md`: kept, they disable the button at the next game over). **Keeps `sessionToken`** (same room, still valid for reconnect during the next match). `App` adopts the server's `player_id`.
- `store.setPlayers` re-resolves `myIndex` by matching our own nickname in the incoming roster. Server-side re-indexing (lobby or finished-room disconnect) otherwise leaves a stale index, so a promoted player would never get host controls — e.g. the host leaves the game-over screen and nobody can rematch. Nicknames are unique per room, so the match is unambiguous.
- `GameOver` gives **every** seat the same button, in three states (ask / waiting / they asked
  first), driven by `rematchOffers` + `rematchNeeded` off `rematch_offered`. Past two seats it
  carries the count (`rematchWaitingTable`); at two it does not (`rematchWaitingOpponent`). **The
  size of the table is read off the roster, not off the quorum**, which stops at two whatever the
  size. See
  "The 1v1 queue on screen" in `client.md`.
- Bots survive a rematch. `next_bot_name` (`server/crates/loco-hub/src/bots.rs`) takes the lowest free `BotN` rather than counting seats, so the first bot is `Bot1` and a surviving bot can't cause a duplicate-nickname `join` failure.

## Lobby config
- Host messages: `set_match_format`, `set_max_players` (lobby only; `Room::set_format`, `Room::set_max_players`).
- Max players: `SERVER_MIN_PLAYERS` (2) ≤ n ≤ `SERVER_MAX_PLAYERS` (7); cannot drop below current count.
- Any change → broadcast `lobby_config_changed` (match_format, max_players).
- `room_created`/`room_joined` include `match_format` + `max_players`.
- Defaults: BO1, 7 max (`DEFAULT_MAX_PLAYERS`).
- **Lobby disconnect re-indexes everything.** `Room::remove_lobby_player` removes the player and re-indexes `Player.index`; `Table::drop_client` re-bases the members, each surviving client's seat, the bot set and the session tokens in one move. First remaining player is always seat 0 (host).
- Lobby disconnect leaving no humans → schedule cleanup immediately.

## Room codes
- 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I/l; `ROOM_CODE_CHARS`).
- `tokens::generate_code` (`server/crates/loco-hub/src/tokens.rs`) draws again until it finds a code no live table holds; `HubCore::generate_code` hands it the table map. ~1B combos.
