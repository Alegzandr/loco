# Server: hub, transport, operations

Everything that lives in `server/hub/`: connection management, bot scheduling, anti-cheat, metrics,
room lifecycle.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## How the package is laid out
`hub.go` was one 3500-line file holding the Hub, every handler, the bots, the timers, the broadcasts
and the DTO builders. It is now **one file per thing a message leads to**, all in the same package,
so nothing about visibility or wiring changed and no import moved:

| File | What it owns |
| --- | --- |
| `hub.go` | the `Hub`, its tunables and ceilings, the messages its loop receives, the loop |
| `serve.go` | `Origin`, and the two ceilings refused **before** the upgrade |
| `tokens.go` | room codes and session tokens, both `crypto/rand`, no fallback |
| `dispatch.go` | the `recover`, the not-playing gate, the nickname gate, the wrong-code budget |
| `rooms.go` | opening a table, taking a seat, the host controls, `roomCodeRe`, membership lookups |
| `rematch.go` | the ask everybody at the table has to make |
| `gameplay.go` | play, draw, pass, declare, catch, counter, interrupt |
| `presence.go` | leaving, the 60s hold, the reclaim |
| `bots.go` | every bot delay and every bot decision's scheduling |
| `turntimer.go` | the turn clock, and the consecutive timeouts that make a seat away |
| `broadcast.go` | sending: `sendHandGrowth`, `refuseAction`, the personalised fan-out |
| `statedto.go` | what a client is handed: player list, scoreboard, personalised state |
| `converter.go` | DTO conversion, and nothing else since |
| `debug.go` | `debug_set_state`, the fixture the Playwright suite deals a table with |

The split is a move, not a rewrite: the same functions, the same order inside each file, the same
tests passing without a line changed. Two things travelled with it because they were in the wrong
place to begin with: `broadcastCardPlayed` left `converter.go` for `broadcast.go`, and
`roomCodeRe` / `validRoomCode` left it for `rooms.go`, which is the only caller.

**Where a new handler goes**: beside the others that answer the same kind of message, and its name
goes in `dispatch.go`'s switch. A file per subsystem is what keeps `hub.go` readable as *the loop*
rather than as an index of everything the server can do.

## A table is one object (`table.go`)
The Hub used to carry eleven maps all keyed by the same room code: `rooms`, `roomMembers`,
`disconnectedAt`, `sessionTokens`, `emptyRooms`, `botSlots`, `turnStartedAt`, `mapLoading`,
`afkTimeouts`, `matchmade`, `rematchOffers`. A table was not a thing you could hold; it was a string
that eleven structures happened to agree about.

That shape has one failure mode and it is never a crash:

- **Opening a table was eleven writes and deleting one was eleven deletes.** `deleteRoom` was the
  only place all eleven were named together, so a twelfth map added anywhere leaked per-match state
  into the next match at the same code unless somebody remembered to come back. `resetForNextMatch`
  had the same problem in three copies (`openRematchedLobby`, `startRematchedMatch`, `forfeitMatch`),
  and the one that bites is the map gate: a `mapLoadState` left behind keeps the next match shut
  **forever**, because its own timeout has already fired and nothing is left to reopen it.
- **A seat number meant a seat in each of them separately.** Removing a seat meant shifting the
  members slice, the surviving clients' own `playerID`, the bot set and the session tokens, by hand,
  in three places (`removeUnmannedSeat`, `reindexLobbyDisconnect`, `pruneAbsentPlayers`).

`hub.tables map[string]*table` replaces all eleven. One entry is one table's whole existence, so
`deleteRoom` is one `delete`, a reset is `t.resetForNextMatch()`, and a removal is `t.dropSeat(id)`,
which shifts the four seat-keyed structures together because it is the only thing allowed to shift
any of them.

**That object owns a goroutine now** (`box`, `quit`, `done`, `phase`; see "One table, one goroutine"),
which is only possible because it was already one object: there was a single thing to hand the work
to. **Add per-table state as a field here, never as a twelfth map** — and now also never as something
another goroutine reads directly. `phase` is the one field the hub reads without asking, and it is
published by the table itself rather than computed by the reader.

**`table.seat` is the structural half of the seat-rebind fix below.** Binding a client to a seat
sweeps it out of every other index on that table, and `Hub.seatClient` sweeps it off any other table
first. `alreadySeated` is still there and still refuses, but it is now the *polite* half — it answers
the client rather than silently moving them — instead of being the only thing standing between two
ordinary lobby messages and one player receiving another's hand. `hub/table_internal_test.go` owns
that invariant and fails without it; `seat_rebind_test.go` still owns the refusal.

