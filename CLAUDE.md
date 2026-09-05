# CLAUDE.md

## Mission
Premium real-time multiplayer UNO-style card game **built to be streamed**. Low-latency multiplayer,
nickname-only access, server-authoritative anti-cheat, polished visuals *and* audio, strong test
coverage (TDD), docs in sync, Dockerized.

Streamability is a product requirement, not decoration: every state must be readable at 720p by a
viewer who is not playing, and the game's big moments (interception, LOCO!, victory) must be legible
in a clipped highlight with the sound muted.

## Non-negotiables
- No login/signup/OAuth: nickname only.
- Server authority is mandatory; never trust the client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.

## How this file works
**This file is a list of rules and an index. It carries no reasoning.** `docs/notes/` carries the
reasoning: the bug behind each rule, the alternatives measured and rejected, and the edge cases a
one-line rule cannot express.

**Read the matching note before working on a subsystem.** Every rule below is stated as briefly as it
can be stated, and briefly is not the same as fully: the note is where you find out why a rule is
shaped the way it is and what breaks if you reshape it. Update both in the same change set.

| Note | Covers |
| --- | --- |
| [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md) | `server/game/`: deck, scoring, draw stacks, LOCO!/catch windows, interrupts, rematch, lobby |
| [`docs/notes/server.md`](docs/notes/server.md) | `server/hub/`: anti-cheat, bots, sessions, rate limiting, map-loading gate, metrics, logging |
| [`docs/notes/client.md`](docs/notes/client.md) | realtime path, transport, session restore, protocol validation, i18n, the voice |
| [`docs/notes/visual.md`](docs/notes/visual.md) | art direction, board geometry, seats, maps, card face, motion, streamable moments |
| [`docs/notes/audio.md`](docs/notes/audio.md) | synthesis engine, track format, arrangement ladder |
| [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md) | required coverage, Playwright, GitLab pipeline, linting, Docker stacks |
| [`docs/notes/seo.md`](docs/notes/seo.md) | indexable pages, the page registry, hreflang, robots/sitemap/404, the redirect chain, build-time origin |
| [`docs/notes/legal.md`](docs/notes/legal.md) | what is processed and why, the no-banner position, address truncation, the trademark line |
| [`docs/notes/live.md`](docs/notes/live.md) | the live-streams strip: the Janus poller, the preview cache, screening a stranger's name, the strip and `/live/` |

Also: `docs/rules.md` is the authoritative game spec, `DESIGN.md` the written design system,
`PRODUCT.md` its audiences and anti-references, `docs/protocol.md`, `docs/features.md`,
`docs/deployment.md`.

**One subject, one file.** `README.md` is the stack and how to run it, `docs/features.md` the list of
what ships, `docs/deployment.md` the pipeline, the notes the reasoning. A section that restates
another file goes stale on its own schedule and then contradicts it, which is how the same feature
list ended up written twice with a link between the two copies. Write it once and link.

## Commands
`make help` lists every target. They are docker-first so a host Go install is not required; the
client and E2E targets do need Node.

| Task | Command |
| --- | --- |
| Dev stack, hot reload | `make dev` (client :5173, server :8080) then `make down` |
| All unit tests | `make test` (server + client) |
| Go tests | `make test-server`, or `cd server && go test ./...` (CI runs `-race`) |
| One Go test | `cd server && go test ./game/ -run TestRoom_ResetForRematch -v` |
| Client tests | `make test-client`, watch mode `cd client && npm run test:watch` |
| One client file / case | `cd client && npx vitest run src/test/matchmaking.test.ts -t "<title substring>"` |
| Full E2E | `make test-e2e` (needs the Go server on :8080; Playwright boots its own Vite on :4173) |
| One E2E file / case | `cd e2e && npx playwright test tests/matchmaking.spec.ts -g "<title substring>"` |
| Lint | `make lint` (golangci-lint in docker + ESLint) |
| Regenerate the protocol | `make protocol` after any change to `server/protocol/`; `make protocol-check` is what CI runs |
| Type-check | `make build-client` (`astro check && svelte-check && astro build`); no separate typecheck script |
| Visual review | `make visual ARGS="--scenes=... --viewports=wide,small,notch,landscape"` |
| Pack the rooms' models | `make models` after editing `scene/models/manifest.json` (needs the kits unpacked under `.assets-in/unpacked/`); `make models-check` says what is missing |
| Re-shoot the rooms page's stills | `make rooms` after touching a builder, the kit, the light rig or the finishing passes — commit the result |
| Deliberately outside CI | `make audio-verify`, `make csp`, `make og`, `make icons`, `make cover`, `make rooms`, `make bench-server` |

## Done means
Code + tests + passing + docs + Docker still works + behavior matches docs. **Update `README.md` when
setup, commands, architecture, limits or env change, `docs/features.md` when a feature does, and
`CLAUDE.md` plus the matching note when a rule, a convention or the structure does — in the same
change set.**

Priorities when they conflict, in order: latency, server correctness, UX smoothness, determinism,
maintainability, testability, local DX. **Avoid persistence and services without product
justification** — collecting nothing is the compliance strategy, not an accident.

## Architecture
**Server owns**: room/player/hand/deck/discard state, turn order, legality, timing windows, counter
resolution, penalties, winner. **Client owns**: presentation, input, rendering, animation, sending
intents. Client visuals may be optimistic; the server is final, timestamps received events, defines
the window, and applies documented tie-breaks.

- **A refusal that can only mean the client's state has drifted carries the correction with it**:
  `hub.refuseAction` + `game.IsStateMismatch` answer with a fresh personalised snapshot, never with
  "no" alone. Lost races are excluded on purpose.
- **Reconnect**: 60s slot hold; rejoin via nickname + room code + session token restores the slot
  with a full snapshot. The identity is mirrored into `sessionStorage`, so a **page reload** reclaims
  the seat too, not only a dropped socket. **A reclaim spends its token and is answered with a fresh
  one, which the client stores** (`player_reconnected` → `setSessionToken`): keeping the spent one
  costs nothing on this reclaim and refuses the *next* one, so it is the second reload that breaks.

## Testing
Detail, and the full required-coverage list: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- TDD, with deterministic clocks for timing logic. The Playwright suite is a living regression.
- **An untested path is where the bugs are, and the doc is not a substitute for one. When a document
  here states an invariant, there must be a test that fails without it.** Three expensive cases are
  in the note.
- **Beware assertions that only restate the fixture.** A count of zero over a fixture that rendered
  nothing passes forever.
- **A component test goes through `src/test/render.ts`, never `@testing-library/svelte` directly.**
  The library tells props from mount options by name, and `target` — which `<Reconnecting />` uses to
  mean a table or a match — is one of the six it claims; the wrapper puts everything under `props`.
  Same door for `src/test/renderHook.ts`, which is how a module that is nothing but `$effect` gets a
  component to live in.
- **The Go suite runs under `-race` in CI** (`backend_test`): here a race is the hidden-state
  guarantee coming apart, not a style problem. **Anything new that reads package state off the event
  loop has to be safe under it.**
- Review layout/colour/motion changes with `make visual`. Assertions own behaviour; screenshots own
  appearance. Cover game rules over UI details.

## Repository structure
**`client/`** Astro site + Svelte game. `astro.config.mjs` holds integrations, the dev server, the dev
toolbar (off) and the `VITE_` env prefix. **At the root: no `vite.config.ts` and no `index.html`** —
Astro owns the pages; `vitest.config.ts` is the only Vite config, and it exists because the test run
needs jsdom and the `browser` resolve condition.
- `src/pages/` one `.astro` per URL · `src/layouts/` `Base.astro`, `GamePage.astro`, `ContentPage.astro`
- `src/App.svelte` the screen switch · `src/Root.svelte` the one above it, which mounts the app or
  the curtain saying another tab holds the game · `src/entry.ts` mounts *that* into `#root` via a
  bundled module script, never an island
- `src/homeSheet.ts` the home sheet's Esc, scrim-click and ✕ · `src/lang.ts` (storage key, the two
  home paths, `chooseLang`) — framework-free, so a content page can use it · `src/langSwap.ts`
  translates the served half of `/` in place and moves the address bar, app-only · `src/pinchGuard.ts`
  the seated half of "no accidental zoom" and `src/contextGuard.ts` the same gate over the browser's
  own menu, both installed by `entry.ts`
- `src/seo/meta.ts` the page registry + link-preview tags, as data
- `src/content/` prose and data behind the content pages: `content.css`, `legal.ts`, `faq.ts`,
  `HomeProse.astro`, `CardsArticle.astro`, `LiveArticle.astro`, `TablesArticle.astro`, `liveList.ts`,
  `navMenu.ts`, `page-boot.ts`. **Never imported by the app** · `src/assets/rooms/` the six stills
  the rooms page shows, shot by `make rooms` and committed
- `src/components/` screens + shared: Lobby, WaitingRoom, GameView, GameOver, RulesModal +
  RulesButton + `cardCatalogue.ts`, Preferences + LanguageSwitcher, TableCode, AudioSettings, ActionBar, InterruptBanner,
  CatchBanner, RoundSummary, UnoTimer, CardFall, MapLoadingScreen, Reconnecting, TabTaken, ServerUpdating,
  ColorPicker, PlayerPicker, ScoreTable + `scoreTableModel.ts`, LocoLogo, `playerColors.ts`,
  `swapNoticeText.ts`, `interruptHelpers.ts`, `catchAvailability.ts`, LiveStrip + `liveStreams.ts` +
  `twitchLinks.ts`, the two server mirrors `nicknameRules.ts` + `tableCodeRules.ts`, and the queue's
  `Searching.svelte` + `searchStages.ts` / `MatchFound.svelte` / `OpponentAway.svelte`
- `src/components/cards/` the renderer: GameBoard, Hand, Card, CardBack, Deck, DiscardPile,
  PlayerSlot, TurnIndicator, DirectionRing, AnimationLayer; `layout.ts` pure pixel math;
  `CardArt.svelte` + `cardArtSpace.ts` + `locoMark.ts` the face; `CardGlyph.svelte` + `cardGlyphs.ts`
  the drawn rule glyphs; `SuitMark.svelte`; `maps.ts` (the registry: materials, accent, allowed
  skies, `resolveScene`); `cardTheme.ts`
- `src/components/scene/` the room: `sky.ts` (the hours, the skies, the light rig, framework-free),
  `rng.ts`, `kit.ts` (the prop kit, the only file that turns a block into triangles), `shade.ts`
  (the tones and the shadow polygons, pure), `placer.ts` (the ground plan, pure), `life.ts` +
  `LifeLayer.svelte` (what moves), `models/` (`manifest.json` the allowlist of packed kits, `lib.ts`
  the GLB loader and baker, `bake.ts` the pure half), `maps/<id>.ts` one builder per room +
  `maps/common.ts` + `maps/actors.ts`, `render.ts` (one frame, then the context is released),
  `sceneCache.ts` (the lazy import of the engine and the one way to ask for a frame), `quality.ts`
  (what each graphics tier buys) + `post.ts` (the finishing passes), `SceneBackdrop.svelte` +
  `WeatherLayer.svelte` + `weatherTiles.ts` (the drawn tiles the weather is made of)
- `src/audio/` `engine.ts`, `sfx.ts`, `music.ts`, `tracks/`, and `gameSounds.ts`, which **decides**
  the sounds and plays none of them
- `src/dev/` `scenes.ts` + `Showcase.svelte` + `CardSheet.svelte` + `OgCard.svelte` +
  `e2eBridge.svelte.ts` (the whole `window.__LOCO_E2E__` surface in one file), all behind
  `import.meta.env.DEV`
