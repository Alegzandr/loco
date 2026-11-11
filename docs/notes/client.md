# Client: transport, state, i18n

The path between the socket and the store, the performance rules that protect it, and the client's
own screens and copy. Rendering is in `visual.md`.

## Where the client's logic lives

| Module | What it owns |
| --- | --- |
| `state/serverMessages.ts` | every inbound message, applied to the store. `App` builds it once |
| `state/gameStore.ts` | the store's assembly, and the re-exports every screen imports from |
| `state/gameStore.svelte.ts` | Svelte's window onto the store: one signal per top-level field (below) |
| `state/live.svelte.ts` | the narrowing for a value *computed* from a field, a nested field, or a prop |
| `state/store/` | `types.ts` (the state shape and the five action interfaces), `initialState.ts`, `helpers.ts`, and one module per family of transitions |
| `state/gamePlay.svelte.ts` | what a tap on a card means and the two prompts it can open; the legality the board highlights with; the interception rattle and the Contre-LOCO! thump; rendering the room while the gate is shut, then answering `map_ready` |
| `state/viewEffects.svelte.ts` | table news that takes itself off screen; the held key; the reconnect overlay's clock; the ticks over the last seconds of our turn |
| `state/appEffects.svelte.ts` | the one subscription that plays a sound; mirroring the seat into `sessionStorage`; the restore timeout; the host's streamer mode reaching the table |
| `dev/e2eBridge.svelte.ts` | the whole `window.__LOCO_E2E__` surface, dev builds only |
| `src/game/` | pure, framework-free game logic the screens read: `catchAvailability.ts`, `interruptHelpers.ts`, `scoreTableModel.ts`, `matchRecapModel.ts`, `matchLengthModel.ts`, `matchDuration.ts`, the server mirrors `nicknameRules.ts` and `tableCodeRules.ts`, `searchStages.ts`, `swapNoticeText.ts`, `playerColors.ts`, `playersOnline.ts`, `liveStreams.ts`, `twitchLinks.ts`, `emotes.ts`, `cardCatalogue.ts` |

### The store's window: one signal per field

`state/gameStore.svelte.ts` is the one subscription the app takes on the store, at module load and
never torn down. **Each top-level key is its own `$state.raw` cell**, and a write moves only the
cells whose value is not `Object.is` the one before. `game.current` is one stable object for the
life of the tab, a getter per key, so reading `game.current.errorMsg` — in an effect, a `$derived`,
a template or through a local holding `game.current` — depends on `errorMsg` and nothing else.
Spreading it, `JSON.stringify` and `Object.keys` still see the whole state. Anything that genuinely
wants "the store moved" reads `game.snapshot`, the store's own object, which depends on every write
by name. `$state.raw`, not `$state`: the store already replaces what it changes, and a deep proxy
would give the board's props a new identity on every read.

Why it matters: these effects own timers. An effect that re-runs clears its timer and arms a fresh
one, so if an effect watching one field re-ran on every message, a window measured in seconds would
never reach its end on a busy table — a notice that never leaves (`autoClear`), the reconnect
curtain staying over a table that is back (`reconnectAnimation`), the turn bar restarting from full
on every play (`drainBar`), the prompts closing themselves (`cardPlay`).

**`live()` is for what the per-field window cannot narrow** (`state/live.svelte.ts`): a value
computed from a field (`players.length`, a lookup into `catchWindows`), a nested field of an object
the store replaces whole (`lastPlay.at`, `matchFound.startsAt`), and a prop. It wraps the getter in
a `$derived`, which Svelte compares, so the effect re-runs only when the answer changes. Every hook
that takes a `Live<T>` reads it this way.

**A child gets no narrowing on a prop either**: reading `p.watched` subscribes to the prop, and a
sibling prop being re-evaluated re-runs the effect even when the value came back equal. Two shapes
make an effect immune to re-runs:

- **An effect that spawns something guards on the trigger's timestamp** (`lastPlayAt`, `lastSwapAt`,
  `lastCatchAt`; `DiscardPile` reads its `key` derivation and takes the card out of the dependency
  list with `untrack`), which also makes it immune to a resize.