Zero values carry meaning on purpose, which is what let five of the maps become plain fields: a zero
`turnStartedAt` is "no turn is being timed" (a bot's, or a table that has not opened), a zero
`emptyAt` is "somebody is here", a zero `matchmadeAt` is "a player opened this", and a nil `loading`
is "the table is open".

## What bounds this server, and how it is measured
Every room used to be served by the single event loop, so the number of tables this process could
carry was not `MaxRooms`: it was how long one pass through `dispatch` took and how deep `h.inbound`
got behind it. `messages_dropped_busy` already reported that ceiling, but only once it had been
crossed, which is a post-mortem rather than a warning.

`/metrics` carries the approach to it, and the numbers followed the work when a table got its own
goroutine (next section):

- `loop_queue_depth` / `loop_queue_capacity` — the **hub's** routing queue right now. Every message
  still passes through it; most of them only pass.
- `loop_slowest_us` — the longest a single message has taken **anywhere** on this process, timed on
  the table that handled it. Leaving this on the hub would have quietly turned it into "the longest a
  map lookup took", which is a number nobody can act on.
- `loop_queue_peak` — the deepest any one **table's** box has been seen, which is where a backlog
  shows now.
- `loop_events` is the denominator.

The last two are **high-water marks since startup, never reset and never averaged**: a mean hides
exactly the event that matters, the one slow pass that let a queue build behind it. They are raised
by compare-and-swap rather than load-then-store, which was enough while one goroutine wrote them and
is not any more — two tables reading the same old maximum and both storing loses the higher of the
two, and the one that gets lost is the slow pass somebody is looking for. Not a data race, which is
why nothing would have reported it.

The counters they joined live on one `hubMetrics` struct (`hub/metrics.go`) instead of seventeen
fields on the Hub, for the same reason the package is one file per thing a message leads to: a struct
with a hundred fields hides which of them are state and which are observations.

**Reaching for a shard is not the answer to a peak.** Look at `loop_slowest_us` first: a single pass
that takes milliseconds is a handler doing something a handler should not, and every one found so far
has been a broadcast that marshalled per recipient rather than once.

## One table, one goroutine

`hub/actor.go`. Every room used to be served by the hub's single event loop. A table owns its own
goroutine now, and the hub owns what is genuinely between tables: the map of them, the matchmaking
queue, the connected sockets, the wrong-code budgets, the drain.

**It is not a throughput change, and the numbers below say why.** What it buys is independence. One
table's slowest message was every other table's wait; one handler's panic was recovered on a
goroutine every match shared; nothing could be said about one table without saying it about all of
them. In a game whose reaction windows are decided by arrival order, a queue shared between
strangers' tables is a fairness question before it is a performance one.

**The two directions are deliberately the same shape**, and both are non-blocking:

| | |
| --- | --- |
| `t.post(job)` | run this on that table |
| `h.postToRouter(fn)` | run this on the hub |

Non-blocking is not an optimisation. **A blocking send in either direction deadlocks the moment the
other end is trying to send back**, which is a state two busy tables reach on their own. What cannot
be delivered is dropped and counted, and the cases where a drop would leak something — a room nobody
deletes, a seat nobody frees, a reveal that never deals — retry once, on the same delays the hub's
channel pressure used to.

Four rules hold the split together, and each of them closes a way it could come apart.

- **A message is routed by the hub and re-checked by the table.** `dispatch` resolves the table from
  the sender's seat and posts; `dispatchAtTable` opens by re-reading that seat and returning if it no
  longer names this table. Between the two the seat can have been given up, held or re-based, and a
  `playerID` that means one seat here and another there is the hidden-state guarantee coming apart.
  It is also why a seat is now **one atomic value** (`Client.seat`, a `seatRef` of code plus index)
  rather than two plain fields written in pairs.
- **A table is started when the hub has finished filling it in**, never at construction.
  `newTable` builds, `t.start(h)` runs the goroutine, and every construction path — create_room, a
  matchmade pairing, a snapshot restore — does all of its own writing in between. A goroutine reading
  fields somebody is still writing is the one race this split would otherwise add.
- **A table stops existing and stops running at the same moment.** `deleteRoom` removes the map entry
  first, so nothing new can be routed to it, then stops the goroutine and waits. That wait is also
  what makes the read after it safe: past `stop()`, nobody else is touching the table. Jobs left in
  the box are abandoned on purpose — they are all addressed to a room that no longer exists.
- **A panic is recovered on the table too** (`runJob`), and it matters more there, not less. A panic
  on the old shared loop took the process, which is why the recover was put there; a panic on a
  table's own goroutine would take only that table, but it would take it **silently and permanently**.
  The room would not fail, it would go quiet: every message to it queued behind nothing, for ever,
  with no error to show the players.

`TestOneSlowTableDoesNotHoldUpAnother` is the whole thing in one assertion, and it does not merely
pass — put the handler back on the hub loop and it hangs, because the hub would be sitting in the
first table's handler and would not read the second table's messages until it came back.

**What stayed on the hub, and why it had to.** `create_room` allocates against `MaxRooms` and inserts
into the map. `join_room` spends the wrong-code budget and looks the code up — and then hands the
roster, the held seats and the tokens to the table, which is also what makes two people typing the
same code in the same instant a queue rather than a race for the last chair. `find_match` and
`leave_room` are split down the middle: the queue is the hub's, the seat is the table's, and the two
halves are **ordered rather than raced**, because being in a room and in the queue at once is the one
state neither side could recover from.

**What this cost.** Nine per-timer channels and their nine cases in `Run` are gone; every timer posts
to the table it was armed for, and "does this room still exist" is answered by the delivery rather
than by a lookup. Against that: eight operations that used to be a function call are now a hand-off
with a window in it, and `matchesInFlight` reads a published phase instead of the tables themselves.
Both are written down below rather than left to be rediscovered.

### What the loop actually costs, measured

The counters above say how loaded the loop is in production. `hub/loop_bench_test.go` says what it is
loaded *with*, which is the number an architectural argument has to start from. It is internal
(package `hub`) because it calls `dispatch` directly: going through a socket would measure the kernel.

Run it with `make bench-server`. On a Ryzen 7 9850X3D, Go 1.26, in the container:

| One pass of the loop | 2 seats | 4 seats | 10 seats |
| --- | --- | --- | --- |
| `dispatch(play_card)` end to end | 8.1 µs | 8.6 µs | 9.6 µs |
| `broadcastCardPlayed` alone | 0.84 µs | 1.04 µs | 1.71 µs |
| `broadcastPersonalizedGameState` (Swap / GlobalSwitch) | 3.4 µs | 7.9 µs | 28.8 µs |
| `playerGameStateUsing`, one recipient | 0.29 µs | | |

Two things fall out of that table, and both are load-bearing.

**A single loop was never the ceiling anybody assumed it was.** At 9.6 µs for the worst gameplay
message one goroutine absorbs about 104 000 msg/s. What the server *admits* is bounded elsewhere and
lower: `MaxClients` (5000) times the token bucket's 10 msg/s is 50 000 msg/s, every client flooding at
its limit forever. **The rate limiter already held inbound below what one goroutine handled, with
room to spare**, and a realistic table load (1250 tables of four, an action per player per ten
seconds) ran it at 0.43 % of one core.

So the split that followed (one goroutine per table, next section) was **not** bought for throughput,
and the note says so where somebody might otherwise assume it was. What it removes is head-of-line
blocking between strangers' tables: worst case `dispatch` plus a GlobalSwitch fan-out at ten seats,
about 38 µs. That is three orders of magnitude under the network round trip that already decides
every interrupt race — small, and now zero, at the price of ownership rules that have to be kept.
**Anyone proposing to go further should start from these numbers and not from an intuition about
loops.**

**The expensive call in a handler was the log line.** See "The log is off the event loop".

## One message must never be able to cost the server
`hub.dispatch` opens with a `recover`, and with a gate refusing every gameplay message at a table
that has not dealt. Both come out of the same audit finding, and they are floor and wall rather than
one fix twice.

**The bug.** `room.State` is nil in a lobby (`game.NewRoom`) and again after a rematch
(`Room.ResetForRematch`). Almost every handler delegates straight to a domain call that checks
`Status` first, but two sized a hand *before* refusing: `handleDrawCard` read
`len(room.State.Hands[c.playerID].Cards)` on its first line, and `handleCatchUno` read
`len(room.State.Hands)` to bounds-check the target it had been handed. Both are nil dereferences,
and both were reachable in **two frames** by anybody who could open a socket:

```
connect /ws  ->  {"type":"create_room","nickname":"X"}  ->  {"type":"draw_card"}
```

`originAllowed` allows a missing `Origin` on purpose (a non-browser client has no ambient credential
to be tricked into replaying), so this needed no browser and no valid table. The map-loading gate did
not help: it only exists for a table that has already dealt.

**Why it was fatal rather than annoying.** Every inbound message is handled on the single event-loop
goroutine in `Hub.Run`, and there was no `recover` anywhere in `server/`. So the panic was the whole
process: every match on it ended mid-turn, `SIGTERM` was never received so neither the drain nor the
snapshot ran, and the players who reconnected a moment later were told "room not found", the exact
outcome the drain was built to eliminate, reachable at will for the cost of a TCP handshake.

**The two answers.**
- The **gate** (`isGameplayMsg` + `roomOf` + `Status`/`State`) fixes the class rather than the two
  handlers. The next one to read `State` before validating is covered without anybody remembering to.
  It answers `game not in progress`, resolved by `i18n/serverErrors.ts` like every other refusal.
- The **recover** bounds the blast radius of whatever the gate does not anticipate: one `WARN` with
  the stack, one `server error` to the client that sent it, `handler_panics` on `/metrics`. It is
  explicitly *not* a licence to skip a bounds check. `playerGameStateUsing` already carried the
  right instinct in a comment ("a panic here would kill the hub goroutine and take down every active
  room") and its own guards; this generalises that instinct to every handler.

`hub/hardening_test.go` pins both: the six gameplay messages that reach a lobby, and a probe
(`SetDispatchProbe`, test-only) that panics on demand so the recover is proven rather than assumed.
`handler_panics` above zero is a bug by definition and nothing else surfaces it.

## Ceilings: what stops an abusive client being an unbounded one
Nothing bounded this server's memory. The token bucket limits one socket's message rate and says
nothing about how many sockets exist, and a table outlives the connection that opened it by
`EmptyRoomTimeout` (5 min). So `connect, create_room, disconnect, repeat` was an allocation loop
costing one handshake a table, and there was no answer to it anywhere in the stack.

Four numbers, all exported vars in `hub.go` so tests can narrow them, all deliberately generous:
they exist to make the abusive case terminate, not to shape the legitimate one. A server that
refuses a real player is worse than one carrying a few thousand idle rooms, so **reaching one of
these in production is a signal to read the logs, not a number to lower.**

| Knob | Default | Refused where | Answer |
| --- | --- | --- | --- |
| `MaxClients` | 5000 | `ServeWS`, before the upgrade | HTTP 429 |
| `MaxConnsPerNet` | 64 | `ServeWS`, before the upgrade | HTTP 429 |
| `MaxRooms` | 2000 | `handleCreateRoom` | `the server is full, try again in a moment` |
| `MaxFailedJoins` | 20 / min / network | `handleJoinRoom` | `too many attempts, wait a moment` |

Two details that are not arbitrary:

- **Admission is decided before the upgrade**, in `admitConn`, against its own counter rather than
  `statClients`. `statClients` is maintained by the event loop, which leaves a window between the
  upgrade and the register that an unbounded number of sockets can arrive in, and that window is
  precisely where a flood lives. Refusing early also means a connection this server will not serve
  never costs it a hijacked socket, a 256-slot send buffer and two goroutines. 429 rather than a
  close so a refusal is distinguishable from a network failure, in the client and in nginx's log.
- **The room cap is on `create_room`, not on the socket**, because that is the message that
  allocates something outliving its connection.

`MaxConnsPerNet` is keyed by the same truncated prefix the logs are (`truncateAddr`, `/24` or `/48`),
so nothing here retains an address the rest of the server has already decided not to keep. 64 is high
enough for a household, a LAN party or an office behind one address.

### Which network, though

Both ceilings above are per network, and **in production this server never sees one**. The path is
browser → Cloudflare → Traefik → nginx → here, so `r.RemoteAddr` is the nginx container on the
`internal` Docker network and it is the same address for every player alive. Read it directly and the
two ceilings stop being per network:

- `MaxConnsPerNet` becomes the total number of sockets the site can hold. The 65th player anywhere is
  refused with a 429 **before the upgrade**, and `conns_refused` climbs while `clients` sits at 64.
- `MaxFailedJoins` becomes global. Twenty mistyped codes across everybody, and `join_room` is refused
  site-wide for the rest of the minute.
- Every `addr=` in the log is a constant, which leaves `conn=` as the only correlator and quietly
  removes the one field an operator reads to tell two networks apart.

None of that fails loudly. It reads as "the game refuses everybody past 64 players" and blames one
address in the log while doing it.

So the network is decided once, by `clientNet` (`hub/privacy.go`), and kept on `Client.netKey`, which
is what admission, the failed-join budget and `netPrefix` all answer with. It reads `ClientIPHeaders`
in order — `CF-Connecting-IP`, then `X-Real-IP`, `LOCO_CLIENT_IP_HEADERS` to change them — **and only
when the peer is a trusted proxy**, `TrustedProxies` / `LOCO_TRUSTED_PROXIES`, defaulting to loopback
and the private ranges. That default is not laxity: the Go container publishes 8080 on `internal`
only (`expose`, never `ports`), so nginx is the single peer that can reach it and a public address
never arrives here at all.

**Two headers because production has two paths to this server, and one player can use both inside a
single match.** The page and everything cacheable go through the CDN, which sets `CF-Connecting-IP`.
The socket is dialled on a hostname resolved outside it, where nothing sets that header and Traefik
is what overwrites `X-Real-IP` with the peer it accepted. **The order is a security property, not a
preference**: on the proxied path a client can put an `X-Real-IP` of its own invention on the request
and the CDN forwards it, so the header the CDN itself controls has to be read first.
`TestClientNetPrefersTheHeaderTheProxySets` is that assertion.

Four things it refuses to believe, each of which would hand somebody a private budget:

- **A header from an untrusted peer.** It is a claim about a network, not a report of one.
- **A multi-value header.** This is why the default is `CF-Connecting-IP` and not `X-Forwarded-For`:
  Cloudflare *sets* the former and *appends* to the latter, so the leftmost `X-Forwarded-For` entry is
  whatever the client invented. Anything with a comma in it falls back to the peer.
- **An unparseable or empty one.** A topology nobody described, so the peer stands.
- **An address no browser on the internet could have** (`isRoutableClient`): loopback, private,
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
forwarded it, and this server believed it, because the peer it checks against `TrustedProxies` is the
nginx container either way. One forged header per socket was one network key per socket, which is
every per-network ceiling in the server at once: `MaxConnsPerNet` stops bounding anything, and so does
the wrong-code budget that is the only thing rationing a sweep of the table-code space.

Nothing above the proxy could have caught it. The header arrives, parses, and looks exactly like the
real thing at every layer; the only place the truth exists is which host the request came in on.

So each server block now `set`s `$loco_cf_ip` / `$loco_real_ip` to the one header its own path
guarantees and to `""` for the other, and the shared block forwards the variables. An empty value
makes nginx omit the header, which lands on the fallback above. The site's host vouches for
`CF-Connecting-IP` (Cloudflare sets it there); `ws.` vouches for `X-Real-IP` (Traefik overwrites it
there). `client/src/test/csp.test.ts` pins all three parts — the variables, both `set` pairs, and the
absence of any `$http_` on those two lines.

`isRoutableClient` is the server-side half, and it is not redundant with the proxy fix: the two
forgeries differ in kind. A forged **public** address buys its sender a bucket of their own, which is
bounded by the ceilings being per-network in the first place. A forged **private** one can be aimed at
the bucket every socket with no trustworthy header falls back into — the proxy's own — so filling it
refuses everybody else at the upgrade. `TestClientNetIgnoresAForwardedAddressNoBrowserCouldHave`.

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
no counter, no penalty, nothing per address. `noteRejection` only ever covered the gameplay handlers.

`MaxFailedJoins` wrong codes per network per minute (`joinBudget`, `joinThrottled`, `noteFailedJoin`),
after which `join_room` is refused for the rest of the window **before the lookup**, so a throttled
network learns nothing from the answer either. Keyed by network rather than by socket, because a
socket is free: a sweeper reconnects between attempts and a per-connection counter would only have
measured its patience. The map is swept of expired windows when it passes `maxJoinBudgets` (4096), so
the ordinary path stays one lookup.

A player who mistypes their code once is nowhere near 20, and
`TestOneMistypedCodeDoesNotLockAPlayerOut` is what keeps it that way.

## The reclaim refusal names nothing
`join_room` at a table in progress used to answer two different strings: `invalid session token for
reconnect` when the nickname matched a seat that was actually held, and `game already in progress`
otherwise. The difference was a roster oracle (anybody with a code could test names against the
table) and it bought nothing, because a returning player's client already owns the failed-reclaim
case through its own restore timeout (`sessionRestore`, `reconnectFailed`).

Both now answer `game already in progress`. `i18n/serverErrors.ts` keeps its `invalid session token`
rule for the rolling-deploy window in which a new client talks to an old server, and says so.

`hub/hardening_test.go`'s `TestReclaimRefusalRevealsNothingAboutTheRoster` compares the two answers
directly, which is the only way this stays true.

## Anti-cheat
Defend: illegal cards, turn spoofing, hidden-state manipulation, replay, forged reactions/declarations, dup spam, tampered hand, client win claims.
Posture: validate every message, reject illegal/out-of-turn, server-side hidden state, ignore client timestamps for outcomes, server outcomes final, crypto-random session tokens (required for reconnect), per-client rate limit (token bucket 10 msg/s, burst 20).

- **The upgrade checks `Origin`** (`hub.originAllowed`). `CheckOrigin: return true` accepted a socket
  from any page on the internet. The exposure is genuinely small — no login, no cookie, no ambient
  credential, so a cross-site socket has nothing to borrow — but an unrestricted upgrade is a free
  room-creation and message-flood endpoint pointed at this server from anybody's page, with only the
  per-connection rate limit behind it. Default rule: **hostnames must match, ports need not**, which
  holds in production (nginx serves the SPA and proxies `/ws` on one host) and in dev (Vite on
  :5173, Go on :8080) with no configuration. `LOCO_ALLOWED_ORIGINS` (comma-separated) overrides it
  with an exact allowlist, and once set it is the *whole* rule. A missing `Origin` is not a browser
  and is allowed.

  **In production that default rule no longer holds, and `LOCO_ALLOWED_ORIGINS` is now mandatory
  there.** The page is served from `ohloco.com` and the socket is dialled on `ws.ohloco.com`, so the
  `Origin` hostname and the request `Host` are deliberately different and every upgrade would be
  refused — as a *refused upgrade*, which the client cannot tell from the server being down. The
  allowlist names **the page's origin, never the socket's**: it is the document that opens the
  connection. `write_app_env` in `.gitlab-ci.yml` writes `https://${APP_HOST}` for both environments;
  the value committed in `deploy/app.env` is the shape.
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
  connection knows it as `c.roomCode` / `c.playerID`, and the table knows it as the `*Client` pointer
  at index `playerID` in its `members`. Nothing stopped a seated client from sending `create_room` or
  `join_room` again, and re-entering moved only the connection's copy. The pointer stayed behind in
  the old room at the old index while `c.playerID` named a seat somewhere else, and every
  personalised broadcast for the old room was then built from the wrong index, so a player seated at
  1 who rebound to seat 0 of a throwaway room was sent **seat 0's hand** in the match they had just
  left, for as long as it lasted. No tampered client, no forged message: two ordinary lobby messages
  in sequence defeated the one guarantee the server exists to provide. `table.seat` is what makes it
  unreachable (see "A table is one object" above) and `hub.alreadySeated` is the guard that answers
  it, on both handlers. It does not touch reconnects, which arrive on a fresh socket whose
  `roomCode` is still `""`, and it releases a client whose room was deleted underneath it rather than
  locking it out of the lobby forever.

  The second half of the fix is that **a personalised send now indexes by slot**, never by
  `member.playerID`. The two agree for a correctly seated client and `alreadySeated` is what keeps
  them agreeing, but a call that hands out a hand should read where the room filed the client, not
  what the client's record claims to be. `handleDebugSetState` already did this, which is why it was
  the one personalised path that never leaked, and why the regression test has to go through a Swap
  rather than through `debug_set_state`, or it proves nothing.
- **`crypto/rand` for room codes as well as session tokens, with no `math/rand` fallback anywhere.**
  A room code is not decoration: there is no login and no invite behind it, so the six characters
  *are* the access control on a private lobby. `math/rand` is a deterministic sequence, and an
  attacker creating rooms in a loop observes that sequence's output directly: the precise
  observation needed to infer its state and name the codes handed to everyone else meanwhile.
  `hub.randIndex` draws from `crypto/rand` with a mask-and-retry that stays uniform for any alphabet
  size (the 32-character alphabet never retries). The `math/rand` fallback in
  `generateSessionToken` went the same way: it would have degraded the only authentication in the
  game to a guessable number on an error path that, since Go 1.24, `rand.Read` no longer takes: it
  panics if the OS entropy source is broken, which is the right outcome for a server that can no
  longer issue a trustworthy token. `math/rand` survives for bot jitter, where predictability costs
  nothing.
- **And for the room's own RNG, which is the one that took longest to see.** `game.NewRoom` seeded
  its `*math/rand.Rand` from `time.Now().UnixNano()`, which read as harmless — it is "just the
  shuffle", and the room code and the token, the two things obviously worth protecting, were already
  right. But that one source decides the map, the starting seat and, through `dealRound`, the order
  of all 112 cards for this round and every round after it. It *is* the hidden state the server
  exists to protect, and `rand.NewSource` is deterministic, so the seed is the whole match.
  The attack needs no privilege and no timing precision. Create a table and note the round trip: the
  seed is somewhere in a window a few milliseconds wide, a few million candidates. Start the game
  and read back the three things `game_started` legitimately tells you — the map, the starting seat,
  and your own eight cards. Replay each candidate offline; the hand alone is a forty-bit filter, so
  exactly one survives. You now hold every opponent's hand, the draw order, and the deal of every
  remaining round of a BO7 — the later rounds computable at leisure while round 1 is still being
  played, so the brute force is not even on a real-time budget. Interrupts, catch windows and
  counter-draws are all built on hands nobody else can see; predictable ones make the mechanic
  decoration and the anti-cheat work upstream pointless.
  `game.newRNG` seeds from `crypto/rand` instead, and `ensureRNG` does too — the snapshot-restored
  room was the worse case, since the restore instant is announced to everyone by the server coming
  back up. `game/rng_test.go` is not a property assertion, it **runs the attack**: it brackets the
  constructor, walks every nanosecond in the window, and fails if any of them reproduces the deal.
  It carries a planted clock seed as a positive control, because a replay that has drifted out of
  step with `dealRound` reports "not found" for every room, safe or not — and would pass forever.
  `Deck.Replenish` takes the same source. It used to shuffle off the global one, on the argument
  that only the deal was reconstructible — but the pile going back into the deck is the second half
  of a long round, every card in it has been seen by the table, and whoever can predict its order
  knows the rest of the round outright. `deck_test.go` replenishes the same pile from two rooms and
  requires the orders to differ; a shared global source makes them equal.
- **A refused message must never be cheaper than an accepted one.** This is the finding an audit of
  every inbound message produced, and it is one sentence because all four bugs were the same bug.
  The server had been read for what it *lets* a client do, which was already tight: nothing on the
  wire carries a hand but your own, no deck, no discard pile past the top card, no queue size, no
  roster oracle on a refusal. What had never been priced is what a client gets for a message the
  server turns *down*, and in four places that was more than it got for playing properly.
  - **The AFK counter was cleared before the handler ran.** `resetAFK` sat at the dispatch boundary,
    on every gameplay message, whatever became of it — which is the right place for it and was the
    wrong moment. A seat holding eight cards cannot declare, so `declare_uno` is refused every time,
    and one of them a turn bought permanent immunity from the threshold: the seat timed out for
    ever, auto-drew for ever, and was never once counted away. In a matchmade room that threshold is
    the *only* thing between a stranger and an opponent who has walked away — the reconnect hold
    covers a socket that left, and this covers one that stayed. Sending a message proves a socket is
    alive; it does not prove anybody is playing.
    The reset now runs after the handler and only if the socket was not refused, counted by
    `Client.refusals` as a before/after pair. Not reported by each handler on purpose: `sendError`
    is already the single funnel every refusal in the server goes through, so a handler written next
    year cannot forget to use it, which is the property the dispatch-boundary version had and is the
    only reason it was there.
  - **A Contre-LOCO! on a seat that was never on the hook was charged like a lost race**, and
    therefore *announced* like one. Every timing refusal (`IsMissedCatch`) costs the caller a card
    and puts a `catch_failed` in front of the whole table, which is exactly right for the wager the
    mechanic is built on and exactly wrong for a call on somebody holding eight cards: the caller
    had nothing to lose the race to. So it was a broadcast to every seat, at whatever the token
    bucket allows, and **free** the moment the piles ran dry and the penalty draw came back empty
    (`PenalizeFailedCatch` returns nothing and the broadcast went out anyway). `catchGrace` (2s past
    `catchWindow`) is the line: inside it the window was live when the button was drawn and the
    message lost the trip, which is a wager; outside it no client was drawing that button at all, so
    `ErrNoCatchWindow` was refused to its sender, charged nothing and told to nobody.
    And the free-once-the-piles-are-dry half survived `catchGrace` on its own, *inside* a live
    window: `penalizeFailedCatch` answers an empty draw to its caller alone, so a penalty nobody paid
    is not a table-wide send either.
  - **That last part was rewritten when the button stopped being a cue.** Contre-LOCO! is now live
    from two cards out, so "no client was drawing that button" is no longer true of a press with
    no window behind it — that press is the mechanic, and `ErrNoCatchWindow` costs its caller a card
    like every other miss (`docs/rules.md` §14.6). What replaces the free-refusal as the amplifica-
    tion guard is `GameState.PlayEpoch`: **a seat is charged at most once per card played**, and
    every press after that draws nothing, broadcasts nothing and answers nobody. Ten messages a
    second still buy exactly one `catch_failed`. What stays refused-and-counted is a `target_index`
    the table does not have: no client of ours composes it, so it is a forged message rather than a
    wager, and `noteRejection` still counts it toward `suspected_cheats`.
  - **`rematch` republished an ask that was already in the set.** Membership is idempotent, the
    broadcast was not: one socket at the rate limit became ten `rematch_offered` frames a second to
    every seat. Answered the way `map_ready` answers its own duplicate — not an error, simply
    already true.
  - **A stale-state refusal pulled a full personalised snapshot every time.** That correction is the
    most expensive message this server sends, and one is enough: the drift is corrected by the
    first, and everything the client sends in the millisecond after it was composed against the old
    board. `resyncPeriod` (1s per socket) is the same treatment, for the same reason, that the
    rate-limit notice already needed.

  **And the gameplay gate now bounds the seat as well as the state.** `handleDrawCard` sizes a hand
  on its first line, and `DeclareLastCard`, `CatchUndeclared` and `InterruptPlayCards` all index
  `State.Hands` by the sender's seat on their way in. That is unreachable today — a seat is only ever
  dropped in a lobby or a finished room — and "unreachable today" is precisely the argument the
  `State == nil` gap two sections up was written on, four frames from an unauthenticated stranger.
  One comparison closes the class instead of four bounds checks that have to be re-derived every time
  a seat learns a new way to move.
- **A refused action is not automatically suspicious.** `game.IsLostRace(err)` names the refusals a
  correct client produces all match long — a second draw, a pass that raced its draw, an interject
  whose window closed or whose top card changed, a second LOCO! — as sentinel errors, and
  `Client.noteRejection(err)` is what every gameplay handler calls instead of `noteSuspect`.
  Counting lost races made `suspected_cheats` rise fastest at the busiest, most contested tables,
  which is exactly backwards. `errors.Is`, never a string comparison: the wire text is unchanged and
  free to be reworded.

## The nickname
`server/game/nickname.go`, called by `hub.validateNickname` on the three ways into a seat
(`create_room`, `join_room`, `find_match`). Everything below is the server's; the client mirrors the
shape rules only, so a refusal is instant, and is trusted for nothing.

**One refusal, whatever fired it.** `ErrNicknameLength`, `ErrNicknameCharset` and
`ErrNicknameBlocked` all wrap `ErrNicknameRejected`, and that one string, `nickname not allowed`, is
what goes on the wire; the specific error is kept for the log line and for the tests. A refusal that
names its rule is a tutorial: told "blocked word", the next attempt is the same insult with a letter
moved, and the person doing it now knows which half of the filter to work on. Told "1 to 20
characters", nobody learns anything either, because the field already stops at 20. The client
resolves that string through `i18n/serverErrors.ts` like any other, and shows the *same* line for the
shapes it refuses itself, so the two halves cannot be told apart from the outside.

**The length is in characters.** The old check was `len(n)`, which is bytes: "Étienne" cost 8 of 20
and a Cyrillic name cost double. `NicknameMaxRunes = 20`, counted in runes, on the canonical form.

**The charset is an allowlist, not a blocklist of tricks.** Letters in Latin, Greek or Cyrillic,
ASCII digits, one space between words, and `-_.'` for O'Brien, Anne-Marie and Mr. Bean. That single
rule is what excludes the zero-width characters, the bidi overrides (`U+202E` and friends, which
reverse the seat label and can make a nickname read as somebody else's), the control characters,
emoji, and the Mathematical Alphanumeric Symbols block — whose 𝐟𝐮𝐜𝐤 is four *letters* as far as
`unicode.IsLetter` is concerned and renders as the word, which is why "any letter" was never an
option. Combining marks are capped at one per base letter: one is how "Á" is written when it is not
precomposed, a stack of them is Zalgo, which paints over the seat above it and is unreadable at 720p,
which is the product. A nickname must also contain at least one letter or digit: `---` is inside the
charset and is not a name.

**Normalisation is what keeps the list short.** A list is a losing game played one spelling at a
time, so the input is folded first: diacritics stripped (precomposed through a table, decomposed by
dropping the marks — Go has no NFD in the standard library and `golang.org/x/text` is not worth a
dependency for a 20-rune string), lower-cased, leet undone (`0o 1i 3e 4a 5s 7t @a $s !i +t`),
separators dropped so `f.u.c.k` is one word, and a second pass that squeezes repeats so `salooope`
is `salope`. The leet map is deliberately conservative: `2` is absent, because every aggressive
entry is a way to refuse somebody their own name.

**The words are not ours.** `server/game/wordlists/` is Shutterstock's LDNOOBW list, CC BY 4.0, 19
Latin/Greek/Cyrillic languages of it, `go:embed`-ed into the binary. Vendored rather than fetched:
the check costs a map lookup and a walk over a few hundred short strings, once, when a player takes a
seat, and it has no key, no quota, no rate limit and nothing that can fail at 3am because a third
party moved a route. Refreshing it is `curl` into that directory and a test run; the attribution
lives in `NOTICE.md`.

**How it is applied is ours, because applied naively it refuses a phone book.** Three rules:

1. The whole nickname, and every token in it, is matched against every term. Tokens are cut
   structurally — on separators, on digit boundaries, and on a lower→upper transition — so
   `Xx_Salope_xX` and `xXsalopeXx` both yield `salope` without a single entry being written for the
   decoration.
2. Substring matching is limited to terms of **6 characters or more**. That threshold is the whole
   false-positive control. The short entries of these lists are `ass`, `con`, `cul`, `dick`, `rape`,
   `bite`, `scat`, and they live inside Cassandra, Constance, Deacon, Dickson, Draper, Arbiter and
   Scatena. The cost is a 4-letter insult glued between letters with no case change: `xxfuckxx` gets
   through. Refusing somebody their own name is the worse of the two failures, and it is the one
   nobody reports, they just leave.
3. `nicknameAllowSeed` covers the collisions rule 2 still leaves: Scunthorpe, Penistone, Cockburn,
   Niger, Nigeria. Whole nickname only, so `scunthorpe` is a name and `scunthorpefuck` is not. It is
   the only hand-written list in the file, and it is an *allow* list on purpose: a missing entry is a
   refusal somebody complains about, never a slur that lands on a stream.

The squeezed form is matched against the terms **as written**, never against a squeezed list.
Squeezing the list turns `nigger` into `niger`, and the country is a place people are from.

**None of this is stored.** A nickname lives in `game.Room` for as long as the match does. The one
thing that writes it anywhere is the deploy snapshot (`hub/snapshot.go`), which holds only matches in
flight, is deleted as it is read, and is dropped whole past `SnapshotMaxAge`. There is no scoreboard
that outlives a room, no history, no profile, so there is no stored entry to delete — and adding one
would be the legal change described in `docs/notes/legal.md`, not a feature.

## A refusal that proves a drift carries the correction
`hub.refuseAction(c, room, err)` is the single exit for a rejected gameplay message: the error, the
`noteRejection`, and, when `game.IsStateMismatch(err)`, a personalised `game_state` to that one
client. Every gameplay handler goes through it (`handlePlayCard`, `handleDrawCard`, `handlePassTurn`,
`handleCounterDraw`, `handleInterruptPlay`).

- **Without it a drifted client has no way back.** Its own copy says the card is legal, so it keeps
  offering the action, the player keeps taking it, and every attempt is refused: the loop only ends
  when some later broadcast happens to carry the field that was wrong. The report that produced this
  was an off-colour Swap opening its target prompt again and again, answering "illegal card play"
  after the player had chosen a seat. Server authority means the server ends that argument, not that
  it repeats "no".
- `game.ErrStateMismatch` + `game.IsStateMismatch` (`game/room.go`) name the four refusals that can
  only mean the client acted on a board the server no longer has: `ErrNotYourTurn`, `ErrIllegalPlay`,
  `ErrCardNotInHand`, `ErrMustAnswerPenalty`, plus the batch `hand has %d copies` variant. The
  `staleState` wrapper marks an error **without touching its text**: the wire string is what
  `serverErrors.ts` matches on and what the player reads.
- **A lost race is deliberately not one of them.** There the client's board was right and it was
  simply beaten, so a snapshot would put the most expensive message this server sends on the wire at
  the busiest moment of the busiest table. `resync_test.go` pins both halves: an illegal play is
  followed by a `game_state`, a closed interrupt window by nothing at all.
- Logged as `state resync conn=… code=… player=… reason=…`. Sustained growth on one connection is a
  client bug worth reading; the metric for a tampered one stays `suspected_cheats`.

## 1v1 matchmaking
`hub/matchmaking.go`. One FIFO queue, a pairing rule, and a set of timings that differ from an
ordinary room's on purpose.

- **The queue's size never reaches a client.** `matchmaking_queued` is an empty acknowledgement: no
  count, no position, no estimate, on any message. The number exists on `/metrics`
  (`matchmaking_queue`), which no compose file publishes. The reasoning is not privacy, it is
  feedback: a screen that could render "1 player searching" would render it during precisely the
  window when the queue is trying to fill, and it reads as an instruction to leave. Every player who
  leaves on that sentence is the opponent the next one was about to get. The client times its own
  wait and stages its copy off elapsed seconds instead (`Searching.svelte`).
- **`players_online` is the one number this server does publish, and it is a different number.**
  `hub/online.go`: every socket the process is holding, seated or not, sent on registration and then
  only when the count moves, and only to sockets that are not at a table. The two are not in tension
  — one is "are the lights on", which is worth answering on a home screen, the other is "how long
  until I am paired", which no honest number answers and which a queue size gets read as. The floor
  that keeps the first from turning into the second is the client's (`components/playersOnline.ts`,
  two players), because it is a rule about what a screen draws rather than about what is true.
  - **The watermark is per socket, not per hub** (`Client.onlineSent`). A hub-wide "last sent" would
    skip a player who has just left a table — they were seated while the count moved, so the number
    they hold is stale and the next tick would find nothing to announce. On a quiet server, where the
    count moves rarely, "the next time it moves" is never.
  - **A tick that changes nothing sends nothing.** The alternative is one small message per seatless
    socket every period, forever, on a server where nobody is doing anything; the field is written on
    the event loop, which is also what makes reading `h.clients` from the ticker safe.
  - It cost the test suite's `readMsg` a skip (`hub_test.go`): the message is the answer to nothing
    and can land in front of any reply a test is waiting for. `online_test.go` reads it with `readRaw`.
- **Nobody presses start.** `pairMatch` creates the room, seats both players, sends `match_found`
  with `starts_in_ms`, and arms `mmStart` for `MatchmakingRevealDelay` (2.5s). `handleMatchmakingStart`
  re-checks like every deferred callback (room still there, pair not superseded, still a lobby) and
  calls `startMatch`, which shares `dealMatch` with the host's `start_game`. If one of the pair
  vanished during the reveal, `requeueSurvivor` tears the room down and puts the other back in the
  queue rather than leaving them in a two-seat room that can never start.
- **That deal is armed twice**, and it is the only job here that is. Everywhere else a dropped job is
  lossy: a turn timer lost is one free turn, a cleanup lost is one room until the next restart. This
  one is unbounded. `postCritical` retries it once; if the retry is dropped as well the table is a
  matchmade lobby for the rest of the process's life, which means it publishes `phaseInFlight` for the
  rest of the process's life — so `checkDrained` can never close and **every** deploy from that moment
  on burns its whole `LOCO_DRAIN_TIMEOUT` waiting on a table nobody is playing at, while the pair sit
  on a versus screen that will never deal. `MatchmakingRevealBackstop` (3s after the reveal) is a
  second `AfterFunc` at the same handler. It is safe for the same reason every deferred callback here
  re-checks: the second run finds a room that is no longer a lobby and returns. It costs one timer per
  pairing, and `matchmaking_test.go` pins the property it rests on — two attempts, one deal.
- **A matchmade room has no host**, so `handleAddBot`, `handleStartGame`, `handleSetMatchFormat`,
  `handleSetMaxPlayers`, `handleKickPlayer` and `handleTransferHost` all begin with
  `refuseInMatchmade`. The format is fixed
  (BO1: a queue is entered by somebody who wants to play *now*, and a single round is the shortest
  complete thing the game has, as well as the commitment two strangers are least likely to abandon
  halfway) and the size is two. `handleRematch` is deliberately not among them: it is an agreement
  everywhere, and the only thing the mode changes is what the agreement deals.
- **Two strangers may have picked the same nickname**, and `Room.Join` refuses a duplicate. In a
  private lobby that refusal is right. Here it would fail a pairing neither player did anything wrong
  in, so `uniqueNickname` disambiguates the second one (`Alex (2)`), trimming the base first so a
  seat label cannot outgrow what it is built to hold.
- The queue is left on **disconnect** as well as on cancel (`handleDisconnect` calls `dequeue` before
  anything else): a socket that has gone away must not be paired with somebody who is still there.

## The 1v1 against the server (`play_bot`)

The queue's *experience* with the queue taken out: a nickname, one press, a hand. It exists because
the searching screen's own copy admits, at twenty seconds, that the wait may not end — and the only
thing it could offer next was "open a table", which is three screens and a code nobody is going to
share. A first-time visitor spends about ten seconds before closing the tab, so the alternative had
to be a press.

- **It is not "open a table and add a bot".** That path exists and is unchanged; this one produces no
  code, no waiting room, no host controls and no configuration, because every one of those is a
  decision the mode’s whole promise is that you do not have to make.
- **The table is hostless, like a matchmade one** (`table.solo` → `table.hostless` →
  `refuseWithoutHost`). What it does **not** borrow is the matchmade *timing*: the 15 s reconnect
  hold and the two-timeout AFK threshold exist because a stranger will not wait for you, and the seat
  opposite this player is the server. Reconnect, drain and the snapshot treat it as any other table
  in progress, and `solo` travels in `roomSnapshot` so a restored match does not come back offering
  host controls over a game that has none.
- **The deal carries the identity.** Every other way into a match announces the seat first
  (`room_created`, `room_joined`, `match_found`); this one deliberately has no screen before the
  board, so `game_started` carries `room_code`, `player_id` and `session_token`. Without them a
  reload could not reclaim the seat, and with a separate message in front of it the client would
  flash a screen it has no state for. The client tells the two paths apart by exactly that: a
  `game_started` carrying a room code is a solo deal.
- **`rematch` is refused here, and only here.** The ask has no addressee: the quorum would be one, so
  the "agreement" would be a decision wearing an agreement’s clothes, and the deal it triggered would
  drop the player into a lobby this mode has no host to start. Another game is another `play_bot`,
  which is what the game-over screen sends — and which releases the finished seat first, exactly as
  `find_match` does.
- **It touches nothing the queue owns.** No `h.queue`, no `matchmaking_queue`, no
  `matches_matchmade`. That is not tidiness: the queue is the one server-global the E2E suite has to
  serialise around (`helpers/matchmakingQueue.ts`), and a second entry point quietly joining it would
  make every parallel run flaky in a way nothing points at. `/metrics` gains `matches_solo` instead,
  beside the queue’s own number, because the two answer one operator question together: whether an
  empty-feeling queue is sending people to the bot or sending them away.

## Leaving a match in progress

`handleLeaveRoom` / `leaveAtTable`, `Hub.canWalkOut` + `Room.RetireSeat`. **There is no room and no
moment in which leaving is refused.** What the table decides is what the departure *does*, never
whether the player may go.

**The problem it fixes is not the leaver’s.** Somebody who genuinely has to go used to have exactly
one exit: stop pressing things and let the turn clock auto-draw and auto-pass for them until the AFK
threshold. That is four timeouts, roughly two rounds, played out at thirty seconds a turn by
everybody else, watching an empty chair take its turn. One player leaving is cheaper than that for
the whole table — and at two or three seats, where the refusal used to stand hardest, it is cheaper
still: the alternative there was not a spoiled round but a board nobody could get off.

The four answers, in the order `leaveAtTable` asks them:

- **A matchmade match forfeits.** The honest answer between two strangers, unchanged.
- **A solo game and an abandoned match close the table.** One case in the code, because it is one
  case in fact: nothing at that table will act again once this socket goes. No forfeit either —
  `remainingSeat` would hand the match to a bot or to a player who is not there.
- **Above the floor the round carries on** (`canWalkOut`, `retireSeat`). `playableSeats` counts what
  can act: a bot, or a human who is here or inside their reconnect window. A seat whose hold has run
  out is not one.
- **At or below it the match ends and goes to the seat that stayed**, announced as a forfeit with the
  scoreboard untouched. A table of two is a 1v1 whichever door it was opened through, and the
  alternative is leaving the survivor in front of a board that will never move again — which is the
  state `abandonedBy` exists to end, arrived at deliberately instead of by an expiry.

- **`WalkOutFloor` is 2**: what a match needs to keep being a match, not a politeness threshold. It
  was 3 when leaving was a privilege a big table could afford; it is now the line between the two
  endings above.
- **Evaluated once, at the moment of the ask.** If a later disconnect takes the table under the floor
  while the round runs, nothing is re-decided: what happened was a departure, and reconsidering it
  afterwards would mean a player who left is somehow still at the table.
- **The seat is retired, not removed.** Hands, scores, rounds won and the turn order are all indexed
  by it, and a running match cannot re-base any of them. So the seat stays, `table.gone` records the
  absence exactly as an expiry does, and the domain takes it out of the *round*: the hand goes back
  into the deck (shuffled — those cards were hidden, and leaving them in a hand nobody holds would
  shrink the deck for everybody else every time somebody left), `nextTurn` steps over it,
  `rotateSeats` leaves it out of a Global Switch, `biggestLoser` never picks it to open a round, a
  Swap cannot name it, and it is dealt nothing from then on.
- **A pending draw stack aimed at the leaver dies with the seat.** Passing it on would be a penalty
  the next player never earned; holding it would be a debt nobody can pay.
- **The scoreboard is left exactly as it stood.** This is a departure, not a forfeit: the rounds they
  won stay won, the points stay where they are, and the act of leaving neither wins nor loses the
  match. It follows that a seat that had already banked enough rounds can still take the match on
  the tiebreak chain, which is the honest reading of “they neither win nor lose by this”.
- **The token is spent and the seat cannot be reclaimed.** The hand is in the deck; there is nothing
  to come back to.
- **The control is a chip in the board’s top-right chrome row, and never on the action bar.** That
  bar is a fixed three-column grid so a reaction can be aimed at it, and it must not grow a fourth
  control (see `visual.md`). The question takes the chip’s place, out of the flow, so nothing on the
  board moves for it — the safe answer first and coloured, Escape through the one hook, exactly as
  the waiting room’s own confirmation works. It is drawn at every table now, and what changes with
  the table is the line under the question: what leaving costs the people still holding cards.
- **The seats that stay are told, by name.** `player_left` already carried the nickname and the seat;
  the client turns it into a pill on the board. A departure moves the turn and shortens the order,
  and the roster alone cannot explain that — held and gone are both `connected: false`.

## The host's stream is the table's business
`handleSetStreamerMode`, answering `set_streamer_mode`, and the one place a *presentation*
preference is allowed through this protocol. Everything else a player picks — the theme, the colour
shapes, reduced motion, the language — is decided and kept on their own machine, and the reason this
one cannot be is arithmetic: a table code is a single string shared by everybody who can see it. A
host with it on screen while capturing is exposed by the friend who joined and left the waiting room
up on a second monitor, and by the seat that reads the code out loud. Blurring only the host's copy
protects the one screen that was already being careful.

- **Host only, hostless never.** It is a table setting, and a table's settings are seat 0's, like the
  format and the seat count (`only the host can change streamer mode`). A matchmade or solo table has
  no host *and* no code on screen, so it is refused there by `refuseWithoutHost` rather than special
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
- **It lives on the table and it outlives the match** (`table.streamerMode`, untouched by
  `resetForNextMatch`). The stream does not end because a match did. It rides the drain snapshot for
  the same reason: a host who came back from a deploy to a table whose code had gone readable again
  would find that out from their own capture.
- **Three places carry the answer**: `streamer_mode_changed` to the whole table, `room_joined` for
  somebody who types the code an hour into a stream, and every `GameStateDTO` for a tab that reloads
  mid-match. A client that learns it from only the first is a client that is blurred only if it
  happened to be watching. `hub/streamermode_test.go` pins each one.

## Freeing a seat somebody else is in
`handleKickPlayer`. Every other host control describes the table (the format, the size, when to
deal); this one acts on a person, so it is the strictest thing in the lobby.

- **Host only, lobby only, and never seat 0.** The host's own seat is given up with `leave_room`,
  which asks first; a kick that could take seat 0 would hand the table to whoever was sitting in seat
  1 through a button that says nothing of the sort. Once the cards are out a seat belongs to a match
  rather than to a roster, and the only thing that ends one early is a forfeit — so the refusal there
  is `can only remove players in the lobby`, not a special case of it.
- **The table sees a departure and the player sees a reason.** `releaseSeat` does the work, which is
  the same bookkeeping `leave_room` and a lobby disconnect do (roster plus `table.dropSeat`, which
  moves the members, the bots, the tokens and the surviving clients' `playerID` together), so the
  three cannot drift apart. The removed client is off the table by then and gets `kicked` on its own
  socket instead of the
  `player_left` about itself: a table vanishing with no explanation reads as a bug, and the client
  puts the line under the lobby form.
- **A bot is a seat like any other.** The slot behind it is `nil`, so it goes through
  `removeUnmannedSeat` rather than `releaseSeat`, and that function re-bases exactly what the human
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
`handleTransferHost`, answering `transfer_host`. The host is seat 0 and nothing else, so this is a
swap of two seats and not a flag: the moment it lands, every `c.playerID() != 0` check answers the
other player and the roster badge follows. A second definition of who owns the table is a second
thing to keep in step with the first, which is the bug `keepHostHuman` above exists to clean up
after.

- **Why it exists.** A lobby's re-index already moves the table when the host drops, which is right,
  but it is the *only* way it moves: a host who is not going to be there for the match, or who opened
  the table for somebody else, had nothing to press. The passation was a departure.
- **`game.SwapLobbyPlayers` + `table.swapSeats`, mirrored seat for seat.** Whatever the roster does,
  the members, the bot set and the session tokens do. **The token travels with the player**, because
  it is the proof that seat is theirs: left behind, it would hand a reloading player the seat that is
  now somebody else's — and on this table that is the host's.
  `TestTransferHost_TheTokenFollowsThePlayer`.
- **A swap, not a move to the front.** A move re-bases every seat between the two and a swap moves
  exactly two. Fewer seats moving is fewer seat-keyed structures to get wrong.
- **Lobby only, never to a bot, never to seat 0, never in a matchmade room.** The lobby rule is the
  kick's — once the cards are out a seat belongs to a match, and swapping two would swap two hands,
  which is why `SwapLobbyPlayers` refuses a finished room the way `RemoveLobbyPlayer` allows one
  (`Scores`, `RoundsWon` and `LostHandTotal` are indexed by seat). The bot rule is `keepHostHuman`'s:
  a table whose host cannot press start can never deal. Seat 0 is the sender's own.
- **`host_changed` is per-recipient**, like `rematch_started` and for the same reason: two seats moved,
  so half the room's own `player_id` changed with them. A broadcast would leave exactly the two
  players who moved reading somebody else's row as their own. Everybody gets it, not only the pair —
  the badge moved on their screen too.
- **No confirmation on the server and no refusal for the recipient.** It is not a demotion anybody
  can decline, and the press costs nothing that cannot be pressed back. The client asks first; that
  is a UI decision about a two-item menu, not a protocol one.

## The three things a player can say

`hub/emotes.go`, `protocol.AllEmotes`. After a close 1v1 against a stranger there was no way to say
anything at all — not “good game”, not anything. Three fixed emotes is the smallest thing that fixes
that, and the smallest is the point.

- **No free text, ever.** Free text is a moderation surface, and this game has no way to keep the
  promise that comes with one: “we collect nothing” is the compliance strategy rather than an
  accident (`notes/legal.md`). Three is enough to be gracious and too few to be abusive, which is
  the only property that matters here.
- **The set is closed and it is the server’s.** An identifier travels, not a string, and one this
  server does not know is refused and counted (`noteSuspect`) rather than relayed: a client cannot
  invent a fourth. The words are the client’s (`t.emotes`), in the player’s own language.
- **Nothing is kept, anywhere.** Not in the event log, not on the `Room`, not in the drain snapshot,
  and not on the `table` either: `hub/emotes.go` holds no state at all. The client keeps one line per
  seat — the last thing that seat said, replaced rather than stacked — and drops the lot with the
  match.
- **The game-over screen and nowhere else.** Anywhere earlier it would be something to do *to*
  somebody mid-round, which is what a reaction game least needs. Refused through the same door every
  other out-of-context message uses.
- **A seat changes its mind as often as it likes, and that is the whole point.** There was a 2 s
  per-seat cooldown (`table.emoteAt` + `EmoteCooldown`), on the theory that ten a second would be a
  wall of pills over a scoreboard somebody is reading. It would not have been: the client *replaces*
  a seat’s line rather than stacking it, so three presses in a second are one pill changing its word,
  and the card’s height is the table’s size no matter what anybody does. What the cap actually cost
  was the gesture the feature exists for — press “gg”, think better of it, press “close one” — which
  arrived as a refusal. The traffic is bounded where every other message on this socket is bounded,
  by the per-client token bucket (10/s, burst 20); a second, narrower ceiling said nothing the first
  one did not.
- **The refusals that remain answer their sender and nobody else.** Wrong screen, unknown identifier:
  both broadcast nothing, or a refused emote would be cheaper to send than an accepted one — the rule
  every rate-limited message in this server is written to.
- **Never to or from a bot.** A seat the server plays has no opinion about the match and no socket to
  receive one. The guard is written down even though it is unreachable: the rule is about the seat,
  not about the transport.

## A rematch by agreement
`handleRematch`. It was the host's decision and it is nobody's now. The host's standing is over the
things that describe a table before it deals: the format, the size, when to start. Whether four
people want another twenty minutes is not one of them, and between two strangers out of the queue
nobody ever had that standing to begin with. So the ask is the same everywhere and the host's only
remaining privilege on this screen is not having one.

- Any seat sends `rematch`, every ask is broadcast as `rematch_offered`, and the next match is dealt
  only once `rematchQuorum` asks are in. **Every ask is public on purpose**: an ask nobody can see is
  an ask nobody answers, and the screen has to be able to say "they are waiting on you".
- **The quorum is two** (`RematchQuorum`): one seat offers, another accepts, and that is two people
  who want to keep playing. It used to be every connected human, which handed a table of five to
  whoever was slowest to look at their screen — four ready, one silent, and the button read "waiting
  on the table" until they answered or their socket dropped. Two is what a match needs in order to be
  a match (`WalkOutFloor` says the same thing about one already running), so two is what it takes to
  deal one. Below two connected the quorum is whoever is there, which is what makes a solo-plus-bots
  table reopen on one press; bots are not asked, and a seat inside its reconnect window is not waited
  for either — it left a room that is already over.
- **Nobody is dropped by that.** `openRematchedLobby` reopens the room with everyone still sitting at
  it, so a player who had not answered lands in the waiting room rather than out of the game, and the
  deal is still the host's press. The quorum decides when the room reopens, never who is in it.
- **The reopened table is hosted by somebody who asked for it** (`promoteRematchHost`, off
  `rematchAskers` read *before* the prune and the reset re-base the seats). Two asks can easily reopen
  a lobby seat 0 never asked for: the host said nothing, or they left mid-match and the prune took
  their seat, or a bot slid into 0 behind them. Seat 0 owns the format, the size and the press that
  starts the match, so leaving it there would be a room full of players who agreed to play again
  waiting on the one who did not — the exact wait the quorum exists to end. The new host is the
  **earliest-seated asker** (the earliest arrival, not whoever pressed first), moved with
  `SwapLobbyPlayers` + `table.swapSeats` so the tokens travel with the players, exactly as
  `transfer_host` does. `keepHostHuman` follows it, for the table where nobody who asked is still
  there. Nothing moves in the ordinary case, where the host asked.
- **`rematch_offered` carries the whole state, not the increment** (`broadcastRematchOffers`):
  `rematch_offers` plus `rematch_needed`. A departure re-bases seats, so an increment would leave
  every client holding a stale seat number and a count that never completes. The list is nullable on
  the wire because *empty* is a real answer here.
- **A departure is an answer.** `releaseRematchOffer` retires the leaver's ask, shifts the rest down
  with `shiftIntKeySet` exactly as the bot set and the session tokens are shifted, republishes, and deals
  when what is left of the table has already asked. It is called from `releaseSeat` and from the
  finished-room branch of `handleDisconnect`; `deleteRoom` drops the map with the room.
- The deal has two shapes (`dealAgreedRematch`). `startRematchedMatch` goes through the **pairing**
  path, not the lobby one: another `match_found`, another reveal, and every screen, timer and gate
  downstream is the one both clients already went through. A matchmade rematch is a new match between
  the same two, not a room returning to a lobby this mode does not have. `openRematchedLobby` is the
  ordinary table: prune the absent, `ResetForRematch`, promote a host who asked, `rematch_started`
  per recipient — which is per recipient partly for that promotion, since it moves two seats. Both do the
  same per-match cleanup, or the finished match's loading gate would keep the next one shut forever.
- Refused in a **matchmade** room once the seat opposite is gone (`your opponent has left the
  table`): there is no lobby to wait in and nobody who can arrive. The client requeues that player
  rather than leaving them on a button that cannot complete. An ordinary table has no such floor,
  because whoever is left can reopen the room and wait in it.
- **No timer on an ask.** One that is never answered costs the asker nothing, and leaving retires it.
  A countdown would only add a deadline to a decision nobody is blocked on.

## Nobody waits for somebody who is not there
The reason the mode has its own timings at all. In an ordinary room the 60s hold and the 4-timeout
AFK threshold are right: those are people who came in together and will wait for each other. Two
strangers will not, and the player who is still at the table did nothing wrong.

- `reconnectHold(code)` and `afkThreshold(code)` are the two switches: **15s** and **2** in a
  matchmade room, the shipped values everywhere else. 15s covers the disconnect people actually have
  (a wifi hiccup, a tab reload, both back in two or three seconds) and ends the rest quickly.
- Either expiry calls `forfeitMatch`, which is `game.Room.ForfeitTo` plus the broadcast:
  `match_end { forfeit: true, player_index: <the seat that left> }`. Every per-match timer keyed on
  the room is dropped there too, or a turn timeout lands afterwards and auto-draws for a seat in a
  match that is over.
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
  has a quit button for host and guest alike, `releaseSeat` frees the seat on the spot and the rest
  of the table gets `player_left`. That is the whole point of sending it rather than closing the tab,
  which would hold the slot instead.
- **A table nobody can come back to is closed rather than forfeited.** The other seat's socket goes,
  its hold expires, and from then on nothing at that seat will ever act again — the clock auto-draws
  and auto-passes for it every 30 s until the round runs out. `table.abandonedBy` is the question:
  every other seat a human, with no socket **and no hold left**. Away is not gone — while the hold is
  running the seat is somebody who may return, so leaving in front of it is the ordinary 1v1 ending
  and the match is theirs to come back to. Once it is gone, no forfeit is issued at all, because
  `remainingSeat` would award the match to the seat that is not there: the seat is swept and the
  table is closed.
- `forfeit_deadline` rides `player_disconnected` in a matchmade room only. Without a number on
  screen, 15s of a frozen board is indistinguishable from a broken game, which is the difference
  between waiting and reloading.

## A seat that is empty has to read as empty
Two ways a seat has nobody in it, and the roster used to answer only the first.

**`awayAt` is a hold, and the hold ends.** `playerList` derived `connected` from `awayAt` alone, and
`handleExpireReconnect` deletes that entry one line before it broadcasts the departure. So the
`player_left` announcing a player was gone carried a roster saying that player was present — and in
an ordinary room, where nothing forfeits, it stayed that way for the rest of the match: a seat pod
and a score table showing "here" while the turn clock auto-passed for them every 30 s. It was masked
in matchmade rooms only because those forfeit on the same event. `table.gone` is the second half of
the answer, and `hasLeft` is how `playerList` reads it. The seat itself cannot go: hands, scores and
turn order are indexed by it until the round ends. Every re-basing move shifts `gone` with the rest,
and `resetForNextMatch` clears it, for the reason every other per-match map is cleared there.

**A finished table holds its seats too.** The match is over; the rematch is not. A socket that
dropped on the game-over screen used to be released outright, so a wifi hiccup between the last card
and the rematch button was answered `not in a room` by the only control that screen has. Now
`disconnectAtTable` holds it for the ordinary reconnect window, `retireRematchOffer` takes that
seat's ask out of the quorum without re-basing anybody (it is being held, not removed, so no index
moves), and `joinAtTable` accepts the token reclaim at any table that is not a lobby. The reclaim
sends `player_reconnected` with **no `state`** — a finished room has none, and a snapshot built from
a nil one would hand the client an empty board and put it back at the table — followed by the whole
`rematch_offered` state. When the hold does expire, the seat is removed for real
(`RemoveLobbyPlayer` + `dropSeat`): a phantom at a finished table is worse than a stale flag,
because the next match would deal a hand to nobody.

**Matchmade tables are deliberately excluded from that hold.** Two strangers are done with each
other, the survivor's client requeues the moment the roster says it is alone, and holding a seat
would make it wait out the hold first for a rematch `handleRematch` refuses anyway.

## AFK auto-kick
- `hub.AFKKickThreshold` (var, default 4) consecutive turn-timeouts without voluntary action → kick (~2 rounds in 2-player). A matchmade room uses `MatchmakingAFKThreshold` (2) and forfeits instead of kicking; see above.
- Bots exempt. An **accepted** voluntary action (play_card, draw_card, pass_turn, declare_uno,
  catch_uno, counter_draw, interrupt_play) calls `hub.resetAFK(t, c)`. A refused one does not: see
  "A refused message must never be cheaper than an accepted one" above, which is the whole reason
  the reset moved from before the handler to after it.
- Kick: send `{type:"error", error:"afk_kicked"}`, close. Standard reconnect window applies.
- Tests override threshold (e.g. `1<<30`).

## Bots
- Host adds via `add_bot`. Named by `nextBotName(room)` — lowest free `Bot1`, `Bot2`, … (scans, does not count seats).
- **A bot never sits in seat 0** (`Hub.keepHostHuman`). The host is seat 0 and nothing else: five
  controls are gated on `c.playerID() != 0`, the roster badge is `p.index === 0`, and a kick is
  refused on that index. So a lobby re-index that lands a bot there does not mislabel a row, it hands
  the table to something that can never press start — the humans read *waiting for the host* pointed
  at a bot until they close the tab, and the room is a five-minute cleanup timer away from existing
  for nothing.
  - It was one reload away. Open a table, add a bot, refresh: a lobby seat is removed rather than
    held (see *A seat that is empty has to read as empty*), the bot shifts down into 0, and the
    player who reloads rejoins **behind** it. Two players and a bot in the middle produce the same
    thing on an ordinary departure.
  - Called from the two places a lobby's seats move: `reindexLobbyDisconnect` (which is both
    `leave_room` and a dropped socket) and `joinAtTable`. Both are needed and neither is enough —
    the reload case has nobody left to promote at the moment the seat goes, so the promotion is the
    *arrival's*; the departure case has no join coming.
  - The move is `RemoveLobbyPlayer` + `Join` under the same name, i.e. exactly the pair a departure
    and an `add_bot` already make, so `members`, `bots`, `tokens` and `gone` shift through
    `dropSeat`/`addEmptySeat` and learn no new way to move. Lobby only: a finished room indexes its
    scores by seat and refuses `Join` anyway.
  - It terminates because each pass puts one more bot behind the first human, and it does nothing at
    a table with no human left to host it — that one is the cleanup timer's.
  - `TestLobbyReload_BotDoesNotKeepTheHostSeat` and `TestLobbyHostDisconnect_BotNeverInheritsTheSeat`.
- AI: `game/bot.go` `BotThink(state, playerIdx) BotAction`.
- Scheduled via `botMove` channel with `BotThinkDelay` (1200ms) + `BotJitterMax` (1000ms).
- **The think delay, and only the think delay, is tunable from the environment**
  (`LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS`, applied by `hub.ApplyBotTimingEnv` at startup and
  gated on `LOCO_E2E=1` like `debug_set_state`). It is pure dead time — nothing races it — so a
  shorter one changes how long the E2E suite takes and not what it proves. Every *other* bot delay
  is a reaction window somebody is meant to be able to win (`BotCatchDelay` against a human's
  Contre-LOCO!, `BotUnoDelay` against the catch it invites, `BotInterruptDelay` against an open
  window), and shortening those in CI would quietly rewrite the verdict of the tests covering them.
  A malformed or negative value is ignored with a `WARN` and leaves the shipped timing in place: a
  typo must not silently produce an instant bot.
- **Bots interject** (`game.BotInterrupt(state, playerIdx) *BotInterruptAction`, scheduled by
  `hub.maybeScheduleBotInterrupt`, executed by `handleBotInterrupt`). Without it the game's
  signature mechanic ran one way only: bots could be interrupted and never interrupted back, so the
  hardest reaction in the game was also the one nobody had to defend against.
  - `BotInterrupt` mirrors `InterruptPlayCards`' own rules rather than trusting the caller (window
    open, exact card equality, draw-chain restriction, no batching a Swap or a GlobalSwitch, every
    wild names a real colour). An interject the domain will refuse is worse than none.
  - Armed **only after a human action**, at the same three points as `maybeScheduleBotCatch`
    (`handlePlayCard`, `handleCounterDraw`, `handleInterruptPlay`). Bots deliberately do not answer
    each other — the existing rule for catches, and what keeps an all-bot table from trading cards
    with nobody watching.
  - One message per play, not one per bot: the handler picks among the bots that can actually
    answer, so four bots do not get four rolls of the die on the same card.
  - The seat that just played is excluded (taking the lead back from itself). **The seat holding the
    turn is not**: in a two-player game the bot is always the next player, so excluding it would
    leave the mechanic one-way in the most common setup. It is not redundant with its ordinary turn
    either — an interject slams *every* identical copy, where `BotThink` plays one.
  - `BotInterruptDelay`+`BotInterruptJitterMax` = **0.7–1.5s**, and `BotInterruptProb` = **0.40**,
    below `BotCatchProb`. An interrupt window has no deadline, so these are set by fairness rather
    than by a timeout: a human has to see the card land, recognise the match and click. A bot that
    always took the window it could see would answer every play anybody made.
  - Stale check like every scheduled callback: `State.LastPlayAt` must equal the value it was armed
    with, or the bot is answering a board that no longer exists.
  - `broadcastInterrupt` is shared with the human path, so a bot taking the lead produces the exact
    same sequence on the wire (`interrupt_success` then `card_played`).