- `src/hooks/` splits in two, and the split is the point. **`.svelte.ts` is anything that owns
  reactive state or an effect** — a rune is only compiled in a `.svelte` or `.svelte.ts` file, so the
  extension is the declaration: `webSocket`, `gameStore` (the snapshot every component reads),
  `appEffects` (audio, session persistence, the host's streamer mode going out on the wire, the
  restore timeout), `viewEffects` (`heldKey`, `reconnectAnimation`, `turnCountdownSfx`, countdowns),
  `gamePlay` (card play, the WAAPI shakes, map preloading), `boardMetrics` (element size, safe-area
  insets), `drainBar`, `escapeKey`, `tabAlert`, `tabLock`, `prefs`, `uiPrefs`, and `live` (the one
  narrowing every effect above watches its own field through). **Everything else is framework-free on
  purpose** — the plain `.ts` files hold the store itself (`gameStore.ts` + `store/`:
  `createStore.ts`, `types.ts`, `initialState.ts`, `helpers.ts`, `deriveCatchMiddleware.ts`, and one
  module per family — `sessionActions` `tableActions` `locoActions` `matchActions` `queueActions`),
  `serverMessages.ts`, `sessionPersistence.ts`, `sessionRestore.ts`, `nicknameMemory.ts`,
  `tableInvite.ts`, `tabLock.ts`, `prefStore.ts`, and the preference and constant modules the
  reactive half wraps (`motionPref`, `colorAssist`, `streamerMode`, `webSocketPolicy`, `mapPreload`,
  `safeAreaInsets`, `graphicsPref`). **The `use` prefix went with React**: none of these is a hook,
  and **nothing in a plain `.ts` file here may reach for a rune** — it would not be compiled, and the
  failure is silent. `src/test/runeScope.test.ts` is the guard.
- `src/styles/tokens.css` design tokens · `src/i18n/` · `src/test/` (its three seams are in
  [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md)) · `public/`
- `src/types/` **generated from `server/protocol/` by `make protocol`**: `protocol.ts` (the types),
  `protocolSchemas.ts` (the Valibot schemas). Do not edit either by hand.

**`server/`** authoritative game server.
- `game/` pure domain: room, deck, hand, rules, bot, maps, event log, `nickname.go` + `wordlists/`
  + `screen.go` (the nickname matcher, exported for the one name this game did not write)
- `hub/` **one file per thing a message leads to**: `table.go` (**the** table, and the seat
  bookkeeping nothing else may do), `actor.go` (the table's goroutine, and the two ways work crosses
  between it and the hub), `hub.go` (the Hub, its tunables and ceilings, the loop),
  `serve.go`, `tokens.go`, `dispatch.go`, `rooms.go`, `rematch.go`, `gameplay.go`, `presence.go`,
  `bots.go`, `turntimer.go`, `broadcast.go`, `statedto.go`, `converter.go`, `metrics.go`, `debug.go`,
  `client.go`, `maploading.go`, `matchmaking.go`, `drain.go` + `snapshot.go`, `privacy.go`,
  `logsink.go` (the asynchronous log writer `main` installs), `live.go` (the live-streams strip's
  one crossing into the loop)
- `janus/` the gateway every third-party call leaves through, and **nothing the gateway already
  does**: no cache, no retry, no token store (`JANUS.md`)
- `twitch/` who is streaming the game: `config.go`, `helix.go`, `thumbs.go`, `poller.go`. Imports
  `janus` and `protocol`, **never `hub`**
- `protocol/` wire types, and **the single source the client's are generated from**: `messages.go`
  (the envelopes and DTOs) and `enums.go` (the wire enums, pinned to the domain by `enums_test.go`)
- `cmd/protocolgen/` the generator: reads `protocol/`, writes the client's two type files, and
  refuses anything it cannot spell honestly rather than guessing

**The rest.** `e2e/` Playwright suite (`tests/`, `helpers/game.ts`, `types.d.ts`,
`playwright.config.ts`) · `tools/` (`lib/devserver.mjs`, `visual/shoot.mjs`, `og/shoot.mjs`, `rooms/shoot.mjs`,
`cover/shoot.mjs`, `audio/verify.mjs`, `csp/check.mjs`) ·
**`brand/`** the 600×800 game covers, uploaded to IGDB and drawn by Twitch as the category's box art —
**committed and deliberately not under `client/public/`**: they are an upload · `docs/` spec +
`docs/notes/` · `LICENSE` (MIT) · `NOTICE.md` · `.gitlab-ci.yml` the only CI definition · root
config / Docker / env.

---

# Rules by subsystem

Each rule below is the short form. The note named at the head of the section is where the reasoning
is, and it is not optional reading before a change.

## Game domain
Detail: [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md). Spec: `docs/rules.md`.

**LOCO deviations from SOLO** (`docs/rules.md` §14):
1. **GlobalSwitch is wild**: 4 copies, no colour, plays on anything, names the new active colour.
2. **The starting card is always a Number**: `dealRound` skips action and wild cards.
3. **Best-of-N match format** (BO1/3/5/7), not a 600-point threshold, and **rounds won take the
   match, not points**. It stops the moment the lead cannot be caught — one expression,
   `Room.decisiveLeader`, covers the early stop and the end of the format alike.
4. **Voluntary draw is allowed**, still one draw per turn.
5. **A forced draw does not cost the turn**; `hub.handleDrawCard` re-arms the turn timer on every
   draw. **The auto-action fires `TurnTimeoutGrace` (400 ms) after the deadline the client is
   shown**, which stays `TurnTimeout`. **The grace is the server's patience and never on the wire.**
6. **Nobody forgets LOCO! and wins** (`requireLocoToFinish`, `ErrMustDeclareLoco`): every play that
   empties a hand is refused without the call. A seat already on one card must have declared
   **before** this message — a late call is always accepted, so forgetting costs a press and the
   catch risk, never the round. **A batch that empties two or more carries the call**
   (`declare_loco`), and the table hears `uno_declared` before `card_played`.
7. **A Contre-LOCO! that finds nobody costs the caller 1 card, at most once per offer, and only
   while one is on the table** (`failedCatchPenalty`, `Room.PenalizeFailedCatch`, `CatchOffered`,
   rationed by `catchOfferKey` + `CatchPaidFor`). The offer is a seat on **exactly two** cards or a
   seat with a **window still running** (5s plus `catchGrace`, 2s), so the press is a **read of the
   table** and not an answer to a cue. **The offer is the window, not the hand** — a seat can leave
   the near-finish picture with no card played. **Two, not three**, because a window a player can
   miss on purpose is a Swap away from being ammunition. **The ration is the offer, never the card
   played.** **A press against a table where nothing is offered is answered by nobody and charged to
   nobody**; a catch that *lands* spends no offer; a seat number the table does not have is refused
   rather than charged. **The card follows the picture**, so a thumb held down pays one every time
   the picture moves — and every card it pays makes the hand it is emptying bigger.
   **And a call that finds nobody also locks the caller out for 2s** (`catchLockout`,
   `GameState.CatchLockedUntil`, `Room.LockCatch` / `CatchLocked`, `ErrCatchLocked`). **The card is
   rationed per offer; the lockout is rationed per press**, and that asymmetry is the whole of it —
   the card bounded what mashing *cost* and not what it *bought*. Every fruitless press arms the
   lock, **charged or not**, and **every press made while it runs re-arms it**. While it runs the
   press **wins nothing and costs nothing**: no catch, no card, no broadcast — only `catch_locked`,
   to its own sender. A press where nothing is offered arms nothing. **Two seconds is the
   declaration it protects**, and it dies with the deal.
8. **A press is answered on the instant it arrives, and it can be lost in both directions.** Nothing
   holds a Contre-LOCO! back: the faster of the two presses wins, because a reaction the server
   delays is not a reaction it measures. `CatchHeadStart` is retired; **the two rations above
   replaced it**. **The other direction has to stay losable too**: a press made a beat after the
   window shut, or after the seat's hand grew out of reach, costs the same card as one that came too
   early. **A control that goes dark the frame the offer vanishes makes the read for the player, and
   makes it in their favour** — the same failure as announcing the call.

**The deck and the draw**
- **Deck**: 112 cards, 8-card opening hands, opening discard must be a Number. **`Deck.Replenish`
  appends the pile to what is left of the deck, never in place of it.** **Swap is coloured** and
  follows ordinary matching; the three wilds are Wild, WildDrawFour, GlobalSwitch.
- **Every wild must name a real colour**, GlobalSwitch included, and every entry point rejects a
  colourless one. `Wild` must never reach `State.ActiveColor`.
- **A draw never fails.** `DrawCard` validates first, draws through `DrawUpTo`, and only *then*
  clears `PendingDraw` and sets `HasDrawn` — nothing above that line touches state, nothing below it
  can fail. Against exhausted piles the draw shrinks rather than erroring and the seat keeps its
  turn. `Deck.DrawN` survives for dealing only.
- **Answering a draw stack is `counter_draw`, never `play_card`.** `PlayCard` refuses every card
  while `PendingDraw > 0`. A counter is the **same kind and the same colour**.

**LOCO! and the catch**
- **LOCO! tracking is per seat** (`LastCardDeclared []bool` + `LastCardAt []time.Time`). Receiving
  your last card owes a declaration exactly like playing down to it, so a Swap or GlobalSwitch opens
  catch windows on every seat left at one card. A declaration is a one-shot.
- **The four ways to empty a hand all go through the same gate**: `PlayCard`, `PlayCards`,
  `InterruptPlayCards` and `CounterDraw` each ask `requireLocoToFinish` before they mutate anything.
  **Add a fifth win path and it asks too** — a finish that skips the gate is a round taken in silence.
- **Who is on the hook is the server's to say and it rides `card_played`** (`catch_seats`, from
  `CatchableTargets` + `CatchWindowEnd`): the client renders that list and never re-derives it.

**Interrupts**
- **Interrupts have no deadline and exclude nobody.** Anyone may play N identical cards matching the
  top discard, wilds included; the player who just played and the current player may both take the
  lead back. Effects stack. **Removing those freedoms is what would make the mechanic turn-based: do
  not reinstate them.**
- **Whether the pile may still be slammed is the server's word, and it rides every message that can
  open or shut the window** (`interrupt_open` on `card_played`, `card_drawn`, `turn_changed`,
  `match_ready` and every `GameStateDTO`; `store.interruptOpen`, `clientMayInterrupt`'s fourth
  argument). A pointer on the message: false is the answer that matters, absent means unchanged.
  `interruptWindow.test.ts`.
- **The window is open from the deal, and the opening discard is a card like any other**
  (`GameState.InterruptOpen`, set by `dealRound`, distinct from `LastPlayBy`). **Bots stay out of
  that one window** — they read `LastPlayBy`, which the deal leaves at -1.

**Scoring and history**
- **Scoring**: single-finisher round, `CardValue` per `docs/rules.md` §10, cumulative `Room.Scores`,
  tiebreakers **rounds won then score** then lost-hand total then sudden death. **The score measures
  the gap, it does not crown anybody** — and `biggestLoser` stays indexed on it on purpose.
- **The table remembers its finished matches** (`table.matchHistory`, one record per match, indexed
  by seat). It **survives `resetForNextMatch`**, moves with `dropSeat` and `swapSeats`, rides the
  drain snapshot and the personalised state, and is what the evening recap is drawn from. **It also
  rides every `player_left` that re-bases the roster** — the client cannot re-base it itself.
- **Each record says how long its match was played** (`duration_ms`, from `table.matchStartedAt`
  stamped at `match_ready` — the gate is a wait, not the game). **Zero is "cannot say" and stays off
  the wire**, so a played match is rounded up to at least 1 ms. The client words it
  (`components/matchDuration.ts`) **to the second, units written out** — `12 min 34 s`, never
  `12:34`, which reads as a clock.

## Server
Detail: [`docs/notes/server.md`](docs/notes/server.md). The live strip: [`live.md`](docs/notes/live.md).

**Admission and abuse**
- **Client timestamps never decide an outcome.** Per-client token bucket at 10 msg/s, burst 20, with
  **one notice per burst**.
- **One message must never be able to cost the server.** `hub.dispatch` opens with a `recover` **and**
  a gate refusing every `isGameplayMsg` at a table not `StatusPlaying` or whose `State` is nil.
  Neither excuses a missing bounds check; `handler_panics` above zero is a bug by definition.
- **The gameplay gate also bounds the seat**: `dispatchAtTable` refuses a sender whose `playerID` is
  not an index into `State.Hands` — four entry points index a hand before they validate anything.
- **Nothing is unbounded.** `MaxClients` (5000) and `MaxConnsPerNet` (64) refused in `ServeWS`
  **before the upgrade**, against `admitConn`'s own counter, never `statClients`; `MaxRooms` (2000)
  in `handleCreateRoom`. **Reaching one in production is a signal to read the logs, not a number to
  lower.**
