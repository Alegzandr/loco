# Server: hub, transport, operations

Everything in `server/crates/loco-hub/`: connections, tables, bots, anti-cheat, metrics, the deploy
drain. The binary around it is `server/crates/loco-server/` (`main.rs`, `http.rs`). `CLAUDE.md`
carries the rules; this file carries the reasons and the edge cases.

## How the crate is laid out
`server/crates/loco-hub/src/`, grouped by which side of the hub a module lives on:

| Where | What it owns |
| --- | --- |
| `net/` | one socket and the HTTP surface: `client.rs` (send queue, the two pumps, the token bucket, the latency probe, the seat, `Client::refuse`), `serve.rs` (`GET /ws`, `/health`, `/metrics`, `origin_allowed`, admission before the upgrade), `privacy.rs` (`ClientNet`, `NetPolicy`, `truncate_addr`, `is_routable_client`: the only module that reads a peer address), `wire.rs` (`decode_client`, the `server_now` stamp) |
| `router/` | what is between tables: `hub.rs` (`Hub`, the cloneable handle, and `HubCore`, the loop's own state: the map of tables, the sockets, the queue, the wrong-code budgets; `open_table`, `delete_room`, `post_to_router`), `dispatch.rs` (`dispatch`, `route`, `post_to_table`), `rooms.rs` (opening a table, taking a seat, the wrong-code budget, `ROOM_CODE_CHARS` / `ROOM_CODE_LEN`), `matchmaking.rs` (the queue, the reveal, leaving, the walk-out, the forfeit), `solo.rs` (`play_bot`), `online.rs` (`players_online`), `live.rs` (the live strip's crossing into the loop) |
| `table/` | one table: `mod.rs` (`Table`, `Seat`, `Occupant`, `MatchRecord`, `Table::dispatch_at_table`, and the seat bookkeeping nothing else may do), `actor.rs` (`TableHandle`, `TableSender`, `TableJob`, `TableCtx`, `Deadlines` / `DeadlineKey`, `run_job`, the published `Phase`), `gameplay.rs`, `presence.rs`, `rematch.rs`, `bots.rs`, `turntimer.rs`, `maploading.rs` (`is_gameplay_msg`), `broadcast.rs` (`broadcast`, `send_hand_growth`, `refuse_action`), `statedto.rs`, `convert.rs` (domain to wire, nothing else), `emotes.rs`, `refusal.rs` (`Refusal`, every refusal string), `room.rs` (`new_room` / `restore_room`, the only ways the hub makes a `loco_game::Room`), `debug.rs` (`debug_set_state`) |
| `ops/` | running the process: `config.rs` (`HubConfig`: `Limits`, `Timings` with `MatchmakingTimings` and `BotTimings`, origins, `NetPolicy`, debug mode), `clock.rs`, `metrics.rs` (`HubMetrics`, the Prometheus exporter), `logsink.rs`, `drain.rs`, `snapshot.rs` |
| root | `ids.rs` (`RoomCode`, `SessionToken`), `tokens.rs` (room codes, session tokens, room seeds from the OS), `testkit.rs` (the socket-level harness, behind the `testkit` feature) |

Tests: one file per subject under `server/crates/loco-hub/tests/`, white-box ones under
`src/internal_tests/`, the bench in `benches/hub.rs`.

**Where a new handler goes**: beside the others answering the same kind of message — a method on
`Table` if it acts on the sender's table (its arm in `dispatch_at_table`, its message in
`table_scoped`), on `HubCore` if it is genuinely between tables (`route`'s match). `hub.rs` stays
readable as *the loop*.

## A table is one object (`table/mod.rs`)
`HubCore::tables` is a `HashMap<RoomCode, TableHandle>`: one entry is one table's whole existence,
so `delete_room` is one `remove`, a reset is `Table::reset_for_next_match`, a removal
`Table::drop_seat`. Everything kept about a seat is one `table::Seat` (`occupant`, `token`, `afk`,
`wants_rematch`) in one `Vec<Seat>`: a removal is `Vec::remove` and a host transfer `Vec::swap`, so
nothing keyed by seat can be left behind on the old index. The recap (`match_history`) is the one
per-seat thing outside `seats`, and `drop_seat` / `swap_seats` re-base it in the same call.

**Who is in a chair is an `Occupant`**: `Human(client)`, `Held { since }`, `Gone`, `Bot`, `Vacant`.
A seat cannot be held and seated at once, and the roster's `connected` is "neither held nor gone" by
construction (`Table::player_list`).

**Seats are `usize` and nobody is `None`.** `i32` (with `-1` for nobody) exists only on the wire
(`loco-protocol`); the hub converts there and nowhere else (`usize::try_from(n).ok()` on the way
in). `MatchRecord::winner` is `Option<usize>`, `null` in the snapshot; the wire's `winner_index`
writes `-1`.

**Add per-table state as a field of `Table`, or of `Seat` if it is per seat, never as something
another task reads.** The two values the hub reads without asking — the phase and the bot count —
are published by the table after every job (`actor::Published`, `TableHandle::phase` /
`bots_hint`), never computed by the reader. An absent value carries meaning: `None`
`turn_started_at` is "no turn timed", `None` `matchmade_at` "a player opened this", `None` `loading`
"the table is open", and the empty room is whether the `RoomCleanup` deadline is armed
(`Table::cleanup_pending`).

**`Table::seat` sweeps a client out of every other chair**, and `HubCore::seat_into` /
`Table::seat_client` ask the table it was at before to sweep it too (a `sweep_old_seat` job).
`HubCore::already_seated` still refuses first, which answers the client politely; the sweep is what
makes "one player receiving another's hand" structurally unreachable.
`src/internal_tests/table_internal.rs` (`seat_client_leaves_no_pointer_behind`) owns the invariant,
`tests/seat_rebind.rs` the refusal.

## One table, one task (`table/actor.rs`)
A table owns its own tokio task; the hub owns what is between tables (the map, the queue, the
sockets, the wrong-code budgets, the drain).

**The task owns its `Table` outright, behind an `mpsc` of `TABLE_BOX_DEPTH` (64).** The `Table` is
moved into the task, so a second reader is a type error; nothing is locked. Stopping a table hands
its state back (`TableHandle::stop` returns the `Table`), which is how the snapshot reads every table
at one instant.

**Bought for isolation, not throughput.** One table's slowest message is never every other
table's wait, and one handler's panic is contained to its table. In a game decided by arrival order,
a queue shared between strangers' tables is a fairness question first.

**Both directions are non-blocking, the same shape**: `TableSender::post(job)` (run this on that
table) and `Hub::post_to_router(what, fn)` (run this on the hub), both `try_send`. **A blocking send
in either direction deadlocks the moment the other end sends back.** A full box hands the job back;
what cannot be delivered is dropped and counted, and the crossings where a drop would leak something
retry the same job once after `ROUTER_RETRY` (1s): `TableSender::post_critical` and every
`post_to_router`. `channel_retries` counts them.

**A job is a boxed closure** (`TableJob`, `FnOnce(&mut Table, &TableCtx)`) with a name for the log
and, for a player's message, the `Client` it came from. A command enum was considered and rejected:
the job set is open-ended and a closure carries exactly its handler's arguments.

The rules that hold the split together:

- **Routed by the hub, re-checked by the table.** `dispatch::route` resolves the table from the
  sender's seat and posts; `dispatch_at_table` re-reads that seat and returns if it no longer names
  this table — between the two the seat can have been given up, held or re-based. That is why a
  socket's seat is **one value** (`Client::seat`, an `Option<SeatRef>` of code plus index behind one
  lock), never two fields written in pairs.
- **A table is started when the hub has finished filling it in.** `HubCore::new_table` (or
  `Table::new`) builds, `HubCore::open_table` starts the task, and every construction path
  (`create_room`, a pairing, `play_bot`, a restore) writes in between.
- **Deleting a table removes it and stops it in one step on the loop.** `HubCore::delete_room`
  removes the map entry, signals the stop and awaits the task on a spawned task, so the loop never
  waits. The job the task may be inside finishes (a job is synchronous, never cut in half); **after it
  the task runs nothing** — the `select!` is biased towards the stop and `actor::run` checks it before
  each deadline of a batch. `internal_tests/lifecycle.rs::a_deleted_table_runs_nothing_after_the_job_it_was_in`.
- **A job that must be a table's first is handed to the task, never posted**
  (`HubCore::open_table_with(table, Some(job))` → `TableHandle::start`, which runs it before reading
  the box). The solo deal uses it. `tests/funnels.rs::no_post_result_is_thrown_away` fails on a
  `let _ =` in front of a post.
- **A panic is caught on the table too** (`actor::run_job`, `catch_unwind` per job, `panic =
  "unwind"` in the release profile). An uncaught one would not fail the table, it would silence it
  for ever. Caught, it costs one `WARN handler panic recovered`, `handler_panics`, and `server error`
  to the sender.

`one_slow_table_does_not_hold_up_another` (`tests/actor.rs`) is the split in one assertion;
`table_panic_costs_one_message_not_the_table` is the last rule.

**What stays on the hub.** `create_room` allocates against `max_rooms`. `join_room` spends the
wrong-code budget and looks the code up, then hands the rest to the table (`Table::join_at_table`),
which makes two people typing the same code at once a queue, not a race for the last chair.
`find_match`, `play_bot` and `leave_room` are split: the queue is the hub's, the seat the table's,
and the two halves are **ordered** (the table releases the seat, then posts the enqueue back), since
being in a room and in the queue at once is a state neither side can recover from.

### Deadlines live in the table's state
A deadline is an entry in `Table::deadlines` (`actor::Deadlines`), keyed by `DeadlineKey`, and the
task sleeps until the soonest inside the same `select!` that reads its mailbox. A due deadline runs
as a job through `run_job`. `DeadlineKey` is an enum: `TurnTimeout`, `MapLoadTimeout`,
`RoomCleanup`, `MatchmakingReveal`, `MatchmakingRevealBackstop`, `BotInterrupt`, `BotInterruptHeld`
for the whole table; `BotMove(seat)`, `BotUno(seat)`, `BotCatch(seat)` per seat; and
`ReconnectExpiry(seq)`. `DeadlineKey::name` is its label in the log.

**Arming a key replaces what was armed under it, and the paths that end a wait disarm it**:
`Table::seat` disarms the cleanup, opening the gate disarms its timeout, a new turn re-arms the turn
clock, a rematch re-arms the reveal, `reset_for_next_match` clears them all. So a fire is never
stale; **what it still checks is state that can move without a re-arm**: the match ending, a fixture
rewriting the turn, a window closing, a seat no longer being a bot.

