# Client: transport, state, i18n

The path between the socket and the store, and the performance rules that protect it. For rendering,
see `visual.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Where the client's logic lives

`App.svelte` and `GameView.svelte` were both mostly *not* rendering: a 320-line switch over every inbound
message in one, and eight animation timers, two prompts and the whole legality check in the other.
Both are now what their names say, and the work sits beside the other work of its kind:

| Module | What it owns |
| --- | --- |
| `hooks/serverMessages.ts` | every inbound message, applied to the store. `App` builds it once |
| `hooks/gameStore.ts` | the assembly, and the re-exports every screen imports from |
| `hooks/live.svelte.ts` | the narrowing every effect below watches one field through. Three lines, and the reason they exist is the section under this table |
| `hooks/gameStore.svelte.ts` | the one reactive snapshot of it, which is what a component reads. Framework-free store, reactive mirror — the same split the theme and the preferences have |
| `hooks/store/` | `types.ts` (the state shape and the five action interfaces), `initialState.ts`, `helpers.ts` (the pure ones), and one module per family of transitions |
| `hooks/gamePlay.svelte.ts` | what a tap on a card means and the two prompts it can open; the legality the board highlights with; the rattle an interception takes and the thump a Contre-LOCO! takes; preloading the room's art while the table is shut, then answering `map_ready` |
| `hooks/viewEffects.svelte.ts` | a piece of table news that takes itself off screen; the held key; the reconnect overlay's own clock; the ticks over the last seconds of our own turn |
| `hooks/appEffects.svelte.ts` | the one subscription that plays a sound; mirroring the seat into `sessionStorage`; the restore that never lands; the host's streamer mode reaching the table |
| `dev/e2eBridge.svelte.ts` | the whole `window.__LOCO_E2E__` surface, dev builds only |
| `components/swapNoticeText.ts` | the line a Swap or a GlobalSwitch puts on screen |

### One snapshot, and what that costs an effect

`hooks/gameStore.svelte.ts` holds the whole store in a single `$state.raw` and replaces it on every
write. That is the right shape for reading — the board is props off one object, and a deep proxy
would clone its identity on every read for nothing — and it is a trap for *watching*. Svelte tracks
the signal that was read, not the value: an effect reading `g.errorMsg` through a getter subscribes
to the snapshot, so every message the server sends re-runs it. React's `useEffect(fn, [errorMsg])`
compared the dependency by value and did not.

A re-render would have been affordable. The cleanup is not. These effects own timers, and re-running
one clears its timer and arms a fresh one, so a window measured in seconds never reaches its own end
while the table is busy. It shipped as four symptoms that look unrelated and are one bug:

- a refusal, a Swap notice or a missed Contre-LOCO! that stays on screen for the rest of the round
  (`autoClear`);
- **the reconnect curtain over a table that is already back** (`reconnectAnimation`): a reclaim lands
  as a burst of writes and the match carries on underneath, so the 600ms timer was pushed back by
  every one of them and `isReconnecting` was never cleared — which is also `GameBoard` hiding its
  children, so the board underneath stayed blank;
- the turn bar dropping its class, forcing a reflow and restarting from full on every play
  (`drainBar`), i.e. the per-frame cost that hook exists to avoid, paid on the hottest path there is;
- the board rattling again on every message while an interception banner was up (`boardShake`), and
  **the colour and swap prompts closing themselves** (`cardPlay`) — from the second card of the round
  onwards, since `lastPlay` is set from then on and the effect that closes a stale prompt re-ran on
  everything.

`hooks/live.svelte.ts` is the answer and it is three lines: wrap the getter in a `$derived`, which
Svelte compares, and hand the effect the accessor. The derivation re-evaluates whenever the snapshot
moves and notifies nothing when the field came back equal, which is the dependency React gave for
free. Every hook that takes a `Live<T>` now reads it that way — it also replaced the three private
copies of `Live`/`read` that had grown in `viewEffects`, `drainBar` and `tabAlert` — and the two
effects written inline in `GameView` plus the three in `App` read a `$derived` for the same reason.

**The same thing happens one level down, where what moves is a prop.** A child does not get the
narrowing either: reading `p.watched` subscribes to the prop, and a *sibling* prop being
re-evaluated re-runs the effect even when the value it read came back equal. Every component under
`GameView` is handed a dozen props off the same snapshot, so "a message arrived" invalidates all of
them at once. Four effects were written as though the trigger were the dependency:

- the board's Swap trails and Contre-LOCO! penalty cards, which are spawned off a notice that stays
  in the store for as long as it is on screen — so they were drawn again on every message underneath
  them, and once per frame during a resize;
- `DiscardPile`'s staged reveal, which waits out the card's flight before showing it. The cleanup
  dropped the staged timer and the new run waited out a fresh flight, so on a busy board the pile
  went on showing the card before last. That is the card every legality decision in the game is read
  off;
- `Hand`'s deal stagger, which armed once, lost its timer to the next message and never re-armed —
  leaving every card wearing its deal delay for the rest of the round.

Two shapes fix all four, and both were already in the file next door. **An effect that spawns
something guards on the trigger's timestamp** (`lastPlayAt`, and now `lastSwapAt` / `lastCatchAt`;
`DiscardPile` reads its `key` derivation and takes the card itself out of the dependency list with
`untrack`), which also makes it immune to a resize. **An effect that holds a timer works to an
absolute deadline** (`Hand`'s `dealUntil`, like `drainBar`'s), so any number of re-runs still ends at
the same moment. A guard that only decides whether to *start* is the shape that fails, and it is the
same one `reconnectAnimation` was bitten by: the cleanup runs whether or not the guard lets the body
through.

**The fifth one did not look like a motion bug at all, and it cost twenty seconds a match.**
`mapPreload` starts the room's downloads once per map id and answers the loading gate when they
settle; `GameView` asked whether the gate was open by reading `g.mapLoading !== null` *inside* the
effect, and `mapLoading` gets a new identity every time another seat reports in. So the effect re-ran
on each arrival, its cleanup cancelled the download in flight, and the once-per-id guard then refused
to start it again: `done` never came, `map_ready` never went out, and the table opened on the
server's 20s `MapLoadTimeout` with the player still watching a progress bar. **A table with a bot
never showed it** — nobody else was there to re-broadcast anything — so the whole E2E suite and every
solo run were clean while every real two-human table paid the full backstop. The fix is both halves:
the question is narrowed to a `$derived` boolean before the effect sees it, and **abandoning a
download is keyed on the map id like starting one is, instead of riding the effect's cleanup**. A
cancellation that is not keyed on the same thing as the guard is the general shape of this bug.
`mapLoading.test.ts` moves a seat in mid-download and asserts the answer still goes out.

**A test that hands a hook a constant cannot see any of this**, which is why every per-hook test
passed while the game misbehaved: the snapshot never moved underneath them. `src/test/liveDeps.test.ts`
is the shape that catches it — move a field the hook is *not* watching, assert it did not notice —
and anything new taking a `Live<T>`, or holding a timer behind a prop, belongs in it. Its second half
does the same to the components, through the real store: `gameStore.setState({ latencies })` is a
message that changes nothing anybody animates.

**Derived state is completed by the store, not by the actions.** `catchTarget` and `unoTimerEnd` are
the answer to "which open window is the button offering", read off `catchWindows` and our own seat.
They are stored because every screen reads them, and stored derived state has exactly one failure
mode: an action that changes the source and forgets to recompute. Eight actions had that chance.
`store/deriveCatchMiddleware.ts` completes any write naming `catchWindows` or `myIndex` (`myIndex`
because a snapshot can re-seat us, and our own window is never the one offered), so forgetting is
impossible rather than unlikely. Writes from outside an action get the same treatment: the middleware
replaces `store.setState` too, which is what keeps a test seeding a board from seeding a lie.

**Who owes a declaration is not the client's to work out.** `applyCardPlayed` takes `catch_seats`
off the message and renders it. It used to derive the list from the roster and the card kind, which
is the server's rule (`openCatchWindowsAfterRearrange`) restated in TypeScript; what is left here is
presentation, namely which window we have already spent a call on and whether the LOCO! banner still
describes the table. See `domain-rules.md`.

**The store is one state object and five families of transitions**, not five stores. The state is one
object because that is what it is: the client's mirror of one match. Several actions write
across the families on purpose, since an authoritative `game_state` settles the board, the
declarations and the scoreboard in the same breath, and splitting the *state* would have turned one
`set` into five. What is split is the reading.

**`GameBoard.svelte` is deliberately not split.** Its eight animation effects are one state machine over
one queue: they share `fliers` and `impacts`, the `landTimers` list, the stage node and the
suppress-next-discard flag. Per-animation modules would pass those five handles through six
signatures, which is the same coupling with more indirection. If it is ever split it should be as
one `boardFx` module, and reviewed with `make visual` rather than with assertions.

**And its spawns go through `untrack`.** `fliers = [...fliers, x]` *reads* `fliers`, so every effect
that spawns one depends on the list it is appending to and re-runs on the next spawn — the board
replayed its first swap animation forever. `addFliers` reads the current value without subscribing
to it, which is what the equivalent updater function used to mean for free. Any new effect that
appends to a `$state` array here has to do the same.

## How the game gets on the page

The site is built by Astro, and the game is **not** an island. Three things pushed that decision, in
descending order of how expensive they would have been to discover later.

**The CSP forbids it.** `client/nginx.conf` sends `script-src 'self'` with no `'unsafe-inline'`. A
`client:*` directive makes Astro emit its hydration runtime as two *inline* `<script>` blocks: not
`is:inline`, not opt-in, not removable by configuration. In production those are refused, the island
never hydrates, and the page is blank. Nothing in the normal loop would catch it either, because the
dev server sends no CSP and the built HTML is only ever served by nginx. Astro's own `security.csp`
generates hashes for exactly these scripts, but emits them in a `<meta>`, and a meta policy does not
loosen a header policy: both are enforced, so the header still blocks them. `csp.test.ts` now fails
on any `client:*` directive anywhere in `src/`.

**Server rendering buys nothing here.** `initTheme()` and `initSessionRestore()` read `localStorage`
and `sessionStorage`, the language comes from `localStorage` then `navigator.language`, and the whole
board is measured from the viewport (`boardSpace`, `elementSize`, `safeAreaInsets`). A server
knows none of those. Rendering the app there would produce a hydration mismatch on every one of them
in exchange for markup no crawler wants: the lobby is a nickname field.

**So `src/pages/index.astro` carries `<div id="root">` and an ordinary `<script>` importing
`src/entry.ts`**, which Astro bundles to an external module. That is the same mechanism the app used
under Vite, `#root` keeps the `html, body, #root` rule in `tokens.css` working unchanged, and the
content pages around it mount no application at all.

**The cost of that split is that `/` arrives twice, so the two halves are held together on purpose.**
The footer row, the phone's burger and the prose behind the sheet are markup the server sent, and
they paint on the first frame; the lobby paints whenever the bundle has loaded, parsed and mounted.
On a reload that read as the background coming up with one lonely control on it — the links on a wide
screen, the burger on a phone — and the game dropping in a few hundred milliseconds later. Nothing
about it was broken, and it looked broken every time.

The app's mounted child, the footer's row of links and the phone's burger therefore all hold at
`opacity: 0` until `entry.ts` writes `data-booted` on `<html>`, two `requestAnimationFrame`s after
`render()` so the attribute lands on a commit that has actually painted rather than one still queued.
Then a single 0.34s fade brings them up together.

**What fades is what arrives, never the surface it arrives onto.** The first version of this held
`#root` and `.homeIntro`, which is the obvious reading and is wrong: `tokens.css` fills both with
`--color-canvas`, and those two flat fills are the entire reason the body's candy gradient is never
seen anywhere in the game — `#root` covers the viewport down to the footer and the footer covers the
rest. Fading either of them let the gradient through for a third of a second, so the load flashed a
backdrop that belongs to no screen. The selectors are `#root > *`, `.homeIntroMain` and `.homeBurger`
instead; the canvas is painted on the first frame and does not move again. Photographed mid-hold, the
page is one flat colour, pixel for pixel the colour it settles on.

Four details are what make it safe rather than a way to lose the page:

- The hold is inside `@media (scripting: enabled)`. With no script there is no mount to wait for, and
  the prose behind the sheet is the only thing on `/` a crawler reads: hiding it behind a reveal that
  can never fire would take the indexable half of the home page off the page. `seo.spec.ts` browses
  this page with JavaScript disabled, and it must keep seeing it immediately.
- The same animation carries a 3s delay while the attribute is missing. A bundle that 404s, throws on
  import or is blocked reveals the page anyway; the alternative is a blank screen with no way out.
  The `[data-booted='in']` rule replaces it with the delay-free one the moment `entry.ts` reports in.
- **The reveal is spent.** `entry.ts` blanks the value 600ms later, leaving the bare attribute that
  lifts the hold and no rule that animates. Every screen in the game is a fresh child of `#root`, so
  a live `#root > *` reveal would fade the board in again on every screen change for the rest of the
  match — the waiting room, the deal, the score table.
- It animates `opacity` and nothing else. A transform on any of these would make it the containing
  block for the fixed burger and for every panel the app renders, for as long as it ran.

Reduced motion keeps the wait and loses the fade for free: the blanket rule in `tokens.css` cuts every
animation's *duration* and leaves its *delay* alone, so the sync survives and the movement does not.
`contentPages.test.ts` pins each of these, including the two selectors that must **not** be there.

## The toolchain, and the one place it is deliberately not the newest

Svelte 5, Astro 7, Valibot 1, ESLint 10, Vitest 4. Several of those cost something worth writing
down.

**The crossing from React 19 to Svelte 5 has landed, and the way back is closed on purpose.** No
`react`, no `react-dom`, no `@astrojs/react`, no framer-motion, no `.tsx`, no `.module.css`;
`astro.config.mjs` configures one framework and the ESLint config knows one. `src/test/noReact.test.ts`
is the guard, and it checks four different things because a return could come in through any of
them: the manifest, the Astro and ESLint configs, every import in every source file, and every file
extension under `src/`.

What the crossing left behind is worth keeping, because it is what made it survivable:

- **The state that two frameworks had to share is still framework-free.** The language
  (`i18n/store.ts`), the game state (`hooks/store/createStore.ts`), the theme (`src/theme.ts`) and
  every on/off preference (`hooks/prefStore.ts`) are plain modules with a subscription, read through
  `createSubscriber` (`i18n/i18n.svelte.ts`, `hooks/prefs.svelte.ts`). They left React first
  *because* a Svelte component could not read a React context, and they stay where they are for a
  reason that outlived that one: a content page mounts nothing and still has to know the language
  and the theme. Two copies of the current language is how a document ends up half translated.