- Auto-declare UNO: **deferred, and the declaration itself is what waits**.
  `maybeScheduleBotDeclarations` only schedules; `handleUnoAnnounce` calls `DeclareLastCard` when the
  timer fires and broadcasts only if it succeeded. Declaring on the spot and deferring the *broadcast*
  alone settled the seat server-side while every client was still showing the 5s catch window it had
  just opened on the same `card_played`: a bot's LOCO! was uncatchable by construction and every
  Contre-LOCO! tap came back `player already declared` ("Déjà annoncé."), which reads as a broken
  button rather than as a race lost.
  - `handleUnoAnnounce` re-checks like every other scheduled callback: room playing, seat still in
    range, `LastCardAt[seat]` unchanged (a Swap can open a *different* window for the same seat), and
    `DeclareLastCard` failing means the bot lost the race and simply never announces.
  - `BotUnoDelay`+`BotUnoJitterMax` = **1.6–2.8s** of the 5s window. It is a human reaction budget
    (spot the seat → move to the button → click), not a machine's: at the old 0.4–0.8s the mechanic
    would have been unwinnable even once the state bug was fixed.
  - **It scans `CatchableTargets`, it is not keyed on the seat that acted.** Playing down to one card
    is not the only way to owe a declaration: a Swap or a GlobalSwitch hands one over, and §8 makes
    receiving your last card exactly as declarable as playing to it. Keyed on the actor, a *human's*
    Swap scheduled nothing at all for the bot it put on one card, so that bot stayed undeclared and
    catchable for the full window: a free +2 no human ever offers, since bots do catch humans. A
    bot's own Swap had the same hole against a second bot. Called at the same three human entry
    points as `maybeScheduleBotCatch` **and** after every bot action; scheduling twice for one moment
    is harmless (the second announce finds the seat settled and returns).
