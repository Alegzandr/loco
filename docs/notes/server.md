# Server: hub, transport, operations

Everything that lives in `server/crates/loco-hub/`: connection management, bot scheduling,
anti-cheat, metrics, room lifecycle. The binary around it is `server/crates/loco-server/`
(`main.rs`, `http.rs`).

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

The server was written in Go first and ported to Rust module for module; the Go tree is gone. Where
a bug history below was found on the Go server, it says so and names the Go function in passing.
Everything described as current is the Rust code.

## How the crate is laid out
**One module per thing a message leads to**, in `server/crates/loco-hub/src/`. It began as one Go
file of 3500 lines holding the hub, every handler, the bots, the timers, the broadcasts and the DTO
builders, and was split by subject before the port; the port kept the split, so every section of
this note names one module.

| Module | What it owns |
| --- | --- |
| `hub.rs` | `Hub` (the cloneable handle, `Shared` behind it) and `HubCore` (the state only the hub's loop touches: the map of tables, the sockets, the queue, the wrong-code budgets), the loop, `open_table`, `delete_room`, `post_to_router` |
| `config.rs` | `HubConfig`: `Limits`, `Timings` (with `MatchmakingTimings` and `BotTimings`), the allowed origins, the `NetPolicy`, debug mode. Every tunable is a field here |
| `actor.rs` | a table's task: `TableHandle`, `TableSender`, `TableJob`, `TableCtx`, `Deadlines` / `DeadlineKey`, `run_job` (the `catch_unwind`), the published `Phase` |
| `table.rs` | `Table`, `Seat`, `Occupant`, `MatchRecord`: one table as one value, and the seat bookkeeping nothing else may do |
| `dispatch.rs` | `dispatch` (the hub's `catch_unwind`), `route`, `post_to_table`, and `Table::dispatch_at_table` (the seat re-check, the gameplay gate, the AFK reset) |
| `refusal.rs` | `Refusal`: every refusal string the hub sends, one variant each |
| `rooms.rs` | opening a table, taking a seat, the host controls, the wrong-code budget, the empty-room cleanup, `ROOM_CODE_CHARS` / `ROOM_CODE_LEN` |
| `rematch.rs` | the ask everybody at the table has to make |
| `gameplay.rs` | play, draw, pass, declare, catch, counter, interrupt; the round and match end |
| `presence.rs` | disconnecting, the hold, its expiry, the reclaim |
| `bots.rs` | every bot delay and every bot decision's scheduling |
| `turntimer.rs` | the turn clock, and the consecutive timeouts that make a seat away |
| `maploading.rs` | the map-loading gate, `is_gameplay_msg` |
| `matchmaking.rs` | the 1v1 queue, the reveal, leaving a table, the walk-out, the forfeit |
| `solo.rs` | `play_bot` |
| `emotes.rs` | the three fixed emotes |
| `debug.rs` | `debug_set_state`, the fixture the Playwright suite deals a table with |
| `broadcast.rs` | sending: `broadcast`, `send_hand_growth`, `refuse_action`, the personalised fan-out |
| `statedto.rs` | what a client is handed: player list, scoreboard, personalised state, `SharedGameState` |
| `convert.rs` | domain to wire conversion, and nothing else |
| `wire.rs` | `decode_client`, the `server_now` stamp, the messages the hub writes on its own account |
| `client.rs` | one socket: its send queue, its two pumps, its token bucket, its latency probe, its seat, `Client::refuse` |
| `serve.rs` | `GET /ws`, `/health`, `/metrics`; `origin_allowed`; admission before the upgrade (`admit`, `AdmissionSlot`) |
| `privacy.rs` | `ClientNet`, `NetPolicy`, `truncate_addr`, `is_routable_client`: the only module that reads a peer address |
| `tokens.rs` / `ids.rs` | room codes, session tokens and room seeds from the OS; the `RoomCode` and `SessionToken` types |
| `room.rs` | `new_room` and `restore_room`: the only ways the hub makes a `loco_game::Room` |
| `clock.rs` | one timeline for the domain's `Millis` and tokio's instants |
| `metrics.rs` | `HubMetrics`, the high-water marks, the Prometheus `Exporter` |
| `logsink.rs` | `AsyncLog`, the `tracing` formatter that writes the Go line shape, the panic hook |
| `drain.rs` / `snapshot.rs` | what a deploy does to a server people are playing on |
| `gotime.rs` | Go's `time.Time` JSON, so a snapshot keeps its shape |
| `online.rs` / `live.rs` | `players_online`; the live-streams strip's one crossing into the loop |
| `testkit.rs` | the socket-level test harness (behind the `testkit` feature) |

Tests: one file per subject under `server/crates/loco-hub/tests/` on `testkit.rs`, the white-box ones
under `src/internal_tests/`, the bench in `benches/hub.rs`. Each test kept its Go name in snake case,
so a test named in a bug history below can be found by grep.

**Where a new handler goes**: beside the others that answer the same kind of message, as a method on
`Table` if it acts on the table its sender sits at, or on `HubCore` if it is genuinely between
tables. A table handler goes in `dispatch_at_table`'s match and its message in `table_scoped`; a hub
one in `route`'s match. A module per subject is what keeps `hub.rs` readable as *the loop* rather
than as an index of everything the server can do.

## A table is one object (`table.rs`)
The Go hub once carried eleven maps all keyed by the same room code (`rooms`, `roomMembers`,
`disconnectedAt`, `sessionTokens`, `emptyRooms`, `botSlots`, `turnStartedAt`, `mapLoading`,
`afkTimeouts`, `matchmade`, `rematchOffers`). A table was not a thing you could hold; it was a string
that eleven structures happened to agree about.

That shape has one failure mode and it is never a crash:

- **Opening a table was eleven writes and deleting one was eleven deletes.** The delete was the only
  place all eleven were named together, so a twelfth map added anywhere leaked per-match state into
  the next match at the same code unless somebody remembered to come back. The per-match reset had
  the same problem in three copies, and the one that bites is the map gate: a loading state left
  behind keeps the next match shut **forever**, because its own timeout has already fired and
  nothing is left to reopen it.
- **A seat number meant a seat in each of them separately.** Removing a seat meant shifting the
  members, the surviving clients' own seat, the bot set and the session tokens, by hand, in three
  places.

Go answered the first half with one `table` struct per code, and the second with a hand-maintained
list (`shiftSeatKeys`) every removal had to go through. That list was a bug waiting for its next map:
a seat-keyed structure added and not listed kept its old indices while the others moved (see "A seat
that is empty has to read as empty" for the one that shipped).

**Here a table is a `Table`, and a seat is one value.** `HubCore::tables` is a
`HashMap<RoomCode, TableHandle>`; one entry is one table's whole existence, so `delete_room` is one
`remove`, a reset is `Table::reset_for_next_match`, and a removal is `Table::drop_seat`. Everything the
table keeps about a seat is a field of one `table::Seat` — `occupant`, `token`, `afk`,
`wants_rematch` — in one `Vec<Seat>`. Removing a seat is `Vec::remove` and a host transfer is
`Vec::swap`, so everything about the seats above the removed one moves with them because it *is*
them, and there is no list to forget. The recap (`match_history`) is the one per-seat thing kept
outside `seats`, and `drop_seat` / `swap_seats` re-base it in the same call
(`drop_seat_from_history`, `swap_seats_in_history`).

**Who is in a chair is an `Occupant`**: `Human(client)`, `Held { since }`, `Gone`, `Bot` or `Vacant`.
A seat cannot be held and seated at once, or a bot with a socket. Go kept that answer in three places
(a hold map, the members slice and a departed set) that had to agree; here `connected` in the roster
is `!is_held && !has_left` by construction (`Table::player_list`).

**Seats are `usize` end to end, and nobody is `None`.** `loco_game::Seat` is `usize`. Go's `-1`
sentinel (`LastPlayBy`, a Swap's chosen player, an event with no player, a match record's winner) is
an `Option<Seat>`, and `i32` appears only on the wire (`loco-protocol`), where the TypeScript reads
it. The hub converts at that boundary and nowhere else (`usize::try_from(n).ok()` on the way in).
`MatchRecord::winner` is `Option<usize>` and still written as Go's `-1`, so the snapshot keeps its
shape.

**The table owns a task** (see "One table, one task"), which is only possible because it was already
one object: there was a single thing to hand the work to. **Add per-table state as a field of
`Table`, or of `Seat` if it is per seat, and never as something another task reads.** The two values
the hub reads without asking — the phase and the bot count — are published by the table itself
after every job (`actor::Published`, read through `TableHandle::phase` and `bots_hint`), never
computed by the reader.

**`Table::seat` is the structural half of the seat-rebind fix below.** Binding a client to a seat
sweeps it out of every other chair at that table, and `HubCore::seat_into` / `Table::seat_client`
ask the table it was at before to sweep it too (a `sweep_old_seat` job). `HubCore::already_seated`
is still there and still refuses, but it is the *polite* half — it answers the client rather than
silently moving them — instead of being the only thing standing between two ordinary lobby messages
and one player receiving another's hand. `src/internal_tests/table_internal.rs`
(`seat_client_leaves_no_pointer_behind`) owns that invariant; `tests/seat_rebind.rs` owns the
refusal.

An absent value carries meaning, which is what let five of the Go maps become plain fields: a `None`
`turn_started_at` is "no turn is being timed" (a bot's, or a table that has not opened), a `None`
`matchmade_at` is "a player opened this", a `None` `loading` is "the table is open", and the empty
room is whether the `room_cleanup` deadline is armed (`Table::cleanup_pending`).

## What bounds this server, and how it is measured
When every room was served by the single event loop, the number of tables this process could carry
was not `MaxRooms`: it was how long one pass through `dispatch` took and how deep the inbound queue
got behind it. `messages_dropped_busy` already reported that ceiling, but only once it had been
crossed, which is a post-mortem rather than a warning.

`/metrics` carries the approach to it, and the numbers followed the work when a table got its own
task (next section):

- `loop_queue_depth` / `loop_queue_capacity` — the **hub's** inbound queue right now
  (`INBOUND_DEPTH`, 256). Every message still passes through it; most of them only pass.
- `loop_slowest_us` — the longest a single job has taken **anywhere** on this process, timed on the
  table that ran it (`actor::run`, `HubMetrics::note_event`). Leaving this on the hub would have
  quietly turned it into "the longest a map lookup took", which is a number nobody can act on.
- `loop_queue_peak` — the deepest any one **table's** box has been seen, which is where a backlog
  shows now.
- `loop_events` is the denominator.

The last two are **high-water marks since startup, never reset and never averaged**: a mean hides
exactly the event that matters, the one slow pass that let a queue build behind it. They are raised
with an atomic max (`metrics::raise32` / `raise64`, `fetch_max`), never load-then-store: every
table's task writes them at once, and two tables reading the same old maximum and both storing loses
the higher of the two — and the one that gets lost is the slow pass somebody is looking for. Not a
data race, which is why nothing would have reported it.

The counters live on one `HubMetrics` struct (`metrics.rs`) rather than as loose fields on the hub,
for the same reason the crate is one module per subject: a struct with a hundred fields hides which of
them are state and which are observations.

**Reaching for a shard is not the answer to a peak.** Look at `loop_slowest_us` first: a single pass
that takes milliseconds is a handler doing something a handler should not, and every one found so far
has been a broadcast that marshalled per recipient rather than once.

## One table, one task
`actor.rs`. Every room used to be served by the hub's single event loop. A table owns its own tokio
task now, and the hub owns what is genuinely between tables: the map of them, the matchmaking queue,
the connected sockets, the wrong-code budgets, the drain.

**A table's task owns its `Table` outright, behind an `mpsc` of `TABLE_BOX_DEPTH` (64).** Nothing else
can read it, and the compiler is what says so: the `Table` is moved into the task, so a second reader
is a type error rather than a data race somebody has to catch at runtime. That is why none of it is
locked. Stopping a table hands its state back (`TableHandle::stop` returns the `Table`), which is how
the snapshot reads every table at one instant without a lock.

**It is not a throughput change, and the numbers below say why.** What it buys is independence. One
table's slowest message was every other table's wait; one handler's panic was recovered on a loop
every match shared; nothing could be said about one table without saying it about all of them. In a
game whose reaction windows are decided by arrival order, a queue shared between strangers' tables is
a fairness question before it is a performance one.

**The two directions are deliberately the same shape**, and both are non-blocking:

| | |
| --- | --- |
| `TableSender::post(job)` | run this on that table |
| `Hub::post_to_router(what, fn)` | run this on the hub |

Non-blocking is not an optimisation. **A blocking send in either direction deadlocks the moment the
other end is trying to send back**, which is a state two busy tables reach on their own. Both are
`try_send`; a full box hands the job back. What cannot be delivered is dropped and counted, and the
crossings where a drop would leak something retry that very job once after a spawned sleep:
`TableSender::post_critical` (a seat nobody frees, a restored table nobody arms) and every
`post_to_router` (a room nobody deletes, a survivor nobody requeues), one second each
(`ROUTER_RETRY`). `channel_retries` counts the retries.

**A job is a boxed closure** (`TableJob`, `FnOnce(&mut Table, &TableCtx)`), carrying a name for the
log and, for a player's message, the `Client` it came from. `TableCtx` is the hub's handle and a way
back into the table's own mailbox.

Four rules hold the split together, and each of them closes a way it could come apart.

- **A message is routed by the hub and re-checked by the table.** `dispatch::route` resolves the
  table from the sender's seat and posts (`post_to_table`); `Table::dispatch_at_table` opens by
  re-reading that seat and returning if it no longer names this table. Between the two the seat can
  have been given up, held or re-based, and a seat number that means one seat here and another there
  is the hidden-state guarantee coming apart. It is also why a socket's seat is **one value**
  (`Client::seat`, an `Option<SeatRef>` of code plus index behind one lock) rather than two fields
  written in pairs, and why `SeatRef` exists at all: `None` is "not at a table", which seat 0 could
  never honestly say.
- **A table is started when the hub has finished filling it in**, never at construction.
  `HubCore::new_table` (or `Table::new`) builds, `HubCore::open_table` starts the task, and every
  construction path — `create_room`, a matchmade pairing, `play_bot`, a snapshot restore — does all
  of its own writing in between. Here the type system enforces it as well: once `open_table` has the
  `Table`, nobody else holds it.
- **Deleting a table removes it and stops it in one step on the loop.** `HubCore::delete_room`
  removes the map entry first, so nothing new can be routed to it, signals the task to stop, and
  awaits it on a spawned task so the hub's loop never waits on a table. "At the same moment" cannot
  be literal without blocking the loop: a job is synchronous, so the one the task may be inside when
  the deletion lands finishes — it is never cut in half. **After it the task runs nothing.** The
  `select!` is biased towards the stop, so no job left in the box runs (they are all addressed to a
  room that no longer exists), and `actor::run` checks the stop before each deadline of a batch that
  fell due together, so not even the rest of that batch runs.
  `internal_tests/lifecycle.rs::a_deleted_table_runs_nothing_after_the_job_it_was_in` holds the task
  inside one deadline, deletes the table, and fails if the second deadline due with it, or a job
  queued behind it, still speaks.
- **A job that must be a table's first is handed to the task, never posted.**
  `HubCore::open_table_with(table, Some(job))` gives the job to `TableHandle::start`, which runs it
  before the task reads its box: there is no box to refuse it and no answer to ignore. The solo deal
  is the one user (`open_solo_table`); it used to be posted with its answer discarded.
  `tests/funnels.rs::no_post_result_is_thrown_away` fails on a `let _ =` in front of a post.
- **A panic is caught on the table too** (`actor::run_job`, `catch_unwind` around each job, with
  `panic = "unwind"` in the release profile), and it matters more there, not less. A panic on the
  old shared loop took the process; a panic that killed a table's task would take only that table,
  but it would take it **silently and permanently**. The room would not fail, it would go quiet:
  every message to it queued behind nothing, for ever, with no error to show the players. Caught,
  it costs one `WARN handler panic recovered`, `handler_panics`, and `server error` to the socket the
  job came from.

`one_slow_table_does_not_hold_up_another` (`tests/actor.rs`) is the whole thing in one assertion, and
`table_panic_costs_one_message_not_the_table` is the fourth rule.

**What stayed on the hub, and why it had to.** `create_room` allocates against `max_rooms` and
inserts into the map. `join_room` spends the wrong-code budget and looks the code up — and then hands
the rest of the join to the table (`Table::join_at_table`), which is also what makes two people typing
the same code in the same instant a queue rather than a race for the last chair. `find_match`,
`play_bot` and `leave_room` are split down the middle: the queue is the hub's, the seat is the
table's, and the two halves are **ordered rather than raced** (the seat is released on the table,
which then posts the enqueue back to the hub), because being in a room and in the queue at once is the
one state neither side could recover from.

**What this cost.** Eight operations that used to be a function call are a hand-off with a window in
it, and `matches_in_flight` reads a published phase instead of the tables themselves. Both are written
down below rather than left to be rediscovered.

**Considered and not done.** A command enum for the table's mailbox instead of closures: the job set
is open-ended (every handler, every deadline), and a closure carries exactly the arguments its
handler takes. A `Seat` newtype over `usize`: every seat is a `Vec` index on both sides of the domain
boundary, and the bug the Go sentinel caused is gone with `Option`.

### Deadlines live in the table's state
A table's deadlines are not timers somewhere else that post back. They are entries in
`Table::deadlines` (`actor::Deadlines`), keyed by `DeadlineKey` (a kind and a seat, or `-1` for the
table as a whole), and the task sleeps until the soonest one inside the same `select!` that reads its
mailbox (`actor::run`). A due deadline runs as a job, through `run_job`, like a message.

**Arming a key replaces what was armed under it, and the paths that end a wait disarm it.** Go's
`time.AfterFunc` could not be cancelled, so every fire compared a stamp (the empty-room instant, the
gate's start, the pairing instant, the turn's start) against the table's and returned if they
differed. Those stamps are gone: `Table::seat` disarms the cleanup, opening the gate disarms its
timeout, a new turn re-arms `turn_timeout`, a rematch re-arms the reveal, and
`reset_for_next_match` clears them all. A deadline that fires is therefore never a stale one in the
sense Go had to guard against. **What a fire still checks is state that can move without a re-arm**:
the match ending, a fixture rewriting the turn, a one-card window closing, the seat no longer being a
bot.

**A reconnect hold takes a unique key** (`Table::unique_key`), because its seat number can be
re-based under it by another seat leaving, and the expiry finds its hold by the instant it began
(`held_seat_at`). Two holds must never replace each other.

A deadline cannot be dropped by a full box: it is not posted anywhere. That retired most of the Go
server's retry list (the bot move, the reconnect expiry, the cleanup, the map-load timeout all used to
be posts that could be lost); see "Server stability" for what still crosses a box.

### One clock
`clock.rs`. The domain takes `now: Millis` and the wire carries absolute server instants, while a
table sleeps on `tokio::time::Instant`. Read from two clocks, they drift apart under
`tokio::time::pause`, where a test advances one and not the other: a catch window that has expired by
the domain's reckoning would still be open by the deadline's. So the unix milliseconds are derived
from tokio's clock, anchored once per process (`now_ms`, `ms_of`, `instant_of`), and a test that
pauses time moves catch windows and deadlines together.

**The anchor keeps the wall clock to the nanosecond.** Rounding it down to the millisecond put every
reading up to a millisecond behind the wall clock for the life of the process, so a `server_now`
could be stamped earlier than the request it answered — about one message in three under load
(`a_reading_is_never_behind_the_wall_clock_it_was_anchored_on`). `system_now` keeps sub-millisecond
precision too: a match opened and won inside one millisecond must still measure 1 ms, because zero is
"cannot say" on the wire.

### What the loop actually costs, measured

The counters above say how loaded the loop is in production. `server/crates/loco-hub/benches/hub.rs`
(criterion, `make bench-server`, deliberately outside CI) says what it is loaded *with*, which is the
number an architectural argument has to start from. It drives a `Table` directly through
`dispatch_at_table` with detached clients (`Client::detached`, `TableCtx::detached`): going through a
socket would measure the kernel.

**Go's numbers, history.** Taken with Go's own benchmark on a Ryzen 7 9850X3D, Go 1.26, in the
container, before the port (the 10-seat column was measured when a table seated ten; the cap is 7 now,
so it stands as an upper bound):

| One pass of the loop (Go) | 2 seats | 4 seats | 10 seats |
| --- | --- | --- | --- |
| `dispatch(play_card)` end to end | 8.1 µs | 8.6 µs | 9.6 µs |
| `broadcastCardPlayed` alone | 0.84 µs | 1.04 µs | 1.71 µs |
| `broadcastPersonalizedGameState` (Swap / GlobalSwitch) | 3.4 µs | 7.9 µs | 28.8 µs |
| `playerGameStateUsing`, one recipient | 0.29 µs | | |

**Go and Rust on one machine** (2026-11-11, a Windows dev box, 16 threads; Go 1.26.5's benchmark
before the Go tree was deleted, Rust `make bench-server`, criterion, release profile; same cases, the
Rust ones named after the Rust functions). Go's numbers here are lower than the table above because
this is a faster box than the container that table was taken in; compare the two columns of one row,
not across tables.

| One pass of the loop | Go 2 / 4 / 10 seats | Rust 2 / 4 / 10 seats |
| --- | --- | --- |
| `dispatch(play_card)` end to end | 2.63 / 3.51 / 5.24 µs | 0.81 / 1.30 / 1.70 µs |
| `broadcast_card_played` alone | 1.12 / 1.70 / 2.73 µs | 0.60 / 1.01 / 1.45 µs |
| `broadcast_personalized_game_state` | 5.68 / 9.44 / 46.8 µs | 2.69 / 6.08 / 21.9 µs |
| `player_game_state_using`, one recipient (10 seats) | 0.32 µs | 0.82 µs |
| a log line through the async sink | 0.16 µs | 0.04 µs |

The Rust card play is about three times cheaper. The one row where it is slower is one recipient's
state: the bench clones the player list into the call each time, which Go's slice did not, and it is
the row that only matters inside the personalised fan-out, where Rust is still ahead. Neither column
changes the argument below: both are three orders of magnitude under the network.

Two things fall out of those tables, and both are load-bearing.

**A single loop was never the ceiling anybody assumed it was.** At Go's 9.6 µs for the worst gameplay
message, one thread absorbed about 104 000 msg/s (Rust's 1.70 µs on the faster box is roughly
590 000). What the server *admits* is bounded elsewhere and lower: `max_clients` (5000) times the
token bucket's 10 msg/s is 50 000 msg/s, every client flooding at its limit forever. **The rate
limiter already held inbound below what one loop handled, with room to spare**, and a realistic table
load (1250 tables of four, an action per player per ten seconds) ran Go at 0.43 % of one core.

So the split into one task per table was **not** bought for throughput, and the note says so where
somebody might otherwise assume it was. What it removes is head-of-line blocking between strangers'
tables: worst case `dispatch` plus a GlobalSwitch fan-out at ten seats (Go, measured before the cap
came down to 7), about 38 µs. That is three orders of magnitude under the network round trip that
already decides every interrupt race — small, and now zero, at the price of ownership rules that
have to be kept. **Anyone proposing to go further should start from these numbers and not from an
intuition about loops.**

**The expensive call in a handler was the log line.** See "The log is off the event loop".

## One message must never be able to cost the server
`dispatch::dispatch` wraps every inbound message in `catch_unwind`, and `Table::dispatch_at_table`
refuses every gameplay message at a table that has not dealt. Both come out of the same audit
finding, and they are floor and wall rather than one fix twice.

**The bug (Go).** A room's state is absent in a lobby and again after a rematch. Almost every handler
delegates straight to a domain call that checks the status first, but two sized a hand *before*
refusing: the draw handler read the sender's hand length on its first line, and the catch handler
read the number of hands to bounds-check the target it had been handed. Both were nil dereferences,
and both were reachable in **two frames** by anybody who could open a socket:

```
connect /ws  ->  {"type":"create_room","nickname":"X"}  ->  {"type":"draw_card"}
```

`origin_allowed` allows a missing `Origin` on purpose (a non-browser client has no ambient credential
to be tricked into replaying), so this needed no browser and no valid table. The map-loading gate did
not help: it only exists for a table that has already dealt.

**Why it was fatal rather than annoying.** Every inbound message was handled on the single event loop,
and nothing recovered anywhere in the server. So the panic was the whole process: every match on it
ended mid-turn, `SIGTERM` was never received so neither the drain nor the snapshot ran, and the
players who reconnected a moment later were told "room not found", the exact outcome the drain was
built to eliminate, reachable at will for the cost of a TCP handshake.

**The two answers.**
- The **gate** (`is_gameplay_msg`, then `room.state` present, `room.status == Playing`, and the
  sender's seat an index into `state.hands`, in `dispatch_at_table`) fixes the class rather than the
  two handlers. The next one to read the state before validating is covered without anybody
  remembering to. It answers `game not in progress` (`Refusal::GameNotInProgress`), resolved by
  `i18n/serverErrors.ts` like every other refusal. In Rust the state is an `Option` and an index is
  bounds-checked, so the original two would have been refusals or a caught panic rather than a dead
  process; the gate stays because it answers the class the right way instead of the wrong way.
- The **catch** bounds the blast radius of whatever the gate does not anticipate: one `WARN handler
  panic recovered` with the message type, the connection, the seat and the panic text, one `server
  error` to the client that sent it, `handler_panics` on `/metrics`. It is twice over now: the hub's
  `dispatch` for what runs on the hub, `actor::run_job` for what runs on a table. It is explicitly
  *not* a licence to skip a bounds check. `Table::player_game_state_with` carries the right instinct
  in its own guards (a missing state, a seat out of range or an empty discard answer with a minimal
  state and a `WARN`), and every handler is held to it.

`tests/hardening.rs` pins both: `gameplay_message_in_lobby_is_refused`, and
`dispatch_panic_does_not_kill_the_hub`, which uses the test-only probe (`Hub::set_dispatch_probe`;
`Hub::set_table_probe` for a table's job) to panic on demand so the catch is proven rather than
assumed. `handler_panics` above zero is a bug by definition and nothing else surfaces it.

**Decoding is stricter than Go's was, and the strings are not.** A client frame is decoded into
`loco_protocol::ClientMsg` in the read pump, so an unknown type, colour, kind, format or emote fails
there rather than in a handler. `wire::decode_client` maps the failure back onto the string the Go
handler used — `unknown message type`, `unknown color: "x"`, `unknown kind: "x"`, `invalid match
format …`, `unknown emote` — and anything else is `invalid message format`.

## Ceilings: what stops an abusive client being an unbounded one
Nothing bounded this server's memory. The token bucket limits one socket's message rate and says
nothing about how many sockets exist, and a table outlives the connection that opened it by
`empty_room_timeout` (5 min). So `connect, create_room, disconnect, repeat` was an allocation loop
costing one handshake a table, and there was no answer to it anywhere in the stack.

Four numbers, all fields of `config::Limits` so a test narrows them by passing its own `HubConfig`,
all deliberately generous: they exist to make the abusive case terminate, not to shape the legitimate
one. A server that refuses a real player is worse than one carrying a few thousand idle rooms, so
**reaching one of these in production is a signal to read the logs, not a number to lower.**

| Knob | Default | Refused where | Answer |
| --- | --- | --- | --- |
| `max_clients` | 5000 | `serve_ws`, before the upgrade | HTTP 429 |
| `max_conns_per_net` | 64 | `serve_ws`, before the upgrade | HTTP 429 |
| `max_rooms` | 2000 | `handle_create_room`, `open_solo_table` | `the server is full, try again in a moment` |
| `max_failed_joins` | 20 / min / network | `handle_join_room` | `too many attempts, wait a moment` |

Three details that are not arbitrary:

- **Admission is decided before the upgrade**, in `serve::admit`, against its own counter
  (`Admission`) rather than the `clients` metric. That one is maintained by the hub's loop, which
  leaves a window between the upgrade and the register that an unbounded number of sockets can
  arrive in, and that window is precisely where a flood lives. Refusing early also means a
  connection this server will not serve never costs it an upgraded socket, a 256-slot send buffer
  and two pump tasks. 429 rather than a close so a refusal is distinguishable from a network failure,
  in the client and in nginx's log.
- **The admission slot is a value** (`AdmissionSlot`), given back exactly once: by the hub when it
  unregisters the client, or by being dropped when the upgrade never completed. A hand-written
  decrement on every early return is a counter that drifts upwards until the ceiling is reached by
  nobody.
- **The room cap is on `create_room` (and on `play_bot`), not on the socket**, because that is the
  message that allocates something outliving its connection.

`max_conns_per_net` is keyed by the same truncated prefix the logs are (`truncate_addr`, `/24` or
`/48`), so nothing here retains an address the rest of the server has already decided not to keep. 64
is high enough for a household, a LAN party or an office behind one address.

**The pumps start only once the hub has registered the client.** The register carries a `oneshot`
the loop fires after inserting the client, and `serve_ws` waits for it before running the pumps, so
the reader's unregister can never be processed before the register.

### Which network, though

Both ceilings above are per network, and **in production this server never sees one**. The path is
browser → Cloudflare → Traefik → nginx → here, so the TCP peer is the nginx container on the
`internal` Docker network and it is the same address for every player alive. Read it directly and the
two ceilings stop being per network:

- `max_conns_per_net` becomes the total number of sockets the site can hold. The 65th player anywhere
  is refused with a 429 **before the upgrade**, and `conns_refused` climbs while `clients` sits at 64.
- `max_failed_joins` becomes global. Twenty mistyped codes across everybody, and `join_room` is
  refused site-wide for the rest of the minute.
- Every `addr=` in the log is a constant, which leaves `conn=` as the only correlator and quietly
  removes the one field an operator reads to tell two networks apart.

None of that fails loudly. It reads as "the game refuses everybody past 64 players" and blames one
address in the log while doing it.

So the network is decided once, by `NetPolicy::client_net` (`privacy.rs`, through the `ClientNet`
extractor `serve_ws` takes), and kept on `Client::net_key`, which is what admission, the failed-join
budget and `Client::net_prefix` all answer with. It reads `client_ip_headers` in order —
`CF-Connecting-IP`, then `X-Real-IP`, `LOCO_CLIENT_IP_HEADERS` to change them — **and only when the
peer is a trusted proxy**, `trusted_proxies` / `LOCO_TRUSTED_PROXIES`, defaulting to loopback and the
private ranges. That default is not laxity: the server container exposes 8080 on `internal` only
(`expose`, never `ports`), so nginx is the single peer that can reach it and a public address never
arrives here at all.

**Two headers because production has two paths to this server, and one player can use both inside a
single match.** The page and everything cacheable go through the CDN, which sets `CF-Connecting-IP`.
The socket is dialled on a hostname resolved outside it, where nothing sets that header and Traefik
is what overwrites `X-Real-IP` with the peer it accepted. **The order is a security property, not a
preference**: on the proxied path a client can put an `X-Real-IP` of its own invention on the request
and the CDN forwards it, so the header the CDN itself controls has to be read first.
`client_net_prefers_the_header_the_proxy_sets` is that assertion.

Four things it refuses to believe, each of which would hand somebody a private budget:

- **A header from an untrusted peer.** It is a claim about a network, not a report of one.
- **A multi-value header.** This is why the default is `CF-Connecting-IP` and not `X-Forwarded-For`:
  Cloudflare *sets* the former and *appends* to the latter, so the leftmost `X-Forwarded-For` entry is
  whatever the client invented. Both spellings of a second value fall back to the peer: a comma list
  on one line, and the same header sent twice (`HeaderMap::get_all`, since `get` returns only the
  first line). `client_net_refuses_a_repeated_header`.
- **An unparseable or empty one.** A topology nobody described, so the peer stands.
- **An address no browser on the internet could have** (`is_routable_client`): loopback, private,
  link-local, multicast, unspecified, in either family and through a v6 mapping. See below — this one
  was added with the proxy fix and answers the sharper half of it.

The forwarded address is truncated on the way in like every other, so the fallback is exactly the
behaviour that came before and no full address ever reaches a counter, a map key or a log line.

### The header a host may forward is decided by the host, not by the proxy block

`client/ws-proxy.conf` is `include`d by **both** server blocks, and it used to forward
`$http_cf_connecting_ip` and `$http_x_real_ip` from both. That was a hole, and it is the sharpest one
this file has had.

`ws.` is grey-clouded **by design** — bypassing the CDN is the entire reason it exists — so Cloudflare
is not on that path and nothing there sets or strips `CF-Connecting-IP`. A client wrote its own, nginx
forwarded it, and this server believed it, because the peer it checks against the trusted proxies is
the nginx container either way. One forged header per socket was one network key per socket, which is
every per-network ceiling in the server at once: `max_conns_per_net` stops bounding anything, and so
does the wrong-code budget that is the only thing rationing a sweep of the table-code space.

Nothing above the proxy could have caught it. The header arrives, parses, and looks exactly like the
real thing at every layer; the only place the truth exists is which host the request came in on.

So each server block now `set`s `$loco_cf_ip` / `$loco_real_ip` to the one header its own path
guarantees and to `""` for the other, and the shared block forwards the variables. An empty value
makes nginx omit the header, which lands on the fallback above. The site's host vouches for
`CF-Connecting-IP` (Cloudflare sets it there); `ws.` vouches for `X-Real-IP` (Traefik overwrites it
there). `client/src/test/csp.test.ts` pins all three parts — the variables, both `set` pairs, and the
absence of any `$http_` on those two lines.

`is_routable_client` is the server-side half, and it is not redundant with the proxy fix: the two
forgeries differ in kind. A forged **public** address buys its sender a bucket of their own, which is
bounded by the ceilings being per-network in the first place. A forged **private** one can be aimed at
the bucket every socket with no trustworthy header falls back into — the proxy's own — so filling it
refuses everybody else at the upgrade.
`client_net_ignores_a_forwarded_address_no_browser_could_have`.

**What is left, and it is not this repository's to close**: Traefik is public, so anyone who finds the
origin address can reach the site's vhost directly, bypassing Cloudflare, and write a
`CF-Connecting-IP` that this host does legitimately vouch for. The fix is an allowlist of Cloudflare's
published ranges on the host Traefik's `websecure` entrypoint, next to the certificate configuration
that also lives there. Until then the residual exposure is one forged network key per attacker who
knows the origin IP.

An IPv6 player arrives as an IPv6 address and is truncated to the routed `/48`, which is why nothing
in this stack needs Cloudflare's Pseudo IPv4: it exists for origins that cannot parse one.

`conns_refused` on `/metrics` is a load signal, not an incident, until it climbs.

## A wrong table code is not free any more
A table code is 6 characters of a 32-symbol alphabet, so 32^6 ≈ 1.07e9. That is a large number for
finding *one* table and a much smaller problem for finding *any* of them: the odds scale with how
many are open, so a busy server was walkable, and a refused `join_room` used to cost nothing at all:
no counter, no penalty, nothing per address. The suspicion counter only ever covered the gameplay
handlers.

`max_failed_joins` wrong codes per network per minute (`HubCore::join_budgets`, `join_throttled`,
`note_failed_join`), after which `join_room` is refused for the rest of the window **before the
lookup**, so a throttled network learns nothing from the answer either. Three things are charged: a
string that is not a table code at all, a code no table holds, and a join at a table in progress that
is not a valid reclaim (the table posts that one back to the hub, `failed_join`). Keyed by network
rather than by socket, because a socket is free: a sweeper reconnects between attempts and a
per-connection counter would only have measured its patience. The map is swept of expired windows
when it passes `MAX_JOIN_BUDGETS` (4096), so the ordinary path stays one lookup.

**The table code is a type** (`ids::RoomCode`). A code typed by a player is parsed once, at
`join_room`, by `RoomCode::parse` — exactly `ROOM_CODE_LEN` characters of `ROOM_CODE_CHARS` in
`rooms.rs`, either case, upper-cased — and is the key of `HubCore::tables`. `RoomCode::from_trusted`
is for a code this server minted (the generator, a snapshot). `tokens::generate_code` spells the
alphabet and the length out as well; `client/src/test/serverSource.ts` reads both off the source to
pin the client's mirror, and `the_code_rule_is_the_generator_s` holds the two spellings together.

A player who mistypes their code once is nowhere near 20, and
`one_mistyped_code_does_not_lock_a_player_out` is what keeps it that way.

## The reclaim refusal names nothing
`join_room` at a table in progress used to answer two different strings: `invalid session token for
reconnect` when the nickname matched a seat that was actually held, and `game already in progress`
otherwise. The difference was a roster oracle (anybody with a code could test names against the
table) and it bought nothing, because a returning player's client already owns the failed-reclaim
case through its own restore timeout (`sessionRestore`, `reconnectFailed`).

Both now answer `game already in progress` (`Refusal::GameAlreadyInProgress`, from
`Table::join_at_table`). `i18n/serverErrors.ts` keeps its `invalid session token` rule for a client
talking to an older server, and says so.

`reclaim_refusal_reveals_nothing_about_the_roster` (`tests/hardening.rs`) compares the two answers
directly, which is the only way this stays true.

## Anti-cheat
Defend: illegal cards, turn spoofing, hidden-state manipulation, replay, forged reactions/declarations, dup spam, tampered hand, client win claims.
Posture: validate every message, reject illegal/out-of-turn, server-side hidden state, ignore client timestamps for outcomes, server outcomes final, OS-random session tokens (required for reconnect), per-client rate limit (token bucket 10 msg/s, burst 20).

Replay protection is implicit: the protocol carries no nonce, and every gameplay handler validates
against the current authoritative state, so a replayed message fails the moment the state has moved
past it. Identity (the seat, the table) is server-assigned and never read from the message.

**Every refusal is a variant of `refusal::Refusal`**, whose `Display` is the wire string, byte for
byte what the Go server sent (a domain refusal travels as its `loco_game::GameError` through
`From<GameError>`, whose text is Go's too; the few built from a value are `Refusal::Other`).
`Client::refuse` is the single funnel every refusal goes through, which is what lets the dispatch
boundary count them. `client/src/i18n/serverErrors.ts` maps those strings: **a new refusal goes in
both places in the same change**.

- **The upgrade checks `Origin`** (`serve::origin_allowed`). Accepting a socket from any page on the
  internet was the Go server's original behaviour. The exposure is genuinely small — no login, no
  cookie, no ambient credential, so a cross-site socket has nothing to borrow — but an unrestricted
  upgrade is a free room-creation and message-flood endpoint pointed at this server from anybody's
  page, with only the per-connection rate limit behind it. Default rule: **hostnames must match,
  ports need not**, which holds in dev (Vite on :5173, the server on :8080) with no configuration.
  `LOCO_ALLOWED_ORIGINS` (comma-separated, `HubConfig::allowed_origins`) overrides it with an exact
  allowlist, and once set it is the *whole* rule. A missing `Origin` is not a browser and is allowed.
  A refused origin is an HTTP 403.

  **In production that default rule does not hold, and `LOCO_ALLOWED_ORIGINS` is mandatory there.**
  The page is served from `ohloco.com` and the socket is dialled on `ws.ohloco.com`, so the `Origin`
  hostname and the request `Host` are deliberately different and every upgrade would be refused — as
  a *refused upgrade*, which the client cannot tell from the server being down. The allowlist names
  **the page's origin, never the socket's**: it is the document that opens the connection.
  `write_app_env` in `.gitlab-ci.yml` writes `https://${APP_HOST}` for both environments; the value
  committed in `deploy/app.env` is the shape.
- **`nginx.conf` sends the security headers** the client was already built for: a closed CSP (no
  CDN, no analytics, self-hosted fonts), `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  `script-src` has no `'unsafe-inline'`; `style-src` must (Astro inlines every stylesheet, and the
  board writes a `style` attribute per card). `connect-src` names `ws://$host` and
  `wss://$host` explicitly — a page on `http://` and a socket on `ws://` are different origins as
  far as CSP is concerned, so `'self'` alone would block the one connection the game is made of.
  They live in `client/security-headers.conf` and are `include`d, for the reason `testing-ci.md`
  gives at length: `add_header` does not merge, so a `location` block declaring one of its own
  inherits none of these.
- **A socket holds one seat, and the table is the authority on which.** A seat is recorded twice: the
  connection knows it as `Client::seat`, and the table knows it as the `Occupant::Human(client)` at
  that index of `Table::seats`. On the Go server nothing stopped a seated client from sending
  `create_room` or `join_room` again, and re-entering moved only the connection's copy. The pointer
  stayed behind in the old room at the old index while the connection's seat named a seat somewhere
  else, and every personalised broadcast for the old room was then built from the wrong index, so a
  player seated at 1 who rebound to seat 0 of a throwaway room was sent **seat 0's hand** in the
  match they had just left, for as long as it lasted. No tampered client, no forged message: two
  ordinary lobby messages in sequence defeated the one guarantee the server exists to provide.
  `Table::seat` is what makes it unreachable (see "A table is one object" above) and
  `HubCore::already_seated` is the guard that answers it, on `create_room`, `join_room`, `find_match`
  and `play_bot`. It does not touch reconnects, which arrive on a fresh socket with no seat, and it
  releases a client whose room was deleted underneath it (`Client::leave_seat`) rather than locking
  it out of the lobby forever.

  The second half of the fix is that **a personalised send indexes by slot**, never by what the
  client's record claims. Every fan-out is `for (seat, m) in self.clients()` and builds seat `seat`'s
  state for socket `m`. The two agree for a correctly seated client and `already_seated` is what keeps
  them agreeing, but a call that hands out a hand should read where the room filed the client. The Go
  `debug_set_state` handler already did this, which is why it was the one personalised path that
  never leaked, and why the regression test (`tests/seat_rebind.rs`) goes through a Swap rather than
  through `debug_set_state`, or it proves nothing.
- **The OS generator for room codes as well as session tokens, with no weaker fallback anywhere**
  (`tokens.rs`, `OsRng`). A room code is not decoration: there is no login and no invite behind it,
  so the six characters *are* the access control on a private lobby. A deterministic generator is a
  sequence, and an attacker creating rooms in a loop observes that sequence's output directly: the
  precise observation needed to infer its state and name the codes handed to everyone else meanwhile.
  `tokens::rand_index` draws with a mask-and-retry that stays uniform for any alphabet size (the
  32-character alphabet never retries). There is no fallback on an error path either: a token
  degraded to a predictable source would turn the only authentication in the game into a guessable
  number, so an OS that cannot produce entropy panics (`os_fill`), which is the right outcome for a
  server that can no longer issue a trustworthy token — the job's `catch_unwind` turns it into a
  refused message rather than a dead process. The bots' jitter and choices come from `rand`'s
  thread-local generator, which decides no hidden state, so predictability there costs nothing.
- **And for the room's own RNG, which is the one that took longest to see.** The Go server's room
  constructor seeded its generator from the nanosecond clock, which read as harmless — it is "just
  the shuffle", and the room code and the token, the two things obviously worth protecting, were
  already right. But that one source decides the map, the starting seat and, through the deal, the
  order of all 112 cards for this round and every round after it. It *is* the hidden state the server
  exists to protect, and a seeded generator is deterministic, so the seed is the whole match.
  The attack needs no privilege and no timing precision. Create a table and note the round trip: the
  seed is somewhere in a window a few milliseconds wide, a few million candidates. Start the game
  and read back the three things `game_started` legitimately tells you — the map, the starting seat,
  and your own eight cards. Replay each candidate offline; the hand alone is a forty-bit filter, so
  exactly one survives. You now hold every opponent's hand, the draw order, and the deal of every
  remaining round of a BO7 — the later rounds computable at leisure while round 1 is still being
  played, so the brute force is not even on a real-time budget. Interrupts, catch windows and
  counter-draws are all built on hands nobody else can see; predictable ones make the mechanic
  decoration and the anti-cheat work upstream pointless.
  **A `loco_game::Room` is a ChaCha generator seeded with 32 bytes the hub draws from the OS**
  (`room::new_room` → `tokens::room_seed` → `Room::new(code, seed)`); the domain crate cannot read
  the OS itself, so the seed is the hub's to draw, and `new_room` is the only way the hub makes a
  room. **The RNG never travels**: the snapshot holds a `loco_game::SavedRoom`, and
  `SavedRoom::restore` takes fresh OS bytes (`room::restore_room`), so a room with no source cannot
  exist. Go filled one in lazily on first use after a restore, which was the worse case, since the
  restore instant is announced to everyone by the server coming back up.
  `server/crates/loco-game/src/tests/rng_test.rs` is not a property assertion, it **runs the
  attack**: it brackets the constructor, walks every nanosecond in the window against the same cipher
  seeded from the clock, and fails if any of them reproduces the deal. It carries a planted clock seed
  as a positive control, because a replay that has drifted out of step with the deal reports "not
  found" for every room, safe or not — and would pass forever.
  `Deck::replenish` takes the room's own source (`Room::rng_mut`). Go once shuffled the replenished
  pile off a global generator, on the argument that only the deal was reconstructible — but the pile
  going back into the deck is the second half of a long round, every card in it has been seen by the
  table, and whoever can predict its order knows the rest of the round outright.
  `replenish_uses_the_rooms_own_source` (`deck_test.rs`) replenishes the same pile from two rooms and
  requires the orders to differ; a shared source makes them equal.
- **A refused message must never be cheaper than an accepted one.** This is the finding an audit of
  every inbound message produced, and it is one sentence because all four bugs were the same bug.
  The server had been read for what it *lets* a client do, which was already tight: nothing on the
  wire carries a hand but your own, no deck, no discard pile past the top card, no queue size, no
  roster oracle on a refusal. What had never been priced is what a client gets for a message the
  server turns *down*, and in four places that was more than it got for playing properly.
  - **The AFK counter was cleared before the handler ran.** The reset sat at the dispatch boundary,
    on every gameplay message, whatever became of it — which is the right place for it and was the
    wrong moment. A seat holding eight cards cannot declare, so `declare_uno` is refused every time,
    and one of them a turn bought permanent immunity from the threshold: the seat timed out for
    ever, auto-drew for ever, and was never once counted away. In a matchmade room that threshold is
    the *only* thing between a stranger and an opponent who has walked away — the reconnect hold
    covers a socket that left, and this covers one that stayed. Sending a message proves a socket is
    alive; it does not prove anybody is playing.
    The reset now runs after the handler and only if the socket was not refused, counted by
    `Client::refusals` as a before/after pair in `dispatch_at_table`. Not reported by each handler on
    purpose: `Client::refuse` is already the single funnel every refusal in the server goes through,
    so a handler written next year cannot forget to use it, which is the property the
    dispatch-boundary version had and is the only reason it was there.
    **A gameplay message answered by nobody is a refusal too.** A Contre-LOCO! aimed at a table where
    nothing is offered, one pressed inside the caller's own lockout, or one already charged for this
    offer is deliberately met with silence (or only `catch_locked`), so `refuse` never runs and the
    before/after pair would read it as accepted: a held catch button would have been the new
    `declare_uno`, an immunity from the threshold bought for nothing. Those paths call
    `Client::refuse_silently` (`handle_catch_uno`; a miss `penalize_failed_catch` did not show the
    table counts too), which bumps the count without answering.
    `catch_uno_silent_refusals_are_counted_as_refusals` (`src/internal_tests/catch_afk_internal.rs`).
  - **A Contre-LOCO! on a seat that was never on the hook was charged like a lost race**, and
    therefore *announced* like one. Every timing refusal (`ErrorKind::MissedCatch`) costs the caller a
    card and puts a `catch_failed` in front of the whole table, which is exactly right for the wager
    the mechanic is built on and exactly wrong for a call on somebody holding eight cards: the caller
    had nothing to lose the race to. So it was a broadcast to every seat, at whatever the token
    bucket allows, and **free** the moment the piles ran dry and the penalty draw came back empty.
    The domain's catch grace (3s past the 5s window, `CATCH_GRACE_MS`) is the line: inside it the
    window was live when the button was drawn and the message lost the trip, which is a wager;
    outside it no client was drawing that button at all.
    And the free-once-the-piles-are-dry half is closed on its own: `Table::penalize_failed_catch`
    sends a charge that drew nothing to its caller alone, so a penalty nobody paid is not a
    table-wide send either.
  - **That last part was rewritten when the button stopped being a cue.** Contre-LOCO! is live
    while some other seat is on two cards or on a last card inside its window, so a press with no
    window behind it can be the mechanic — and `GameError::NoCatchWindow` costs its caller a card
    like every other miss *while something is offered* (`docs/rules.md` §14.6, `Room::catch_offered`).
    What replaces the free refusal as the amplification guard is the offer key (the domain's
    `catch_offer_key`, remembered per seat as `catch_paid_for`): **a seat is charged at most once per
    offer**, and every press after that draws nothing, broadcasts nothing and answers nobody. Ten
    messages a second still buy exactly one `catch_failed`. A press against a table where nothing is
    offered — eight-card hands all round, or the seat drew a round trip before the press landed — is
    the same silence: not charged (charged, it was a card farm for anybody forging the message), not
    answered (a toast there scolds a player whose button was live a moment ago), counted only as a
    silent refusal. What stays refused-and-counted is a `target_index` the table does not have,
    negative or past the end: no client of ours composes it, so it is a forged message rather than a
    wager, and `Client::note_rejection` counts it toward `suspected_cheats`.
  - **And nothing holds a press back on the way in.** `handle_catch_uno` reaches its verdict on the
    instant the message arrives, because the ration above is what answers a mashed button and it
    answers it without costing the single honest press anything. The Go server once held the opening
    1.5s of every window for the seat that owed the call (`CatchHeadStart`); what that bought and what
    it cost is in [`domain-rules.md`](domain-rules.md), "Both ways to lose".
  - **`rematch` republished an ask that was already in the set.** Membership is idempotent, the
    broadcast was not: one socket at the rate limit became ten `rematch_offered` frames a second to
    every seat. Answered the way `map_ready` answers its own duplicate — not an error, simply
    already true.
  - **A stale-state refusal pulled a full personalised snapshot every time.** That correction is the
    most expensive message this server sends, and one is enough: the drift is corrected by the
    first, and everything the client sends in the millisecond after it was composed against the old
    board. `resync_period` (1s per socket, `Client::claim_resync`) is the same treatment, for the same
    reason, that the rate-limit notice already needed. `resync_is_throttled_to_one_per_second`.

  **And the gameplay gate bounds the seat as well as the state.** Four domain entry points index the
  hands by the sender's seat on their way in. That was unreachable — a seat is only ever dropped in a
  lobby or a finished room — and "unreachable today" is precisely the argument the missing-state gap
  two sections up was written on, four frames from an unauthenticated stranger. One comparison in
  `dispatch_at_table` closes the class instead of four bounds checks that have to be re-derived every
  time a seat learns a new way to move.
- **A refused action is not automatically suspicious.** A refusal's class is `GameError::kind()`, one
  `ErrorKind` per error: `LostRace` names the refusals a correct client produces all match long — a
  second draw, a pass that raced its draw, an interject whose window closed or whose top card
  changed, a call inside the lockout — and `MissedCatch` a wager lost; `ErrorKind::is_honest()` is
  both. `Client::note_rejection` returns early on an honest one and otherwise calls `note_suspect`.
  Counting lost races made `suspected_cheats` rise fastest at the busiest, most contested tables,
  which is exactly backwards. Go asked the same question with four `errors.Is` predicates over
  wrapped sentinels; here a refusal has exactly one kind and the hub matches on it, and the wire text
  is unchanged and free to be reworded.

## The nickname
`server/crates/loco-game/src/nickname.rs`, called by `HubCore::validate_nickname` on the four ways
into a seat (`create_room`, `join_room`, `find_match`, `play_bot`). Everything below is the server's;
the client mirrors the shape rules only, so a refusal is instant, and is trusted for nothing.

**One refusal, whatever fired it.** `GameError::NicknameLength`, `NicknameCharset` and
`NicknameBlocked` (all of `ErrorKind::NicknameRejected`) reach the wire as one string, `nickname not
allowed` (`Refusal::NicknameRejected`); the specific error is kept for the log line and for the
tests. A refusal that names its rule is a tutorial: told "blocked word", the next attempt is the same
insult with a letter moved, and the person doing it now knows which half of the filter to work on.
Told "1 to 20 characters", nobody learns anything either, because the field already stops at 20. The
client resolves that string through `i18n/serverErrors.ts` like any other, and shows the *same* line
for the shapes it refuses itself, so the two halves cannot be told apart from the outside.

**The length is in characters.** The first check counted bytes: "Étienne" cost 8 of 20 and a Cyrillic
name cost double. `NICKNAME_MAX_RUNES = 20`, counted in characters, on the canonical form.

**The charset is an allowlist, not a blocklist of tricks.** Letters in Latin, Greek or Cyrillic,
ASCII digits, one space between words, and `-_.'` for O'Brien, Anne-Marie and Mr. Bean. That single
rule is what excludes the zero-width characters, the bidi overrides (`U+202E` and friends, which
reverse the seat label and can make a nickname read as somebody else's), the control characters,
emoji, and the Mathematical Alphanumeric Symbols block — whose 𝐟𝐮𝐜𝐤 is four *letters* as far as a
general-category test is concerned and renders as the word, which is why "any letter" was never an
option. Combining marks are capped at one per base letter: one is how "Á" is written when it is not
precomposed, a stack of them is Zalgo, which paints over the seat above it and is unreadable at 720p,
which is the product. A nickname must also contain at least one letter or digit: `---` is inside the
charset and is not a name.

**Normalisation is what keeps the list short.** A list is a losing game played one spelling at a
time, so the input is folded first: diacritics stripped (precomposed through a table, decomposed by
dropping the marks, so both spellings of "é" fold alike — a normalisation crate is not worth a
dependency for a 20-character string), lower-cased, leet undone (`0o 1i 3e 4a 5s 7t @a $s !i +t |i`),
separators dropped so `f.u.c.k` is one word, and a second pass that squeezes repeats so `salooope`
is `salope`. The leet map is deliberately conservative: `2` is absent, because every aggressive
entry is a way to refuse somebody their own name.

**The words are not ours.** `server/crates/loco-game/wordlists/` is Shutterstock's LDNOOBW list, CC BY
4.0, 19 Latin/Greek/Cyrillic languages of it, compiled into the binary with `include_str!`. Vendored
rather than fetched: the check costs a map lookup and a walk over a few hundred short strings, once,
when a player takes a seat, and it has no key, no quota, no rate limit and nothing that can fail at
3am because a third party moved a route. Refreshing it is `curl` into that directory and a test run;
the attribution lives in `NOTICE.md`.

**How it is applied is ours, because applied naively it refuses a phone book.** Three rules:

1. The whole nickname, and every token in it, is matched against every term. Tokens are cut
   structurally — on separators, on digit boundaries, and on a lower→upper transition — so
   `Xx_Salope_xX` and `xXsalopeXx` both yield `salope` without a single entry being written for the
   decoration.
2. Substring matching is limited to terms of **6 characters or more** (`SUBSTRING_MIN_LEN`). That
   threshold is the whole false-positive control. The short entries of these lists are `ass`, `con`,
   `cul`, `dick`, `rape`, `bite`, `scat`, and they live inside Cassandra, Constance, Deacon, Dickson,
   Draper, Arbiter and Scatena. The cost is a 4-letter insult glued between letters with no case
   change: `xxfuckxx` gets through. Refusing somebody their own name is the worse of the two failures,
   and it is the one nobody reports, they just leave.
3. `NICKNAME_ALLOW_SEED` covers the collisions rule 2 still leaves: Scunthorpe, Penistone, Cockburn,
   Niger, Nigeria. Whole nickname only, so `scunthorpe` is a name and `scunthorpefuck` is not. It is
   the only hand-written list in the module, and it is an *allow* list on purpose: a missing entry is
   a refusal somebody complains about, never a slur that lands on a stream.

The squeezed form is matched against the terms **as written**, never against a squeezed list.
Squeezing the list turns `nigger` into `niger`, and the country is a place people are from.

**None of this is stored.** A nickname lives in the `Room` for as long as the match does. The one
thing that writes it anywhere is the deploy snapshot (`snapshot.rs`), which holds only matches in
flight, is deleted as it is read, and is dropped whole past the snapshot's maximum age. There is no
scoreboard that outlives a room, no history, no profile, so there is no stored entry to delete — and
adding one would be the legal change described in `docs/notes/legal.md`, not a feature.

## A refusal that proves a drift carries the correction
`Table::refuse_action(cx, c, err)` (`broadcast.rs`) is the single exit for a rejected gameplay
message: the refusal, `note_rejection`, and, when `err.kind() == ErrorKind::StaleState`, a
personalised `game_state` to that one client. Every gameplay handler that can see a drift goes through
it (`handle_play_card`, `handle_draw_card`, `handle_pass_turn`, `handle_counter_draw`,
`handle_interrupt_play`).

- **Without it a drifted client has no way back.** Its own copy says the card is legal, so it keeps
  offering the action, the player keeps taking it, and every attempt is refused: the loop only ends
  when some later broadcast happens to carry the field that was wrong. The report that produced this
  was an off-colour Swap opening its target prompt again and again, answering "illegal card play"
  after the player had chosen a seat. Server authority means the server ends that argument, not that
  it repeats "no".
- `ErrorKind::StaleState` (`server/crates/loco-game/src/error.rs`) names the refusals that can only
  mean the client acted on a board the server no longer has: `NotYourTurn`, `IllegalPlay`,
  `CardNotInHand`, `MustAnswerPenalty`, and the batch's `NotEnoughCopies` (`hand has N copies`). The
  class is a property of the variant, not of its text: the wire string is what `serverErrors.ts`
  matches on and what the player reads, and it is untouched.
- **A lost race is deliberately not one of them.** There the client's board was right and it was
  simply beaten, so a snapshot would put the most expensive message this server sends on the wire at
  the busiest moment of the busiest table. `tests/resync.rs` pins both halves:
  `play_card_illegal_play_resyncs_the_client`, and `interrupt_lost_race_does_not_resync`, where an
  interject whose card is no longer the top one is followed by nothing at all. That second case was
  once written as a closed window, which stopped being reachable from a fixture the day the deal
  started opening one — the mismatch is the better example anyway, since it is what losing an
  interrupt race actually looks like.
- Logged as `state resync conn=… player=… reason=…` (the table's span adds `code=`). Sustained growth
  on one connection is a client bug worth reading; the metric for a tampered one stays
  `suspected_cheats`.

## 1v1 matchmaking
`matchmaking.rs`. One FIFO queue (`HubCore::queue`), a pairing rule, and a set of timings that differ
from an ordinary room's on purpose (`config::MatchmakingTimings`).

- **The queue's size never reaches a client.** `matchmaking_queued` is an empty acknowledgement: no
  count, no position, no estimate, on any message. The number exists on `/metrics`
  (`matchmaking_queue`), which no compose file publishes. The reasoning is not privacy, it is
  feedback: a screen that could render "1 player searching" would render it during precisely the
  window when the queue is trying to fill, and it reads as an instruction to leave. Every player who
  leaves on that sentence is the opponent the next one was about to get. The client times its own
  wait and stages its copy off elapsed seconds instead (`Searching.svelte`).
- **`players_online` is the one number this server does publish, and it is a different number.**
  `online.rs`: every socket the process is holding, seated or not, sent on registration and then
  only when the count moves, and only to sockets that are not at a table. The two are not in tension
  — one is "are the lights on", which is worth answering on a home screen, the other is "how long
  until I am paired", which no honest number answers and which a queue size gets read as. The floor
  that keeps the first from turning into the second is the client's (`game/playersOnline.ts`,
  two players), because it is a rule about what a screen draws rather than about what is true.
  - **The watermark is per socket, not per hub** (`Client::online_sent`). A hub-wide "last sent" would
    skip a player who has just left a table — they were seated while the count moved, so the number
    they hold is stale and the next tick would find nothing to announce. On a quiet server, where the
    count moves rarely, "the next time it moves" is never.
  - **A tick that changes nothing sends nothing.** The alternative is one small message per seatless
    socket every period, forever, on a server where nobody is doing anything. The tick
    (`players_online_period`, 5s) is an interval inside the hub's own `select!`, which is what makes
    reading `HubCore::clients` from it safe.
  - It cost the test harness's `read_msg` a skip (`testkit.rs`): the message is the answer to nothing
    and can land in front of any reply a test is waiting for. `tests/online.rs` reads it with
    `read_raw`.
- **Nobody presses start.** `pair_match` builds the table, seats both players, sends `match_found`
  with `starts_in_ms` and a fresh token each (`announce_match_found`), arms the reveal
  (`schedule_matchmaking_start`, `reveal_delay`, 2.5s) and only then opens the table.
  `handle_matchmaking_start` checks it is still a matchmade lobby and calls `start_match`, which
  shares `deal_match` with the host's `start_game`. If one of the pair vanished during the reveal,
  `requeue_survivor` tears the room down and puts the other back in the queue rather than leaving
  them in a two-seat room that can never start.
- **That deal is armed twice** (`REVEAL` and `REVEAL_BACKSTOP`, `reveal_backstop` = 3s after the
  reveal). On the Go server it was the only job that needed it: every other dropped job was lossy (a
  turn timer lost is one free turn, a cleanup lost is one room until the next restart), and this one
  was unbounded. A lost deal left the table a matchmade lobby for the rest of the process's life,
  which means it published `InFlight` for the rest of the process's life — so the drain could never
  complete and **every** deploy from that moment on burned its whole `LOCO_DRAIN_TIMEOUT` waiting on
  a table nobody was playing at, while the pair sat on a versus screen that would never deal. Here the
  reveal is a deadline in the table's own state and cannot be dropped by a full box, which was the
  failure the backstop was built for; it is kept because it costs one key and its second fire is a
  no-op by construction (the table is no longer a lobby). A rematch re-arms both keys, so neither can
  belong to an earlier pairing. `matchmaking_the_reveal_backstop_does_not_deal_twice`.
- **A seat is held through the versus reveal, and reclaimed the same way as a match seat.** A
  matchmade table is a lobby for the two and a half seconds between the pairing and the deal, and
  the client keeps its seat across a reload there (`matchfound` persists as `game`, and the rejoin
  reclaims with the token). The disconnect once took the lobby branch: the seat left the roster with
  every column it had in the recap, and the reclaim came back as a fresh join under a fresh seat —
  after a rematch the recap had no columns at all, which serialised as `null` and was refused by the
  client's schema. Held now, like a match seat (`disconnect_at_table`): `join_at_table` reclaims at a
  matchmade lobby (a matchmade table is never joinable by code, so it takes the reclaim branch at
  every status), `handle_matchmaking_start` deals with a held seat counted present, and the seat's
  own 15s clock, armed when it dropped, forfeits the match if nobody reclaims it; nobody connected
  at all is a pairing with nobody to deal to and is torn down as before. A seat held through the
  reveal and never reclaimed requeues the survivor from the expiry, which is reachable only if the
  deal itself was refused. `match_history_dto` never serialises a column set as `null`.
  `matchmaking_reload_during_the_reveal_keeps_the_seat` and
  `matchmaking_reload_during_rematch_reveal_keeps_the_recap` (`tests/audit_fixes.rs`) pin it.
- **A matchmade room has no host**, and neither has a solo game, so `handle_add_bot`,
  `handle_start_game`, `handle_set_match_format`, `handle_set_max_players`,
  `handle_set_streamer_mode`, `handle_kick_player` and `handle_transfer_host` all begin with
  `Table::refuse_without_host` (`Table::hostless`, `not available in this game`). The format is fixed
  (`MATCHMAKING_FORMAT`, BO1: a queue is entered by somebody who wants to play *now*, and a single
  round is the shortest complete thing the game has, as well as the commitment two strangers are
  least likely to abandon halfway) and the size is two. `handle_rematch` is deliberately not among
  them: it is an agreement everywhere, and the only thing the mode changes is what the agreement
  deals.
- **Two strangers may have picked the same nickname**, and `Room::join` refuses a duplicate. In a
  private lobby that refusal is right. Here it would fail a pairing neither player did anything wrong
  in, so `unique_nickname` disambiguates the second one (`Alex (2)`), trimming the base to 16
  characters first so a seat label cannot outgrow what it is built to hold.
- The queue is left on **disconnect** as well as on cancel (`HubCore::handle_disconnect` calls
  `dequeue` before anything else): a socket that has gone away must not be paired with somebody who
  is still there.

## The 1v1 against the server (`play_bot`)

The queue's *experience* with the queue taken out: a nickname, one press, a hand. It exists because
the searching screen's own copy admits, at twenty seconds, that the wait may not end — and the only
thing it could offer next was "open a table", which is three screens and a code nobody is going to
share. A first-time visitor spends about ten seconds before closing the tab, so the alternative had
to be a press.

- **It is not "open a table and add a bot".** That path exists and is unchanged; this one
  (`solo.rs`, `HubCore::open_solo_table`) produces no code, no waiting room, no host controls and no
  configuration, because every one of those is a decision the mode's whole promise is that you do not
  have to make. `SOLO_FORMAT` is BO1.
- **The table is hostless, like a matchmade one** (`Table::solo` → `hostless` →
  `refuse_without_host`). What it does **not** borrow is the matchmade *timing*: the 15s reconnect
  hold and the two-timeout AFK threshold exist because a stranger will not wait for you, and the seat
  opposite this player is the server. Reconnect, drain and the snapshot treat it as any other table
  in progress, and `solo` travels in `RoomSnapshot` so a restored match does not come back offering
  host controls over a game that has none.
- **The deal carries the identity.** Every other way into a match announces the seat first
  (`room_created`, `room_joined`, `match_found`); this one deliberately has no screen before the
  board, so `game_started` carries `room_code`, `player_id` and `session_token`
  (`Table::deal_solo_match`, the table's first job: it arms the gate, which only a running table can
  sleep on). Without them a reload could not reclaim the seat, and with a separate message in front
  of it the client would flash a screen it has no state for. The client tells the two paths apart by
  exactly that: a `game_started` carrying a room code is a solo deal.
- **`rematch` is refused here, and only here** (`not available in this game`). The ask has no
  addressee: the quorum would be one, so the "agreement" would be a decision wearing an agreement's
  clothes, and the deal it triggered would drop the player into a lobby this mode has no host to
  start. Another game is another `play_bot`, which is what the game-over screen sends — and which
  releases the finished seat first (`play_bot_release`), exactly as `find_match` does.
- **It touches nothing the queue owns.** No `HubCore::queue`, no `matchmaking_queue`, no
  `matches_matchmade`. That is not tidiness: the queue is the one server-global the E2E suite has to
  serialise around (`helpers/matchmakingQueue.ts`), and a second entry point quietly joining it would
  make every parallel run flaky in a way nothing points at. `/metrics` gains `matches_solo` instead,
  beside the queue's own number, because the two answer one operator question together: whether an
  empty-feeling queue is sending people to the bot or sending them away.

## Leaving a match in progress

`HubCore::handle_leave_room` / `Table::leave_at_table`, `Table::can_walk_out` + `Room::retire_seat`.
**There is no room and no moment in which leaving is refused.** What the table decides is what the
departure *does*, never whether the player may go.

**The problem it fixes is not the leaver's.** Somebody who genuinely has to go used to have exactly
one exit: stop pressing things and let the turn clock auto-draw and auto-pass for them until the AFK
threshold. That is four timeouts, roughly two rounds, played out at thirty seconds a turn by
everybody else, watching an empty chair take its turn. One player leaving is cheaper than that for
the whole table — and at two or three seats, where the refusal used to stand hardest, it is cheaper
still: the alternative there was not a spoiled round but a board nobody could get off.

The four answers, in the order `leave_at_table` asks them:

- **A matchmade match forfeits.** The honest answer between two strangers, unchanged.
- **A solo game and an abandoned match close the table.** One case in the code, because it is one
  case in fact: nothing at that table will act again once this socket goes. No forfeit either —
  `remaining_seat` would hand the match to a bot or to a player who is not there.
- **Above the floor the round carries on** (`can_walk_out`, then the private `retire_seat`).
  `playable_seats` counts what can act: a bot, or a human who is here or inside their reconnect
  window, and not already retired. A seat whose hold has run out is not one.
- **At or below it the match ends and goes to the seat that stayed**, announced as a forfeit with the
  scoreboard untouched. A table of two is a 1v1 whichever door it was opened through, and the
  alternative is leaving the survivor in front of a board that will never move again — which is the
  state `abandoned_by` exists to end, arrived at deliberately instead of by an expiry.

- **`WALK_OUT_FLOOR` is 2**: what a match needs to keep being a match, not a politeness threshold. It
  was 3 when leaving was a privilege a big table could afford; it is now the line between the two
  endings above. `can_walk_out` asks whether the seats left *after* this one would still be at it.
- **Evaluated once, at the moment of the ask.** If a later disconnect takes the table under the floor
  while the round runs, nothing is re-decided: what happened was a departure, and reconsidering it
  afterwards would mean a player who left is somehow still at the table.
- **The seat is retired, not removed.** Hands, scores, rounds won and the turn order are all indexed
  by it, and a running match cannot re-base any of them. So the seat stays, `Table::mark_gone`
  records the absence exactly as an expiry does (`Occupant::Gone`), and the domain takes it out of the
  *round*: the hand goes back into the deck (shuffled — those cards were hidden, and leaving them in a
  hand nobody holds would shrink the deck for everybody else every time somebody left), the turn
  steps over it, a Global Switch leaves it out, the biggest-loser rule never picks it to open a round,
  a Swap cannot name it, and it is dealt nothing from then on.
- **A pending draw stack aimed at the leaver dies with the seat.** Passing it on would be a penalty
  the next player never earned; holding it would be a debt nobody can pay.
- **The scoreboard is left exactly as it stood.** This is a departure, not a forfeit: the rounds they
  won stay won, the points stay where they are, and the act of leaving neither wins nor loses the
  match. It follows that a seat that had already banked enough rounds can still take the match on
  the tiebreak chain, which is the honest reading of "they neither win nor lose by this".
- **The token is spent and the seat cannot be reclaimed** (`mark_gone(seat, true)` forgets it). The
  hand is in the deck; there is nothing to come back to.
- **The control is a chip in the board's top-right chrome row, and never on the action bar.** That
  bar is a fixed three-column grid so a reaction can be aimed at it, and it must not grow a fourth
  control (see `visual.md`). The question takes the chip's place, out of the flow, so nothing on the
  board moves for it — the safe answer first and coloured, Escape through the one hook, exactly as
  the waiting room's own confirmation works. It is drawn at every table now, and what changes with
  the table is the line under the question: what leaving costs the people still holding cards.
- **The seats that stay are told, by name.** `player_left` already carried the nickname and the seat;
  the client turns it into a pill on the board. A departure moves the turn and shortens the order,
  and the roster alone cannot explain that — held and gone are both `connected: false`.

## The host's stream is the table's business
`Table::handle_set_streamer_mode`, answering `set_streamer_mode`, and the one place a *presentation*
preference is allowed through this protocol. Everything else a player picks — the colour shapes,
reduced motion, the language — is decided and kept on their own machine, and the reason this one
cannot be is arithmetic: a table code is a single string shared by everybody who can see it. A host
with it on screen while capturing is exposed by the friend who joined and left the waiting room up on
a second monitor, and by the seat that reads the code out loud. Blurring only the host's copy
protects the one screen that was already being careful.

- **Host only, hostless never.** It is a table setting, and a table's settings are seat 0's, like the
  format and the seat count (`only the host can change streamer mode`). A matchmade or solo table has
  no host *and* no code on screen, so it is refused there by `refuse_without_host` rather than special
  cased.
- **Every status, deliberately.** The format and the seat count are lobby controls because they
  change what is being dealt. This one changes nothing about the match, and the thing being captured
  *is* the match — refusing it after the deal would mean a host who starts streaming mid-evening
  cannot cover the code until the table is over. That is also why it does not ride
  `lobby_config_changed`.
- **A state, not a toggle.** The switch it comes from can be flipped on any screen, and a toggle sent
  from a client whose picture of the table is one message behind arrives meaning the opposite of what
  was pressed.
- **A repeat is answered by nobody.** Not an error — a client that sent it is correct — but the
  switch sits under a thumb in a panel, and a broadcast that changes nothing is a send to every seat
  for free. Same rule as `rematch` being idempotent.
- **It lives on the table and it outlives the match** (`Table::streamer_mode`, untouched by
  `reset_for_next_match`). The stream does not end because a match did. It rides the drain snapshot
  for the same reason: a host who came back from a deploy to a table whose code had gone readable
  again would find that out from their own capture.
- **Three places carry the answer**: `streamer_mode_changed` to the whole table, `room_joined` for
  somebody who types the code an hour into a stream, and every `GameStateDTO` for a tab that reloads
  mid-match. A client that learns it from only the first is a client that is blurred only if it
  happened to be watching. `tests/streamermode.rs` pins each one.

## Freeing a seat somebody else is in
`Table::handle_kick_player`. Every other host control describes the table (the format, the size, when
to deal); this one acts on a person, so it is the strictest thing in the lobby.

- **Host only, lobby only, and never seat 0.** The host's own seat is given up with `leave_room`,
  which asks first; a kick that could take seat 0 would hand the table to whoever was sitting in seat
  1 through a button that says nothing of the sort (a target of 0 is `invalid player index`). Once the
  cards are out a seat belongs to a match rather than to a roster, and the only thing that ends one
  early is a forfeit — so the refusal there is `can only remove players in the lobby`, not a special
  case of it.
- **The table sees a departure and the player sees a reason.** `Table::release_seat` does the work,
  which is the same bookkeeping `leave_room` and a lobby disconnect do (`reindex_lobby_disconnect`:
  the roster plus `drop_client`, which removes the seat and re-seats every client above it), so the
  three cannot drift apart. The removed client is off the table by then and gets `kicked` on its own
  socket instead of the `player_left` about itself: a table vanishing with no explanation reads as a
  bug, and the client puts the line under the lobby form.
- **A bot is a seat like any other.** There is no socket behind it, so it goes through
  `remove_unmanned_seat` rather than `release_seat`, and that function re-bases exactly what the human
  path re-bases. It is the only way to take a bot's seat back; there is no `remove_bot`.
- **It is deliberately not a ban.** The table code is already in the removed player's hands, there is
  no account to refuse them by, and the game holds no identity to build one on — an address would be
  the only handle left, and never storing one is the whole privacy position. So a ban would be
  theatre, and the honest consequence is that a mistaken press costs nothing: the player sits back
  down.
- **It asks first anyway** (client-side, in the row's own menu). Not because it is expensive to undo
  — it is not — but because it is one of two controls sharing one ⋯ on a roster row, the other one
  hands the table over, and a two-item menu where one item fires on the press and the other does not
  is a menu you have to read twice. Both ask. See
  [`docs/notes/client.md`](client.md) for the panel.

## Handing the table over
`Table::handle_transfer_host`, answering `transfer_host`. The host is seat 0 and nothing else, so this
is a swap of two seats and not a flag: the moment it lands, every `player_id() != 0` check answers the
other player and the roster badge follows. A second definition of who owns the table is a second
thing to keep in step with the first, which is the bug `keep_host_human` below exists to clean up
after.

- **Why it exists.** A lobby's re-index already moves the table when the host drops, which is right,
  but it is the *only* way it moves: a host who is not going to be there for the match, or who opened
  the table for somebody else, had nothing to press. The passation was a departure.
- **`Room::swap_lobby_players` + `Table::swap_seats`, mirrored seat for seat.** Whatever the roster
  does, the seats do, and because a `Seat` carries its token, **the token travels with the player**:
  it is the proof that seat is theirs. Left behind, it would hand a reloading player the seat that is
  now somebody else's — and on this table that is the host's.
  `transfer_host_the_token_follows_the_player`.
- **A swap, not a move to the front.** A move re-bases every seat between the two and a swap moves
  exactly two. Fewer seats moving is fewer things to get wrong, even now that a seat moves whole.
- **Lobby only, never to a bot, never to seat 0, never in a matchmade room.** The lobby rule is the
  kick's — once the cards are out a seat belongs to a match, and swapping two would swap two hands,
  which is why `swap_lobby_players` refuses a finished room the way `remove_lobby_player` allows one
  (scores, rounds won and the lost-hand totals are indexed by seat). The bot rule is
  `keep_host_human`'s (`a bot cannot host the table`): a table whose host cannot press start can never
  deal. Seat 0 is the sender's own.
- **`host_changed` is per-recipient**, like `rematch_started` and for the same reason: two seats moved,
  so half the room's own `player_id` changed with them. A broadcast would leave exactly the two
  players who moved reading somebody else's row as their own. Everybody gets it, not only the pair —
  the badge moved on their screen too.
- **No confirmation on the server and no refusal for the recipient.** It is not a demotion anybody
  can decline, and the press costs nothing that cannot be pressed back. The client asks first; that
  is a UI decision about a two-item menu, not a protocol one.

## The three things a player can say

`emotes.rs`, `loco_protocol::Emote` (`ALL_EMOTES`). After a close 1v1 against a stranger there was
no way to say anything at all — not "good game", not anything. Three fixed emotes is the smallest thing
that fixes that, and the smallest is the point.

- **No free text, ever.** Free text is a moderation surface, and this game has no way to keep the
  promise that comes with one: "we collect nothing" is the compliance strategy rather than an
  accident (`notes/legal.md`). Three is enough to react to a match — one gracious, one about the
  match itself, one needling — and too few to be abusive, which is the only property that matters
  here.
- **The set is closed and it is the server's.** An identifier travels, not a string, and one this
  server does not know never decodes: the read pump refuses it with `unknown emote` and counts it
  (`note_suspect`) rather than relaying it. A client cannot invent a fourth. The words are the
  client's (`t.emotes`), in the player's own language.
- **Nothing is kept, anywhere.** Not in the event log, not on the `Room`, not in the drain snapshot,
  and not on the `Table` either: `emotes.rs` holds no state at all. The client keeps one line per
  seat — the last thing that seat said, replaced rather than stacked — and drops the lot with the
  match. **"With the match" means every door onto that screen and every door out of it**, which is
  four in the store: `applyMatchEnd` (a forfeit), `dismissRoundSummary`'s buffered end (the ordinary
  one, and the one this went missing on), `applyRematch` and `applyMatchFound` /
  `applySoloStarted` for the next match. Miss one and the words survive the thing they were about:
  a table that said "good game" at the end of the first match read it again over the second one's
  scoreboard, congratulating a result nobody had seen yet.
- **The game-over screen and nowhere else** (`emotes are only for the end of a match`). Anywhere
  earlier it would be something to do *to* somebody mid-round, which is what a reaction game least
  needs.
- **A seat changes its mind as often as it likes, and that is the whole point.** The Go server once
  had a 2s per-seat cooldown, on the theory that ten a second would be a wall of pills over a
  scoreboard somebody is reading. It would not have been: the client *replaces* a seat's line rather
  than stacking it, so three presses in a second are one pill changing its word, and the card's
  height is the table's size no matter what anybody does. What the cap actually cost was the gesture
  the feature exists for — press "gg", think better of it, press "close one" — which arrived as a
  refusal. The traffic is bounded where every other message on this socket is bounded, by the
  per-client token bucket (10/s, burst 20); a second, narrower ceiling said nothing the first one did
  not.
- **The refusals that remain answer their sender and nobody else.** Wrong screen, unknown identifier:
  both broadcast nothing, or a refused emote would be cheaper to send than an accepted one — the rule
  every rate-limited message in this server is written to.
- **Never to or from a bot.** A seat the server plays has no opinion about the match and no socket to
  receive one. The guard is written down even though it is unreachable: the rule is about the seat,
  not about the transport. **The client draws the consequence rather than leaving it implicit**
  (`GameOver.svelte`): a bot gets no line in the feed — its line could never be written, and an
  empty slot that can never fill is height the card pays for nothing — and a table whose every other
  seat is one, a solo game against the server first of all, draws no emote block at all. It *goes*
  rather than going dead: a dead control on that card means an offer that may still come back, and
  nothing is coming back to answer a "gg" at a table of bots.

## A rematch by agreement
`Table::handle_rematch` (`rematch.rs`). It was the host's decision and it is nobody's now. The host's
standing is over the things that describe a table before it deals: the format, the size, when to
start. Whether four people want another twenty minutes is not one of them, and between two strangers
out of the queue nobody ever had that standing to begin with. So the ask is the same everywhere and
the host's only remaining privilege on this screen is not having one.

- Any seat sends `rematch` (setting its `Seat::wants_rematch`), every ask is broadcast as
  `rematch_offered`, and the next match is dealt only once `rematch_quorum` asks are in. **Every ask
  is public on purpose**: an ask nobody can see is an ask nobody answers, and the screen has to be
  able to say "they are waiting on you".
- **The quorum is two** (`REMATCH_QUORUM`): one seat offers, another accepts, and that is two people
  who want to keep playing. It used to be every connected human, which handed a table of five to
  whoever was slowest to look at their screen — four ready, one silent, and the button read "waiting
  on the table" until they answered or their socket dropped. Two is what a match needs in order to be
  a match (`WALK_OUT_FLOOR` says the same thing about one already running), so two is what it takes
  to deal one. Below two connected the quorum is whoever is there (`rematch_quorum` clamps the
  connected count to 1..2), which is what makes a solo-plus-bots table reopen on one press; bots are
  not asked, and a seat inside its reconnect window is not waited for either — it left a room that is
  already over.
- **Nobody is dropped by that.** `open_rematched_lobby` reopens the room with everyone still sitting
  at it, so a player who had not answered lands in the waiting room rather than out of the game, and
  the deal is still the host's press. The quorum decides when the room reopens, never who is in it.
- **The reopened table is hosted by somebody who asked for it** (`promote_rematch_host`, off
  `rematch_askers` read *before* the prune and the reset re-base the seats). Two asks can easily
  reopen a lobby seat 0 never asked for: the host said nothing, or they left mid-match and the prune
  took their seat, or a bot slid into 0 behind them. Seat 0 owns the format, the size and the press
  that starts the match, so leaving it there would be a room full of players who agreed to play again
  waiting on the one who did not — the exact wait the quorum exists to end. The new host is the
  **earliest-seated asker** (the earliest arrival, not whoever pressed first), moved with
  `swap_lobby_players` + `swap_seats` so the tokens travel with the players, exactly as
  `transfer_host` does. `keep_host_human` follows it, for the table where nobody who asked is still
  there. Nothing moves in the ordinary case, where the host asked.
- **`rematch_offered` carries the whole state, not the increment** (`broadcast_rematch_offers`):
  `rematch_offers` plus `rematch_needed`. A departure re-bases seats, so an increment would leave
  every client holding a stale seat number and a count that never completes. The list is nullable on
  the wire because *empty* is a real answer here.
- **A departure is an answer.** `release_rematch_offer` runs after the seat has left `Table::seats`,
  so the asks above it have already moved down with their seats and there is nothing to re-base by
  hand (Go shifted a separate set of seat numbers here, exactly as it shifted the bots and the
  tokens). It republishes, and deals when what is left of the table has already asked. It is called
  from `release_seat` and from the finished-table branches of `disconnect_at_table` and
  `handle_expire_reconnect`; a seat that is merely held at a finished table goes through
  `retire_rematch_offer`, which clears its ask without removing anybody.
- The deal has two shapes (`deal_agreed_rematch`). `start_rematched_match` goes through the
  **pairing** path, not the lobby one: another `match_found`, another reveal, and every screen, timer
  and gate downstream is the one both clients already went through. A matchmade rematch is a new
  match between the same two, not a room returning to a lobby this mode does not have.
  `open_rematched_lobby` is the ordinary table: prune the absent (`prune_absent_players`),
  `Room::reset_for_rematch`, promote a host who asked, `rematch_started` per recipient — which is per
  recipient partly for that promotion, since it moves two seats. Both call `reset_for_next_match`,
  which clears the deadlines and the loading gate, or the finished match's gate would keep the next
  one shut forever.
- Refused in a **matchmade** room once the seat opposite is gone (`your opponent has left the
  table`): there is no lobby to wait in and nobody who can arrive. The client requeues that player
  rather than leaving them on a button that cannot complete. An ordinary table has no such floor,
  because whoever is left can reopen the room and wait in it. Refused while draining too.
- **No timer on an ask.** One that is never answered costs the asker nothing, and leaving retires it.
  A countdown would only add a deadline to a decision nobody is blocked on.

## Nobody waits for somebody who is not there
The reason the mode has its own timings at all. In an ordinary room the 60s hold and the 4-timeout
AFK threshold are right: those are people who came in together and will wait for each other. Two
strangers will not, and the player who is still at the table did nothing wrong.

- `Table::reconnect_hold` and `Table::afk_threshold` are the two switches: **15s** and **2** in a
  matchmade room (`MatchmakingTimings`), the shipped values everywhere else. 15s covers the
  disconnect people actually have (a wifi hiccup, a tab reload, both back in two or three seconds)
  and ends the rest quickly.
- Either expiry calls `Table::forfeit_match`, which is `Room::forfeit_to` plus the broadcast:
  `match_end { forfeit: true, player_index: <the seat that left> }`. **It disarms every deadline the
  match armed** — the turn clock, the gate, the reveal, every bot move and reaction — and keeps the
  two that belong to the table: `room_cleanup`, and the `reconnect_expiry` of a seat still away,
  which settles that seat after the match. (Every fire still checks the status first, as belt and
  braces.) `internal_tests/lifecycle.rs::a_forfeit_disarms_what_the_match_armed`.
- **The scoreboard is untouched.** A forfeit is not a win on points, and dealing the abandoned round
  out to the survivor would write a row into the score table for a round nobody played to the end.
  What the player gets instead is a game-over screen that says what happened.
- **The AFK path forfeits rather than kicks.** Closing the socket would only start a second wait (the
  reconnect hold) for somebody who has already proved they are not there, and the opponent would have
  sat through both. The away player is sent `afk_forfeit` first so their own screen can explain it.
- `leave_room` is the deliberate version: immediate, no wait, and **refused nowhere**. In a match of
  two it does exactly what the two expiries above do — the match ends and goes to the seat that
  stayed — and at a bigger table the round carries on without the seat. The full set of answers is in
  *Leaving a match in progress* above. Before the deal it is not a forfeit at all: the waiting room
  has a quit button for host and guest alike, `release_seat` frees the seat on the spot and the rest
  of the table gets `player_left`. That is the whole point of sending it rather than closing the tab,
  which would hold the slot instead.
- **A hold running out at an ordinary table is settled where it runs out** (`settle_expired_seat`,
  called by `handle_expire_reconnect` after the `player_left` that names the seat). It is
  `leave_at_table`'s answer given to the same departure: above `WALK_OUT_FLOOR` the seat is retired
  (`retire_absent_seat`, the domain's `retire_seat` plus the bookkeeping a walk-out does, minus the
  socket and minus a second `player_left`), at or below it the match is forfeited to the seat that
  stayed, and a table with no socket and no hold left is left to `close_abandoned_match`. On the Go
  server it was once settled nowhere: the seat kept its cards and its place in the turn order, the
  clock auto-drew and auto-passed for it every 30s, and the AFK threshold never reached it because
  the kick acts on a socket and there was none. At a table of four that was one dead half-minute per
  lap for three people still playing, for every round left in the match. The client already handled
  both outcomes: a `player_left` naming a seat followed by a personalised `game_state`, exactly what a
  walk-out sends, or a `match_end` with `forfeit`. `remaining_seat` prefers a connected human, then a
  held one, and never a retired seat — a forfeit awarded to a chair is not a forfeit.
  `tests/expiry_settle.rs`.
- **A table nobody can come back to is closed rather than forfeited.** `Table::abandoned_by` is the
  question: every other seat empty or `Gone` — a human with no socket **and no hold left**, no bot.
  Away is not gone — while the hold is running the seat is somebody who may return, so leaving in
  front of it is the ordinary 1v1 ending and the match is theirs to come back to. Once it is gone, no
  forfeit is issued at all, because `remaining_seat` would award the match to a bot: the seat is swept
  and the table is closed. With the settle above, the state this question describes is reached almost
  only by a solo game or a snapshot restore nobody came back from; it is kept because it is the correct
  answer whenever it is asked. `close_abandoned_match` closes a *finished* ordinary table on the same
  terms, since `join_at_table` accepts nothing there but a token reclaim and a reclaim needs a hold.
- `forfeit_deadline` rides `player_disconnected` in a matchmade room only
  (`Table::forfeit_deadline_ms`). Without a number on screen, 15s of a frozen board is
  indistinguishable from a broken game, which is the difference between waiting and reloading.

## A seat that is empty has to read as empty
Two ways a seat has nobody in it, and the roster used to answer only the first.

**A hold ends.** On the Go server `connected` was derived from the hold map alone, and the expiry
deleted that entry one line before it broadcast the departure. So the `player_left` announcing a
player was gone carried a roster saying that player was present — and in an ordinary room, where
nothing forfeits, it stayed that way for the rest of the match: a seat pod and a score table showing
"here" while the turn clock auto-passed for them every 30s. It was masked in matchmade rooms only
because those forfeit on the same event. Here the expiry turns the seat into `Occupant::Gone`
(`mark_gone`) before it builds the roster, and `player_list` reads `connected` as neither held nor
gone (`Table::has_left`). The seat itself cannot go: hands, scores and turn order are indexed by it
until the round ends. `reset_for_next_match` turns every held or gone seat `Vacant`, for the reason
every other per-match value is cleared there.

**A finished table holds its seats too.** The match is over; the rematch is not. A socket that
dropped on the game-over screen used to be released outright, so a wifi hiccup between the last card
and the rematch button was answered `not in a room` by the only control that screen has. Now
`disconnect_at_table` holds it for the ordinary reconnect window, `retire_rematch_offer` takes that
seat's ask out of the quorum without re-basing anybody (it is being held, not removed, so no index
moves), and `join_at_table` accepts the token reclaim at any table that is not a lobby. The reclaim
sends `player_reconnected` with **no `state`** — a finished room has none, and a snapshot built from
an absent one would hand the client an empty board and put it back at the table — followed by the
whole `rematch_offered` state. When the hold does expire, the seat is removed for real
(`remove_lobby_player` + `drop_seat`): a phantom at a finished table is worse than a stale flag,
because the next match would deal a hand to nobody.

**Two holds at one finished table is where the seat-keyed state has to move together.** On the Go
server the removal re-based the members, the bots, the tokens, the departed set and the recap, and
not the hold map or the AFK counters. So Bob (seat 1) and Carol (seat 2) both dropping on the
game-over screen, Bob's hold running out first, left Carol at seat 1 with her hold still keyed 2: the
roster read seat 1 as connected, the reclaim found her hold at 2 and checked her token against seat
2's — gone with Bob's — so her reclaim was refused with `game already in progress`, and her expiry
either removed whoever had slid into seat 2 or nobody, leaving a phantom for the next deal. Go fixed
it by putting every seat-keyed map on one list (`shiftSeatKeys`). **Here there is no list**: the hold
is the seat's `Occupant::Held { since }`, so it moves when the seat moves. The timer is the other half:
an expiry is armed with a seat number, so `handle_expire_reconnect` matches on the instant the hold
began instead (`held_seat_at`, the seat number kept as the hint and the tie-break for the snapshot
restore, which stamps every seat with one instant and never drops one mid-match), and each hold's
deadline takes a unique key so two holds never replace each other.
`game_over_disconnect_two_holds_rebase_together` (`tests/expiry_settle.rs`) runs both holds.

**Matchmade tables are deliberately excluded from that hold.** Two strangers are done with each
other, the survivor's client requeues the moment the roster says it is alone, and holding a seat
would make it wait out the hold first for a rematch `handle_rematch` refuses anyway.

## AFK auto-kick
- `Timings::afk_kick_threshold` (default 4) consecutive turn-timeouts without voluntary action → kick
  (~2 rounds in 2-player), counted on `Seat::afk`. A matchmade room uses
  `MatchmakingTimings::afk_threshold` (2) and forfeits instead of kicking; see above.
- Bots exempt. An **accepted** voluntary gameplay action (play_card, draw_card, pass_turn,
  declare_uno, catch_uno, counter_draw, interrupt_play) calls `Table::reset_afk`. A refused one does
  not: see "A refused message must never be cheaper than an accepted one" above, which is the whole
  reason the reset moved from before the handler to after it.
- Kick: send `{type:"error", error:"afk_kicked"}`, then `Client::force_close`. Standard reconnect
  window applies.
- **A kick answers the socket, never the turn.** `kick_if_afk` returns true only for the matchmade
  forfeit, which ends the match and with it the turn; an ordinary kick closes the socket and returns
  false, and `handle_turn_timeout` goes on to draw and pass for the seat exactly as it does for any
  empty chair. On the Go server it once returned early, and nothing re-armed anything: the turn stayed
  on the kicked player, the turn stamp still named the timer that had just fired, and a table of three
  humans was refused `not your turn` for the rest of the match with no way out but the tab.
  `afk_kick_still_moves_the_turn` (`tests/audit_fixes.rs`) watches the turn move from a second seat.
- **A reclaim clears the counter** (`handle_reconnect`): the timeouts that stacked up belonged to a
  connection that died, and a player back at the table was one clock from a forfeit on their first
  turn back.
- **The auto-draw re-arms before it broadcasts** (`auto_draw_on_timeout`): `send_hand_growth` reads
  the deadline off the table, and the one on it was the clock that had just run out, so every client
  drained its bar to nothing for the frames before `turn_changed`.
- Tests raise the threshold by passing a `HubConfig` whose `Timings` say so; nothing is restored after,
  because nothing global was changed.

## Bots

- **A refused bot move gives the turn up, never the table** (`Table::bot_recover`). Bots are exempt
  from the turn clock, so a play or counter the domain refused used to log, return and arm nothing:
  not a lost turn but a dead table, with the turn on a seat nothing could move. It now draws if it has
  not (a draw never fails, and the card may be the answer) and passes otherwise; the pass is the
  floor, so a second refusal after the draw cannot loop. `src/internal_tests/botrecover_internal.rs`.
- **After a draw the bot asks `bot_think`, not "is it playable"** (`bot_draw`). The two disagree on a
  legal Swap the bot declines (`bot_swap_pays`), and "yes, playable" there scheduled a move that asked
  to draw again, was refused (`AlreadyDrawn`), fell through to the scheduler and came back every two
  seconds for the rest of the match.
- Host adds via `add_bot`. Named by `next_bot_name(room)` — lowest free `Bot1`, `Bot2`, … (scans, does
  not count seats).
- **A bot never sits in seat 0** (`Table::keep_host_human`). The host is seat 0 and nothing else: five
  controls are gated on `player_id() != 0`, the roster badge is `p.index === 0`, and a kick is
  refused on that index. So a lobby re-index that lands a bot there does not mislabel a row, it hands
  the table to something that can never press start — the humans read *waiting for the host* pointed
  at a bot until they close the tab, and the room is a five-minute cleanup timer away from existing
  for nothing.
  - It was one reload away. Open a table, add a bot, refresh: a lobby seat is removed rather than
    held (see *A seat that is empty has to read as empty*), the bot shifts down into 0, and the
    player who reloads rejoins **behind** it. Two players and a bot in the middle produce the same
    thing on an ordinary departure.
  - Called from the places a lobby's seats move: `reindex_lobby_disconnect` (which is `leave_room`, a
    kick and a dropped socket), `join_at_table`, and `open_rematched_lobby`. The first two are both
    needed and neither is enough — the reload case has nobody left to promote at the moment the seat
    goes, so the promotion is the *arrival's*; the departure case has no join coming.
  - The move is `remove_lobby_player` + `drop_seat` + `join` under the same name + `add_bot_seat`,
    i.e. exactly the pair a departure and an `add_bot` already make, so the seats learn no new way to
    move. Lobby only: a finished room indexes its scores by seat and refuses a join anyway.
  - It terminates because each pass puts one more bot behind the first human, and it does nothing at
    a table with no human left to host it — that one is the cleanup's.
  - `lobby_reload_bot_does_not_keep_the_host_seat` and
    `lobby_host_disconnect_bot_never_inherits_the_seat` (`tests/hub.rs`).
- AI: `loco_game::bot_think(state, seat, rng) -> BotAction`.
- Scheduled as a deadline (`DeadlineKey::seat("bot_move", seat)`) at `BotTimings::think` (1200ms)
  plus up to `jitter_max` (1000ms).
- **The think delay, and only the think delay, is tunable from the environment**
  (`LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`, applied by `BotTimings::apply_env` from
  `HubConfig::from_env`, before the hub starts, and gated on `LOCO_E2E=1` like `debug_set_state`). It
  is pure dead time — nothing races it — so a shorter one changes how long the E2E suite takes and not
  what it proves. Every *other* bot delay is a reaction window somebody is meant to be able to win
  (`catch_delay` against a human's Contre-LOCO!, `uno_delay` against the catch it invites,
  `interrupt_delay` against an open window, `finish_delay` against the round being taken), and
  shortening those in CI would quietly rewrite the verdict of the tests covering them.
  A malformed or negative value is ignored with a `WARN` and leaves the shipped timing in place: a
  typo must not silently produce an instant bot.
- **Bots interject** (`loco_game::bot_interrupt(state, seat) -> Option<BotInterruptAction>`,
  scheduled by `Table::maybe_schedule_bot_interrupt`, executed by `handle_bot_interrupt`). Without it
  the game's signature mechanic ran one way only: bots could be interrupted and never interrupted
  back, so the hardest reaction in the game was also the one nobody had to defend against.
  - `bot_interrupt` mirrors the interject's own rules rather than trusting the caller (window open,
    exact card equality, draw-chain restriction, every wild names a real colour, a Swap only when it
    pays). An interject the domain will refuse is worse than none. **It is one card, however many
    copies the bot holds**, like everybody's interject (`docs/rules.md` §6.8).
  - Armed **only after a human action** (`handle_play_card`, `handle_counter_draw`,
    `handle_interrupt_play`). Bots deliberately do not answer each other here, which is what keeps a
    table of bots from trading cards with nobody watching. It is the one bot reaction armed that
    narrowly: `maybe_schedule_bot_reactions` is armed everywhere, because a call somebody owes the
    table is owed whoever put them on one card.
  - One deadline per play, not one per bot (`DeadlineKey::table("bot_interrupt")`): the handler picks
    among the bots that can actually answer, so four bots do not get four rolls of the die on the
    same card.
  - The seat that just played is excluded (taking the lead back from itself). **The seat holding the
    turn is not**: in a two-player game the bot is always the next player, so excluding it would
    leave the mechanic one-way in the most common setup.
  - `interrupt_delay` + `interrupt_jitter_max` = **1.5–2.5s**, and `interrupt_prob` = **0.40**, below
    `catch_prob`. An interrupt window has no deadline, so these are set by fairness rather than by a
    timeout: a human has to see the card land, recognise the match and click. It was 0.7–1.5s, and
    on a phone the bot's copy came down before the card it answered had finished its flight: players
    read it as a bot that played its doubles the instant they existed (2026-11-11). The floor is
    pinned by `config.rs: a_bot_slam_waits_for_a_human_to_read_the_pile`, and the range stays inside
    `finish_delay`'s so a slam that takes the round is held no longer than one that does not. A bot that always took
    the window it could see would answer every play anybody made.
  - Stale check: `last_play_at` must equal the value it was armed with, or the bot is answering a
    board that no longer exists.
  - `broadcast_interrupt` is shared with the human path, so a bot taking the lead produces the exact
    same sequence on the wire (`interrupt_success` then `card_played`).
- **The move that takes the round is held to its instant** (`bot_finish_due`, `finish_delay` +
  `finish_jitter_max` = **1.8–2.6s**). Every way a bot empties its hand waits for it: the slam of its
  last card (`handle_bot_interrupt` decides, then re-arms itself under `bot_interrupt_held` with the
  seat `committed`, so nothing is rolled or picked twice), its last card or last copies on its own
  turn, its last counter (`execute_bot_move` thinks, sees `bot_finishes`, and re-arms the move with
  the same `armed_at`, dropped if a card lands meanwhile — `board_at` — because that play re-armed
  the seat).
  - **Measured from the moment the finish became possible** — the card it answers landing
    (`last_play_at`), the turn coming round (`armed_at`) — and taken as the later of that and the
    ordinary delay, never added on top. At the ordinary pace the finish was the bot's every time: a
    slam 0.7s after a card lands is before anybody has read the pile, and a two-copy dump at the
    think delay left the table watching the round go. Held, the answer is a reach and not a gift:
    slam the top, or take the lead back with a twin, before the bot's turn plays out.
  - **And an undeclared last card holds the finish behind the bot's own declaration**
    (`bot_uno_at`). `bot_declare_before_finish` makes the call on the spot, which is legal (a late
    call is always accepted), but it shut the catch window the instant the bot found a card to play —
    a bot handed its last card by a Swap played it at the think delay and was uncatchable by
    construction.
  - **The declaration has one instant per window** (`bot_uno_at`, `moment_jitter`, the same hash
    reasoning as `bot_catch_attempt`): it used to be a fresh draw from *now* on every arming, so a
    busy board declared at the earliest of several draws, and the finish could not know when the
    call was coming. `tests/bot_finish.rs`, `src/internal_tests/bot_finish_internal.rs`.
- Auto-declare LOCO!: **deferred, and the declaration itself is what waits**.
  `maybe_schedule_bot_reactions` only schedules (`schedule_bot_uno_announce`, a `bot_uno` deadline per
  seat); `handle_uno_announce` calls `Room::declare_last_card` when it fires and broadcasts only if it
  succeeded. Declaring on the spot and deferring the *broadcast* alone settled the seat server-side
  while every client was still showing the 5s catch window it had just opened on the same
  `card_played`: a bot's LOCO! was uncatchable by construction and every Contre-LOCO! tap came back
  `player already declared` ("Déjà annoncé."), which reads as a broken button rather than as a race
  lost.
  - `handle_uno_announce` re-checks: room playing, seat still in range, its `last_card_at` unchanged
    (a Swap can open a *different* window for the same seat), and a refused declaration means the bot
    lost the race and simply never announces.
  - `uno_delay` + `uno_jitter_max` = **1.6–2.8s** of the 5s window. It is a human reaction budget
    (spot the seat → move to the button → click), not a machine's: at 0.4–0.8s the mechanic would have
    been unwinnable even once the state bug was fixed.
  - **It scans `catchable_targets`, it is not keyed on the seat that acted.** Playing down to one card
    is not the only way to owe a declaration: a Swap or a GlobalSwitch hands one over, and §8 makes
    receiving your last card exactly as declarable as playing to it. Keyed on the actor, a *human's*
    Swap scheduled nothing at all for the bot it put on one card, so that bot stayed undeclared and
    catchable for the full window: a free +2 no human ever offers, since bots do catch humans. A
    bot's own Swap had the same hole against a second bot. Armed after every action, human or bot;
    arming twice for one moment replaces the same key with the same instant.
- **Bots throw a Contre-LOCO!, late on purpose** (`schedule_bot_catch` arms it, `handle_bot_catch`
  presses it, `bot_catch_attempt` decides it). It existed before and was invisible in play, for three
  separate reasons, and the third is the one that made it a hole rather than a setting.
  - **`catch_delay` + `catch_jitter_max` = 3.2–4.4s of the 5s window** (was 2–3.5s), and the lateness
    *is* the design. The seat that forgot the call is looking at an armed, pulsing chip for the whole
    window — the LOCO! chip is on screen all match and lights up the moment it is owed — so a bot
    pressing at two seconds mostly catches the player who was already reaching for it, and the one
    control this game asks a newcomer to learn becomes a control they never get to use. Answered
    late, a catch only ever lands on somebody who was not looking, and it lands with the capsule
    nearly drained: the reading is *I nearly had it*, not *the machine is faster than me*.
  - **The ceiling is a correctness bound, not a taste one.** The window shuts at 5s and a late call
    costs its caller a card (`ErrorKind::MissedCatch` → `penalize_failed_catch`), so a bot must never
    be scheduled past it — a bot drawing a penalty for a race nothing chose to enter is noise on the
    table and a card off its hand. `schedule_bot_catch` arms nothing at or past the domain's
    `catch_window_end`, `src/internal_tests/botcatch_internal.rs` pins both ends against it rather
    than against a 5 that would then be written down twice, and `handle_bot_catch` re-checks the
    deadline when it fires.
  - **`catch_prob` = 0.8** (was 0.65). The bots are not the opponent who never misses; roughly one
    forgotten call in five walks. The gentleness is bought by the delay, not by the die — a die low
    enough to feel fair is a mechanic that never demonstrates itself, which is how a player learns
    the rule exists by reading the rulebook instead of by paying two cards for it once.
  - **One attempt per window, decided by the window** (`bot_catch_attempt`, an FNV hash of the seat
    and `last_card_at`, not a draw). A window is armed once per action taken inside it — a play down
    to one card, a bot's turn two seconds later, an interject — so rolling at the arming makes the
    delay the *minimum* of N draws and the probability 1-(1-p)^N: the busier the board around a
    forgotten call, the faster and the surer the catch, and a table of four bots would sit at the fast
    end of the range every single time. Same window, same verdict, same instant; every arming after
    the first replaces the key with itself. **Which** bot presses is still picked at random when it
    fires, among the eligible ones — one press, never one per bot.
  - **Armed after every action, human or bot** (`maybe_schedule_bot_reactions`), which is the hole. The
    catch used to be armed after a *human* action only, so a bot's own Swap could hand a human their
    last card and no bot would ever answer it. The declaration and the catch read the same list and
    are armed together from every point a board can change: a seat cannot be on the hook for one
    and not the other, and a new call site cannot arm half of it.
  - `round_ended` is a guard on both halves: a round-winning play arms no reaction on the seat it just
    left at one card.
- **A bot's turn broadcasts no deadline.** `schedule_turn_timer` arms no timeout for a bot, disarms the
  previous one, and sets `Table::turn_started_at` to `None`, because `turn_deadline_ms` reads it with
  no notion of whose turn it is. Leaving the previous human's stamp behind put a half-spent deadline
  on every `card_played` that handed the turn to a bot, and the client mounts its countdown bar on any
  non-zero deadline: it drained somebody else's clock, in urgent red, under a seat that cannot time
  out. `turn_deadline` is skipped on the wire when it is zero precisely so that `None` never reaches
  the client as a deadline (the one field here where a zero is an absence rather than a value, unlike
  `turn` / `drawn_count` / `pending_draw`). `turn_deadline_absent_during_bot_turn`
  (`tests/turn_deadline.rs`) plays a Skip first so a live deadline is proven recorded before the
  second play asserts it gone.
- A bot is `Occupant::Bot` on its seat; `Table::bot_seats` / `is_bot` read it.

## What a snapshot carries, and what is built once

- **`GameStateDTO` carries `catch_seats` and `declared_seats`.** A tab that reloaded two seconds
  into a five-second catch window rebuilt a board on which nobody was catchable and lost the three
  seconds it could still have won; a seat whose call was spent got its LOCO! button back and was
  refused `player already declared` on the tap. Both lists are the same answers `card_played` and
  the domain give (`catchable_targets`, the seat's `declared`), sent with every snapshot.
  `reconnect_snapshot_carries_catch_state` (`tests/audit_fixes.rs`) reloads inside a window, and after
  a call.
- **What is the same for every recipient is built once per broadcast** (`SharedGameState`, from
  `Table::shared_game_state`, handed to `player_game_state_with`): the scoreboard, the recap and the
  catch lists. The player list was already hoisted; the scoreboard and the recap were once rebuilt per
  seat, so a GlobalSwitch at a ten-seat table (the cap is 7 now) on its sixth match was ten scoreboard
  builds and a hundred copies on the hot path.
- **A restored table is filled in before it runs and armed through its box** (`restore_room`). The
  holds, the tokens, the AFK counts and the reconnect expiries are written into the `Table` before
  `open_table` starts it; the turn clock, the bot and the cleanup — which need the hub's context — are
  posted as the table's first job (`restore_arm`, `post_critical`) rather than run from the hub. Nothing
  can post before the listener is up, which is why the Go version never failed; it is not a race by
  construction rather than by luck.
- **A named seat below zero on `catch_uno` is refused and counted**, like a seat past the end: it is
  the same forged message with the sign flipped (`usize::try_from` fails), and charging it as a wager
  was the one place a forged target cost its sender a card instead of telling the operator anything.

## Session tokens
- 32 hex chars (128 bits from the OS, `tokens::generate_session_token`), an `ids::SessionToken`.
- Issued in `room_created` / `room_joined` / `match_found` / a solo `game_started`. Client must
  include `session_token` in reconnect `join_room`.
- Invalid/missing → refused, slot not reclaimed. The refusal is the same string a stranger gets; see
  "The reclaim refusal names nothing".
- **Compared in constant time, never with an ordinary `==`.** `SessionToken`'s own `PartialEq` is
  `subtle`'s `ct_eq`, `SessionToken::matches` refuses an empty value, and the type has no `Display`
  and a `Debug` that prints nothing, so it cannot reach a log line by accident. A network timing
  attack on 128 bits of hex is not a realistic threat and this is not pretending otherwise. It is that
  this is the only identity check the game has, the replacement is a type, and an equality operator
  returning on the first differing byte is the kind of thing that only gets noticed once it matters.
  The type is serde-transparent, so the wire and the snapshot are unchanged.
- **A reclaim spends its token and gets a new one** (`handle_reconnect` reissues, and
  `player_reconnected` carries it). The old one has been on a socket that died, it is in
  `sessionStorage`, and if the process restarted on the way it has also been written to a snapshot on
  disk. A one-shot proof is worth more than a permanent one and costs nothing, because the client
  already stores whatever the server hands it. `reconnect_rotates_the_session_token`
  (`tests/hardening.rs`) also asserts the spent one no longer opens the seat.
- The token is a field of its `Seat`, so it goes with the seat on a removal, travels with the player
  on a swap, and goes with the table on delete.

## Rate limiting
- Token bucket per client: `RATE_PER_SEC` 10/s refill, `RATE_BURST` 20.
- `client::RateLimiter`, owned by the read pump — the only task that drops a message — so it needs no
  lock.
- Drops → `rate limit exceeded`. Per-connection, not per-identity.
- **One notice per burst, not one per dropped message** (`RATE_LIMIT_NOTICE_PERIOD`, 1s,
  `RateLimiter::should_notify`). Answering each drop put a fresh marshal and a queued frame on the
  server's own send path for every message of a flood: the limiter amplified exactly what it exists to
  absorb, and a fast enough burst ended by overflowing the send buffer and force-closing a connection
  that one notice would have corrected. The reply is a hint to a buggy client, not an acknowledgement
  owed to every message. `messages_rate_limited` still counts **every** drop, so the metric keeps its
  shape; `rate_limit_burst_then_error` (`tests/hub.rs`) pins both halves.

## Synchronised map loading
The table stays **shut** between "hands dealt" and "clock running" while every client downloads the
map. `maploading.rs`.

- **Why it is not cosmetic**: a map is the engine's chunk, then a build and a render of a few
  thousand blocks on the client's own GPU. Dealt straight into a match,
  the first player's 30 seconds start ticking while somebody else's table is still a grey rectangle,
  and in a game decided by arrival order that is a head start, not a slow paint.
- Flow: `deal_match` sends each seat its `game_started` (with **no** turn deadline) then
  `begin_map_loading` → `match_loading { players_ready }` → each client preloads and sends `map_ready`
  → `match_loading` again per arrival → once nobody is left (`maybe_open_table`), `open_gate` arms the
  turn timer, broadcasts `match_ready { turn, turn_deadline }` and schedules the bots. **The clock
  starts at `match_ready`, not at `game_started`** (`turn_timer_starts_at_match_ready_not_game_started`,
  `tests/hub.rs`). The match's duration starts there too (`match_started_at`): the gate is a wait, not
  the game.
- **Nothing arms a clock or a bot behind the gate either.** `schedule_turn_timer` and
  `maybe_schedule_bot` return while `Table::is_loading`, and `execute_bot_move` returns if the move it
  was armed for lands inside a gate. On the Go server a departure during the gate once reached both
  through the walk-out, and the first turn's thirty seconds ran against a grey rectangle: the head
  start the gate exists to refuse, from the server's own timer. `open_gate` arms both once the last
  human is in.
- **Every gameplay message is refused while the gate is open** (`is_gameplay_msg` + `is_loading` in
  `dispatch_at_table`, "waiting for every player to load the table"). Trusting the client's own
  loading screen would leave a client that skipped it as the only one able to act.
- Gate is **per match, not per round**: round two runs on a decoded map, and a second pause there
  would be a stall with no visible cause. A rematch re-arms it, because it draws a new map.
- Bots are marked ready at the start: they render nothing. A seat that **disconnects** during the
  gate stops being one the table waits on (`disconnect_at_table` re-asks `maybe_open_table`), and a
  seat that **reconnects** into an open gate is sent `match_loading` so its client knows to answer. A
  `map_ready` that arrives with no table behind it (a duplicate, or one that lost the race with the
  timeout) is dropped in `route` rather than refused.
- `Timings::map_load_timeout` (20s) opens the table without the stragglers: one backgrounded tab must
  not hold six people hostage. It is the `map_load_timeout` deadline, disarmed when the gate opens.
  The client's own `MAP_PRELOAD_TIMEOUT_MS` (12s) is deliberately shorter: if they were equal, every
  slow connection would look like a dead one.
- Client: `store.mapLoading` / `applyMatchLoading` / `applyMatchReady`, `mapPreload`
  (`img.decode()`, not the `load` event, because bytes arriving is not the same as being paintable), and
  `<MapLoadingScreen />`. **A failed or missing image still reports ready**: the board falls back to
  the felt, which is a worse-looking match, not a broken one; a client that never answers is the one
  outcome the gate cannot survive.
- **`map_ready` is sent once per gate, guarded by a ref**, not keyed on `mapLoading`: the store
  object gets a new identity on every progress broadcast, so a dependency would pay one `map_ready`
  per opponent.
- The screen is an **overlay over a mounted board**, not a screen instead of it: the board spends the
  wait laying itself out, so the table is finished the instant the overlay lifts.
- The reveal names the room and describes it in one line (`t.maps[id]`), and lists **who is still
  loading**, because a bar alone cannot tell a slow download from a hung game, which is the difference
  between waiting and reloading. The scrim is deliberately light: a scrim heavy enough to make type
  effortless turns the reveal back into the loading bar it replaced, so the name carries its own ink
  outline instead.
- **E2E**: `startGame()` returns only once the table is genuinely open, and `waitForTableOpen`
  must be called on every *secondary* page in a multi-client test. Without it a test acts during the
  gate, gets refused, and then blocks reading a reply that never comes. The Rust socket tests go
  through `testkit::complete_map_load` for the same reason: the gate is exercised, never disabled.

## Hand synchronisation
**Every path that grows a hand sends the affected player the actual cards (`card_drawn.cards`) and
everyone else only the count (`drawn_count`).** `Table::send_hand_growth` is that split:
`auto_draw_on_timeout` (both the plain and the penalty branch), `handle_catch_uno`,
`handle_bot_catch` and `penalize_failed_catch` call it, and it announces nothing when the piles gave
nothing. Under it, **`Table::announce_cards_drawn` is the one builder of `card_drawn`**, and the
two draws that announce even an empty draw call it directly: `handle_draw_card` (with the turn
deadline it has just re-armed) and a bot's own draw (without one, as it always was; a bot has no
socket, so everybody gets the count). `tests/funnels.rs::card_drawn_is_built_in_one_place` fails
on a second builder. Hands rearranged
wholesale (Swap / GlobalSwitch) instead get a personalised `game_state` per recipient
(`broadcast_personalized_game_state`).

Telling a client the count but not the cards desyncs it silently and unrecoverably: its local hand
stays short, the player empties the hand they can see, the server still holds cards for them, so the
round-end check never fires — the board freezes on "your turn" with no cards. That is exactly what
the LOCO!-catch penalty (+2) and the penalty branch of the turn timeout once did.

**`turn` and `drawn_count` are always written**, for the same reason `pending_draw`, `has_drawn` and
`player_index` are `Option`s on the wire: a zero is a value here, not an absence. `turn: 0` is seat
0's turn (the client defaulted to 0 and was therefore right by luck, which `player_index` was not),
and `drawn_count: 0` is a draw against exhausted piles — the client's old fallback for a missing count
was **1**, so every observer would have added a card nobody drew to a hand the server never grew.
`server/crates/loco-protocol/tests/parity.rs` pins both onto the wire.

**A `card_drawn` also carries the turn state, to everyone, always.** `pending_draw` and `has_drawn`
are `Option`s on `CardDrawnMsg` precisely so a `0`/`false` is written rather than skipped, and the
client applies them verbatim (absent = unchanged) instead of inferring anything from the fact that a
hand grew. **Not every hand growth is a turn action**: the LOCO!-catch penalty gives +2 while the
draw-once flag is still false, and that message reaches the whole table. Defaulting the missing flag
to "has drawn" is what produced a seat that could neither draw (button disabled) nor pass (server:
`you must draw a card before passing`) until the turn timer auto-acted for it.

**Shrinking a hand has the mirror rule.** `removePlayedCards(hand, card, targetSize)` (in
`state/store/helpers.ts`, re-exported from `gameStore.ts`, called by `applyCardPlayed`) drops
copies of the played card until the local hand
matches the `hand_size` the server sent in the same message, because one `card_played` can represent
several discards — a turn batch (`Room::play_cards`) puts down N identical copies at once. An
interject no longer can: it is one card (`notes/domain-rules.md`), which is where this used to bite
hardest. Removing exactly one left the rest as phantom cards: they rendered, they could be tapped, and
the server refused each tap with "card not in hand" until the round ended.
- `card_played` always carries `players`, so the authority is always there. With no `hand_size` to
  compare against it falls back to a single copy; a server hand *larger* than ours removes nothing,
  because that is a desync only a `game_state` can settle and guessing would widen it.
- Copies come off the **end** so the survivors keep their `handCardKeys` identity and slide into the
  gap instead of remounting.
- `src/test/batchPlay.test.ts` covers the pure function and the store; `e2e/tests/batch-play.spec.ts`
  covers the wire. `play_cards` had **no** E2E coverage at all, which is how a desync in the game's
  signature mechanic survived.

## Room lifecycle cleanup
- `Timings::empty_room_timeout` (default 5 min) — empty room retention.
- `Timings::turn_timeout_grace` (default 400ms): how long past the advertised deadline the
  auto-action waits. `turn_deadline` still says `turn_timeout`, so the bar is honest and only the
  server's patience is longer: a play sent on the last frame of the bar has a round trip to cross, and
  a server that acted on the very millisecond answered it "not your turn" after the player had beaten
  their own clock — the one refusal in the game that reads as the clock lying. A test that shortens
  `turn_timeout` inherits the grace; shorten it too where the arithmetic matters.
- `Timings::reconnect_timeout` (default 60s): disconnected-in-game slot hold.
  `MatchmakingTimings::reconnect_timeout` (15s) replaces it in a matchmade room, and its expiry
  forfeits the match rather than merely freeing the seat.
- All of them are fields of the `HubConfig` a hub is started with: a test narrows one by passing its
  own config, so tests run in parallel with nothing to restore. Go kept them as exported package
  variables that every test had to put back.
- Empty room (the last lobby or finished member leaves, or every in-game seat is held) →
  `Table::schedule_room_cleanup`, which arms the `room_cleanup` deadline.
- **Seating anybody disarms it** (`Table::seat`), so a cleanup that fires is never a stale one; Go
  stamped the table and had the fire compare stamps. `handle_cleanup` still checks the table is
  empty, as belt and braces, and asks the hub to do the deleting (`post_to_router("delete_room")`),
  because the map of tables is the one thing a table does not own.
- `HubCore::delete_room(code)`: the single deletion point. One `remove`, then the task is stopped;
  whatever the table held goes with it. Adjusts `rooms` / `bots_active`, structured log.

**A match is not an empty lobby, and the fixed five minutes is wrong for it.** An abandoned *lobby*
costs a map entry. An abandoned *match* stays `Playing` for the whole wait, so the turn clock keeps
re-arming and auto-drawing for seats with nobody behind them, and — the part that reaches other
people — the table keeps publishing `InFlight`, so a deploy started anywhere in those five minutes
waits on a game nobody is playing. `close_abandoned_match` closes it the moment it is certain
instead: no sockets, no holds left, therefore nobody who can come back and nothing left to protect.
It runs off the last reconnect expiry and off `leave_room`, and it does the deleting the same way
`handle_cleanup` does, through the hub. `abandoned_match_last_expiry_closes_the_table`.

## A deploy does not end the matches on the server
`drain.rs`, `snapshot.rs`, and `drain_and_snapshot` in `server/crates/loco-server/src/main.rs`.
Operator-facing detail, including the compose and CI side, is in
[`docs/deployment.md`](../deployment.md); what follows is why the shape is what it is.

The bug this replaced: the first Go `main` caught no signal at all, so `docker compose up -d` killed
the process mid-turn. Every match in flight was lost, and the clients that came back 250ms later on
their own reconnect schedule were answered `room not found`, which reaches the player as "Aucune table
avec ce code". They lost the match and were told they had mistyped their own table code.

**Two mechanisms, both on every shutdown, complementary rather than alternative.** The drain gets the
number of interrupted matches to zero in the ordinary case, by waiting. The snapshot makes the case
where waiting runs out survivable rather than fatal. Neither is enough on its own, which is why
neither is conditional on the other: `drain_and_snapshot` waits on `Hub::drain_done` for at most the
drain timeout, then calls `Hub::save_snapshot` either way.

**How long it waits is a deploy policy, and the deploy is not allowed to wait on the players.** 90s
(`DEFAULT_DRAIN_TIMEOUT`, `LOCO_DRAIN_TIMEOUT` to change it, a Go duration or bare seconds, never zero)
in both deployed environments since 2026-08-02, down from 15 minutes in production. The long value
was defensible as a game decision and indefensible as an operations one: it made the duration of a
pipeline a function of how long strangers played, held a runner slot for a quarter of an hour, and
left the job's own ceiling close enough to the wait that being kinder to players by raising the drain
would have started failing deploys on a match rather than on a fault. The wait a shutdown can incur
is now a constant. **This moves load onto the snapshot rather than removing it**: in production the
restore is the ordinary path now, not the exceptional one, which is the reason its coverage restarts
a real hub over real sockets instead of asserting the marshalling (`tests/snapshot.rs`, and
`tests/go_snapshot.rs`, which restores a file the Go server wrote).

**The drain refuses exactly the actions that would extend it, and nothing else**
(`HubCore::refuse_while_draining`, `server updating, try again in a moment`). `create_room`,
`start_game`, `rematch`, `find_match`, `play_bot`, and a `join_room` for a table this process does not
have. That list is not "everything that touches a room": joining a lobby that already exists stays
allowed, because a lobby cannot deal during a drain, so sitting down in one costs the deploy nothing.
What is on the list is what would add a match to the set being waited on. Without `start_game` on it,
two players rematching hold the deploy open forever and the timeout becomes the only thing ending it,
which is the outcome the drain exists to avoid. **Everything inside a running match is untouched**:
turn clock, reaction windows, bots, reconnects, forfeits.

**The queue is emptied at the start of the drain, not refused as it drains.** Nobody in it is in a
match, so there is nothing to protect, and leaving them there is the worst available outcome: waiting
for an opponent this process has already stopped pairing. They get the refusal and a
`matchmaking_cancelled`, which takes the screen back to the table view where a private table still
works.

**The notice goes to every table, not only the ones playing.** It was once gated on the match being
in play, which meant the three places a drain is actually *felt* were the three that never heard
about it: a waiting room, whose host is about to press a start button that comes back refused; a
game-over screen, whose rematch button does the same; and a matchmade pair still on its versus
reveal, formally a lobby, which deals itself seconds later into a match nobody told it about. Finding
out from a refusal is the failure the line exists to prevent, so it goes to everyone who can be
refused (`server_updating`, asked of each table because who sits there is the table's to say). A seat
that reclaims mid-drain is told on arrival (`handle_reconnect`). The copy differs by screen on the
client (`ServerUpdating` has a `card` variant): a table that has not dealt is not owed "this match
plays to the end".

**`check_drained` runs after every event on the hub's loop while draining, not hooked onto the
handlers that can end a match.** A match stops being in flight through the last card, a forfeit, an
expired reconnect window and the empty-room cleanup, and the path that gets forgotten is the one that
leaves a deploy hanging until its timeout. Scanning the table map costs nothing next to the work the
loop just did. A matchmade room still on its versus reveal counts as in flight even though it is
formally a lobby: the pair is made and the deal is scheduled.

**That scan reads a published value, and the discipline moved with it.** The hub cannot read a table
it does not own, so each table computes `Table::phase` and publishes it (`actor::Published`) **after
every job it runs**, rather than on the handful that can end a match: the hook is the one that gets
forgotten, and forgetting it is what leaves a deploy hanging on a match that finished. It is also
published by `TableHandle::start` before the task exists, so a room restored from a snapshot
mid-match counts from its first instant rather than from its first message.

**`HubCore::save_snapshot` stops every table before it reads one, and that is deliberate.** A table's
state belongs to its task, so the only way to read it is to have the task hand it back
(`stop_tables`), and stopping every table first is what makes the file describe one instant: a table
still running could be halfway through dealing a hand. It also means the hub stops serving its tables
here, which is exactly what this call is: the last thing a process does with them, after the drain
and immediately before it goes. Nothing plays on the far side of it.

**A restored room comes back with every human seat held** (`restore_room`: `Occupant::Held` at one
instant, and a reconnect expiry armed for each), which is not a special state: it is the one the table
already knows how to handle, so the reconnect windows, the forfeits and the empty-room cleanup all
apply unchanged and a table nobody returns to ends by itself. `schedule_reconnect_expiry` is shared
with `disconnect_at_table` for exactly that reason. Bots come back as bots (`bot_slots`).

**The turn clock restarts whole on a restore.** The fraction that elapsed is not recoverable from a
wall-clock stamp anyway, since the process was down for part of it, and the error is in the player's
favour.

**`SNAPSHOT_SCHEMA_VERSION` is a hard gate.** A room shaped by another build is not a room this build
can play and there is no safe way to guess the difference, so a mismatch drops the whole file with a
`WARN` rather than half-restoring it. Same for one older than `snapshot_max_age` (2 min): past that the
clients have exhausted their reconnect attempts and restoring only puts unreachable rooms on a fresh
server. The file is removed before it is parsed, so a restore that goes wrong breaks one boot and not
every boot after it. Bump the constant by hand whenever `SavedRoom` or `RoomSnapshot` changes shape. It
is still 5, as the Go server wrote it: the field names are Go's (`gotime.rs` writes Go's
`time.Time`, map keys are seats written as strings), so a file the Go server saved on its way out was
one the first Rust server could read (`go_snapshot_v5.json`).

**An empty `LOCO_SNAPSHOT_PATH` disables the whole thing**, which is what local dev and the E2E suite
run with: nothing about their behaviour changes. The snapshot is restored before the listener is up,
so no socket arrives into a half-restored room.

**The file is the one secret this stack writes down.** It carries every session token and every hand
in every match a shutdown interrupted, so whoever can read it can claim any of those seats and see all
of those cards. `write_atomic` writes it `0600` through a temporary neighbour and a rename (a snapshot
is written while the process is being torn down, which is exactly when a half-written file is
plausible), the process runs as uid 65532, and the directory it lands in is a host path an operator
can list: `${DATA_DIR}/snapshots/${DEPLOY_ENV}` mounted at `/data`, one directory per environment, so a
dev deploy can never restore (and delete) prod's matches. The deploy's `rollout()` in `.gitlab-ci.yml`
stops the old server first, then hands that environment's directory to 65532 and chmods it `0700`,
then starts the new one — in that order, because the process being replaced writes its snapshot as
its own user while it stops. Treat that directory as a secret. It is also short-lived by construction
(removed as it is read, refused past the maximum age), which is what keeps the exposure to the length
of a restart rather than the life of the server.

`/health` and `/metrics` both carry `draining`. `/metrics` also carries `matches_in_flight`, which is
only maintained while draining and reads 0 before that: counting it the rest of the time would mean
scanning every table after every event for a number nobody is looking at.

## Latency measurement
- `Client::latency` / the ping stamp (atomics on the client). The write pump stamps every ping frame
  (`stamp_ping`), and the read pump folds the round trip of the pong in at 0.6 old + 0.4 new
  (`Client::note_pong`), capped at `MAX_LATENCY_MS`. A pong with no ping behind it is ignored rather
  than published as a flattering 0 ms.
- `Timings::ping_period` (5s) is a **latency probe first, keepalive second**. `pong_wait` (60s read
  deadline) is unchanged. Browsers answer ping frames in the WebSocket layer with no page code
  involved, which is why this is a real network RTT and not something a client could report about
  itself.
- The fan-out runs off an interval in the hub's loop (`latency_broadcast_period`, 3s), which asks each
  table for it (`Table::send_latencies`), and only for tables that are playing. **A table where nothing
  has been measured yet is skipped**: a payload of `-1` says exactly what the client's own default
  already says, and the extra traffic showed up as flakiness in tests that read the next message of a
  given type.
- Both periods are `Timings` fields so tests can shorten them; production never changes them.

## Metrics
**`/metrics` *and* `/health` are operator surfaces, and no compose file publishes the server any
more** (`serve::routes`, which `main.rs` merges with the live-streams routes). nginx proxies `/ws`,
`/live.json` and `/live-thumb/`, and nothing else — the last two are the live-streams strip, and
`csp.test.ts` pins that list so a fourth is a deliberate decision ([`live.md`](live.md)). `/health`
used to be proxied too, and it answers with the live room count, the connected-player count, the
uptime and `draining`. None of that is anybody's business from the internet. The counts size the
server for whoever is thinking about loading it, and `draining` announces the window in which new
tables are refused. Nothing legitimate needed it there either: Docker's healthcheck runs inside the
server container (`loco-server healthcheck`, a `GET /health` on loopback, exit 0 on a 200 — the image
is distroless and has no `wget`), and the CI smoke test does the same. `deploy/compose.yml` only
`expose`s 8080 on the `internal` network, and `docker-compose.yml` matches it. It used to publish
`8080:8080`, which put an unauthenticated endpoint on the LAN for no gain, since the browser reaches
the server through nginx there like everywhere else. With no shell or HTTP client in the image,
reading `/metrics` takes a client on the `internal` network: the nginx container is one
(`docker compose exec client wget -qO- http://server:8080/metrics`). `docker-compose.dev.yml` is the one
exception and must stay published: the Vite client connects straight to `ws://<host>:8080/ws` with no
nginx in front of it.

The counters under `live` come from a poller this crate does not own: `Hub::set_live_stats` is
installed by `main`, so the hub reports the numbers an operator reads without knowing what a gateway
or a Twitch is. Zeroes on any server with no gateway key, which is every environment but production.

## The one outbound call
This server talks to exactly one thing outside itself, and it is not Twitch: it is the Janus gateway,
which holds Twitch's secret and does the OAuth2 for us. The poller (`loco-twitch`) runs on its own
task, never on the hub's loop, and comes back in through `Hub::publish_live` → `post_to_router` alone.
Everything about why — the freshness rules, the preview cache, screening a name this game did not
write, and why a `game_id` that will not resolve switches the whole thing off rather than widening
the query — is in [`live.md`](live.md).

`GET /metrics` returns **Prometheus text** (`text/plain; version=0.0.4`), rendered through the
`metrics` crate's exporter, one recorder per hub so two hubs in one test process never add up into one
page, **under the Go names**: the E2E helpers (`e2e/helpers/metrics.ts`) and every operator's muscle
memory read them by those spellings. `/health` stays JSON.
- Gameplay: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`.
- Health: `uptime_sec`, `goroutine_count` (the Go name, kept; it counts the tokio runtime's live
  tasks, which is the same question — is anything leaking? — and should stay low and stable).
- `messages_rate_limited` — sustained growth = abuse / too-tight burst.
- `messages_dropped_busy` — should be ~0; non-zero = the hub's queue or a table's box was full.
- `slow_clients_closed` — per-client send buffer overflow → forced close (client into reconnect path). Sustained growth = broadcast rate too high or many bad connections.
- `channel_retries` — crossings that found a box full and retried (`post_critical`, `post_to_router`); ~0 healthy.
- `suspected_cheats` — clients with ≥`SUSPECT_THRESHOLD` (5) non-honest rejections in 30s; one inc per burst. Investigate the `WARN suspected cheat` line (`conn=`, `code=`). Refusals whose `ErrorKind::is_honest()` never count (see "Anti-cheat").
- `reconnect_expirations` — disconnected players whose hold expired.
- `matchmaking_queue`: players waiting for a 1v1 right now, and `matches_matchmade`: pairings made since boot. **The only place either number is readable**: nothing on the wire tells a client how long the queue is (see "1v1 matchmaking"). Sustained `matchmaking_queue` ≥ 1 with a flat `matches_matchmade` means people are searching and not being paired.
- `matches_solo` — `play_bot` games since boot.
- `debug_mode_active` — reflects `LOCO_E2E=1`. MUST be `false` in prod; `main` logs a startup `WARN` if set.
- `handler_panics` — panics a `catch_unwind` recovered from, on the hub or on a table. **Any value
  above zero is a bug**, by definition, and nothing else surfaces it: the process no longer dies, so
  the only evidence is this counter and the `WARN handler panic recovered` line carrying the message
  type and the panic. This is the one number here worth an alert.
- `conns_refused` — upgrades turned away by `max_clients` / `max_conns_per_net`. A load signal, not an
  incident, until it climbs: see "Ceilings".
- `joins_throttled` — `join_room` refused for burning a network's wrong-code budget. Read alongside
  the `WARN table code sweep suspected` line, which carries the `conn=` and the prefix.
- `loop_queue_depth`, `loop_queue_capacity`, `loop_queue_peak`, `loop_slowest_us`, `loop_events` —
  see "What bounds this server".
- `log_lines_dropped` — lines the asynchronous sink threw away because the far side was not keeping
  up. Above zero means **the log being read has holes in it**, which is worth knowing before
  concluding anything from what is missing. The log says so in place as well; see "The log is off the
  event loop".
- `draining` + `matches_in_flight` — this process has been asked to go and is finishing what it had. `matches_in_flight` is the number the shutdown is waiting to reach zero; it is only maintained while draining. `draining` also rides `/health`, which deliberately stays `200`: a draining server is serving its players perfectly well, and a container Docker considers unhealthy is one something else may decide to kill out from under them.

Every counter is an atomic on one `HubMetrics` (`Shared::metrics`, `Hub::metrics`), because every
table's task writes them and `/metrics` reads them from the HTTP side; `Hub::metrics_stats` reads them
at one instant. `matches_started` is incremented in `deal_match` and `deal_solo_match` (per match, not
per round). `matches_finished` in `handle_round_or_match_end` when the match is over, and in
`forfeit_match`. `bots_active` is incremented in `handle_add_bot`, `open_solo_table` and
`restore_room`, decremented in `remove_unmanned_seat` and in `delete_room` by the table's published
bot count.

## Server stability
- **Deferred work is a deadline in the table's state**, never a detached sleep that posts back (see
  "Deadlines live in the table's state"). "Does this room still exist" is answered by the deadline
  going with the table.
- **What still crosses a box, and what it does when the box is full:**
  - hub → table, critical (`post_critical`, retried once after 1s, then `WARN`): `disconnect` — a drop
    leaves a seat held by a socket that no longer exists; `restore_arm` — a drop leaves a restored
    match with no clock, no bot and no cleanup; `drain_notice` — a drop leaves a table's players
    sitting through the drain told nothing, against "every table is told once"
    (`internal_tests/lifecycle.rs::a_drain_notice_reaches_a_table_whose_box_was_full`).
  - table → hub (`post_to_router`, every one retried once after `ROUTER_RETRY`, 1s): deleting a room
    (`delete_room`, `delete_abandoned`), requeueing a survivor, enqueueing after a released seat
    (`enqueue`, `open_solo`), the wrong-code charge (`failed_join`), the live list.
  - hub → table, best-effort (`post_from_timer`, dropped with an `INFO`): the latency fan-out and
    sweeping a client out of a table it left for another. Each is a message a table did
    not get to send rather than a fault.
  - a player's message (`post_to_table`): a full box answers that player `server busy, please retry`
    and counts `messages_dropped_busy`. A full box names one table, not the server.
- The Go server's retry list (bot move 1s, reconnect expiry 5s, room cleanup 30s, map-load deadline)
  is gone with the posts it covered: those are deadlines now, and a deadline cannot be dropped.
- **`Client::send_bytes` force-closes the socket when the send buffer (`SEND_BUFFER`, 256) fills.**
  A silent drop would desync the client; a close → read pump ends → unregister → reconnect window →
  auto-reconnect → `handle_reconnect` snapshot. Increments `slow_clients_closed`.
- **Broadcasts marshal once.** `Table::broadcast` stamps `server_now`, serialises once, and fans the
  same `Utf8Bytes` out through `send_bytes`. Per-recipient personalised payloads (`game_state`,
  `game_started`, the private `card_drawn`) build the player list and the `SharedGameState` once per
  broadcast and call `player_game_state_with` per seat.
- **The read pump never waits on the hub.** It `try_send`s into the inbound queue (`INBOUND_DEPTH`,
  256) and a full one answers "server busy": a reader parked on a full queue would cascade into a
  deadlock on the unregister queue (`REGISTER_DEPTH`, 16) behind it.
- Every deadline that fires re-checks the state that can move without a re-arm (`execute_bot_move`,
  `handle_expire_reconnect`, `handle_cleanup`, `handle_turn_timeout`), and logs the reason it skipped.
- **The listener is ours** (`loco-server/src/http.rs`): hyper's HTTP/1 builder with
  `header_read_timeout` at 10s (`HEADER_READ_TIMEOUT`, Go's `ReadHeaderTimeout`), because
  `axum::serve` exposes no such knob and a connection that sends half a request line and waits is a
  socket and a task held for free — the Slowloris shape. Hyper runs that clock whenever a connection
  waits for a request head, so an idle keep-alive connection is closed by it too, inside the 60s idle
  bound Go had, which therefore has no separate knob. An upgraded WebSocket is past HTTP and untouched.
  Shutdown gives connections in flight `SHUTDOWN_GRACE` (5s) and does not wait on upgraded sockets.
- Task stability tests in `tests/hub.rs`: `goroutine_stability_room_lifecycle`, `_bot_game`,
  `_full_lifecycle` (they count the runtime's live tasks; the names are Go's).
- `Table::player_game_state_with` is defensive: a missing state, a seat out of range or an empty
  discard → a minimal `GameStateDTO` + `WARN`, never a panic.
- **`dispatch` catches panics, and refuses gameplay at a table that has not dealt.** The floor under
  the line above, and the reason it is no longer the only thing standing between a handler bug and a
  total outage. See "One message must never be able to cost the server".
- **The container has no privilege to lose.** `server/Dockerfile` builds a static musl binary onto
  `gcr.io/distroless/static:nonroot`: no shell, no package manager, uid 65532 (it binds a high port,
  reads no system path and writes one file). `deploy/compose.yml` adds `no-new-privileges`,
  `cap_drop: ALL`, a read-only root filesystem and a tmpfs `/tmp`. The bind mount at `/data` stays
  writable, and the deploy chowns that environment's snapshot directory to 65532 and chmods it 0700
  (see "A deploy does not end the matches on the server"), because a mount overrides whatever the
  image chowned and a container that cannot write its snapshot loses exactly the matches the snapshot
  exists to save.

## The log is off the event loop
A log line was the most expensive thing a handler did, and the only thing it did whose duration
something outside this process got to decide.

Go measured it both ways: one line written straight to stderr cost about **0.9 µs** when whatever was
reading stderr kept up and **7.3 µs** when it did not, against **8.6 µs for a whole card play** at a
four-player table. And 7.3 µs is not the ceiling: a container's stderr is a pipe, a pipe holds 64 KB,
and once it is full a write does not get slower, it *waits*. A log consumer that stalls was therefore
able to stop the event loop, and the event loop was every table on the server at once. A table's task
is no different: a write that waits inside a handler is a table that has stopped.

`logsink.rs` is the answer, and its shape is chosen so that no call site has to know about it:

- **`main` installs the writer, not the calls.** `AsyncLog::new(std::io::stderr(), LOG_QUEUE_DEPTH)`
  and `logsink::install` make it the `tracing` subscriber's writer before anything has a line to
  write, and every `tracing::info!` / `warn!` stays an ordinary macro. Through the sink a line is
  **0.04 µs** on the bench box (Go's sink: 0.15 µs) and, far more to the point, a constant.
- **The queue is bounded and overflow is dropped, never waited on.** Waiting is the failure being
  removed; a sink that blocks when it is full has simply moved the stall. `LOG_QUEUE_DEPTH` is 4096,
  sized for the burst after a deploy when every client reconnects at once and each one is a line. One
  OS thread (`loco-log`) takes lines off and writes them for real.
- **What is dropped is counted and announced.** `log_lines_dropped` on `/metrics`, plus a
  `WARN log sink overflowed, N line(s) dropped` written in place. A gap nobody is told about is worse
  than a slow log: an operator reading around an incident has to be able to see that lines are
  missing. That notice goes to the underlying writer directly, never back through the queue, which is
  full by definition at the moment it is needed.
- **The line is copied on the way in, and handed over whole.** `AsyncLog::write_line` takes a copy,
  so the caller keeps its buffer; the `tracing` side formats one event into its own `LineWriter` and
  hands it to the sink when it is dropped, so a line reaches the output in one piece or not at all.
  `copies_the_callers_buffer` is the regression from Go, where the logger reused its buffer on the
  very next call and a queue holding the caller's slice handed the writer whatever the following line
  overwrote it with.
- **`close` flushes, is idempotent, and gives up.** A shutdown runs on a signal and a second signal is
  the escape hatch operators are told to use, so closing twice must not panic. **The escape hatch
  closes the sink too** (`abandon_drain` in `main.rs`, on a blocking thread, then
  `process::exit(1)`): exiting straight away lost the queued lines saying why the process went down,
  its own included. `the_second_signal_flushes_the_log_before_exiting` holds the writer and fails
  if the queued lines are not out when it returns. The flush is bounded by
  `LOG_CLOSE_GRACE` (2s) and drains at most the queue's capacity rather than waiting for silence,
  because a task that has not noticed the shutdown yet is still logging.
- **A fatal start logs and returns rather than exiting.** A failed listen writes `FATAL listen failed`
  and `main` returns a failure code after closing the sink: an immediate exit would leave the line
  saying why the server never came up sitting in the queue, and that is the one line an operator
  cannot do without. A panic goes through the same sink (`install_panic_hook`).

`main` runs the shutdown in order and waits for each step: drain, snapshot, close the listener, wait
for it, `Hub::stop`, then close the sink. Go once let `main` return while the drain, the snapshot and
the hub's stop were still running, because its listener returned the moment shutdown was *called*;
that was survivable while all three were fast and in memory, and it stops being survivable the moment
the last thing a shutdown does is flush a queue.

## Structured logging
- `tracing`, through the asynchronous sink above, to **stderr**, formatted by `logsink::GoStyle` into
  the Go server's line so the operator's greps keep working: `2006/01/02 15:04:05 [WARN ]message
  key=value …`, single line, e.g. `room created code=ABC123 host=Alice`. Docker's `json-file` driver
  captures both streams, so stdout and stderr have never been a distinction an operator could see.
- **Spans, not repeated fields.** A table's task runs in a span carrying `code=`; a player's job and a
  connection's pumps in one carrying `conn=` (and `addr=` for the pumps). The formatter writes the
  fields of every span an event is inside, so every connection-scoped line carries `conn=<8-hex>`
  (`tokens::generate_conn_id`, per `Client`) and every room-scoped one `code=<6-char>`, without each
  call site repeating them.
- Events: connected (conn, addr), disconnected (nickname, player_id), reconnected, reconnect window
  expired, room created/deleted, match started (players, format), match finished (winner), WS upgrade
  errors, deadline skips with reason, box-full retries (`WARN` on a dropped retry), **suspected cheat
  (`WARN suspected cheat: 5 validation rejections in 30s conn=<id> code=<code> player=<idx>
  last_reason=<msg>`)**, slow client (`WARN slow client, force-closing …`).
- `WARN debug mode enabled (LOCO_E2E=1) ...` once at startup if the gate is on. Prod must never see
  this.
- No sensitive data (tokens, hands) in logs; a `SessionToken`'s `Debug` prints nothing.

### `addr=` is a network prefix, never an address
Every `addr=` field goes through `privacy.rs`: `truncate_addr` / `truncate_ip` for a raw address,
`Client::net_prefix` for a connection. An IPv4 address is cut to its `/24` and an IPv6 one to its
`/48`, and anything that does not parse becomes `unknown` rather than falling through verbatim,
which is the path a proxy header or a unix socket would otherwise take.

**Nothing outside `privacy.rs` reads the peer address.** `serve_ws` takes the `ClientNet` extractor,
which is already truncated, and never sees the peer. Two reasons, and the second is the operational
one:

1. A full address is personal data, and this server holds no other. Truncating at the point of
   reading means it is never stored, which is a stronger guarantee than any retention policy this
   project has the process to keep.
2. Nothing here reads an address to identify anybody. Lines are correlated by `conn=`, which is
   per-connection, stable and meaningless outside the process. The prefix only exists to tell two
   networks apart when one of them is misbehaving, and a `/24` does that.

The client test suite enforces it, oddly but deliberately: `client/src/test/legal.test.ts` scans every
hub source but `privacy.rs` for a read of the full address (`remote_addr` / `peer_addr()`, the pattern
in `client/src/test/serverSource.ts`), because the assertion it is protecting is a promise made in the
privacy copy, and that is where a reader will look for it. `privacy.rs`'s own tests cover the
functions. nginx does the same truncation for its own access log (`client/nginx.conf`, the
`anonymised` format), since in production it is the process that sees the real client address. Full
reasoning: [`docs/notes/legal.md`](legal.md).