- **`hooks/` is split along the same line.** `.svelte.ts` for anything owning reactive state or an
  effect, plain `.ts` for everything else, and the plain half is the half a page with no application
  on it can import. The `use` prefix those files carried went with React: none of them is a hook,
  they are constants, pure functions and plain stores, and **nothing in them may reach for a rune**.
  That last part is not enforced by the compiler in this direction — Svelte compiles runes in
  `.svelte` and `.svelte.ts` and nowhere else, so a `$state()` here is not a build error, it becomes
  a call to a global that does not exist and throws whenever the line first runs.
  `src/test/runeScope.test.ts` is what catches it instead.
- **An Astro layout imports the `.svelte` directly.** It always did — a wrapper that mounted its
  content in an effect answered Astro with nothing at all, and `ContentPage.astro` rendered an empty
  header that no test reading sources would have caught. There is no wrapper left to get this wrong,
  but the rule is why `<LocoLogo />` and every `<Card />` on `/cards/` are static markup.
- Svelte applies a change on the microtask after it, not inside the click. Nothing on screen is
  slower for it, but a Vitest assertion reading the DOM on the line after `fireEvent` needs a flush
  first — which the suite does once, in `src/test/setup.ts`, rather than in three hundred tests.

**Svelte prunes a CSS selector it cannot see in the markup**, silently, with a build warning nobody
reads. Component styles live in the component's own `<style>` block now, so this is the failure mode
to watch: a class applied at runtime by JavaScript — `drainBar`'s urgent class is the one case in
this client — has to be bound in the markup with `class:` rather than added with `classList`, or it
compiles away. `:global()` would also silence it, and silencing the compiler is the opposite of what
this rule is for: **no `:global()` without a written justification.**

**`astro check` does not type-check `.svelte`.** `npm run build` is `astro check && svelte-check &&
astro build` for that reason; dropping the middle one leaves every Svelte component untyped while
the build still reads green.

**The store is ours** (`hooks/store/createStore.ts`, ~40 lines). It replaced Zustand, and not for
weight: the board is read by three modules that render nothing (`hooks/appEffects.svelte.ts`, which
is where the sound subscription lives, `sessionRestore`, the E2E bridge) and, during the crossing, by
two frameworks at once. What the
dependency actually provided was `getState`, `setState`, `subscribe` and a middleware slot — four
things with no framework in them, wrapped in a framework binding. The semantics are deliberately
Zustand's to the letter, because
209 reads and writes in `gameStore.test.ts` and every action in `store/` were written against them,
and `src/test/storeCore.test.ts` states each one the client depends on. The subtle one:
`deriveCatchMiddleware` reassigns `store.setState` while the creator runs, so the store must publish
the property the creator mutated rather than a copy taken before it — otherwise the derivation
applies to actions and to nothing else, and a test seeding a board writes an inconsistent state with
nothing failing.

**A component's events are the DOM's, and its props are ordinary props.** `onclick`, not `onClick`;
a submit handler takes the `SubmitEvent` a form actually fires. The one thing to know is that
**Svelte silently ignores a prop it does not recognise** — no warning, no type error at the call site
if the object is built dynamically — so a name left in the old casing is a handler that never runs.
`card.test.ts` caught exactly that on `Card`'s `onclick` after the port: the test rendered, asserted,
and counted zero calls out of three clicks.

Where a parent needs the node itself rather than a callback — the flight layer animating a real card
— the child takes a `setNode` callback and calls it from an effect (`Card.svelte`, `CardBack.svelte`).
A `bind:this` on the parent's side would work too; the callback is what survived the crossing and it
keeps the ownership explicit, including the `setNode(null)` on teardown.

**The validator is Valibot because Zod 4 compiles with `Function()` and the CSP refuses that.** The
full account, the test that replaced the workaround's config pin, and the rest of the generated
protocol are under "Protocol validation (client)" below.

**TypeScript stays on 6.x, and that is a ceiling rather than a preference.** `astro check` drives
`@astrojs/language-server`, which needs TypeScript's programmatic API. The 7.0 native compiler does
not ship one yet and the check refuses to start with a message naming that directly. Raising it
turns the client's type gate into an immediate failure, so the pin moves when the language server
says it can. Two more tools now hold the same ceiling independently — `svelte-check@4` and
`@astrojs/svelte@9` both declare `typescript: ^5 || ^6` — so this is three votes rather than one.
The E2E package is held to the same major for one decision rather than two.

## The realtime path (tap → wire → table)
Every hop between a player's finger and the other clients' boards is on the critical path of a
mechanic that is decided by arrival order. Treat a delay added here as a rules change, not as
polish.

- **nginx `/ws` sets `tcp_nodelay on` and `proxy_buffering off`.** Gameplay messages are a few
  hundred bytes each, which is exactly the shape Nagle holds back waiting for a fuller segment:
  up to 40ms of invisible delay on a card play, on the one hop nothing in the app can see. The
  buffering flags say the same thing for nginx's own buffers.
- **The upgrader keeps compression off** and sizes its write buffer (4096) so a personalised
  `game_state` goes out in one write. permessage-deflate would buy no bandwidth worth having on
  payloads this small and would put a deflate pass plus a flush on both ends of every play.
  `WriteBufferPool` is shared, so a ten-seat table does not hold ten per-connection buffers for the
  whole match.
- **The client sends first and animates second.** `GameBoard.handleCardClick` calls
  `props.onCardClick` and only spawns the hand→discard flight if it returns `true`. The flight is
  local rendering; the message is what the table is waiting on.
- **A tap that is not a play animates nothing.** `cardPlay`'s `onCardClick` (which `GameView`
  hands to the board) returns `false` when the
  client refuses the card and when the tap only opens the colour/player prompt. It used to fly the
  card on every tap, so an illegal card and an unconfirmed wild both threw the card at the pile and
  had it reappear in the fan. Plays confirmed later go through `flightRef`
  (`GameBoardHandle.flyFromHand`), called by the picker callbacks straight after `onSend`.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, keyed `draw` / `pass` / `uno` /
  `catch:<seat>`). One shared 400ms lockout silently ate the most ordinary sequence in the game,
  draw then pass, along with LOCO-then-catch and catching a second seat after a Swap. A control that
  ignores a deliberate tap because a *different* control was used 300ms ago reads as a dead button.
  The catch key carries its target because two seats are two taps.
- **A prompt lives exactly as long as the play behind it stays legal.** `cardPlay` re-reads the
  condition that opened the colour/player picker on every state change (`clientMayInterrupt` for an
  interject, `currentTurn === myIndex && clientMayPlay` otherwise, plus the card still being in
  hand) and closes it the moment that answer turns false. The older rule closed a picker only when a
  card landed (`lastPlay.at`), which covers an interjecter stealing the lead and nothing else: the
  turn timing out, a forced draw and a fresh `game_state` after a Swap all move the board without
  setting `lastPlay`, so the prompt stayed up over a table that had gone and the choice went out
  against a state the server had already replaced. Being asked for a swap target and *then* refused
  is the one rejection in this game that reads as a broken promise rather than as an illegal card.
- `src/test/realtime.test.ts` owns all of the above on the client side.

## Client transport

### The socket does not go through the CDN, and that is worth 380 ms a message

Production serves the page from `ohloco.com` and dials the socket at `ws.ohloco.com`, a hostname that
resolves straight to the origin. The reason is a measurement, not a preference. From a Paris
connection to a Paris origin, on a socket **already established** — so no handshake, no certificate,
no DNS in the number:

| | round trip |
| --- | --- |
| through the CDN | 228–696 ms, median **389 ms** |
| direct to the origin | 7.1–10.6 ms, median **8.5 ms** |

The same edge answered two other zones in 40 ms at the same moment, so this is the CDN's path to
*this* origin rather than the player's path to the CDN, and it congests by the hour. It is also not a
page-load cost paid once: it is every card, every catch and every interrupt, and **an interrupt is
decided by arrival order at the server**, which makes it the mechanic rather than the polish.

Only the socket leaves. The HTML, the bundle and the images all still want the edge and the cache.

- **`webSocketPolicy.ts` decides the address, `webSocket.svelte.ts` only dials it.** `wsEndpoints()`
  returns the pair — `direct` (null unless the build named one) and `proxied` (always) — and `wsUrl()`
  picks. Both are pure, so `wsEndpoint.test.ts` needs no DOM and no socket.
- **`VITE_WS_ORIGIN` is baked in at build time**, like `VITE_PUBLIC_ORIGIN` and for the same reason:
  the client image is built per environment. `.gitlab-ci.yml` passes it **on a tag only** — dev has no
  such hostname, no DNS record, no certificate for one, and does not have the problem either.
- **The scheme comes from the page, never from the value.** A `wss://` written into an http://
  deployment (or the reverse) is mixed content, which the browser refuses *before* attempting the
  socket: it fails as silence and reads exactly like the server being down.
- **The fallback is one-way, and the CSP has to keep allowing it.** After
  `DIRECT_FAILURES_BEFORE_FALLBACK` (3) sockets that closed *without ever opening*, the client goes
  back to the page's own origin for the rest of the page's life. Three, because that is about two
  seconds of backoff; one-way, because resetting it on every successful connection would spend those
  three failures again at every drop. A socket that opened and later dropped is a network event and
  resets nothing — only a socket that never opened is evidence against the hostname. This exists
  because **the direct hostname's certificate is the one thing in this stack that nothing renews and
  nothing here can see expire**: a slow game beats a dead one, and a page reload is what tries the
  direct hostname again.
- **`security-headers.conf` carries `__WS_DIRECT_ORIGIN__`, substituted by `client/Dockerfile` from
  the same build-arg the bundle gets**, so the policy and the socket cannot disagree. The build
  *fails* rather than shipping an unsubstituted placeholder — a policy naming a literal
  `__WS_DIRECT_ORIGIN__` blocks the socket the game is about to dial and reports it nowhere.
- **The server has to be told.** `hub.originAllowed`'s default rule is "the `Origin`'s hostname equals
  the request's `Host`", which two different hostnames do not satisfy, so production sets
  `LOCO_ALLOWED_ORIGINS` to the **page's** origin. Without it every upgrade is refused, and a refused
  upgrade is indistinguishable from a server that is down. See
  [`docs/notes/server.md`](server.md).
- **nginx serves the socket and a 404 on that hostname** (`server_name ws.*`), never the SPA: serving
  the site there too would publish the whole thing under a second hostname with only the canonical
  arguing against it. Both server blocks `include ws-proxy.conf`, because a socket reconnecting onto
  the fallback must reach a server that cannot tell the difference — the seat it is reclaiming was
  taken on the other one.

### The rest of the transport

- **The socket's URL comes from `import.meta.env.VITE_WS_PORT`, and Astro does not expose that name
  by default.** Astro narrows Vite's `envPrefix` to `PUBLIC_`, which leaves `import.meta.env.VITE_*`
  in the transformed module verbatim and reading `undefined` in the browser, with no warning at any
  layer. `webSocket` then took its production branch in dev and dialled same-origin `/ws`, which
  is the Vite dev server proxying nothing: `ws://localhost:5173/ws` closed before it opened, and the
  symptom a player got was a table that never opened and a queue that never paired.
  `astro.config.mjs` restores the prefix (`envPrefix: ['PUBLIC_', 'VITE_']`) rather than renaming the
  variable, because `docker-compose.dev.yml`, `e2e/playwright.config.ts`, `client/Dockerfile` and the
  README all already name it. `src/test/wsEnv.test.ts` fails whenever the hook reads a prefix the
  config does not expose. Anything else the app needs from the environment obeys the same rule.
- `webSocket.send(msg)` queues to `pendingRef: ClientMsg[]` when not OPEN; FIFO flush on `onopen`.
- Auto-reconnect: `reconnectDelay(attempt)` walks `RECONNECT_DELAYS_MS`
  (250ms, 500ms, 1s, 2s, 4s, 8s, 15s, then held), `attempts` resets on `onopen`. The
  schedule and the `WsStatus` vocabulary live apart from the socket, in `hooks/webSocketPolicy.ts`:
  a backoff curve belongs to no framework and a component that only needs the status should not
  import the transport to get it.
  **The first retry is deliberately almost immediate.** Most drops are a single lost connection
  that comes straight back, and the flat 2s first retry it replaced cost the player an entire
  interrupt window of dead board every time one happened. The tail still backs off, so a server
  that is genuinely down is not hammered.
- **There is no attempt ceiling, and removing it was a bug fix rather than a tuning.** Ten attempts
  ran out at 27.75 s, and past that the client never tried again for the life of the tab, under a
  "Reconnexion…" curtain with nothing on it to press. A normal deploy does not produce that (compose
  holds the old server for its whole 90 s drain), but everything around one does: a slow image pull,
  a crash loop, `stop_grace_period` reached, a phone that suspended the tab. And the client's 27.75 s
  could expire before the server had even started counting the 60 s it holds the seat for, which is
  the case where giving up cost a seat that was still there.