- **A wrong table code costs something**: `MaxFailedJoins` (20) per network per minute, refused
  before the lookup, keyed by network rather than by socket.
- **Both of those are per network, and in production this server never sees one.** The network is
  decided once by `hub.clientNet` and kept on `Client.netKey`. `ClientIPHeaders` in order
  (`CF-Connecting-IP`, then `X-Real-IP`) **only from a trusted peer** (`TrustedProxies`), and a
  multi-value header is **refused**. **That order is a security property.** Anything unbelievable
  falls back to the peer (`isRoutableClient`). Truncated on the way in.
- **Which of those headers a host may forward is the host's to declare, never the shared proxy
  block's** (`client/nginx.conf` `set $loco_cf_ip` / `$loco_real_ip`). `ws.` is grey-clouded, so it
  forwards `X-Real-IP` and empties the other; the site's host does the reverse. `csp.test.ts` pins it.
- **The upgrade checks `Origin`** (`hub.originAllowed`): hostnames must match, ports need not; a
  missing `Origin` is allowed. **`LOCO_ALLOWED_ORIGINS` is mandatory in production** — the page and
  the socket are on two hostnames, and it names the **page's** origin, never the socket's.
- **A refusal must not name the roster.** `join_room` at a table in progress answers `game already in
  progress` either way. Tokens compare with `subtle.ConstantTimeCompare`, and **a reclaim spends its
  token and is issued a fresh one**.
- **Room codes, session tokens and the room's own RNG all come from `crypto/rand`**, no fallback —
  **the deal is hidden state**, and `game/rng_test.go` runs the clock-seed attack. **Every shuffle
  that decides a hand takes it, the mid-round `Deck.Replenish` included.** `math/rand` is for bot
  jitter and nothing else.
- **The nickname is validated in the domain and refused with one string.** `game.ValidateNickname`
  owns length **in runes**, an allowlist charset and the blocked-term check; all three reach the
  player as `nickname not allowed` and **never say which rule fired**. Wordlists matched folded,
  whole-token first, **as a substring only from 6 characters up**, with `nicknameAllowSeed` for the
  collisions. **That threshold is the false-positive control: do not lower it without a test proving
  real names still pass.**
- **A refused action is not automatically suspicious.** `game.IsLostRace(err)` names what a correct
  client produces all match; handlers call `Client.noteRejection(err)`. Always `errors.Is`.

**The loop**
- **A table is one object, it owns its own goroutine, and it is the only thing that may move a seat**
  (`hub/table.go` + `hub/actor.go`). Deleting is one `delete`, a rematch's reset `resetForNextMatch()`,
  removing a seat `dropSeat(id)` — which shifts members, `playerID`s, bots and tokens **together**.
  Add per-table state as a field here, **never as a twelfth map and never as something another
  goroutine reads**.
- **The hub routes, the table decides.** `t.post(job)` and `h.postToRouter(fn)` are **both
  non-blocking**: a blocking send either way deadlocks. Overflow is dropped and counted; the drops
  that would leak something retry once. **Nothing but the hub may touch a table's fields.**
- **A table is started only once the hub has finished filling it in** (`t.start(h)`, never
  `newTable`), and it **stops existing and stops running at the same moment** (`deleteRoom`).
- **A panic is recovered on the table as well as on the hub** (`runJob`): a dead table goroutine does
  not fail, it goes quiet.
- **A socket holds one seat for its lifetime, and the seat is one atomic value** (`Client.seat`, a
  `seatRef` — never two fields written in pairs). `dispatchAtTable` re-checks the seat against the
  table about to act on it.
- **A seat that is empty must read as empty, and `awayAt` only answers half of that**: `table.gone`
  (through `hasLeft`) is the other half. **A finished ordinary table holds its seats too**, and so
  does a matchmade table in its versus reveal; a finished matchmade one does not. **`awayAt` and
  `afk` re-base with every other seat-keyed map** (`table.shiftSeatKeys`), and **an expiry finds its
  hold by the instant it began, never by the seat number it was armed with** (`heldSeatAt`).
- **Personalised sends index by slot, never by `member.playerID`.**
- **Removing a seat re-bases everything the scoreboard is drawn from** (`RemoveLobbyPlayer`), and the
  `player_left` carries the re-based `scoreboard` and `round_history`.
- **Every path that grows a hand goes through `hub.sendHandGrowth`**: the affected player gets the
  cards, everyone else the count.
- **A zero is a value, not an absence.** `turn` and `drawn_count` carry no `omitempty`;
  `pending_draw`, `has_drawn`, `player_index` and `player_id` are pointers. Read seats with
  `ServerMsg.Seat()` / `ServerMsg.OwnSeat()` (-1 = no seat named).
- **Every message carries `server_now`**, stamped where a message is marshalled (`Client.Send`,
  `broadcastToRoom`): every deadline on the wire is an absolute server instant.
- Deferred async is `time.AfterFunc`. Critical channel sends retry once then `WARN`. Broadcasts
  marshal once. `Client.SendBytes` force-closes on a full send buffer. **The versus reveal's deal is
  armed twice** (`MatchmakingRevealBackstop`): every other dropped job is lossy, that one is unbounded.
- **What the server costs is measured, not assumed** (`make bench-server`): 8.6 µs for a whole card
  play against a bucket admitting at most 50 000 msg/s. The table split was bought for **isolation,
  not throughput**. `/metrics` carries `loop_queue_depth`, `loop_queue_peak`, `loop_slowest_us` and
  `messages_dropped_busy`, on one `hubMetrics` struct, high-water marks raised by CAS. **Argue about
  scaling with those numbers or not at all.**

**A refused message must never be cheaper than an accepted one**
- **A refusal does not clear the AFK counter.** `dispatchAtTable` resets it *after* the handler and
  only when `Client.refusals` did not move; `sendError` is the single funnel that moves it.
- **A refusal answers its sender and nobody else**, unless the rules say the table pays too. Same
  rule makes `rematch` idempotent, and covers a penalty that drew nothing and a Contre-LOCO! already
  charged for this offer or aimed at a table where nothing is offered.
- **A correction is throttled** (`resyncPeriod`, 1s per socket).

**Rooms, hosts and modes**
- **A table with no host is a shape, not a mode** (`table.hostless`, `refuseWithoutHost`): a
  matchmade pair and a solo game. `add_bot`, `start_game`, `set_match_format`, `set_max_players`,
  `kick_player` and `transfer_host` are refused at both.
- **`play_bot` is a 1v1 against the server, and it is the queue's shape without the queue**
  (`hub/solo.go`): no code, no waiting room, nothing to configure, BO1. **It touches nothing the
  queue owns**, which the E2E suite depends on. Its `game_started` carries `room_code` / `player_id`
  / `session_token`. **`rematch` is the one room where it is refused.**
- **`kick_player` is the one host control that acts on a person, so it is the strictest**: host only,
  lobby only, matchmade never, **never seat 0**. The work is `releaseSeat`. **It is not a ban and
  must not become one.**
- **`transfer_host` hands the table over, and it is a seat swap** (`game.SwapLobbyPlayers` +
  `table.swapSeats`, **the token travelling with the player**). Host only, lobby only, matchmade
  never, never seat 0 and never a bot. `host_changed` is sent **per recipient**.
- **The host is seat 0, so a bot never sits there** (`hub.keepHostHuman`, from
  `reindexLobbyDisconnect` **and** `joinAtTable` — both call sites are needed).
- **`rematch` is an ask, not a decision, in every room.** Every ask is broadcast (`rematch_offered`,
  carrying the **whole** offer state and the quorum), and **two asks deal the next match at any
  size** (`RematchQuorum`; bots are not asked). **Nobody is dropped by that.** **The reopened table
  is hosted by somebody who asked for it** (`promoteRematchHost`). **A departure retires that seat's
  ask and re-bases the rest.**
- **`set_streamer_mode` is the one setting a client's *presentation* preference is allowed to reach
  the server through**. Host only, hostless never, **every status**. It carries a state and never a
  toggle, a repeat is **answered by nobody**, and the answer rides `streamer_mode_changed`,
  `room_joined` and every `GameStateDTO`. **Nothing else about a player's presentation may follow it
  here.**
- **Three fixed emotes, on the game-over screen, and no free text anywhere in this game**
  (`hub/emotes.go`, `protocol.AllEmotes`). **Closed and server-side**, **nothing is kept anywhere**,
  refused anywhere but a finished match and never to or from a bot, **both refusals broadcast
  nothing**. No per-seat cooldown — the client replaces a seat's line. Free text would be a
  moderation surface.
- **1v1 matchmaking is one FIFO queue** and its size is **never on the wire** — the number lives only
  on `/metrics`. Nothing player-facing says "unranked".
- **`players_online` is the sockets, not the queue** (`hub/online.go`): sent on registration, then
  **only when the count moves**, and **only to sockets not at a table**. **What each socket was last
  told is kept per socket** (`Client.onlineSent`). The floor is the **client's**.

**Leaving, and nobody waiting for somebody who is not there**
- A matchmade room holds a dropped seat 15s and treats 2 turn timeouts as away; **both expiries
  forfeit**, as does `leave_room`. Ordinary rooms keep 60s and 4. **The scoreboard is left alone.**
  Every room allows `leave_room` in its waiting room behind one in-place confirmation, the only one
  in the game.
- **`WalkOutFloor` = 2 is what a match needs to keep being a match**, not a permission
  (`Hub.canWalkOut`, `Room.RetireSeat`). **Evaluated once, at the ask.** Above it the seat is
  *retired*, not removed: the hand goes back to the deck, the turn steps over it, its catch window
  shuts, **and the scoreboard is left exactly as it stood**. `nextTurn`, `rotateSeats`,
  `biggestLoser` and the Swap target all know about it.
- **`leave_room` is refused nowhere, and the table decides what it does** (`leaveAtTable`, four
  branches in order): a matchmade match **forfeits**; a solo game or a table nobody can come back to
  (`table.abandonedBy`) is **closed**; above the floor the round **carries on**; at or below it the
  match **goes to the seat that stayed**. **A match nobody is at and nobody can return to ends where
  that becomes true** (`closeAbandonedMatch`).
- **A hold that runs out is settled the way `leave_room` settles the seat** (`settleExpiredSeat`,
  `retireAbsentSeat`). `expiry_settle_test.go`.
- **A deploy does not end the matches on the server.** `SIGTERM` drains (`hub/drain.go`): nothing
  starting a new match is accepted, the queue is emptied with an explanation, **every table is told
  once — every table, not only the ones playing**, **everything already running is left completely
  alone**, and the refusal list is chosen so the drain terminates. The rest goes to
  `LOCO_SNAPSHOT_PATH` (`hub/snapshot.go`): only matches in flight travel, a snapshot is never
  replayed, and a foreign `SnapshotSchemaVersion` or an age past `SnapshotMaxAge` drops the file
  whole. **`stop_grace_period` must stay above `LOCO_DRAIN_TIMEOUT`.**

**Bots and the gate**
- **Bots**: `game/bot.go` decides, `hub` schedules, through the same domain calls and broadcasts as
  humans. **A bot's Swap goes to the smallest hand and is held when it would not pay**, and **a plain
  Wild that would name the colour already active is held the same way** (`botWildIsIdle`) — it is
  only ever the colour it names, so it would move nothing; the +4 and the Rotation always pay and are
  never held. **A colour tie is broken towards the change and never bought**
  (`botPreferredColor(hand, active)`). It batches its copies as a human's tap does; **a refused bot
  move gives the turn up, never the table** (`botRecover`); `botCanPlayDrawn` asks `BotThink`, not
  `CanPlay`.
- **A bot's Contre-LOCO! is late, single and armed everywhere.** 3.2–4.4s of the 5s window, never
  past the deadline. **One attempt per window and one press, however many bots are at the table**
  (`botCatchAttempt`, derived from seat + `LastCardAt`). **Their lateness is theirs alone** —
  `BotCatchDelay` is the only thing between a bot and the instant a window opens. Armed by one
  `maybeScheduleBotReactions` after **every** action, human or bot.
- **Only `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS` are tunable from the environment** (gated on
  `LOCO_E2E=1`); **every other bot delay is a reaction window somebody is meant to be able to win.**
