# Server: hub, transport, operations

Everything that lives in `server/hub/`: connection management, bot scheduling, anti-cheat, metrics,
room lifecycle.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

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
- **`nginx.conf` sends the security headers** the client was already built for: a closed CSP (no
  CDN, no analytics, self-hosted fonts), `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
  `script-src` has no `'unsafe-inline'`; `style-src` must (the pre-hydration `<style>` block in
  `index.html`, plus framer-motion's inline style attributes). `connect-src` names `ws://$host` and
  `wss://$host` explicitly — a page on `http://` and a socket on `ws://` are different origins as
  far as CSP is concerned, so `'self'` alone would block the one connection the game is made of.
- **A socket holds one seat, and the room is the authority on which.** A seat is recorded twice: the
  connection knows it as `c.roomCode` / `c.playerID`, and the room knows it as the `*Client` pointer
  at index `playerID` in `roomMembers`. Nothing stopped a seated client from sending `create_room` or
  `join_room` again, and re-entering moved only the connection's copy. The pointer stayed behind in
  the old room at the old index while `c.playerID` named a seat somewhere else, and every
  personalised broadcast for the old room was then built from the wrong index, so a player seated at
  1 who rebound to seat 0 of a throwaway room was sent **seat 0's hand** in the match they had just
  left, for as long as it lasted. No tampered client, no forged message: two ordinary lobby messages
  in sequence defeated the one guarantee the server exists to provide. `hub.alreadySeated` is the
  guard, on both handlers. It does not touch reconnects, which arrive on a fresh socket whose
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
- **A refused action is not automatically suspicious.** `game.IsLostRace(err)` names the refusals a
  correct client produces all match long — a second draw, a pass that raced its draw, an interject
  whose window closed or whose top card changed, a second LOCO! — as sentinel errors, and
  `Client.noteRejection(err)` is what every gameplay handler calls instead of `noteSuspect`.
  Counting lost races made `suspected_cheats` rise fastest at the busiest, most contested tables,
  which is exactly backwards. `errors.Is`, never a string comparison: the wire text is unchanged and
  free to be reworded.

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
  wait and stages its copy off elapsed seconds instead (`Searching.tsx`).
- **Nobody presses start.** `pairMatch` creates the room, seats both players, sends `match_found`
  with `starts_in_ms`, and arms `mmStart` for `MatchmakingRevealDelay` (2.5s). `handleMatchmakingStart`
  re-checks like every deferred callback (room still there, pair not superseded, still a lobby) and
  calls `startMatch`, which shares `dealMatch` with the host's `start_game`. If one of the pair
  vanished during the reveal, `requeueSurvivor` tears the room down and puts the other back in the
  queue rather than leaving them in a two-seat room that can never start.
- **A matchmade room has no host**, so `handleAddBot`, `handleStartGame`, `handleSetMatchFormat`,
  `handleSetMaxPlayers` and `handleRematch` all begin with `refuseInMatchmade`. The format is fixed
  (BO1: a queue is entered by somebody who wants to play *now*, and a single round is the shortest
  complete thing the game has, as well as the commitment two strangers are least likely to abandon
  halfway), the size is two, and a rematch would need an agreement from a stranger who came here to
  play *somebody*. The game-over screen offers the next opponent instead.
- **Two strangers may have picked the same nickname**, and `Room.Join` refuses a duplicate. In a
  private lobby that refusal is right. Here it would fail a pairing neither player did anything wrong
  in, so `uniqueNickname` disambiguates the second one (`Alex (2)`), trimming the base first so a
  seat label cannot outgrow what it is built to hold.
- The queue is left on **disconnect** as well as on cancel (`handleDisconnect` calls `dequeue` before
  anything else): a socket that has gone away must not be paired with somebody who is still there.

## A rematch by agreement
`handleRematchOffer`, which is what `rematch` means in a matchmade room. There is no host to decide,
and the one thing known about the player opposite is that they came to play *somebody*: they may
want another and they may want the next stranger instead.

- Each side sends `rematch`, every offer is broadcast as `rematch_offered`, and the match is dealt
  only when both are in. **Both offers are public on purpose**: an offer nobody can see is an offer
  nobody answers, and the screen has to be able to say "they are waiting on you".
