# Architecture: the target, and the road to it

This note answers one question: **if LOCO were started today, from its rules alone, in SvelteKit and
Rust, with no account and no database, what would it look like?** Then it measures the code against
that answer. Every other note explains a subsystem as it is; this one says where the whole is going,
so a change can be judged by whether it moves towards the target or away from it.

## 1. The forces

What the design has to serve, in the order `CLAUDE.md` ranks them:

1. **Latency of a reaction.** A Contre-LOCO! or a slam is decided by arrival order. The server must
   answer on the instant a message arrives, with no queue between the socket and the table that is
   not bounded and measured.
2. **Server authority over hidden state.** The deal, the hands and every window live in one place
   that nothing else can read.
3. **Nothing persisted.** No account, no database. The only thing that outlives a process is a match
   in flight across a deploy.
4. **Streamability.** Every state readable by a spectator, every big moment legible muted.
5. **A future**: more rooms, more modes (tournament, spectators, a ranked queue someday), more
   load, more than one process.

## 2. The target, from scratch

### 2.1 Server: four layers, each depending only on the one below

```
loco-server   the binary: config from env, the listener, signals, healthcheck
   │
loco-hub      the runtime: sockets, routing, one task per table, timers, ops surfaces
   │
loco-protocol the wire: every message, generated into the client
   │
loco-game     the rules: pure, deterministic, no clock, no I/O, builds for wasm
```

- **`loco-game` is a state machine and nothing else.** One `Room`, every command a `&mut self`
  method taking `now: Millis`, validating before mutating, returning a `GameError` or the outcome.
  **One seat is one record**: everything the rules know about a chair (hand aside) lives in one
  struct indexed by seat, so removing or swapping a seat is one `Vec` operation and no parallel
  vector can drift. Serialisation of the room is the domain's own shape, in its own types.
- **`loco-protocol` is the contract**, the single source both sides are generated from. The wire is
  JSON tagged unions today; nothing above it may depend on that, so a binary encoding is a change to
  this crate and the generator alone.
- **`loco-hub` is an actor system, grouped by what a module is for, not one flat list**:

  ```
  net/      the socket edge: admission, origin, the extractor, the pumps, rate limiting, privacy
  router/   the hub loop: registration, routing by code, matchmaking, rooms index, online count
  table/    one table: the Table value, its task, its deadlines, and one module per kind of
            message it handles (gameplay, presence, rematch, bots, map gate, turn timer, emotes)
  ops/      what an operator sees and does: config, metrics, the log sink, drain, snapshot, debug
  ```

  The router owns the index of tables and the queue; **a table owns its state, its timers and its
  sockets' seats, and nothing reads it from outside** (it publishes a `Phase`). Every delay is a
  **typed** deadline in the table's state (an enum, never a string). Every message into a table is
  a job with a name; overflow is dropped and counted, never waited on.
- **The hub's `Table` is the seats' people, the domain's `Room` is the seats' game, and there is
  one seat list.** The hub's per-chair bookkeeping (occupant, token, AFK, rematch ask) and the
  domain's per-chair record are kept as one list of seats, or as two lists moved by one operation
  that cannot be called on one alone.
- **Persistence is a snapshot of the domain's own types**, versioned, written on `SIGTERM`, read
  once at boot and deleted. Its shape is ours: integers for instants, `Option` for absences,
  `snake_case` names.

### 2.2 Scaling out, when it is needed

The single process is measured (`make bench-server`: ~1.3 µs a card play, one table per task), so
there is no scaling work to do today. The design keeps the door open in one way: **a table is
addressed by its code and depends on nothing but its own task**. Scaling out is therefore sharding
by code — a thin edge that terminates the socket and forwards to the process owning the code's
shard, with the 1v1 queue on one designated shard. Nothing in the domain or the table needs to
change for that; that is the property to protect. **Do not add anything that reads across tables**
(a global leaderboard, a cross-table chat) without going through the router, or that door shuts.

### 2.3 Client: a data layer, a view layer, and two engines

```
src/routes/      SvelteKit: the site's pages, prerendered; the root layout boots the game
src/state/       the data layer: the store, the socket, the wire → store mapping, the session,
                 the preferences. Framework-free (.ts) plus its reactive windows (.svelte.ts)
src/game/        pure view logic over the store: what is pressable, what a seat shows, the
                 mirrors of the server's rules (catch availability, nickname shape, code shape)
src/components/  the screens and controls; cards/ the board renderer; scene/ the room engine
src/audio/       the sound engine and the bed
src/i18n/ src/seo/ src/content/   copy, findability, the site's prose
src/types/       generated from loco-protocol; never edited by hand
```

- **The store is a plain module with a fine-grained reactive window.** Every message from the server
  is applied by an action in one place (`serverMessages.ts` → `store/`); components never write
  game state. Svelte reads it **per field**, so an effect watching one field depends on that field
  and nothing else. A component never has to defend itself against the store's granularity.
- **Pure logic is not in `components/`**: a module that renders nothing and decides something is
  view logic and lives in `src/game/`, where it is unit-tested without a DOM.