- **An AFK kick answers the socket, never the turn**: the clock draws and passes for the kicked seat
  like any empty chair, a reclaim clears the counter, and the auto-draw re-arms before it broadcasts.
- **Every snapshot carries `catch_seats` and `declared_seats`**, and what is the same for every
  recipient is built once per broadcast (`sharedGameState`).
- **The map-loading gate refuses every gameplay message while open**, and the turn clock starts at
  `match_ready`, not `game_started`. Per match, not per round. **Nothing arms a clock or a bot behind
  it either** (`scheduleTurnTimer`, `maybeScheduleBot`, and a bot move armed in the previous match).

**The outside world, and the operator's surfaces**
- **Every third-party call leaves through Janus, and nothing the gateway already does is written
  again here** (`JANUS.md`, `server/janus/`): no cache, no retry, no backoff, no circuit breaker, no
  token store, **no Twitch credential in this repository at all**. A 429's `Retry-After` is honoured
  by skipping ticks. `application/problem+json` means the gateway refused; any other media type means
  the API answered.
- **The live-streams poller never touches the event loop** (`server/twitch/`, `hub/live.go`): its own
  goroutine, 60s, back in through `PublishLive` → `postToRouter` alone. **Off, silently, without
  `JANUS_API_KEY`.** **A `game_id` that will not resolve switches it off rather than widening the
  query.** A non-2xx is an error, never an empty list; a list older than `LiveMaxAge` is published
  **empty**.
- **A preview from Twitch is re-served from this origin, out of memory, under a key we mint.** The
  allowlist is the last poll's answers rather than a pattern; bounds and magic bytes are checked and
  **our** `Content-Type` is written. It is what keeps `img-src 'self'` untouched.
- **A name this game did not write is screened before it is shown, and a catch drops the row rather
  than masking it** (`game.ContainsBlockedTerm` — never `ValidateNickname`). **No stream title is
  ever relayed**, and the DTO has no field for one.
- `/metrics` **and `/health`** are operator surfaces: only `docker-compose.dev.yml` publishes the Go
  server, and **nginx proxies `/ws`, `/live.json` and `/live-thumb/`, and nothing else**.
  `debug_mode_active` must be `false` in prod.
- **The server container has no privilege to lose**: uid 10001, `no-new-privileges`, `cap_drop: ALL`,
  read-only rootfs, tmpfs `/tmp`. **Treat `${DATA_DIR}/snapshots` as a secret**: every session token
  and every hand of every interrupted match.
- Structured `key=value` logging, `conn=` on every connection-scoped line, never tokens or hands.
- **The log never touches the event loop.** `main` installs `hub.NewAsyncLog` as the standard
  logger's writer. The queue is bounded, **overflow is dropped rather than waited on**, counted on
  `/metrics` (`log_lines_dropped`) and admitted in the log itself. Never route that notice back
  through `log`. `main` closes the sink last and does not call `log.Fatal`.

## Client
Detail: [`docs/notes/client.md`](docs/notes/client.md).

**Build and framework**
- **The game is never an Astro island.** A `client:*` directive emits inline scripts the CSP refuses;
  `entry.ts` is mounted by a bundled `<script>`. `csp.test.ts` fails on any `client:*` or `is:inline`.
- **`make csp` belongs after a dependency bump too**: a dependency can break the CSP without
  appearing in our sources. The validator is Valibot, not Zod, whose JIT reached for `Function()`.
- **`astro.config.mjs` puts the `VITE_` env prefix back**, which Astro narrows away (`wsEnv.test.ts`).
- **The client is Svelte 5, and React is gone — do not bring it back.** No `react`, `react-dom`,
  `@astrojs/react`, framer-motion, `.tsx` or `.module.css`. `noReact.test.ts` checks the manifest,
  both configs, every import and every file extension.
- **`astro check` does not type-check `.svelte`**: `make build-client` is `astro check &&
  svelte-check && astro build`; dropping the middle one leaves every component untyped under a green
  build. **TypeScript stays on 6.x** — three tools refuse 7.x independently.
- **Every type import is an `import type`.** A `<script lang="ts">` keeps its imports after the types
  are stripped, so `src/types/protocol.ts` gets asked for something to run.
- **`src/types/protocol.ts` and `protocolSchemas.ts` are generated and must not be edited.** A new
  wire shape goes in `server/protocol/`, then `make protocol`; CI's `protocol_check` undoes a hand edit.

**State and effects**
- **The store is ours** (`hooks/store/createStore.ts`, ~40 lines, Zustand's semantics, pinned by
  `storeCore.test.ts`). It must publish the property the creator mutated, never a copy.
- **Derived state in the store is completed by the store, never by the actions**
  (`store/deriveCatchMiddleware.ts`, `catchDerivation.test.ts`).
- **A snapshot is authoritative when it arrives and never afterwards**, so nothing carrying a board
  may be held and replayed. The round summary is an overlay; `pendingMatchEnd` is the one exception,
  because nothing follows a match end.
- **An effect that watches one field of the store reads it through `live()`**
  (`hooks/live.svelte.ts`), or a `$derived` when it is written in a component. `game.current` is one
  `$state.raw` replaced whole, so a bare `g.x` depends on the entire match. `liveDeps.test.ts`.