- **The recovery path is not the schedule.** `reconnectNow()` retries from the top and is wired to
  three things that all mean the same thing: `online`, the tab becoming visible again (`focus` +
  `visibilitychange`), and the button on the curtain (`GameView`'s `onRetryConnection`). `connect()`
  refuses a socket that is already CONNECTING or OPEN, so every entry point is safe to fire twice.
- `getReconnectMsg` is `reconnectMessageFor`; see "session persistence" below for what each screen
  sends.
- **Everything the server can say lives in `hooks/serverMessages.ts`**, not in `App`.
  `createServerMessageHandler(unoTimer)` is built once, during App's setup, and takes its store
  snapshot at creation: the action functions are created once by the store factory and are stable for
  the life of the app, so closing over them costs nothing. Branches needing CURRENT store *values*
  call `gameStore.getState()` at the moment they need it — a frozen snapshot would be reading the
  store as it was at mount, which is a different value on every branch that asks about the current
  screen. The one thing passed in is the LOCO! banner's timer (`UnoBannerTimer`), because it belongs
  to a component and the handler is not one.
- **The match screen is built once and then left alone.** It is the most expensive tree in the app
  and the store underneath it changes several times a second. Svelte gives this by construction —
  `GameView` is instantiated once and only the reactive reads inside it update — but the guarantee
  is losable in one line: a `{#key}` around the board, or a keyed block whose key moves with the
  state, tears it down and rebuilds it on every change. That is the same bug the React version had
  with a defeated `memo`, spelled differently.
  - `src/test/appSubscription.test.ts` pins it by counting how many times the stub's *script body*
    runs, which under Svelte is the number of instantiations. Its `webSocket` mock returns a
    **stable** `send` on purpose: an unstable one would make `handleSend` unstable by itself and
    quietly prove nothing.

## Session restore across a reload
The socket-level reconnect only ever covered a **dropped connection**: the store was still in memory,
so it still knew the room, the seat and the token. A refresh, a crashed tab, an accidental navigation
or a phone killing a backgrounded page threw all of that away, and the player landed on the lobby
while the server held their hand and their score for another minute with nobody able to claim it.
That is the disconnect people actually have, and it was the one that could not be undone.

- `hooks/sessionPersistence.ts` owns the record (`loco_session`) and `reconnectMessageFor(state)`.
  **One pure function builds the rejoin for every case**, so a reclaim cannot mean two different
  things depending on how the connection was lost.
- **It used to answer three screens out of six, and the other three each failed silently and
  differently.** `searching`: the server takes a dropped socket out of the queue, correctly, and the
  client said nothing coming back — so the screen went on timing a wait in a queue the player was no
  longer in, which is precisely what `searchStages` says no copy may imply. It re-sends `find_match`
  now. `matchfound`: a real seat with a real token, two seconds from a deal, and saying nothing left
  a player watching a versus screen that was never going to resolve; it reclaims like a game seat,
  and `appEffects` stopped clearing the stored record there for the same reason. `gameover`: the
  server holds that seat now (see the server note), so it is reclaimed with its token — **except in
  a matchmade room**, where the seat is released outright and the pair is done.
- **An error on `matchfound` resets to the lobby**, unlike every other screen, which gets a toast.
  It is the one screen in the game with nothing on it to press: a pairing that fell apart there is
  the end of that pairing, and a player left holding a countdown that expires into nothing has no
  way to find that out. `searching` keeps the toast — it has a cancel button.
- **`sessionStorage`, deliberately, not `localStorage`.** It is per tab, so two seats played from one
  browser (how this game is tested, and how a lot of people play with a friend on one machine) cannot
  overwrite each other's token and reclaim the wrong seat; it survives a reload, a back/forward
  navigation and a crash restore, which is every case this exists for; and it dies with the tab
  rather than handing the next person a live seat.
- `initSessionRestore()` runs in `entry.ts` **before the first render**, next to `initTheme()` and for
  the same reason: `webSocket` connects in an effect on App's first mount and the rejoin goes out
  from that very first `onopen`, so the store has to already know what it is reclaiming.
- `screen: 'restoring'` is its own screen, not a flag over `'game'`: the board has no hand, no discard
  and no players at that point, and a table drawn from an empty state behind an overlay is a broken
  table with a curtain over it. `restoreTarget` says which rejoin is in flight; `setScreen` retires it,
  which is what "the reclaim landed" means (every landing path goes through it).
- `SESSION_TTL_MS` (30 min) is a **staleness guard, not a correctness one**: the server is the only
  authority on whether a slot can still be claimed. Its job is to stop a cold open days later from
  flashing a reconnect screen at somebody who just wants the lobby. The stored fields change once, at
  join time, so `touchSession()` re-stamps on `pagehide`/`visibilitychange`. Otherwise `at` would be
  the join time and a long match would age its own record past the TTL.
- **A refusal ends the restore and takes the record with it** (`abortRestore`, called from the `error`
  branch and by `useRestoreTimeout`, 12s). Replaying the same refusal on every load is how a tab
  becomes permanently unusable, and a spinner with no end is worse than a lobby with a reason.
  `reconnect failed` / `reconnect cancelled` are the only entries in `serverErrors.ts` with no server
  string behind them: they land in the same `errorMsg` slot, so they resolve through the same table.
- The persistence subscription **dedupes on the four persisted fields**. It fires on every store
  change, i.e. several times a second during a match, and `sessionStorage` is synchronous. See "The
  realtime path": work added there is work added between a tap and the wire.
- **`ServerMsg.PlayerID` is a `*int`, for the same reason as `PlayerIndex`.** `omitempty` dropped seat
  **0**, and this hid longer because the client's `?? 0` fallback was right by luck everywhere it
  mattered: the host is seat 0 on `room_created`, so an absent field and the default agreed. A tab
  reloading straight into a match has no earlier value to fall back on, so a dropped `player_id` seated
  the restored client at **-1**, holding a hand it could not match to any seat on the board. Read it
  with `ServerMsg.OwnSeat()` (-1 = the message assigns no seat); `protocol/messages_test.go` now pins
  seat 0 onto the wire for **both** fields. `player_reconnected` additionally falls back to
  `state.your_index`, which is the same seat and is not omittable.
- **The token is one-shot, so the answer to a reclaim carries the next one and the client has to keep
  it.** `hub.handleReconnect` spends the token the reclaim was made with and issues a fresh one on
  `player_reconnected`, and the reasoning it gives for rotating is explicitly that the client stores
  whatever it is handed: the old token has been on a socket that died, it is in `sessionStorage`, and
  if the process restarted on the way it has also been written to a snapshot on disk. The client's
  branch did not store it. Everything looked right — the seat came back, the hand came back — and the
  record kept a token that had just been spent, so the *next* reclaim of that tab was refused. That
  refusal is `game already in progress`, deliberately the same string a stranger knocking on a live
  table gets (the server must not confirm the roster), so what a player who reloaded twice, dropped a
  socket after a reload, or sat through a deploy saw was a lobby telling them the cards were already
  dealt at the table they were sitting at. **Only the second reclaim fails**, which is why a test
  that reloads once cannot see it: `sessionRestore.test.ts` asserts the fresh token reaches the store
  *and* the record, and the E2E reloads twice.
- Client: `store.myNickname` is kept separately from `players` because a reloaded tab has no roster to
  derive it from and the rejoin is keyed on the nickname. `<Reconnecting />` names the room so the
  player recognises it and offers the way out; scenes `reconnecting-game` / `reconnecting-room`.

## One tab at a time
`hooks/tabLock.ts` elects one tab to hold the game; `Root.svelte` mounts the app in that one and
`<TabTaken />` in the others. Scenes `tab-taken` / `tab-taken-seated`.

**What was wrong.** Every tab was a session of its own, and that half is deliberate — the section
above is the reason `loco_session` is in `sessionStorage`. What nothing owned was the other half. A
second tab looked like a fresh game, so it counted a second time in `players_online` (which counts
sockets on purpose, and correctly), and it entered the 1v1 queue as a second player: `queueIndex`
deduplicates by `*Client` pointer, `tryPair` takes the first two entries, and with a quiet queue the
two of them are a player paired against their own reflection. `uniqueNickname` renames the duplicate
and nothing else notices. That is the game lying to somebody, which is worse than any of the
resource questions around it.

**Why the election is a synchronous `localStorage` read.** The obvious version asks the other tabs
over `BroadcastChannel` and waits for a reply. That wait is the bug: for as long as it lasts the tab
either shows a curtain it may have to take back down (a flash over the tab that turns out to be the
owner) or opens a socket "just in case" — and the socket is the entire thing being prevented. One
read of one key decides it before the first paint, and the channel is demoted to what it is good at,
making a handover instant instead of `STALE_MS` late.

**Why the record is a heartbeat.** A flag would be correct exactly until a tab crashed, was killed
by the OS, or lost its `pagehide` to a force-quit — after which the game is unplayable in every
future tab of that browser, forever, and the only fix is clearing site data. `at` is rewritten every
`BEAT_MS` (2s) and anything older than `STALE_MS` (5s) belongs to nobody. Two and a half beats:
enough that one throttled timer in a background tab does not hand the game away, short enough that
nobody sits looking at a curtain over a tab that no longer exists. **A timestamp in the future counts
as stale too** — a clock that moved backwards would otherwise leave a record that is younger than
`STALE_MS` for as long as it takes the clock to catch up, which is the same permanent lockout by
another road.

**Why every failure ends with this tab owning the game.** No `localStorage`, storage that throws on
write (Safari's private mode has done exactly that while still exposing the object, which is why the
probe writes rather than checks for presence), no `BroadcastChannel`, a record that will not parse.
All of them fall through to "you are the owner", which is the behaviour that shipped before this file
existed. A player wrongly shut out of the game has no argument available to them; two tabs is a
lesser failure than that, every time.

**Why it is `Root.svelte` and not a branch inside `App.svelte`.** `webSocket()` is called at the top
of `App.svelte`'s script, so there is no way to mount the app and not open a socket. Not mounting is
also what makes yielding correct in the other direction: the app unmounts, the socket closes, and the
server holds the seat exactly as it does for any other dropped connection. It is the one place a
`{#if}` may rebuild the app — see `appSubscription.test.ts` for the guarantee it is an exception to.

**Why the curtain says what the button costs.** Taking the game inherits nothing. The other tab's
seat record is in *its* `sessionStorage` and cannot be read from here, so the tab that takes over
starts at the menu and the tab that yields loses its seat. That is fine when the other tab is sitting
on the menu and expensive when it is mid-match, so the record carries `seated` and the copy turns on
it — the same rule as the board's `leaveNote`: what the player cannot see from this screen is what
the press costs somewhere else. **The curtain does not close on `Escape`**, which is the one
documented exception to *Every panel closes twice* below: that rule is about panels somebody chose to
open, and this is the state of the tab, with nothing behind it to go back to.

**The first `storage` listener in this client**, and it should stay the only one. Everything else in
`localStorage` here — the nickname, the preferences, the language, the theme — is read at boot and
deliberately does not follow another tab: changing somebody's language mid-match because they picked
one next door is not a courtesy. The lock is different because it is the one key whose whole meaning
is cross-tab.

**What it does not cover, and what nothing on the client can.** The storage is per origin *and* per
profile, so a second browser, a private window or another machine bypasses all of it — including the
self-pairing in the queue. The server-side fix is not free: refusing to pair two sockets on one
`netKey` refuses two friends on one wifi, and behind a proxy whose forwarded header is not trusted
(see `server.md`, where that trap is already written up) it refuses everybody. It is left open
knowingly.

## Remembering the nickname
A returning player should not retype their name on every visit, so `hooks/nicknameMemory.ts` keeps the
last one entered (`loco_nickname`) and `<Lobby />` seeds its field from it at mount.

- **`localStorage` here, not `sessionStorage`**, which is the exact opposite of the choice above and
  for the same reason it was made: `loco_session` is a live claim on a seat (token-bearing, TTL'd,
  and catastrophic if the wrong tab reclaims it), while this is a keyboard shortcut that authenticates
  nothing. Surviving the tab and being shared across tabs is the whole point of it. Two seats played
  from one browser now start from the same suggested name, and either can overwrite it: nothing is
  lost, because the field is still editable and the server still refuses a duplicate nickname in a
  room.
- **Written on submit, never on keystroke.** A half-typed name is not what anyone wants handed back,
  and the write would land on the realtime path for no benefit.
- Seeded from `readNickname()` during setup, i.e. **read once at mount**. Re-reading storage while the lobby
  is open would fight whatever the player is typing.
- It is a prefill, not a submission: an emptied field still refuses to send. In the join form
  `autoFocus` follows the same fact, landing on the room code when the name is already known and on
  the name when it is not, which is the only thing a returning player still has to type.

## Answering a nickname as it is typed
`components/nicknameRules.ts`, used by `<Lobby />` on every keystroke and again on submit. It mirrors
the **shape** half of `server/game/nickname.go`: 20 characters counted as characters, the Latin /
Greek / Cyrillic allowlist, `-_.'` and one space, at most one combining mark per letter, at least one
letter or digit.

- **It decides nothing.** The server validates again on `create_room`, `join_room` and `find_match`,
  and its answer is the one that seats a player. This exists so the refusal is instant instead of a
  round trip; a client that skipped it would be refused a fraction of a second later.
- **The word list is not shipped.** It is 19 embedded files on the server. Downloading a few thousand
  slurs on every page load, in a bundle anyone can read, for a check the server has to repeat anyway,
  buys nothing — and a blocked term is rare enough that a round trip for it is the right trade.
- **One line for both halves.** `t.errors.nicknameRejected` is what the shape check shows and what
  `nickname not allowed` resolves to, so a player cannot tell whether the client or the server
  refused them, and cannot read the rule off the message. That is the same reason the server sends
  one string for all three of its rules; see `docs/notes/server.md`.
- The message appears in the alert the lobby already had, and clears the moment the field becomes
  acceptable again — the same behaviour a server error has there.
- The canonical form (trimmed, runs of spaces squeezed) is what is sent and what is remembered, so
  `  Jean   Luc  ` and `Jean Luc` are one player and one seat label.

### The button is off until the shape is there, and only until then
The three submits — `Find an opponent`, `Open the table`, `Take a seat` — are `disabled` while
`isNicknameShapeValid` is false, which on an empty field is the state the screen opens in. It removes
the press whose entire outcome was an error line under a form nobody had finished filling in.

- **What may grey a button out is shape and nothing else.** A disabled control gives no reason and
  takes no answer, so it may only ever say something the player can see for themselves: the field is
  empty, or it holds `---`, or it holds a character that will not render on a seat. The bar is
  deliberately at the floor — **one letter or digit is a nickname** — because everything above that
  floor is taste, and taste belongs in a refusal a player can read.
- **The word list is therefore not part of it.** The client does not carry the list (above), so a
  blocked term reaches the button as an ordinary name and is refused by the server on the ask. The
  answer is `<Lobby />`'s one `$effect` on `error`: any refusal matching `/nickname/i` — the blocked
  term, and `nickname "Bob" already taken` with it — **focuses the field and selects what is in it**,
  so the next keystroke replaces the name instead of appending to it. Asking again *is* the refusal;
  the alert only says the ask failed.
- The submit handlers still call `acceptNickname()`, which checks the shape a second time. The guard
  is not the disabled attribute, on this field for the same reason it is not on the table code.

## Answering a table code the same way
`components/tableCodeRules.ts`, the same idea applied to the join form's second field. It mirrors
`hub.roomCodeRe` and the alphabet `hub.generateRoomCode` draws from: six characters of `A-Z2-9`,
minus `I`, `O`, `0` and `1`.

- **Those four are missing for a product reason, not a technical one.** A table code is read out loud
  on a stream and typed back by somebody watching it, and in that setting `I`/`1` and `O`/`0` are the
  same character. The server never generates one, so the client never has to accept one.
- **The field drops, it does not refuse.** `sanitizeTableCode` uppercases, strips everything outside
  the alphabet and caps the length, on every keystroke and on paste. A code copied out of a chat
  message with a trailing space, a newline or surrounding punctuation is still the right code, and a
  player typing `0` where they meant `O` gets nothing rather than a character that fails six
  keystrokes later, in an error line, after a round trip.
- **"Take a seat" is disabled until the code is whole** *and* until the nickname is (above), which is
  the difference between a button that does nothing and a button that says why. `handleJoin` checks
  both again anyway: the guard is not the disabled attribute.
- **It decides nothing either.** `join_room` is validated server-side, and an unknown table still
  comes back as `room not found` — the code being *shaped* like a table is not the code being one.
  The nickname is unaffected: it keeps its own instant refusal, and a valid code does not make an
  unacceptable name sendable.

## The link a table is shared with
`hooks/tableInvite.ts`. The waiting room's code is a button, and what the press copies is a URL
carrying the code (`tableInviteUrl`), not the six characters. On the other end, `initTableInvite`
reads that code off the URL before the first render and `App` acts on it. The URL is `/i/CODE`, a
page of its own, and `src/pages/i/index.astro` plus `seo/meta.ts`'s `INVITE` are the other half of
this section.

- **Why a link at all.** A code costs the receiver three steps: read it, retype it without a slip,
  and find the screen to type it into. A link costs one tap, and the seat is the only thing on the
  other side of it. The code stays on screen, unchanged: it is what a stream reads out loud and what
  somebody already sitting at the join form types.
- **The plate says so before it is pressed.** `<TableCode link />` draws a chain beside the code, and
  it exists because every tester was surprised once: they pressed a plate labelled "table code" and
  got a URL. The toast said "Link copied!" — afterwards, which is the wrong side of the press. Two
  details make it the right icon rather than any icon: it is **drawn**, like every other icon in the
  game (a font glyph lands on the baseline where this has to sit on the code's middle, and it would
  inherit the code's own 2px ink stroke), and it sits **outside everything streamer mode blurs**.
  What has to stay off a stream is the six characters; that the plate copies a link is not a secret.
  The prop is off by default, because `<Reconnecting />` prints the code as information with nothing
  to press, and a chain there would promise a gesture that does not exist.
- **It is `/i/?t=CODE`, and the page is the point.** It used to be `?t=CODE` on the home page, and
  the reason it moved is the one thing a link does that the game cannot: it gets pasted into a chat
  window, which unfurls it. An unfurler reads the *served* HTML and runs no script, so every
  invitation previewed as "LOCO, a card game" — true, and not what somebody is being handed. `/i/`
  is `noindex`, carries the invitation's own title, description and art (`seo/meta.ts`: `INVITE`,
  `INVITE_OG`), and is the home page in every other respect: same mount, same bundle, same game,
  through `GamePage` with `chrome={false}`.
- **The code stays a query parameter, and `/i/CODE` was tried and rejected.** A path form is not a
  page the build emitted — a static build cannot emit one per table — so it needs a fallback in
  whoever serves the request. nginx can do that in four lines. `astro dev` cannot be made to at all,
  and this is worth writing down because all three attempts looked correct: a Vite plugin's
  `configureServer` never fires under Astro 7 (it does under Vitest, which is what makes it look
  wired up), `astro:server:setup` fires but its middleware never sees the URL even at the head of
  the connect stack — Astro routes first and answers the 404 itself — and a dynamic entry in
  `redirects` refuses to start the server without an SSR adapter. So a path form would resolve in
  production and 404 under `make dev` and the entire Playwright suite: a link a developer cannot
  open and the E2E suite cannot exercise, in exchange for three characters. The query form is the
  same URL in every environment and needs nothing in `nginx.conf`.

- **The link carries no language.** It is always `/i/?t=…`, whichever language it was copied from. A
  link gets forwarded, and the person who copied it does not know who ends up pressing it, so
  shipping `/fr/` would decide the reader's language from the other side of the table. That choice
  belongs to whoever opens it and the i18n provider already makes it (a stored choice, then the
  browser). It is also why `/i/` is served with **no `data-served-lang`**: `langUrl` treats a missing
  attribute as "nothing to disagree with" and leaves the document where it is, so an invitation never
  moves on its way to a table. Nothing is swapped there either — `chrome={false}` leaves that
  document with no served copy in it at all.
- **The parameter is only read on `/i/`.** It used to be read on every page, because `/?t=CODE` is
  what the button handed out before the invite page existed. One URL is an invitation now, and this
  runs on every page load: reading a `?t=` anywhere would let a query string somebody put on the
  home page seat a player. Elsewhere it is left in the address bar untouched, like every other
  parameter this module was not asked about. Both spellings of the page are read, though — nginx
  resolves `/i` through `try_files $uri/`, so a link that lost its slash in a chat client is still
  an invitation.
- **The code is spent on arrival.** `initTableInvite` takes it back out of the address bar with
  `replaceState` before anything else looks at it. Three reasons, and any one of them is enough: a
  reload must not re-join a table the player has since left (a reload's job is the seat reclaim
  below), a code sitting in the address bar is a code on stream in the one place `TableCode`'s blur
  cannot reach, and a URL copied later would keep pointing at a table that has closed. **Spending it
  on the invite page spends the page too**: what is left in the address bar is `/`, because `/i/`
  with no code is a door with nothing behind it and a reload has to arrive somewhere real. This is
  `replaceState` rather than a navigation, so the game itself carries on untouched. The parameter is
  dropped by string surgery rather than by `searchParams.delete` +
  `url.search`: re-encoding the query rewrites the parameters it was not asked about, and
  `?showcase` comes back as `?showcase=`.
- **A link outranks a stale reclaim, unless they name the same table.** A record naming another room
  is cleared, because following a link is a fresh intent and the tab would otherwise be sent back
  where it was last. A record naming *this* room is left alone: that is a seat to reclaim, which is
  strictly better than a seat to take.
- **A link carries a table, never a player.** So `App` sends `join_room` on its own only when this
  browser already remembers a name (`nicknameMemory`), and otherwise hands the lobby the join form
  with the code filled and the caret on the name. A remembered name the client can already tell is
  refusable counts as no name at all — better the field than a round trip whose only outcome is an
  error over a form nobody filled in. The invite is spent whether or not it ends in a join, so
  leaving that table lands on an ordinary lobby and not back at its door.
- **The lobby is keyed on its entry point alone.** Spending the invite must not change `<Lobby />`'s
  key: a remount would take the prefilled code back out from under the player mid-typing.

## The host's controls over a row
`WaitingRoom.svelte` puts one ⋯ button on every roster row but the host's own, and
`RosterRowMenu.svelte` is what it opens: hand the table over (`transfer_host`), remove from the table
(`kick_player`). Guests render neither, on any row.

- **Never on seat 0.** The way out of your own seat is the quit link at the bottom, which asks first.
  A control that could take seat 0 would hand the table away through a button that says nothing of
  the sort, and it sits two pixels from every other row's.
- **One button, not two icons.** The two presses are not the same kind of thing — handing the table
  over is routine, taking somebody's seat is not — and a roster row carrying both in the open is a
  dense row with a destructive target on it, at phone widths, next to the row above. The ⋯ is one
  44px target and the panel is where the two are told apart.
- **Both ask, and the question takes the menu's place.** The kick used to ask nothing, on the
  argument that it costs nothing to undo — which is still true, and is no longer the point: two items
  in one menu where one fires on the press and the other does not is a menu that has to be read
  twice. The question is the same move the quit link makes below the roster: it lands where the
  finger already is, and nothing else on the screen shifts. It **names the row**, because on a phone
  the sheet covers the roster it was opened from.
- **Escape backs out one step at a time** (`escapeKey`, like every other dismissible surface):
  the question first, then the menu. `pointerdown` outside the row shuts it, scoped to the row so the
  ⋯ keeps working as a toggle.
- **Right-click opens the same menu, and is never the only way in.** It is a shortcut for whoever
  reaches for one; a control nothing announces is a control nobody finds. `preventDefault` is what
  makes it one — the browser's own menu over a roster row offers nothing this screen means.
- **Below 46rem the dropdown is a bottom sheet with a scrim**, at the same row heights as the
  preferences and audio sheets: same thumb, same reach. A 244px panel hanging off a roster row is a
  desktop object; on a phone it opens under the finger that summoned it and half of it is off the
  side. The scrim exists only there — above that width a full-screen veil over a two-item list would
  be the heaviest thing on the page.
- **A bot's row carries the kick and not the transfer.** There is no other way to take a bot's seat
  back, and a roster with the kick on every row except those would be lying about which of them the
  host owns. The transfer is absent because the server refuses it: a table handed to a bot can never
  deal. **`is_bot` rides the roster** for exactly this — `Bot1` is a nickname a player is allowed to
  take, so the name is not a way to tell.
- **The removed player is told, and it lands where every refusal lands.** `kicked` resets the store
  like `left_room` and then writes `removed by the host`, which `serverErrors.ts` resolves to
  `errors.kicked` under the lobby form. Order matters: `resetToHome` clears `errorMsg`.
- **`host_changed` is applied from the message, not re-derived** (`applyHostChange`). The server sends
  it per recipient carrying that client's own seat; `setPlayers` re-resolves `myIndex` from the
  nickname instead, which is right for a departure and one indirection too many for a swap the server
  has already resolved.

## The 1v1 queue on screen
Three screens: the home button, `<Searching />` and `<MatchFound />`. `screen: 'searching'` and
`screen: 'matchfound'` are screens rather than flags over the lobby, for the same reason `'restoring'`
is: there is no board to draw behind either of them.

- **The screen is entered optimistically.** `findMatch` sets `screen: 'searching'` and *then* sends
  `find_match`. The acknowledgement carries nothing (the server never says how long the queue is), so
  waiting a round trip would make the one button in the game with nothing behind it feel like the
  slowest. `matchmaking_queued` is only acted on when we are *not* already searching, which is the
  case the server can produce on its own: a pairing whose other half closed their tab during the
  reveal puts the survivor back in the queue unprompted.
- **`endSearch` is guarded on the screen.** A cancel that raced a pairing arrives after the seat does,
  and acting on it would drag a seated player out of a match about to be dealt.
- **The wait is timed locally, and the copy is staged off it** (`searchStage`: 0-15s, 15-45s, 45s+).
  None of the three things it says may imply the queue is empty. "Nobody is searching" reads as "close
  the tab", and it is self-fulfilling: the player who leaves on that sentence is the opponent the next
  one was about to get. So the third stage says the honest thing, that this can take a while, stay here,
  you get the next arrival, and adds the one alternative that needs a friend rather than a stranger:
  open a private table. `matchmaking.test.ts` asserts none of the copy can name a number.
- The empty chair opposite is drawn as an empty chair. A spinner would be a smaller promise than the
  truth.
- **The searching screen carries the same top bar as every other screen.** It is the longest single
  screen in the game, and turning the music down or reading the rules is exactly what somebody does
  while queueing. It was the one screen without the row.
- **Being found reaches a player who is not looking, two ways, and both are deliberately bounded.**
  `soundsForTransition` plays `matchFound` on the transition into `screen: 'matchfound'` (stacked
  fifths rather than the thirds every other cue uses: nothing has been *won*, somebody has arrived),
  and `tabAlert` alternates the browser tab's title with `t.matchFoundTab`. The alert **only ever
  arms while the tab is hidden**, and coming back disarms it and restores the real title on the spot,
  never re-arming: a title blinking under the player's eyes says nothing the screen does not, and one
  still blinking after they came back is a bug they can only fix by reloading. `tabAlert.test.ts`
  pins both rules. The two are a pair rather than a redundancy: a backgrounded tab is exactly where a
  mobile browser has parked the AudioContext, so the sound covers the player who is on the page and
  the title covers the one who is not.
- **The reveal counts down but decides nothing.** `starts_in_ms` sizes the counter; the match starts
  when `game_started` lands. A counter that reaches zero first holds on "dealing", which is the right
  behaviour for a screen whose server is the one deciding.
- **A forfeit never renders as a victory.** `<GameOver />` with `forfeitBy` set drops the confetti and
  the trophy and says what happened, on both sides: the player who left is told they left. The
  rematch button stays where it is and goes grey rather than disappearing: a reaction game does not
  reflow its buttons, and the state being shown is "there is nobody to agree with", which is a state
  and not an absence.
- **Which side of it we are on is answered once, when `match_end` lands** (`store.forfeitedByMe`,
  read by `<GameOver />` instead of `forfeitBy === mySeat`). A forfeit is the one match end that
  moves the seats it has just named: the leaver is taken out of the roster and everybody above them
  re-bases, `setPlayers` re-resolves `myIndex` from our own nickname, and a table of two whose *host*
  walks out therefore hands seat 0 — the seat `forfeitBy` names — to the player who stayed. The
  screen then told the winner they had walked out, with the leaver's column under their name in the
  recap. Both halves of the fix are the same rule: **a seat is an index, and an index is only true
  for as long as the roster it indexes.** So the boolean is taken while the message is the newest
  thing on the wire, and the recap is re-sent by the server on the `player_left` that moved it
  (`setMatchHistory`) rather than re-derived here.
- **The rematch button has three states, and the middle one is the point.** Ask, wait, accept, at
  every table and for every seat: `rematchOffers` and `rematchNeeded` come straight off
  `rematch_offered`, and the button reads "they want another, go" once somebody else has asked first,
  because an ask nobody can see is an ask nobody answers. Past two seats the wait is on the table
  rather than on one named opponent, and the button carries `x/y`; at two the count is noise. **How
  big the table is comes off the roster, never off `rematchNeeded`**: two asks deal the next match at
  any size (server `RematchQuorum`), so the quorum stopped being able to say how many seats there
  are the moment it stopped counting them — a four-player game over read as a 1v1 for exactly as long
  as that line kept asking the quorum.
  `player_left` clears the pair, and the server republishes right behind it in every room that still
  has an agreement to publish.
- **The asks are per match, so the deal spends them** (`applyRematch`, beside `applyMatchFound`,
  which was already doing it). They are the one piece of game-over state that survives into the
  match it dealt if nothing drops it, and the seat it strands is the one that pressed the button:
  our own ask still in `rematchOffers` makes `iOffered` true at the *next* game over, so that screen
  opens on a disabled button waiting on an opponent who was never asked — and there is no ask left
  to send, because as far as the client is concerned it is already ours. A private table with a bot
  reaches it in one press, since the quorum there is one. The server clears its half in
  `table.resetForNextMatch`, which is why nothing on the wire contradicted the button: the ask it
  was waiting on genuinely did not exist.
- **A matchmade table with nobody left at it requeues by itself** (the effect in `App.svelte`,
  `rematchRequeue.test.ts`). The ask cannot complete, the only other thing on the screen is the
  queue, and making the player press it is asking them to confirm the only remaining option.
  Cancelling the search is how they leave. Ordinary tables are left alone: there is a room, a code
  and a lobby to reopen, and nobody there queued for a stranger.
- **The same requeue, pressed, is the `searchAgain` button** (`rematchRequeue.test.ts`, and the E2E
  that watches the seat come free). The offer is the *search*, not the opponent — who turns up is the
  queue's to say and the label must not promise a name, which is why "find another opponent" became
  "Search again" / "Relancer". It stays **one message**: `find_match` releases the seat server-side
  before it enqueues (`hub/matchmaking.go`), so a `leave_room` sent ahead of it buys nothing and costs
  the screen — its `left_room` runs `resetToHome`, which would reset the store out from under the
  search we just opened.
- **Leaving is the quietest control on that card** (`.btnQuit`, under both offers): no outline, no
  fill, `--color-muted` and 44px of target under 13px of type. Two offers and an exit is three
  buttons, and only one of them is what somebody came back to this screen for; the exit competing
  with them is what put two queue buttons on it in the first place. It is an ordinary `leave_room` at
  every table, matchmade or not.
- `<OpponentAway />` is the only thing on the board that reads `opponentAway`, and the store only fills
  it when the server sent a `forfeit_deadline`, i.e. never in an ordinary room, where the seat is
  simply held and a countdown to losing would be a worse table. Its bar is a `drainBar` animation:
  a board frozen on somebody else's connection is exactly when the main thread must stay free.

## The count on the home screen
A small plate opposite the chip row, saying how many players are connected. `players_online` off the
wire, `store.playersOnline`, `components/playersOnline.ts` for the one rule about drawing it, and a
`role="status"` line in `Lobby.svelte` — nothing here is pressable and nothing here decides anything.

- **The floor is the whole design, and it is two.** One is "you are alone", and a plate saying it is
  the same sentence the searching screen is forbidden from writing, printed on the screen a visitor
  arrives on. So below two the plate is **absent**, not zeroed, not softened into "a few players":
  what is on screen is always exactly the number the server sent, and the floor decides whether the
  screen speaks at all. That is also why the threshold is the client's and not a server-side refusal
  to send — the number stays true, the screen decides what is worth drawing.
- **It is not the queue and must never be read as one.** The queue's size is nowhere on the wire and
  stays that way; this counts sockets, which answers "are the lights on" rather than "how long until
  I am paired". The copy says *connected* / *online*, never *searching* or *waiting*, for that
  reason: it names the state of a connection, which is what the number actually measures.
- **It is the home screen's and nowhere else's.** The server does not send it to a seated socket, so
  a match never pays for it, and the board has no room for a number nobody is playing against.
  `setPlayersOnline` is deliberately **not** in `resetToHome`'s reset: the count belongs to the
  socket rather than to the seat, and the screen a reset lands on is the one that draws it — clearing
  it would blank the plate on every return from a table until the server next had something to say,
  which on a quiet server is a while.
- **It reserves no layout.** `position: absolute`, like the chip row it faces: `/` is one viewport
  that never scrolls, and a status line taking a row would shift the wordmark lockup the moment the
  count crossed its floor. Under 46rem it moves to the **foot** of the screen, centred: that top line
  is spoken for at this width — the burger owns the left corner (`GamePage.astro` fixes it at these
  very offsets), the speaker and "How to play" own the right, and the plate landed straight across
  both — while a second row of chrome stacked under it would sit above the wordmark, which is the
  first thing on this screen anybody should read. The bottom is free there: the footer row is behind
  the burger at that width. It stays absolute, so it still reserves nothing and `/` still never
  scrolls. **Centred, it has to be sized with `width: max-content`**: an absolutely positioned box
  anchored at `left: 50%` is offered the half of the line it starts at, and the count wrapped onto a
  second row inside its own plate.
- The dot beside it is decoration: the words already say what it means, so no shape is owed to colour
  assist. `playersOnline.test.ts` pins the floor, the unrounded number and the survival across a reset.

## Protocol validation (client)

**Both type files are generated. Neither is edited.** `client/src/types/protocol.ts` and
`client/src/types/protocolSchemas.ts` come out of `server/cmd/protocolgen`, which reads
`server/protocol/`. Change the Go, run `make protocol`, commit both. `protocol_check` in CI
regenerates and fails on any difference, so a hand edit is undone by the next run rather than merged.

The wire used to be described three times: the Go structs, a hand-written TypeScript file, and a
hand-written file of schemas. Nothing checked that the three agreed, and the failure is silent by
construction. That is the same shape as the mirrors this repository already pins by test
(`serverMirrors.test.ts` for the nickname's shape and the table code's alphabet); the difference is
that a mirror can be pinned and a copy can be deleted, and these two were copies.

- `webSocket` runs `v.safeParse(serverMsgSchema, …)` on every payload. Dev: invalid → log and
  drop, which is what surfaces drift in tests. Prod: log and pass through, so one new server field
  cannot take the client offline.
- **The generator refuses rather than guesses.** An unknown type, a slice of pointers, or a const
  block out of step with its `All*` slice stops the build. Each of those has exactly one dishonest
  TypeScript spelling available, and every one of them type-checks: emitting `unknown` for a type it
  cannot read would mean the client silently stopped reading a field. `cmd/protocolgen/main_test.go`
  covers the refusals, because the happy path is already covered from the other end by
  `protocol_check` plus every client test that runs against the committed output.
- **`ClientMsg` and `ServerMsg` are marked `//protocolgen:envelope`**, which makes every field but
  `type` optional on the client. They are one flat struct standing in for thirty message types, and
  `turn` and `drawn_count` carry no `omitempty` because a zero is a real value there. Mirroring that
  literally would generate a validator that refuses every message not about a turn, which is the
  client being stricter than the server: the direction nothing answers.
- **The wire enums live in `server/protocol/enums.go`** rather than as bare `string` fields, because
  a `string` in Go generates a `string` in TypeScript and would have thrown away a narrowing the
  hand-written client always had. `enums_test.go` pins them to `game.Color.String()`,
  `game.Kind.String()` and the formats `Room.SetFormat` accepts, by walking the domain rather than
  listing it: a hand-written list there would be a third copy and would go on passing.

**Valibot, not Zod.** Zod 4 JIT-compiles each schema with `Function()` the first time it runs; under
`script-src 'self'` the call is refused, Zod catches the throw and interprets instead, so the game
works and reports a `securitypolicyviolation` on every page load, indistinguishable from a real one.
That was answered with `z.config({ jitless: true })` and a test pinning the flag, which tested the
workaround rather than the property. Valibot has no such path, and `csp.test.ts` now asserts the
property directly: it runs a real validation with `Function` behind a recording Proxy and fails if
anything reaches for it. That test would have caught Zod, which the flag pin could not have.

Worth keeping: `csp.test.ts` scans *our* sources, and a dependency is under no obligation to appear
in them. Only `make csp`, the built client behind the real nginx in a real browser, found the Zod
problem. That is the standing argument for running it after a dependency bump and not only after an
`nginx.conf` edit.

### Nothing continuous goes through reactive state
A value that changes every frame must never be a `$state` the board hangs off.
`<GameView />` owns the whole match screen, and a write per frame re-derives whatever
reads it — seat layout, hand slots, pile positions — sixty times a second. Svelte's
granularity narrows the blast radius compared to a re-render; it does not make the
write free, and it does not help at all when the value feeds a `$derived` the board
reads.

- **Countdown bars use `drainBar`, not a percentage in state.** The bar is handed a
  CSS animation whose duration is the window and whose *negative* delay is the part
  already elapsed (`--drain-ms` / `--drain-delay`, keyframes `loco-drain` +
  `loco-drain-heat` in `tokens.css`). The browser then drains it on the compositor:
  zero JS per frame, zero framework work, and the bar stays smooth while the main
  thread is dealing a hand. This replaced a `requestAnimationFrame` → state loop that
  re-rendered the entire board for the whole 30-second turn *and* the 5-second catch
  window, i.e. exactly during the two moments the game asks for a fast reaction.
- It drains by `scaleX`, never `width`: width lays out the page every frame.
- The colour is a second readout of the same clock (`loco-heat`), so no timer or state
  is needed to change it. The 5s catch bar opts out: five seconds cannot show a trend.
- **A countdown bar survives `prefers-reduced-motion`.** The blanket 0.01ms rule at the
  end of `tokens.css` has an explicit exception for `.loco-draining`: the bar is the
  only place the remaining time is written down, and a player who asked for less motion
  still has to know their turn is about to be auto-passed. Same principle as `.armed`
  degrading to a static halo rather than to nothing.
- **`drainBar`'s own effect must not re-arm while the window runs down.** Arming is two
  `setProperty` calls; anything that re-runs the effect writes them again and restarts
  the animation from the top, which reads as a bar that jumps back. Every argument it
  takes is an accessor for that reason — it is called once, during setup, and has to
  keep seeing the current node and the current deadline without being called again.
  `drainBar.test.ts` watches those two calls across twenty seconds of fake time.

## A deploy, from the player's seat
- `server_updating` sets `serverUpdating` in the store, and `<ServerUpdating />` renders a line of
  text. That is the entire client side of the graceful shutdown, and the smallness is the point: the
  server drains, the match plays to its end, and if the process is replaced before the last card the
  restart costs the one-second reconnect the client already does on its own. **No new screen was
  needed** because a restart is indistinguishable from a dropped socket, which
  `sessionPersistence` + `getReconnectMsg` have handled since they were written.
- It is the quietest thing on the board on purpose. Everything else that appears over the felt is
  either a deadline (OpponentAway, the turn bar, the catch window) or a moment (InterruptBanner,
  CatchBanner) and all of them are asking for something. This asks for nothing: no countdown, no
  colour from the alert ramp, no blinking dot, nothing disabled. A player who ignores it entirely
  loses nothing, which is what it is telling them.
- It exists at all because a board that quietly changes behaviour is worse than one that says so:
  during a drain the rematch button stops working, and with no line of text that reads as a bug.
- **Two screens beyond the board carry it**, since the server stopped gating the notice on
  `StatusPlaying`: the waiting room and the game-over card, through `<ServerUpdating variant="card" />`
  — static in the flow rather than absolute, and with copy that says what a deploy actually costs
  those two (the deal is paused) instead of promising a match that is not running. Both used to find
  out by pressing their one button and being refused.
- **Two slots, not one.** Wide: the top chrome row, in the gap between the round pill and the icon
  row. Narrow: that gap does not exist, so it drops under the chrome and steps down again when
  OpponentAway is using the slot. The obvious placement (the OpponentAway slot at both widths) put a
  *permanent* pill on top of the top-centre seat pod, hiding an opponent's card count for as long as
  the drain lasted. A transient countdown may cover that pod; a notice that can sit there for a
  fifteen-minute drain may not.
- `serverUpdating` is cleared on `player_reconnected`, because the process answering may be the new
  one. If it is draining too, it re-sends `server_updating` right after.
- The refusal side is ordinary `serverErrors.ts` work: `server updating` maps to `serverUpdating`.
  The one thing that matters is that it must never fall through to `roomNotFound`, which is what a
  `join_room` during a deploy used to produce: "Aucune table avec ce code" for a code that was real.

## Reconnect visual recovery
- On `player_reconnected`: store `isReconnecting:true` before applying state.
- `reconnectAnimation(isReconnecting, onComplete)` shows "Rebuilding table…" overlay for 600ms then calls onComplete (which clears `isReconnecting`).
- `<GameBoard />` hides its children while reconnecting; on the false→true→false transition it bumps an internal `rebuildKey`, replaying a 350ms board fade-in CSS keyframe.
- Visual only; server is authoritative.
- **Nothing but that timer ends the overlay, so nothing may be allowed to swallow it.** The hook used
  to hold a "have I played this already?" guard outside the effect, and that guard outlived the timer
  it guarded. A reload mounts the board with `isReconnecting` already true, so the effect runs for the
  first time *on mount* — and back then the dev tooling ran mount effects twice. The first pass set
  the guard and armed the timer, the cleanup cleared the timer, and the second pass returned early on
  the guard without arming another. The seat was reclaimed correctly and the board was live
  underneath, but the card sat over it saying "setting the table back up" for the rest of the match,
  and `isReconnecting` was never cleared so the fade-in never played. The effect re-runs only when
  `isReconnecting` actually changes, so re-arming on every run is the whole guard needed, and a
  reconnect that resolves early now takes the overlay down with it instead of leaving it on a
  cancelled timeout. It was invisible to the store-level tests by construction: every assertion about
  the seat, the hand and the discard passed. `reconnectAnimation.test.ts` covers both shapes —
  arriving already true, and going false before the timer — and the reload E2E asserts the overlay is
  gone rather than only that the state came back.

## Leaving a match, and what it costs the others
The board carries one way out, drawn at every table: a chip in the top-right chrome row, never on the
action bar (that bar is a fixed three-column grid a reaction is aimed at, and it must not grow a
fourth control). It asks first, in place, and the question is two lines rather than one.

**The second line is the whole feature.** "Leave the match?" is a question the player can already
answer; what they cannot see from their own screen is what leaving does to everybody else, and that
is different at each of the four tables this game has. So `leaveNote` picks one of four strings —
the bot minds nothing, a stranger is handed the match, a table of four keeps playing without the
seat, a table of two ends where it stands and goes to whoever stayed — and the count behind it is the
server's own (`Hub.canWalkOut`, `WalkOutFloor`): a seat counts while it is a bot, or a human whose
hold has not run out. If the two ever disagree the server still decides; what is at stake in the
client is the wording, not the permission.

**Nothing is greyed out here.** A player who has to go is going either way, and the alternative exit
is the turn clock auto-passing for an empty chair until the AFK threshold — two rounds spoiled for
everybody else rather than one player leaving. A disabled way out only ever produced a closed tab.

**And the table is told, by name** (`departureNotice`, the pill above the swap notice's). A departure
mid-match moves the turn, puts a hand back into the deck and takes a chair out of the order, and
until this notice the only sign of it was a bubble going quiet: held and gone read identically in the
roster. It rides `noteSeatGone`, so it is idempotent with the seat record — a repeat says nothing new
and must not put the banner back up over a board the table has moved on from — and it covers both
departures, the walk-out and the hold that ran out, because to everybody else they are the same news.

### The curtain underneath it
Every other seat's hold has expired, so the clock draws and passes for empty chairs until the round
runs out and nothing on this board will ever move again. The chip alone would be enough now that
leaving is never refused, but the state still deserves saying out loud rather than leaving the player
to work out that the table is empty.

- **Held and gone read identically in the roster.** Both are `connected: false`, and only one of them
  can come back — so the difference is remembered rather than derived. `goneSeats` is written by
  `player_left`, and the server names a seat on exactly one of those: the mid-match expiry, the only
  departure that cannot re-base anybody (a running match indexes hands by the seat, so nothing moves).
  Every other `player_left` carries no index and adds nothing here, which is correct — after a lobby
  departure the number would name somebody else.
- **The client's question and the server's are the same question.** `tableAbandoned` in `GameView` and
  `table.abandonedBy` in the hub both mean "every other seat is a human who cannot come back", and the
  hub answers it the same way: the seat goes and the table goes with it, with no forfeit, because
  there is nobody to award the match to.
- **It is a curtain, not a button on the bar.** The bar is fixed three columns and never reflows
  mid-match; the board stays visible underneath, because it is still the match that was being played.
- **It waits behind the two reconnect curtains.** Our own socket being down is the more urgent
  problem and may be the whole reason nobody has been heard from. One curtain at a time.
- `tableAbandoned.test.ts` owns all four cases, including the one that matters most: nothing is
  offered while the other seat is merely disconnected.

## The evening's recap, on a phone
The server's half of `table.matchHistory` is in
[`domain-rules.md`](domain-rules.md); this is the grid the game-over card draws it as, and every
decision in it comes from the same measurement: the card is 380px wide, so on a 360px phone the
scroller inside the recap panel is **244px**, and four matches × four seats has to live in it.

**The two columns that answer the question are pinned** (`.recapName` and `.recapTotal`, `position:
sticky` left and right). The block exists because a rematch nils the scoreboard and nobody could say
who had won the evening; the column that says so is the last one, and the last one is precisely what
a table wide enough to scroll carries off the right edge of a phone. Pinned, the matches scroll
*between* who and how many, and the conclusion is on screen at every scroll position. The pinned
edges are drawn as borders on the cells, and the table is `border-collapse: **separate**` for that
reason alone: a collapsed border belongs to the pair of cells that share it, so the rule marking the
pinned right-hand column stayed behind with the column it was collapsed against and never moved.

**Three things were each sizing the grid on something other than its numbers, and all three cost
about the same.** The head was `Match %n` — 55px of label over 34px of data, four times over. The
rounds and the points sat side by side, 62px a column. And the head was set at 10px, under the 11px
floor, which bought back nothing because the label was still the widest thing in the column. The
head is `M%n` now, which is the score table's own convention for exactly this (`scoreTableRoundCol`
is `R%n`/`M%n`); the points sit under the rounds rather than beside them, which also puts the two
numbers in the order they are read — what was won, then what it was won by; and the head is 11px.
The grid came from 335px to fitting a four-match evening whole.

**The seat that took a match is a gold pill, not a red digit.** `--color-primary` on
`--color-surface-strong` measures 2.9:1, so a 14px number in it failed AA outright — but the reason
to change it is that the scoreboard directly above wins in gold, and a spectator does not pick a
recoloured digit out of a grid at 720p. A filled body with an outline is the same information as a
shape, which is also what colour assist asks of anything meaning something by hue.

## The round the format did not plan for
The server's half is in [`domain-rules.md`](domain-rules.md): a match is settled on rounds won, then
points, then the smallest lost-hand total, and when that chain separates nobody `determineMatchWinner`
returns `""`, the match keeps running and one more round is dealt. This is what that reaches the
player as.

**It cost nothing to get wrong and it was wrong at the worst moment of the evening.** A BO3 that goes
to a fourth round drew `Round 4 · BO3` on the board and `Round 4 of 3 down` on the summary card — a
counter that has come loose, at the one point in a match where the player most needs to be told why
the game-over screen did not come. Nothing anywhere said the round they were about to play was for
the match.

**So the round beyond the format has no number, it has a name.** `decisiveRound` replaces the whole
chip (`roundNumber > formatRounds(matchFormat)`, `matchLengthModel.ts` — the third copy of that
switch is gone with it) and replaces the summary card's title the same way. The chip goes gold, the
hue the scoreboard and the recap already win in: `--color-primary` is 3.43:1 under white and the chip
is 13px, so the accent could not be the red, and a spectator has to be able to tell this round from
an ordinary one at 720p without reading it.

**The card announces the *next* round, and the condition for that is not "the format ran out".** It
is the format having run out with the match still running — `roundNumber >= matchRoundsNeeded &&
!matchOverPending`, where `matchOverPending` is `pendingMatchEnd !== null`, the match-end payload the
store buffers behind the summary so the player sees the round breakdown before the game-over screen.
The last round of a settled BO3 and the last round of a tied one are the same number and the opposite
answer.

**That band fades in on a 0.35s delay, and the delay is the mechanism rather than the polish.**
`round_ended` and `match_end` are two messages: the card is composed and can be painted before the
second one lands, so without the delay an ordinary final round announces a decisive round for a frame
and then takes it back. The delay survives reduced motion for the same reason (the duration goes, the
delay does not) — it is not decoration, it is what stops the false announcement. `decisiveRound.test.ts`
owns both halves, and the case that fails without any of this is the fourth: a finished decisive round
titled `Round 4 of 3`.

**What the band must not say is who the extra round crowns.** The winner of a decisive round is not
automatically the match winner: past two seats a third player taking it can leave the two who were
level still level on rounds, and the chain reruns. So the copy says what is true — nothing separates
the table, one more round — and lets the scoreboard answer the rest.

## i18n
- `client/src/i18n/en.ts` (source of truth) + `fr.ts`. `Translations` interface in `en.ts` reused as type — missing keys = TS error.
- `initI18n()` (`client/src/i18n/store.ts`) wraps app in `entry.ts`. `i18n` → `{ lang, t, setLang }`.
- Detect order (`chooseLang` in `src/lang.ts`, the one definition): `localStorage('loco_lang')` →
  `navigator.language` **but only on a document served as the default language or as none at all** →
  `data-served-lang` on `<html>`. `detectLang` in the store is that function read against the DOM.
- `setLang` persists to localStorage + syncs `document.documentElement.lang`.
- Add language: create `xx.ts` impl `Translations`, add to `translations` map in `store.ts`, add `{code, label}` to `LANGS` in `LanguageSwitcher.svelte` — **the label is the autonym, untranslated** — **and to `LANGS`/`HOME_PATH` in `src/lang.ts`**.
- The chooser is no longer mounted bare: it renders inside the preferences panel (below), as a
  dropdown rather than a segmented pair. The pick applies itself on every screen.
- `rules`: `readonly RulesSection[]` rendered by `RulesModal`.
- Storage key and home paths: `src/lang.ts`, not the provider — see below.

### One document, one language

The key, the pair of languages and the two home paths live in `src/lang.ts`, free of any framework, for the
reason `theme.ts` exists: the content pages take part in this decision and mount nothing at all.

The bug that produced it. A stored choice outranks the URL in `detectLang`, and half of `/` is markup
Astro built per URL — the footer row, the drawer, the sheet of prose — which no in-app state rewrites.
So `/` opened with French stored rendered the game in French under a footer reading "With friends",
having rewritten `<html lang>` to `fr`: a document declaring itself French while half its text was
English, which is a lie to a screen reader before it is anything else.

The first answer was a navigation: `location.replace` to the other language's URL, before anything
else booted. It worked, and it cost two things. A round trip on the page the game is played from, and
a redirect on the site's canonical English URL — which is the pattern Google names when it asks sites
not to redirect on a visitor's presumed language, and which is why the arrival could never be
answered for a *browser* setting, only for a stored choice.

**The served half speaks both languages now.** Every string and every link `GamePage.astro` and
`HomeProse.astro` render per language also carries its counterpart in `data-alt`, `data-alt-href` and
`data-alt-aria`; `<html>` carries `data-alt-title`. `src/langSwap.ts` walks those attributes,
exchanges them, and moves the address bar with `history.replaceState`. `initLang()` is the three
lines that decide and apply it, first thing in `boot()`.

Five properties are what make it safe:

- **The copy lives in the markup, never in the bundle.** The obvious implementation imports
  `content/ui.ts` and `seo/meta.ts` and rebuilds the footer from them: 240 lines of bilingual copy
  for pages the player is not on, plus the registry of every page on the site, downloaded by everyone
  to translate a footer most never open. `lang.ts` already refuses the second import for that reason.
  Carrying the alternative in the HTML costs about a kilobyte on one page and the bundle nothing —
  and it makes the swap total by construction, since there is no key list here to fall out of step
  with the layout. `homeLangSwap.test.ts` fails when the layout renders more than it marks.
- **The links are the half that matters.** A label left in English is a wart; a footer link left
  pointing at `/rules/` sends a French visitor to a static page that mounts nothing and cannot
  correct itself. There is no second chance on that one, which is why the test counts `href={` against
  `data-alt-href={` rather than trusting a review.
- **A detection is never persisted.** The browser's language is re-read on every boot and gives the
  same answer, so storing it buys nothing — and it would cost the case it exists to protect: a stored
  value is a *choice*, and a choice outranks the URL, so the next French link that player was sent
  would open in English for good. `rememberLang` stays the two switches' to call.
- **The browser only ever wins on the default URL.** `/` is where somebody lands without saying
  anything; `/fr/` is somebody having asked. `chooseLang` is pure and is tested exhaustively over
  both languages, every stored value and several browser settings: whatever it decides for a
  document, it decides again for the document at the URL that answer names, so a reload never sits
  between two languages.
- **It runs before `initTableInvite()`, and it carries the query string and the fragment.** That one
  spends the invitation out of the address bar and this one rewrites the address bar; in this order
  neither loses anything to the other. `replaceState`, never `pushState`: Back must not point at a
  URL that would send the player straight here again. An invitation is untouched either way — `/i/`
  is served with no `data-served-lang`, which `langUrl` reads as nothing to disagree with, and
  `chrome={false}` leaves that document with no served copy in it at all.

What the swap deliberately does **not** touch is `data-served-lang`. It says what the page was
*built* as, which stays true, and it is what a reload hands back — `detectLang` reads it, so a swap
that rewrote it would make the app detect its own output.

**The document at the new URL is real.** That is the property the whole arrangement rests on: `/fr/`
is a page Astro built, so reloading serves it, sharing the link hands it over, and the swap is only
ever a shortcut to a document that exists. A crawler asking for `/` still gets the English page, with
its own canonical and its `hreflang` pair intact.

The other half is the content pages' globe. Its two links stay real `<a href>`s — the href is what
makes an `hreflang` pair navigable and a crawler follows nothing else — and `theme-boot.ts` adds one
delegated listener that records the choice on the way out. Without it the choice reached the pages
and never the game: a reader who switched to French, read the rules and pressed "Jouer" arrived at
`/fr/` with English still stored, and the stored choice won. The theme has worked this way since it
was split out (`THEME_STORAGE_KEY`, one key, both halves); the language now does too.

## Preferences
`Preferences.svelte` is the gear in the top bar of the lobby, the waiting room, the reconnect splash and
the board. It holds the language chooser (`LanguageSwitcher`, a child), the theme, and three
switches: streamer mode, colour shapes, reduced motion.

- **The language is a dropdown, and the pick is the application — on every screen.** The theme below
  it is a segmented pair applied on the press, which is right for a setting that changes the screen
  in place, and the language is now exactly that setting: `setLang` swaps the game's strings and
  records the choice, `swapServedLang` takes the half Astro served and the address bar with it.

  It used to be two steps at the entry screen, and the reason is worth keeping. Applying there *left
  the page* — half of `/` is markup built per URL — and a control that reloads must not fire on the
  press that was aiming for it: a thumb sliding across a segmented pair on a phone hit a language and
  lost the page it was reading. So the choice was made first and spent second, on a real `<a href>`,
  under a sentence promising the reload. Nothing reloads any more, so the button protected nothing
  and the sentence had become false; both are gone, along with `prefsApply` and `prefsLanguageHint`.
  **If a language ever costs the page again, the button comes back with it** — that is the rule, not
  the button.

  The dropdown lists autonyms (`English`, `Français`), never translated and never `EN`/`FR`: it is
  read by somebody who cannot read the language currently on screen.
- **The list is ours, and that is the point.** This was a `<select>`, which is two objects: the
  closed control, ours to draw, and the open list, painted by the platform. `appearance: none`
  reaches the first and nothing else, so a panel of ink outlines and hard shadows dropped a white
  system menu with a blue system highlight over a dark board — on the one screen a streamer is
  guaranteed to open, in a game whose whole art direction is that nothing is a system object. No CSS
  fixes that half: `color-scheme` only re-tints what the OS drew, and the shape, the radius, the
  outline and the checkmark stay the platform's.

  So it is a `<button role="combobox">` and a `<ul role="listbox">`, and the contract it replaces is
  kept whole rather than approximated. The button keeps the focus and every key: arrows move,
  Home/End jump, Enter picks, `aria-activedescendant` names the row, so no option ever takes focus
  and none has to give it back. Arrowing moves the highlight and picks nothing — a language may be
  arrowed *past*. The chosen one carries a checkmark and not only a tint, because "the pointer is
  here" and "this is the language you are reading" cannot be the same picture, and the pointer and
  the arrows share one highlight because two cursors on one list is two answers to "where am I".

  **Escape there closes the list and only the list.** The panel around it listens for that key on
  `document`, so the handler stops the event while the list is open and lets it through while it is
  shut: without that, backing out of a menu opened by mistake took every other setting off the screen
  with it. Same rule as `escapeKey`'s `enabled` getter, one level down. A press anywhere outside puts
  the list away, and Tab closes it on the way out rather than leaving it floating over the panel.

  Scene `lobby-prefs-lang` exists because this state had no screenshot before: the open list was
  drawn by the OS, so `make visual` could not have caught it going wrong. Worth the `small` viewport
  too — there the rows are 46px in a sheet, not 40px in a 292px dropdown.
- **Why a panel.** Language and theme sat bare in the top bar, which is right for one or two
  preferences. The row also carries sound and rules; one more bare control makes it a settings strip,
  and the one after that makes it unreadable on a phone. The gear replaced the theme chip rather than
  being added beside it, so the cluster is the same size it was.
- **The chip is a drawn SVG**, like `RulesButton`. A `⚙` font character renders as a different object
  on every platform, and the first attempt here (a small circle with eight long spokes) read as a
  sun, which in a row that used to toggle the theme is the wrong word entirely. Teeth are short thick
  stubs on a large ring.
- **The on/off preferences share one store factory** (`hooks/prefStore.ts`). Three copies of the same
  subscribe/persist boilerplate is how they drift.
- **Streamer mode blurs the table code.** Six characters read off a stream is an open table, and the
  waiting room — the one screen a streamer is guaranteed to sit on while friends join — prints them
  at display size. `streamerMode.ts` (`localStorage`, key `loco_streamer_mode`) is a module store,
  not store or context state: the flag is read by two screens with no common parent and written from
  a third, and it must survive a reload with no round trip.
- **The host's copy of that flag is the table's, and it is the one preference in this client that
  leaves it.** A table code is a single string shared by everybody who can see it: a host streaming
  their own screen is exposed by the friend who joined and left the waiting room up on a second
  monitor, and by the seat that reads the code out. Blurring only the host's copy protects the one
  screen that was already being careful. So `hostStreamerSync` (`hooks/appEffects.svelte.ts`) sends
  `set_streamer_mode`, the server keeps one answer per table and broadcasts it, and the client keeps
  it in `store.tableStreamer`, **ORed** with the local preference and never merged into it — a guest
  who wants the code hidden for their own stream must not be uncovered by the host stopping theirs.
  - **Two moments send, and a change of seat is not one of them.** The preference moved at a table we
    host, or we opened a table with it already on (the host who set it yesterday). `transfer_host`
    hands seat 0 to somebody whose own switch is probably off, and treating that as an instruction
    would uncover the code for a host still sitting there with it on camera. Their switch is theirs
    to touch.
  - **Nothing consults `store.tableStreamer` before sending.** It would swallow the ask that changes
    nothing, and with it the retry after one that never landed; the server answers a repeat with
    silence, which is the cheaper place to put that.
  - **Hostless tables never send.** The server refuses the message there, and an error nobody asked
    for would land on the board mid-match. `tableStreamerMode.test.ts` pins all of it.
- **`TableCode.svelte` is the only way a screen prints the code.** The blur is a CSS filter over the
  real text, so the copy button still copies the real code and a screen reader still reads it out. A
  screen that renders `roomCode` directly leaks it the moment the mode is on, and nothing will fail
  loudly: go through `TableCode`.
- **There is no reveal, and the history of this line is why.** It started as "one hover away, reading
  the code out loud is a normal thing to want", and every version after that was a narrower guard on
  the same idea. `:focus` matched the mouse click that copies, so pressing the button uncovered the
  code and left it uncovered until the next click landed elsewhere. A touch screen, which has no
  hover, emulates one on tap and leaves it stuck on the element, so a tap to copy did the same — that
  was guarded with `@media (hover: hover) and (pointer: fine)`, which only narrowed it to a mouse.
  And a mouse hover is the pointer resting on the plate, which on a waiting-room screen being
  captured is exactly where it already is. `:focus-visible` survived one revision longer and went the
  same way: the keyboard reach is deliberate, but the thing it uncovers is on camera either way.
  **So the blur has no state selector at all** — `preferences.test.ts` fails on `:hover`, on `:focus`
  and on a second `filter: none` — and the span is out of the tab order, since the only reason it was
  reachable was the reveal. **Sharing the table with the mode on is the link**, which the plate
  copies whole and which travels through chat rather than through the capture. A player who wants to
  read the code out loud turns the mode off.
- **The lobby's join field is deliberately not masked.** It holds what the player is typing, and a
  blurred input is a typo you cannot see. The leak there is the code the player already knows.
- **Both dropdowns are 292px, and the sizes inside them are a thumb's, not a cursor's.** They were
  250px and 230px, packed to the minimum that fit: 13px labels against their switches, hints wrapping
  to three lines, a 30px segmented option, a 10px slider track. The pointer manages all of that and
  nothing else does — and the panels open from one row at the top right, so two widths made the
  cluster change shape between one press and the next. One width now, `--space-base` of padding, and
  every control sized to be pressed: switch rows 50px, segmented options 38px, the language control
  and its rows 42px and 40px, the slider track 14px under a 26px thumb, labels 14px and hints 12px.
  The sheet's own sizes below are unchanged — this closed the gap from underneath.
- **A section is told apart by space, not by a line drawn across the panel.** The mixer separated its
  sliders from the music bed with a 2px ink rule, inside a card that already carries a 3px ink
  outline: it read as the panel having been cut in half, and it was the loudest thing in a surface
  whose job is to be quiet. It is gone. The gap above the block and the micro-caps `.sectionLabel`
  heading — the same treatment as the panel title — do the grouping, and the track still sits in its
  own recessed card. Anything new in either panel groups the same way.
- **A panel that opens over a screen sets its own `text-align`, because that property inherits and
  `position` does not stop it.** The searching screen centres its column — it is a radar, a heading
  and two buttons stacked in the middle — and the rules modal opened from there arrived with every
  heading, every bullet and the deck's copy centred, while the same modal opened from the table read
  normally. Nothing was wrong with either component: the alignment simply belonged to whichever
  screen happened to be underneath. `.backdrop` in `RulesModal` and `.panel` in `Preferences` and
  `AudioSettings` all declare `text-align: left` for that reason. It is a one-line rule with no
  visible symptom on most screens, so it is pinned in source scans (`rulesModal.test.ts`,
  `preferences.test.ts`) rather than left to be noticed: jsdom applies no component styles, and a
  rendering test here would pass over any rule at all. **Anything new that opens over a screen takes
  the same line** — the alternative is an overlay that is a different panel depending on where it
  was opened from.
- **Below 46rem it is a sheet, not a dropdown, and on the lobby the gear stands down.** 292px of
  panel hanging off a 40px chip is a desktop object: four settings, two of them with a sentence
  under them, in a column narrower than the thumb that opened it. At that width it becomes what the
  rules already are — a sheet up from the bottom edge, scrim behind it, title and ✕ pinned while the
  settings scroll. The breakpoint is `content.css`'s, because that is where the burger's drawer takes
  over: on `/` the drawer's `Preferences` row is the way in, so `Lobby` passes
  `triggerBelowPhone={false}` and the chip goes. **Only the lobby may pass it.** The drawer lives in
  the footer `data-seated` hides, so from the waiting room onwards the gear is the only entry there
  is, at every width.
- **Two things about that sheet are worth not rediscovering.** The scrim **wraps** the panel rather
  than sitting beside it, which is what `RulesModal` does: as a sibling, "click outside" becomes an
  argument about z-index, and nested it is `target === currentTarget`, a fact about the DOM. And the
  ✕ needs `position: relative` — `.hit-target` positions its 44px pseudo-element absolutely, so
  without it the nearest positioned ancestor was the scrim and the button's touch area sat in the
  middle of the screen, eating every press aimed at a setting. The panel opened and could not be
  used. `tokens.css` states the requirement; this control is the one that forgot it.
- **The sound mixer changes shape at the same width, into the same thing.** It sits in the same row,
  it is opened by the same thumb, and it was the panel left behind: three sliders and a track card in
  a column too narrow for either, under a track a pointer was meant to grab. It is the sheet the
  preferences panel is now — same scrim wrapping the same `.panel`, same head with a title and a ✕,
  same `display: contents` trick keeping the dropdown untouched above the breakpoint — and it carries
  `audioClose` for that ✕, because below 46rem the speaker chip that opened it is behind the scrim and
  the ✕ is the entire pressable way out. `escapeClose.test.ts` owns both halves.
- **On a sheet the type is not the dropdown's.** 14px labels, 12px hints and a 26px switch are sized
  for a mouse on a 292px surface; at full-screen width they read as a dropdown that grew a scrim.
  Labels step to 15px, hints to 13px, the switch row to 56px, the language control and its rows to
  46px, the slider track to 16px with a 30px thumb — all of it inside the same `max-width: 46rem`
  block, in each component, so the two shapes stay one decision.
- **The drawer opens it by event.** `#navPrefs` is markup Astro rendered, outside `#root`, so
  `homeSheet.ts` closes the popover and dispatches `loco:preferences`; the mounted `<Preferences />`
  answers. Only one screen is mounted at a time, so only one panel opens. It also remembers what had
  the focus, because `hidePopover()` hands it back to the burger and closing the panel has to return
  it somewhere real.
- Showcase: `streamerMode`, `colorAssist`, `prefsOpen`, `langOpen` and `audioOpen` scene flags
  (`dev/scenes.ts`), scenes `waiting-streamer`, `lobby-prefs`, `lobby-prefs-lang`, `lobby-audio`,
  `card-sheet-assist` and `game-color-picker-assist`. `applyScene`
  resets both module stores so neither leaks into later captures.

## Colour assist
Colour is the rule in this game: a card is legal because it matches the pile. Red-green is the most
common colour-vision deficiency there is, and the four suits are separated in luminance as well as
hue for that reason, but "survives" is not "reads".

- **`SUIT_SHAPE` (`cardTheme.ts`) is the vocabulary**: triangle (red), circle (yellow), square
  (green), diamond (blue). They differ at every corner count, which is the only property that
  survives a card overlapped down to a sliver. `SuitMark.svelte` draws them the way every card glyph is
  drawn: an ink pass under an off-white fill, because off-white on the green suit is 1.18:1 alone.
- **Three sites, and they are the whole set**: under the value on the card (top-left, the corner a
  fanned hand still shows), on each `ColorPicker` swatch (four discs that differ *only* in hue: the
  one control that is unusable without this), and inside the active-colour chip on the discard pile
  (after a wild, the only place the answer to "what can I play?" is written).
- **Never a letter.** `R` is red in both languages, `V` is `vert` in one and nothing in the other,
  and a rotated `B` is a `D`. **A wild has no suit** and gets no mark: inventing a fifth shape for it
  would say the opposite of what the card does.
- Off by default: the card face is the brand and this adds a mark to it.

## Reduced motion
The setting has three values (`auto` / `reduce` / `full`, `hooks/motionPref.ts`) and the UI shows
two, because `auto` is what the switch reads before it is ever touched.

- **`:root[data-motion="reduce"]` is the single source of truth in CSS**, written by `initMotion()`
  before the first paint. The media query is deliberately gone: it cannot be overridden, and a player
  whose system is set to reduce for reasons of their own is allowed to ask this game for its
  animations back. `reducedMotionCss.test.ts` fails on any new `@media (prefers-reduced-motion)`.
- There is no animation runtime left to hand the preference to: the attribute drives the stylesheet,
  and the two Web Animations shakes (`GameBoard.kickBoard`, `GameView.shakeScreen`) ask
  `prefersReducedMotion()` themselves before they animate anything. `motionPref.test.ts` pins the
  wiring — that `entry.ts` calls `initMotion()` at all, that a system asking for less motion reaches
  the attribute, and that an explicit answer wins over the system in both directions.
- The capture harness still works unchanged: Playwright emulates the media query, `initMotion` reads
  it, and the attribute lands before the first paint.

### The voice
The copy is the cheapest thing in the product and the first thing a player judges it by. A screen
that says "Waiting Room", "Create Room" and "Game Rules" is a website with cards on it; the same
screen saying "The table", "New table" and "How to play" is a game. Every string is written as
something a person at the table would say, and rewriting one means keeping it inside these rules.

- **The name is `LOCO!`, and the exclamation is a letter of it.** Not `LOCO`, and not `LOCO !` with
  a space in French — `Yahoo!` is the precedent, and nobody has ever written `Yahoo !`. The rule
  covers the wordmark, every `<title>`, the manifest, the favicon's `<title>`, the shipped licence
  file, the prose on the content pages and the call on the action bar alike.

  It was a discoverability decision before it was a typographic one. Bare, `loco` is a Spanish
  adjective and the name of a dozen other card games, so a search for it returns everything except
  this one and a streaming category named that way is a category nobody can find — which is exactly
  the question that came up when the game was submitted to IGDB for a Twitch category. Whole, the
  word is unambiguous.

  Two things it costs, both of them worth knowing before rewording anything. **A `<title>` is capped
  at 60 characters** and `seo.test.ts` holds that line, so the extra character comes out of the copy
  and not out of the ceiling — the French home title sits at 59 and has no room left. And **the name
  no longer composes with terminal punctuation**: `What is LOCO!?` reads as a typo before it reads as
  a question, so `homeSheetBtn` drops its question mark in both languages rather than stacking two
  marks. A comma behind it (`LOCO!,`) is fine and appears in `PAGES`; a second terminal mark is not.

  `src/test/vocabulary.test.ts` fails on a bare `LOCO` **or** a spaced `LOCO !` in `en.ts`, `fr.ts`,
  `UI`, `PAGES` and anywhere under `src/content/`, and pins the wordmark in all three places it is
  spelled — the `aria-label`, the `<span>`, and the two dark-theme `::before` blocks, because a
  rename that reaches only the markup leaves the dark repaint spelling the old name over the new one.
  Internal naming is untouched, exactly as for the rule below: `LOCO_MARK_PATH`,
  `LOCO_ALLOWED_ORIGINS`, `LOCO Red`, `locoMark.ts`.
- **One word per thing: a table is the seats, a room is the place.** A **table** is the group of
  seats a code is shared for — a player opens one, shares its code, takes a seat, leaves it. A
  **room** (French: *décor*) is one of the four places a match is dealt in, and nothing else.
  `lobby` is still banned outright, and so are `salle`, `salon` and `pièce`: they are
  venue-booking words that named both objects at different times.

  Three words for two things is what this replaced, and the navigation was the worst of it: an entry
  labelled **Tables** opened a page about the four *places*, so the one control whose job is to say
  which of the two you are about to read said the wrong one. The label is `Rooms` / `Les décors`
  now, the `<h1>` follows it, and **the path and the `<title>` deliberately do not** — `/tables/`
  carries the search value, and a URL is not copy. The store's internal names (`room_code` on the
  wire, `screen === 'waiting'`, `maps`, `mapPreload`) are unaffected for the same reason.
  `src/test/vocabulary.test.ts` fails on any of the three banned words in `fr.ts`, in `UI`, in
  `PAGES` or anywhere under `src/content/`, and it also asserts the positive half: having banned
  the synonyms, the page about the four places has to actually say *décor*.