- **The two engines (the board's layout math and the 3D room) are leaves**: they import nothing from
  the state layer and are handed what they draw.

### 2.4 The futures the design must not close

Four directions are on the table: a database, cosmetics (skins), a shop to pay for the servers, and
more than one region. **None is built ahead of time**: each one is a product and legal decision
before it is a technical one, and a table or a port written for a feature that does not exist yet
is persistence without product justification. What the design owes them today is that no current
choice makes them expensive later. For each one, here is the seam to keep open and the mistake to
avoid.

- **A database.** The seam: **the domain never learns that one exists.** `loco-game` stays pure;
  anything durable (an account, an inventory, a purchase) is the hub's, reached through a narrow
  trait owned by the hub (`trait Store`, async, called off the table's task, its answer posted back
  into the table as a job like any other). **A table never awaits storage**: a reaction window cannot
  include a database round-trip. The mistake to avoid: reusing the drain snapshot as a save format.
  It holds hands and tokens, and it exists to be read once and deleted.
- **Cosmetics.** A skin changes how something looks and never what it does, so **it is presentation
  data with server-checked ownership**: the server says which cosmetic a seat wears (an id on the
  roster, like `is_bot`), the client draws it from a registry of its own, as it does maps today
  (`maps.ts` + `MapDef`, `cardTheme.ts`). Which surfaces a skin may touch is already decided: the card
  face and back are judged final, so a skin dresses the table, the felt, the room, the seat plate,
  and the back only if that rule is lifted. The mistake to avoid: a cosmetic the server does not
  know about, which would make what a stream shows depend on the viewer's client.
- **A shop.** It needs a **durable identity**, and the game's promise is a nickname and nothing
  else. The way to keep both: playing never asks for anything, and only buying creates an identity
  (a purchase recovery key, or an account opened at checkout), held by a payment provider on the
  server's side of the line, like Twitch is today through Janus. **This is the decision that rewrites
  `legal.md`**: the first account or payment record ends "collecting nothing" as the compliance
  strategy. Take it on purpose, not as a side effect of a feature.
- **Understanding the players (monitoring, analytics).** The game already has the best possible
  source and needs no tracker in the browser for it: **the server sees every move**, as domain
  events (`GameEvent`) on the table's task. The seam: **one way out for those events**, built like the
  log sink (`logsink.rs`): a bounded queue, overflow dropped and counted, never awaited by a table, an
  exporter on the other side (Prometheus aggregates today, a warehouse later). Two levels, and the
  line between them is legal, not technical:
  - **Aggregates about the game** (matches per hour, length of a round, how often a Contre-LOCO!
    lands, where players abandon, which room is dealt and finished) carry nobody's identity, need no
    consent, and can start whenever wanted. Most "why do they leave?" questions are answered here.
  - **Anything that follows a person over time** (retention, cohorts, a funnel across visits) needs
    an identifier that outlives the session, and that is a measurement identifier in the CNIL's sense:
    a banner, or the audience-measurement exemption and its conditions, and a rewrite of the policy.
    Decide it deliberately, and together with the shop if both come, because they raise the same
    question.
  The mistakes to avoid: a third-party script in the page (it breaks "no third-party request from the
  player's browser" and the CSP at once), and analytics written from the client, which would measure
  what the client believes rather than what happened.
- **More than one region.** The seam is the one in §2.2: **a table is addressed by its code and
  reads nothing outside its own task.** A region is then a shard with its own socket host; the
  table code carries its region (a prefix, or a reserved character range), so an invitation link
  routes to the right host, and the 1v1 queue becomes one queue per region. The client already
  dials a socket origin distinct from the page's (`webSocketPolicy.ts`), so picking a region is
  picking that origin. The mistakes to avoid: anything global read on the hot path (a cross-table
  leaderboard, a global count) other than through the router, and anything that assumes one process
  owns every code.

## 3. Where the code stands

| Area | Target | Today | Verdict |
| --- | --- | --- | --- |
| Domain purity | pure, wasm | pure, wasm in CI | **on target** |
| Table ownership | one task, no lock | one task, no lock | **on target** |
| Wire contract | one source, generated | `loco-protocol` → `protocolgen`, golden frames in `tests/fixtures/` | **on target** |
| Persistence shape | ours | plain serde, `snake_case`, integer `Millis`, `null` for absence (`MatchRecord.winner` included), `SNAPSHOT_SCHEMA_VERSION` 6 | **done** |
| Comments and tests | say what the code does | no narration of a previous implementation; tests name server constants by their Rust names | **done** |
| Hub layout | grouped by purpose | `net/`, `router/`, `table/`, `ops/` | **done** |
| Deadlines | typed | `DeadlineKey` an enum | **done** |
| Store reactivity | per field | one `$state.raw` cell per top-level key (`state/gameStore.svelte.ts`); `live()` narrows computed values only | **done** |
| Client layout | data / view logic / components | `src/state/`, `src/game/`, `src/components/` | **done** |
| One seat list | one list, or two moved together | `Room.players` + five parallel vectors in `Room`, `Table.seats`, `Table.match_history`, re-based by hand at each call site | **next** |
| Table jobs | named commands | boxed closures with a label | acceptable; revisit with sharding |

The wire still writes a departed winner as `winner_index: -1` (`MatchRecordDTO`); a signed seat
exists only there.

## 4. The road

Done: the persistence shape, the hub's grouping, typed deadlines, the per-field store and the
`state/` + `game/` layout (the **done** rows of §3). A comment says what the code does and why,
never what an earlier implementation did.

Next, in order:

1. **One seat list.** Fold `Room`'s parallel vectors (`scores`, `rounds_won`, `lost_hand_total`,
   `retired`, `round_history`) into one per-seat record like `GameState.seats`, then make the hub's
   seat operations (`drop_seat`, `swap_seats`) the only callers of the domain's
   (`remove_lobby_player`, `swap_lobby_players`), so nothing can move one list without the other.
   That list is also where a seat's cosmetic will live, which is the second reason it comes first.
2. **The table code carries a region**, before invitation links are spread widely: a link printed
   today has to keep routing once there is a second region. It is a change to `RoomCode`
   (`loco-hub/src/ids.rs`) and to `tableCodeRules.ts`, and nothing else.
3. **Named table jobs** if and when tables move across processes: a closure cannot be sent, an enum
   can.