- `startRematchedMatch` goes through the **pairing** path, not the lobby one: another `match_found`,
  another reveal, and every screen, timer and gate downstream is the one both clients already went
  through. A matchmade rematch is a new match between the same two, not a room returning to a lobby
  this mode does not have. Same per-match cleanup as `handleRematch`, or the finished match's loading
  gate would keep the next one shut forever.
- Refused once the seat opposite is gone (`your opponent has left the table`), which is the ordinary
  case after a forfeit: the client's other button, the one that finds the next opponent, is the
  answer to that. An offer is retired by `releaseSeat` and by `deleteRoom`.
- **No timer on an offer.** An offer that is never answered costs the offerer nothing: the other
  button on that screen still works, and leaving retires the offer. A countdown would only add a
  deadline to a decision nobody is blocked on.

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
- `leave_room` is the deliberate version: immediate, no wait. It is **refused** in an ordinary match
  in progress (`you cannot leave a match in progress`): that UI offers no way out once the cards are
  dealt, and one arriving on the wire would hand a group's match away. Before the deal it is allowed
  everywhere and is not a forfeit at all: the waiting room has a quit button for host and guest
  alike, `releaseSeat` frees the seat on the spot and the rest of the table gets `player_left`. That
  is the whole point of sending it rather than closing the tab, which would hold the slot instead.
- `forfeit_deadline` rides `player_disconnected` in a matchmade room only. Without a number on
  screen, 15s of a frozen board is indistinguishable from a broken game, which is the difference
  between waiting and reloading.

## AFK auto-kick
- `hub.AFKKickThreshold` (var, default 4) consecutive turn-timeouts without voluntary action → kick (~2 rounds in 2-player). A matchmade room uses `MatchmakingAFKThreshold` (2) and forfeits instead of kicking; see above.
- Bots exempt. Voluntary inbound (play_card, draw_card, pass_turn, declare_uno, catch_uno, counter_draw, interrupt_play) calls `hub.resetAFK(code, playerID)`.
- Kick: send `{type:"error", error:"afk_kicked"}`, close. Standard reconnect window applies.
- Tests override threshold (e.g. `1<<30`).

## Bots
- Host adds via `add_bot`. Named by `nextBotName(room)` — lowest free `Bot1`, `Bot2`, … (scans, does not count seats).
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
  `delete`s `turnStartedAt[code]` on its way out, because `turnDeadlineMs` reads that map with no
  notion of whose turn it is. Leaving the previous human's entry behind put a half-spent deadline on
  every `card_played` that handed the turn to a bot, and the client mounts its countdown bar on any
  non-null deadline: it drained somebody else's clock, in urgent red, under a seat that cannot time
  out. `turn_deadline` keeps `omitempty` precisely so the resulting 0 never reaches the client (the
  one field here where a zero is an absence rather than a value, unlike `turn` / `drawn_count` /
  `pending_draw`). `TestTurnDeadline_AbsentDuringBotTurn` plays a Skip first so a live deadline is
  proven recorded before the second play asserts it gone.
- Tracked in `hub.botSlots[code][playerID]`.

## Session tokens
- 32 hex chars (128-bit `crypto/rand`).
- Issued in `room_created`/`room_joined`. Client must include `session_token` in reconnect `join_room`.
- Invalid/missing → error, slot not reclaimed.
- `hub.sessionTokens` cleaned up on room delete.

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
- Client: `store.mapLoading` / `applyMatchLoading` / `applyMatchReady`, `useMapPreload`
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

**Shrinking a hand has the mirror rule.** `removePlayedCards(hand, card, targetSize)` (exported from
`useGameStore.ts`, called by `applyCardPlayed`) drops copies of the played card until the local hand
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
- Empty room (last lobby/finished member leaves, or all in-game slots nil) → `scheduleRoomCleanup(code)`.
- `scheduleRoomCleanup`: records `emptyRooms[code]=time.Now()`, `time.AfterFunc` fires `cleanupMsg` after timeout. Channel-full → retry once after 30s, then `WARN`.
- `handleCleanup`: deletes only if `emptyRooms[code]` still matches recorded time (race-safe).
- Rejoin/reconnect calls `delete(h.emptyRooms, code)`.
- `deleteRoom(code)`: single deletion point; cleans hub maps, adjusts `statRooms`/`statBotsActive`, structured log.

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