- **French is tutoiement**, stated at the top of `fr.ts`. `vous` puts a service counter between the
  game and four friends on a sofa. It is a translation convention, not a per-string decision.
- **A button is a verb the player is about to perform**, in as few words as the control allows.
  `Deal`, `Take a seat`, `Next round`.
- **The rules opener says what it opens everywhere except at the table.** `RulesButton` has two
  variants and the screen picks one. In `GameView` it is `variant="icon"`: the top-right row there is
  a cluster of round chips, mid-match nobody is reading words, and a question mark is read faster at
  720p — `rulesBtn` (`Rules` / `Règles`) is its aria-label and its tooltip, never drawn. On the lobby,
  the waiting room and the search screen it is `variant="text"`, a pill drawing `rulesHowBtn`
  (`How to play` / `Comment jouer`): those screens are where somebody who has never played is
  deciding whether to, and a glyph makes them guess at what is the one piece of onboarding the game
  has. The pill keeps the chips' height, outline and shadow so the row still reads as one row, and
  **it carries no aria-label**: the visible word is the accessible name, and a label over it would
  give the control a name voice control cannot say.
  - `rulesHowBtn` and `rulesTitle` are deliberately the same words, so **the E2E suite scopes the
    modal's heading to its dialog** (`rulesModalTitle()` in `e2e/helpers/game.ts`). A bare
    `getByText(T.rulesTitle)` matches the opener too and resolves to two nodes under strict mode.