- **A bot's turn broadcasts no deadline.** `scheduleTurnTimer` arms no timeout for a bot and now also
  zeroes `table.turnStartedAt` on its way out, because `turnDeadlineMs` reads it with no
  notion of whose turn it is. Leaving the previous human's entry behind put a half-spent deadline on
  every `card_played` that handed the turn to a bot, and the client mounts its countdown bar on any
  non-null deadline: it drained somebody else's clock, in urgent red, under a seat that cannot time
  out. `turn_deadline` keeps `omitempty` precisely so the resulting 0 never reaches the client (the
  one field here where a zero is an absence rather than a value, unlike `turn` / `drawn_count` /
  `pending_draw`). `TestTurnDeadline_AbsentDuringBotTurn` plays a Skip first so a live deadline is
  proven recorded before the second play asserts it gone.
- Tracked in `table.bots`, a set of seat numbers.

## Session tokens
- 32 hex chars (128-bit `crypto/rand`).
- Issued in `room_created`/`room_joined`. Client must include `session_token` in reconnect `join_room`.
- Invalid/missing → error, slot not reclaimed. The refusal is the same string a stranger gets; see
  "The reclaim refusal names nothing".
- **Compared with `subtle.ConstantTimeCompare`, never `==`.** A network timing attack on 128 bits of
  hex is not a realistic threat and this is not pretending otherwise. It is that this is the only
  identity check the game has, the replacement is one line, and an equality operator returning on the
  first differing byte is the kind of thing that only gets noticed once it matters.