**A reconnect hold takes a unique key** (`Table::reconnect_key`, a sequence per table), because its
seat number can be re-based by another seat leaving; the expiry finds its hold by the instant it began
(`held_seat_at`). Two holds never replace each other.

A deadline cannot be dropped by a full box: it is not posted anywhere.

### One clock (`ops/clock.rs`)
The domain takes `now: Millis` and the wire carries absolute server instants, while a table sleeps
on `tokio::time::Instant`. Read from two clocks they drift apart under `tokio::time::pause`, so the
unix milliseconds are derived from tokio's clock, anchored once per process (`now_ms`, `ms_of`,
`instant_of`), and a paused test moves catch windows and deadlines together.

**The anchor keeps the wall clock to the nanosecond**: rounding it to the millisecond let a
`server_now` be stamped earlier than the request it answered
(`a_reading_is_never_behind_the_wall_clock_it_was_anchored_on`). `system_now` keeps sub-millisecond
precision too, so a match opened and won inside one millisecond still measures 1 ms (zero is "cannot
say").

### What a message costs, measured
`server/crates/loco-hub/benches/hub.rs` (criterion, `make bench-server`, outside CI) drives a
`Table` through `dispatch_at_table` with detached clients (`Client::detached`,
`TableCtx::detached`), so it measures the hub and not the kernel. Release profile, a 16-thread
desktop:

| One job | 2 / 4 / 10 seats |
| --- | --- |
| `dispatch(play_card)` end to end | 0.81 / 1.30 / 1.70 µs |
| `broadcast_card_played` alone | 0.60 / 1.01 / 1.45 µs |
| `broadcast_personalized_game_state` (Swap / GlobalSwitch) | 2.69 / 6.08 / 21.9 µs |
| `player_game_state_using`, one recipient (10 seats) | 0.82 µs |
| a log line through the async sink | 0.04 µs |

(Ten seats is above the 7-seat cap and stands as an upper bound.) What the server *admits* is bounded
lower: `max_clients` (5000) × 10 msg/s = 50 000 msg/s, far under what one thread absorbs at 1.7 µs.
The rate limiter, not the loop, is the ceiling, and every number above is three orders of magnitude
under the network round trip that decides an interrupt race. **Argue about scaling from these numbers,
not from an intuition about loops.**

## What bounds this server, and how it is measured
`/metrics` shows the approach to a backlog, not only the crossing:

- `loop_queue_depth` / `loop_queue_capacity`: the **hub's** inbound queue right now (`INBOUND_DEPTH`,
  256). Every message passes through it; most only pass.
- `loop_slowest_us`: the longest single job **anywhere**, timed on the table that ran it
  (`actor::run`, `HubMetrics::note_event`).
- `loop_queue_peak`: the deepest any **table's** box has been.
- `loop_events`: the denominator.

The last two are **high-water marks since startup, never reset or averaged** (a mean hides the one
slow pass that let a queue build), raised with `fetch_max` (`metrics::raise32` / `raise64`), never
load-then-store: two tables storing over the same old maximum lose the higher one, silently.

**A peak is not a reason to shard.** Look at `loop_slowest_us` first: a job taking milliseconds is a
handler doing something it should not, typically a broadcast serialising per recipient.

## One message must never be able to cost the server
`dispatch::dispatch` wraps every inbound message in `catch_unwind`, and `Table::dispatch_at_table`
refuses every gameplay message at a table that has not dealt. Floor and wall, not one fix twice.

The threat: a room's state is absent in a lobby and after a rematch, and any handler that sizes a
hand before validating is two frames from an unauthenticated stranger
(`connect /ws → create_room → draw_card`; a missing `Origin` is allowed, so no browser is needed).

- The **gate** (`is_gameplay_msg`, then `room.state` present, `room.status == Playing`, and the
  sender's seat an index into `state.hands`) fixes the class, not individual handlers: the next
  handler that reads state before validating is covered without anybody remembering. It answers
  `game not in progress` (`Refusal::GameNotInProgress`). Four domain entry points index a hand by
  seat on the way in; one comparison here closes that class too.
- The **catch** bounds what the gate does not anticipate, on the hub (`dispatch`) and on each table
  (`run_job`): one `WARN handler panic recovered` (message type, connection, seat, panic text), one
  `server error` to the sender, `handler_panics`. **It is not a licence to skip a bounds check**:
  `Table::player_game_state_with` answers a missing state, a seat out of range or an empty discard
  with a minimal state and a `WARN`, and every handler is held to that.

`tests/hardening.rs`: `gameplay_message_in_lobby_is_refused`, and
`dispatch_panic_does_not_kill_the_hub`, which panics on demand through the test probes
(`Hub::set_dispatch_probe`, `Hub::set_table_probe`). `handler_panics` above zero is a bug.

**Decoding happens in the read pump.** A frame is decoded into `loco_protocol::ClientMsg` there, so
an unknown type, colour, kind, format or emote never reaches a handler. `wire::decode_client` maps a
failure onto its wire string (`unknown message type`, `unknown color: "x"`, `unknown kind: "x"`,
`invalid match format …`, `unknown emote`), anything else `invalid message format`.

## Ceilings: what stops an abusive client being an unbounded one
The token bucket bounds one socket's rate, not how many sockets or tables exist, and a table
outlives its connection by `empty_room_timeout` (5 min). Four fields of `config::Limits`, generous on
purpose — they make the abusive case terminate, they do not shape the legitimate one. **Reaching one
in production is a signal to read the logs, not a number to lower.**

| Knob | Default | Refused where | Answer |
| --- | --- | --- | --- |
| `max_clients` | 5000 | `serve_ws`, before the upgrade | HTTP 429 |
| `max_conns_per_net` | 64 | `serve_ws`, before the upgrade | HTTP 429 |
| `max_rooms` | 2000 | `handle_create_room`, `open_solo_table` | `the server is full, try again in a moment` |
| `max_failed_joins` | 20 / min / network | `handle_join_room` | `too many attempts, wait a moment` |

- **Admission is decided before the upgrade** (`serve::admit`), against its own counter, never the
  `clients` metric the loop maintains: the gap between upgrade and register is exactly where a flood
  lives. A refused connection never costs an upgraded socket, a 256-slot buffer and two pumps. 429
  rather than a close, so a refusal is distinguishable from a network failure.
- **The admission slot is a value** (`AdmissionSlot`), given back exactly once: by the hub on
  unregister, or by drop when the upgrade never completed. A hand-written decrement on every early
  return drifts upwards until the ceiling is reached by nobody.
- **The room cap is on `create_room` and `play_bot`**, the messages that allocate something
  outliving the connection.
- `max_conns_per_net` is keyed by the same truncated prefix the logs use (`/24`, `/48`). 64 covers a
  household, a LAN party or an office.

**The pumps start only once the hub has registered the client** (a `oneshot` the loop fires after the
insert), so an unregister can never be processed before its register.

### Which network
In production the TCP peer is always the nginx container (browser → Cloudflare → Traefik → nginx →
here). Read directly, `max_conns_per_net` becomes a site-wide cap of 64 sockets, `max_failed_joins`
becomes global, and every `addr=` is a constant — all failing quietly.

So the network is decided once, by `NetPolicy::client_net` (`net/privacy.rs`, through the `ClientNet`
extractor), and kept on `Client::net_key`, which admission, the join budget and `Client::net_prefix`
all use. It reads `client_ip_headers` in order — `CF-Connecting-IP`, then `X-Real-IP`
(`LOCO_CLIENT_IP_HEADERS`) — **only from a trusted peer** (`trusted_proxies` /
`LOCO_TRUSTED_PROXIES`, default loopback and private ranges; the server `expose`s 8080 on
`internal` only, so nginx is the only peer that can reach it).

**Two headers because production has two paths, and one player uses both.** The page goes through the
CDN, which sets `CF-Connecting-IP`; the socket is dialled outside it, where Traefik overwrites
`X-Real-IP`. **The order is a security property**: on the proxied path a client can invent an
`X-Real-IP` the CDN forwards, so the header the CDN controls is read first
(`client_net_prefers_the_header_the_proxy_sets`).

It refuses to believe, falling back to the peer:
- a header from an untrusted peer;
- a multi-value header, a comma list or a repeated line (`HeaderMap::get_all`) — which is why the
  default is not `X-Forwarded-For`, whose leftmost entry the client writes
  (`client_net_refuses_a_repeated_header`);
- an unparseable or empty value;
- an address no browser on the internet could have (`is_routable_client`: loopback, private,
  link-local, multicast, unspecified, either family, through a v6 mapping). A forged *private* address
  could be aimed at the proxy's own fallback bucket and refuse everybody else at the upgrade
  (`client_net_ignores_a_forwarded_address_no_browser_could_have`).

The forwarded address is truncated on the way in like every other. IPv6 arrives as IPv6 and is cut to
`/48`; Cloudflare's Pseudo IPv4 is not needed.

### The header a host may forward is the host's to declare
`client/ws-proxy.conf` is included by both server blocks, but `ws.` is grey-clouded by design, so
nothing on that path sets or strips `CF-Connecting-IP`: forwarding it there would let a client write
its own network key on every socket and void every per-network ceiling, the wrong-code budget
included. So each server block `set`s `$loco_cf_ip` / `$loco_real_ip` to the one header its path
guarantees and `""` for the other (an empty value omits the header): the site's host vouches for
`CF-Connecting-IP`, `ws.` for `X-Real-IP`. `client/src/test/csp.test.ts` pins the variables, both
`set` pairs and the absence of any `$http_` on those lines.

**Residual, and not this repository's to close**: Traefik is public, so anyone who finds the origin
address can reach the site's vhost directly and write a `CF-Connecting-IP` it vouches for. The fix is
an allowlist of Cloudflare's ranges on the host Traefik's `websecure` entrypoint.

`conns_refused` is a load signal, not an incident, until it climbs.

## A wrong table code costs something
A code is 6 characters of a 32-symbol alphabet (≈1.07e9), large for finding *one* table and walkable
for finding *any* on a busy server. `max_failed_joins` wrong codes per network per minute
(`HubCore::join_budgets`, `join_throttled`, `note_failed_join`), then `join_room` is refused **before
the lookup**, so a throttled network learns nothing. Charged: a string that is not a code, a code no
table holds, and a join at a table in progress that is not a valid reclaim (posted back as
`failed_join`). Keyed by network because a sweeper reconnects between attempts. The map is swept when
it passes `MAX_JOIN_BUDGETS` (4096). `one_mistyped_code_does_not_lock_a_player_out`.

**The code is a type** (`ids::RoomCode`): parsed once at `join_room` by `RoomCode::parse` (exactly
`ROOM_CODE_LEN` characters of `ROOM_CODE_CHARS` in `router/rooms.rs`, either case, upper-cased);
`RoomCode::from_trusted` is for codes this server minted. `tokens::generate_code` spells the alphabet
too; `the_code_rule_is_the_generator_s` holds the two together and `client/src/test/serverSource.ts`
reads both to pin the client mirror.

## The reclaim refusal names nothing
`join_room` at a table in progress answers `game already in progress`
(`Refusal::GameAlreadyInProgress`, from `Table::join_at_table`) whether or not the nickname matches a
held seat: a separate "invalid token" answer would let anybody with a code test names against the
roster, and a returning client already handles a failed reclaim through its own restore timeout.
`i18n/serverErrors.ts` keeps an `invalid session token` rule as a fallback.
`reclaim_refusal_reveals_nothing_about_the_roster` (`tests/hardening.rs`).

## Anti-cheat
Defend against: illegal cards, turn spoofing, hidden-state manipulation, replay, forged
reactions/declarations, duplicate spam, tampered hands, client win claims. Posture: validate every
message, keep hidden state server-side, ignore client timestamps for outcomes, server outcomes final,
OS-random session tokens, per-client rate limit (10 msg/s, burst 20).

Replay protection is implicit: no nonce, but every handler validates against the current state, so a
replayed message fails once the state has moved. Identity (seat, table) is server-assigned, never read
from the message.

**Every refusal is a `table::refusal::Refusal`**, whose `Display` is the wire string; a domain refusal
travels as its `GameError` through `From<GameError>`, and the few built from a value are
`Refusal::Other`. `Client::refuse` is the single funnel, which is what lets the dispatch boundary
count refusals. **A new refusal goes in `client/src/i18n/serverErrors.ts` in the same change.**

- **The upgrade checks `Origin`** (`serve::origin_allowed`). No login or cookie means a cross-site
  socket has nothing to borrow, but an unrestricted upgrade is a free room-creation and flood endpoint
  from anybody's page. Default: **hostnames must match, ports need not** (works in dev, Vite :5173 and
  server :8080). `LOCO_ALLOWED_ORIGINS` (comma-separated, `HubConfig::allowed_origins`) replaces it
  with an exact allowlist. A missing `Origin` is allowed; a refused one is HTTP 403.
  **In production `LOCO_ALLOWED_ORIGINS` is mandatory**: the page is on `ohloco.com` and the socket on
  `ws.ohloco.com`, so the default refuses every upgrade, which the client cannot tell from the server
  being down. It names **the page's origin, never the socket's**. `write_app_env` in `.gitlab-ci.yml`
  writes `https://${APP_HOST}`; `deploy/app.env` is the shape.
