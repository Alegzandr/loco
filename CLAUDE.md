# CLAUDE.md

## Mission
**LOCO!** is a free, real-time multiplayer card game in the browser, of the SOLO/UNO family, **built
to be streamed**: type a nickname, open a table or join the 1v1 queue, share a link, play. What we
want, overall:

- **Reactions decided fairly.** Slams, LOCO! and Contre-LOCO! are races decided by arrival order at
  an authoritative server. Latency is the mechanic, not polish.
- **A game a viewer can read.** Every state is readable at 720p by somebody who is not playing, and
  the big moments (interception, LOCO!, victory) are legible in a muted clip.
- **Cartoon premium**, in the picture and in the sound.
- **Collect nothing.** No account, no cookie, no tracker; nickname only.
- **Held by tests and true docs**: TDD, a living E2E suite, docs that describe the code as it is,
  Dockerized.

Where the architecture is going, and what it must keep possible (a database, cosmetics, a shop,
analytics, more than one region): [`docs/notes/architecture.md`](docs/notes/architecture.md).

## Non-negotiables
- No login/signup/OAuth: nickname only.
- Server authority is mandatory; never trust the client for legality or hidden state.
- Real-time reaction/counter mechanics, Dockerization, and TDD are mandatory.

## How this file works
**This file is a list of rules and an index.** `docs/notes/` carries the reasoning: the failure
behind each rule, the alternatives measured and rejected, and the edge cases a one-line rule cannot
express. **Read the matching note before working on a subsystem**, and update both in the same
change set.

| Note | Covers |
| --- | --- |
| [`docs/notes/architecture.md`](docs/notes/architecture.md) | the target architecture, where the code stands against it, the futures it keeps open, the road |
| [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md) | `server/crates/loco-game/`: deck, scoring, draw stacks, LOCO!/catch windows, interrupts, rematch, lobby |
| [`docs/notes/server.md`](docs/notes/server.md) | `server/crates/loco-hub/` and the binary: anti-cheat, bots, sessions, rate limiting, map-loading gate, drain, metrics, logging |
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
another file goes stale on its own schedule and then contradicts it. Write it once and link.

**Write the present.** A doc says what the code does and why; history belongs to `git log`. A
refusal that guards against a tempting mistake stays, as a rule.

## Commands
`make help` lists every target. They are docker-first so a host Rust install is not required; the
client and E2E targets do need Node. With cargo on the host, the `cd server && cargo …` forms below
are the same thing without the container.

| Task | Command |
| --- | --- |
| Dev stack, hot reload | `make dev` (client :5173, server :8080, `cargo watch`) then `make down` |
| All unit tests | `make test` (server + client) |
| Server tests | `make test-server`, or `cd server && cargo test --workspace` |
| One crate / one test | `cd server && cargo test -p loco-game reset_for_rematch`, `cargo test -p loco-hub --test rematch` |
| Run the server | `cd server && cargo run -p loco-server` (`LOCO_E2E=1` for the debug fixture, as E2E does) |
| Client tests | `make test-client`, watch mode `cd client && npm run test:watch` |
| One client file / case | `cd client && npx vitest run src/test/matchmaking.test.ts -t "<title substring>"` |
| Full E2E | `make test-e2e` (needs the server on :8080; Playwright boots its own Vite on :4173) |
| One E2E file / case | `cd e2e && npx playwright test tests/matchmaking.spec.ts -g "<title substring>"` |
| Lint | `make lint` (rustfmt, clippy `-D warnings` and cargo-deny in docker + ESLint) |
| Regenerate the protocol | `make protocol` after any change to `server/crates/loco-protocol/`; `make protocol-check` is what CI runs |
| Type-check | `make build-client` (`svelte-kit sync && svelte-check && vite build`, then the CSP hashes); `cd client && npm run check` alone |
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
  `refuse_action` (`loco-hub/src/table/broadcast.rs`) answers an `ErrorKind::StaleState` refusal
  with a fresh personalised snapshot, never with "no" alone. Lost races are excluded on purpose.
- **Reconnect**: 60s slot hold; rejoin via nickname + room code + session token restores the slot
  with a full snapshot. The identity is mirrored into `sessionStorage`, so a **page reload** reclaims
  the seat too. **A reclaim spends its token and is answered with a fresh one, which the client
  stores** (`player_reconnected` → `setSessionToken`); keeping the spent one breaks the *next*
  reload.

## Testing
Detail, and the full required-coverage list: [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md).

- TDD, with deterministic clocks for timing logic. The Playwright suite is a living regression.
- **When a document here states an invariant, there must be a test that fails without it.** An
  untested path is where the bugs are.
- **Beware assertions that only restate the fixture.** A count of zero over a fixture that rendered
  nothing passes forever.
- **A component test goes through `src/test/render.ts`, never `@testing-library/svelte` directly.**
  The library tells props from mount options by name, and `target` — which `<Reconnecting />` uses to
  mean a table or a match — is one of the six it claims; the wrapper puts everything under `props`.
  Same door for `src/test/renderHook.ts`, which is how a module that is nothing but `$effect` gets a
  component to live in.
- **A table task owns its state, and nothing reads it off the loop**: no lock and no shared
  reference, so the compiler refuses a second reader. **Anything new that has to be seen from
  outside a table is posted to it or published by it** (`Phase`), never read across. A handler's
  panic is caught (`catch_unwind`) and counted; `handler_panics` above zero is a bug.
- **Timing logic is tested on a paused clock** (`tokio::time::pause`, `loco-hub/src/testkit.rs`):
  the domain's `Millis` and the tasks' deadlines are one clock (`ops/clock.rs`), so a test advances
  catch windows and timers together instead of sleeping. The domain's invariants are `proptest`s and
  one round is an `insta` snapshot.
- Review layout/colour/motion changes with `make visual`. Assertions own behaviour; screenshots own
  appearance. Cover game rules over UI details.

## Repository structure
**`client/`** SvelteKit site + Svelte game, one app. `vite.config.ts` is **the** config: the
`sveltekit({...})` plugin (adapter-static, the CSP hashes, `runes`, `public/` as assets — there is no
`svelte.config.js`), the dev server and the `VITE_` env prefix; `vitest.config.ts` merges it and adds
jsdom and the `browser` resolve condition. `src/app.html` the one template, `src/hooks.server.ts` its
`<html>`/`<body>` attributes at prerender, `scripts/csp-hashes.mjs` the header's script hashes out of
the build.
- `src/routes/`: `+layout.svelte` (fonts, reset, the document's attributes, the cross-fade, **and
  the game in `#root`**), `+layout.ts` (`prerender`, `trailingSlash`), `+error.svelte`, two groups —
  `(game)/` (`+layout.svelte` the frame: head, `<h1>`, the bar with the sheet, the drawer; a page each
  for `/`, `/fr/`, `/i/`) and `(content)/` (`+layout.svelte` the shell; `[slug=pageEn]` and
  `fr/[slug=pageFr]`, one route per language with `entries` from the registry) — `404/` and the two
  `sitemap-*.xml/+server.ts` · `src/params.ts` the slug matchers (`defineParams`) ·
  `src/seo/document.ts` `routeFor(pathname)`: every URL's page, language and `<html>`/`<body>`
- `src/layouts/` `Head.svelte`, `GamePage.css` (the game frame's document rules), `NotFound.svelte`,
  `ToTop.svelte`, and the site's one chrome: `SiteFooter.svelte` (the bar), `SiteDrawer.svelte` (the
  burger and the drawer)
- `src/App.svelte` the screen switch · `src/Root.svelte` the one above it, which renders the app or
  the curtain saying another tab holds the game · `src/boot.ts` the ordered boot sequence
  (`bootGame`) and the reveal (`markBooted`)
- `src/lang.ts` (storage key, the two home paths, `chooseLang`) — framework-free · `src/langRoute.ts`
  acts on it: `initLang`, `moveTo` (a `goto` in place of the history entry) · `src/pinchGuard.ts`
  the seated half of "no accidental zoom" and `src/contextGuard.ts` the same gate over the browser's
  own menu, both installed by `boot.ts`
- `src/seo/meta.ts` the page registry + link-preview tags, as data
- `src/content/` prose and data behind the content pages: `content.css`, `legal.ts`, `faq.ts`,
  `HomeProse.svelte`, `CardsArticle.svelte`, `LiveArticle.svelte`, `TablesArticle.svelte`,
  `RulesArticle.svelte`, `FaqArticle.svelte`, `FriendsArticle.svelte`, `LegalArticle.svelte`,
  `deck.ts` (the deck as the content pages read it), `contrasts.ts`, `ui.ts` (the pages' own chrome
  strings), `Article.svelte` (which article is which page), `liveList.ts` (`fetchLiveRows`). **Never
  imported by the app** · `src/assets/rooms/` the six stills the rooms page shows, shot by
  `make rooms` and committed · `src/assets/plates/` the painted rooms' plates and their tables' two
  strips, three WebPs a room, made by `tools/plates` and committed
- `src/state/` the data layer, and the split is the point. **`.svelte.ts` is anything that owns
  reactive state or an effect** — a rune is only compiled in a `.svelte` or `.svelte.ts` file, so the
  extension is the declaration: `webSocket`, `gameStore` (Svelte's window onto the store, one signal
  per field), `live` (narrows a value computed from a field, a nested field or a prop), `appEffects`
  (audio, session persistence, the host's streamer mode going out on the wire, the restore timeout),
  `viewEffects` (`heldKey`, `reconnectAnimation`, `turnCountdownSfx`, countdowns), `gamePlay` (card
  play, the WAAPI shakes, map preloading), `boardMetrics` (element size, safe-area insets),
  `drainBar`, `escapeKey`, `bedMuffle`, `tabAlert`, `tabLock`, `gameShown`, `prefs`, `uiPrefs`.
  **Everything else is framework-free on purpose** — the store itself (`gameStore.ts` + `store/`:
  `createStore.ts`, `types.ts`, `initialState.ts`, `helpers.ts`, `deriveCatchMiddleware.ts`, and one
  module per family — `sessionActions` `tableActions` `locoActions` `matchActions` `queueActions`),
  `serverMessages.ts`, `sessionPersistence.ts`, `sessionRestore.ts`, `nicknameMemory.ts`,
  `tableInvite.ts`, `tabLock.ts`, `prefStore.ts`, `serverClock.ts` (every deadline onto our clock),
  `screenIn.ts` (every screen arrives), `haptics.ts`, and the preference and constant modules the
  reactive half wraps (`motionPref`, `colorAssist`, `streamerMode`, `webSocketPolicy`, `mapPreload`,
  `safeAreaInsets`, `graphicsPref`). **Nothing in a plain `.ts` file here may reach for a rune** — it
  would not be compiled, and the failure is silent. `src/test/runeScope.test.ts` is the guard.
- `src/game/` pure view logic over the store, unit-tested without a DOM: what is pressable
  (`catchAvailability.ts`, `interruptHelpers.ts`), the server's mirrors (`nicknameRules.ts`,
  `tableCodeRules.ts`), the models behind a screen (`scoreTableModel.ts`, `matchRecapModel.ts`,
  `matchLengthModel.ts`, `matchDuration.ts`, `searchStages.ts`, `swapNoticeText.ts`,
  `playersOnline.ts`, `playerColors.ts`, `emotes.ts`, `cardCatalogue.ts`), and the live strip's
  (`liveStreams.ts`, `twitchLinks.ts`). **A module that renders nothing and decides something goes
  here, not in `components/`.**