- **A reclaim spends its token and gets a new one** (`handleReconnect` reissues, and
  `player_reconnected` carries it). The old one has been on a socket that died, it is in
  `sessionStorage`, and if the process restarted on the way it has also been written to a snapshot on
  disk. A one-shot proof is worth more than a permanent one and costs nothing, because the client
  already stores whatever the server hands it.
  `TestReconnectRotatesTheSessionToken` also asserts the spent one no longer opens the seat.
- `table.tokens` goes with the table on delete, which is now one `delete`.

## Rate limiting
- Token bucket per client: 10/s refill, burst 20.
- `hub/client.go` `rateLimiter` (thread-safe).
- Drops → `error` server message. Per-connection, not per-identity.
- **One notice per burst, not one per dropped message** (`rateLimitNoticePeriod`, 1s). Answering each
  drop put a fresh `json.Marshal` and a queued frame on the server's own send path for every message
  of a flood: the limiter amplified exactly what it exists to absorb, and a fast enough burst ended
  by overflowing the send buffer and force-closing a connection that one notice would have corrected.
  The reply is a hint to a buggy client, not an acknowledgement owed to every message.
  `messages_rate_limited` still counts **every** drop, so the metric keeps its shape;
  `TestRateLimit_BurstThenError` pins both halves.