- **A refusal says what to do next, and never blames.** "Someone beat you to it", not "Too late" —
  the window closed because somebody else was faster, and that is information, not a scolding. One
  pill, read in under a second, no wire vocabulary (`interrupt`, `session`, `payload`).
- **The one destructive press asks, and the safe answer is a word.** Leaving the table is the only
  thing on that screen a player cannot undo (a guest loses the table code with the seat), so the
  link swaps itself for `Tu quittes la table ?` with `Rester` and `Oui, je pars`. The question takes
  the link's place instead of opening a modal over it: the answer lands where the finger already is
  and nothing else on the screen moves. `Rester` comes first and is the coloured one — the safe
  answer should be the easy one to hit — and Escape means it too. Nothing else in the game gets a
  confirmation: it is a reaction game, and a second press on every action is how it stops being one.
- **Nothing is exclamatory twice.** The banners shout (`INTERCEPTED!`, `CAUGHT!`, `LOCO!`) because
  they are the streamable moments; everything around them stays calm so those keep their weight.
- **No em dash in copy**, in either language: a colon, a full stop, or two sentences.

### What is different, and where it is allowed to be said

A visitor arrives holding a model of a card game of colours and symbols, and the only question they
have is the delta. The showcase used to answer it badly in two places at once: the home page carried
three bullets of which exactly one was about the rules (the other two were the LOCO call and there
being no signup, which is already `homeAbout`'s second sentence), and the real differences were
spread across ten sections of the rules page — which is a rulebook's worth of reading to find out
whether a game is worth ten seconds.

- **`src/content/contrasts.ts`** is that answer, eight lines, first thing on the rules page and
  above the `t.rules` mapping. **Its numbers are constants checked against the server**, exactly as
  the deck table is: `HAND_SIZE` against `initialHandSize` in `server/game/room.go`, the number
  range against `NewDeck()`'s loop, the deck size against `DECK_SIZE`. A hand size typed by hand is
  right on the day it is written, and this is the copy nobody plays against, so it goes wrong
  silently.
- **It is not in the rules modal, and must not be put there.** The modal is a reference read
  standing up in the middle of a round; this is an argument read before the first one. Same content
  in two registers is two features as far as a player is concerned, and the modal's whole discipline
  is that every line is a rule.
- **The home page's three bullets are three mechanics.** Interception with no deadline, doubles going
  down together, and the two cards that move whole hands. Nothing there spends the visitor's
  attention on something the other game also does.
- **The sheet's control asks the question rather than offering a section.** `homeSheetBtn` is
  `What is LOCO?` / `C'est quoi LOCO ?`, and it heads the sheet as well as opening it.
- **The phone has to be able to reach that prose.** Under 46rem `.homeIntroMain` is
  `display: none` and the drawer deliberately carries no copy, so a first visit was a logo, a
  tagline, two buttons and a burger. `#navAbout` is the drawer's first row: it shuts the popover and
  opens the same `<details>`. It ships `hidden` and `homeSheet.ts` reveals it — the same contract as
  `#navPrefs`, for the same reason. Two details make it work rather than look like it does:
  `.homeIntroMain:has(.homeSheet[open])` puts the container back at that width (the sheet lives
  inside the row that is hidden), and `homeSheet.ts` remembers **which** control opened the sheet, so
  closing it hands the focus back to the drawer row rather than to a `display: none` summary.

The rules modal follows the same voice and one extra constraint: **it is read once, standing up,
by somebody who wants to play now.** Section headings are the promise (`The cards that hurt`,
`Photo finish`, `One card left: say it`), items are one sentence each, and the sentence leads with
what the player does. Nothing in there is phrased as a specification, and every LOCO deviation from
ordinary UNO is stated where a player would trip over it, not in a footnote. `docs/rules.md` stays
the authoritative spec; the modal is its player-facing telling and must not contradict it.

The card names in the copy are the domain's: **Global Switch** (`global_switch`), not "Global Swap".
FR uses `Rotation` and `Échange`, and both banners and rules use those same two words.

### Refused actions never show a wire string
`i18n/serverErrors.ts` maps the server's error prose onto `Translations.errors` (`ErrorCopy` in
`en.ts`). The server's strings are written for the log — `illegal card play`, `not your turn`,
`nickname %q already taken` — and they used to render verbatim, so a French player tapping the
wrong card was refused in English by a UI that is otherwise entirely in their language.