- `src/components/` screens + shared: Lobby, WaitingRoom, GameView, GameOver, RulesModal +
  RulesButton, Preferences + LanguageSwitcher, TableCode, AudioSettings, ActionBar, InterruptBanner,
  CatchBanner, RoundSummary, UnoTimer, CardFall, MapLoadingScreen, Reconnecting, TabTaken,
  ServerUpdating, ColorPicker, PlayerPicker, ScoreTable, LocoLogo, HomeHands, LiveStrip, the queue's
  Searching / MatchFound / OpponentAway, FullscreenButton, OutcomeMark (the four ways a match ends),
  RosterRowMenu (the host's ⋯); and `press.ts` (`use:pressToAct`), `dialogFocus.ts`, `countUp.ts`,
  `fpsMeter.ts`
- `src/components/cards/` the renderer: GameBoard, Hand, Card, CardBack, Deck, DiscardPile,
  PlayerSlot, TurnIndicator, DirectionRing, TableTrack, FeltInlay, AnimationLayer; `layout.ts` pure
  pixel math; `tableSurface.ts` (the rim's material as a seeded SVG noise image, for the board and the
  rooms page); `CardArt.svelte` + `cardArtSpace.ts` + `locoMark.ts` the face; `CardGlyph.svelte` +
  `cardGlyphs.ts` the drawn rule glyphs; `SuitMark.svelte`; `maps.ts` (the registry: materials,
  accent, allowed skies, `resolveScene`); `cardTheme.ts`
- `src/components/scene/` the room engine, framework-free and pure wherever it can be
  ([`docs/notes/visual.md`](docs/notes/visual.md)). The files the rules point at: `look.ts` (**every visual number the render reads**), `kit.ts` (the only
  file that turns a block into triangles), `view.ts` (the camera solved to the felt), `maps/<id>.ts`
  one builder per room, registered in `maps/index.ts` with the kits it loads, `maps/vista.ts` what
  every room shares, `models/` (`manifest.json` the allowlist of packed kits), `render.ts` (one
  frame, then the context is released), `sceneCache.ts` (the lazy import of the engine and the one
  way to ask for a frame), `post.ts` (the finishing passes), `plates.ts` + `plate.ts` (the painted
  rooms), `SceneBackdrop.svelte` + `WeatherLayer.svelte`
- `src/audio/` `engine.ts`, `sfx.ts`, `music.ts`, `tracks/`, `harmony.ts` (keys, and whether two
  loops may be overlapped — pure), and `gameSounds.ts`, which **decides** the sounds and plays none
- `src/dev/` `scenes.ts` + `Showcase.svelte` + `CardSheet.svelte` + `OgCard.svelte` +
  `CoverCard.svelte` (`make cover`) + `RoomStill.svelte` (`make rooms`) + `e2eBridge.svelte.ts` (the
  whole `window.__LOCO_E2E__` surface) + `lookPanel.ts` (the lil-gui panel over `scene/look.ts`,
  `?look=1`), all behind `import.meta.env.DEV`
- `src/styles/tokens.css` design tokens · `src/i18n/` (`en.ts`, `fr.ts`, `store.ts` the
  framework-free language, `i18n.svelte.ts` Svelte's window onto it, `serverErrors.ts`) ·
  `src/test/` (its seams are in [`docs/notes/testing-ci.md`](docs/notes/testing-ci.md)) · `public/`
- `src/types/` **generated from `server/crates/loco-protocol/` by `make protocol`**: `protocol.ts`
  (the types), `protocolSchemas.ts` (the Valibot schemas). Do not edit either by hand.

**`server/`** authoritative game server: a Cargo workspace (edition 2024, `members =
["crates/*"]`, every version in `[workspace.dependencies]`, `unsafe_code` forbidden), `deny.toml`
(cargo-deny: licences, advisories, sources), `Dockerfile`.
- `crates/loco-game/` the pure domain: `room.rs` (the `Room`, one `RoomSeat` per seat, every
  command, the constants),
  `state.rs` (`GameState`, one `SeatState` per seat, the catch windows), `rules.rs`, `deck.rs`,
  `card.rs`, `hand.rs`, `bot.rs`, `maps.rs`, `event.rs`, `error.rs` (`GameError`, `ErrorKind`),
  `rng.rs`, `nickname.rs` + `wordlists/` + `screen.rs` (the nickname matcher, exported for the one
  name this game did not write); `SavedRoom` is the room's own serde shape for the drain snapshot;
  `API.md` the map of every entry point; tests under `src/tests/` (proptests and one `insta` round)
- `crates/loco-hub/` the runtime, **grouped by what a module is for**:
  - `net/` the socket edge: `serve.rs` (admission, origin), `client.rs` (the socket, its pumps, its
    rate limiter, `Client::refuse`), `wire.rs` (decoding), `privacy.rs` (**the only module that sees
    a peer's address**)
  - `router/` the hub loop: `hub.rs` (the `Hub` handle and the loop), `dispatch.rs`, `rooms.rs`,
    `matchmaking.rs`, `online.rs` (`players_online`), `live.rs` (the live strip's one crossing into
    the loop), `solo.rs` (`play_bot`)
  - `table/` one table: `mod.rs` (**the** table, one `Seat` per chair, and the seat bookkeeping
    nothing else may do), `actor.rs` (the task, its mailbox, its `Deadlines`, and the two ways work
    crosses between it and the hub), one module per kind of message (`gameplay.rs`, `presence.rs`,
    `rematch.rs`, `bots.rs`, `turntimer.rs`, `maploading.rs`, `emotes.rs`, `debug.rs`), and
    `broadcast.rs`, `statedto.rs`, `convert.rs`, `refusal.rs` (every refusal string), `room.rs`
    (`new_room` / `restore_room`, OS-seeded)
  - `ops/` what an operator sees: `config.rs` (`HubConfig`, every tunable), `clock.rs` (one
    timeline), `metrics.rs`, `logsink.rs` (the asynchronous log writer `main` installs), `drain.rs`,
    `snapshot.rs`
  - at the root `ids.rs` (`RoomCode`, `SessionToken`), `tokens.rs` (mints codes, tokens and room
    seeds), `testkit.rs`; integration tests in `tests/`, internal ones in `src/internal_tests/`, the
    bench in `benches/hub.rs`
- `crates/loco-server/` the binary: `main.rs` (configuration, the drain on `SIGTERM`, the
  `healthcheck` subcommand) and `http.rs` (the listener)
- `crates/loco-janus/` the gateway every third-party call leaves through, and **nothing the gateway
  already does**: no cache, no retry, no token store (`JANUS.md`)
- `crates/loco-twitch/` who is streaming the game: `config.rs`, `helix.rs`, `thumbs.rs`,
  `poller.rs`. Depends on `loco-janus` and `loco-protocol`, **never `loco-hub`**
- `crates/loco-protocol/` wire types, and **the single source the client's are generated from**:
  `client.rs`, `server.rs` (tagged unions on `type`), `dto.rs`, `enums.rs` (the wire enums, pinned to
  the domain by `tests/enums.rs`), `generate.rs`; `tests/parity.rs` holds the wire to the golden
  frames in `tests/fixtures/` (`server.jsonl`, `client.jsonl`)
- `crates/protocolgen/` the generator: `ts-rs` for the types, `schemars` +
  `tools/protocol/valibot.mjs` for the validators, which refuses anything it cannot spell honestly
  rather than guessing

**The rest.** `e2e/` Playwright suite (`tests/`, `helpers/game.ts`, `types.d.ts`,
`playwright.config.ts`) · `tools/` (`lib/devserver.mjs`, `visual/shoot.mjs`, `og/shoot.mjs`,
`rooms/shoot.mjs`, `plates/guide.mjs` + `plates/paint.py` + `plates/trim.py` + `plates/prompts/`,
`cover/shoot.mjs`, `audio/verify.mjs`, `csp/check.mjs`) · **`brand/`** the 600×800 game covers,
uploaded to IGDB and drawn by Twitch as the category's box art — **committed and deliberately not
under `client/public/`**: they are an upload · `docs/` spec + `docs/notes/` · `LICENSE` (MIT) ·
`NOTICE.md` · `.gitlab-ci.yml` the only CI definition · root config / Docker / env.

---

# Rules by subsystem

Each rule below is the short form. The note named at the head of the section is where the reasoning
is, and it is not optional reading before a change.

## Game domain
Detail: [`docs/notes/domain-rules.md`](docs/notes/domain-rules.md). Spec: `docs/rules.md`. The map of
every entry point: `server/crates/loco-game/API.md`.

**The crate's shape**
- **`loco-game` is pure**: no clock, no I/O, no OS randomness. Every command that stamps or compares
  an instant takes `now: Millis` last (the instant the hub received the message). It builds for
  `wasm32-unknown-unknown` (CI checks it).
- **One way in.** Every command is a `&mut self` method on `Room` that **validates before it
  mutates**: a refusal leaves the room exactly as it was (the proptests hold every command to that).
- **A seat is `usize`, and nobody is `None`** (`Seat`, `Option<Seat>`). A signed seat exists only on
  the wire (`loco-protocol`); the hub converts at that one border.
- **What the match keeps about a seat is one record** (`Room::seats() -> &[RoomSeat]`: `nickname`,
  `score`, `rounds_won`, `lost_hand_total`, `retired`, `round_points`), so a lobby seat leaves or
  moves in one `Vec` operation; the round history is the seats' `round_points`, read by round through
  `Room::round_history()`. **What a seat owes in the round is one record too** (`GameState.seats:
  Vec<SeatState>`: `retired`, `declared`, `last_card_at`, `catch_paid_for`, `catch_locked_until`,
  `near_left_at`). **The hands stay apart**: a Swap or a GlobalSwitch moves the hand and leaves the
  obligation with the chair.
- **Refusals are `GameError`, one string each, byte for byte what `serverErrors.ts` matches**, classed
  by `GameError::kind()`: `StaleState` answers with a snapshot, `ErrorKind::is_honest()` (`LostRace`,
  `MissedCatch`) keeps a refusal off `suspected_cheats`.

**LOCO deviations from SOLO** (`docs/rules.md` §14):
1. **GlobalSwitch is wild** (4 copies). 2. **The starting card is always a Number**
   (`Room::deal_round`). 3. **Best-of-N** (BO1/3/5/7): **rounds won take the match, not points**,
   stopping the moment the lead cannot be caught (`Room::decisive_leader`). 4. **Voluntary draw**,
   one per turn.
5. **A forced draw does not cost the turn**; `handle_draw_card` (`loco-hub/src/table/gameplay.rs`)
   re-arms the turn timer on every draw. **The auto-action fires `Timings::turn_timeout_grace`
   (400 ms) after the deadline the client is shown** (`turn_timeout`); **the grace is never on the
   wire.**
6. **Nobody forgets LOCO! and wins** (`require_loco_to_finish`, `GameError::MustDeclareLoco`): a play
   that empties a hand is refused without the call. A seat already on one card must have declared
   **before** this message; a late call is always accepted. **A turn batch that empties two or more
   carries the call** (`declare_loco`), and the table hears `uno_declared` before `card_played`. An
   interject is one card, so it never reaches that branch.
7. **A Contre-LOCO! that finds nobody costs the caller 1 card, at most once per offer, and only
   while one is on the table** (`FAILED_CATCH_PENALTY`, `Room::penalize_failed_catch` →
   `CatchCharge`, `Room::catch_offered`, `catch_offer_key` + `SeatState.catch_paid_for`). **The offer
   is the window, not the hand**: a seat on **exactly two** cards (`CATCH_NEAR_HAND`; not three, or a
   miss becomes Swap ammunition) or a seat with a **window still running** (`CATCH_WINDOW_MS` 5s plus
   `CATCH_GRACE_MS` 3s). **A seat that grows out of two keeps the offer `CATCH_NEAR_GRACE_MS`
   (2.5s)** (`SeatState.near_left_at`, `note_hand_grew`). **The ration is the offer, never the card
   played.** A press where nothing is offered is charged to nobody and arms nothing.
   **A call that finds nobody also locks the caller out for 2s** (`CATCH_LOCKOUT_MS`,
   `Room::lock_catch`, `GameError::CatchLocked`): **the card is rationed per offer, the lockout per
   press** — every fruitless press arms it, **charged or not**, every press while it runs re-arms it
   and **wins nothing and costs nothing**. It dies with the deal.
8. **A press is answered on the instant it arrives, and it can be lost in both directions.** Nothing
   holds a Contre-LOCO! back (the two rations bound it); a press a beat after the window shut, or after
   the hand grew out of reach, costs the same card as one too early. **A control that goes dark the
   frame the offer vanishes makes the read for the player.**

**The deck and the draw**
- **Deck**: 112 cards (`Deck::standard`, `DECK_SIZE`), 8-card hands (`INITIAL_HAND_SIZE`), opening
  discard a Number. **`Deck::replenish` appends the pile to what is left of the deck, never in place
  of it.** **Swap is coloured**; the three wilds (Wild, WildDrawFour, GlobalSwitch) **must name a real
  colour** — `Color::Wild` never reaches `GameState.active_color`.

- **A draw never fails** (`Room::draw_card` validates, then `Deck::draw_up_to`, then clears
  `pending_draw`); against exhausted piles it shrinks. `Deck::draw_n` is for dealing only.
- **Answering a draw stack is `counter_draw`, never `play_card`** (refused while `pending_draw > 0`).
  A counter is the **same kind and the same colour**.

**LOCO!, the catch and interrupts**
- **LOCO! tracking is per seat** (`SeatState.declared` + `last_card_at`), a one-shot; receiving your
  last card (Swap, GlobalSwitch) owes it like playing down to it. **The four ways to empty a hand**
  (`play_card`, `play_cards`, `interrupt_play`, `counter_draw`) **ask `require_loco_to_finish`
  first; a fifth win path asks too.** Who is on the hook is the server's (`catch_seats` on
  `card_played`, from `GameState::catchable_targets`); the client never re-derives it.
- **Interrupts have no deadline and exclude nobody** (the last player and the current one included);
  **removing those freedoms would make the mechanic turn-based: do not.** **An interject is one
  card** (`GameError::InterruptBatch`, `docs/rules.md` §6.8); batch play is the turn's.
- **Whether the pile may still be slammed is the server's word** (`interrupt_open` on `card_played`,
  `card_drawn`, `turn_changed`, `match_ready`, every `GameStateDTO`; false matters, absent means
  unchanged; `interruptWindow.test.ts`). **It is open from the deal** (`deal_round`); **bots stay
  out of that one window** (they read `last_play_by`, which the deal leaves `None`).

**Scoring and history**
- **Scoring**: single-finisher round, `card_value` per `docs/rules.md` §10, cumulative `RoomSeat.score`,
  tiebreakers **rounds won then score** then lost-hand total then sudden death. **The score measures
  the gap, it does not crown anybody**; `biggest_loser` stays indexed on it.
- **The table remembers its finished matches** (`Table.match_history`, one `MatchRecord` per match,
  by seat; a departed winner is `None`): it survives `reset_for_next_match`, moves with `remove_seat`
  and `swap_seats`, rides the drain snapshot, the personalised state and **every `player_left` that
  re-bases the roster**. The evening recap is drawn from it.
- **Each record says how long its match was played** (`duration_ms`, from `match_ready`); **zero is
  "cannot say" and stays off the wire**. The client words it `12 min 34 s`, never `12:34`
  (`game/matchDuration.ts`).

## Server
Detail: [`docs/notes/server.md`](docs/notes/server.md). The live strip: [`live.md`](docs/notes/live.md).
Paths are under `server/crates/loco-hub/src/` unless a crate is named.

**Admission and abuse**
- **Client timestamps never decide an outcome.** Token bucket 10 msg/s, burst 20 (`RATE_PER_SEC`,
  `RATE_BURST`).
- **One message must never be able to cost the server.** `dispatch::dispatch` runs every handler
  inside `catch_unwind` **and** a gate refusing every `is_gameplay_msg` at a table not playing, or
  from a seat that is not an index into `state.hands` (`dispatch_at_table`). Neither excuses a missing
  bounds check.
- **Nothing is unbounded** (`Limits`, `ops/config.rs`): `max_clients` (5000) and `max_conns_per_net`
  (64) refused in `net/serve.rs` **before the upgrade**, against the admission counter (`admit`, an
  `AdmissionSlot` given back exactly once); `max_rooms` (2000) at `create_room` and `play_bot`, of
  which **one network opens at most `max_tables_per_net` (32)** (`net_at_table_cap`, counted off
  `TableHandle.opened_by`); `max_failed_joins` (20) per network per minute, refused before the lookup,
  **charged while draining too**, in a map that refuses rather than grows (`MAX_JOIN_BUDGETS`). **A
  ping spends the token bucket** (a browser never sends one). **Reaching one in production is a signal to
  read the logs, not a number to lower.**
- **The network is decided once** by `privacy::client_net` (the `ClientNet` extractor, kept on
  `Client.net_key`): `NetPolicy.client_ip_headers` in order (`CF-Connecting-IP`, then `X-Real-IP`)
  **only from a trusted peer** (`trusted_proxies`), a multi-value header **refused**, anything
  unbelievable falling back to the peer (`is_routable_client`), truncated on the way in. **That order
  is a security property.** Which header a host forwards is the host's to declare
  (`client/nginx.conf` `set $loco_cf_ip` / `$loco_real_ip`: `ws.` forwards `X-Real-IP`; the site
  `CF-Connecting-IP` **only when the peer Traefik saw is a Cloudflare range** (`geo $via_cloudflare`,
  Cloudflare's published list), since the origin is reachable around the edge). `csp.test.ts` pins it.
- **The upgrade checks `Origin`** (`serve::origin_allowed`); **`LOCO_ALLOWED_ORIGINS` is mandatory
  in production** and names the **page's** origin, never the socket's.
- **A refusal must not name the roster** (`join_room` mid-game answers `game already in progress`
  either way). A `SessionToken` (`ids.rs`) compares in constant time, has no `Display` and a `Debug`
  that prints nothing; **a reclaim spends it and is issued a fresh one.**
- **Room codes, session tokens and the room's RNG come from the OS (`SysRng`)**, no fallback — **the
  deal is hidden state**. The room's `ChaCha12Rng` is seeded with 32 OS bytes (`table/room.rs`:
  `new_room`, `restore_room`); `loco-game/src/tests/rng_test.rs` runs the clock-seed attack. **Every
  shuffle that decides a hand takes it**, `Deck::replenish` included. The thread RNG (`rand::rng()`)
  is for bots only. A `RoomCode` is parsed once, at `join_room` (`ROOM_CODE_CHARS` / `ROOM_CODE_LEN`).
- **The nickname is validated in the domain and refused with one string**
  (`loco_game::validate_nickname`: length **in chars**, an allowlist charset, the blocked terms → `nickname
  not allowed`, **never saying which rule fired**). **A name is read as it is shown**: Greek and
  Cyrillic lookalikes fold onto Latin (`latin_skeleton`) for the blocked terms and for `NicknameTaken`
  (`nickname_key`), and the only combining marks are `U+0300`–`U+036F` less `U+034F`. Wordlists (`include_str!`) matched folded,
  whole-token first, **as a substring only from 6 characters up**, `NICKNAME_ALLOW_SEED` for
  collisions. **Do not lower that threshold without a test proving real names still pass.**
- **A refused action is not automatically suspicious**: handlers call `Client::note_rejection(&err)`,
  and `ErrorKind::is_honest()` names what a correct client produces.

**The loop**
- **A table is one value owned by one tokio task, the only thing that may move a seat**
  (`table/mod.rs` + `table/actor.rs`): an `mpsc` mailbox, no lock, **nothing else can read it**. **A
  seat is one `table::Seat`** (`occupant`, `token`, `afk`, `wants_rematch`), and a reset for a
  rematch is `reset_for_next_match`. **Per-table state is a field of `Table`, never a map on the hub
  nor anything another task reads.**
- **A chair is three columns moved by two operations**: the room's `RoomSeat`, the table's `Seat`
  and the seat's column in `match_history`. `Table::remove_seat` and `Table::swap_seats` are the
  only code that removes or exchanges a seat, each moving all three or none (the room's
  `remove_lobby_player` / `swap_lobby_players` decide, and are called from those two alone);
  `tests/funnels.rs` fails on any other call site.
- **Who is in a chair is an `Occupant`** (`Human`, `Held { since }`, `Gone`, `Bot`, `Vacant`).
  **A finished ordinary table holds its seats**; a finished matchmade one does not. **An expiry finds
  its hold by the instant it began** (`Table::held_seat_at`), never by seat number.
- **The hub routes, the table decides.** `TableSender::post` and `post_to_router` are **both
  `try_send`** (a blocking send deadlocks); overflow is dropped and counted, drops that would leak
  something retry once (`post_critical`). The hub reads only the `Phase` a table publishes.
- **A table is started only once filled in** (`TableHandle::start`, `open_table_with`). **Deleting a
  table removes and stops it in one step on the loop** (`delete_room`): after the job in progress,
  nothing runs. **A panic is caught on the table too** (`actor::run_job`, `panic = "unwind"`).
- **Every delay is a deadline in the table's state** (`Table.deadlines`, keyed by the `DeadlineKey`
  enum), slept on in the same `select!` as the mailbox. **Arming a key replaces it, ending a wait
  disarms it**; reconnect holds take unique keys (`Table::reconnect_key`).

- **A socket holds one seat, as one value** (`Client.seat`, re-checked by `dispatch_at_table`).
  **Personalised sends index by seat, never by a client's idea of its seat.**
- **Removing a seat re-bases everything the scoreboard is drawn from** (`Table::remove_seat`,
  carried on `player_left`).
- **Every path that grows a hand goes through `send_hand_growth`**, and `card_drawn` is built only by
  `announce_cards_drawn` (`tests/funnels.rs`).
- **A zero is a value, not an absence** (`Option` where zero is an answer; `docs/protocol.md`).
  **Every message carries `server_now`** (`ServerMsg::stamp`): every deadline on the wire is an
  absolute server instant.
- `Client::send_bytes` force-closes on a full buffer (`SEND_BUFFER`). **The versus reveal's deal is
  armed twice** (`MatchmakingTimings.reveal_backstop`). **The tunables are a value** (`HubConfig`); a
  test passes a config, never writes a global.
- **What the server costs is measured** (`make bench-server`: ~1.3 µs per card play); the table split
  is for **isolation, not throughput**. **Argue about scaling with `loop_queue_depth`,
  `loop_queue_peak`, `loop_slowest_us` and `messages_dropped_busy` or not at all.**

**A refused message must never be cheaper than an accepted one**
- **Every refusal is a `refusal::Refusal`** (domain ones by `From<GameError>`), through the single
  funnel `Client::refuse`. **A new refusal string goes in `i18n/serverErrors.ts` in the same change.**
- **A refusal does not clear the AFK counter** (`dispatch_at_table` resets it only when
  `Client.refusals` did not move). **A gameplay message answered by nobody counts too**
  (`Client::refuse_silently`: a Contre-LOCO! where nothing is offered, inside the lockout, or already
  charged), or a held catch button would be immunity from the threshold.
- **A refusal answers its sender and nobody else** unless the rules make the table pay (so `rematch`
  is idempotent). A drift refusal's snapshot (`refuse_action`) is **throttled** (`resync_period`, 1s).

**Rooms, hosts and modes**
- **A table with no host is a shape, not a mode** (`Table::hostless`, `refuse_without_host`: a
  matchmade pair, a solo game): every host control is refused there. **`play_bot` is the queue's
  shape without the queue** (`router/solo.rs`, BO1), **touching nothing the queue owns**; **`rematch`
  is refused there.**
- **`kick_player` and `transfer_host`: host only, lobby only, matchmade never, never seat 0.** A kick
  (`release_seat`) **is not a ban and must not become one**; a transfer is a seat swap
  (`Table::swap_seats`, **the token travelling with the player**), never
  to a bot, `host_changed` sent **per recipient**. **The host is seat 0, so a bot never sits there**
  (`keep_host_human`, from both `reindex_lobby_disconnect` **and** `join_at_table`).
- **`rematch` is an ask, in every room**: every ask broadcast (`rematch_offered`, the **whole** offer
  state and the quorum), **two asks deal the next match at any size** (`REMATCH_QUORUM`; bots are not
  asked), **nobody is dropped**, the reopened table is hosted by an asker (`promote_rematch_host`),
  and **a departure retires that seat's ask**.
- **`set_streamer_mode` is the one way a presentation preference reaches the server**: host only,
  hostless never, every status, a state never a toggle. **Nothing else about presentation may follow
  it.**
- **Three fixed emotes on the game-over screen, and no free text anywhere** (`table/emotes.rs`,
  `loco_protocol::ALL_EMOTES`): closed, **kept nowhere**, never to or from a bot. Free text would be
  a moderation surface.
- **1v1 matchmaking is one FIFO queue** whose size is **never on the wire** (only `/metrics`).
  **`players_online` is the sockets, not the queue** (`router/online.rs`): sent **only when the count
  moves** and **only to sockets not at a table**.

**Leaving**
- A matchmade room holds a dropped seat 15s and treats 2 turn timeouts as away
  (`MatchmakingTimings`); **both expiries forfeit**, as does `leave_room`. Ordinary rooms: 60s and 4.
  **The scoreboard is left alone.**
- **`WALK_OUT_FLOOR` = 2 is what a match needs to keep being a match** (`can_walk_out`,
  `Room::retire_seat`), **evaluated once, at the ask**. Above it the seat is *retired*: hand back to
  the deck, turn stepped over, catch window shut, **scoreboard untouched**; `next_turn`,
  `rotate_seats`, `biggest_loser` and the Swap target know about it.
- **`leave_room` is refused nowhere** (`leave_at_table`, four branches in order): matchmade
  **forfeits**; solo or a table nobody can come back to (`Table::abandoned_by`) is **closed**; above
  the floor the round **carries on**; at or below it the match **goes to the seat that stayed**. **A
  match nobody can return to ends there** (`close_abandoned_match`).
- **A hold that runs out is settled like `leave_room`** (`settle_expired_seat`,
  `tests/expiry_settle.rs`).
- **A deploy does not end the matches on the server.** `SIGTERM` drains (`ops/drain.rs`): nothing
  starting a match is accepted, the queue is emptied with an explanation, **every table is told once**
  (through `post_critical`), **everything running is left alone**, and the refusal list keeps the
  drain terminating. The rest goes to `LOCO_SNAPSHOT_PATH` (`ops/snapshot.rs`): matches in flight
  only, as `loco_game::SavedRoom` in plain serde; never replayed; a foreign `SNAPSHOT_SCHEMA_VERSION`
  (6, read alone before the body) or an age past `snapshot_max_age` drops the file whole
  (`tests/snapshot_v5.rs`). **One snapshot directory per environment**
  (`${DATA_DIR}/snapshots/${DEPLOY_ENV}`). **`stop_grace_period` must stay above
  `LOCO_DRAIN_TIMEOUT`.**

**Bots and the gate**
- **Bots**: `loco-game/src/bot.rs` decides, `table/bots.rs` schedules, through the same commands and
  broadcasts as humans. **A Swap goes to the smallest hand and is held when it would not pay**, and
  so is **a plain Wild naming the colour already active** (`bot_wild_is_idle`); +4 and Rotation are
  never held. **A colour tie breaks towards the change** (`bot_preferred_color(hand, active)`).
  **Copies are batched on its own turn only** (`bot_interrupt` is one card); **a refused bot move
  gives up the turn, never the table** (`bot_recover`); playing a drawn card asks `bot_think`.
- **A bot's Contre-LOCO! is late, single and armed everywhere**: 3.2–4.4s into the 5s window, **one
  attempt per window however many bots** (`bot_catch_attempt`), armed after **every** action
  (`maybe_schedule_bot_reactions`).
- **A bot's round-winning move is held** (`bot_finish_due`): never sooner than
  `BotTimings.finish_delay` (1.8–2.6s) after it became possible, and **never before its own
  declaration** (`bot_uno_at`, one instant per window) while its last card is undeclared.
- **Only `LOCO_BOT_THINK_MS` / `LOCO_BOT_JITTER_MS` are tunable** (`BotTimings::apply_env`, gated on
  `LOCO_E2E=1`); **every other bot delay is a reaction window somebody is meant to be able to win.**
- **An AFK kick answers the socket, never the turn.**
- **The map-loading gate refuses every gameplay message while open** (`Table.loading`); the turn clock
  starts at `match_ready`, per match. **Nothing arms a clock or a bot behind it**
  (`schedule_turn_timer`, `maybe_schedule_bot`, a bot move from the previous match).

**The outside world, and the operator's surfaces**
- **Every third-party call leaves through Janus, and nothing the gateway does is written again**
  (`JANUS.md`): no cache, retry or token store, **no Twitch credential in this repository**.
- **The live-streams poller never touches the event loop** (`server/crates/loco-twitch/`, back in
  only through `publish_live` → `post_to_router`). **Off, silently, without `JANUS_API_KEY`**; **an
  unresolvable `game_id` switches it off rather than widening the query**; a list older than
  `LIVE_MAX_AGE` (10 min) is published **empty**. `loco-twitch` **never depends on `loco-hub`**.
- **A preview is re-served from this origin, out of memory, under a key we mint** (bounds, magic
  bytes, **our** `Content-Type`), which keeps `img-src 'self'`.
- **A name this game did not write is screened, and a catch drops the row** (`loco_game::contains_blocked_term`,
  never `validate_nickname`). **No stream title is ever relayed**; the DTO has no field for one.
- **The listener is ours** (`loco-server/src/http.rs`): a 10s header-read timeout, closing idle
  keep-alives too. `/metrics` **and `/health`** are operator surfaces, never proxied (see Docker);
  `debug_mode_active` must be `0` in prod. **The container has no privilege to lose** (distroless,
  uid 65532, `cap_drop: ALL`, read-only rootfs). **Treat `${DATA_DIR}/snapshots` as a secret**: every
  token and hand of every interrupted match.
- Logging through `tracing`, **in spans** (`code=`, `conn=`, `addr=` a network prefix), one line as
  `2026-11-11T14:03:22Z [WARN ]message key=value …` (`logsink::LineFormat`). Never tokens or hands.
  **The log never touches the event loop** (`logsink::AsyncLog`): bounded, **overflow dropped, never
  waited on**, counted (`log_lines_dropped`); `main` closes the sink last, **and so does the second
  signal** (`abandon_drain`).

## Client
Detail: [`docs/notes/client.md`](docs/notes/client.md).

**Build and framework**
- **The CSP header allows the router's bootstrap by hash, and nothing inline by hand.**
  `csp: { mode: 'hash' }` hashes SvelteKit's one inline script; `scripts/csp-hashes.mjs` (last step of
  `npm run build`) writes the git-ignored `csp-hashes.conf` that `security-headers.conf` splices into
  `script-src` — a `<meta>` policy does not loosen the header. `csp.test.ts` refuses any hand-written
  inline script except the `application/ld+json` block (`layouts/Head.svelte`).