**`checkDrained` runs after every event in `Run`, not hooked onto the handlers that can end a match.**
A match stops being in flight through the last card, a forfeit, an expired reconnect window and the
empty-room cleanup, and the path that gets forgotten is the one that leaves a deploy hanging until
its timeout. Scanning a map of rooms costs nothing next to the work the loop just did. A matchmade
room still on its versus reveal counts as in flight even though it is formally a lobby: the pair is
made and the deal is scheduled.

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
**`/metrics` is an operator surface, not a public one, and no compose file publishes the Go server
any more.** nginx proxies `/ws` and `/health` and deliberately not this, `deploy/compose.yml` only
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
- `draining` + `matches_in_flight` — this process has been asked to go and is finishing what it had. `matches_in_flight` is the number the shutdown is waiting to reach zero; it is only maintained while draining. `draining` also rides `/health`, which deliberately stays `200`: a draining server is serving its players perfectly well, and a container Docker considers unhealthy is one something else may decide to kill out from under them.

All counters atomic on `Hub`; `GetMetrics()` reads outside event loop. `statMatchesStarted` inc'd in `handleStartGame` (per `start_game`, not per round). `statMatchesFinished` inc'd in `handleRoundOrMatchEnd` when `MatchOver`. `statBotsActive` inc in `handleAddBot`, dec in `deleteRoom` by bot count.

## Server stability
- Deferred async = `time.AfterFunc` (not `go func{Sleep;send}`).
- Critical channel sends (botMove/expire/cleanup) retry once on full, then `WARN`. Rationale:
  - `botMove` retry 1s — drop stalls game.
  - `expire` retry 5s — drop leaves slot in `disconnectedAt` forever.
  - `cleanup` retry 30s — drop leaks empty room.
- Non-critical sends (per-client `send`, `inbound`) = non-blocking drop + client notification.
- **`Client.SendBytes` force-closes WS when send buffer (cap 256) fills.** Silent drop would desync client; close → readPump exit → unregister → reconnect window → auto-reconnect → `handleReconnect` snapshot. Inc `slow_clients_closed`.
- **Broadcasts marshal once.** `broadcastToRoom` does `json.Marshal(msg)` once, fans `[]byte` via `Client.SendBytes`. Per-recipient personalised payloads (game_state/game_started/private card_drawn) precompute `pl := h.playerList(room)` and call `playerGameStateUsing(room, idx, pl)` so `playerList` built once per broadcast.
- `readPump` sends to `h.inbound` non-blocking; drops notify "server busy". Prevents readPump parking on full channel deadlocking `unregister` (cap 16).
- Every scheduled callback (`executeBotMove`, `handleExpireReconnect`, `handleCleanup`) re-checks current state, logs skip reason.
- `http.Server`: `ReadHeaderTimeout:10s`, `IdleTimeout:60s`.
- Goroutine stability tests in `hub/hub_test.go`: `TestGoroutineStability_RoomLifecycle`, `_BotGame`, `_FullLifecycle`.
- `playerGameState(room, playerIdx)` defensive: nil `room.State`, OOB `playerIdx`, empty discard → minimal `GameStateDTO` + `WARN` (not panic — would kill hub goroutine).

## Structured logging
- Stdlib `log` to stdout. `key=value` single line, e.g. `room created code=ABC123 host=Alice`.
- Every connection-scoped line: `conn=<8-hex>` (per-`Client` random ID via `generateConnID` in `newClient`). Room-scoped also: `code=<6-char>`.
- Events: connected (conn, addr), disconnected (conn, code, nickname, playerID), reconnected, reconnect window expired, room created/deleted, match started (count, format), match finished (winner), WS upgrade errors, callback skips with reason, channel-pressure (`WARN`), **suspected cheat (`WARN suspected cheat ... conn=<id> code=<code> player=<idx> last_reason=<msg>`)**, slow client (`WARN slow client ...`).
- `WARN debug mode enabled (LOCO_E2E=1) ...` once at startup if gate on. Prod must never see this.
- No sensitive data (tokens, hands) in logs.