- **An effect that holds a timer works to an absolute deadline** (`Hand`'s `dealUntil`, `drainBar`),
  so any number of re-runs ends at the same moment. A guard that only decides whether to *start*
  fails: the cleanup runs whether or not the guard lets the body through.
- **A once-per-key effect abandons on that same key, never in its cleanup** (`mapPreload`).
  Otherwise an unrelated re-run cancels the render in flight and the once-per-key guard refuses to
  restart it: `done` never comes, `map_ready` never goes out, and the table opens on the server's
  20s `MapLoadTimeout`. A table with a bot never shows it (nobody re-broadcasts), so only real
  two-human tables pay. `mapLoading.test.ts` moves a seat mid-render and asserts the answer still
  goes out.

**A test that hands a hook a constant cannot see any of this.** `src/test/liveDeps.test.ts` moves a
field the hook is *not* watching and asserts it did not notice, for the hooks and, through the real
store, for the components (`gameStore.setState({ latencies })` changes nothing anybody animates).
Anything new taking a `Live<T>` or holding a timer behind a prop belongs in it.

**A no-op write is not a write.** `deriveCatchMiddleware` returns `state` itself when an action hands
it back unchanged, so a prune with nothing expired is not an app-wide invalidation;
`storeNoOp.test.ts` counts notifications. Actions read off the store (`gameStore.getState()`), never
through the window, or the effect calling them depends on them.

**Derived state is completed by the store, not by the actions.** `catchTarget` and `unoTimerEnd`
answer "which open window is the button offering", read off `catchWindows` and our own seat.
`store/deriveCatchMiddleware.ts` completes any write naming `catchWindows` or `myIndex` (a snapshot
can re-seat us), so an action cannot forget to recompute. It also replaces `store.setState`, so a
test seeding a board cannot seed an inconsistent one. `catchDerivation.test.ts`.

**Who owes a declaration is not the client's to work out.** `applyCardPlayed` renders `catch_seats`
off the message (the server's `GameState::catchable_targets`). What stays here is presentation:
which window we have already spent a call on, and whether the LOCO! banner still describes the table.

**The store is one state object and five families of transitions**, not five stores: it is the
client's mirror of one match, and an authoritative `game_state` settles the board, the declarations
and the scoreboard in one write.

**`GameBoard.svelte` is deliberately not split.** Its animation effects are one state machine over
one queue (`fliers`, `impacts`, `landTimers`, the stage node, the suppress-next-discard flag). If it
is ever split, it is one `boardFx` module, reviewed with `make visual`. **Its spawns go through
`untrack`**: `fliers = [...fliers, x]` reads `fliers`, so an effect appending to it would depend on
the list and replay forever. `addFliers` reads without subscribing; any new effect appending to a
`$state` array does the same.

## How the game gets on the page

The site is one SvelteKit app (`@sveltejs/kit` 3, `adapter-static`). Every URL is a prerendered file
in `client/build/`, served by nginx (no Node in production), and the router moves between them
without a document load, so reading the rules from the menu keeps the socket, the music and the
store.

### Routes: two groups, and the registry decides every path

```
src/routes/
  +layout.svelte          fonts, reset, the document's attributes, the cross-fade, and the game
  +layout.ts              prerender = true, trailingSlash = 'always'
  +error.svelte           the dev server's miss (production's is nginx's 404)
  (game)/+layout.svelte   the frame around the game: head, <h1>, the bar with the sheet, the drawer
  (game)/+page.svelte, (game)/fr/+page.svelte, (game)/i/+page.svelte
  (content)/+layout.svelte              header, column, back-to-top, the bar
  (content)/[slug=pageEn]/+page.svelte  every English content page   (+page.ts: entries)
  (content)/fr/[slug=pageFr]/+page.svelte  every French one          (+page.ts: entries)
  404/                    builds 404.html: trailingSlash 'never', csr = false
  sitemap-index.xml/, sitemap-0.xml/    prerendered +server.ts from seo/sitemap.ts
```

- **Two route groups, one per shell.** A move between content pages keeps `(content)/+layout` and
  replaces the article; `/` to `/fr/` keeps `(game)/+layout`.
- **A content page is one parameterised route per language.** The slug is matched against the
  registry (`src/params.ts`, `defineParams`) and the `entries` are the registry's slugs
  (`seo/document.ts: contentSlugs`), so `seo/meta.ts` is the single source of every path and a URL it
  does not know is the 404. `content/Article.svelte` maps page to article. `params.ts` and its imports
  name their `.ts` extensions: Kit loads the matcher through Node's own loader at build time, where an
  extensionless import does not resolve.
- **Everything a page shows comes from its URL**: `seo/document.ts: routeFor(pathname)` gives the
  page, its language, game or document, and the `<html>`/`<body>` attributes. Three readers must
  agree — `hooks.server.ts` at prerender, the root layout on every navigation (`$effect.pre` on
  `page.url`), the group layouts for head, chrome and article. No `load` carries it: its data would be
  serialised into every page's bootstrap for nothing. `seo.test.ts` walks every registry path through
  it.
- **`content/ui.ts` is a data module, not part of `i18n/`**: the game's translations are downloaded
  by every player, and the content pages' copy has no business in them.
- **One article chunk for both content routes** (`content/Article.svelte` imports every article). It
  weighs on hydration, never on what a reader or crawler sees first.

### The game lives in the root layout

The root layout is the one component the router never replaces, so it renders `<div id="root">`
with the game in it, before the page's children. On a game page that is the board's place in the
flex column (`GamePage.css`); on a content page it stays rendered but `.parked` — `inert`,
`aria-hidden`, invisible, viewport-sized (`base.css`) — so the socket, the music, the store and a
running match carry on and are there on the way back (`e2e/tests/shell.spec.ts`: one document and
one socket across Back/Forward).

While parked the game releases what it does to the document (`state/gameShown.svelte.ts`):
`data-seated` (`App.svelte` writes it only while shown; `setTabSeated` still answers the other tab's
question) and the TAB key (`heldKey` stands down).

**The app is never server-rendered**, and the game route is not `ssr = false` either. The prerendered
`#root` is empty (the store comes from `sessionStorage`, the language from `localStorage`, the board
from the viewport), but `/`'s served half — the `<h1>`, the bar, the prose sheet — must be in the
HTML for crawlers and for `<details>` with scripts off.

**The boot runs once per document, the first time the router is on a game page** (`src/boot.ts:
bootGame`, called by the root layout): `initLang`, `initMotion`, `initI18n`, `initPinchGuard`,
`initContextGuard`, `initTableInvite`, `initTabLock`, `initSessionRestore`, in that order. Never in
`hooks.client.ts` or on a content page: a tab reading the rules holds no game, and `initTabLock()`
electing it would curtain the tab actually playing. On every later arrival at a game page the root
layout runs `initLang()` and `redetectLang()` again. `Root.svelte` is the tab lock's switch, which
decides whether `App` (and its socket) exists at all.

**A game page arrives in one piece.** The prerendered chrome paints on the first frame and the lobby
when the game has booted, so a canvas-coloured veil (`body.game::after`, fixed, no pointer events)
covers both until `boot.ts: markBooted` writes `data-booted` (two `requestAnimationFrame`s after the
render), then lifts in one 0.34s fade. **The veil fades, never the content**: everything under it is
opaque from its first paint (see seo.md, "NO_LCP scores 0"), and the veil is the canvas's own colour,
so the body's gradient never shows. The hold is inside `@media (scripting: enabled)` with a 3s
fallback, the reveal is spent 600ms later (which removes the veil), and it animates opacity only.
`contentPages.test.ts`.

### Behaviour is the components', not a script's over the markup

Each behaviour lives in the component that renders its element, never in a script finding markup by
selector:

- **The prose sheet** (`(game)/+layout.svelte`): native `<details bind:open>` (opens with no script),
  plus Escape, the scrim, the ✕, and focus handed back to its opener.
- **The drawer** (`layouts/SiteDrawer.svelte`): shuts when the window widens past the phone and after
  a navigation (`afterNavigate`); the About and Preferences rows.
- **The language panel** (`layouts/SiteFooter.svelte`): the choice recorded on the link
  (`rememberLang`), the panel shut after a navigation.
- **Back to top** (`layouts/ToTop.svelte`), **smooth in-page travel** (`(content)/+layout.svelte`,
  `html[data-scroll]`) and **the live list** (`content/LiveArticle.svelte` rendering
  `content/liveList.ts: fetchLiveRows`, as Svelte text, never markup).

A control only a script can honour ships `hidden={!hydrated}`; every page reads the same with no
script. **Anything a prerendered page shows is rendered, never mounted in an effect** — an effect does
not run at prerender — which is why `livePage.test.ts` and `legal.test.ts` refuse an effect in an
article.

### The CSP stays closed, and the header is what allows the router

A prerendered page starts the router with one inline `<script>`. SvelteKit hashes it (`csp: { mode:
'hash' }`) into a `<meta>`, but a meta policy does not loosen nginx's header policy. So the last step
of `npm run build` is `scripts/csp-hashes.mjs`: it hashes every executable inline script in `build/`,
fails if one is missing from its page's meta, and writes `csp-hashes.conf` (one `set
$loco_script_hashes "…";`) that `security-headers.conf` splices into `script-src`. Generated,
git-ignored, copied by the Dockerfile from the builder stage. `csp.test.ts` pins the wiring and
refuses any hand-written inline script except structured data; `make csp` (`tools/csp/check.mjs`)
loads every page and a content-to-game navigation behind the real header. The 404 carries no script.

- `inlineStyleThreshold: Infinity` (styles are `'unsafe-inline'`; scripts only by hash).
- The sitemap is `src/seo/sitemap.ts` built from `PAGES`; the rooms page's art goes through
  `@sveltejs/enhanced-img`.
- `vite.config.ts` writes `envPrefix: ['VITE_']` out for `wsEnv.test.ts` (below). The site origin is a
  `define` (`__LOCO_ORIGIN__`), not `$env/static/public`, because the E2E suite imports `seo/meta.ts`
  through Node, where neither `import.meta` nor `$env` exists.

### One shell, not two sites

What the site and the game both draw is drawn once:

- **One bar and one drawer** (`layouts/SiteFooter.svelte`, `layouts/SiteDrawer.svelte`), styled once
  in `content.css`: same links, privacy last, the language globe in the same place on every page that
  is not a seat, one height. What differs is passed in. Reasoning: `seo.md`, "The shell".
- **The bar does not move between pages** (`view-transition-name: site-footer`; a 0.22s cross-fade,
  `onNavigate` + `document.startViewTransition`, skipped under reduced motion — the game's
  `data-motion` once booted, the system's before — and for a fragment).
- **The globe is a link everywhere**, `/` included, and records the choice on the press.
- **No glass**: the content header and the bar are opaque canvas; blur is the modal scrim's alone
  (DESIGN.md).

Deliberately distinct: the content pages' **header** (mark + Play) has no counterpart on `/`, whose
entry screen is its own composition; the **top-right chip row** stays the game's; **at a seat there is
no site chrome** (bar and burger go on `data-seated`).

## The toolchain

Svelte 5, SvelteKit 3 on Vite 8, Valibot 1, ESLint 10, Vitest 4, TypeScript 6.

- **React is not used and stays out.** No `react`, `react-dom`, framer-motion, `.tsx` or
  `.module.css`. `src/test/noReact.test.ts` checks the manifest, the Vite, Vitest and ESLint configs,
  every import, and every file extension under `src/`.
- **Shared state is framework-free.** The language (`i18n/store.ts`), the game state
  (`state/store/createStore.ts`) and every on/off preference (`state/prefStore.ts`) are plain modules
  with a subscription, read through `createSubscriber` (`i18n/i18n.svelte.ts`,
  `state/prefs.svelte.ts`). One copy of the current language is what keeps a document from being half
  translated.
- **`state/` splits on the extension.** `.svelte.ts` for anything owning reactive state or an effect,
  plain `.ts` for the rest, and **nothing in a plain `.ts` may reach for a rune**: Svelte compiles
  runes only in `.svelte` / `.svelte.ts`, so a `$state()` there is a call to a missing global that
  throws at run time, not a build error. `src/test/runeScope.test.ts` catches it.
- Svelte applies a change on the microtask after it, so a DOM assertion right after `fireEvent` needs
  a flush, done once in `src/test/setup.ts`.
- **Svelte silently prunes a selector it cannot see in the markup.** A class applied at runtime is
  bound with `class:`, never `classList` (`drainBar`'s urgent class). **No `:global()` without a
  written justification** — it silences exactly that check.
- **`vite build` type-checks nothing.** `npm run build` is `svelte-kit sync && svelte-check && vite
  build && node scripts/csp-hashes.mjs` (`npm run check` is the first two). SvelteKit 3 enforces
  `verbatimModuleSyntax`, so a type imported as a value is a build error: every type import is an
  `import type`.
- **There is no `svelte.config.js`.** The adapter, the CSP, the preprocessor, `runes: true`,
  `public/` as assets are passed to `sveltekit({...})` in `vite.config.ts`; svelte-check reads it
  there, and `vitest.config.ts` merges it so a test sees the build's module graph.
- **The store is ours** (`state/store/createStore.ts`, ~40 lines): `getState`, `setState`,
  `subscribe` and a middleware slot, whose semantics `gameStore.test.ts` and every
  action in `store/` assume and `src/test/storeCore.test.ts` pins. The subtle one:
  `deriveCatchMiddleware` reassigns `store.setState` while the creator runs, so the store must publish
  the property the creator mutated, never a copy, or the derivation applies to actions only.
- **Events are lowercase DOM names and props are ordinary props.** Svelte silently ignores an unknown
  prop, so a camelCase `onClick` is a handler that never runs (`card.test.ts` counts the clicks).
- **A parent animating a node animates a wrapper it owns**: `AnimationLayer.svelte` puts `use:play` on
  the `<div>` around each `<Card />` / `<CardBack />`; `Card` and `CardBack` take no node callback.
- **The validator is Valibot** (below, "Protocol validation").
- **TypeScript stays on 6.x**: `svelte-check@4` drives TypeScript's programmatic API, which the 7.0
  native compiler does not ship, and SvelteKit 3 declares `^6`. The E2E package follows the same major.

## A snapshot is authoritative when it arrives, and never afterwards

Nothing that carries a board may be held and replayed: it describes a table at the instant it was
stamped. **The round summary is an overlay, not a pause.** The next round's `game_started` is applied
under it, `applyGameState` does not touch `showRoundSummary` or `roundWinner`, and
`dismissRoundSummary` puts no board back. `pendingMatchEnd` is the one thing buffered, because
nothing follows a match end. The `yourTurn` cue (`audio/gameSounds.ts`) waits for the card to come
down for the same reason.

## The realtime path (tap → wire → table)

Every hop between a finger and the other boards is on the path of a mechanic decided by arrival
order. **A delay added here is a rules change, not polish.**

- **nginx `/ws` sets `tcp_nodelay on` and `proxy_buffering off`** (`ws-proxy.conf`): Nagle holds
  few-hundred-byte messages up to 40ms on the one hop the app cannot see.
- **The server keeps WebSocket compression off** (`net/serve.rs`): on payloads this small, deflate
  buys nothing and costs a pass on both ends of every play.
- **Send first, animate second.** `GameBoard.handleCardClick` spawns the hand→discard flight only if
  `onCardClick` returns `true`. `cardPlay`'s `onCardClick` returns `false` when the client refuses
  the card and when the tap only opens the colour/player prompt, so **a tap that is not a play
  animates nothing**. A play confirmed in a picker flies through `flightRef`
  (`GameBoardHandle.flyFromHand`) right after `onSend`.
- **The packet goes out before anything else moves** (`App.handleSend`): send, then clear the refusal
  toast, since a store write notifies every subscriber.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, keyed `draw` / `pass` / `uno` /
  `catch:<seat>`). A shared lockout ate draw-then-pass, LOCO-then-catch and a second catch after a
  Swap.
- **A prompt lives exactly as long as the play behind it stays legal.** `cardPlay` re-reads the
  condition that opened the picker on every state change (`clientMayInterrupt` for an interject,
  `currentTurn === myIndex && clientMayPlay` otherwise, plus the card still in hand) and closes it
  when false — a timeout, a forced draw or a fresh `game_state` moves the board without a play.
- **Every board control acts on the press, not the release** (`components/press.ts`,
  `use:pressToAct` on `Card`, `Deck` and the action bar's buttons). `click` comes 80–150ms after the
  finger lands on a touch screen, which decided interjects and catches by who *lifted* first. The
  handler runs on `pointerdown` (primary button) and swallows the click it produces; a click with no
  press (keyboard, synthetic) still runs it; a disabled control fires on neither (Chromium dispatches
  pointer events on disabled controls). Cancelling by sliding off is given up. `press.test.ts`,
  `card.test.ts`; Playwright's `click()` exercises the real path.
- **A queued gameplay intent ages out** (`webSocketPolicy.keepPendingIntent`,
  `PENDING_INTENT_MAX_AGE_MS`): plays, draws, passes, calls, catches and emotes queued while the
  socket is down are dropped past the bound, since the board has moved on; joining a table or a search
  is kept. `pendingIntents.test.ts`.
- **A stamp is an identity** (`store/helpers.ts: stamp()`, strictly increasing): flashes, banners and
  sounds guard on `next.at !== prev.at`, and two events in one millisecond must not share one.
- **The discard effects key on the play, not the face** (`GameBoard`'s discard effect,
  `DiscardPile`'s `playStamp`): an interject is the same face as the card under it. The
  "already covered by a flight" flag is read and cleared before any early return.
- **Whether the pile may still be slammed is read off the store, never the card**
  (`store.interruptOpen`, `clientMayInterrupt`'s fourth argument), set by every message that moves
  the window; absent on a snapshot means shut. The highlight, the tap and the prompt-closing effect
  all read it. `interruptWindow.test.ts`.
- **A slam is one card.** Every copy past the first was a window somebody else could have won (three
  +4 in one press put twelve cards on the next player for one reaction). `onCardClick` sends `card`
  alone out of turn, the colour prompt carries one card, `loco_game::bot_interrupt` plays one copy,
  and the server refuses a batch (`GameError::InterruptBatch`). `interjectSingle.test.ts`,
  `locoFinish.test.ts`.
- **The handling has a hand in it**: `sfx.ts` varies each card hit slightly (`humanVariation`) and
  `state/haptics.ts` answers the same cue list, so sound and vibration cannot disagree.

### Contre-LOCO! on the client

The server's rules (the offer, the ration, the lockout) are in `domain-rules.md`; this is how the
button reads them.

- **It is pressable before the server has named anybody** (`game/catchAvailability.ts`,
  `CATCH_LIVE_MAX_HAND = 2`): live on any *other* seat holding exactly two cards, or any seat whose
  window is still running. A control that unlocks on the server's cue can only be answered, never
  anticipated; the wager's price keeps the early press honest. **Two, not three**: from three the
  window needs a two-card interject, a loss a player can schedule, which would make the price buyable.
- **Hand sizes, our own seat and the clock decide it, and nothing else may.** `isCatchLive` does not
  take `declaredSeats`: going dead on a declaration would *report* the call. The clock is
  `store.onHookUntil` (seat → the window end from `catch_seats`, written by `applyCardPlayed` and
  `applyGameState`), kept past the declaration, past the window leaving `catchWindows`, and past the
  hand growing back. A reloaded tab holds no clock; only the *armed* cue (`catchTarget`) is a promise.
- **`CATCH_LATE_GRACE_MS` (2s) is under the server's `CATCH_GRACE_MS` (3s) by the width of the
  wire**: a press on the last live frame still arrives inside the charged stretch.
  `serverMirrors.test.ts` pins the inequality, not either number.
- **A seat drawing out of two keeps the button live** `CATCH_NEAR_GRACE_MS` (1.5s) longer
  (`store.nearUntil`, written by `applyCardDrawn`), under the server's `CATCH_NEAR_GRACE_MS` (2.5s)
  by the wire, pinned the same way: otherwise the draw greys the button under a press on its way down.
- **A tail keeps a live button live; it never lights a dark one.** When `applyCardPlayed` hands a
  spent wager back it drops the tails with it (`liveWindowsOnly`: only a seat on one card inside its
  window survives; `nearUntil` is emptied). A player who never pressed keeps the tail.
  `catchDerivation.test.ts`, "the spent wager".
- **There is no latch: the clock ends the offer, never the next card** (`catchLiveUntil`, derived by
  `deriveCatchMiddleware`; `GameView` arms one timer on it and calls `rereadCatchLive`). A latch held
  until the next card was farmable. The timer includes the grace, because the button goes dark when
  the server stops charging.
- **`store.catchSpent` is the client's copy of the server's ration**, set by every press, cleared by
  `applyCardPlayed`. It suppresses the *blind* send only — the second tap of a double tap on a catch
  that landed, which the server's ration does not cover. `store.myDeclared` (our LOCO! chip) is
  derived by the middleware like everything else that is a function of the board.
- **The press is acknowledged on the frame it lands** (`store.catchPending`, `.called` on the button:
  ledge collapsed, face darkened, armed pop stopped) until whatever answers it arrives — the catch
  (`applyUnoCaught`), the miss (`applyCatchFailed`), a refusal (`setError`), the next card
  (`applyCardPlayed`) or a snapshot. Without it the armed glow going out read as "dead". It presumes
  no verdict and disables nothing. `gameStore.test.ts`, `actionBar.test.ts`, scene
  `game-catch-pressed`.
- **The lockout explains itself.** `store.catchLockedUntil` is the server's absolute instant,
  `store.catchLocked` is derived beside `catchLive`, and `<ActionBar />` draws the sunken slot, a
  padlock and a drain to that instant (`loco-slide`), **no digits**. It must say something because
  every press inside the lockout re-arms it. The **halo comes off** (`class:armed={catchArmed &&
  !catchLocked}`), and `catchLiveUntil` becomes the lock's end while it runs, so the button returns on
  the clock. `catchAvailability.test.ts`, `catchDerivation.test.ts`, `actionBar.test.ts`, scene
  `game-catch-locked`.
- `src/test/realtime.test.ts` owns the realtime path on the client side.

### Every deadline is on the server's clock

`turn_deadline`, `catch_seats[].ends_at`, `catch_locked_until`, `forfeit_deadline` and the snapshot's
deadlines are absolute server instants, and every bar on screen (`drainBar`, `pruneCatchWindows`,
`turnCountdownSfx`, `OpponentAway`) counts against `Date.now()`. A device six seconds fast would see
every catch window already shut; six slow, a capsule inviting a press that costs a card.

- Every message carries `server_now` (`ServerMsg::stamp`, from `Client::send` and `Table::broadcast`).
- `state/serverClock.ts` keeps the last `CLOCK_SAMPLES` of `server_now - Date.now()` and takes the
  **largest**: each sample undershoots by its one-way latency, so the largest is closest and errs
  towards a window shown slightly longer. A sliding window follows a clock that steps.
- **`localizeDeadlines(msg)` is the one door**: `serverMessages.ts` passes every message through it
  before the `switch`. A new deadline field is added there and nowhere else. Zero or absent means no
  timer and is left alone. Before any stamp the offset is zero, so fixtures land where tests wrote
  them. `serverClock.test.ts`.

## Client transport

### The socket does not go through the CDN

The page is served from `ohloco.com` and the socket dials `ws.ohloco.com`, straight to the origin.
Measured Paris to Paris on an established socket:

| | round trip |
| --- | --- |
| through the CDN | 228–696 ms, median **389 ms** |
| direct to the origin | 7.1–10.6 ms, median **8.5 ms** |

That is every card, catch and interrupt, and **an interrupt is decided by arrival order**, so it is
the mechanic. Only the socket leaves the CDN.

- **`webSocketPolicy.ts` decides the address, `webSocket.svelte.ts` dials it.** `wsEndpoints()`
  returns `direct` (null unless the build named one) and `proxied`; `wsUrl()` picks. Pure, so
  `wsEndpoint.test.ts` needs no DOM.
- **`VITE_WS_ORIGIN` is baked in at build time, on a tag only** (`.gitlab-ci.yml`): dev has no such
  hostname.
- **The scheme comes from the page, never the value**: a mismatched scheme is mixed content, refused
  silently before the socket is attempted.
- **The fallback is one-way.** After `DIRECT_FAILURES_BEFORE_FALLBACK` (3) sockets that closed
  *without ever opening* (about two seconds of backoff), the client uses the page's origin for the
  rest of the page's life. A socket that opened and dropped resets nothing. It exists because the
  direct hostname's certificate is the one thing nothing here renews or watches; a reload retries it.
- **`security-headers.conf` carries `__WS_DIRECT_ORIGIN__`, substituted by `client/Dockerfile` from
  the same build-arg**, and the build fails rather than ship the placeholder (which would block the
  socket silently).
- **The server must be told**: `serve::origin_allowed` matches the `Origin`'s hostname against the
  `Host`, which two hostnames fail, so production sets `LOCO_ALLOWED_ORIGINS` to the **page's**
  origin. See [`docs/notes/server.md`](server.md).
- **nginx serves only the socket and a 404 on `ws.*`**, never the site. Both server blocks
  `include ws-proxy.conf`, so a socket falling back reaches a server that cannot tell the difference.

### The rest of the transport

- **The env prefix must expose `VITE_*`.** `vite.config.ts` writes `envPrefix: ['VITE_']`; a narrower
  prefix leaves `import.meta.env.VITE_WS_PORT` reading `undefined` with no warning, and dev dials
  same-origin `/ws`, which proxies nothing. `src/test/wsEnv.test.ts` fails when the socket reads a
  prefix the config does not expose.
- `webSocket.send(msg)` queues `{ type, data, at }` when not OPEN and flushes FIFO on `onopen`,
  **after** the reclaim message, dropping aged gameplay intents (above).
- **Reconnect backoff** (`state/webSocketPolicy.ts`, apart from the socket): `RECONNECT_DELAYS_MS`
  250ms, 500ms, 1s, 2s, 4s, 8s, 15s, then held; `attempts` resets on `onopen`. The first retry is
  near-immediate because most drops come straight back.
- **There is no attempt ceiling.** A ceiling is a curtain that never comes down over a seat the server
  may still hold for 60s (a slow image pull, a crash loop, a suspended phone tab).
- **The recovery path is not the schedule.** `reconnectNow()` retries from the top on `online`, the
  tab returning (`focus` + `visibilitychange`), a bfcache restore (`pageshow` with `persisted`) and the
  curtain's button (`GameView`'s `onRetryConnection`). `connect()` refuses a socket already
  CONNECTING or OPEN, so each is safe to fire twice.
- **The socket does not survive the page being frozen.** A navigation to a content page can freeze
  the document into the back/forward cache *with* its socket open, so `players_online` counted the
  reader and Back built a second socket beside the first. `pagehide` drops the socket and `pageshow`
  asks back when `persisted`; the restore takes the ordinary reconnect path, seat reclaim included.
  **Playwright runs with the bfcache off**, so `wsFreeze.test.ts` is the only guard.
- **Everything the server can say lives in `state/serverMessages.ts`.**
  `createServerMessageHandler(unoTimer)` is built once in App's setup and closes over the store's
  actions (stable for the app's life); branches needing current *values* call `gameStore.getState()`
  at that moment. The LOCO! banner's timer (`UnoBannerTimer`) is passed in because it belongs to a
  component.
- **The match screen is built once and left alone.** `GameView` is instantiated once; a `{#key}`
  around the board, or a keyed block whose key moves with state, would rebuild it on every change.
  `src/test/appSubscription.test.ts` counts script-body runs; its `webSocket` mock returns a **stable**
  `send`, or the test proves nothing.

## Session restore across a reload

A reload, a crashed tab or a killed background page loses the store, and the server would hold the
seat for a minute with nobody able to claim it.

- `state/sessionPersistence.ts` owns the record (`loco_session`) and `reconnectMessageFor(state)`:
  **one pure function builds the rejoin for every screen**. `searching` re-sends `find_match` (the
  server drops a dropped socket from the queue); `matchfound` reclaims like a game seat; `gameover`
  reclaims with its token, **except in a matchmade room**, where the seat is released.
- **An error on `matchfound` resets to the lobby**: it is the one screen with nothing to press.
  `searching` keeps the toast; it has a cancel button.
- **`sessionStorage`, not `localStorage`**: per tab, so two seats from one browser cannot overwrite
  each other's token; it survives reload, back/forward and crash restore; it dies with the tab.
- `initSessionRestore()` runs last in the boot, before the first render: the rejoin goes out on the
  first `onopen`, so the store must already know what it reclaims.
- **`screen: 'restoring'` is its own screen**, not a flag over `'game'`: a board drawn from an empty
  state is broken behind any curtain. `restoreTarget` names the rejoin in flight; `setScreen` retires
  it (every landing path goes through it).
- `SESSION_TTL_MS` (30 min) is a **staleness guard**, not correctness: the server decides. It stops a
  cold open days later flashing a reconnect screen. `touchSession()` re-stamps on
  `pagehide`/`visibilitychange` so a long match does not age its own record out.
- **A refusal ends the restore and takes the record with it** (`abortRestore`, from the `error` branch
  and `restoreTimeout`, `RESTORE_TIMEOUT_MS` 12s): replaying a refusal on every load makes a tab
  permanently unusable. `reconnect failed` / `reconnect cancelled` are the only `serverErrors.ts`
  entries with no server string behind them.
- The persistence subscription **dedupes on the four persisted fields**: it fires several times a
  second and `sessionStorage` is synchronous.
- **Seat 0 is a value.** `player_id` and `player_index` are `Option`s on the server and optional in
  the generated type, so seat 0 is written and an absent one means the message assigns no seat;
  `loco-protocol/tests/parity.rs` pins seat 0 onto the wire for both. `player_reconnected` falls back
  to `state.your_index`, which is never omitted.
- **The reclaim's fresh token must be stored.** The server spends the token a reclaim used and issues
  a new one on `player_reconnected`; the client writes it to the store *and* the record. Keeping the
  spent one breaks only the **second** reclaim — answered `game already in progress`, the same string
  a stranger gets — so `sessionRestore.test.ts` checks both places and the E2E reloads twice.
- `store.myNickname` is kept apart from `players`: a reloaded tab has no roster and the rejoin is keyed
  on the nickname. `<Reconnecting />` names the room and offers the way out; scenes
  `reconnecting-game` / `reconnecting-room`.

## One tab at a time

`state/tabLock.ts` elects one tab to hold the game; `Root.svelte` mounts the app in that one and
`<TabTaken />` in the others. Scenes `tab-taken` / `tab-taken-seated`. Without it a second tab counted
twice in `players_online` and entered the 1v1 queue as a second player, which could pair a player
against their own other tab.

- **The election is one synchronous `localStorage` read before the first paint.** Asking other tabs
  over `BroadcastChannel` means waiting, and the wait either flashes a curtain or opens the very
  socket being prevented. The channel only makes a handover instant instead of `STALE_MS` late.
- **The record is a heartbeat**: `at` rewritten every `BEAT_MS` (2s), stale after `STALE_MS` (5s) —
  enough for one throttled background timer. A flag would lock the game forever after a crash. **A
  timestamp in the future is stale too** (a clock moving back).
- **In every doubt this tab owns the game**: no `localStorage`, storage that throws on write (the probe
  writes; Safari's private mode has exposed the object while throwing), no `BroadcastChannel`, an
  unparseable record. A player wrongly shut out has no recourse; two tabs is the lesser failure.
- **It is `Root.svelte`, not a branch inside `App.svelte`**, because `webSocket()` runs at the top of
  `App`: not mounting is the only way not to open a socket, and yielding unmounts it so the server
  holds the seat like any drop. The one `{#if}` allowed to rebuild the app.
- **The curtain says what the button costs.** The other tab's seat record is in *its*
  `sessionStorage`, so taking over starts at the menu and the yielding tab loses its seat; the record
  carries `seated` and the copy turns on it. **It does not close on `Escape`**: it is the tab's state,
  not a panel somebody opened.
- **The only `storage` listener in this client.** Every other `localStorage` key is read at boot and
  deliberately does not follow another tab.
- **Out of reach**: a second browser, a private window or another machine bypasses it. Refusing to
  pair two sockets on one network would refuse two friends on one wifi; left open knowingly.

## Remembering the nickname

`state/nicknameMemory.ts` keeps the last name entered (`loco_nickname`); `<Lobby />` seeds its field
from it at mount.

- **`localStorage`, not `sessionStorage`**: unlike `loco_session` it authenticates nothing, so
  surviving the tab and being shared across tabs is the point.
- **Written on submit, never on keystroke**; **read once at mount**, so it never fights typing.
- A prefill, not a submission. In the join form `autofocus` lands on the code when the name is known
  and on the name when it is not.

## Answering a nickname as it is typed

`game/nicknameRules.ts`, on every keystroke and on submit, mirrors the **shape** half of
`loco-game/src/nickname.rs`: 20 characters counted as characters, the Latin / Greek / Cyrillic
allowlist, `-_.'` and one space, at most one combining mark per letter, at least one letter or digit.

- **It decides nothing**: the server validates on `create_room`, `join_room` and `find_match`. It
  makes the refusal instant.
- **The word list is not shipped**: thousands of slurs in a readable bundle, for a check the server
  repeats anyway.
- **One line for both halves**: `t.errors.nicknameRejected` is what the shape check shows and what
  `nickname not allowed` resolves to, so nobody can read the rule off the message (`server.md`).
- The canonical form (trimmed, spaces squeezed) is what is sent and remembered.

### The button is off until the shape is there, and only until then

`Find an opponent`, `Open the table` and `Take a seat` are `disabled` while `isNicknameShapeValid` is
false.

- **Greying out may only answer shape**: a disabled control gives no reason, so it may only say what
  the player can see. The floor is **one letter or digit**; everything above it is taste, and belongs
  in a refusal.
- **A blocked term is not one of them.** It reaches the server, and `<Lobby />`'s one `$effect` on
  `error` answers any refusal matching `/nickname/i` (the blocked term, `nickname "Bob" already
  taken`) by **focusing the field and selecting its contents**.
- The submit handlers still call `acceptNickname()`: the guard is not the disabled attribute.

## Answering a table code the same way

`game/tableCodeRules.ts` mirrors `ROOM_CODE_CHARS` / `ROOM_CODE_LEN` (`loco-hub/src/router/rooms.rs`):
six characters of `A-Z2-9` without `I`, `O`, `0`, `1` — **a product reason**: a code is read out on a
stream and typed back by a viewer, where those pairs are the same character.

- **The field drops, it does not refuse.** `sanitizeTableCode` uppercases, strips everything outside
  the alphabet and caps the length, on keystroke and paste, so a code pasted with punctuation is still
  right.
- **"Take a seat" is disabled until the code is whole** and the nickname is; `handleJoin` checks both
  again.
- **It decides nothing**: an unknown table still comes back `room not found`.
- Both mirrors are pinned to the server's source by `serverMirrors.test.ts`.

## The link a table is shared with

`state/tableInvite.ts`. The waiting room's code plate copies a URL carrying the code
(`tableInviteUrl`); `initTableInvite` reads it off the URL before the first render and `App` acts on
it. The page is `src/routes/(game)/i/+page.svelte`, with `seo/meta.ts`'s `INVITE`.

- **A link is one tap**; a code is read, retyped and taken to the right screen. The code stays on
  screen for streams and the join form.
- **The plate says so before it is pressed**: `<TableCode link />` draws a chain, **drawn** (a glyph
  would sit on the baseline and take the code's ink stroke) and **outside everything streamer mode
  blurs** (that it copies a link is no secret). Off by default: `<Reconnecting />` prints the code with
  nothing to press.
- **It is `/i/?t=CODE`, a page of its own, because a link preview reads served HTML.** `/i/` is
  `noindex`, carries the invitation's title, description and art (`INVITE`, `INVITE_OG`), and is
  otherwise the home page with no chrome.
- **The code stays a query parameter**: a path form needs a fallback in every server that serves it
  (nginx and the dev server); the query form is the same URL everywhere and needs nothing.
- **The link carries no language.** Whoever opens it decides (stored choice, then browser); `/i/` is
  served with **no `data-served-lang`**, which `langUrl` reads as nothing to disagree with.
- **The parameter is read on `/i/` only**, both spellings (`/i` resolves through nginx's `try_files
  $uri/`); elsewhere a `?t=` is left untouched.
- **The code is spent on arrival**: `replaceState` before anything else reads it, leaving `/` — so a
  reload does not re-join a table since left, the address bar does not show the code on stream, and a
  later copy of the URL does not point at a closed table. Removed by string surgery, because
  re-encoding the query rewrites other parameters (`?showcase` → `?showcase=`).
- **A link outranks a stale reclaim unless they name the same table**: a record for another room is
  cleared; one for this room is a seat to reclaim, which is better.
- **A link carries a table, never a player.** `App` sends `join_room` only when this browser remembers
  a name that passes the shape check; otherwise the join form opens with the code filled and the caret
  on the name. The invite is spent either way.
- **`<Lobby />` is keyed on its entry point alone**: spending the invite must not remount it under a
  player mid-typing.

## The host's controls over a row

`WaitingRoom.svelte` puts one ⋯ on every roster row but the host's; `RosterRowMenu.svelte` offers
hand the table over (`transfer_host`) and remove from the table (`kick_player`). Guests see neither.

- **Never on seat 0**: the way out of your own seat is the quit link, which asks.
- **One button, not two icons**: a routine press and a destructive one side by side on a dense row at
  phone width; the ⋯ is one 44px target.
- **Both ask, and the question takes the menu's place**, naming the row (on a phone the sheet covers
  the roster).
- **Escape backs out one step at a time** (question, then menu); `pointerdown` outside the row shuts
  it.
- **Right-click opens the same menu, never the only way in**; `preventDefault` refuses the browser's.
- **Below 46rem it is a bottom sheet with a scrim**, at the preferences sheet's row heights.
- **A bot's row carries the kick, not the transfer** (the server refuses a bot host). **`is_bot` rides
  the roster** because a nickname cannot tell. The in-game score table reads the same field: the
  latency broadcast waits for a human's first ping (`ping_period` 5s, `latency_broadcast_period` 3s),
  so it cannot say "bot" in time.
- **The removed player is told where every refusal lands**: `kicked` resets like `left_room`, *then*
  writes `removed by the host` (`errors.kicked`). `resetToHome` clears `errorMsg`, so order matters.
- **`host_changed` is applied from the message** (`applyHostChange`): the server sends it per
  recipient with that client's seat.

## The 1v1 queue on screen

`screen: 'searching'` and `screen: 'matchfound'` are screens, like `'restoring'`: there is no board
behind them.

- **Entered optimistically.** `findMatch` sets the screen, then sends `find_match`; the acknowledgement
  carries nothing. `matchmaking_queued` is acted on only when not already searching (a reveal whose
  other half left requeues the survivor unprompted).
- **`endSearch` is guarded on the screen**: a cancel that raced a pairing must not drag a seated
  player out.
- **The wait is timed locally and the copy staged off it** (`searchStage`: 0-15s, 15-45s, 45s+). **No
  copy may imply the queue is empty**: "nobody is searching" makes the player leave, and they were the
  next one's opponent. The third stage says it can take a while and offers a private table.
  `matchmaking.test.ts` asserts no copy names a number. The empty chair is drawn as an empty chair.
- **The searching screen carries the same top bar** as every other screen.
- **Being found reaches a player who is not looking**: `soundsForTransition` plays `matchFound`, and
  `tabAlert` alternates the title with `t.matchFoundTab`, **only while the tab is hidden**; returning
  disarms it and restores the title, never re-arming. The sound covers the player on the page; the
  title covers one whose backgrounded tab has its AudioContext parked. `tabAlert.test.ts`.
- **The reveal counts down but decides nothing**: the match starts on `game_started`; a counter at zero
  holds on "dealing".
- **A forfeit never renders as a victory.** `<GameOver />` with `forfeitBy` drops the fall and says
  what happened on both sides. **Which side we are on is answered once, when `match_end` lands**
  (`store.forfeitedByMe`): a forfeit removes the leaver and re-bases seats, so a host walking out
  hands seat 0 to the player who stayed. **A seat is an index, true only for the roster it indexes**;
  the recap is re-sent by the server on the `player_left` that moved it (`setMatchHistory`).
- **The rematch button has three states: ask, wait, accept**, every table, every seat
  (`rematchOffers` and `rematchNeeded` from `rematch_offered`). Past two seats it carries `x/y`. **The
  table's size comes off the roster, never `rematchNeeded`**: two asks deal at any size
  (`REMATCH_QUORUM`). A table nobody is left at keeps the button in place and disabled.
- **The deal spends the asks** (`applyRematch`, like `applyMatchFound`); otherwise our own ask opens
  the next game over on a disabled button. The server clears its half in `reset_for_next_match`.
- **A matchmade table with nobody left requeues by itself** (`App.svelte`, `rematchRequeue.test.ts`);
  ordinary tables are left alone.
- **`searchAgain` is the same requeue, pressed, and it is one message**: `find_match` gives the seat up
  server-side before it enqueues (`loco-hub/src/router/matchmaking.rs`). A `leave_room` ahead of it
  would land `left_room` → `resetToHome` under the new search. The label promises a search, never a
  name.
- **Leaving is the quietest control on that card** (`.btnQuit`: no outline, no fill, `--color-muted`,
  a 44px target under 13px type), an ordinary `leave_room` at every table.
- `<OpponentAway />` alone reads `opponentAway`, filled only when the server sent a `forfeit_deadline`
  (never in an ordinary room). Its bar is a `drainBar`.

## The count of connected players

`players_online` → `store.playersOnline` → `game/playersOnline.ts` → a `role="status"` line in
`Lobby.svelte` and `Searching.svelte`.

- **Drawn from two up, absent below.** One is "you are alone", the sentence the searching screen may
  never say. The number shown is always exactly the server's; the floor is the client's.
- **It is not the queue.** The queue size is off the wire; this counts sockets. The copy says
  *connected*, never *searching* — a queue-flavoured wording would be the queue size in disguise. The
  searching screen keeps `t.playersOnline` word for word.
- **Never at a table**: the server does not send it to a seated socket. `setPlayersOnline` stays out
  of `resetToHome` — the count is the socket's, and the screen a reset lands on draws it.
- **It reserves no layout** (`position: absolute`: `/` never scrolls). **Below 46rem it sits at the
  foot, centred, on both screens**, sized `width: max-content` (an absolute box at `left: 50%` is
  offered half a line and wraps). At the top it collided with the chip row, whose "How to play" pill
  is a word; neither the count nor the pill may be shortened. Scene
  `matchmaking-searching-online`.
- The dot is decoration. `playersOnline.test.ts` pins the floor, the unrounded number, survival across
  a reset, and both screens.

## Protocol validation (client)

**Both type files are generated; neither is edited.** `client/src/types/protocol.ts` and
`client/src/types/protocolSchemas.ts` come from `server/crates/protocolgen` reading
`server/crates/loco-protocol`: change the Rust, run `make protocol`, commit both. CI's
`protocol_check` regenerates and fails on any difference. The wire's golden frames are the crate's
fixtures (`docs/protocol.md`).

- `webSocket` runs `v.safeParse(serverMsgSchema, …)` on every payload. Dev: invalid → log and drop,
  which surfaces drift in tests. Prod: log and pass through, so one new server field cannot take the
  client offline.
- **The converter refuses rather than guesses.** `tools/protocol/valibot.mjs` handles the JSON Schema
  constructions the protocol uses and stops on anything else (`anyOf`, a nullable required field,
  `pattern`, `minimum`, an open map, a recursive type…), naming the path. `valibot.test.mjs`
  (`node --test`) covers the refusals.
- **`ServerMsg` is a union narrowed by `type`**: a field is required exactly when the server always
  writes it (`turn` on `turn_changed`, `drawn_count` on `card_drawn`). The validator is never stricter
  than the server, because the fixtures are real frames read by the same types.
- **`Option<T>` is `T`, optional, never `T | null`**: the server never writes `null`, so
  `generate.rs: AbsentNotNull` removes it from every non-required property.
- **The wire enums live in `loco-protocol/src/enums.rs`**, so TypeScript keeps its narrowing;
  `tests/enums.rs` pins them to `loco-game` by walking the domain.

**Valibot, not Zod**: Zod 4 JIT-compiles schemas with `Function()`, which `script-src 'self'`
refuses — the game works and reports a CSP violation on every load. `csp.test.ts` runs a real
validation with `Function` behind a recording Proxy and fails if anything reaches for it. Only
`make csp` sees a dependency's behaviour behind the real header, which is why it runs after a
dependency bump.

## Nothing continuous goes through reactive state

A value that changes every frame must never be a `$state` the board hangs off: a write per frame
re-derives seat layout, hand slots and pile positions sixty times a second.

- **Countdown bars use `drainBar`, not a percentage in state.** The bar gets a CSS animation whose
  duration is the window and whose *negative* delay is the elapsed part (`--drain-ms` /
  `--drain-delay`, keyframes `loco-drain` + `loco-drain-heat` in `tokens.css`), drained on the
  compositor with zero JS per frame — through the turn and the catch window, the two moments that ask
  for a fast reaction.
- It drains by a transform, never `width`. `loco-drain` is a `scaleX`; `loco-slide` moves the whole
  fill, which the turn clock and the catch capsule wear so the rounded tip stays a tip (`visual.md`).
- The colour is a second readout of the same clock (`loco-heat`). The 5s catch bar opts out.
- **A countdown bar survives reduced motion** (`.loco-draining` is excepted from the blanket rule): it
  is the only place the remaining time is written.
- **`drainBar`'s effect must not re-arm while the window runs**: every argument is an accessor, read
  once at setup. `drainBar.test.ts` watches the two `setProperty` calls across twenty seconds of fake
  time.

## A deploy, from the player's seat

- `server_updating` sets `serverUpdating`; `<ServerUpdating />` renders a line of text. A restart is
  indistinguishable from a dropped socket, which the reconnect already handles, so no screen is needed.
- **The quietest thing on the board**: no countdown, no alert colour, nothing disabled — it asks for
  nothing. It exists because the rematch button stops working during a drain, which unexplained reads
  as a bug.
- **The waiting room and the game-over card carry it too** (`<ServerUpdating variant="card" />`, in
  the flow, copy saying the deal is paused).
- **Two slots**: wide, the top chrome row between the round pill and the icons; narrow, under the
  chrome, stepping down when OpponentAway uses the slot. It must never sit on the top-centre seat pod
  for the length of a drain.
- Cleared on `player_reconnected` (the new process may not be draining; if it is, it re-sends).
- `server updating` maps to `serverUpdating` in `serverErrors.ts` and must never fall through to
  `roomNotFound`.

## Reconnect visual recovery

- On `player_reconnected`: `isReconnecting: true` before applying state.
- `reconnectAnimation` shows the "Rebuilding table…" overlay for 600ms, then clears `isReconnecting`.
- `<GameBoard />` hides its children while reconnecting; on false→true→false it bumps `rebuildKey`,
  replaying a 350ms fade-in. Visual only.
- **Nothing but that timer ends the overlay, so nothing may swallow it**: the effect re-arms on every
  run (it re-runs only when `isReconnecting` changes), and a reconnect resolving early takes the
  overlay down. No "played already" guard outside the effect — on a reload the board mounts with
  `isReconnecting` already true. `reconnectAnimation.test.ts` covers arriving true and going false
  before the timer; the reload E2E asserts the overlay is gone.

## Leaving a match, and what it costs the others

One way out at every table: a chip in the top-right chrome row, never on the action bar. It asks in
place, in two lines.

- **The second line is the feature.** `leaveNote` picks one of four strings — the bot minds nothing,
  a stranger is handed the match, a table of four plays on without the seat, a table of two ends and
  goes to whoever stayed — counted the way the server's `can_walk_out` counts (`WALK_OUT_FLOOR`). The
  server decides; the client words it.
- **Nothing is greyed out.** A player who has to go goes; a disabled exit only produces a closed tab
  and an empty chair auto-passing.
- **The table is told, by name** (`departureNotice`, riding `noteSeatGone`, idempotent with the seat
  record), for a walk-out and an expired hold alike.

### The curtain underneath it

When every other seat's hold has expired the board says so. The server settles most of these itself
(`settle_expired_seat`), so it is reached mostly after a snapshot restore nobody returned from.

- **Held and gone read identically in the roster** (`connected: false`), so the difference is
  remembered: `goneSeats` is written by a `player_left` that names a seat, which only the mid-match
  expiry does.
- `tableAbandoned` in `GameView` and `Table::abandoned_by` ask the same question: every other seat is
  a human who cannot come back.
- **A curtain, not a button on the bar**; the board stays visible underneath.
- **It waits behind the two reconnect curtains**: our own socket may be the reason nobody is heard.
- `tableAbandoned.test.ts`, including nothing offered while the other seat is merely disconnected.

## The evening's recap, on a phone

The server's half (`Table.match_history`) is in [`domain-rules.md`](domain-rules.md). The card is
380px, so on a 360px phone the recap's scroller is **244px** for four matches × four seats.

- **The two columns that answer it are pinned** (`.recapName`, `.recapTotal`, `position: sticky` left
  and right), so who and how many stay on screen while the matches scroll between. The table is
  `border-collapse: separate`: a collapsed border belongs to the pair of cells and stays behind.
- **Heads are `M%n`** (the score table's convention), **the points sit under the rounds**, and the
  head is 11px, the floor.
- **The seat that took a match is a gold pill**: `--color-primary` on `--color-surface-strong` is
  2.9:1, and the scoreboard above wins in gold. A filled shape also serves colour assist.

## The round the format did not plan for

When rounds won, points and lost-hand total separate nobody, `Room::determine_match_winner` returns
`None`, the match goes on and one more round is dealt (`domain-rules.md`).

- **That round has a name, not a number** (`t.decisiveRound`, on `roundNumber >
  formatRounds(matchFormat)`, `game/matchLengthModel.ts`), on the chip and the summary card's title.
  The chip goes **gold**: red under white needs 1.2rem and the chip is 13px, and a spectator must tell
  it apart at 720p.
- **The card announces the *next* round on `roundNumber >= matchRoundsNeeded && !matchOverPending`**
  (`pendingMatchEnd !== null`), never on the format alone: the last round of a settled BO3 and of a
  tied one share a number.
- **That band's 0.35s fade-in delay is a mechanism**: `round_ended` and `match_end` are two messages,
  and without the delay an ordinary final round announces a decisive round for a frame. The delay
  survives reduced motion (the duration goes). `decisiveRound.test.ts`.
- **The band never says who the extra round crowns**: past two seats it may not decide the match.

## i18n

- `client/src/i18n/en.ts` is the source of truth; its `Translations` interface types `fr.ts`, so a
  missing key is a type error.
- `initI18n()` (`i18n/store.ts`) runs in the boot; `redetectLang()` decides again when the router
  brings the game back. `i18n` → `{ lang, t, setLang }`.
- **Detect order** (`chooseLang` in `src/lang.ts`, the one definition): `localStorage('loco_lang')` →
  `navigator.language` **only on a document served as the default language or none** →
  `data-served-lang`.
- `setLang` persists the choice and syncs `document.documentElement.lang`.
- Add a language: create `xx.ts` implementing `Translations`, add it to `translations` in `store.ts`,
  add `{code, label}` to `LANGS` in `LanguageSwitcher.svelte` (**the label is the autonym**) and to
  `LANGS` / `HOME_PATH` in `src/lang.ts`.

### One document, one language

The key, the languages and the home paths live in `src/lang.ts`, framework-free; `chooseLang` there
decides, and `src/langRoute.ts` acts. A stored choice outranks the URL and half of `/` is markup
prerendered per URL, so `/` with French stored must not render French under an English footer.

**A language is a navigation**: `langRoute.ts: initLang` decides and, when this page is the wrong
one, `goto`es the right one with `{ replace: true, reset: false }`; the gear's pick does the same
after `setLang` (`moveTo`). Never a document load or a redirect on the canonical URL, and no page
carries its other language in `data-alt*` attributes — `langSync.test.ts` fails on one.

- **A detection is never persisted**: a stored value is a *choice* and outranks the URL, so storing a
  detection would open every later French link in English. `rememberLang` is called by the gear and
  the globe's links, the two places a language is chosen.
- **The browser wins only on the default URL.** `/` is somebody saying nothing; `/fr/` is somebody
  asking. `chooseLang` is tested exhaustively, and decides the same on the page its answer names, so
  `initI18n()` need not wait for the move.
- **It runs before `initTableInvite()` and carries the query string and fragment**, **in place of the
  history entry** so Back does not bounce. `/i/` has no `data-served-lang` and is left alone.
- **The document at the new URL is real**: `/fr/` was emitted by the build.

`data-served-lang` is always the page on screen (rewritten on every move by `seo/document.ts:
applyDocument`). `<html lang>` is the game's to write once booted (`i18n/store.ts`), since on `/i/`
the game is in the reader's language and the page in none.

The globe's two links are real `<a href>`s (an `hreflang` pair a crawler can follow) and record the
choice on the press, so the game follows the reader back to a game page, where the root layout
decides again.

## Preferences

`Preferences.svelte` is the gear on the lobby, the waiting room, the reconnect splash and the board:
the language chooser (`LanguageSwitcher`), the graphics tier, and switches for streamer mode, colour
shapes and reduced motion — and vibrations on a touch screen that can vibrate (`state/haptics.ts`, one
pattern per moment, decided beside the sounds). Each on/off one is a `createBooleanPref` module store
over `localStorage` (`state/prefStore.ts`, one factory so they cannot drift). Icons are drawn SVG,
never a font character (a `⚙` is a different object on every platform).

**Streamer mode is the one preference that also leaves the client**, and only from the host's seat.
Every other one is local: a presentation preference on the wire is per-seat state the server holds,
and only the shared table code earns it.

### Fullscreen, beside the gear and not inside it

`FullscreenButton.svelte` is the chip left of the gear in every row that has one. Not a preference:
the browser owns that state and drops it on its own terms. Nothing is stored; the icon and name follow
`fullscreenchange`.

- **Desktop only**: hidden below 46rem, and **not rendered where `document.fullscreenEnabled` is
  false** (an iframe without `allowfullscreen`, a WebView, jsdom) rather than a button that throws.
- **Two drawings**: brackets out to enter, in to leave; never one rotated.
- No key is bound to it; its one listener reads no key.
- `fullscreenButton.test.ts`: absence, request and exit, the name following the document, French, the
  46rem rule, presence in every row with a gear.

### The panel's controls

- **The graphics tier decides how much a render may cost** (`state/graphicsPref.ts`,
  `components/scene/quality.ts`, `sceneQuality.test.ts`): `auto` / high / medium / light, a segmented
  row whose hint names what `auto` resolved to. Framework-free, read by the renderer through
  `resolveGraphics()` and by Svelte through `uiPrefs.svelte.ts`; part of the scene cache key, so
  moving it mid-match renders the room again. What each tier buys: `visual.md`.
- **The language pick applies itself, on every screen**: `setLang`, plus `moveTo` to the same page in
  that language on a home page; nothing reloads, so there is no Apply button. **If a language ever
  costs the page again, the button comes back**: a control that reloads must not fire on the press
  aiming for it.
- The list shows autonyms (`English`, `Français`), never `EN`/`FR`.
- **The list is ours.** A `<select>`'s open list is painted by the OS (white menu, blue highlight over
  a dark board) and no CSS reaches it. It is a `<button role="combobox">` and a `<ul role="listbox">`:
  the button keeps focus, arrows move, Home/End jump, Enter picks, `aria-activedescendant` names the
  row. Arrowing picks nothing. The chosen row carries a checkmark, not only a tint; pointer and arrows
  share one highlight. **Escape closes the list and only the list** (stopped while open, let through
  while shut); a press outside or Tab puts it away. Scene `lobby-prefs-lang`, worth the `small`
  viewport too.
- **Streamer mode blurs the table code.** `streamerMode.ts` (`localStorage`, `loco_streamer_mode`) is
  a module store: read by two screens with no common parent, written by a third, surviving a reload.
- **The host's flag is the table's.** A table code is one string everybody at the table can see, so
  blurring only the host's copy protects nothing. `hostStreamerSync` (`state/appEffects.svelte.ts`)
  sends `set_streamer_mode`, the server broadcasts one answer per table, and the client keeps it in
  `store.tableStreamer`, **ORed** with the local preference, never merged into it.
  - **Two moments send**: the preference moves at a table we host, or we open a table with it already
    on. **A change of seat sends nothing**: `transfer_host` must not uncover a code still on camera.
  - **Nothing consults `store.tableStreamer` before sending**: the server answers a repeat with
    silence, and checking would swallow a retry.
  - **Hostless tables never send** (the server refuses). `tableStreamerMode.test.ts`.
- **`TableCode.svelte` is the only way a screen prints the code.** The blur is a CSS filter over the
  real text, so copy still copies and a screen reader still reads.
- **There is no reveal at all.** Every reveal (`:hover`, `:focus`, `:focus-visible`, a touch's stuck
  hover) uncovered the code exactly where the pointer or the press already was, on camera.
  `preferences.test.ts` fails on `:hover`, `:focus` and a second `filter: none`, and the span is out
  of the tab order. Sharing with the mode on is the link; reading the code aloud means turning the mode
  off.
- **The lobby's join field is not masked**: a blurred input is a typo you cannot see.
- **Both dropdowns are 292px and sized for a thumb**: switch rows 50px, segmented options 38px, the
  language control 42px and its rows 40px, a 14px slider track under a 26px thumb, labels 14px, hints
  12px.
- **A section is grouped by space and a micro-caps `.sectionLabel`**, never a rule drawn across the
  card.
- **Anything that opens over a screen declares its own `text-align`**: it inherits through
  `position: fixed`, so the rules modal opened from the centred searching screen came out centred.
  `.backdrop` in `RulesModal` and `.panel` in `Preferences` and `AudioSettings` declare `text-align:
  left`, pinned by source scan (`rulesModal.test.ts`, `preferences.test.ts`; jsdom applies no
  component styles).
- **Below 46rem it is a sheet** (see "One sheet, four surfaces"). On `/` the drawer's Preferences row
  is the way in, so `Lobby` passes `triggerBelowPhone={false}`. **Only the lobby may**: from the
  waiting room on, the drawer is hidden and the gear is the only entry.
- **The sheet's scrim wraps the panel** (outside is `target === currentTarget`, not a z-index
  argument), and **its ✕ needs `position: relative`**, or `.hit-target`'s 44px pseudo-element lands
  on the scrim and eats every press aimed at a setting.
- **The sound mixer becomes the same sheet at the same width** and carries `audioClose` for its ✕,
  the only way out once the speaker chip is behind the scrim. `escapeClose.test.ts`.
- **A sheet's type is not the dropdown's**: labels 15px, hints 13px, switch rows 56px, the language
  control and rows 46px, a 16px track with a 30px thumb, all inside one `max-width: 46rem` block per
  component.
- **The drawer opens the panel by event**: `SiteDrawer.svelte` closes its popover and dispatches
  `loco:preferences`, which the mounted `<Preferences />` answers, remembering the focus to return.
- Showcase flags `streamerMode`, `colorAssist`, `prefsOpen`, `langOpen`, `audioOpen`
  (`dev/scenes.ts`); scenes `waiting-streamer`, `lobby-prefs`, `lobby-prefs-lang`, `lobby-audio`,
  `card-sheet-assist`, `game-color-picker-assist`. `applyScene` resets both module stores.

## Colour assist

A card is legal because it matches the pile, and red-green is the most common colour-vision
deficiency. The suits are separated in luminance too, but "survives" is not "reads".

- **`SUIT_SHAPE` (`cardTheme.ts`)**: triangle (red), circle (yellow), square (green), diamond (blue),
  differing at every corner count. `SuitMark.svelte` draws ink under an off-white fill (off-white on
  green alone is 1.18:1).
- **Three sites**: under the value on the card's top-left, on each `ColorPicker` swatch, and in the
  active-colour chip on the discard pile.
- **Never a letter** (`V` is `vert` in one language and nothing in the other). **A wild has no suit**
  and no mark.
- Off by default: the face is the brand.

## Reduced motion

Three values (`auto` / `reduce` / `full`, `state/motionPref.ts`); the UI shows two.

- **`:root[data-motion="reduce"]` is the single source of truth in CSS**, written by `initMotion()`
  before the first paint. No media query: `full` must be able to win over the system.
  `reducedMotionCss.test.ts` fails on a new `@media (prefers-reduced-motion)`.
- The two Web Animations shakes (`GameBoard.kickBoard`, `GameView.shakeScreen`) ask
  `prefersReducedMotion()` themselves. `motionPref.test.ts` pins the wiring.
- Playwright's media emulation still reaches the attribute through `initMotion`.

### The voice

The copy is the first thing a player judges. "The table", "New table", "How to play" is a game;
"Waiting Room", "Create Room", "Game Rules" is a website.

- **The name is `LOCO!`; the mark is a letter of it.** Never bare `LOCO`, never `LOCO !` in French.
  Bare, `loco` is a Spanish adjective and a dozen other games, so neither search nor a Twitch category
  finds it. A `<title>` is still capped at 60 (`seo.test.ts`), so the character comes out of the copy;
  and the name takes no further terminal mark (`homeSheetBtn` drops its question mark), though a comma
  is fine. `src/test/vocabulary.test.ts` fails on either misspelling in `en.ts`, `fr.ts`, `UI`,
  `PAGES` and `src/content/`, and pins the wordmark in the `aria-label`, the `<span>` and the
  `::before` blocks. Internal naming is untouched (`LOCO_MARK_PATH`, `LOCO_ALLOWED_ORIGINS`,
  `locoMark.ts`).
- **One word per thing: a table is the seats, a room is the place** (French *décor*). `lobby` is
  banned in player copy, and so are `salle`, `salon` and `pièce`. The navigation entry for the places
  is `Rooms` / `Les décors`, the `<h1>` follows, and **the path and `<title>` keep "tables"** (search
  value; a URL is not copy). `vocabulary.test.ts` fails on the banned words and asserts the rooms page
  actually says *décor*.
- **French is tutoiement** (stated at the top of `fr.ts`).
- **A button is the verb about to happen**: `Deal`, `Take a seat`, `Next round`.
- **The rules opener**: `RulesButton` `variant="icon"` at the table (a "?" chip; `rulesBtn` is its
  aria-label and tooltip), `variant="text"` on the lobby, waiting room and search (a pill drawing
  `rulesHowBtn`, *How to play*), where a newcomer is deciding whether to play. The pill keeps the
  chips' height, outline and shadow, and **carries no aria-label**: its visible word is its name.
  `rulesHowBtn` and `rulesTitle` are the same words, so the E2E scopes the heading to its dialog
  (`rulesModalTitle()` in `e2e/helpers/game.ts`).
- **A refusal says what to do next and never blames**: "Someone beat you to it", not "Too late". One
  pill, readable in under a second, no wire vocabulary.
- **The one destructive press asks, and the safe answer is a word**: leaving the table swaps the link
  for `Tu quittes la table ?` with `Rester` (first, coloured, and what Escape means) and
  `Oui, je pars`, in place, nothing else moving. Nothing else in the game confirms.
- **Only the streamable moments shout** (`INTERCEPTED!`, `CAUGHT!`, `LOCO!`); everything else is calm.
- **The five-second capsule names an opening, not an order** (`t.catchWindow`, drawn by `UnoTimer`):
  *A chance to catch* / *Une chance de contrer*. The press is a wager and missing is the ordinary
  outcome; the price is taught in the rules modal.
- **No em dash in copy**, in either language.

### What is different, and where it is allowed to be said

A visitor arrives with a model of a colours-and-symbols card game and wants the delta.

- **`src/content/contrasts.ts`** is that answer: eight lines, first on the rules page, above the
  `t.rules` mapping. **Its numbers are checked against the server** like the deck table: `HAND_SIZE`
  against `INITIAL_HAND_SIZE` (`loco-game/src/room.rs`), the number range against
  `NUMBER_LOW..=NUMBER_HIGH` in `Deck::standard`, the deck size against `DECK_SIZE`, all through
  `src/test/serverSource.ts`.
- **It is not in the rules modal and must not be put there**: the modal is a reference read mid-round,
  and every line of it is a rule.
- **The home page's three bullets are three mechanics**: interception with no deadline, doubles going
  down together, the two cards that move whole hands.
- **The sheet's control asks the question** (`homeSheetBtn`), and heads the sheet.
- **The phone reaches that prose through `#navAbout`**, the drawer's first row (below 46rem
  `.homeIntroMain` is `display: none`). It ships `hidden` until a script runs; only the *closed*
  sheet's button is hidden (`.homeSheet:not([open])`), and closing hands focus back to the row that
  opened it.

The rules modal is read once, standing up, by somebody who wants to play now: headings are the
promise (`The cards that hurt`, `Photo finish`, `One card left: say it`), items one sentence, leading
with what the player does, and every deviation stated where a player would trip on it. `docs/rules.md`
stays the spec; the modal must not contradict it. Card names are the domain's: **Global Switch**
(`global_switch`); French `Rotation` and `Échange` in banners and rules alike.

### Refused actions never show a wire string

`i18n/serverErrors.ts` maps the server's error prose onto `Translations.errors` (`ErrorCopy` in
`en.ts`).

- **Ordered regex, first match wins**, because several messages interpolate values (`nickname "Bob"
  already taken`, `room is full (max 7 players)`); narrower rules first.
- Unrecognised input resolves to `errors.generic`, never the raw string.
- **Resolved at render** (`Lobby`, `GameView`), not at `store.setError`: the store keeps the raw
  string, so a language switch re-renders the error.
- Not a protocol change: the wire keeps its log-readable string, the client owns the phrasing.
- `src/test/serverErrors.test.ts` asserts every player-reachable server string resolves to something
  other than itself, in both languages. **Add the string there when you add a server error.**

## TAB is the scoreboard key (`heldKey`)

Hold TAB, the standings are there; let go, they are gone — and only if **the press itself is the
gesture**.

- **The key is ours from the press**: `preventDefault` on keydown, `held` true in the same event,
  false on keyup. No timer, and the focus never moves.
- **Shift+TAB is never taken**, and is the keyboard's whole way around the board, so the plain key is
  not a trap (WCAG 2.1.2). Ctrl/Alt/Meta combinations go to the browser.
- **A modifier pressed mid-hold changes nothing**: every repeat is swallowed once the key is down.
- **`blur` releases it** (alt-tab swallows the keyup).
- **`enabled: false` hands the key back whole** inside the rules modal, a picker or the round summary.

`heldKey.test.ts` runs press, release, repeats, modifiers and blur; `score-table.spec.ts` asserts a
held TAB moves no focus and Shift+TAB walks the board. The colour and swap-target panels are dialogs
(`role="dialog"`, `aria-modal`), and `components/dialogFocus.ts` moves focus in, cycles TAB inside,
and hands it back. A card's spoken name is `t.colorNames` plus `t.cardNames`, never the wire id.

## No gameplay keyboard shortcuts, ever

No key plays a card, draws, passes, calls LOCO! or throws a Contre-LOCO!, and none will. It has been
asked for by competitive players and refused.

**Aiming at a button that lights up for a few seconds *is* the skill the game measures.** A key
deletes the gesture: the thing timed stops being a reaction to find and becomes a reflex. This and the
fixed action bar are one decision: the bar holds its coordinates (Catch centred all match, live from
two cards out) so a player can park the cursor and commit, and that only means something if aiming is
the only way in.

**Global versus focused is the line, both ways.**

- A **global** handler (`window` / `document`) fires on a press nobody aimed: refused.
- A **focused** control is the accessibility path (a card and the draw pile act on Enter/Space once
  focused; the language listbox answers arrows on its own button). `PRODUCT.md` commits to WCAG AA,
  and **it must not be removed or made conditional in the name of this rule**. At the table the way in
  is Shift+TAB.

Three global key listeners exist and no fourth may be added: `heldKey` (`state/viewEffects.svelte.ts`),
`state/escapeKey.svelte.ts`, and the audio unlock (`state/appEffects.svelte.ts`, which reads no key).
Anywhere else a global listener may read `Escape` and nothing else.
`src/test/noKeyboardShortcuts.test.ts` holds the rule, including that the allowlist is not stale, and
ignores handlers bound to an element.

### The browser's menu stops at the seat

`src/contextGuard.ts` refuses `contextmenu` while `data-seated` is on the document (waiting room,
queue, table, game over): the browser's image menu over a hand during a five-second window means
nothing. **The landings keep it** — `/` before a seat, the prose sheet, every content page are read,
and copying a link or translating is their ordinary use. Same gate and event-time read as
`pinchGuard.ts`.

It is **not a protection** (the art is in the bundle) and **not a capture-phase listener**: it
bubbles, so a screen that means something by right-click (`WaitingRoom.svelte`'s ⋯) acts first.
`src/test/contextGuard.test.ts` dispatches a real event on both sides of the attribute.

### The hand's hover is a mouse's and nobody else's

- **`Hand.svelte` gates `pointerenter` on `pointerType === 'mouse'`**: a touch synthesises a
  `mouseenter` and never a `mouseleave`, so a tapped card stayed lifted. A finger gets `.slot:active`,
  press feedback that lasts as long as the contact; the grey tap wash is off the card. Same rule as
  the deck's `@media (hover: hover)`.
- **The lift outlives its `pointerleave` by `HOVER_GRACE_MS` (140 ms)**, so a sweep across the felt
  wedges of the fan does not flicker; the next card's `pointerenter` cancels the drop.
- **The card under the mouse is read off the pointer's x against the fan at rest** (`cardAt`), never
  off the hit-tested element, which moves as a lifted card straightens.
- **The card goes all the way up at once and its neighbours step aside, each on a stiff spring**
  (`LIFT_HZ` 8, `LIFT_DAMPING` 0.72: ~40 ms to 90%, ~3% overshoot; neighbours `NEIGHBOUR_LIFT` of the
  way). A hand answers the mouse on the frame; an eased wave reads a beat late. Written onto `.lift`
  in a frame loop (only `hoveredIdx`, the z-order, is state); `.lift` carries `will-change: transform`.
  Full lift is `scale(1.08) translateY(-14px)`, which `turnPillPlace`'s reserve assumes. The hand's
  box is read once per visit (`handBox`), never per `pointermove`. Reduced motion lifts and snaps.
- `handTouch.test.ts` covers all of it.

## Every panel closes twice

Everything that opens over the board closes two ways:

- **Escape**, through `state/escapeKey.svelte.ts`: one `document` listener, since the panels do not
  take focus (a picker opens under the pointer). `enabled` keeps a shut dropdown from eating an
  Escape aimed elsewhere.
- **A pressable control**, because a phone has no Escape and a scrim is not obviously tappable. The
  pinned score table shows a ✕ where its "Hold TAB" hint sits; held with TAB it shows the hint and no
  ✕.

`src/test/escapeClose.test.ts`; the rules, preferences and waiting-room panels in their own test files.
A dropdown anchored to its own opener (the gear, the mixer) needs no ✕. `<Reconnecting />` and
`<TabTaken />` are screens, not panels: no Escape, one control each instead.

## Rules modal

- Opened by `RulesButton`: the "How to play" pill on the lobby, waiting room and search, the "?" chip
  in the chrome row at the table.
- Closes on ✕, the footer Close, a backdrop click, `Escape`.
- `document.body.style.overflow='hidden'` while open, restored on unmount.
- Content lives in translations; the component is content-agnostic.

### One sheet, four surfaces

Below **46rem** this modal, `<Preferences />`, `<AudioSettings />` and the home page's prose sheet are
one shape: up from the bottom edge, full width, `border-radius: var(--radius-xl) var(--radius-xl) 0 0`
over a 4px stroke, 92vh, a 20px title beside a 40px ✕ carrying a 20px drawing, the body scrolling
between a pinned header and a pinned foot, the last control clear of `--safe-bottom`. Entry is
`translateY(24px)` at `0.26s var(--ease-bounce)` — from the anchored edge, never a scale. **46rem is
the width everywhere** (the drawer and the panels change there; 480px is a table column's
breakpoint). The ✕ is one drawing in all four (`M6 6l12 12M18 6L6 18`), never a font character. The
home sheet's half is in `seo.md`. `rulesModal.test.ts` asserts the modal **against
`Preferences.svelte`**, so re-measuring one sheet moves all or fails.

### Two halves, and why the second one exists

"What happens now" is read mid-round; "what is this card" is read before the first deal. A newcomer's
model of the game has a slot for Skip, Reverse and +2 and none for Swap or Global Switch, and a bullet
naming a card does not make its face recognisable.

So the second tab draws the deck: `game/cardCatalogue.ts` is the faces (one kind per entry, the real
`<Card />`, each coloured kind in a different suit so all four colours appear once) and the copy is
`t.cardNames` plus `t.cardBriefs`, one line each. The lede states the four suits.

- **Not the `/cards/` page** (copies, points, the long form, every suit), and **not a link to it**:
  the modal opens mid-match, and anything navigable invites leaving the table. `rulesModal.test.ts`
  asserts zero links.
- **No copies, no points**: those are checked against the server on the page that prints them.
- **The two panels share one scroller**, so `select()` resets `scrollTop`. The tab row is
  `role="tablist"` with arrows/Home/End **on the focused row**. `Escape` closes the modal (a tab is not
  a layer). The `tab` prop exists for the dev gallery (`lobby-rules-cards`), read once.
- **The switch changes the contents and nothing else**: the card has a fixed `height: min(88vh,
  640px)` (92vh as a sheet), so the header and tabs never travel; the scroller has no smooth scrolling,
  so the reset is instant; each panel is a fresh `.panel` running a 0.18s **opacity-only** fade, and
  `select()` returns early on the tab already showing. Reduced motion drops the fade.

## Privacy and terms

Privacy, terms and credits are one content page (`/privacy/`, `/fr/confidentialite/`), linked from
every footer, reachable before typing a name.

- **A policy has to be linkable**: by a person, a crawler and a store listing. `#privacy`, `#terms`
  and `#credits` are each a URL.
- **The copy is not in the i18n bundle**: `src/content/legal.ts`, typed `Record<Lang, LegalDoc[]>` so
  a document cannot exist in one language only, rendered at build time by
  `content/LegalArticle.svelte`. Tutoiement applies here too.
- **The footer, not the gear**: something read once, before a seat; the footer is hidden on
  `data-seated`, where nobody is reading a policy.

Where the voice and legal accuracy pull apart, accuracy wins. `src/test/legal.test.ts` pins the
disclosures, the registry entry, the footer links and that the page ships no script. Reasoning:
[`docs/notes/legal.md`](legal.md).