- **The game is rendered by the root layout, never server-rendered, never unmounted by a
  navigation.** Game pages are prerendered with `#root` empty; the root layout boots the game
  (`boot.ts`) **once per document, the first time the router is on a game page** — never in
  `hooks.client.ts` or on a content page — and keeps `#root` rendered but `.parked` (inert, hidden)
  under a content page, releasing `data-seated` and TAB (`state/gameShown.svelte.ts`).
- **Run `make csp` after a dependency bump too.** The validator is Valibot: one that JIT-compiles
  with `Function()` is refused by the CSP.
- **`vite.config.ts` names the `VITE_` env prefix** (`wsEnv.test.ts`).
- **Svelte 5; React is not used** — no `react`, `react-dom`, framer-motion, `.tsx` or `.module.css`
  (`noReact.test.ts`).
- **`vite build` type-checks nothing**: `make build-client` is `svelte-kit sync && svelte-check &&
  vite build` (+ the hashes). **TypeScript stays on 6.x** (svelte-check and SvelteKit refuse 7.x).
  **Every type import is an `import type`** (`verbatimModuleSyntax`).
- **`src/types/protocol.ts` and `protocolSchemas.ts` are generated, never edited**: change
  `server/crates/loco-protocol/`, then `make protocol`; CI's `protocol_check` catches a hand edit.