- **A child gets no narrowing either: reading a prop is not depending on its value.** So an animation
  effect guards on its trigger's **timestamp**, a timer effect works to an **absolute deadline**
  (`Hand`'s `dealUntil`, `drainBar`), and a once-per-key effect abandons on that **same key**, never
  in the cleanup (`mapPreload`).
- **Nothing continuous goes through reactive state.** Countdown bars use `drainBar`, never a
  percentage. `appSubscription.test.ts` counts instantiations.
- **Reading a piece of state inside the effect that writes it is a loop**; `untrack` is the way out
  (`GameBoard.svelte`).
- **A prop read once, at setup, says so with `untrack`** — otherwise Svelte warns
  `state_referenced_locally` on every one, and a build whose warnings are all expected is a build
  nobody reads. **A callback prop handed to a hook takes a closure instead** (`GameView`'s `send`).
- **A component's props are ordinary props and its events are lowercase DOM names** (`onclick`).
  Svelte silently ignores a prop it does not know, so a stale camelCase name never fires.
- **A component's CSS lives in its own `<style>` block.** A runtime class is bound with `class:`,
  never `classList.add`. **No `:global()` without a written justification.**

**The realtime path**
- **Send first, animate second.** `onCardClick` returns whether the card left the hand; the flight
  spawns only on `true`. A tap that is not a play animates nothing, and legality runs *before* the
  prompts, so a refused card opens no picker.
- **Every board control acts on the press, never on the release** (`components/press.ts`,
  `use:pressToAct`): an interject is decided by arrival order. Keyboard clicks still act; a disabled
  control fires on neither path.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, the catch key carrying its target).
- **A slam batches by itself, so it may only batch what a copy buys** (`batchForSlam`): **a plain
  wild gains nothing** and goes out alone unless the batch takes the round. `game.BotInterrupt`
  mirrors it.
- **Contre-LOCO! is pressable before the server has named anybody**
  (`components/catchAvailability.ts`, `CATCH_LIVE_MAX_HAND = 2`): any *other* seat on exactly two
  cards, or a window still running — the server's end plus `CATCH_LATE_GRACE_MS` (1s), deliberately
  under the server's `catchGrace` (2s) by the width of the wire. `serverMirrors.test.ts` pins the
  inequality, not a number. **Hand sizes, our own seat and the clock decide it, and nothing else
  may** — `isCatchLive` does not take `declaredSeats`, because going dead on a declaration would
  report it. The clock is `store.onHookUntil`, kept past the declaration and past the hand growing back.
- **There is no latch: what ends the offer is the clock and never the next card** (`catchLiveUntil`,
  one timer in `GameView`). **`store.catchSpent` is the client's copy of the server's ration**,
  suppressing the *blind* send only.
- **A call that found nobody locks the button, and the button says so** (`store.catchLockedUntil`,
  `isCatchLocked`, `ActionBar`'s padlock and drain). The lockout is the server's and arrives as an
  **absolute instant**, so nothing here mirrors its duration. **It takes the halo off too**
  (`class:armed={catchArmed && !catchLocked}`). Scene `game-catch-locked`.
- **The press is acknowledged on the frame it lands, and the verdict is still the server's**
  (`store.catchPending`, `ActionBar`'s `.called`). It presumes nothing and disables nothing.
- **Every deadline is read on the server's clock** (`hooks/serverClock.ts`): `turn_deadline`,
  `catch_seats[].ends_at`, `catch_locked_until`, `forfeit_deadline` and the snapshot's are absolute
  server instants, moved onto our clock by `localizeDeadlines` in one place. `serverClock.test.ts`.

**Transport and sessions**
- **The socket does not go through the CDN** (`webSocketPolicy.ts`): 389 ms median proxied against
  8.5 ms direct, so it is the mechanic, not the polish. `VITE_WS_ORIGIN` is baked in at build time
  (**tag only**), the **scheme comes from the page**, and it **falls back one-way** to the page's
  origin after `DIRECT_FAILURES_BEFORE_FALLBACK` sockets that never opened. The CSP keeps both
  origins; `client/Dockerfile` fails rather than shipping `__WS_DIRECT_ORIGIN__`.
- **The socket never stops trying to come back**, and four things retry it on the spot: `online`, the
  tab returning, the bfcache restore, and the reconnect curtain's button. A ceiling on attempts is a
  curtain that never comes down over a seat the server may still be holding.
- **The socket does not survive the page being frozen** (`pagehide` drops it, `pageshow` asks back on
  `persisted`). Playwright runs with the bfcache off, so `wsFreeze.test.ts` is the only guard.
- **The rejoin covers every screen a socket can drop on** (`reconnectMessageFor`).
- **One tab holds the game and the others open no socket** (`hooks/tabLock.ts`, `Root.svelte`,
  `TabTaken.svelte`): a second tab was a second player and could be paired against the first. The
  election is **one synchronous `localStorage` read before the first paint**, the record a
  **heartbeat**, and **in every doubt the tab owns the game**. It is not mounted inside `App.svelte`,
  which is the only reason `Root.svelte` exists. **Its curtain does not close on `Escape`** — the
  documented exception. Two browsers or a private window bypass all of it.
- **A table is shared as a link** (`hooks/tableInvite.ts`): `/i/?t=CODE`, carrying no language, spent
  on arrival before the first render. **A link carries a table, never a player.** The parameter is
  read on `/i/` only.
- **`/i/` is a page of its own because a link preview is served HTML**: `noindex`, absent from
  `PAGES` and from the sitemap, and it carries the invitation's own title, description and art. **The
  code stays a query parameter** — `/i/CODE` would need a fallback `astro dev` cannot be given.
  `invitePage.test.ts`.
- **The lobby remembers the last nickname** (`nicknameMemory`, `localStorage`). A prefill that
  authenticates nothing, which is why it is not the `loco_session` record.
- `initLang()`, then `initMotion()`, `initI18n()`, `initPinchGuard()`, `initTableInvite()`,
  `initSessionRestore()` in `entry.ts` before the first render, **in that order**.

**Input and controls**
- **There are no gameplay keyboard shortcuts and there must never be any.** Aiming at a button that
  lights up for a few seconds *is* the skill the game measures. **Global and focused are not the same
  thing**: a `window`/`document` listener is refused, a focused control is the accessibility path and
  must not be removed in the name of this rule. Exactly three global key listeners are allowed —
  `heldKey`, `escapeKey.svelte.ts`, the audio unlock; everywhere else a global listener may read
  `Escape` and nothing else. `noKeyboardShortcuts.test.ts`.
- **TAB at the table is the scoreboard and nothing else, from the press, and it moves no focus**
  (`heldKey`). **Shift+TAB is never taken** and is the keyboard's whole way around the board. Inside
  a dialog TAB belongs to the dialog (`components/dialogFocus.ts`).
- **Anything that opens over the board closes two ways: `Escape` and a pressable control**
  (`hooks/escapeKey.svelte.ts`). A dropdown anchored to its own opener is the one exception.
  `escapeClose.test.ts`.
- **The browser's own menu stops at the seat** (`contextGuard.ts`, gated on `data-seated`, bubble
  phase). **The landings keep it.** `contextGuard.test.ts`.
- **The hand's hover is a mouse's and nobody else's** (`Hand.svelte`, `pointerenter` gated on
  `pointerType === 'mouse'`). `handTouch.test.ts`. Same rule as the deck's `@media (hover: hover)`.
- **At a seat, text selection is refused on every element, not inherited from the body**
  (`Base.astro`, `:root[data-seated] :not(input, textarea)`). `a11y.test.ts`.
- **A control drawn under 44px gets its target from `.hit-target`, which needs `position: relative`
  on the control** or the target silently stays 40px. Segmented options keep their own height.

**Panels, preferences and chrome**
- **Player preferences live behind one gear** (`Preferences.svelte`), on every screen: language,
  graphics, streamer mode, colour shapes, reduced motion, and vibrations where the device has a motor.
  Each on/off one is a `createBooleanPref` module store. **Streamer mode is the one that also leaves
  the client**; every other one is local and must stay that way. Icons are drawn SVG, never a font
  character.
- **Fullscreen is a chip in that same row and is not a preference** (`FullscreenButton.svelte`):
  nothing stored, the icon follows the document's own `fullscreenchange`. **Desktop only**, and absent
  where `document.fullscreenEnabled` is false rather than a button that throws. `fullscreenButton.test.ts`.
- **Below 46rem there is one sheet and four surfaces wear it**: `Preferences`, `AudioSettings`,
  `RulesModal`, the home page's `<details>`. Up from the bottom edge, full width, 92vh, a 20px title
  beside a 40px ✕, the body scrolling between a pinned header and a pinned foot, `translateY(24px)` at
  `0.26s var(--ease-bounce)` — **from the edge it is anchored to, never a scale**. **46rem is the
  width, everywhere.** Only `Lobby` may pass `triggerBelowPhone={false}`; the scrim **wraps** the
  panel and its ✕ needs `position: relative`. **A sheet does not keep the dropdown's type**: labels
  15px, hints 13px, switch rows 56px, slider thumbs 30px. The ✕ is one drawn path in all four.
  `rulesModal.test.ts` reads the numbers off `Preferences.svelte`, `contentPages.test.ts` off
  `RulesModal.svelte`.
- **Both panels are one 292px dropdown above that width, and everything in them is sized to be
  pressed**: switch rows 50px, segmented options 38px, the language control 42px, a 14px track under a
  26px thumb. **A section is grouped by space and a micro-caps heading, never by a rule drawn across
  the card.**
- **Anything that opens over a screen declares its own `text-align`** — the property inherits and
  `position: fixed` does not stop it. Pinned by source scan; jsdom applies no component styles.
- **The language dropdown is ours, and it has to be**: `appearance: none` never reached the list the
  OS paints. A button plus `role="listbox"`, arrows/Enter/Home/End, `aria-activedescendant`. **Escape
  there closes the list and nothing else.**
- **The language pick applies itself, on every screen** — `setLang` plus `swapServedLang`, nothing
  reloads, so there is no Apply button and no sentence promising one. **A control that costs the page
  must not fire on the press aiming for it: if a language ever reloads again, the button comes back
  with it.**
- **Quiet is a hue, never an opacity**: `--color-muted`, never `--color-ink` at 0.34.
- **Every glyph a player sees is one we drew** (`drawnGlyphs.test.ts`, scanning every `.svelte`,
  `.astro` and both copy files): an emoji arrives at a weight and a hue nothing here chose and takes
  neither the ink outline nor the hard shadow. **The four ways a match ends are `OutcomeMark.svelte`**
  — **no trophy and no face** — same component at `size="sm"` on the round summary.
- **The rules opener is a "How to play" pill before the deal and the "?" chip at the table**
  (`RulesButton`). The pill's visible label **is** its accessible name, so it carries no `aria-label`.
- **What it opens has two halves** (`RulesModal`, "Rules" and "Cards", opening on the rules): Swap and
  Global Switch are the two cards a card-game model has no slot for. `cardCatalogue.ts` is the faces,
  `t.cardNames` / `t.cardBriefs` the words; **nothing about a card is spelled out twice**. It stays
  eight lines and **links nowhere**. `rulesModal.test.ts`.

**Copy and language**
- **The copy is the game talking, not a website.** Players open a **table**, share a table code, take
  a seat: no "lobby" in any player-facing string. French is **tutoiement**. A button is the verb about
  to happen; a refusal says what to do next and never scolds; only the streamable moments shout.
- **The name is `LOCO!`, the mark is part of it, and in French it stays glued** — never a bare `LOCO`
  and never `LOCO !` with a space. `vocabulary.test.ts` fails on either spelling in player copy and
  pins the wordmark in all three places. Internal naming is untouched. **A `<title>` is still capped
  at 60**, so the extra character is paid for in the copy.
- **One word per thing: a table is the seats, a room is the place.** `salle`, `salon` and `pièce` are
  banned outright (`vocabulary.test.ts`). Internal naming untouched; **the URLs and the `<title>`s
  keep "tables"**.
- **The five-second capsule names an opening, it does not give an order** (`t.catchWindow`): the press
  is a wager and missing is the ordinary outcome. The price is taught in the rules modal.
- **A refused action never shows a wire string.** `i18n/serverErrors.ts` maps server prose by ordered
  regex. **Add the string there when you add a server error** (`serverErrors.test.ts`).
- **The rules page opens on what is different, and the rules modal does not** (`content/contrasts.ts`,
  eight lines, **numbers taken from the server, never typed**). `contentPages.test.ts`.
- **A document is never in two languages at once, and `/` translates itself rather than navigating**
  (`data-alt*`, `langSwap.ts`, `history.replaceState` carrying the query string and the fragment).
  **The copy stays in the markup** — importing `content/ui.ts` would ship the whole site's copy to
  every player. **A link left behind is the failure that matters**, so `homeLangSwap.test.ts` counts
  `href={` against `data-alt-href={`. **`data-served-lang` is never rewritten.**
- **A stored choice wins everywhere; the browser's language wins only on `/`.** A detection is never
  persisted, because storing it would make it a choice. `chooseLang` in `lang.ts` is the one
  definition. **An invitation is not a language**, so `/i/` is served with none.
- i18n: `en.ts` is the source of truth and its `Translations` interface types `fr.ts`.

**Screens**
- **The home menu is four buttons and they are all drawn alike** (`Lobby.svelte`): 1v1, the bot, new
  table, join a table, in that order. **Hierarchy is a hue, never a smaller kind of control.**
- **The entry screen is another composition on a phone held sideways too, on the board's own height**
  (`Lobby.svelte`'s `@media (orientation: landscape) and (max-height: 559px)`, pinned to
  `LANDSCAPE_MAX_H` by `landscape.test.ts`): the lockup beside the controls, the four buttons in a
  2×2 grid, and **the padding is what clears the chrome this screen draws absolutely** — the chip row
  above (`--topbar-h`, never a literal), the live strip below. Stacked it overflowed 340px and ran
  through all of it. **Nothing here is demoted to a smaller control**; upright it is untouched.
  **The queue's two screens took the same pass**: `Searching` becomes two columns and centres
  `safe` on **both** axes — a column taller than its row overflows upwards into the row it just
  cleared — and `MatchFound` is squeezed, never recomposed. The waiting room is left alone.
- **The lobby answers a nickname as it is typed** (`nicknameRules.ts`, shape only, the word list stays
  server-side) and **disables "Take a seat" until the code is whole** (`tableCodeRules.ts`). Both
  decide nothing, and both render the line the server's refusal resolves to.
- **Every entry point is greyed out until the field holds a nickname of a usable shape, and greying
  out may only ever answer shape** — a disabled button is the one refusal a player cannot argue with.
  **A blocked term is not one of them**: that refusal arrives after the ask, and is answered by
  handing the field back focused with its contents selected.
- **Both mirrors are pinned to the Go source** (`serverMirrors.test.ts`): a mirror drifts most quietly
  by going *stricter* than the server.
- **The count of connected players is drawn from two up and absent below it**
  (`components/playersOnline.ts`, absolute so it reserves nothing; below 46rem at the foot of the
  screen, centred, on both screens that draw it). **Never rounded, never padded, never reworded.** It
  says *connected*, never *searching* — **a queue-flavoured wording would be the queue size in
  disguise**, which is off the wire on purpose. `setPlayersOnline` stays out of `resetToHome`.
- **Who is streaming the game is a strip along the foot of the entry screen, and nobody live is
  nothing at all** (`LiveStrip.svelte` + `liveStreams.ts`, fed by `live_streams`). Absolute, **entry
  screen only**, and **never at a table**. **The order is the server's, which is Twitch's**:
  `topLiveStreams` cuts and never sorts. Every `<img>` carries `width`/`height`; **no Twitch logo is
  drawn anywhere**.
- **An external address is named in one module and assembled there** (`components/twitchLinks.ts`),
  and **nothing it produces is ever a `src`**. Every outgoing link carries `noopener noreferrer external`.
- **The searching screen times its own wait, and no copy of it may imply the queue is empty**
  (`searchStage`). Entered optimistically; `endSearch` is guarded on the screen. **A forfeit never
  renders as a victory.**
- **Being found has to reach a player who is not looking**: the `matchFound` cue plus `tabAlert`,
  which **arms only while the tab is hidden** and never re-arms after a return (`tabAlert.test.ts`).
- **The board's way out is a chip in the chrome row, at every table, and never on the action bar.** It
  asks in place, and **the line under the question is the feature**: `leaveNote` picks one of four
  strings, counted the way `Hub.canWalkOut` counts. **Nothing here is greyed out.**
- **A seat leaving is told to the table, by name** (`departureNotice`, riding `noteSeatGone`).
- **A board that has stopped still says so**, off `goneSeats`, and it waits behind the reconnect
  curtains: our own socket being down may be the whole reason the table looks empty.
- **The game-over screen asks, it does not command.** Three states, every seat, every table; past two
  seats it carries the count; a table nobody is left at keeps the button **in place and disabled**. A
  matchmade table requeues without being asked (`rematchRequeue.test.ts`). **Relaunching the search is
  one message** — `find_match` gives the seat up before it enqueues. **The way out is the quietest
  control on the card.**
- **A seat is an index, and an index is only true for as long as the roster it indexes.** Which side
  of a forfeit we are on is answered **once, when `match_end` lands** (`store.forfeitedByMe`); the
  recap is **re-sent by the server**, never re-based here. Anything else that outlives a roster change
  takes the same treatment.
- **The three things are one line per seat, and that card's height is the table's size**
  (`GameOver.svelte`, `.emoteSlot`): `applyEmote` **replaces**, never appends. **The screen opens
  quiet every time** — all four doors clear it.
- **The evening's recap pins the two columns that answer it**: who, and matches taken. Heads are
  `M%n`. **The seat that took a match is a gold pill** — LOCO Red measures 2.9:1 on that panel.
- **The round past the format has a name, not a number** (`t.decisiveRound`, off `formatRounds`). The
  chip goes **gold**. The card announces the *next* one on `roundNumber >= matchRoundsNeeded &&
  !matchOverPending`, never on the format alone. **That band's fade-in delay is a mechanism, not
  polish**, and it survives reduced motion. It never says who the extra round crowns.
- **The host is told what they are choosing, on the control that chooses it** (`matchLengthModel.ts`,
  pure and tested). **It is a range, never a figure**, and the copy carries the `≈`.
- **The host's two controls over a row live behind one ⋯, never their own row, and both ask**
  (`WaitingRoom.svelte` + `RosterRowMenu.svelte`). A bot's row carries removal only — `is_bot` rides
  the roster because a nickname cannot say it. **The question takes the menu's place**; below 46rem
  the dropdown is a bottom sheet with a scrim. The removed player is reset like `left_room` and *then*
  told why.
- **The code plate says it copies a link before it is pressed** (`TableCode.svelte`, `link` prop): a
  **drawn** chain, and **outside everything streamer mode blurs**.
- **Streamer mode blurs the table code, and `TableCode.svelte` is the only way a screen prints it.**
  CSS over the real text, so copy still copies. **Nothing uncovers it — there is no reveal at all.**
  The blurred span is out of the tab order (`preferences.test.ts`).
- **The host's streamer mode is the table's, and it is the one preference that goes on the wire.** The
  client ORs it with the local preference and **never overwrites one with the other**.
  `hostStreamerSync` sends on exactly two moments, and **a change of seat sends nothing**.
  `tableStreamerMode.test.ts`, `hub/streamermode_test.go`.
- **Colour assist gives each suit a silhouette** (`SUIT_SHAPE`, `SuitMark.svelte`): on the card, every
  picker swatch and the active-colour chip. **Never a letter.** A wild stays unmarked. Anything new
  that means something by hue alone needs the mark.
- **Reduced motion is scoped to `:root[data-motion="reduce"]`, never a media query** — `full` has to
  be able to win over a system that asks for less. `initMotion()` is the whole mechanism.
  `reducedMotionCss.test.ts`, `motionPref.test.ts`.
- **Under 46rem the burger is the only way to anything the footer row carried, prose included.**
  `#navAbout` is the drawer's first line, ships `hidden`, and opens the same `<details>` sheet.
- **`/` arrives in one piece, and the background is never part of the arrival.** Hold `#root > *`,
  `.homeIntroMain`, `.homeBurger` at `opacity: 0` — **never `#root` or `.homeIntro`**, which paint the
  canvas. Opacity only, never a transform. `contentPages.test.ts`.

## Findability
Detail: [`docs/notes/seo.md`](docs/notes/seo.md).

**What a content page is**
- **A content page restates what the game already knows, so it is pinned to the source**: the rules
  page maps `t.rules` rather than copying it, and the deck table is checked against
  `server/game/deck.go` and `card.go` by `contentPages.test.ts`.
- **A content page ships no JavaScript except `page-boot.ts`.** No `client:` directive, so
  `<LocoLogo />` and every `<Card />` on `/cards/` are static markup. Anything interactive is a
  **native control**: the home sheet is `<details>`, the language chooser a `[popover]`. That one
  script also fills the live list on `/live/` (a same-origin `fetch`, so `connect-src` is untouched)
  — **still one script, still no island, still nothing third-party**.
- **`/live/` is prose first and a list second** ([`live.md`](docs/notes/live.md)). What is indexable
  is what the game gives a stream and how to appear in the category; the list of who is live is
  filled in the browser and is `WebPage`, never `Article`. Served with **a sentence rather than a
  spinner**, and everything built with `textContent` — every string in it was written by a stranger.
- **A content page is a player-facing surface, so it never says UNO either** (`seo.test.ts` extends
  `legal.test.ts`'s guard over `PAGES`, `UI` and every `src/content/**` file).

**Layout and navigation**
- **`content.css` is loaded by `GamePage.astro` too, so every selector in it is scoped to a class.**
  A bare `table`/`th`/`td` rule there would style the score table and the evening recap.
  `contentPages.test.ts` fails on a bare element selector.
- **One `--shell`, one bar, no backdrop.** Header, column and footer share one width; the navigation
  is a **fixed footer bar**, same links and order as the home page's row. `body.doc` is flat canvas.
- **The header is sticky and the bar is fixed, so both ways out are always on screen.**
- **Every in-page jump glides**: `scroll-behavior: smooth` behind `html[data-scroll="smooth"]`,
  written by `page-boot.ts` from the system preference — a media query is refused here and
  `data-motion` is the game's. **Anything that focuses an element after a smooth scroll passes
  `preventScroll: true`.**
- **Under 46rem the bar is gone and one burger is the whole navigation**, on the content pages *and*
  on `/`, styled once in `content.css`. **Only the list differs** (the game's carries no `Play`); a
  `.navPop*` rule in `GamePage.astro` is a divergence by definition. Both drawers open on the
  wordmark and carry exactly one action (`.navPopCta`). **Read the note before touching any of it**:
  the drawer, the language popover and the sticky header have six documented failure modes between
  them, five of which fail silently.
- **The language chooser's two links are real `<a href>`s** with `hreflang`/`lang`, in the document
  open or shut, and the panel keeps its ✕ — the only dismissal a phone has.

**The one palette, and the one viewport**
- **One palette, the night one, on `:root`, and nothing keys on a theme.** `noLightTheme.test.ts`
  fails on `data-theme`, `prefers-color-scheme` or `loco_theme` anywhere in the client, the E2E suite
  or the tools. **The landings are flat**: `/`, the 404 and every content page paint `--color-canvas`
  and nothing else. **The orbs were tried twice on the content pages and refused both times; do not
  bring them back.**
- **The home page is exactly one viewport and never scrolls.** The indexable markup is a quiet footer
  row plus the prose in a **native `<details>` sheet** that must keep opening with **scripts
  disabled**. **A board that can be scrolled off-screen mid-match is a bug**, and so is a lobby that
  hides text under the fold. The footer vanishes on `data-seated`: it is markup Astro rendered, so it
  is never the app's to unmount.
- **Open, that sheet is `RulesModal` down to the measurements**: the card **is** the `<details>`, the
  `<summary>` is the footer button (`order`), the scrim is a **sibling** of the card, and the ✕ ships
  `hidden` for `homeSheet.ts` to reveal. `contentPages.test.ts` reads the card off `RulesModal.svelte`.
- **The viewport may never forbid zooming** (no `user-scalable=no`, no `maximum-scale`; the
  double-tap is answered by `touch-action: manipulation` on `body`). **The seat is what costs the
  pinch, never the tag**: under `[data-seated]` the reset drops to `touch-action: pan-x pan-y` and
  `pinchGuard.ts` refuses WebKit's `gesturestart`. Safari has ignored `user-scalable=no` since iOS 10.
  **White on LOCO Red is 3.43:1**, so anything wearing it is 1.2rem or larger, never darkened. **A box
  that scrolls sideways takes `tabindex="0"`** and a `:focus-visible` ring. `a11y.test.ts`.
- **Two things keep a page fast**: `build.inlineStylesheets: 'always'` (`style-src` allows
  `'unsafe-inline'`, **scripts still may not**) and the tables page's art through `<Image />`.
- **Never fade in the element the browser measures the LCP against.** Chrome takes its candidate at
  the first paint and skips anything at `opacity: 0`, so a screen fading up from zero can produce
  **no candidate at all** — `NO_LCP`, which scores performance **0**. Fade a veil off the top instead.

**The registry, the URLs and the origin**
- **`src/seo/meta.ts` is the single source**: one entry per page, path + title + description per
  language, read by the sitemap, the `hreflang` sets, the canonical and `seo.test.ts`. **A declared
  path with no source file behind it is a failure.**
- **`/` serves its own `<h1>`, in text, and it is never the wordmark**, and it stays the only one:
  app screens head themselves at `<h2>`, and `seo.test.ts` fails on an `<h1>` under `src/components/`.
- **A title is ≤ 60 characters and a description is 100-155**, both languages, pinned by
  `seo.test.ts`. French is **written to** the ceiling, not translated into it.
- **Structured data never asks a validator for something that does not exist**: free is
  `isAccessibleForFree` never an `Offer`, a content page is a `WebPage` never an `Article`. What
  renders is the breadcrumb and the FAQ's `FAQPage`; every node joins the one `#website` and `#game`.
- **The FAQ is the `FAQPage` payload, rendered** from `src/content/faq.ts`. Its answers describe real
  server behaviour, so a change to those changes this file.
- **English at `/`, French under `/fr/`, every path slash-terminated.** Never redirect from the
  unslashed form: `/nope` has no directory either, so it loops forever. The canonical resolves it.
- **A French URL opens in French**, via `data-served-lang` on `<html>` — never `<html lang>`, which
  the i18n provider writes, so reading it makes the app detect its own last output.
- **The origin is decided at build time** (`VITE_PUBLIC_ORIGIN` → `site` + `ORIGIN`), passed as a
  Docker `ARG`. Crawlers do not run JS and never fetch a relative `og:image`.
- **Production is `ohloco.com`, dev is `loco-d.kisukesaama.com`, each declared once** (`PROD_HOST` /
  `DEV_HOST` in `.gitlab-ci.yml`). **`APP_SUBDOMAIN` names the stack, not the address** — so never
  derive one from the other. **The dev host keeps its `-d.` prefix**: `nginx.conf` keys `robots.txt`
  on that pattern and it is all that keeps dev out of the index.
- **The apex is canonical and `www.` only 301s to it, at the edge.** So `ORIGIN` carries no `www.`
  (`seo.test.ts`) and `compose.yml` carries one `Host()`. A canonical naming a redirect is reported
  as invalid by Google and looks fine to every human, because both URLs load.
- **nginx answers a missing page with a real 404**, never with the game. `robots.txt` advertises the
  sitemap on production hosts and nothing at all on `-d.`.
- **Every redirect this stack emits names a path, never an origin** (`absolute_redirect off;`): nginx
  declares no redirect and emits one anyway, and by default builds its `Location` out of `$scheme`,
  which behind Cloudflare and Traefik is always `http`. `redirects.test.ts` replays every public URL,
  both spellings, and fails on a chain that loops, leaves https, or ends anywhere but a 200.
- `make og` and `make icons` **commit their output**: CI has no browser.

## Visual
Detail: [`docs/notes/visual.md`](docs/notes/visual.md). Spec: `DESIGN.md`.

Art direction is **cartoon premium** (Nintendo x Gartic Phone). Three rules the whole UI obeys,
stated at the top of `styles/tokens.css`:
1. Every raised object has an ink outline **and** a hard bottom shadow. Soft blurs are ambience,
   never structure.
2. Nothing is pure white on pure white. The board always sits on colour.
3. Type is display-weight and large: a spectator reads it at 720p.

**Palette and geometry**
- **The palette is four families and each one means one thing**: LOCO Red acts, sunny yellow marks a
  win, electric indigo orients, signal mint confirms. **Judge a proposed colour on what it does to
  the other three, not on its provenance**, and move it inside its own family. `--color-tertiary` is
  constrained by two measured things: the focus ring wears it and must clear **3:1 on the dark card**
  (WCAG 1.4.11, currently 3.42), and `--color-link` is the same hue pushed until it clears AA on each
  canvas separately. **A colour written out by hand at a call site is the bug**; `playerColors.ts`
  moves with the token. `--radius-full` is `999px` and **never `50%`**.
- **`tableRect()` is the single authority on board geometry**, and `seatLayout()` on seating. Maps
  change how the felt is *painted*, never where anything is. Three callers must agree exactly.
- **The board is a fixed coordinate space scaled by `<div .stage>`.** Fix scale problems in
  `boardScale`/`boardSpace`, never by bumping `CARD_W` or `SEAT_DIMS`. `boardSpace` takes the
  safe-area insets.
- **A phone on its side is another composition, not a smaller one** (`layout.ts: isLandscape`,
  `LANDSCAPE_MAX_H`; decided **from pixels, once**, in `GameBoard` and `feltInViewport` and handed to
  every layout call). Seats in a column down the left, the action bar a **stack up the right edge**
  as `SIDE_RESERVE`, the felt between, the hand along the bottom safe edge, the turn pill under the
  piles (`turnPillPlace`). `landscape.test.ts`; review with `--viewports=landscape`.
- **Animate transforms, never `left`/`top`.** A node's transform has exactly one owner. Layout math
  is radians, CSS `rotate()` degrees (`radToDeg` at the render boundary and nowhere else). Hand keys
  come from `handCardKeys(hand)`, never the index.
- **The top-right chip row is absolute, so it reserves nothing**: a screen whose content can overflow
  clears it with `--space-base + --topbar-h + --space-sm + --safe-top` of top padding. `safe center`
  parks overflowing content against that padding.
- **A control drawn under 44px gets its target from `.hit-target`.**

**The mark and the card face**
- **The wordmark is a logotype, and the markup has to say so.** `<LocoLogo />` carries `role="img"`
  and `aria-label="LOCO!"` with the word `aria-hidden`. **In dark the word carries no stroke and a
  `::before` paints the outline over it**; `a11y.test.ts` fails on a stroke returning to it.
- **The card face does not follow the theme.** A card is a physical object. `LOCO_MARK_PATH` comes
  straight from the designer's source file: do not redraw, retrace or tidy it.
- **On a card the mark is a mask, never a `<path>`** (`MARK_MASK_URL`, `MARK_MASK_BOLD_URL`), so the
  browser rasterises that geometry once for all ~50 faces. `card.test.ts` fails on a live path and on
  a second mask URL. **Same rule for any new card art: one cached image, not geometry per instance.**
- **The game cover carries the wordmark and no other text** (`src/dev/CoverCard.svelte`, `make cover`
  → `brand/`), refuses platform logos, age ratings and watermarks, and **is judged at 40px** — the
  width a Twitch category is picked out of a sidebar at. Built from the real `<LocoLogo />` and the
  real `<Card />`, because the art leaves this repository. `coverCard.test.ts`.

**The board's chrome**
- **The standings are opened in order to be read, so nothing the board draws crosses them**
  (`ScoreTable`'s `.overlay`, **z-index 48**): above the transient band — notices 14, toast 30, the
  three shouts 45, chip row and leave question 46, catch capsule and round summary 47 — and below the
  reconnect curtain (50), the pickers (100), the map gate (900) and the rules modal (1000). **The
  chip row going under it is deliberate.** `scoreTable.test.ts` asserts the floor **per file**.
- **Motion must degrade to a readable static state**, not to nothing: `.armed` becomes a static halo,
  a countdown bar keeps draining under reduced motion.
- **A countdown bar is drawn back out of a slot, never scaled flat** (`loco-slide` in `tokens.css`):
  the drain is a `translateX` of the whole fill, so its rounded tip and gloss ride along instead of
  being squashed by a `scaleX`. The turn clock is a sunken slot flush with the safe top edge (chip row
  and round badge start 12px lower) holding a raised bar. **Its heat is the palette's own three in
  their own roles** (`loco-drain-heat`), never a hex in the keyframes. `drainBar` owns the timing.
- **Table news is one pill, and no arrow in any of them** (`.noticeSwap` / `.noticePenalty` /
  `.noticeDeparture`): same chrome, differing **only by the height they sit at**. **A saturated fill
  belongs to the three moments allowed to shout.** **Centred with `inset-inline: 0` +
  `margin-inline: auto`, never `left: 50%`.** **Each pill leaves with its own timer**
  (`--notice-life`). **A direction is named in the ring's own words, never drawn as `→`.**
- **The action bar never reflows, and it never empties either.** Fixed three-column grid, **Catch
  mounted in the centre column all match and nothing else ever in it**. **All three columns hold
  their button the whole match and go dead rather than away.** The penalty draw is the one recolour
  left, and it is ours only. Four states: dead, pressable, armed, and **locked** for the two seconds
  after a call of ours found nobody. **Dead also once our own wager is spent** (`GameView`'s
  `catchSpent`). A control that is live and inert is the one lie a reaction bar cannot afford.
  **Locked is the one dead state that explains itself** — the sunken slot, a drawn padlock and a
  drain to the instant the server named, **no digits**. **LOCO! is a small chip centred above the
  bar**, out of the grid, **on screen the whole match**. Never a fourth column, never something that
  appears. **`BOTTOM_RESERVE` covers the chip's band as well as the bar.**
- **A dead button on that bar is a slot cut into it, never a quieter object**
  (`--color-surface-sunken`, `--color-disabled-ink`, outline down to `--color-hairline`). **No
  opacity anywhere**: the label clears 4.5:1 on the sunken fill, because Catch sits dead through the
  opening of every round and a spectator reads it at 720p. `actionBar.test.ts` measures both.

**The room**
- **A map is a scene, a table and an accent, and none of it is a picture** (`components/scene/`,
  `maps.ts`): a diorama of coloured blocks rendered in the browser from the three ids the server
  deals; the table is CSS on `tableRect()` from the room's own materials.
  - **The room is drawn, not lit** (`scene/shade.ts`): no light object, no shadow map — tone
    multiplied into vertex colour, one hard shadow polygon per block through the stencil. **In the
    room the outline is a darker note of the block's own colour** (`inkFor`), never `INK` — the one
    place the ink rule bends. The frame is supersampled and scaled down.
  - **And then it is photographed** (`scene/post.ts`, once, before the copy): FXAA, bloom, tilt-shift,
    vignette, colour fringe, grain — half-float target in linear light, composite ending on
    `colorspace_fragment`, so a room with every pass off is the colour it always was. A GPU that
    refuses a target gets the plain frame, **never no room** (`sceneQuality.test.ts`). **The tier is
    the player's** (`hooks/graphicsPref.ts`) and **is part of the cache key**.
  - **Rendered once, then the WebGL context is released**: everything that moves is a CSS transform
    layer, because the compositing budget belongs to the cards.
  - **What moves is a sprite, built with the same kit under the same light in the same pass**
    (`scene/life.ts`, `maps/actors.ts`). **A route on the ground is a candidate, and the render
    decides where it runs** (`trimRoute`, asked with no margin). **What stands in front of a route is
    a veil over the sprite, never a cut in the route** (`occlusionVeil`, `readDepth`); a `pick` ranks
    by the length *seen*, and a survivor under its `minLen` is dropped. **Things on the ground move
    at a speed** (`WALK_SPEED`, `DRIVE_SPEED`), never for a duration. **People walk the pavements and
    cars drive the lanes** of `cityGrid`'s `StreetPlan`. Reduced motion holds the first frame.
    `sceneShade.test.ts`, `sceneLife.test.ts`.
  - **A `loop` either walks its closing leg or fades over it, and there is no third option**
    (`life.ts: closesTheRing`): a visible wrap is somebody teleporting home.
  - **The props are drawn models, and the kit is the only importer** (`scene/models/`, CC0 kits
    packed by `make models` and served from this origin — never a CDN). Loaded once per tab, palette
    **baked into vertex colours** (`bake.ts`) so a model goes through exactly the pipeline a block
    does; `k.person`, `k.car`, `k.tree`… place the model or the block, so a builder never names
    three.js or a file. **Nothing stands inside anything else**: every `k.model` goes through
    `placer.ts` and is refused when its footprint is taken. `placer.test.ts`, `modelBake.test.ts`.
  - **A resize is a stretch, and then one render** (`RESIZE_SETTLE_MS`, 240ms), **faded in over** the
    old frame on the second canvas. The engine is a lazy chunk behind `sceneCache.prepareScene`, the
    only importer of `render.ts`; **nothing else may import three.js**. **A render that fails is a
    scene, not an error.** The hour and sky reach the table as `--scene-tint` / `--scene-dark`, never
    as a repaint of `--tbl-*`; a `dry` room gets dust and a flash, never rain; every placement is
    seeded on the scene's key.
  - **The table stands on a podium the render carries under exactly the felt** (`feltInViewport`,
    `podium()`, the anchor part of the cache key). **The band in front of the table is kept low**
    (`Cell.front`). **Composition against a screen line goes through `screenSpan`**, never a
    world-space `w` and `d`. **A landmark over seven tiles tall stands in a side band, never in the
    top one.** **`renderSizeFor` reports the ratio the size was solved at**, because `anchorFor`
    divides by it. **`SceneBackdrop` isolates its own stacking context.** `sceneGeometry.test.ts`,
    `sceneBackdrop.test.ts`.
  - **What a block reaches is `(w + d) / 2 / √2` across the frame**, and both the `front` band and
    every landmark beside the table are measured against that. Cut by the **frame** is ordinary; cut
    by the table is a bug.
  - **Lights round a square are strung on a ring of posts, never four** (`maps/common.ts:
    stringLights`), each run hung by its own length **on screen**.
  - `maps.test.ts` pins the client's maps, hours and skies to `server/game/maps.go`. Add a room by
    adding a builder, a registry entry, its copy in both languages, its `MapID` and weather list in
    Go, and its scenes.
- **The three tones are the whole of the lighting, so the step between them is not a taste setting**
  (`scene/shade.ts`, 1 / 0.74 / 0.47, pinned by `sceneShade.test.ts`). The cast shadow is a **shape**,
  not a tint, for the same reason.
- **The weather is drawn tiles, and every sheet travels exactly one tile per cycle**
  (`scene/weatherTiles.ts`, `sceneWeather.test.ts`). `tiled()` writes the tile as the background
  **and** as `--tile-w` / `--tile-h`, and the keyframes travel by those, never by a literal. **The
  wind is a skew, never a diagonal travel.** Three sheets on `high`, two on `medium`, one on `light`.
- **The rooms page shows a photograph of the render, and the board's own table over it**
  (`TablesArticle.astro`, `RoomStill.svelte`, `tools/rooms/shoot.mjs`, `roomsPage.test.ts`). `make
  rooms` shoots each room at its signature hour at `?gfx=force`, into `src/assets/rooms/`. The hour
  is written twice and the test pins the two; a missing still fails the test rather than the build.

**The loading gate**
- **The room is built exactly once per match, and three things guarantee it**: `viewportSize()` and
  `safeAreaInsets()` both read synchronously, and a frame within 4% of the size asked for is
  stretched rather than re-rendered (`sizeCloseEnough`, `sameFelt`). Each missing one cost a second
  full render at the moment the gate lifted — the freeze the gate exists to hide.
  `sceneLoadingGate.test.ts`.
- **The loading bar moves because the render yields to a paint between its phases** (`RENDER_STEPS`,
  `scene/nextPaint.ts`). A `setTimeout(0)` is not a paint. **Anything new and heavy inside the render
  goes between two reports, never inside one.** `sceneProgress.test.ts`.
- **A load ends on a full bar, always** (`MAP_BAR_FULL_MS`): nothing under that bar ever reports one,
  so the settle puts it at one, paints it, holds it past `.fill`'s transition, and only then
  publishes `done` — which is what sends `map_ready`. Zero hold under reduced motion; 12s + the hold
  stays far under the server's `MapLoadTimeout`. `mapLoading.test.ts` reads the transition off
  `MapLoadingScreen.svelte`.
- **Nothing pale is shown while the room is still building.** `.scene.bare` mixes the hour's sky down
  over the void, and `--room-void` is the horizon **taken down**, not the horizon.
- **And nothing of the board is shown either: the loading curtain is opaque from its first frame.**
  The fade belongs to `.room`, never to `MapLoadingScreen`'s `.screen`, which would take the void off
  the table it exists to hide. `sceneLoadingGate.test.ts`.

**Ambience**
- **No painted ambience behind a screen: no glowing blobs, no floating silhouettes.** The canvas is
  the designed gradient and the objects on it carry the life. **A hand is dealt off the deck card by
  card** (`DEAL_FLIGHT_MS`, keyed on `roundNumber`), **numbers are counted** (`countUp.ts`) and
  **every screen arrives** (`hooks/screenIn.ts`, in only, never out).
- **Add a scene to `src/dev/scenes.ts` in the same change set as any new screen or visual state**, and
  review with `make visual` (`--viewports=wide,small` after touching `layout.ts`, `notch` for safe
  areas, `--scenes=card-sheet` for anything on a card).

## Audio
Detail: [`docs/notes/audio.md`](docs/notes/audio.md).

**Sound effects**
- **Every sound effect is synthesised at runtime; the music is not.** No sample library, and the bed
  is nineteen MP3 loops under `client/public/music/`, served from this origin and never a CDN.
- **The board plays nothing; one subscription does.** `gameAudio()` in `hooks/appEffects.svelte.ts`
  is the only place a game sound is played, and what to play is decided by `soundsForTransition` in
  `audio/gameSounds.ts` — pure, snapshot-diffing, unit-tested. A component calling `playSfx` directly
  is only ever a UI tap (`uiTap`, `uiBack`), never a game event.
- **Every sound is made of one of four materials, and none is a bare oscillator**: card stock on felt
  (`cardHit`, `snap`, `thud`, combed `noise`), wood (`mallet`, every interface sound), brass and bell
  (`stab`, `bell`), air (`whoosh`).
- **A cue is a struck chord, not a scale, and no two moments may share one** (`stab()`). `arp()` is
  gone; **do not bring it back**. **A tail is a send, never an insert** (`audio.sfxReverbSend()`):
  the card handling is paper and stays dry at zero.
- **A control that makes a sound on every step of a drag throttles it, and the sample says where the
  control now is** (`AUDITION_MS`, `playVolumeAudition(level)` climbing a pentatonic). **Level moves
  the pitch, never the gain** — the bus being moved already applies it. It takes an argument, so it
  is not a `SfxName` and `make audio-verify` measures it by hand.
- **Mobile Safari loses the context three ways and all three fail as silence, not as an error**:
  `unlock()` resumes any state that is not `running`, it is `async` and callers must await it, and
  `visibilitychange`/`focus` reclaim the context. `navigator.audioSession.type = 'playback'` at
  creation.
- **`make audio-verify` has a floor and a ceiling, and the ceiling is the newer half.** Anything
  above 0.8 fails — headroom below hard clip, not a mixing opinion: two cues overlap here and the bus
  carries no limiter.

**The bed**
- **The music is nineteen CC0 loops by Abstraction** (`audio/tracks/` the registry, `public/music/`
  the files, credit in `NOTICE.md` and `licenses.txt`), normalised to −18 LUFS and encoded to MP3.
  **MP3 and not the source OGG**: Safari refuses Ogg Vorbis in `decodeAudioData` before 18.4, which
  on this platform fails as silence. Add one by encoding a file and writing a `LoopDef`.
- **A loop is looped on the source file's duration, never the decoded buffer's** (`LoopDef.seconds`):
  MP3 carries encoder delay and padding, and both survive `decodeAudioData`.
- **The bed keeps more loops than sections, and that is what replaced the song form.** Every section
  must be carried by **at least two** loops and the groove by **at least five** (`music.test.ts`),
  and the bed changes loop for exactly two reasons: the table moved section, or this one has come
  round `LAPS_PER_LOOP` (**2**) times. **Every family carries the wait and the endgame at least twice
  over.** The breakdown is exempt.
- **A change of loop lands on the beat, and `LoopDef.bpm` is what makes that possible**
  (`untilNextBar`, `untilNextWrap`, `musicHandover.test.ts`). A section move waits for the outgoing
  loop's next bar line; a lap handover is decided `HANDOVER_LOOKAHEAD_S` early and lands **on** the
  wrap, the old piece fading over its last bar; a scene move and ⏭ are answered on the spot. **Every
  loop is a whole number of bars at the tempo written for it**, and `music.test.ts` fails on one that
  is not; where a tempo and its double both fit, the **slower** is written.
- **The fade's length is the reason for it** (`fadeFor`): a rise `RISE_FADE_S` (1.5s), a fall
  `FALL_FADE_S` (4s), a change the player made `CROSSFADE_S` (2s), the scene going off `STOP_FADE_S`
  (1.2s). **Only a hidden tab and an unmount cut.**
- **The queue is the wait and the recap is the game** (`sceneFor`, `intensityOf`): `searching` and
  `matchfound` play the menu's scene; `gameover` is the **match's** scene at the round summary's
  intensity. Only `restoring` is off.
- **A scene move changes the piece on the spot, and it is not subject to either hold**: the menu and
  the table are two places, not two tensions. `musicScene.test.ts`.
- **The intensity is slewed and the section is held** (`SLEW_PER_SEC`, `SECTION_HOLD_MS`), **and a
  fall is believed twelve seconds after a rise** (`SECTION_RELEASE_MS`): an endgame hand goes
  1 → 3 → 1 every few turns. A rise is answered on the hold; every return above the line restarts the
  wait. The breakdown is exempt.
- **A match is played inside one family** (`LoopDef.family`, `FAMILIES`). Every loop change stays in
  the palette the scene opened on, `prefetch` warms that palette only, and a scene change draws
  another family on the loop change it was making anyway.
- **A hidden tab is a pause, and the return resumes the same loop from the same bar** (`park` /
  `resume`, `resumeOffset`). Only a scene that moved meanwhile starts over.
- **A cold loop change is inaudible, and that is a property of the order, not of the warm-up.**
  `swapTo` awaits the incoming buffer *before* it touches the outgoing voice, which is why
  `PREFETCH_MAX` (3) is far smaller than the registry.
- **The number that bounds the cache is memory, not download** (`CACHE_BUDGET_BYTES`, 64 MB, LRU,
  never evicting a sounding or fading voice): a 1.5 MB MP3 of 102s decodes to **37 MB of RAM**.
  Evicting is close to free — `/music/` is served with a week of cache. **`PREFETCH_MAX` must stay
  inside that budget** (`music.test.ts`).
- **Nothing a player can see or hear moves before the piece is sounding.** `this.loop` and the
  persisted `track` are written at the **commit** inside `swapTo`, never at the request. **A request
  arriving during a swap is recorded in `desired`, never dropped.**
- **A bed with nothing sounding and nothing on its way asks again on the next tick.**
- **A loop change is a crossfade between two source gains, equal-power, and never touches `out.gain`**
  — which belongs to `duck()` alone.
- **A loop's title is a name and its blurb is copy, and only one of the two is translated.** The
  title is **one string, in English**; `music.test.ts` fails on a character outside `[A-Za-z0-9 '-]`.
  **A title names the writing, never the genre and never the source file's date.**
- Playback is a **shuffled playlist**, not a selection: no picker, one "next" button, and ⏭ stays
  inside the section the table is in.
- `make audio-verify` is the only thing that catches a broken envelope, a mis-wired node or a music
  file that 404s, because those produce silence rather than an error. Run it after touching `sfx.ts`,
  `music.ts` or `engine.ts`, or after re-encoding a loop. `music.setLapSeconds(n)` is its one seam.
  Deliberately outside CI.

## Legal and privacy
Detail: [`docs/notes/legal.md`](docs/notes/legal.md).

- **Collecting nothing is the compliance strategy.** No account, no cookie, no analytics, no tracker,
  **no third-party request from the player's browser**, nothing persisted but a match in flight
  across a deploy. **Anything that would break that is a legal change, not a technical one**: the
  first measurement cookie makes a consent banner mandatory and rewrites the policy.
- **The one third party is on the server's side of the line, and that is what keeps the sentence
  above true.** The live-streams poller asks Twitch, through Janus, on a timer, carrying nothing
  about anybody; the previews are re-served from this origin. A thumbnail loaded from Twitch would be
  a request from the reader's browser carrying their address — the tripwire, exactly. The policy
  copy says which of the two makes the request, and `legal.test.ts` pins that sentence.
- **No address is ever written in full.** `hub.truncateAddr` / `Client.netPrefix` and the `anonymised`
  `log_format` in `client/nginx.conf` cut every address to `/24` or `/48` **at the point of writing**.
  Log lines are correlated by `conn=`. **Never log `RemoteAddr()` directly**; `legal.test.ts` fails
  on any non-test file in `server/hub/` that does.
- **Privacy, terms and credits are a page, not a modal** (`/privacy/`, `/fr/confidentialite/`), linked
  from every footer, without typing a name. The copy is `src/content/legal.ts`, typed
  `Record<Lang, LegalDoc[]>` so a document cannot exist in one language only, read at build time and
  shipped in **no bundle**.
- **A line in that copy is a disclosure before it is prose.** `legal.test.ts` pins the legal basis,
  the retention period, the rights list, the CNIL, the EU statement, the storage disclosure, the
  no-banner explanation, the Mattel disclaimer and the governing law. Reword freely; keep it passing.
- **The game never says UNO to a player.** The documentation does, and the disclaimer names the mark
  in order to disclaim it; every other player-facing string in both languages is asserted clear of it.
  The whole trademark position rests on that.
- Fonts are OFL and self-hosted, so the licence ships with them as `client/public/licenses.txt`.
- **Publisher identity, host and contact address are deliberately absent.** An editorial decision,
  already taken: do not add them back and do not reopen it.

## Testing, CI and environments
Detail: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- **Every E2E test is self-contained**: no `beforeAll`, no `describe.serial`, no state carried between
  tests. That is what lets CI shard per test (`fullyParallel: true`) and `workers` be more than one
  off CI, where there is no sharding.
- **The E2E suite renders no room** (`VITE_E2E_NO_SCENE=1`, set by `playwright.config.ts` on its own
  dev server, read by `sceneCache` behind `import.meta.env.DEV`). It opens ~167 tables and asserts
  nothing about the scene — appearance is `make visual`'s — where a headless render cost 2.2s, 250
  requests and 7MB of models each. The gate is answered with the sky gradient, the path a machine
  with no WebGL already takes, so `map_ready` and every ordering behind it are unchanged. **On the
  dev server and not in an init script**: a page reaches the suite four ways and only the server is
  common to all four. `sceneLoadingGate.test.ts`.
- **A wait may not outlive the test that owns it** (`helpers/game.ts: budget()`). Helpers capped at
  60/90/120s inside a 30s test could never fire, so every hung wait read as `Test timeout of 30000ms
  exceeded` with no word about what it waited for, and an honest slow match was retried in full.
  `budget()` clamps to what the test has left; `test.setTimeout` still wins.
- **The 1v1 queue is the one server-global the suite contends on**, so `matchmaking.spec.ts` claims
  it (`helpers/matchmakingQueue.ts`: a cross-process mutex, plus a wait on `/metrics` for
  `matchmaking_queue == 0`, plus a borrowed timeout so queuing does not spend the test's budget).
  A lock on a shared resource, not shared state. **Anything else added to that queue takes it too.**
- **A fixture must state everything the assertion rests on.** `debug_set_state` sets only what it is
  given: pin `direction`, `pendingDraw: 0`, `currentTurn`, and the *colour* of a coloured card.
- The **interrupt window is open from the deal and no fixture closes it**, so a test asserting a
  refusal has to close it with a real draw or pass; keep bots out of any interrupt scenario.
- Prefer `waitForFunction` on store state over DOM polling. Use `startTurnRecorder()` whenever a bot
  seat is involved. `waitForTableOpen` on every secondary page in a multi-client test.
- **Update E2E in the same commit as gameplay/UI/protocol changes.**
- **`.gitlab-ci.yml` is the only CI definition**; the `gh` remote is a plain mirror. `build` must
  `needs` every test job, lint and E2E included, or red still ships.
- **Nothing may use `artifacts:`** until the runner is fixed: the upload fails and fails the job.
  `server-bin` travels by cache, keyed per branch with a `server-bin.sha` stamp.
- `PLAYWRIGHT_VERSION` and `e2e/package.json` are one decision: the dependency is pinned exactly and
  asserted against the image before the suite runs. There is no `playwright install` step.
- Run `make csp` after touching `nginx.conf` **or bumping a dependency**.

## Docker
Production path: Traefik to nginx (:80) to Go (:8080, internal only); **nginx proxies `/ws`,
`/live.json` and `/live-thumb/`, and nothing else** — `/health` and `/metrics` are operator surfaces
and are deliberately unreachable from the internet, and `csp.test.ts` pins that list so a fourth path
is a decision somebody takes on purpose — serves the SPA, and sends CSP / `nosniff` / `Referrer-Policy` / `Permissions-Policy` /
`Strict-Transport-Security` on every response. **HSTS carries neither `includeSubDomains` nor
`preload`**: both are promises about names this repository does not serve and cannot withdraw once a
browser has cached them.

**The socket has a second hostname**, `ws.*`, DNS-only and outside the CDN, answered by the same
nginx with `ws-proxy.conf` and a 404 for everything else. Why, and what it costs operationally, is in
[`docs/deployment.md`](docs/deployment.md).

**Those five live in `client/security-headers.conf`, and every `location` block that declares an
`add_header` of its own must `include` it** — in `nginx.conf` *and* in `client/ws-proxy.conf`, which
`csp.test.ts` scans beside it. nginx inherits `add_header` only into a level that
declares none, so one `Cache-Control` in a block silently strips all five from everything that block
serves — which is how the whole `/_astro/` bundle shipped bare while the document response, the only
one `make csp` looked at, reported clean. `csp.test.ts` fails on a block that declares without
including.

**Run `docker run` through `make` or PowerShell, never raw from Git Bash on Windows.** MSYS rewrites
`-v src:/app` into `src;C:/Program Files/Git/app`; the `-w` errors out but the mount has already made
an empty `server;C` directory at the repo root that `git status` cannot see. `MSYS_NO_PATHCONV=1` if
Bash is unavoidable.

---

## Starting a session
Read this file, then `README.md`, then **the note in `docs/notes/` for the subsystem you are about to
touch** — this file states the rules, not the reasons, and changing a rule you only half understand
is how they get undone. Look for doc drift as you go: it is silent, and the pass of 2026-08-02 found
five passages describing code that no longer existed.

Never let `CLAUDE.md`, `README.md` or `docs/notes/` go stale.