- Matching is by **ordered regex, first match wins**, because several server messages interpolate
  values (`nickname %q already taken`, `room is full (max %d players)`, `hand has %d copies`).
  Narrower rules come first — the counter-card rule must beat the generic card rules.
- Unrecognised input resolves to `errors.generic`, never to the raw string. A new server message is
  a vaguer message, not a leak and not a crash.
- **Resolution happens at render**, in `Lobby` and `GameView`, not at `store.setError`. The store
  keeps the raw string so switching language re-renders the error in the new one.
- Deliberately **not** a protocol change: the wire keeps its human-readable string and the client
  owns how a refusal is phrased, the same way it owns all other copy.
- `src/test/serverErrors.test.ts` asserts every player-reachable server string resolves to something
  other than itself, in both languages. **Add the string there when you add a server error.**

## No gameplay keyboard shortcuts, ever

There is no key that plays a card, draws, passes, calls LOCO! or throws a Contre-LOCO!, and
there is not going to be one. It has been asked for by competitive players and it is refused.

**Aiming a mouse at a button that lights up for a few seconds *is* the skill the game measures.**
A reaction window is not a prompt to acknowledge; it is a target to find, under time pressure,
while the rest of the board is moving. LOCO! and Contre-LOCO! on a key do not assist that
gesture, they delete it — you stop aiming and start pressing, and the thing being timed stops
being a reaction and becomes a reflex with nothing to point at. Drawing, passing and playing the
n-th card go the same way for the same reason.