- `lastLimitNotice` needs no lock: `readPump` is the only goroutine that drops a message.

## Synchronised map loading
The table stays **shut** between "hands dealt" and "clock running" while every client downloads the
map. `hub/maploading.go`.

- **Why it is not cosmetic**: a map is ~600 kB of backdrop and table. Dealt straight into a match,
  the first player's 30 seconds start ticking while somebody else's table is still a grey rectangle,
  and in a game decided by arrival order that is a head start, not a slow paint.
- Flow: `handleStartGame` broadcasts `game_started` (with **no** turn deadline) then
  `beginMapLoading` → `match_loading { players_ready }` → each client preloads and sends `map_ready`
  → `match_loading` again per arrival → once nobody is left, `openTable` arms the turn timer,
  broadcasts `match_ready { turn, turn_deadline }` and schedules the bots. **The clock starts at
  `match_ready`, not at `game_started`** (`TestTurnTimer_StartsAtMatchReadyNotGameStarted`).
- **Every gameplay message is refused while the gate is open** (`isGameplayMsg` + `isMapLoading` in
  `dispatch`, "waiting for every player to load the table"). Trusting the client's own loading screen
  would leave a client that skipped it as the only one able to act.
- Gate is **per match, not per round**: round two runs on a decoded map, and a second pause there
  would be a stall with no visible cause. A rematch re-arms it, because it draws a new map.