- **nginx sends the security headers** (`client/security-headers.conf`, `include`d wherever a
  `location` declares its own `add_header`, because `add_header` does not merge — see
  [`testing-ci.md`](testing-ci.md)): a closed CSP, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  `script-src` has no `'unsafe-inline'`; `style-src` must (the build inlines stylesheets and the board
  writes a `style` attribute per card). `connect-src` names `ws://$http_host` and `wss://$http_host`,
  since `'self'` does not cover a `ws:` scheme.
- **A socket holds one seat, and the table is the authority on which.** The seat is recorded on the
  connection (`Client::seat`) and on the table (`Occupant::Human` at that index). A seated client
  sending `create_room` or `join_room` again must not move only the connection's copy, or every
  personalised broadcast at the old table would be built for the wrong index and hand that player
  another seat's hand. `Table::seat` makes it unreachable and `HubCore::already_seated` answers it, on
  `create_room`, `join_room`, `find_match` and `play_bot`. Reconnects arrive on a fresh socket and are
  untouched; a client whose room was deleted is released (`Client::leave_seat`), never locked out.
  **A personalised send indexes by slot**, never by the client's own idea of its seat: every fan-out
  is `for (seat, m) in self.clients()`. `tests/seat_rebind.rs` goes through a Swap, the path that would
  leak.
- **Room codes and session tokens come from the OS, with no fallback** (`tokens.rs`, `OsRng`). With
  no login, the six characters *are* the access control on a private table, and a deterministic
  generator's output would let an attacker creating rooms in a loop infer the codes handed to others.
  `tokens::rand_index` uses mask-and-retry, uniform for any alphabet. An OS that cannot produce
  entropy panics (`os_fill`) rather than degrade; the job's `catch_unwind` turns it into a refused
  message. The bots' jitter and choices use `rand`'s thread RNG, which decides no hidden state.
- **The room's own RNG is OS-seeded too, because the deal is the hidden state.** One seeded source
  decides the map, the starting seat and the order of all 112 cards for every round; a clock seed is a
  window of a few million candidates, and the map, starting seat and your own eight cards filter it
  to one — every opponent's hand and every later deal, computable offline. **A `loco_game::Room` is a
  ChaCha generator seeded with 32 OS bytes** (`table/room.rs: new_room` → `tokens::room_seed` →
  `Room::new(code, seed)`); the domain cannot read the OS, so the hub draws the seed. **The RNG never
  travels**: the snapshot holds a `loco_game::SavedRoom` and `SavedRoom::restore` takes fresh OS
  bytes (`restore_room`). `server/crates/loco-game/src/tests/rng_test.rs` **runs the attack**
  (brackets the constructor, replays every nanosecond in the window) with a planted clock seed as a
  positive control, so a replay that drifted out of step cannot pass for ever.
  **`Deck::replenish` takes the room's source** (`Room::rng_mut`): the replenished pile is the second
  half of a long round, and predicting its order predicts the rest of it.
  `replenish_uses_the_rooms_own_source` (`deck_test.rs`).
- **A refused message must never be cheaper than an accepted one.** The server is tight on what it
  *lets* a client do; this prices what a client gets for a message the server turns *down*.
  - **The AFK counter resets after the handler, and only if the socket was not refused**
    (`Client::refusals` read as a before/after pair in `dispatch_at_table`). Reset before, a seat on
    eight cards sending a refused `declare_uno` each turn was immune to the threshold for ever — and
    in a matchmade room that threshold is the only thing between a stranger and an opponent who
    walked away. Read at the boundary rather than per handler because `Client::refuse` is already the
    single funnel. **A gameplay message answered by nobody is a refusal too**: a Contre-LOCO! where
    nothing is offered, inside the caller's lockout, or already charged for this offer calls
    `Client::refuse_silently`, which counts without answering, or a held catch button would be the
    same immunity. `catch_uno_silent_refusals_are_counted_as_refusals`
    (`src/internal_tests/catch_afk_internal.rs`).
  - **A Contre-LOCO! is charged at most once per offer** (the domain's `catch_offer_key`, remembered
    as `SeatState.catch_paid_for`): every press after that draws nothing, broadcasts nothing and
    answers nobody, so ten messages a second buy exactly one `catch_failed`. A press where nothing is
    offered is the same silence — charging it would be a card farm for a forged message, answering it
    would scold a player whose button was live a moment ago. `Table::penalize_failed_catch` sends a
    charge that drew nothing (empty piles) to its caller alone. A `target_index` the table does not
    have, negative or past the end, is refused and counted toward `suspected_cheats`: no client of
    ours composes it. Rules: [`domain-rules.md`](domain-rules.md), "Both ways to lose".
  - **Nothing holds a press back.** `handle_catch_uno` reaches its verdict on arrival; the ration
    above answers a mashed button without costing an honest press anything.
  - **`rematch` is idempotent on the wire too**: an ask already in the set broadcasts nothing (like a
    duplicate `map_ready`).
  - **A stale-state correction is throttled** to one per `resync_period` (1s per socket,
    `Client::claim_resync`): it is the most expensive message the server sends, and the first one
    corrects the drift. `resync_is_throttled_to_one_per_second`.
- **A refused action is not automatically suspicious.** A refusal's class is `GameError::kind()`:
  `LostRace` names what a correct client produces all match (a second draw, a pass that raced its
  draw, an interject whose window closed or whose top card changed, a call inside the lockout),
  `MissedCatch` a lost wager; `ErrorKind::is_honest()` is both. `Client::note_rejection` skips those
  and otherwise calls `note_suspect`. Counting lost races would make `suspected_cheats` rise fastest at
  the busiest tables.

## The nickname
`server/crates/loco-game/src/nickname.rs`, called by `HubCore::validate_nickname` on the four ways
into a seat (`create_room`, `join_room`, `find_match`, `play_bot`). The client mirrors the shape
rules for instant feedback and is trusted for nothing.

**One refusal, whatever fired.** `NicknameLength`, `NicknameCharset` and `NicknameBlocked` (all
`ErrorKind::NicknameRejected`) reach the wire as `nickname not allowed`; the specific error is kept for
the log and the tests. A refusal naming its rule teaches the next attempt. The client shows the same
line for the shapes it refuses itself.

**Length is in characters**: `NICKNAME_MAX_RUNES = 20`, on the canonical form, so "Étienne" and a
Cyrillic name cost what they look like.