**This and the fixed action bar are one decision seen from two sides.** The bar is a fixed
three-column grid with Catch mounted in the centre all match and nothing else ever in it (see
`visual.md`, "Action bar") precisely so a player can park the cursor on the button before the card
that needs it lands — and it goes live from two cards out, so the cursor can be there *and*
committed before the server has named anybody. That work only means something if aiming is the only way in. A shortcut would make the
geometry pointless — the controls hold their coordinates so they can be aimed at, and there is
no way not to aim at them.

**The line is global versus focused, and it matters in both directions.**

- A **global** handler (`window` / `document`) fires on a press nobody aimed. That is the thing
  being refused.
- A **focused** control demands that you got there first: a card and the draw pile carry their
  own `onkeydown` and act on Enter/Space once tabbed to, and the language listbox answers arrows
  and Home/End on its own button. That is not a shortcut, it is the accessibility path, and
  `PRODUCT.md` commits to WCAG AA on every player-facing surface. **It must not be removed,
  reduced or made conditional in the name of this rule** — reading the rule that way is reading
  it backwards.

Three global key listeners exist and no fourth may be added: `heldKey` in
`hooks/viewEffects.svelte.ts` (the score table, held on TAB — a read-only panel that moves
nothing on the board), `hooks/escapeKey.svelte.ts` (the one Escape hook, below), and the audio
unlock in `hooks/appEffects.svelte.ts`, which listens for a key press as evidence a human is
there and reads no key at all. Anywhere else, a global key listener may read `Escape` and nothing
else — the panels that own their own lifetime (the gear, the mixer, the leave confirmation, the
home sheet) do exactly that. `src/test/noKeyboardShortcuts.test.ts` holds the whole rule,
including the check that the allowlist has not gone stale, and it deliberately does not look at
handlers bound to an element.
## Every panel closes twice