- Bots are marked ready at the start: they render nothing. A seat that **disconnects** during the
  gate stops being one the table waits on (`handleDisconnect`), and a seat that **reconnects** into an
  open gate is sent `match_loading` so its client knows to answer.
- `hub.MapLoadTimeout` (var, 20s) opens the table without the stragglers: one backgrounded tab must
  not hold nine people hostage. The client's own `MAP_PRELOAD_TIMEOUT_MS` (12s) is deliberately
  shorter: if they were equal, every slow connection would look like a dead one.
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
- **E2E**: `startGame()` now returns only once the table is genuinely open, and `waitForTableOpen`
  must be called on every *secondary* page in a multi-client test. Without it a test acts during the
  gate, gets refused, and then blocks reading a reply that never comes. Go tests go through
  `completeMapLoad(t, conns...)` for the same reason: the gate is exercised, never disabled.

## Hand synchronisation
**Every path that grows a hand goes through `hub.sendHandGrowth`** — it sends the affected player
the actual cards (`card_drawn.cards`) and everyone else only the count (`drawn_count`). Callers:
`handleDrawCard`, `autoDrawOnTimeout` (both the plain and the penalty branch), `handleCatchUno`,
`handleBotCatch`. Hands rearranged wholesale (Swap / GlobalSwitch) instead get a personalised
`game_state` per recipient.

Telling a client the count but not the cards desyncs it silently and unrecoverably: its local hand
stays short, the player empties the hand they can see, the server still holds cards for them, so the
round-end check never fires — the board freezes on "your turn" with no cards. That is exactly what
the UNO-catch penalty (+2) and the penalty branch of the turn timeout used to do.

**`turn` and `drawn_count` carry no `omitempty`**, for the same reason `pending_draw`,
`has_drawn` and `player_index` are pointers: a zero is a value here, not an absence. `turn: 0` is
seat 0's turn (the client defaulted to 0 and was therefore right by luck, which
`player_index` was not), and `drawn_count: 0` is a draw against exhausted piles — the client's old
fallback for a missing count was **1**, so every observer would have added a card nobody drew to a
hand the server never grew. `protocol/messages_test.go` pins both onto the wire.

**A `card_drawn` also carries the turn state, to everyone, always.** `pending_draw` and `has_drawn`
are `*int`/`*bool` on `ServerMsg` precisely so `omitempty` cannot swallow a `0`/`false`, and the
client applies them verbatim (absent = unchanged) instead of inferring anything from the fact that a
hand grew. **Not every hand growth is a turn action**: the LOCO-catch penalty gives +2 while the
draw-once flag is still false, and that message reaches the whole table. Defaulting the missing flag
to "has drawn" is what produced a seat that could neither draw (button disabled) nor pass (server:
`you must draw a card before passing`) until the turn timer auto-acted for it.

**Shrinking a hand has the mirror rule.** `removePlayedCards(hand, card, targetSize)` (in
`hooks/store/helpers.ts`, re-exported from `gameStore.ts`, called by `applyCardPlayed`) drops
copies of the played card until the local hand
matches the `hand_size` the server sent in the same message, because one `card_played` can represent
several discards — a batch play or a batch interrupt slams *every* identical copy the player holds,
and `GameView` builds that batch by itself. Removing exactly one left the rest as phantom cards: they
rendered, they could be tapped, and the server refused each tap with "card not in hand" until the
round ended.
- `card_played` always carries `Players`, so the authority is always there. With no `hand_size` to
  compare against it falls back to a single copy; a server hand *larger* than ours removes nothing,
  because that is a desync only a `game_state` can settle and guessing would widen it.
- Copies come off the **end** so the survivors keep their `handCardKeys` identity and slide into the
  gap instead of remounting.
- `src/test/batchPlay.test.ts` covers the pure function and the store; `e2e/tests/batch-play.spec.ts`
  covers the wire. `play_cards` had **no** E2E coverage at all, which is how a desync in the game's
  signature mechanic survived.

## Room lifecycle cleanup
- `hub.EmptyRoomTimeout` (var, default 5min) — empty room retention.
- `hub.ReconnectTimeout` (var, default 60s): disconnected-in-game slot hold. `MatchmakingReconnectTimeout` (15s) replaces it in a matchmade room, and its expiry forfeits the match rather than merely freeing the seat.
- Both vars exported for test override; restore via `t.Cleanup`.
- Empty room (last lobby/finished member leaves, or all in-game slots nil) → `scheduleRoomCleanup(t)`.
- `scheduleRoomCleanup`: stamps `t.emptyAt`, `time.AfterFunc` posts `handleCleanup` after the timeout.
  Box-full → `postCritical` retries once after 30s, then `WARN`.
- `handleCleanup`: deletes only if `t.emptyAt` still matches the stamp it was armed against, and only
  if the table is still empty. It decides on the table's goroutine and asks the hub to do the
  deleting, because the map of tables is the one thing a table does not own.
- `deleteRoom(code)`: single deletion point. One `delete`, then `stop()`; whatever the table held goes
  with it. Adjusts `rooms`/`botsActive`, structured log.

**A match is not an empty lobby, and the fixed five minutes is wrong for it.** An abandoned *lobby*
costs a map entry. An abandoned *match* stays `StatusPlaying` for the whole wait, so the turn clock
keeps re-arming and auto-drawing for seats with nobody behind them, and — the part that reaches other
people — the table keeps publishing `phaseInFlight`, so a deploy started anywhere in those five
minutes waits on a game nobody is playing. `closeAbandonedMatch` closes it the moment it is certain
instead: no sockets, no holds left, therefore nobody who can come back and nothing left to protect.
It runs off the last reconnect expiry and off the `leave_room` above, and it does the deleting the
same way `handleCleanup` does, through the hub.

## A deploy does not end the matches on the server
`server/hub/drain.go`, `server/hub/snapshot.go`, `server/main.go`. Operator-facing detail, including
the compose and CI side, is in [`docs/deployment.md`](../deployment.md); what follows is why the
shape is what it is.

The bug this replaces: `main.go` caught no signal at all, so `docker compose up -d` killed the
process mid-turn. Every match in flight was lost, and the clients that came back 250ms later on their
own reconnect schedule were answered `room not found`, which reaches the player as "Aucune table avec
ce code". They lost the match and were told they had mistyped their own table code.

**Two mechanisms, both on every shutdown, complementary rather than alternative.** The drain gets the
number of interrupted matches to zero in the ordinary case, by waiting. The snapshot makes the case
where waiting runs out survivable rather than fatal. Neither is enough on its own, which is why
neither is conditional on the other.

**How long it waits is a deploy policy, and the deploy is not allowed to wait on the players.** 90 s
in both deployed environments since 2026-08-02, down from 15 minutes in production. The long value
was defensible as a game decision and indefensible as an operations one: it made the duration of a
pipeline a function of how long strangers played, held a runner slot for a quarter of an hour, and
left the job's own ceiling close enough to the wait that being kinder to players by raising the drain
would have started failing deploys on a match rather than on a fault. The wait a shutdown can incur
is now a constant. **This moves load onto the snapshot rather than removing it**: in production the
restore is the ordinary path now, not the exceptional one, which is the reason its coverage restarts
a real hub over real sockets instead of asserting the marshalling.

**The drain refuses exactly the actions that would extend it, and nothing else.** `create_room`,
`start_game`, `rematch`, `find_match`, and a `join_room` for a table this process does not have. That
list is not "everything that touches a room": joining a lobby that already exists stays allowed,
because a lobby cannot deal during a drain, so sitting down in one costs the deploy nothing. What is
on the list is what would add a match to the set being waited on. Without `start_game` on it, two
players rematching hold the deploy open forever and the timeout becomes the only thing ending it,
which is the outcome the drain exists to avoid. **Everything inside a running match is untouched**:
turn clock, reaction windows, bots, reconnects, forfeits.

**The queue is emptied at the start of the drain, not refused as it drains.** Nobody in it is in a
match, so there is nothing to protect, and leaving them there is the worst available outcome: waiting
for an opponent this process has already stopped pairing. They get the refusal and a
`matchmaking_cancelled`, which takes the screen back to the table view where a private table still
works.

**The notice goes to every table, not only the ones playing.** It was gated on `StatusPlaying`, which
meant the three places a drain is actually *felt* were the three that never heard about it: a waiting
room, whose host is about to press a start button that comes back refused; a game-over screen, whose
rematch button does the same; and a matchmade pair still on its versus reveal, formally a lobby,
which deals itself seconds later into a match nobody told it about. Finding out from a refusal is
the failure the line exists to prevent, so it goes to everyone who can be refused. The copy differs
by screen on the client (`ServerUpdating` has a `card` variant): a table that has not dealt is not
owed "this match plays to the end".

**`checkDrained` runs after every event in `Run`, not hooked onto the handlers that can end a match.**
A match stops being in flight through the last card, a forfeit, an expired reconnect window and the
empty-room cleanup, and the path that gets forgotten is the one that leaves a deploy hanging until
its timeout. Scanning a map of rooms costs nothing next to the work the loop just did. A matchmade
room still on its versus reveal counts as in flight even though it is formally a lobby: the pair is
made and the deal is scheduled.

**That scan reads a published value now, and the discipline moved with it.** The hub cannot read a
table it does not own, so each table computes `phase` (`table.publishPhase`) and the drain counts
those. What decides the phase is unchanged, and it is still recomputed **after every job a table
runs** rather than being hooked onto the handful that can end a match: the hook is the one that gets
forgotten, and forgetting it is what leaves a deploy hanging on a match that finished. It is also
published by `table.start`, so a room restored from a snapshot mid-match counts from its first
instant rather than from its first message.

**`SaveSnapshot` stops every table before it reads one, and that is deliberate.** A room snapshot
holds the room, the session tokens and the AFK counters **by reference**, so marshalling them while
their own goroutine is still running would write a hand halfway through being dealt. Stopping first
is what makes the file describe one instant. It also means a hub stops serving its tables here, which
is exactly what this call is: the last thing a process does with them, after the drain and
immediately before it goes. Nothing plays on the far side of it.

**A restored room comes back with every seat marked absent**, which is not a special state: it is the
one the hub already knows how to handle, so the reconnect windows, the forfeits and the empty-room
cleanup all apply unchanged and a table nobody returns to ends by itself.
`scheduleReconnectExpiry` is shared with `handleDisconnect` for exactly that reason.

**The turn clock restarts whole on a restore.** The fraction that elapsed is not recoverable from a
wall-clock stamp anyway, since the process was down for part of it, and the error is in the player's
favour.

**`SnapshotSchemaVersion` is a hard gate.** A room shaped by another build is not a room this build
can play and there is no safe way to guess the difference, so a mismatch drops the whole file with a
`WARN` rather than half-restoring it. Same for one older than `SnapshotMaxAge` (2 min): past that the
clients have exhausted their reconnect attempts and restoring only puts unreachable rooms on a fresh
server. The file is removed as it is read, so a restore that goes wrong breaks one boot and not every
boot after it. Bump the constant by hand whenever `game.Room` or `roomSnapshot` changes shape.

**An empty `LOCO_SNAPSHOT_PATH` disables the whole thing**, which is what local dev and the E2E suite
run with: nothing about their behaviour changes.

**The file is the one secret this stack writes down.** It carries every session token and every hand
in every match a shutdown interrupted, so whoever can read it can claim any of those seats and see
all of those cards. `writeAtomic` creates it `0600` and the process runs as uid 10001, but the
directory it lands in is a host path an operator can list: `.gitlab-ci.yml` therefore chowns
`${DATA_DIR}/snapshots` to 10001 and chmods it `0700` on every deploy. Treat that directory as a
secret. It is also short-lived by construction (removed as it is read, refused past `SnapshotMaxAge`),
which is what keeps the exposure to the length of a restart rather than the life of the server.

`/health` and `/metrics` both carry `draining`. `/metrics` also carries `matches_in_flight`, which is
only maintained while draining and reads 0 before that: counting it the rest of the time would mean
scanning every room after every event for a number nobody is looking at.

## Latency measurement
- `Client.latencyMs` / `pingSentAt` (atomics). `writePump` stamps every ping frame, the pong handler
  folds the round trip in at 0.6 old + 0.4 new (`notePong`), capped at `maxLatencyMs`.
- `PingPeriod` (var, 5s) is a **latency probe first, keepalive second**. `pongWait` (60s read
  deadline) is unchanged. Browsers answer ping frames in the WebSocket layer with no page code
  involved, which is why this is a real network RTT and not something a client could report about
  itself.
- `hub.broadcastLatencies()` runs off a ticker in `Run()` (`LatencyBroadcastPeriod`, var, 3s) and
  only for rooms with `StatusPlaying`. **A room where nothing has been measured yet is skipped**:
  a payload of `-1` says exactly what the client's own default already says, and the extra traffic
  showed up as flakiness in tests that read the next message of a given type.