**The charset is an allowlist**: Latin, Greek or Cyrillic letters, ASCII digits, one space between
words, and `-_.'`. That one rule excludes zero-width characters, bidi overrides (`U+202E`, which can
make a name read as somebody else's), control characters, emoji and the Mathematical Alphanumeric
block (styled letters that render as words). At most one combining mark per base letter (Zalgo
paints over the seat above and is unreadable at 720p). At least one letter or digit.

**Normalisation keeps the list short**: diacritics stripped (both precomposed and decomposed),
lower-cased, leet undone (`0o 1i 3e 4a 5s 7t @a $s !i +t |i`, deliberately conservative — `2` is
absent), separators dropped (`f.u.c.k`), and a second pass squeezing repeats. The squeezed form is
matched against the terms **as written**, never a squeezed list (which would turn a slur into a
country).

**The words are vendored** (`server/crates/loco-game/wordlists/`, Shutterstock's LDNOOBW, CC BY 4.0,
19 Latin/Greek/Cyrillic languages, `include_str!`): a lookup at seat time with nothing that can fail
at 3am. Refresh by `curl` into the directory and a test run; attribution in `NOTICE.md`.

**Applied so it does not refuse a phone book:**
1. The whole nickname and every token are matched; tokens are cut on separators, digit boundaries and
   lower→upper transitions, so `Xx_Salope_xX` and `xXsalopeXx` both yield the word.
2. **Substring matching only for terms of 6 characters or more** (`SUBSTRING_MIN_LEN`). This is the
   false-positive control: short entries live inside Cassandra, Constance, Dickson, Scatena. The cost
   (`xxfuckxx` passes) is accepted — refusing somebody their own name is the worse failure, and nobody
   reports it, they leave.
3. `NICKNAME_ALLOW_SEED` covers what rule 2 still catches (Scunthorpe, Penistone, Cockburn, Niger,
   Nigeria), whole nickname only. An *allow* list on purpose: a missing entry is a complaint, never a
   slur on a stream.

**None of this is stored.** A nickname lives in the `Room` for the match; the only thing that writes
it is the deploy snapshot (matches in flight, deleted as read, dropped past its age). Adding storage
would be a legal change (`docs/notes/legal.md`), not a feature.

## A refusal that proves a drift carries the correction
`Table::refuse_action(cx, c, err)` (`table/broadcast.rs`) is the single exit for a rejected gameplay
message: the refusal, `note_rejection`, and when `err.kind() == ErrorKind::StaleState` a personalised
`game_state` to that client. Used by `handle_play_card`, `handle_draw_card`, `handle_pass_turn`,
`handle_counter_draw`, `handle_interrupt_play`.

- Without it a drifted client keeps offering an action its own copy says is legal and is refused for
  ever. Server authority means the server ends that argument.
- `ErrorKind::StaleState` (`server/crates/loco-game/src/error.rs`) covers `NotYourTurn`,
  `IllegalPlay`, `CardNotInHand`, `MustAnswerPenalty` and the batch's `NotEnoughCopies`. The class is
  the variant's, not its text's.
- **A lost race is deliberately not one of them**: the client's board was right, it was beaten, and a
  snapshot would be the most expensive message at the busiest moment. `tests/resync.rs`:
  `play_card_illegal_play_resyncs_the_client` and `interrupt_lost_race_does_not_resync`.
- Logged as `state resync conn=… player=… reason=…` (the span adds `code=`).

## 1v1 matchmaking
`router/matchmaking.rs`: one FIFO queue (`HubCore::queue`), a pairing rule, and timings of its own
(`config::MatchmakingTimings`).

- **The queue's size never reaches a client.** `matchmaking_queued` is an empty acknowledgement; the
  number is on `/metrics` only (`matchmaking_queue`). A screen that could say "1 player searching"
  would say it exactly while the queue is filling, and it reads as an instruction to leave. The client
  times its own wait (`Searching.svelte`).
- **`players_online` is a different number** (`router/online.rs`): every socket the process holds,
  sent on registration and then only when the count moves, only to sockets not at a table. It answers
  "are the lights on", not "how long until I am paired". The floor of two is the client's
  (`game/playersOnline.ts`).
  - **What each socket was last told is per socket** (`Client::online_sent`): a hub-wide watermark
    would skip a player just back from a table on a server where the count rarely moves.
  - **A tick that changes nothing sends nothing.** The tick (`players_online_period`, 5s) is an
    interval inside the hub's `select!`, which is what makes reading `HubCore::clients` safe.
  - The message answers nothing and can land before any reply, so `testkit.rs`'s `read_msg` skips it;
    `tests/online.rs` uses `read_raw`.
- **Nobody presses start.** `pair_match` builds the table, seats both, sends `match_found` with
  `starts_in_ms` and a fresh token each (`announce_match_found`), arms the reveal
  (`schedule_matchmaking_start`, `reveal_delay` 2.5s), then opens the table.
  `handle_matchmaking_start` checks it is still a matchmade lobby and calls `start_match` (sharing
  `deal_match` with `start_game`). If one of the pair vanished, `requeue_survivor` tears the room down
  and requeues the other.
- **That deal is armed twice** (`MatchmakingReveal` and `MatchmakingRevealBackstop`,
  `reveal_backstop` 3s after). A lost deal would leave a matchmade lobby publishing `InFlight` for
  the life of the process, so every later drain would burn its whole timeout. It costs one key and
  the second fire is a no-op (the table is no longer a lobby). A rematch re-arms both.
  `matchmaking_the_reveal_backstop_does_not_deal_twice`.
- **A seat is held through the versus reveal and reclaimed like a match seat**
  (`disconnect_at_table`): the client persists `matchfound` as `game` and reclaims with the token.
  `join_at_table` takes the reclaim branch at a matchmade table at every status (it is never joinable
  by code), `handle_matchmaking_start` deals with a held seat counted present, and the seat's 15s
  clock forfeits if nobody returns. Nobody connected at all is torn down. `match_history_dto` never
  serialises a column set as `null`. `matchmaking_reload_during_the_reveal_keeps_the_seat`,
  `matchmaking_reload_during_rematch_reveal_keeps_the_recap` (`tests/audit_fixes.rs`).
- **A matchmade room has no host**, nor has a solo game: `handle_add_bot`, `handle_start_game`,
  `handle_set_match_format`, `handle_set_max_players`, `handle_set_streamer_mode`,
  `handle_kick_player` and `handle_transfer_host` begin with `Table::refuse_without_host`
  (`Table::hostless`, `not available in this game`). The format is fixed at BO1
  (`MATCHMAKING_FORMAT`: the queue is for playing *now*, and a single round is what two strangers
  least abandon) and the size at two. `handle_rematch` is not among them.
- **Two strangers may share a nickname**: `unique_nickname` disambiguates the second (`Alex (2)`),
  trimming the base to 16 characters first.
- **Disconnecting leaves the queue** (`HubCore::handle_disconnect` calls `dequeue` first).

## The 1v1 against the server (`play_bot`)
The queue's experience without the queue: a nickname, one press, a hand. It is what the searching
screen offers when the wait may not end; "open a table" is three screens and a code.

- **Not "open a table and add a bot".** `router/solo.rs`, `HubCore::open_solo_table`: no code, no
  waiting room, no host controls, no configuration. `SOLO_FORMAT` is BO1.
- **Hostless like a matchmade table** (`Table::solo` → `hostless`), **without the matchmade timing**:
  the 15s hold and two-timeout threshold exist because a stranger will not wait, and the opponent here
  is the server. Reconnect, drain and snapshot treat it as any table in progress; `solo` travels in
  `RoomSnapshot` so a restore does not offer host controls.
- **The deal carries the identity**: there is no screen before the board, so `game_started` carries
  `room_code`, `player_id` and `session_token` (`Table::deal_solo_match`, the table's first job). The
  client recognises a solo deal by exactly that.
- **`rematch` is refused here and only here**: the quorum would be one. Another game is another
  `play_bot`, which releases the finished seat first (`play_bot_release`), as `find_match` does.
- **It touches nothing the queue owns** (no `HubCore::queue`, `matchmaking_queue`,
  `matches_matchmade`): the queue is the one server-global the E2E suite serialises around
  (`helpers/matchmakingQueue.ts`). `/metrics` has `matches_solo` instead.

## Leaving a match in progress
`HubCore::handle_leave_room` / `Table::leave_at_table`, `Table::can_walk_out` +
`Room::retire_seat`. **Leaving is refused nowhere; the table decides what the departure does.** The
alternative exit — stop pressing and let the clock auto-play until the AFK threshold — costs everybody
else about two rounds of watching an empty chair.

`leave_at_table`, in order:
- **A matchmade match forfeits.**
- **A solo game or an abandoned match closes the table** (`Table::abandoned_by`): nothing will act
  there again, and `remaining_seat` would hand a forfeit to a bot or an absent player.
- **Above the floor the round carries on** (`can_walk_out`, then `retire_seat`). `playable_seats`
  counts a bot, or a human present or inside their window, not retired.
- **At or below it the match goes to the seat that stayed**, announced as a forfeit, scoreboard
  untouched.

Details:
- **`WALK_OUT_FLOOR` is 2**: what a match needs to stay a match. `can_walk_out` asks whether the seats
  left *after* this one would still be at it, **once, at the ask**; a later disconnect re-decides
  nothing.
- **The seat is retired, not removed** (hands, scores, rounds won and turn order are indexed by it):
  `Table::mark_gone` records `Occupant::Gone`, the hand is shuffled back into the deck, the turn steps
  over it, a Global Switch leaves it out, the biggest-loser rule and a Swap never pick it, it is dealt
  nothing more. A pending draw stack aimed at it dies with it.
- **The scoreboard is left exactly as it stood**: leaving neither wins nor loses, so a seat that had
  banked enough rounds can still take the match on the tiebreak chain.
- **The token is spent** (`mark_gone(seat, true)`); there is nothing to come back to.
- **The seats that stay are told, by name** (`player_left` carries nickname and seat): held and gone
  are both `connected: false`, and the roster alone cannot explain a shortened turn order.
- The control is the client's chip in the chrome row, never on the action bar ([`visual.md`](visual.md),
  [`client.md`](client.md)).

## The host's stream is the table's business
`Table::handle_set_streamer_mode` is the one place a *presentation* preference crosses the protocol.
A table code is one string everybody at the table sees, so blurring only the host's copy protects the
one screen that was already careful.

- **Host only, hostless never** (`only the host can change streamer mode`; matchmade and solo tables
  show no code and are refused by `refuse_without_host`).
- **Every status**: it changes nothing about the match, and the match is what is captured. So it does
  not ride `lobby_config_changed`.
- **A state, not a toggle**: a toggle sent from a client one message behind means the opposite.
- **A repeat is answered by nobody** (a broadcast that changes nothing is free traffic to every seat).
- **It outlives the match** (`Table::streamer_mode`, untouched by `reset_for_next_match`) and rides
  the drain snapshot.
- **Three places carry it**: `streamer_mode_changed`, `room_joined`, and every `GameStateDTO`.
  `tests/streamermode.rs` pins each.

## Freeing a seat somebody else is in
`Table::handle_kick_player`, the one host control that acts on a person, so the strictest.

- **Host only, lobby only, never seat 0** (a target of 0 is `invalid player index`; the host leaves
  with `leave_room`). In a match the refusal is `can only remove players in the lobby`.
- **The work is `Table::release_seat`**, the same bookkeeping as `leave_room` and a lobby disconnect
  (`reindex_lobby_disconnect`), so the three cannot drift. The removed client gets `kicked` on its own
  socket instead of a `player_left` about itself.
- **A bot is a seat like any other**, removed through `remove_unmanned_seat`, which re-bases exactly
  what the human path does. There is no `remove_bot`.
- **Not a ban, and it must not become one**: the code is in their hands, there is no account, and an
  address is the only handle left — never storing one is the privacy position. A mistaken press costs
  nothing; the player sits back down.
- The client asks first (both items of the row's ⋯ ask); see [`client.md`](client.md).

## Handing the table over
`Table::handle_transfer_host`. The host is seat 0 and nothing else, so this is a swap of two seats,
not a flag: every `player_id() != 0` check and the roster badge follow on their own.

- **`Room::swap_lobby_players` + `Table::swap_seats`**, seat for seat, and because a `Seat` carries
  its token, **the token travels with the player** — left behind it would hand a reloading player the
  host's seat. `transfer_host_the_token_follows_the_player`.
- **A swap, not a move to the front**: exactly two seats move.
- **Lobby only, never to a bot, never to seat 0, never in a matchmade room.** In a match a swap would
  swap hands (`swap_lobby_players` refuses a finished room); a bot cannot press start (`a bot cannot
  host the table`).
- **`host_changed` is per recipient**, like `rematch_started`: two seats moved, so two players' own
  `player_id` changed. Everybody gets it.
- No server-side confirmation and no refusal for the recipient; the client asks first.

## The three things a player can say
`table/emotes.rs`, `loco_protocol::Emote` (`ALL_EMOTES`). Three fixed emotes, the smallest thing
that lets two strangers say "good game".

- **No free text, ever**: it is a moderation surface, and "we collect nothing" is the compliance
  strategy (`notes/legal.md`).
- **The set is closed and the server's**: an identifier travels, and an unknown one fails decoding in
  the read pump (`unknown emote`, counted by `note_suspect`). The words are the client's (`t.emotes`).
- **Nothing is kept anywhere**: not in the log, the `Room`, the `Table` or the snapshot;
  `table/emotes.rs` holds no state. The client keeps one line per seat and drops them with the match
  — at every door onto and out of the screen (`applyMatchEnd`, `dismissRoundSummary`'s buffered end,
  `applyRematch`, `applyMatchFound` / `applySoloStarted`).
- **Game-over screen only** (`emotes are only for the end of a match`).
- **No per-seat cooldown.** The client replaces a seat's line, so three presses are one pill changing
  its word, and changing your mind ("gg", then "close one") is the gesture. The token bucket bounds
  the traffic.
- **Refusals broadcast nothing.**
- **Never to or from a bot.** The client draws no line for a bot and no emote block at a table where
  every other seat is one (`GameOver.svelte`).

## A rematch by agreement
`Table::handle_rematch` (`table/rematch.rs`). The host's standing covers what a table is before it
deals; whether people want another match is not one of those, so the ask is the same everywhere.

- Any seat sends `rematch` (`Seat::wants_rematch`), **every ask is broadcast** as `rematch_offered`
  (the screen has to be able to say "they are waiting on you"), and the next match deals once
  `rematch_quorum` asks are in.
- **The quorum is two** (`REMATCH_QUORUM`): one offers, another accepts. Every connected human would
  hand a table of five to its slowest reader. Below two connected the quorum is whoever is there
  (`rematch_quorum` clamps to 1..2); bots are not asked, held seats not waited for.
- **Nobody is dropped by that**: `open_rematched_lobby` reopens the room with everyone still seated;
  the quorum decides when, never who.
- **The reopened table is hosted by somebody who asked** (`promote_rematch_host`, off
  `rematch_askers` read *before* the prune and reset): the earliest-seated asker, moved with
  `swap_lobby_players` + `swap_seats` so tokens travel. `keep_host_human` follows. Nothing moves when
  the host asked.
- **`rematch_offered` carries the whole state** (`broadcast_rematch_offers`: `rematch_offers` plus
  `rematch_needed`), never an increment: a departure re-bases seats. The list is nullable because
  empty is an answer.
- **A departure retires that seat's ask.** `release_rematch_offer` runs after the seat has left
  `Table::seats`, so the asks above have already moved with their seats; it republishes and deals if
  what is left has asked. Called from `release_seat` and the finished-table branches of
  `disconnect_at_table` and `handle_expire_reconnect`; a seat merely held at a finished table goes
  through `retire_rematch_offer`, which clears its ask without removing anybody.
- **Two shapes of deal** (`deal_agreed_rematch`): a matchmade rematch goes through the pairing path
  (`start_rematched_match`: another `match_found`, another reveal); an ordinary one is
  `open_rematched_lobby` (`prune_absent_players`, `Room::reset_for_rematch`, promote, per-recipient
  `rematch_started`). Both call `reset_for_next_match`, which clears the deadlines and the loading
  gate — a gate left behind keeps the next match shut for ever.
- Refused in a **matchmade** room once the opponent is gone (`your opponent has left the table`); the
  client requeues. Refused while draining.
- **No timer on an ask**: an unanswered one costs nothing, and leaving retires it.

## Nobody waits for somebody who is not there
Ordinary rooms hold a dropped seat 60s and call a seat away after 4 timeouts: people who came in
together wait for each other. Two strangers will not.

- `Table::reconnect_hold` and `Table::afk_threshold` switch to **15s** and **2** in a matchmade room
  (`MatchmakingTimings`). 15s covers the ordinary hiccup and reload.
- Either expiry calls `Table::forfeit_match` (`Room::forfeit_to` + `match_end { forfeit: true,
  player_index: <the seat that left> }`). **It disarms every deadline the match armed** (turn clock,
  gate, reveal, every bot move and reaction) and keeps the table's own: `RoomCleanup` and the
  `ReconnectExpiry` of a seat still away. `internal_tests/lifecycle.rs::a_forfeit_disarms_what_the_match_armed`.
- **The scoreboard is untouched**: a forfeit is not a win on points.
- **The AFK path forfeits rather than kicks** (a kick would only start the reconnect wait for somebody
  already proven absent); the away player gets `afk_forfeit` first.
- **`leave_room` before the deal** is not a forfeit: `release_seat` frees the seat and the table gets
  `player_left`. Closing the tab would hold the slot instead.
- **A hold running out at an ordinary table is settled where it runs out** (`settle_expired_seat`,
  after the `player_left` naming the seat): above `WALK_OUT_FLOOR` the seat is retired
  (`retire_absent_seat`: `retire_seat` plus a walk-out's bookkeeping, minus the socket and a second
  `player_left`), at or below it the match is forfeited to the seat that stayed, and a table with no
  socket and no hold is left to `close_abandoned_match`. Unsettled, the clock would auto-play an
  absent seat for every remaining round. `remaining_seat` prefers a connected human, then a held one,
  never a retired seat. `tests/expiry_settle.rs`.
- **A table nobody can come back to is closed, not forfeited** (`Table::abandoned_by`: every other
  seat empty or `Gone`, no bot). Away is not gone: while a hold runs, the seat may return.
  `close_abandoned_match` also closes a finished ordinary table on the same terms.
- `forfeit_deadline` rides `player_disconnected` in a matchmade room only
  (`Table::forfeit_deadline_ms`): 15s of frozen board without a number reads as a broken game.

## A seat that is empty has to read as empty
**A hold ends**: the expiry turns the seat into `Occupant::Gone` (`mark_gone`) *before* building the
roster, so the `player_left` carries a roster saying the player is gone (`Table::has_left`). The seat
itself stays until the round ends; `reset_for_next_match` turns every held or gone seat `Vacant`.

**A finished table holds its seats too**: a wifi hiccup between the last card and the rematch button
must not be answered `not in a room`. `disconnect_at_table` holds the seat for the ordinary window,
`retire_rematch_offer` takes its ask out of the quorum without moving anybody, and `join_at_table`
accepts the token reclaim at any table that is not a lobby. The reclaim sends `player_reconnected`
with **no `state`** (a finished room has none; a snapshot built from nothing would put the client back
at an empty board), then the whole `rematch_offered` state. When the hold expires the seat is removed
for real (`remove_lobby_player` + `drop_seat`): a phantom would be dealt a hand next match.

**Two holds at one finished table move together** because a hold is the seat's own
`Occupant::Held { since }`, so it moves when the seat moves. The expiry, armed with a seat number,
finds its hold by the instant it began (`held_seat_at`, the seat number kept as hint and as the
tie-break for a restore, which stamps every seat with one instant), under its own
`ReconnectExpiry` key. `game_over_disconnect_two_holds_rebase_together` (`tests/expiry_settle.rs`).

**Matchmade tables are excluded from that hold**: the survivor's client requeues as soon as the
roster says it is alone, and `handle_rematch` would refuse anyway.

## AFK auto-kick
- `Timings::afk_kick_threshold` (4) consecutive turn timeouts without a voluntary action → kick,
  counted on `Seat::afk`. A matchmade room uses `MatchmakingTimings::afk_threshold` (2) and forfeits.
- Bots exempt. An **accepted** voluntary gameplay action calls `Table::reset_afk`; a refused one does
  not (see "A refused message must never be cheaper than an accepted one").
- Kick: `{type:"error", error:"afk_kicked"}`, then `Client::force_close`; the ordinary reconnect window
  applies.
- **A kick answers the socket, never the turn.** `kick_if_afk` returns true only for the matchmade
  forfeit; an ordinary kick returns false and `handle_turn_timeout` draws and passes for the seat as
  for any empty chair, or the turn would stay on a closed socket for ever. `afk_kick_still_moves_the_turn`
  (`tests/audit_fixes.rs`).
- **A reclaim clears the counter** (`handle_reconnect`).
- **The auto-draw re-arms before it broadcasts** (`auto_draw_on_timeout`): `send_hand_growth` reads
  the deadline off the table, which would otherwise be the one that just ran out.
- Tests change the threshold through their own `HubConfig`; nothing global.

## Bots
- **A refused bot move gives the turn up, never the table** (`Table::bot_recover`): bots are exempt
  from the turn clock, so a refused move that armed nothing would be a dead table. It draws if it has
  not (a draw never fails) and passes otherwise; the pass is the floor.
  `src/internal_tests/botrecover_internal.rs`.
- **After a draw the bot asks `bot_think`, not "is it playable"** (`bot_draw`): the two disagree on a
  legal Swap the bot declines (`bot_swap_pays`), which would loop on `AlreadyDrawn`.
- Added by the host (`add_bot`), named `next_bot_name(room)`: lowest free `Bot1`, `Bot2`, ….
- **A bot never sits in seat 0** (`Table::keep_host_human`). The host is seat 0 and nothing else, so a
  bot there is a table nobody can start. A reload removes a lobby seat (not held), the bot shifts into
  0, and the player rejoins behind it — so the promotion is called from `reindex_lobby_disconnect`
  (leave, kick, dropped socket) **and** `join_at_table` (the reload has nobody to promote at the moment
  the seat goes), plus `open_rematched_lobby`. The move is `remove_lobby_player` + `drop_seat` +
  `join` + `add_bot_seat`: no new way for seats to move. Lobby only; it terminates because each pass
  puts one more bot behind the first human. `lobby_reload_bot_does_not_keep_the_host_seat`,
  `lobby_host_disconnect_bot_never_inherits_the_seat` (`tests/hub.rs`).
- AI: `loco_game::bot_think(state, seat, rng) -> BotAction`, armed as `DeadlineKey::BotMove(seat)` at
  `BotTimings::think` (1200ms) plus up to `jitter_max` (1000ms).
- **Only the think delay is tunable from the environment** (`LOCO_BOT_THINK_MS` /
  `LOCO_BOT_JITTER_MS`, `BotTimings::apply_env` from `HubConfig::from_env`, gated on `LOCO_E2E=1`): it
  is dead time nothing races. Every other bot delay (`catch_delay`, `uno_delay`, `interrupt_delay`,
  `finish_delay`) is a window somebody is meant to win, and shortening it in CI would rewrite the
  verdict of the tests covering it. A malformed or negative value is ignored with a `WARN`.
- **Bots interject** (`loco_game::bot_interrupt(state, seat) -> Option<BotInterruptAction>`,
  `Table::maybe_schedule_bot_interrupt`, `handle_bot_interrupt`), so the signature mechanic runs both
  ways.
  - `bot_interrupt` mirrors the interject's own rules (window open, exact card equality, draw-chain
    restriction, a real colour on every wild, a Swap only when it pays). **One card, however many
    copies** (`docs/rules.md` §6.8).
  - Armed **only after a human action** (`handle_play_card`, `handle_counter_draw`,
    `handle_interrupt_play`), so a table of bots does not trade cards with nobody watching.
  - **One deadline per play, not per bot** (`DeadlineKey::BotInterrupt`): the handler picks among the
    bots able to answer, so four bots do not get four rolls.
  - The seat that just played is excluded; **the seat holding the turn is not** (in a 1v1 the bot is
    always next).
  - `interrupt_delay` + `interrupt_jitter_max` = **1.5–2.5s**, `interrupt_prob` **0.40** (below
    `catch_prob`): set by fairness — a human must see the card land, recognise the match and press.
    Faster, on a phone the bot's copy landed before the card it answered finished its flight. Pinned
    by `ops/config.rs: a_bot_slam_waits_for_a_human_to_read_the_pile`; the range stays inside
    `finish_delay`'s.
  - Stale check: `last_play_at` must equal the value it was armed with.
  - `broadcast_interrupt` is shared with the human path, so the wire sequence is identical
    (`interrupt_success`, then `card_played`).
- **The move that takes the round is held to its instant** (`bot_finish_due`, `finish_delay` +
  `finish_jitter_max` = **1.8–2.6s**): the slam of its last card (`handle_bot_interrupt` re-arms under
  `BotInterruptHeld` with the seat committed, nothing re-rolled), its last card or copies on its turn,
  its last counter (`execute_bot_move` re-arms with the same `armed_at`, dropped if a card lands
  meanwhile — `board_at`).
  - **Measured from when the finish became possible** (`last_play_at`, or `armed_at` for the turn),
    taking the later of that and the ordinary delay, never added on top. Held, a human has time to
    slam the top or take the lead back first.
  - **An undeclared last card holds the finish behind the bot's own declaration** (`bot_uno_at`):
    declaring on the spot and playing at the think delay shut the catch window instantly.
  - **The declaration has one instant per window** (`bot_uno_at`, `moment_jitter`, hashed like
    `bot_catch_attempt`), so the finish knows when the call comes. `tests/bot_finish.rs`,
    `src/internal_tests/bot_finish_internal.rs`.
- **Auto-declare LOCO! is deferred, and the declaration itself waits**: `maybe_schedule_bot_reactions`
  arms `schedule_bot_uno_announce` (`DeadlineKey::BotUno(seat)`); `handle_uno_announce` calls
  `Room::declare_last_card` when it fires and broadcasts only on success. Declaring at once and
  delaying only the broadcast would make a bot's LOCO! uncatchable while every client showed the
  window open.
  - `handle_uno_announce` re-checks: room playing, seat in range, `last_card_at` unchanged (a Swap can
    open a different window for the same seat); a refused declaration means the bot lost the race.
  - `uno_delay` + `uno_jitter_max` = **1.6–2.8s** of the 5s window: a human reaction budget.
  - **It scans `catchable_targets`, not the seat that acted**: a Swap or GlobalSwitch hands a last card
    over, and receiving one is as declarable as playing to it (§8). Arming twice for one moment
    replaces the same key with the same instant.
- **Bots throw a Contre-LOCO!, late on purpose** (`schedule_bot_catch`, `handle_bot_catch`,
  `bot_catch_attempt`).
  - **`catch_delay` + `catch_jitter_max` = 3.2–4.4s of the 5s window.** The seat that forgot is looking
    at a lit LOCO! chip the whole time; a late catch lands only on somebody not looking, with the
    capsule nearly drained — *I nearly had it*, not *the machine is faster*.
  - **The ceiling is a correctness bound**: a late call costs its caller a card, so
    `schedule_bot_catch` arms nothing at or past the domain's `catch_window_end`, and
    `handle_bot_catch` re-checks on firing. `src/internal_tests/botcatch_internal.rs` pins both ends
    against the domain value.
  - **`catch_prob` 0.8**: about one forgotten call in five walks. The gentleness is the delay's, not
    the die's — a low die is a rule nobody ever sees enforced.
  - **One attempt per window, decided by the window** (`bot_catch_attempt`, an FNV hash of seat and
    `last_card_at`): a window is armed once per action inside it, and rolling per arming would make the
    catch faster and surer the busier the board. Which bot presses is picked at fire time — one press,
    never one per bot.
  - **Armed after every action, human or bot** (`maybe_schedule_bot_reactions`): declaration and
    catch read the same list and are armed together from every point the board changes, so a bot's
    own Swap that hands a human their last card is answered too.
  - `round_ended` guards both: a round-winning play arms no reaction.
- **A bot's turn broadcasts no deadline.** `schedule_turn_timer` arms no timeout for a bot, disarms the
  previous one and sets `Table::turn_started_at` to `None`; otherwise the previous human's half-spent
  deadline would drain under a seat that cannot time out. `turn_deadline` is skipped on the wire when
  zero — the one field where zero is an absence. `turn_deadline_absent_during_bot_turn`
  (`tests/turn_deadline.rs`).
- A bot is `Occupant::Bot`; `Table::bot_seats` / `is_bot` read it.

## What a state message carries, and what is built once
- **`GameStateDTO` carries `catch_seats` and `declared_seats`**, the same answers `card_played` and
  the domain give, so a tab reloading inside a catch window keeps its chance and a spent call does not
  get its button back. `reconnect_snapshot_carries_catch_state` (`tests/audit_fixes.rs`).
- **What is the same for every recipient is built once per broadcast** (`SharedGameState`, from
  `Table::shared_game_state`, handed to `player_game_state_with`): the player list, the scoreboard,
  the recap and the catch lists.
- **A restored table is filled in before it runs and armed through its box** (`restore_room`): holds,
  tokens, AFK counts and reconnect expiries are written before `open_table`; the turn clock, the bot
  and the cleanup, which need the hub's context, are the table's first job (`restore_arm`,
  `post_critical`).
- **A negative named seat on `catch_uno` is refused and counted** like one past the end
  (`usize::try_from` fails): a forged message, never a wager.

## Session tokens
- 32 hex characters (128 bits from the OS, `tokens::generate_session_token`), an
  `ids::SessionToken`. Issued in `room_created`, `room_joined`, `match_found` and a solo
  `game_started`; a reconnecting `join_room` carries it.
- Invalid or missing → refused with the stranger's string (see "The reclaim refusal names nothing").
- **Compared in constant time** (`SessionToken`'s own `PartialEq` is `subtle`'s `ct_eq`);
  `SessionToken::matches` refuses an empty value; no `Display`, and a `Debug` that prints nothing, so
  it cannot reach a log. It is the game's only identity check. Serde-transparent.
- **A reclaim spends its token and gets a new one** (`handle_reconnect`, carried by
  `player_reconnected`): the old one sat on a dead socket, in `sessionStorage`, maybe in a snapshot.
  `reconnect_rotates_the_session_token` (`tests/hardening.rs`) also checks the spent one is refused.
- The token is a field of its `Seat`: it goes with the seat on removal, with the player on a swap,
  with the table on delete.

## Rate limiting
- Token bucket per client: `RATE_PER_SEC` 10/s, `RATE_BURST` 20; `client::RateLimiter`, owned by the
  read pump (the only task that drops a message), so unlocked. Per connection, not per identity.
- Drops → `rate limit exceeded`, **one notice per burst** (`RATE_LIMIT_NOTICE_PERIOD`, 1s,
  `RateLimiter::should_notify`): a notice per drop would amplify the flood onto the send path and end
  by overflowing the buffer. `messages_rate_limited` still counts every drop.
  `rate_limit_burst_then_error` (`tests/hub.rs`).

## Synchronised map loading
`table/maploading.rs`. The table stays **shut** between the deal and the clock while every client
builds the room. **Not cosmetic**: the room is a lazy engine chunk plus a render on the client's own
GPU, and a clock that starts while somebody's table is still a grey rectangle is a head start in a
game decided by arrival order.

- Flow: `deal_match` sends each seat `game_started` (no turn deadline), then `begin_map_loading` →
  `match_loading { players_ready }` → each client sends `map_ready` → `match_loading` per arrival →
  once nobody is left (`maybe_open_table`), `open_gate` arms the turn timer, broadcasts `match_ready
  { turn, turn_deadline }` and schedules the bots. **The clock starts at `match_ready`**
  (`turn_timer_starts_at_match_ready_not_game_started`, `tests/hub.rs`), and so does the match's
  duration (`match_started_at`).
- **Nothing arms a clock or a bot behind the gate**: `schedule_turn_timer` and `maybe_schedule_bot`
  return while `Table::is_loading`, and `execute_bot_move` returns if its move lands inside a gate
  (a walk-out during the gate would otherwise start the clock).
- **Every gameplay message is refused while the gate is open** (`is_gameplay_msg` + `is_loading` in
  `dispatch_at_table`, `waiting for every player to load the table`): a client that skipped its own
  loading screen must not be the only one able to act.
- **Per match, not per round**; a rematch re-arms it (new map).
- Bots are ready at once. A seat that **disconnects** during the gate stops being waited on
  (`disconnect_at_table` re-asks `maybe_open_table`); one that **reconnects** into an open gate is
  sent `match_loading`. A `map_ready` with no gate behind it is dropped in `route`, not refused.
- `Timings::map_load_timeout` (20s, the `MapLoadTimeout` deadline) opens the table without the
  stragglers. The client's `MAP_PRELOAD_TIMEOUT_MS` (12s) is shorter on purpose, so a slow connection
  does not look like a dead one. **A client whose room fails still reports ready**; one that never
  answers is the outcome the gate cannot survive. The client half is in [`client.md`](client.md).
- **E2E**: `startGame()` returns once the table is open, and `waitForTableOpen` must run on every
  secondary page; the Rust tests go through `testkit::complete_map_load`. The gate is exercised,
  never disabled.

## Hand synchronisation
**Every path that grows a hand sends the affected player the cards (`card_drawn.cards`) and everyone
else the count (`drawn_count`).** `Table::send_hand_growth` is that split, called by
`auto_draw_on_timeout` (plain and penalty), `handle_catch_uno`, `handle_bot_catch` and
`penalize_failed_catch`; it announces nothing when the piles gave nothing. **`Table::announce_cards_drawn`
is the one builder of `card_drawn`**; `handle_draw_card` (with the re-armed deadline) and a bot's own
draw call it directly because they announce even an empty draw.
`tests/funnels.rs::card_drawn_is_built_in_one_place`. Hands rearranged wholesale (Swap /
GlobalSwitch) get a personalised `game_state` per recipient (`broadcast_personalized_game_state`).

A count without the cards desyncs silently: the player empties the hand they see, the server still
holds cards, and the round never ends.

**`turn` and `drawn_count` are always written; `pending_draw`, `has_drawn` and `player_index` are
`Option`s**: a zero is a value. `turn: 0` is seat 0's turn, and `drawn_count: 0` is a draw against
exhausted piles. `server/crates/loco-protocol/tests/parity.rs` pins both.

**A `card_drawn` carries the turn state to everyone**, and the client applies it verbatim (absent =
unchanged) rather than inferring from a hand growing: the catch penalty grows a hand while the
draw-once flag is still false.

**Shrinking has the mirror rule.** `removePlayedCards(hand, card, targetSize)`
(`state/store/helpers.ts`, called by `applyCardPlayed`) drops copies of the played card until the
local hand matches the `hand_size` in the same message, because a turn batch (`Room::play_cards`)
puts down several copies in one `card_played`. With no `hand_size` it removes one copy; a server hand
*larger* than ours removes nothing (only a `game_state` settles that). Copies come off the **end** so
the survivors keep their `handCardKeys`. `src/test/batchPlay.test.ts`, `e2e/tests/batch-play.spec.ts`.

## Room lifecycle cleanup
- `Timings::empty_room_timeout` (5 min): empty room retention.
- `Timings::turn_timeout_grace` (400ms): how long past the advertised deadline the auto-action waits.
  `turn_deadline` still says `turn_timeout`; a play sent on the bar's last frame has a round trip to
  cross, and refusing it `not your turn` would read as the clock lying. A test shortening
  `turn_timeout` inherits the grace; shorten it too where the arithmetic matters.
- `Timings::reconnect_timeout` (60s); `MatchmakingTimings::reconnect_timeout` (15s) in a matchmade
  room, whose expiry forfeits.
- All are fields of the `HubConfig` a hub starts with, so tests narrow them in parallel with nothing
  to restore.
- Empty room (the last lobby or finished member leaves, or every in-game seat is held) →
  `Table::schedule_room_cleanup` arms `RoomCleanup`. **Seating anybody disarms it** (`Table::seat`).
  `handle_cleanup` still checks the table is empty and asks the hub to delete
  (`post_to_router("delete_room")`): the map is the one thing a table does not own.
- `HubCore::delete_room(code)` is the single deletion point: one `remove`, the task stopped, `rooms` /
  `bots_active` adjusted, logged.

**An abandoned match is not an empty lobby.** It stays `Playing`, so the clock keeps auto-drawing for
nobody and the table keeps publishing `InFlight`, holding up any deploy. `close_abandoned_match`
closes it the moment it is certain (no sockets, no holds), off the last reconnect expiry and
`leave_room`, deleting through the hub. `abandoned_match_last_expiry_closes_the_table`.

## A deploy does not end the matches on the server
`ops/drain.rs`, `ops/snapshot.rs`, `drain_and_snapshot` in `server/crates/loco-server/src/main.rs`.
Operator detail (compose, CI): [`docs/deployment.md`](../deployment.md). Without this, a deploy kills
every match mid-turn and the returning clients are told `room not found`, which reads as a mistyped
code.

**Two mechanisms, both on every shutdown.** The drain gets interrupted matches to zero by waiting; the
snapshot makes the case where waiting runs out survivable. `drain_and_snapshot` waits on
`Hub::drain_done` for at most the drain timeout, then calls `Hub::save_snapshot` either way.

**The deploy never waits on the players.** 90s (`DEFAULT_DRAIN_TIMEOUT`; `LOCO_DRAIN_TIMEOUT` takes a
duration with units — `90s`, `15m`, `1m30s`, via `loco_twitch::parse_duration` — or bare seconds,
never zero) in both environments: a long drain makes a pipeline's duration a function of how long
strangers play. So in production **the restore is the ordinary path**, which is why its coverage
restarts a real hub over real sockets (`tests/snapshot.rs`).

**The drain refuses exactly what would extend it** (`HubCore::refuse_while_draining`, `server
updating, try again in a moment`): `create_room`, `start_game`, `rematch`, `find_match`, `play_bot`,
and a `join_room` for a table this process does not have. Joining an existing lobby stays allowed (a
lobby cannot deal during a drain). Without `start_game` on the list, two players rematching would
hold the deploy to its timeout. **Everything inside a running match is untouched.**

**The queue is emptied at the start**, with the refusal and a `matchmaking_cancelled`: nobody in it is
in a match, and waiting for a pairing that will never come is the worst outcome.

**Every table is told once, not only the ones playing** (`server_updating`, through `post_critical`):
a waiting room about to press start, a game-over screen about to rematch and a pair on the versus
reveal are exactly where a drain is felt. A seat reclaiming mid-drain is told on arrival
(`handle_reconnect`). The client words it per screen (`ServerUpdating` has a `card` variant).

**`check_drained` runs after every event on the hub's loop while draining**, not hooked onto the paths
that end a match (last card, forfeit, expiry, cleanup) — the forgotten hook is the deploy that hangs. A
matchmade room on its reveal counts as in flight.

**It reads a published value.** Each table publishes `Table::phase` (`actor::Published`) **after every
job**, and `TableHandle::start` publishes before the task runs, so a restored room counts from its
first instant.

**`HubCore::save_snapshot` stops every table before reading one** (`stop_tables`): a table's state is
its task's, and stopping all first makes the file one instant. It is the last thing the process does
with its tables.

**A restored room comes back with every human seat held** (`restore_room`: `Occupant::Held` at one
instant, a reconnect expiry armed each, `schedule_reconnect_expiry` shared with
`disconnect_at_table`), so holds, forfeits and cleanup apply unchanged. Bots come back as bots
(`SeatSnapshot.bot`). **The turn clock restarts whole** (the elapsed part is unrecoverable, and the
error favours the player).

**The format is plain serde**: snake_case field names as the structs spell them, instants as integer
milliseconds (`Millis` inside the room, Unix milliseconds for `saved_at` and `match_started_at`),
`null` for nobody and absence, and one record per seat — `RoomSnapshot.seats` is a
`Vec<SeatSnapshot { token, bot, afk }>` indexed like the room's players, as `GameState.seats` is a
`Vec<SeatState>`.

**`SNAPSHOT_SCHEMA_VERSION` (6) is a hard gate.** The version is read alone, before the body, so a
file from another build is dropped whole by its number whatever its shape, with a `WARN`; there is no
safe way to half-restore. Same past `snapshot_max_age` (2 min), when the clients have given up. The
file is removed before it is parsed, so a bad restore breaks one boot, not every boot. **Bump it by
hand whenever `SavedRoom` or `RoomSnapshot` changes shape.** `tests/snapshot_v5.rs` restores a real
version-5 file (`tests/fixtures/snapshot_v5.json`) and requires it dropped.

**An empty `LOCO_SNAPSHOT_PATH` disables it** (local dev, E2E). The restore runs before the listener
is up, so no socket arrives into a half-restored room.

**The file is the one secret this stack writes down**: every session token and every hand of every
interrupted match. `write_atomic` writes it `0600` through a temporary neighbour and a rename (it is
written during teardown, when a half-written file is plausible); the process is uid 65532; the
directory is `${DATA_DIR}/snapshots/${DEPLOY_ENV}` mounted at `/data`, one per environment so dev can
never restore (and delete) prod's matches. `rollout()` in `.gitlab-ci.yml` stops the old server, then
chowns that directory to 65532 and chmods it `0700`, then starts the new one — in that order, because
the old process writes its snapshot as it stops. Short-lived by construction (removed as read, refused
past its age).

`/health` and `/metrics` carry `draining`; `/metrics` also `matches_in_flight`, maintained only while
draining (0 before).

## Latency measurement
- The write pump stamps every ping (`stamp_ping`); the read pump folds the pong's round trip in at 0.6
  old + 0.4 new (`Client::note_pong`), capped at `MAX_LATENCY_MS`. A pong with no ping is ignored
  rather than published as 0 ms.
- `Timings::ping_period` (5s) is a **latency probe first, keepalive second**; `pong_wait` is 60s.
  Browsers answer pings in the WebSocket layer, so this is a real RTT no client can misreport.
- The fan-out is an interval on the hub's loop (`latency_broadcast_period`, 3s), asking each playing
  table (`Table::send_latencies`). **A table with nothing measured yet is skipped** (`-1` says what
  the client's default says).
- Both periods are `Timings` fields so tests can shorten them.

## Metrics
**`/metrics` and `/health` are operator surfaces**, never reachable from the internet
(`serve::routes`, merged by `main.rs` with the live-streams routes). nginx proxies `/ws`, `/live.json`
and `/live-thumb/` and nothing else; `csp.test.ts` pins the list ([`live.md`](live.md)). `/health`'s
room count, player count, uptime and `draining` size the server for an attacker and announce the
refusal window. Docker's healthcheck runs inside the container (`loco-server healthcheck`, a `GET
/health` on loopback; the image is distroless), and so does the CI smoke test. `deploy/compose.yml`
and `docker-compose.yml` only `expose` 8080 on `internal`; read `/metrics` from a container on that
network (`docker compose exec client wget -qO- http://server:8080/metrics`).
`docker-compose.dev.yml` is the one exception and must publish it: Vite connects straight to
`ws://<host>:8080/ws`.

`GET /metrics` is **Prometheus text** (`text/plain; version=0.0.4`) through the `metrics` crate, one
recorder per hub so two hubs in one test process never add up. The E2E helpers
(`e2e/helpers/metrics.ts`) read these names. `/health` is JSON.

- Gameplay: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`.
- Health: `uptime_sec`, `runtime_tasks` (the tokio runtime's live tasks; should stay low and stable).
- `messages_rate_limited`: sustained growth = abuse or a too-tight burst.
- `messages_dropped_busy`: ~0; non-zero = the hub's queue or a table's box was full.
- `slow_clients_closed`: send-buffer overflow → forced close (the client reconnects).
- `channel_retries`: crossings that found a box full and retried; ~0 healthy.
- `suspected_cheats`: clients with ≥ `SUSPECT_THRESHOLD` (5) non-honest rejections in 30s, one per
  burst; read the `WARN suspected cheat` line (`conn=`, `code=`).
- `reconnect_expirations`: holds that ran out.
- `matchmaking_queue` (waiting now) and `matches_matchmade` (pairings since boot): **the only place
  either number exists**. Sustained queue ≥ 1 with a flat `matches_matchmade` means nobody is being
  paired.
- `matches_solo`: `play_bot` games since boot.
- `debug_mode_active`: reflects `LOCO_E2E=1`. **Must be `0` in prod**; `main` logs a startup `WARN`.
- `handler_panics`: panics a `catch_unwind` recovered, hub or table. **Above zero is a bug**, and this
  counter plus the `WARN handler panic recovered` line are the only evidence. The one number worth an
  alert.
- `conns_refused`: upgrades turned away by `max_clients` / `max_conns_per_net`.
- `joins_throttled`: `join_room` refused for a spent wrong-code budget; read with the `WARN table code
  sweep suspected` line.
- `loop_queue_depth`, `loop_queue_capacity`, `loop_queue_peak`, `loop_slowest_us`, `loop_events`: see
  "What bounds this server".
- `log_lines_dropped`: lines the sink threw away. Above zero, **the log has holes**.
- `draining` + `matches_in_flight`: the shutdown is waiting for the second to reach zero. `/health`
  stays `200` while draining: a draining server serves its players fine, and an unhealthy container
  is one something may kill.
- The `live` counters come from the poller via `Hub::set_live_stats`, installed by `main`; zero
  without a gateway key.

Every counter is an atomic on one `HubMetrics` (`Hub::metrics`), written by every table's task;
`Hub::metrics_stats` reads them at one instant. `matches_started` in `deal_match` / `deal_solo_match`
(per match); `matches_finished` in `handle_round_or_match_end` at match end and in `forfeit_match`;
`bots_active` up in `handle_add_bot`, `open_solo_table`, `restore_room`, down in
`remove_unmanned_seat` and in `delete_room` by the table's published bot count.

## The one outbound call
This server talks to one thing outside itself, the Janus gateway, which holds Twitch's secret. The
poller (`loco-twitch`) runs on its own task and comes back in through `Hub::publish_live` →
`post_to_router` alone. Everything else about it is in [`live.md`](live.md).

## Server stability
- **Deferred work is a deadline in the table's state**, never a detached sleep that posts back; a
  deadline goes with its table.
- **What still crosses a box, and what a full box does:**
  - hub → table, critical (`post_critical`, retried once after 1s, then `WARN`): `disconnect` (else a
    seat held by a dead socket), `restore_arm` (else a restored match with no clock, bot or cleanup),
    `drain_notice` (else a table told nothing,
    `internal_tests/lifecycle.rs::a_drain_notice_reaches_a_table_whose_box_was_full`).
  - table → hub (`post_to_router`, each retried once after `ROUTER_RETRY`): `delete_room`,
    `delete_abandoned`, requeueing a survivor, `enqueue` / `open_solo` after a released seat,
    `failed_join`, the live list.
  - hub → table, best-effort (`post_from_timer`, dropped with an `INFO`): the latency fan-out and
    `sweep_old_seat`.
  - a player's message (`post_to_table`): a full box answers `server busy, please retry` and counts
    `messages_dropped_busy`. It names one table, not the server.
- **`Client::send_bytes` force-closes on a full send buffer** (`SEND_BUFFER`, 256): a silent drop
  would desync; a close leads to reconnect and a fresh snapshot. Counts `slow_clients_closed`.
- **Broadcasts serialise once.** `Table::broadcast` stamps `server_now`, serialises once and fans the
  same `Utf8Bytes` out. Personalised payloads (`game_state`, `game_started`, the private
  `card_drawn`) build the player list and `SharedGameState` once and call `player_game_state_with` per
  seat.
- **The read pump never waits on the hub**: it `try_send`s into the inbound queue (`INBOUND_DEPTH`,
  256) and answers "server busy" when full; a parked reader would deadlock the unregister queue
  (`REGISTER_DEPTH`, 16) behind it.
- Every firing deadline re-checks the state that can move without a re-arm (`execute_bot_move`,
  `handle_expire_reconnect`, `handle_cleanup`, `handle_turn_timeout`) and logs why it skipped.
- **The listener is ours** (`loco-server/src/http.rs`): hyper's HTTP/1 builder with a 10s header-read
  timeout (`HEADER_READ_TIMEOUT`), because `axum::serve` has no such knob and a half-sent request line
  is a socket held for free (Slowloris). The same clock closes an idle keep-alive connection. An
  upgraded WebSocket is past it. Shutdown gives in-flight connections `SHUTDOWN_GRACE` (5s) and does
  not wait on upgraded sockets.
- Task stability: `task_stability_room_lifecycle`, `task_stability_bot_game`,
  `task_stability_full_lifecycle` (`tests/hub.rs`) count the runtime's live tasks.
- **The container has no privilege to lose.** `server/Dockerfile`: a static musl binary on
  `gcr.io/distroless/static:nonroot`, no shell, uid 65532. `deploy/compose.yml` adds
  `no-new-privileges`, `cap_drop: ALL`, a read-only root and a tmpfs `/tmp`. `/data` stays writable,
  and the deploy chowns that environment's snapshot directory to 65532 (a mount overrides what the
  image chowned, and a container that cannot write its snapshot loses the matches it exists to save).

## The log is off the event loop
A write to stderr is a write to a pipe, and a full pipe *waits*: a stalled log consumer would stop a
table's task inside a handler. `ops/logsink.rs` removes that, invisibly to call sites:

- **`main` installs the writer** (`AsyncLog::new(std::io::stderr(), LOG_QUEUE_DEPTH)`,
  `logsink::install`); every `tracing::info!` / `warn!` stays an ordinary macro. A line costs a
  constant ~0.04 µs.
- **The queue is bounded and overflow is dropped, never waited on** (a blocking sink only moves the
  stall). `LOG_QUEUE_DEPTH` 4096, sized for the reconnect burst after a deploy. One OS thread
  (`loco-log`) writes.
- **What is dropped is counted and announced**: `log_lines_dropped`, plus `WARN log sink overflowed, N
  line(s) dropped` written to the underlying writer directly, never through the full queue.
- **A line is copied on the way in and handed over whole**: `AsyncLog::write_line` copies the caller's
  buffer (`copies_the_callers_buffer`), and the `tracing` side hands one formatted `LineWriter` over
  on drop, so a line arrives in one piece or not at all.
- **`close` flushes, is idempotent, and gives up** after `LOG_CLOSE_GRACE` (2s), draining at most the
  queue's capacity. **The second signal closes it too** (`abandon_drain` in `main.rs`, then
  `process::exit(1)`), or the lines saying why the process went down are lost
  (`the_second_signal_flushes_the_log_before_exiting`).
- **A fatal start logs and returns rather than exiting** (`FATAL listen failed`, then the sink is
  closed); a panic goes through the same sink (`install_panic_hook`).

`main` runs the shutdown in order, waiting on each: drain, snapshot, close the listener and wait for
it, `Hub::stop`, close the sink.

## Structured logging
- `tracing`, through the sink above, to **stderr**, formatted by `logsink::LineFormat`, one line per
  event: `2026-11-11T14:03:22Z [WARN |ERROR ]message key=value …`, RFC 3339 UTC to the second, no
  level on an info line (the two that carry one are what an operator greps for). E.g.
  `2026-11-11T14:03:22Z room created code=ABC123 host=Alice`.
- **Spans, not repeated fields.** A table's task runs in a span with `code=`; a player's job and a
  connection's pumps in one with `conn=` (and `addr=` for the pumps). The formatter appends every
  enclosing span's fields, so each line carries `conn=<8-hex>` (`tokens::generate_conn_id`) or
  `code=<6-char>` without the call site repeating them.
- Events: connected, disconnected, reconnected, reconnect window expired, room created/deleted, match
  started (players, format), match finished (winner), WS upgrade errors, deadline skips with reason,
  box-full retries, `WARN suspected cheat: 5 validation rejections in 30s conn=<id> code=<code>
  player=<idx> last_reason=<msg>`, `WARN slow client, force-closing …`.
- `WARN debug mode enabled (LOCO_E2E=1) ...` once at startup if the gate is on. Prod never sees it.
- No tokens or hands in logs; a `SessionToken`'s `Debug` prints nothing.

### `addr=` is a network prefix, never an address
Every `addr=` goes through `net/privacy.rs`: `truncate_addr` / `truncate_ip`, or
`Client::net_prefix`. IPv4 is cut to `/24`, IPv6 to `/48`, and anything unparseable becomes
`unknown` rather than falling through verbatim.

**Nothing outside `privacy.rs` reads the peer address**; `serve_ws` takes the already-truncated
`ClientNet`. A full address is personal data and this server holds no other, so truncating at the
point of reading means it is never stored; lines are correlated by `conn=`, and a `/24` is enough to
tell two networks apart. `client/src/test/legal.test.ts` scans every hub source (recursively) but
`privacy.rs` for `remote_addr` / `peer_addr()` (the pattern in `client/src/test/serverSource.ts`),
because the promise is made in the privacy copy. nginx truncates its own access log the same way
(`client/nginx.conf`, the `anonymised` format). Full reasoning: [`docs/notes/legal.md`](legal.md).