Two ways out, on everything that opens over the board, and they are not interchangeable:

- **Escape**, through `hooks/escapeKey.svelte.ts`. One `document` listener rather than one effect
  per panel, which is how the wild colour picker and the swap target picker ended up with a scrim, a
  ✕ and nothing on the keyboard while the rules modal, the legal modal, the gear, the mixer and the
  waiting room's leave confirmation all answered it. The panels do not take focus — a picker opens
  under the pointer, not under the caret — so the listener cannot live on the element. `enabled`
  keeps a shut dropdown from eating an Escape aimed at whatever is actually open.
- **A control that can be pressed**, because Escape is a key a phone does not have and a scrim is
  not an obvious thing to tap. The pinned score table is the case that was missing one: it is pinned
  by a touch-only button that its own scrim then covers, and the header's "Hold TAB" hint names a
  key that device does not have either, so pinned it shows a ✕ where the hint sits. Held with TAB it
  shows the hint and no ✕: there is nothing to close, and a button that exists for a fifth of a
  second is noise.

`src/test/escapeClose.test.ts` owns the rule for the surfaces that had no coverage; the rules,
legal, preferences and waiting-room panels are pinned in their own test files. A dropdown anchored
to its own opener (the gear, the mixer) needs no ✕ — the button that opened it is the button that
shuts it, and it is never behind a scrim.

The rule is about panels somebody chose to open. A screen a tab boots onto instead of the game is
not one: `<Reconnecting />` and `<TabTaken />` both answer nothing on the keyboard, because there is
no game underneath to reveal by dismissing them. Both carry the one control worth carrying instead —
give up and go to the menu, bring the game here.

## Rules modal
- `RulesModal` accessible from Lobby + WaitingRoom (top-right) and GameView (action bar "Rules").
- Close: ✕, footer Close, backdrop click, `Escape`.
- Mobile (`max-width:480px`): bottom sheet (bottom border-radius 0, height 92vh).
- `document.body.style.overflow='hidden'` while open; restored on unmount.
- Content lives in translations; component is content-agnostic.

### Two halves, and why the second one exists

The modal answers two questions and only one of them is the rulebook. "What happens now" is read
standing up in the middle of a round; "what is this card" is read before the first deal, and it was
answered nowhere the player could reach in one press.

The report was about the opener: a first-time player opens "How to play", reads that a Swap takes
somebody's whole hand and a Global Switch slides every hand one seat along, and still cannot
recognise either of them when one turns up in their hand thirty seconds later. That is not a wording
problem. They arrive holding a model of a card game of colours and symbols, that model has a slot for
Skip, Reverse and +2, and it has no slot at all for the two cards this game adds. A bullet naming a
card asks somebody to picture it; the face is the thing that makes it recognisable.

So the second tab draws the deck: `components/cardCatalogue.ts` is the faces — one kind per entry,
`<Card />` itself rather than a picture of one, each coloured kind in a different suit so all four
colours appear once — and the copy is `t.cardNames` plus `t.cardBriefs`, one line each. The lede is
the only place the four suits are stated, because a catalogue that drew all four of every coloured
kind is 16 faces of the same information.

What it is deliberately not:

- **Not the `/cards/` page.** That one is a catalogue for somebody who came looking for one card:
  copies, points, the long form, every suit drawn. This is eight lines for somebody who wants to be
  ready in the next thirty seconds. Same reason the two sets of prose are separate — `src/content/`
  is build-time only and the app never imports it, so a brief here is not a copy of an effect there,
  it is a shorter sentence with a different job.
- **Not a link to it either.** The rule the footer comment carries is unchanged: this opens mid-match,
  and anything navigable is an invitation to leave the table, new tab or not. The tab is how the
  cards got here *instead of* a link. `rulesModal.test.ts` still asserts zero links.
- **Not a third place the card numbers live.** No copies, no points. Those are checked against the Go
  source on the page that prints them, and a number typed here would be right on the day it was
  written.

Mechanics worth knowing before touching it: the two panels share **one** scroller (a card is a fixed
height and a second scrolling box inside it is a scrollbar over a scrollbar), so `select()` resets
`scrollTop` — otherwise a player who read the rules to the bottom lands halfway down a grid they have
never seen. The tab row is `role="tablist"` with arrows/Home/End **on the focused row**, which is the
accessibility path the no-shortcuts rule keeps open, not a global listener. `Escape` still closes the
modal: a tab is not a layer, and one press closes one thing. The `tab` prop only exists so the dev
gallery can shoot the second half (`lobby-rules-cards`); it is read once, not tracked.

**The switch is a change of contents and nothing else, which took three things.** It read as brutal
because all three moved at once. The card was sized to its own contents under a `max-height`, and the
two panels are nothing like the same length — so pressing a tab resized the whole modal, and the
header, the tab row and the footer all travelled with it, including the control that had just been
pressed. It is `height: min(88vh, 640px)` now (92vh as a sheet): one box, whatever is in it. The
scroller was declared `scroll-behavior: smooth`, which turned the `scrollTop` reset into a second
movement — the outgoing panel scrolling up the card while the new one arrived — so the declaration is
gone and the jump is instant, which is invisible under the third thing. And the third is the fade:
each panel is wrapped in a `.panel` div that is mounted fresh on every switch, so a 0.18s
opacity-only CSS animation runs itself with no state to hold. **Opacity only** — anything that slides
moves copy towards a player who is reading it, and `select()` returns early on the tab already
showing so pressing it again replays nothing. Reduced motion drops the animation like every other one
here.

## Privacy and terms
Not a modal any more. Privacy, terms and credits are one content page (`/privacy/`,
`/fr/confidentialite/`), linked from both footers: at the right-hand end of the content pages' fixed
bar, and last in the row of links under the game on the home page. What changed and why:

- **A policy has to be linkable.** The modal existed on one screen of one application, so there was
  no way to send somebody the terms, no way to reach it from a content page, and nothing for a
  crawler or a store listing to point at. That outweighs the navigation it costs, which is a
  navigation away from the *lobby* — no seat is taken there, and nothing is lost by leaving.
- **One page, three sections, with a jump list.** The three documents still answer three unrelated
  questions, and only one of them is ever the one somebody came for; `#privacy`, `#terms` and
  `#credits` do what the tab strip did, minus the component state and minus the script, and each one
  is a URL that can be sent on its own.
- **The copy left the i18n bundle.** It is `src/content/legal.ts`, typed `Record<Lang, LegalDoc[]>`
  so a document still cannot exist in one language only, and read at build time by
  `content/LegalArticle.astro`. `src/i18n/en.ts` is downloaded by every player on every visit; these
  three documents are read by almost nobody and they are long. Tutoiement applies here too: a policy
  that suddenly switches to `vous` is a policy written by somebody else, and it reads that way.
- **The footer link, not the gear.** It has to be reachable before typing a name and before taking a
  seat. Preferences are things a player changes; this is something they read once, if ever, and a
  link they cannot find is the same as no link. The home footer is hidden on `data-seated`, which is
  exactly the screens where nobody is reading a policy.

Where the game's voice and legal accuracy pull apart, accuracy wins and the sentence gets longer.
`src/test/legal.test.ts` pins the disclosures that are obligations rather than prose, so rewording
is free and deleting substance is not; it also pins that the page is built, is in the registry, is
linked from both footers and ships no script. Reasoning and the open questions:
[`docs/notes/legal.md`](legal.md).