- Both periods are exported vars so tests can shorten them; production never changes them.

## Metrics
**`/metrics` *and* `/health` are operator surfaces, and no compose file publishes the Go server any
more.** nginx proxies `/ws` and nothing else: `/health` used to be proxied too, and it answers with
the live room count, the connected-player count, the uptime and `draining`. None of that is anybody's
business from the internet. The counts size the server for whoever is thinking about loading it, and
`draining` announces the window in which new tables are refused. Nothing legitimate needed it there
either: Docker's healthcheck runs inside the server container against `localhost:8080`, and the CI
smoke test does the same. `deploy/compose.yml` only
`expose`s 8080 on the `internal` network, and `docker-compose.yml` now matches it. It used to
publish `8080:8080`, which put an unauthenticated endpoint on the LAN for no gain, since the browser
reaches the server through nginx there like everywhere else. Read it from inside:
`docker compose exec server wget -qO- http://localhost:8080/metrics`. `docker-compose.dev.yml` is
the one exception and must stay published: the Vite client connects straight to `ws://<host>:8080/ws`
with no nginx in front of it.

`GET /metrics` returns JSON:
- Gameplay: `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`.
- Health: `uptime_sec`, `goroutine_count` (low + stable).
- `messages_rate_limited` — sustained growth = abuse / too-tight burst.
- `messages_dropped_busy` — should be ~0; non-zero = hub overloaded.
- `slow_clients_closed` — per-client send buffer overflow → forced close (client into reconnect path). Sustained growth = broadcast rate too high or many bad connections.
- `channel_retries` — botMove/expire/cleanup channel-pressure retries; ~0 healthy.
- `suspected_cheats` — clients with ≥`suspectThreshold` (5) rejections in 30s; one inc per burst. Investigate `WARN suspected cheat` log (`conn=`, `code=`). Refusals that `game.IsLostRace` recognises never count (see "Anti-cheat").
- `reconnect_expirations` — disconnected players whose 60s window expired.
- `matchmaking_queue`: players waiting for a 1v1 right now, and `matches_matchmade`: pairings made since boot. **The only place either number is readable**: nothing on the wire tells a client how long the queue is (see "1v1 matchmaking"). Sustained `matchmaking_queue` ≥ 1 with a flat `matches_matchmade` means people are searching and not being paired.
- `debug_mode_active` — reflects `LOCO_E2E=1`. MUST be `false` in prod; `main.go` logs startup `WARN` if set.
- `handler_panics` — panics `dispatch` recovered from. **Any value above zero is a bug**, by
  definition, and nothing else surfaces it: the process no longer dies, so the only evidence is this
  counter and the `WARN handler panic recovered` line carrying the message type and the stack. This
  is the one number here worth an alert.
- `conns_refused` — upgrades turned away by `MaxClients` / `MaxConnsPerNet`. A load signal, not an
  incident, until it climbs: see "Ceilings".
- `joins_throttled` — `join_room` refused for burning a network's wrong-code budget. Read alongside
  the `WARN table code sweep suspected` line, which carries the `conn=` and the prefix.
- `log_lines_dropped` — lines the asynchronous sink threw away because the far side was not keeping
  up. Above zero means **the log being read has holes in it**, which is worth knowing before
  concluding anything from what is missing. The log says so in place as well; see "The log is off the
  event loop".
- `draining` + `matches_in_flight` — this process has been asked to go and is finishing what it had. `matches_in_flight` is the number the shutdown is waiting to reach zero; it is only maintained while draining. `draining` also rides `/health`, which deliberately stays `200`: a draining server is serving its players perfectly well, and a container Docker considers unhealthy is one something else may decide to kill out from under them.

All counters atomic on `Hub`; `GetMetrics()` reads outside the event loop, and every table's goroutine
writes them, which is the other reason they are atomic. `statMatchesStarted` inc'd in `handleStartGame` (per `start_game`, not per round). `statMatchesFinished` inc'd in `handleRoundOrMatchEnd` when `MatchOver`. `statBotsActive` inc in `handleAddBot`, dec in `deleteRoom` by bot count.

## Server stability
- Deferred async = `time.AfterFunc` (not `go func{Sleep;send}`). Every one of them posts to the table
  it was armed for (`t.postFromTimer` / `h.postCritical`), so "does this room still exist" is
  answered by the delivery rather than by a lookup.
- Critical posts retry once on a full box, then `WARN`. Rationale, unchanged from the channels they
  replaced:
  - `bot_move` retry 1s — drop stalls game.
  - `matchmaking_start` retry 1s — drop leaves two players on a versus screen that never deals.
  - `disconnect` retry 1s — drop leaves a seat held by a socket that no longer exists.
  - `reconnect_expiry` retry 5s — drop leaves slot in `awayAt` forever.
  - `room_cleanup` retry 30s — drop leaks empty room.
  - `delete_room` / `requeue_survivor` (table → hub) retry 1s, for the same two reasons.
- Non-critical posts (the bot's UNO, catch and interject; the map-load deadline; the latency fan-out)
  drop quietly: each one is a reaction the bot did not get to make or a deadline the table did not
  need, which is a legal outcome rather than a fault.
- Non-critical sends (per-client `send`, `inbound`) = non-blocking drop + client notification.
  `messages_dropped_busy` counts both the hub's queue and a table's box; the client is told "server
  busy, please retry" either way, and a full box now names one room rather than the server.
- **`Client.SendBytes` force-closes WS when send buffer (cap 256) fills.** Silent drop would desync client; close → readPump exit → unregister → reconnect window → auto-reconnect → `handleReconnect` snapshot. Inc `slow_clients_closed`.
- **Broadcasts marshal once.** `broadcastToRoom` does `json.Marshal(msg)` once, fans `[]byte` via `Client.SendBytes`. Per-recipient personalised payloads (game_state/game_started/private card_drawn) precompute `pl := h.playerList(room)` and call `playerGameStateUsing(room, idx, pl)` so `playerList` built once per broadcast.
- `readPump` sends to `h.inbound` non-blocking; drops notify "server busy". Prevents readPump parking on full channel deadlocking `unregister` (cap 16).
- Every scheduled callback (`executeBotMove`, `handleExpireReconnect`, `handleCleanup`) re-checks current state, logs skip reason.
- `http.Server`: `ReadHeaderTimeout:10s`, `IdleTimeout:60s`.
- Goroutine stability tests in `hub/hub_test.go`: `TestGoroutineStability_RoomLifecycle`, `_BotGame`, `_FullLifecycle`.
- `playerGameState(room, playerIdx)` defensive: nil `room.State`, OOB `playerIdx`, empty discard → minimal `GameStateDTO` + `WARN` (not panic — would kill hub goroutine).
- **`dispatch` recovers, and refuses gameplay at a table that has not dealt.** The floor under the
  line above, and the reason it is no longer the only thing standing between a handler bug and a
  total outage. See "One message must never be able to cost the server".
- **The container has no privilege to lose.** `server/Dockerfile` runs as uid 10001 (it binds a high
  port, reads no system path and writes one file), and `deploy/compose.yml` adds
  `no-new-privileges`, `cap_drop: ALL`, a read-only root filesystem and a tmpfs `/tmp`. The bind
  mount at `/data` stays writable, and `.gitlab-ci.yml` chowns it to 10001 and chmods it 0700,
  because a mount overrides whatever the image chowned and a container that cannot write its
  snapshot loses exactly the matches the snapshot exists to save.

## The log is off the event loop
A log line was the most expensive thing a handler did, and the only thing it did whose duration
something outside this process got to decide.

`hub/loop_bench_test.go` measures it both ways. One `log.Printf` costs about **0.9 µs** when whatever
is reading stderr keeps up and **7.3 µs** when it does not, against **8.6 µs for a whole card play**
at a four-player table. And 7.3 µs is not the ceiling: a container's stderr is a pipe, a pipe holds
64 KB, and once it is full a write does not get slower, it *waits*. A log consumer that stalls was
therefore able to stop the event loop, and the event loop is every table on the server at once.

`hub/logsink.go` is the answer, and its shape is chosen so that no call site had to change:

- **`main` swaps the writer, not the calls.** `log.SetOutput(hub.NewAsyncLog(os.Stderr, …))`, and the
  two hundred `log.Printf` calls stay exactly where they are. Through the sink the same line is
  **0.15 µs** and, far more to the point, a constant.
- **The queue is bounded and overflow is dropped, never waited on.** Waiting is the failure being
  removed; a sink that blocks when it is full has simply moved the stall. `LogQueueDepth` is 4096,
  sized for the burst after a deploy when every client reconnects at once and each one is a line.
- **What is dropped is counted and announced.** `log_lines_dropped` on `/metrics`, plus a
  `WARN log sink overflowed, N line(s) dropped` written in place. A gap nobody is told about is worse
  than a slow log: an operator reading around an incident has to be able to see that lines are
  missing. That notice goes to the underlying writer directly, never back through `log`, which would
  queue it behind exactly the backlog that produced it.
- **The line is copied on the way in.** `log.Logger` formats into a buffer it owns and reuses on the
  very next call, so a queue holding the caller's slice hands the writer goroutine whatever the
  following line overwrote it with. `TestAsyncLog_CopiesTheCallersBuffer` parks the writer goroutine
  inside the sink first, so both lines are provably still queued when the buffer is overwritten: a
  sink fast enough to drain the first one would otherwise let a missing copy pass.
- **`Close` flushes, is idempotent, and gives up.** A shutdown runs on a signal and a second signal is
  the escape hatch operators are told to use, so closing twice must not panic. The flush is bounded by
  `logCloseGrace` and drains at most the queue's capacity rather than waiting for silence, because a
  goroutine that has not noticed the shutdown yet is still logging: `readPump` logs its own exit.
- **`log.Fatal` is gone from `main`.** `os.Exit` would leave the line saying why the server never came
  up sitting in the queue, and that is the one line an operator cannot do without. It logs, closes the
  sink, then exits.

`main` also waits for the shutdown to finish now (`shutdownDone`). `ListenAndServe` returns the moment
`srv.Shutdown` is **called**, not when it has finished, so `main` was free to return and take the
process with it while the drain, the snapshot and `h.Stop` were still running. That was survivable
while all three were fast and in memory. It stops being survivable the moment the last thing a
shutdown does is flush a queue.

## Structured logging
- Stdlib `log` to **stderr** (its own default, and what `main` keeps when it installs the sink),
  **through the asynchronous sink above**. `key=value` single line, e.g.
  `room created code=ABC123 host=Alice`. Docker's `json-file` driver captures both streams, so this
  has never been a distinction an operator could see; it is written down because the sink now names
  the stream explicitly.
- Every connection-scoped line: `conn=<8-hex>` (per-`Client` random ID via `generateConnID` in `newClient`). Room-scoped also: `code=<6-char>`.
- Events: connected (conn, addr), disconnected (conn, code, nickname, playerID), reconnected, reconnect window expired, room created/deleted, match started (count, format), match finished (winner), WS upgrade errors, callback skips with reason, channel-pressure (`WARN`), **suspected cheat (`WARN suspected cheat ... conn=<id> code=<code> player=<idx> last_reason=<msg>`)**, slow client (`WARN slow client ...`).
- `WARN debug mode enabled (LOCO_E2E=1) ...` once at startup if gate on. Prod must never see this.
- No sensitive data (tokens, hands) in logs.

### `addr=` is a network prefix, never an address
Every `addr=` field goes through `hub/privacy.go`: `truncateAddr` for a raw string,
`Client.netPrefix()` for a connection. An IPv4 address is cut to its `/24` and an IPv6 one to its
`/48`, and anything that does not parse becomes `unknown` rather than falling through verbatim,
which is the path a proxy header or a unix socket would otherwise take.

**Never pass `c.conn.RemoteAddr()` or `r.RemoteAddr` to a log call.** Two reasons, and the second is
the operational one:

1. A full address is personal data, and this server holds no other. Truncating at the point of
   writing means it is never stored, which is a stronger guarantee than any retention policy this
   project has the process to keep.
2. Nothing here reads an address to identify anybody. Lines are correlated by `conn=`, which is
   per-connection, stable and meaningless outside the process. The prefix only exists to tell two
   networks apart when one of them is misbehaving, and a `/24` does that.

The client test suite enforces it, oddly but deliberately: `client/src/test/legal.test.ts` scans
`server/hub/*.go` because the assertion it is protecting is a promise made in the privacy copy, and
that is where a reader will look for it. `hub/privacy_test.go` covers the function itself. nginx
does the same truncation for its own access log (`client/nginx.conf`, the `anonymised` format), since
in production it is the process that sees the real client address. Full reasoning:
[`docs/notes/legal.md`](legal.md).