**State and effects**
- **The store is ours** (`state/store/createStore.ts`, ~40 lines, `storeCore.test.ts`) and must
  publish the property the creator mutated, never a copy. **Derived state is completed by the store,
  never by the actions** (`store/deriveCatchMiddleware.ts`, `catchDerivation.test.ts`).
- **A snapshot is authoritative when it arrives and never afterwards**: nothing carrying a board is
  held and replayed, except `pendingMatchEnd` (nothing follows a match end).
- **Svelte reads the store per field** (`state/gameStore.svelte.ts`): `game.current` is a stable
  object of getters over one `$state.raw` cell per top-level key, so `g.x` depends on `x` alone;
  `game.snapshot` is the deliberate whole-state read. **A value computed from a field, a nested field
  or a prop is narrowed through `live()`** (`state/live.svelte.ts`) or a `$derived`.
  `liveDeps.test.ts`.
- **Reading a prop is not depending on its value**: an animation effect guards on its trigger's
  **timestamp**, a timer works to an **absolute deadline** (`Hand`'s `dealUntil`, `drainBar`), a
  once-per-key effect abandons on that **same key**, never in the cleanup (`mapPreload`).
- **Nothing continuous goes through reactive state**: countdown bars use `drainBar`
  (`appSubscription.test.ts`). **Reading state inside the effect that writes it is a loop**;
  `untrack` is the way out (`GameBoard.svelte`). **A prop read once at setup says so with
  `untrack`**; a callback prop handed to a hook takes a closure (`GameView`'s `send`).
- **Props are ordinary props and events are lowercase DOM names** (`onclick`): Svelte silently
  ignores an unknown prop. **CSS lives in the component's `<style>`**, runtime classes via `class:`,
  never `classList.add`; **no `:global()` without a written justification.**

**The realtime path**
- **Send first, animate second.** `onCardClick` returns whether the card left the hand; the flight
  spawns only on `true`, and legality runs *before* the prompts, so a refused card opens no picker.
- **Every board control acts on the press, never the release** (`components/press.ts`,
  `use:pressToAct`); a disabled control fires on neither path. **The double-tap guard is per
  control** (`guardDoubleTap(key, fn)`).
- **A slam is one card; holding a copy is a second press.** The tap sends `card` alone and the server
  refuses a batch (`GameError::InterruptBatch`); batch play is the **own turn**'s
  (`Room::play_cards`).
- **Contre-LOCO! is pressable before the server has named anybody** (`game/catchAvailability.ts`,
  `CATCH_LIVE_MAX_HAND = 2`): another seat on exactly two cards, or a window still running plus
  `CATCH_LATE_GRACE_MS` (2s, under the server's `CATCH_GRACE_MS` 3s by the wire;
  `serverMirrors.test.ts` pins the inequality). **Hand sizes, our own seat and the clock decide it,
  nothing else** — `isCatchLive` does not take `declaredSeats`. The clock is `store.onHookUntil`; a
  seat drawing out of two stays live `CATCH_NEAR_GRACE_MS` (1.5s) longer (`store.nearUntil`,
  `applyCardDrawn`).
- **No latch: the clock ends the offer, never the next card** (`catchLiveUntil`, one timer in
  `GameView`). **`store.catchSpent` mirrors the server's ration** and suppresses the *blind* send
  only. **A tail keeps a live button live and never lights a dark one** (`applyCardPlayed`,
  `liveWindowsOnly`).
- **A call that found nobody locks the button, visibly** (`store.catchLockedUntil`, `isCatchLocked`,
  `ActionBar`'s padlock and drain), to the server's **absolute instant**, halo off
  (`class:armed={catchArmed && !catchLocked}`). Scene `game-catch-locked`.
- **The press is acknowledged on the frame it lands; the verdict is the server's**
  (`store.catchPending`, `ActionBar`'s `.called`).
- **Every deadline is read on the server's clock** (`state/serverClock.ts`, `localizeDeadlines`,
  `serverClock.test.ts`).

**Transport and sessions**
- **The socket does not go through the CDN** (`webSocketPolicy.ts`; 389 ms proxied vs 8.5 ms direct).
  `VITE_WS_ORIGIN` is baked in on a **tag only**, the **scheme comes from the page**, and it **falls
  back one-way** to the page's origin after `DIRECT_FAILURES_BEFORE_FALLBACK` failed sockets. The
  CSP keeps both origins; `client/Dockerfile` fails rather than ship `__WS_DIRECT_ORIGIN__`.
- **The socket never stops trying to come back**; `online`, the tab returning, the bfcache restore
  and the curtain's button retry it on the spot. **It does not survive a frozen page** (`pagehide`
  drops, `pageshow` on `persisted` asks back; `wsFreeze.test.ts`). **The rejoin covers every screen**
  (`reconnectMessageFor`).
- **One tab holds the game and the others open no socket** (`state/tabLock.ts`, `Root.svelte`,
  `TabTaken.svelte`): one synchronous `localStorage` read before the first paint, a heartbeat, and
  **in every doubt the tab owns the game**. Not mounted in `App.svelte` (hence `Root.svelte`); **its
  curtain does not close on `Escape`**.
- **A table is shared as a link** (`state/tableInvite.ts`): `/i/?t=CODE`, no language, spent on
  arrival, read on `/i/` only. **A link carries a table, never a player.** `/i/` is its own page
  because a preview is served HTML: `noindex`, out of `PAGES` and the sitemap, its own title and art;
  **the code stays a query parameter** (`invitePage.test.ts`).
- **The lobby remembers the last nickname** (`nicknameMemory`), a prefill that authenticates nothing.
- Boot order in `boot.ts`, before the first render: `initLang()`, `initMotion()`, `initI18n()`,
  `initPinchGuard()`, `initContextGuard()`, `initTableInvite()`, `initTabLock()` (not in the
  showcase), `initSessionRestore()`. Each later arrival at a game page re-runs `initLang()` and
  `redetectLang()`.

**Input and controls**
- **There are no gameplay keyboard shortcuts and there must never be any**: aiming at a button that
  lights up for a few seconds *is* the skill. A `window`/`document` key listener is refused; a focused
  control is the accessibility path and stays. Exactly three global key listeners — `heldKey`,
  `escapeKey.svelte.ts`, the audio unlock; anything else global may read `Escape` only.
  `noKeyboardShortcuts.test.ts`.
- **TAB at the table is the scoreboard, from the press, moving no focus** (`heldKey`); **Shift+TAB is
  never taken**; inside a dialog TAB is the dialog's (`components/dialogFocus.ts`).
- **Anything over the board closes on `Escape` and on a pressable control**
  (`state/escapeKey.svelte.ts`, `escapeClose.test.ts`); a dropdown anchored to its opener is the
  exception.
- **The browser's menu stops at the seat** (`contextGuard.ts`, `data-seated`); the landings keep it
  (`contextGuard.test.ts`). **At a seat text selection is refused on every element**
  (`styles/base.css`, `a11y.test.ts`).
- **The hand's hover is a mouse's only** (`Hand.svelte`, `pointerType === 'mouse'`), outlives
  `pointerleave` by `HOVER_GRACE_MS`, reads the card off the pointer's x against the resting fan, and
  lifts a stiff spring per card on `.lift` (`handTouch.test.ts`).
- **A control under 44px gets its target from `.hit-target`, which needs `position: relative`**; its
  `::after` is the target's, so paint on `::before` (`hitTarget.test.ts`).

**Panels, preferences and chrome**
- **Preferences live behind one gear** (`Preferences.svelte`), every screen: language, graphics,
  streamer mode, colour shapes, reduced motion, vibrations where supported; on/off ones are
  `createBooleanPref` stores. **Streamer mode alone leaves the client.** Icons are drawn SVG.
- **Fullscreen is a chip, not a preference** (`FullscreenButton.svelte`): desktop only, absent where
  `document.fullscreenEnabled` is false (`fullscreenButton.test.ts`).
- **Below 46rem, one sheet for four surfaces** (`Preferences`, `AudioSettings`, `RulesModal`, the
  home `<details>`): from the bottom, full width, 92vh, 20px title beside a 40px ✕, pinned header and
  foot, `translateY(24px)` at `0.26s var(--ease-bounce)`, never a scale. Labels 15px, hints 13px,
  switch rows 56px, thumbs 30px. Only `Lobby` passes `triggerBelowPhone={false}`. Above 46rem both
  panels are one 292px dropdown: rows 50px, segments 38px, language 42px, 14px track under a 26px
  thumb; sections grouped by space and micro-caps, never a drawn rule. `rulesModal.test.ts`,
  `contentPages.test.ts`.
- **Anything over a screen declares its own `text-align`.**
- **The language dropdown is ours** (button + `role="listbox"`, arrows/Enter/Home/End,
  `aria-activedescendant`; Escape closes the list only). **The pick applies itself** (`setLang`, a
  `goto` on a home page); nothing reloads, so no Apply button.
- **Quiet is a hue, never an opacity** (`--color-muted`).
- **Every glyph a player sees is one we drew** — no emoji (`drawnGlyphs.test.ts`). **The four ways a
  match ends are `OutcomeMark.svelte`**, no trophy, no face.
- **Rules open from a "How to play" pill before the deal and the "?" chip at the table**
  (`RulesButton`; the pill's label is its name, no `aria-label`). `RulesModal` has two halves, Rules
  and Cards; `cardCatalogue.ts` is the faces, `t.cardNames` / `t.cardBriefs` the words, nothing spelled
  twice, eight lines, **links nowhere** (`rulesModal.test.ts`).

**Copy and language**
- **The copy is the game talking.** A **table**, a table code, a seat: no "lobby" in player copy.
  French is **tutoiement**. A button is the verb about to happen; a refusal says what to do next;
  only the streamable moments shout.
- **The name is `LOCO!`**, never `LOCO` and never `LOCO !` (`vocabulary.test.ts`); a `<title>` still
  caps at 60. **A table is the seats, a room is the place**: `salle`, `salon`, `pièce` banned; URLs
  and `<title>`s keep "tables".
- **The five-second capsule names an opening, not an order** (`t.catchWindow`).
- **A refused action never shows a wire string**: map it in `i18n/serverErrors.ts` when you add a
  server error (`serverErrors.test.ts`).
- **The rules page opens on what is different** (`content/contrasts.ts`, numbers from the server;
  `contentPages.test.ts`); the modal does not.
- **A document is never in two languages at once**: switching is a `goto` with
  `{ replace: true, reset: false }` keeping query and fragment (`langRoute.ts`), never a reload or a
  redirect; `langSync.test.ts` fails on a `data-alt*` rewrite. `data-served-lang` is the page on
  screen; `<html lang>` is the game's once booted.
- **A stored choice wins everywhere; the browser's language only on `/`**, and a detection is never
  stored (`chooseLang` in `lang.ts`). `/i/` is served with no language. `en.ts` is the source of
  truth and types `fr.ts`.

**Screens**
- **The home menu is four buttons drawn alike** (`Lobby.svelte`): 1v1, the bot, new table, join.
  **Hierarchy is a hue, never a smaller control.**
- **On a phone held sideways the entry screen is recomposed** (`Lobby.svelte`'s
  `@media (orientation: landscape) and (max-height: 559px)`, pinned to `LANDSCAPE_MAX_H` by
  `landscape.test.ts`): lockup beside controls, buttons 2×2, padding clearing the chip row
  (`--topbar-h`) and the live strip. `Searching` goes two columns centred `safe` on both axes;
  `MatchFound` is squeezed; the waiting room is untouched.
- **The lobby answers a nickname as it is typed** (`game/nicknameRules.ts`, shape only) and **disables
  "Take a seat" until the code is whole** (`game/tableCodeRules.ts`); both mirrors are pinned to the
  server's source (`serverMirrors.test.ts`, `src/test/serverSource.ts`). **Greying out answers shape
  only**; a blocked term comes back after the ask, with the field focused and selected.
- **Connected players are drawn from two up** (`game/playersOnline.ts`): never rounded, padded or
  reworded, and it says *connected*, never *searching* — that would be the queue size in disguise.
  `setPlayersOnline` stays out of `resetToHome`.
- **The live strip is the entry screen's foot, and nobody live is nothing** (`LiveStrip.svelte`,
  `game/liveStreams.ts`): never at a table, the server's order (`topLiveStreams` cuts, never sorts),
  `width`/`height` on every `<img>`, **no Twitch logo**. External addresses are built in
  `game/twitchLinks.ts`, never a `src`; links carry `noopener noreferrer external`.
- **The searching screen times its own wait and never implies an empty queue** (`searchStage`).
  **A forfeit never renders as a victory.** **Being found reaches a hidden tab** (`tabAlert`, armed
  only while hidden; `tabAlert.test.ts`).
- **The way out is a chip in the chrome row, never on the action bar**, asking in place; `leaveNote`
  picks one of four lines counted like `can_walk_out`. **Nothing greyed out.** A departure is told by
  name (`departureNotice`); a stopped board says so off `goneSeats`, behind the reconnect curtains.
- **Game over asks, it does not command**: three states, every seat; a table nobody is left at keeps
  the button **in place and disabled**; a matchmade table requeues itself (`rematchRequeue.test.ts`),
  `find_match` gives the seat up in one message. The way out is the quietest control.
- **A seat index is only true for its roster**: our side of a forfeit is read **once, at
  `match_end`** (`store.forfeitedByMe`); the recap is **re-sent by the server**, never re-based here.
- **Emotes: one line per seat that can speak** (`GameOver.svelte`, `.emoteSlot`; `applyEmote`
  replaces). No line for a bot, no block when every other seat is one. The screen opens quiet.
- **The recap pins who and matches taken** (`M%n`); a match winner is a gold pill (LOCO Red is 2.9:1
  there).
- **The round past the format has a name** (`t.decisiveRound`), the chip goes **gold**, announced on
  `roundNumber >= matchRoundsNeeded && !matchOverPending`; its fade-in delay survives reduced motion.
- **The host sees a range, never a figure, for match length** (`game/matchLengthModel.ts`, `≈`).
- **The host's two row controls live behind one ⋯ and both ask** (`WaitingRoom.svelte`,
  `RosterRowMenu.svelte`); a bot's row has removal only (`is_bot`); below 46rem a bottom sheet. The
  removed player is reset like `left_room`, then told why.
- **`TableCode.svelte` is the only way a screen prints the code**: a drawn chain says it copies a
  link; **streamer mode blurs the code with CSS, no reveal at all**, the blurred span out of the tab
  order (`preferences.test.ts`). **The host's streamer mode is the table's**, ORed with the local
  one, never overwriting it; `hostStreamerSync` sends on two moments, never on a seat change
  (`tableStreamerMode.test.ts`, `loco-hub/tests/streamermode.rs`).
- **Colour assist gives each suit a silhouette** (`SUIT_SHAPE`, `SuitMark.svelte`), never a letter;
  anything meaning something by hue alone needs the mark.
- **Reduced motion is `:root[data-motion="reduce"]`, never a media query** (`initMotion()`;
  `reducedMotionCss.test.ts`, `motionPref.test.ts`).
- **Under 46rem the burger is the only navigation**, prose included (`#navAbout`, shipped `hidden`).
- **A game page arrives in one piece, under a veil**: a canvas-coloured `body.game::after` holds
  the page until `data-booted` and lifts off (`layouts/GamePage.css`, `homeVeilOff`), opacity only.
  **The content under it is never faded** — it paints opaque on its first frame, which is what keeps
  it an LCP candidate (`contentPages.test.ts`).

## Findability
Detail: [`docs/notes/seo.md`](docs/notes/seo.md).

**What a content page is**
- **A content page is pinned to the source it restates**: the rules page maps `t.rules`, the deck
  table is checked against `loco-game/src/deck.rs` and `card.rs` (`contentPages.test.ts`).
- **A content page is readable with no script**: prerendered whole, no effect, `{@html}` or inline
  script in an article (`livePage.test.ts`, `legal.test.ts`), interactive parts are **native
  controls** (`<details>`, `[popover]`), behaviour belongs to the component rendering the element
  (`ToTop.svelte`, `SiteDrawer.svelte`, `SiteFooter.svelte`, `LiveArticle.svelte`), a script-only
  control ships `hidden={!hydrated}`. **Nothing third-party.**
- **`/live/` is prose first** ([`live.md`](docs/notes/live.md)): the list is filled in the browser,
  a `WebPage`, served with a sentence not a spinner, every stranger's string rendered as text.
- **A content page never says UNO** (`seo.test.ts` over `PAGES`, `UI`, `src/content/**`).

**Layout and navigation**
- **Every selector in `content.css` is scoped to a class** (it stays loaded across navigations;
  `GamePage.css` scopes to `body.game`); `contentPages.test.ts` fails on a bare element selector.
- **One bar and one drawer for the whole site** (`layouts/SiteFooter.svelte`,
  `layouts/SiteDrawer.svelte`, styled once in `content.css`): same links, legal last, the globe in the
  same place on every page that is not a seat, one height, held through the cross-fade
  (`view-transition-name: site-footer`). The content header (mark + Play) is the one deliberate
  difference.
- **No backdrop, no glass**: one `--shell`, flat `body.doc`, opaque header and bar; blur is the modal
  scrim's alone.
- **Page moves are one 0.22s opacity cross-fade** (`routes/+layout.svelte`), skipped under reduced
  motion and for a fragment. The header is sticky and the bar fixed. In-page jumps glide behind
  `html[data-scroll="smooth"]`; a focus after a smooth scroll passes `preventScroll: true`.
- **Under 46rem one burger is the whole navigation**, on content pages and `/`; a `.navPop*` or
  `.siteFooter` rule in `GamePage.css` is a divergence. **Read the note first**: the drawer, the
  language popover and the sticky header fail silently. The chooser's links are real `<a href>`s with
  `hreflang`, and the panel keeps its ✕.

**The one palette, and the one viewport**
- **One palette, the night one, and nothing keys on a theme** (`noLightTheme.test.ts`). The landings
  paint `--color-canvas` only. **Glowing orbs on the content pages are refused; do not add them.**
- **The home page is one viewport and never scrolls**; its prose is a native `<details>` sheet that
  opens with scripts disabled. **A board scrollable off-screen mid-match is a bug.** The bar and
  burger vanish on `data-seated`. Open, the sheet is `RulesModal` to the measurement (`bind:open`, a
  sibling scrim, the ✕ `hidden={!hydrated}`; `contentPages.test.ts`).
- **The viewport never forbids zooming**; `touch-action: manipulation` on `body`, and at a seat
  `pan-x pan-y` plus `pinchGuard.ts` refusing `gesturestart`. **White on LOCO Red is 3.43:1**, so
  1.2rem or larger. **A sideways-scrolling box takes `tabindex="0"`** and a focus ring
  (`a11y.test.ts`).
- **Speed**: `inlineStyleThreshold: Infinity` (`'unsafe-inline'` styles, scripts by hash only) and
  the tables page's art through `@sveltejs/enhanced-img`.
- **Never fade in the element the browser measures the LCP against** — `NO_LCP` scores 0. Fade a
  veil off the top instead.

**The registry, the URLs and the origin**
- **`src/seo/meta.ts` is the single source** for paths, titles, descriptions, sitemap, `hreflang` and
  canonical (`seo.test.ts`); **a declared path with no source file is a failure.**
- **`/` serves the only `<h1>`, in text, never the wordmark**; app screens use `<h2>` (`seo.test.ts`).
- **Titles ≤ 60 characters, descriptions 100-155**, both languages; French written to the ceiling.
- **Structured data claims nothing that does not exist**: `isAccessibleForFree`, never an `Offer`;
  `WebPage`, never `Article`; nodes join `#website` and `#game`. **The FAQ is the `FAQPage` payload**
  (`src/content/faq.ts`) and describes real server behaviour.
- **English at `/`, French under `/fr/`, every path slash-terminated**, never redirecting the
  unslashed form (it loops). **A French URL opens in French** via `data-served-lang`, never
  `<html lang>`.
- **The origin is decided at build time** (`VITE_PUBLIC_ORIGIN`, a Docker `ARG`): crawlers never
  fetch a relative `og:image`.
- **Production `ohloco.com`, dev `loco-d.kisukesaama.com`**, declared once (`PROD_HOST` / `DEV_HOST`).
  **`APP_SUBDOMAIN` names the stack, not the address.** **The dev host keeps `-d.`**: it is what keeps
  dev out of the index (`nginx.conf`'s `robots.txt`).
- **The apex is canonical; `www.` only 301s at the edge** (no `www.` in `ORIGIN`, one `Host()` in
  `deploy/compose.yml`).
- **nginx answers a missing page with a real 404.** **Every redirect names a path, never an origin**
  (`absolute_redirect off;`); `redirects.test.ts` replays every public URL.
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
  win, electric indigo orients, signal mint confirms. Judge a proposed colour on what it does to the
  other three, and move it inside its own family. `--color-tertiary` (the focus ring) must clear
  **3:1 on the dark card** (WCAG 1.4.11, currently 3.42); `--color-link` is that hue pushed to AA on
  each canvas. **A colour written out by hand at a call site is the bug**; `playerColors.ts` moves
  with the token. `--radius-full` is `999px`, **never `50%`**.
- **`tableRect()` is the single authority on board geometry, `seatLayout()` on seating.** Maps change
  how the felt is *painted*, never where anything is. **The board is a fixed coordinate space scaled
  by `<div .stage>`**: fix scale in `boardScale`/`boardSpace` (which takes the safe-area insets),
  never by bumping `CARD_W` or `SEAT_DIMS`.
- **A phone on its side is another composition, not a smaller one** (`layout.ts: isLandscape`,
  `LANDSCAPE_MAX_H`, decided **from pixels, once** and handed to every layout call): seats down the
  left, the action bar up the right edge (`SIDE_RESERVE`), the turn pill under the piles
  (`turnPillPlace`). `landscape.test.ts`; review with `--viewports=landscape`.
- **An opponent is their hand, face down, at their place on the table, and one geometry draws it
  and lands cards in it** (`seatFan` under a `FanLay`, `seatBox`, `handSpots`, `PlayerSlot.svelte`).
  Where the rim can seat everybody (`rimLayout`) the hand lies on the cloth inside the rail
  (`CLOTH_INSET`, every corner of the fullest fan checked), places spaced **as if everybody, us
  included, sat the same distance apart** (`firstRimAngle`), never two names or two cards touching;
  otherwise rows above the felt. **The felt is big** (`tableRect`, 78% of the width) **but never above
  `FELT_TOP_MIN` on a monitor**. Our own hand is larger (`HAND_SCALE`, not in landscape). **A card on
  its way is held out of the hand until it lands** (`FanHold`), every card the table moves flies from
  where it leaves to where it lands (`store.lastDraw`, `Flier.flip`, `Flier.curve`, `squash`), and
  the piles lie on the felt in perspective (`pileTransform` / `onPile`, `PILE_SQUASH`) with the chip
  and +N badge upright. **Our own cards are face up in our hand and nowhere else**; the given hand is
  read off `SwapNotice.givenHand`, never `myHand`. `SEAT_DIMS` is `seatBox` rounded up
  (`seatLayout.test.ts`).
- **Animate transforms, never `left`/`top`**, and a node's transform has exactly one owner. Layout
  math is radians, CSS degrees (`radToDeg` at the render boundary only). Hand keys come from
  `handCardKeys(hand)`, never the index.
- **The top-right chip row is absolute, so it reserves nothing**: an overflowing screen clears it
  with `--space-base + --topbar-h + --space-sm + --safe-top` of top padding (`safe center`).

**The mark and the card face**
- **The wordmark is a logotype**: `<LocoLogo />` carries `role="img"` and `aria-label="LOCO!"`, the
  word `aria-hidden`, **no stroke on the word** (a `::before` paints the outline; `a11y.test.ts`).
- **The card face does not follow the room or any theme.** `LOCO_MARK_PATH` comes straight from the
  designer's source file: do not redraw, retrace or tidy it. **The light on a card follows the room**
  (`Card`'s / `CardBack`'s `::after`: a gloss band at the sun's angle, the stock's edge), **never a
  dimming**, no blend mode, filter or opacity (`card.test.ts`). **Realism stops there.**
- **On a card the mark is a mask, never a `<path>`** (`MARK_MASK_URL`, `MARK_MASK_BOLD_URL`):
  rasterised once for all ~50 faces; `card.test.ts` fails on a live path or a second mask URL. **Any
  new card art: one cached image, not geometry per instance.**
- **The game cover carries the wordmark and no other text** (`src/dev/CoverCard.svelte`, `make cover`
  → `brand/`): no platform logo, rating or watermark, **judged at 40px** (a Twitch sidebar), built
  from the real `<LocoLogo />` and `<Card />`. `coverCard.test.ts`.

**The board's chrome**
- **Nothing the board draws crosses the standings** (`ScoreTable`'s `.overlay`, **z-index 48**):
  above notices 14, toast 30, the three shouts 45, chip row and leave question 46, catch capsule and
  round summary 47; below the reconnect curtain 50, pickers 100, map gate 900, rules modal 1000.
  `scoreTable.test.ts` asserts the floor **per file**.
- **The three shouts land on a line the board computes** (`layout.ts: shoutLine` → `--shout-y`),
  **never over anybody's hand** (`seatLayout.test.ts`), each on its own timer (`UNO_BANNER_MS`, never
  the `unoDeclared` latch). **The interception's plate is a ribbon cut to the word, never a band
  across the frame, and no seat-colour dot beside a name**: both refused.
- **Motion degrades to a readable static state**, not to nothing: `.armed` becomes a static halo, a
  countdown bar keeps draining under reduced motion.
- **A countdown bar is drawn back out of a slot, never scaled flat** (`loco-slide`: a `translateX` of
  the whole fill). The turn clock is a sunken slot flush with the safe top edge (chip row and round
  badge 12px lower); **its heat is the palette's own three** (`loco-drain-heat`), never a hex.
  `drainBar` owns the timing.
- **A raised dark surface is lit from above, never filled flat** (`--surface-lit`,
  `--surface-lit-strong`, `--lip`, `--trim`, `--gloss`): dressing only — outline, hard shadow and
  sizes unchanged, and a dead button is still the sunken slot.
- **Table news is one pill, and no arrow in any of them** (`.noticeSwap` / `.noticePenalty` /
  `.noticeDeparture`), differing **only by height**; **a saturated fill belongs to the three moments
  allowed to shout**; centred with `inset-inline: 0` + `margin-inline: auto`, never `left: 50%`; each
  leaves on its own timer (`--notice-life`); a direction is named in the ring's words, never `→`.
- **The action bar never reflows and never empties**: a fixed three-column grid (Draw,
  Contre-LOCO!, Pass), **Catch in the centre column all match and nothing else ever in it**, every
  button held the whole match and going dead rather than away. The penalty draw is the one recolour,
  ours only. **The turn pill's "Draw 2"/"Draw 4" state is a button that draws too**
  (`TurnIndicator`'s `onDraw`); every other state is a label. Catch is dead, pressable, armed, or
  **locked** for two seconds after a call of ours found nobody — **dead also once our wager is
  spent** (`catchSpent`): a live but inert control is the one lie a reaction bar cannot afford.
  Locked shows the sunken slot, a drawn padlock and a drain, **no digits**. **LOCO! is a small chip
  centred above the bar, on screen the whole match**, never a fourth column; `BOTTOM_RESERVE` covers
  its band.
- **A dead button is a slot cut into the bar, never a quieter object** (`--color-surface-sunken`,
  `--color-disabled-ink`, `--color-hairline`). **No opacity**: its label clears 4.5:1, because Catch
  sits dead through every round's opening and a spectator reads it at 720p. `actionBar.test.ts`.

**The room** (`components/scene/`, `maps.ts`; the reasoning is in visual.md)
- **A map is a scene, a table and an accent**, rendered in the browser from the three ids the server
  deals. **It is painted** (`scene/plates.ts`) **over the block room it is made from**, which is also
  the fallback. **In a room the render is the table**, built under exactly `tableRect()`; the CSS
  table is the fallback whenever the frame does not lie under the felt (`sceneCache.tableFits`,
  `SceneBackdrop`'s `tableDrawn`, `.tableOval.rendered`).
- **Every room has its own table, in a noble material** (`MapDef.table`; `tableMaterials.test.ts`
  refuses two alike): seeded grain (`cards/tableSurface.ts`, `scene/grain.ts` — **rings and depth,
  never dots**), swept and turned finishes (`Kit.sweep` / `Kit.lathe` / `Finish`, `LOOK.table`).
  **The felt carries no texture and no mark**; it is still a board (`FeltInlay.svelte`, `feltInlay`:
  the lamp's pool, a concentric metal thread, a medallion; `layout.test.ts`). **Every line round the
  table is an ellipse concentric with the felt** (`tableTrackEllipse`, `View.tableOutline`,
  `Kit.loft`), rail and track `CLOTH_INSET` wide (`LOOK.table.rail`). **The table's lamp is its alone
  and casts its shadow** (`makeTableLamp`, `LOOK.table.lamp`, `kit.ts: LIGHTS_NO_LAMP`). A finish
  keeps a share of its colour (`FinishLook.glow`) and never throws a varnish's whole highlight back
  (`FinishLook.specular`, no clearcoat). Rain's rings stay off the cloth (`WeatherLayer`'s `clear`).
- **The top is a cabinetmaker's** (`vistaTable`, `Kit.patch` lozenges), **wired in light where the
  room has its own electricity** (`TableMaterials.glow`, `Finish.lit`: neon, orbit). **The floor round
  the table is drawn** (`vista.ts: groundInlay`), none under snow; **the table's shade lies on it at
  every hour** (`Kit.shade`, `LOOK.table.shade`); **a floor is polished only where the mirror's plane
  is the floor's** (`Kit.polished`). `sceneGround.test.ts`.
- **What stands within reach of the table is finished, not blocked** (`Kit.lathe` in a `Finish`:
  `pot`, `cask`, `bollard`, `brazier`, `standardLamp`) and takes no snow cap; light near it is a
  pool (`k.pool`), bulbs a `festoon`.
- **The play direction is two strokes of light round the piles** (`DirectionRing`,
  `directionArrows`), never chevrons round the rim, **each head clear of the piles** (`ARROW_SWEEP`,
  `layout.test.ts`), a few degrees with the play, never a full turn.
- **A painted room is one painting, laid by its lens and never by its edges** (`scene/plate.ts`,
  `plateUv`: the two horizons laid on each other, scaled by the ratio of the focal lengths). **The
  guide is the block room itself** (`?bare=1`) at 16:9, the widest lens, **painted in two passes**
  (`tools/plates/paint.py`). **A painted room has one hour, its painting's** (`plateHour`); the
  weather still falls. It leaves through the tone curve backwards (`untone`), no lens blur, no mist,
  a share of bloom (`LOOK.plate`); **a plate that will not load is the block room**.
  `scenePlates.test.ts`.
- **The table cannot be a painting; what it is made of is** (`TableMaterials.paint`, `Kit.band`,
  `paintedTable`, `tools/plates/trim.py`): two strips, `rail` and `side` (`LOOK.table.apron`), laid an
  even number of times round, **both or neither**, ornaments large and few (`LOOK.table.stretch`).
  **The cloth is never painted.** `sceneTableTrim.test.ts`.
- **A room is seen from the table** (`scene/view.ts`): eye height, a tile a metre, the horizon 13%
  from the top. **The felt is fixed and the camera is solved to it** (`solveView`, 58–84° across);
  **the table top is the felt cast back onto its plane** (`View.tableOutline`, `Kit.plate`), and the
  render adds nothing wider than the felt. `sceneView.test.ts`.
- **Three grounds and a horizon** (`maps/vista.ts`): a near framing the two edges (two things a side
  at most), a middle, a far in layers (`hills`, `skyline`) **nothing in the middle may hide**. **A
  landmark stands where the frame holds it**, never alone behind the top seat pill, at least
  `1250 * H / D` pixels at 16:9; a tower is piers, tall panes and a crown (`crowns`, `spotChance`).
  `sceneLandmarks.test.ts`. Floors are laid across the frame (`deck`), never fanned round the table.
- **The light the viewer sees is in the frame** (`scene/dome.ts`, `LOOK.hours[h].body`): at dawn, dusk
  and night the sun or moon is low, **ahead of the camera**, the key light; **every body in a clear
  sky lands between the frame's top and the horizon** (`sceneVista.test.ts`, `sceneLighting.test.ts`;
  per room `LOOK.rooms[id].sun` / `.body`). **The sky is a dome in the scene, not a pass**, writing no
  depth, clouds softened at the horizon (`d.xz / (up + 0.05)`); space has a black sky and a planet lit
  by its own sun (`space.planet.lit`).
- **The air makes the far far** (`post.ts: AirOptions`, `LOOK.vista.haze`), thickened by the weather
  (`haze.weather`), scaled per room (`LOOK.rooms.orbit.haze`).
- **The room is lit once** (`scene/lighting.ts`, `scene/shade.ts`): warm sun, cool sky, matte
  vertex-coloured `MeshStandardMaterial`, ambient strong enough to read the shade
  (`LOOK.hours[h].ambient`), occlusion bounded (`LOOK.ao.floor`), **one PCF shadow map** reaching
  every tree and lamp the room plants (`shadowReach`, `sceneShadowReach.test.ts`) — **never VSM**,
  `normalBias` 0.03. **In the room the outline is a darker note of the block's own colour**
  (`inkFor`, `outlineAt`, `inkFar`), the one place the ink rule bends. Supersampled and **brought down
  in linear light** (`post.ts: RESOLVE_FRAG`), never `drawImage` over sRGB; capped by `maxSide`.
- **Every visual number is in `scene/look.ts` and nowhere else** (`?look=1`, `src/dev/lookPanel.ts`,
  `bumpLook()`); **`lookVersion()` and the tier (`state/graphicsPref.ts`) are part of the cache key**.
  `LOOK.debug` ships `off`.
- **And then it is photographed** (`scene/post.ts`, once): occlusion multiplied in before bloom and
  focus (`VIEW_PARS`), FXAA, bloom, a lens on the table, mist, air, the tone curve **applied once**, a
  grade, vignette, fringe — **no grain: fine noise over any surface, the frame included, is
  refused**. **Every target is checked before it is drawn into** (`assertComplete`); a GPU with no
  float target (`floatTargets`) gets the plain frame, **never no room** (`sceneQuality.test.ts`).
  Sprites take the same curve and grade (`makeSpriteGrader`) and cast no shadow.
- **Gloss is optional and a matte surface is exactly what it was** (`BlockOptions.gloss`,
  `litMaterial`, reflection only; `sceneGloss.test.ts`). **The water and a wet street mirror the
  room** (`scene/mirror.ts`: the room flipped about the water's level, Fresnel from
  `LOOK.water.reflect`, `stretch`); not on `light`, only where `Kit.reflective`.
- **A lamp lights the ground's own colour, never paints a disc on it** (`scene/pools.ts`,
  `LOOK.pools.lift`, `washFrom`; `scenePools.test.ts`). **Mist lies over water and fields, never on
  the lens** (`mistFor`, `LOOK.mist.near`). **A mark the weather leaves never moves a house** (snow
  drifts on their own seed); rain lands in rings (`splashRings`).
- **Rendered once, then the WebGL context is released**: everything that moves is a CSS transform
  layer, because the compositing budget belongs to the cards.
- **What moves is a sprite built in the same pass, its route in the world** (`scene/life.ts`,
  `maps/vistaLife.ts`, `Actor.world`, `Actor.scales`, scale on the same transform as the
  translation). **Routes stay clear of the near props** (`sceneLifeOcclusion.test.ts`); **what hangs
  in the sky is placed by the frame, in front of every tower** (`skyAltitude`, `skyRoom`,
  `sceneSkyActors.test.ts`). Reduced motion holds the first frame, followed live. **One transform
  animation per element** (`.actor`, `.body`, `.face`; `sceneLife.test.ts`). **A `loop` walks its
  closing leg or fades over it** (`closesTheRing`).
- **Drawn models come through the kit only** (`scene/models/`, CC0, packed by `make models`, served
  from this origin — never a CDN), colours baked (`bake.ts`). **Nothing stands inside anything else**:
  every `k.model` goes through `placer.ts`, **a refused model leaves the spot empty**. A drawn person
  faces +z (astronauts take `ASTRONAUT_MODEL_YAW`). **Each room loads only the kits it places**
  (`maps/index.ts: KITS`). `placer.test.ts`, `modelBake.test.ts`, `kitModels.test.ts`,
  `roomModels.test.ts`.
- **A resize is a stretch, then one render** (`RESIZE_SETTLE_MS`, 240ms, faded in). The engine is a
  lazy chunk behind `sceneCache.prepareScene`, the only importer of `render.ts`; **nothing else may
  import three.js**. **A render that fails — a lost context, a models load past `MODELS_TIMEOUT_MS` —
  is a scene, not an error**, remembered for `FAILED_TTL_MS`; the frame is copied out before the
  report's paint (no `preserveDrawingBuffer`). LRU cache keyed on the felt too; `renderSizeFor`
  reports the ratio it solved at. The hour reaches the table as `--scene-tint` / `--scene-dark`,
  never a repaint of `--tbl-*`; a `dry` room never rains; placements are seeded on the scene's key.
  `SceneBackdrop` isolates its stacking context (`sceneBackdrop.test.ts`).
- **The room is quiet, the mood contemplation**: a few slow things at the edges and in the sky,
  nothing crossing the table. **Windows mostly dark after dark** (`WINDOWS_LIT_MAX`, a half).
  **A round halo is a lamp head's, never a building's, and has no edge** (`HALO_SPHERE_MAX`,
  `fadeToRim`, `kitHalo.test.ts`).
- **A light is a light, not a coloured dot**: it pierces mist and air (`LOOK.post.pierce`), bloom
  after the air plus a wide one (`bloomWide`), a bulb hung at the arm's end (`lampHead`), a fog veil
  in the hour's colour; **a sign is bent tubes, never a bitmap** (`neonText`).
  `sceneLights.test.ts`, scene `game-map-velvet-night-fog`.
- **The warm/cool split is the mood, not a taste setting**: at every daylight hour **and in every
  room** the sun is warmer than the sky and the sky is cool (`sceneLighting.test.ts`); a room's own
  light (`LOOK.rooms`, `lightRig`'s third argument) never undoes it. The hour survives the weather.
- `maps.test.ts` pins the client's maps, hours and skies to `loco-game/src/maps.rs`. **Add a room**: a
  builder, a registry entry, its copy in both languages, its `MapId` (`MAP_IDS`) and `MAP_WEATHERS`
  in the domain, its light in `LOOK.rooms`, and its scenes.
- **The weather is drawn tiles, each sheet travelling exactly one tile per cycle**
  (`scene/weatherTiles.ts`, `tiled()` → `--tile-w` / `--tile-h`, `sheetBox`; `sceneWeather.test.ts`).
  **The wind is a skew, never a diagonal travel.** Rain and snow 3/2/1 sheets on high/medium/light,
  fog 2/2/1.
- **Under `auto` the weather is measured and shed** (`scene/weatherLoad.ts`, `LOAD_FLOOR_FPS`,
  `weatherLoad.test.ts`): **only the sheets, never the tier** (the tier is in the cache key), **never
  a tier the player chose**; a mean without hitches, never the median; one-way for the tab, never
  stored, watching only a landed room (`settled`). A static layer covers only its band (`.mist`).
- **The rooms page shows a photograph of the render, and nothing over it** (`TablesArticle.svelte`,
  `RoomStill.svelte`, `tools/rooms/shoot.mjs`, `make rooms` at `?gfx=force` into
  `src/assets/rooms/`); the CSS table only stands in for a missing still. `roomsPage.test.ts` pins
  the hour written twice and fails on a missing still.

**The loading gate**
- **The room is built exactly once per match**: `viewportSize()` and `safeAreaInsets()` read
  synchronously, a frame within 4% is stretched (`sizeCloseEnough`, `sameFelt`), and **a request
  joins a render of the same room, felt, tier and look already in flight** (`prepareScene`).
  `sceneLoadingGate.test.ts`, `sceneCache.test.ts`.
- **The bar moves because the render yields to a paint between phases** (`RENDER_STEPS`,
  `scene/nextPaint.ts`; a `setTimeout(0)` is not a paint): **anything heavy goes between two
  reports**. `sceneProgress.test.ts`.
- **A load ends on a full bar, always** (`MAP_BAR_FULL_MS`): painted full, held past `.fill`'s
  transition, then `done` — which sends `map_ready`. No hold under reduced motion; far under the
  server's map-load timeout. `mapLoading.test.ts`.
- **Nothing pale and nothing of the board shows while the room builds**: `.scene.bare` mixes the
  hour's sky down, `--room-void` is the horizon **taken down**, and the curtain is opaque from its
  first frame — the fade is `.room`'s, never `MapLoadingScreen`'s `.screen`.

**Ambience**
- **The entry screen is held between two hands of real cards** (`HomeHands.svelte`): out of the
  accessibility tree and the pointer's way, clipped by its own layer, **only from 75rem wide and
  40rem tall**. `lobby.test.ts`.
- **No painted ambience behind a screen: no glowing blobs, no floating silhouettes.** The objects
  carry the life: a hand is dealt card by card (`DEAL_FLIGHT_MS`), numbers are counted
  (`countUp.ts`), every screen arrives (`state/screenIn.ts`, in only).
- **Add a scene to `src/dev/scenes.ts` in the same change set as any new screen or visual state**, and
  review with `make visual` (`--viewports=wide,small` after touching `layout.ts`, `notch` for safe
  areas, `--scenes=card-sheet` for anything on a card).

## Audio
Detail: [`docs/notes/audio.md`](docs/notes/audio.md).

**Sound effects**
- **Every sound effect is synthesised at runtime; the music is not.** No sample library, and the bed
  is nineteen MP3 loops under `client/public/music/`, served from this origin and never a CDN.
- **The board plays nothing; one subscription does.** `gameAudio()` in `state/appEffects.svelte.ts`
  is the only place a game sound is played, and what to play is decided by `soundsForTransition` in
  `audio/gameSounds.ts` — pure, snapshot-diffing, unit-tested. A component calling `playSfx` directly
  is only ever a UI tap (`uiTap`, `uiBack`), never a game event.
- **Every sound is made of one of four materials, and none is a bare oscillator**: card stock on felt
  (`cardHit`, `snap`, `thud`, combed `noise`), wood (`mallet`, every interface sound), brass and bell
  (`stab`, `bell`), air (`whoosh`).
- **A cue is a struck chord, never a run, and no two moments may share one** (`stab()`). **A tail is
  a send, never an insert** (`audio.sfxReverbSend()`): the card handling is paper and stays dry.
- **A control that makes a sound on every step of a drag throttles it, and the sample says where the
  control now is** (`AUDITION_MS`, `playVolumeAudition(level)` climbing a pentatonic). **Level moves
  the pitch, never the gain** — the bus being moved already applies it. It takes an argument, so it
  is not a `SfxName` and `make audio-verify` measures it by hand.
- **Mobile Safari loses the context three ways and all three fail as silence, not as an error**:
  `unlock()` resumes any state that is not `running`, it is `async` and callers must await it, and
  `visibilitychange`/`focus` reclaim the context. `navigator.audioSession.type = 'playback'` at
  creation.
- **A cue is struck in the bed's key** (`harmony.ts: cueShiftFor`, `sfx.ts: setTonalitySource`, read
  at the moment the cue plays). The whole vocabulary moves together, C onto the bed's home chord or
  its IV or V, **never more than three semitones**. Only what has a pitch moves (`mallet`, `bell`,
  `stab`, the reverse); paper and felt have no key. `sfxKey.test.ts`.
- **`make audio-verify` has a floor and a ceiling.** Anything above 0.8 fails — headroom below hard
  clip: two cues overlap here and the bus carries no limiter.

**The bed**
- **The music is nineteen CC0 loops by Abstraction** (`audio/tracks/` the registry, `public/music/`
  the files, credit in `NOTICE.md` and `licenses.txt`), normalised to −18 LUFS and encoded to MP3.
  **MP3, not Ogg**: Safari refuses Ogg Vorbis in `decodeAudioData` before 18.4, which fails as
  silence. Add one by encoding a file and writing a `LoopDef`.
- **A loop is looped on the source file's duration, never the decoded buffer's** (`LoopDef.seconds`):
  MP3 carries encoder delay and padding, and both survive `decodeAudioData`.
- **The bed keeps more loops than sections.** Every section must be carried by **at least two** loops
  and the groove by **at least five** (`music.test.ts`), and the bed changes loop for exactly two
  reasons: the table moved section, or this one has come round `LAPS_PER_LOOP` (**2**) times.
  **Every family carries the wait and the endgame at least twice over.** The breakdown is exempt.
- **A change of loop lands on the beat** (`LoopDef.bpm`, `untilNextBar`, `untilNextWrap`,
  `musicHandover.test.ts`). A section move waits for the outgoing loop's next bar line; a lap
  handover is decided `HANDOVER_LOOKAHEAD_S` early and lands **on** the wrap; a scene move and ⏭ are
  answered on the spot. **Every loop is a whole number of bars at the tempo written for it**
  (`music.test.ts`); where a tempo and its double both fit, the **slower** is written.
- **Every loop carries its key, measured on the file** (`LoopDef.key`). **Two loops are overlapped
  only when they agree in key (two steps on the wheel) and in tempo (3%)** (`harmony.ts:
  handoverFor`); a blend hands the bass over on a beat (`BASS_SWAP_HZ`). Otherwise it is a **cut, and
  a cut is never a crossfade**: the outgoing loop closes under a low-pass over its last two beats
  (`cutTailFor`), air rises into the downbeat (`scheduleSwell`) and the next lands whole on it. Only
  a press may overlap a disagreeing pair, for `SPOT_CUT_S`. `musicHandover.test.ts`.
- **The next loop is the nearest one left in the bag** (`followCost`: a blendable pair first, then
  the key, then the tempo), **and never the one just left while the bag holds another**
  (`previous`).
- **A rise enters its loop on the first full phrase** (`LoopDef.entryBar`, a multiple of four,
  measured) **and a fall lands on a phrase line** when one is within `PHRASE_WAIT_MAX_S`
  (`untilFallLands`). `planSectionChange` decides all of it before anything is scheduled.
- **The fade's length is the reason for it** (`fadeFor`): a rise `RISE_FADE_S` (1.5s), a fall
  `FALL_FADE_S` (4s), a change the player made `CROSSFADE_S` (2s), the scene going off `STOP_FADE_S`
  (1.2s). **Only a hidden tab and an unmount cut.**
- **The queue is the wait and the recap is the game** (`sceneFor`, `intensityOf`): `searching` and
  `matchfound` play the menu's scene; `gameover` is the **match's** scene at the round summary's
  intensity. Only `restoring` is off. **A scene move changes the piece on the spot**, subject to
  neither hold. `musicScene.test.ts`.
- **The intensity is slewed and the section is held** (`SLEW_PER_SEC`, `SECTION_HOLD_MS`), **and a
  fall is believed twelve seconds after a rise** (`SECTION_RELEASE_MS`): an endgame hand goes
  1 → 3 → 1 every few turns. A rise is answered on the hold; every return above the line restarts the
  wait. The breakdown is exempt.
- **A match is played inside one family** (`LoopDef.family`, `FAMILIES`). Every loop change stays in
  the palette the scene opened on, `prefetch` warms that palette only, and a scene change draws
  another family on the loop change it was making anyway.
- **A hidden tab is a pause, and the return resumes the same loop from the same bar** (`park` /
  `resume`, `resumeOffset`). Only a scene that moved meanwhile starts over.
- **`swapTo` awaits the incoming buffer *before* it touches the outgoing voice**, so a cold change is
  inaudible and `PREFETCH_MAX` (3) can stay small. **The cache is bounded by memory, not download**
  (`CACHE_BUDGET_BYTES`, 64 MB, LRU, never evicting a sounding or fading voice; a 1.5 MB MP3 decodes
  to 37 MB), and `PREFETCH_MAX` must stay inside it (`music.test.ts`).
- **Nothing a player can see or hear moves before the piece is sounding.** `this.loop` and the
  persisted `track` are written at the **commit** inside `swapTo`, never at the request. **A request
  arriving during a swap is recorded in `desired`, never dropped**, and a bed with nothing sounding
  and nothing on its way asks again on the next tick.
- **A loop change is a crossfade between two source gains, equal-power, and never touches `out.gain`**
  — which belongs to `duck()` alone. **Each voice fades in on one gain and out on another**
  (`Voice.release`, `retire`'s alone): Firefox and Safari refuse a fade-out laid over a fade-in still
  running, and the throw leaves the old loop playing under the new one. The voice's filters are its
  own; the bed's one low-pass (`tone`, after the duck) belongs to `setMuffled` and `dip`.
- **The bed answers a moment by `bedCueFor`, one answer, the strongest**: the match's fanfare
  **brakes** it (`brake()`: slowed like a record, quiet for `BRAKE_REST_MS`, the recap's piece
  rising over `REENTER_FADE_S`), a round's **ducks** it, a LOCO! or a Contre-LOCO! **dips** its top
  end. The cues are played first, so a fanfare is struck in the key it was earned in.
- **Something read over the table muffles the bed and never stops it** (`state/bedMuffle.svelte.ts`,
  counted): the rules and the preferences. **Not the audio panel** — somebody setting the music's
  volume is listening to it.
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
- **The one third party is on the server's side of the line.** The live-streams poller asks Twitch,
  through Janus, on a timer, carrying nothing about anybody; the previews are re-served from this
  origin. A thumbnail loaded from Twitch would be a request from the reader's browser carrying their
  address. The policy copy says which of the two makes the request, and `legal.test.ts` pins that
  sentence.
- **No address is ever written in full.** `privacy::truncate_addr` (behind the `ClientNet` extractor)
  and the `anonymised` `log_format` in `client/nginx.conf` cut every address to `/24` or `/48` **at the
  point of writing**. Log lines are correlated by `conn=`. **Never read the peer's address outside
  `net/privacy.rs`**; `legal.test.ts` fails on `remote_addr` / `peer_addr()` anywhere else in the hub.
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
  dev server, read by `sceneCache` behind `import.meta.env.DEV`). It opens many tables and asserts
  nothing about the scene — appearance is `make visual`'s — and a headless render costs seconds,
  hundreds of requests and megabytes of models each. The gate is answered with the sky gradient, the
  path a machine with no WebGL takes, so `map_ready` and every ordering behind it are unchanged. **On
  the dev server and not in an init script**: a page reaches the suite four ways and only the server
  is common to all four. `sceneLoadingGate.test.ts`.
- **A wait may not outlive the test that owns it** (`helpers/game.ts: budget()`): a helper capped
  longer than its test can never fire, and the hang reads as a bare test timeout with no word about
  what it waited for. `budget()` clamps to what the test has left; `test.setTimeout` still wins.
- **The 1v1 queue is the one server-global the suite contends on**, so `matchmaking.spec.ts` claims
  it (`helpers/matchmakingQueue.ts`: a cross-process mutex, plus a wait on `/metrics` for
  `matchmaking_queue == 0`, plus a borrowed timeout so queuing does not spend the test's budget).
  **Anything else added to that queue takes it too.**
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
  `server-bin` (a static musl `loco-server` built by `backend_test`) travels by cache, keyed per
  branch with a `server-bin.sha` stamp.
- **The server's gates are `backend_test`** (`cargo test --workspace --locked`, and `loco-game` built
  for `wasm32-unknown-unknown`), **`backend_lint`** (`cargo fmt --check`, `clippy -D warnings`,
  `cargo deny check`) and **`protocol_check`** (the converter's refusals, `loco-protocol`'s tests,
  `protocolgen --check`). Each Cargo job has its own cache key: two jobs pushing one key race.
- **The client tests that pin a copy to the server's source read it through
  `src/test/serverSource.ts`** (`serverPath(pkg, stem)` searches the crate's `src/` recursively),
  naming each constant by its Rust name, so a moved constant is fixed in one file.
- `PLAYWRIGHT_VERSION` and `e2e/package.json` are one decision: the dependency is pinned exactly and
  asserted against the image before the suite runs. There is no `playwright install` step.
- Run `make csp` after touching `nginx.conf` **or bumping a dependency**.
- **Dependencies are bumped by Renovate** (`renovate.json`, the org preset plus this repo's rules):
  weekly, against `develop`, the two Playwright pins in one PR, TypeScript held under 7, the toolchain
  images grouped. Its PRs carry the `make csp` reminder; the CI is what accepts them.

## Docker
Production path: Traefik to nginx (:80) to `loco-server` (:8080, internal only); **nginx proxies
`/ws`, `/live.json` and `/live-thumb/`, and nothing else** — `/health` and `/metrics` are operator
surfaces, deliberately unreachable from the internet, and `csp.test.ts` pins that list so a fourth
path is a decision somebody takes on purpose — serves the SPA, and sends CSP / `nosniff` /
`Referrer-Policy` / `Permissions-Policy` / `Strict-Transport-Security` on every response. **HSTS
carries neither `includeSubDomains` nor `preload`**: both are promises about names this repository
does not serve and cannot withdraw once a browser has cached them.

**`/models/` is a static block like `/music/`**: a week of `Cache-Control` (the names are not
hashed), the security-headers include, and `model/gltf-binary` on top of the stock `mime.types`,
which has no `.glb` — and is in `gzip_types`. `csp.test.ts`.

**The socket has a second hostname**, `ws.*`, DNS-only and outside the CDN, answered by the same
nginx with `ws-proxy.conf` and a 404 for everything else. Why, and what it costs operationally:
[`docs/deployment.md`](docs/deployment.md).

**Those five headers live in `client/security-headers.conf`, and every `location` block that declares
an `add_header` of its own must `include` it** — in `nginx.conf` *and* in `client/ws-proxy.conf`.
nginx inherits `add_header` only into a level that declares none, so one `Cache-Control` in a block
silently strips all five from everything that block serves (the whole `/_app/immutable/` bundle,
while the document response alone looks clean). `csp.test.ts` fails on a block that declares without
including.

**The server image is a static musl binary on `gcr.io/distroless/static:nonroot`**
(`server/Dockerfile`): no shell and no `wget`, so **the healthcheck is the binary itself**
(`loco-server healthcheck`, a `GET /health` on loopback), and it runs as **uid 65532**. `/data` is
created owned by that uid, and the deploy chowns the host path to it: a container that cannot write
its snapshot loses every match in flight on the next deploy. **Snapshots are per environment**:
`${DATA_DIR}/snapshots/${DEPLOY_ENV}` mounted at `/data`, so dev and prod on one host never read
each other's file ([`docs/deployment.md`](docs/deployment.md)).

**Run `docker run` through `make` or PowerShell, never raw from Git Bash on Windows.** MSYS rewrites
`-v src:/app` into `src;C:/Program Files/Git/app`; the `-w` errors out but the mount has already made
an empty `server;C` directory at the repo root that `git status` cannot see. `MSYS_NO_PATHCONV=1` if
Bash is unavoidable.

---

## Starting a session
Read this file, then `README.md`, then **the note in `docs/notes/` for the subsystem you are about to
touch** — this file states the rules, not the reasons, and changing a rule you only half understand
is how they get undone. Doc drift is silent: when a doc and the code disagree, the code is the truth
and the doc is fixed in the same change. Never let `CLAUDE.md`, `README.md` or `docs/notes/` go stale.
