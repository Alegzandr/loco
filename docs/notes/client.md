# Client: transport, state, i18n

The path between the socket and the store, and the performance rules that protect it. For rendering,
see `visual.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Where the client's logic lives

`App.tsx` and `GameView.tsx` were both mostly *not* rendering: a 320-line switch over every inbound
message in one, and eight animation timers, two prompts and the whole legality check in the other.
Both are now what their names say, and the work sits beside the other work of its kind:

| Module | What it owns |
| --- | --- |
| `hooks/serverMessages.ts` | every inbound message, applied to the store. `App` builds it once |
| `hooks/useGameStore.ts` | the assembly, and the re-exports every screen imports from |
| `hooks/store/` | `types.ts` (the state shape and the five action interfaces), `initialState.ts`, `helpers.ts` (the pure ones), and one module per family of transitions |
| `hooks/useCardPlay.ts` | what a tap on a card means, the two prompts it can open, and the legality the board highlights with |
| `hooks/useBoardShake.ts` | the rattle an interception takes, the thump a Contre-LOCO! takes |
| `hooks/useAutoClear.ts` | a piece of table news that takes itself off screen |
| `hooks/useMapGate.ts` | preload the room's art while the table is shut, then answer `map_ready` |
| `hooks/useTurnCountdownSfx.ts` | the ticks over the last seconds of our own turn |
| `dev/e2eBridge.ts` | the whole `window.__LOCO_E2E__` surface, dev builds only |
| `components/swapNoticeText.ts` | the line a Swap or a GlobalSwitch puts on screen |

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

**`GameBoard.tsx` is deliberately not split.** Its eight animation effects are one state machine over
one queue: they share `setFliers` / `setImpacts`, the `landTimers` list, the stage ref and the
suppress-next-discard flag. Per-animation hooks would pass those five handles through six
signatures, which is the same coupling with more indirection. If it is ever split it should be as a
single `useBoardFx`, and reviewed with `make visual` rather than with assertions.

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
board is measured from the viewport (`boardSpace`, `useElementSize`, `useSafeAreaInsets`). A server
knows none of those. Rendering the app there would produce a hydration mismatch on every one of them
in exchange for markup no crawler wants: the lobby is a nickname field.

**So `src/pages/index.astro` carries `<div id="root">` and an ordinary `<script>` importing
`src/entry.tsx`**, which Astro bundles to an external module. That is the same mechanism the app used
under Vite, `#root` keeps the `html, body, #root` rule in `tokens.css` working unchanged, and the
content pages around it mount no React at all.

**The cost of that split is that `/` arrives twice, so the two halves are held together on purpose.**
The footer row, the phone's burger and the prose behind the sheet are markup the server sent, and
they paint on the first frame; the lobby paints whenever the bundle has loaded, parsed and mounted.
On a reload that read as the background coming up with one lonely control on it — the links on a wide
screen, the burger on a phone — and the game dropping in a few hundred milliseconds later. Nothing
about it was broken, and it looked broken every time.

The app's mounted child, the footer's row of links and the phone's burger therefore all hold at
`opacity: 0` until `entry.tsx` writes `data-booted` on `<html>`, two `requestAnimationFrame`s after
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
  The `[data-booted='in']` rule replaces it with the delay-free one the moment React reports in.
- **The reveal is spent.** `entry.tsx` blanks the value 600ms later, leaving the bare attribute that
  lifts the hold and no rule that animates. Every screen in the game is a fresh child of `#root`, so
  a live `#root > *` reveal would fade the board in again on every screen change for the rest of the
  match — the waiting room, the deal, the score table.
- It animates `opacity` and nothing else. A transform on any of these would make it the containing
  block for the fixed burger and for every panel the app renders, for as long as it ran.

Reduced motion keeps the wait and loses the fade for free: the blanket rule in `tokens.css` cuts every
animation's *duration* and leaves its *delay* alone, so the sync survives and the movement does not.
`contentPages.test.ts` pins each of these, including the two selectors that must **not** be there.

One consequence worth knowing: `@astrojs/react` injects the Fast Refresh preamble as a
`before-hydration` script, which Astro only emits on pages that hydrate an island. With no island the
preamble never lands, and every transformed `.tsx` throws "can't detect preamble" in dev. It is
injected as a plain page script from `astro.config.mjs` instead, dev-only, so it is bundled rather
than inlined and the production HTML keeps exactly one external script and nothing inline.

## The toolchain, and the one place it is deliberately not the newest

React 19, Astro 7, Zustand 5, Valibot 1, ESLint 10, Vitest 4. Two of those cost something worth
writing down.

**React 19 removed the global `JSX` namespace and deprecated `forwardRef` and the bare event
aliases.** `CardArt.tsx` imports `JSX` from `react` instead of reaching for a global; `Card` and
`CardBack` are plain functions taking `ref` as an ordinary prop, which is one fewer wrapper object
between framer-motion and the node it animates; `Lobby`'s submit handlers take `SyntheticEvent`,
since React's `FormEvent` is now marked as a type that "doesn't actually exist" — the DOM event a
submit fires is a `SubmitEvent`. `useRef<T>(null)` also yields `RefObject<T | null>` now, so a prop
that receives one has to say so (`UnoTimer.fillRef`, `GameBoard.flightRef`).

**The validator is Valibot because Zod 4 compiles with `Function()` and the CSP refuses that.** The
full account, the test that replaced the workaround's config pin, and the rest of the generated
protocol are under "Protocol validation (client)" below.

**TypeScript stays on 6.x, and that is a ceiling rather than a preference.** `npm run build` is
`astro check && astro build`, and `astro check` drives `@astrojs/language-server`, which needs
TypeScript's programmatic API. The 7.0 native compiler does not ship one yet and the check refuses
to start with a message naming that directly. Raising it turns the client's only type gate into an
immediate failure, so the pin moves when the language server says it can. The E2E package is held to
the same major for one decision rather than two.

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
- **A tap that is not a play animates nothing.** `useCardPlay`'s `onCardClick` (which `GameView`
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
- **A prompt lives exactly as long as the play behind it stays legal.** `useCardPlay` re-reads the
  condition that opened the colour/player picker on every state change (`clientMayInterrupt` for an
  interject, `currentTurn === myIndex && clientMayPlay` otherwise, plus the card still being in
  hand) and closes it the moment that answer turns false. The older rule closed a picker only when a
  card landed (`lastPlay.at`), which covers an interjecter stealing the lead and nothing else: the
  turn timing out, a forced draw and a fresh `game_state` after a Swap all move the board without
  setting `lastPlay`, so the prompt stayed up over a table that had gone and the choice went out
  against a state the server had already replaced. Being asked for a swap target and *then* refused
  is the one rejection in this game that reads as a broken promise rather than as an illegal card.
- `src/test/realtime.test.tsx` owns all of the above on the client side.

## Client transport
- **The socket's URL comes from `import.meta.env.VITE_WS_PORT`, and Astro does not expose that name
  by default.** Astro narrows Vite's `envPrefix` to `PUBLIC_`, which leaves `import.meta.env.VITE_*`
  in the transformed module verbatim and reading `undefined` in the browser, with no warning at any
  layer. `useWebSocket` then took its production branch in dev and dialled same-origin `/ws`, which
  is the Vite dev server proxying nothing: `ws://localhost:5173/ws` closed before it opened, and the
  symptom a player got was a table that never opened and a queue that never paired.
  `astro.config.mjs` restores the prefix (`envPrefix: ['PUBLIC_', 'VITE_']`) rather than renaming the
  variable, because `docker-compose.dev.yml`, `e2e/playwright.config.ts`, `client/Dockerfile` and the
  README all already name it. `src/test/wsEnv.test.ts` fails whenever the hook reads a prefix the
  config does not expose. Anything else the app needs from the environment obeys the same rule.
- `useWebSocket.send(msg)` queues to `pendingRef: ClientMsg[]` when not OPEN; FIFO flush on `onopen`.
- Auto-reconnect: `reconnectDelay(attempt)` walks `RECONNECT_DELAYS_MS`
  (250ms, 500ms, 1s, 2s, 4s, then held), max 10 attempts, `attemptsRef` resets on `onopen`.
  **The first retry is deliberately almost immediate.** Most drops are a single lost connection
  that comes straight back, and the flat 2s first retry it replaced cost the player an entire
  interrupt window of dead board every time one happened. The tail still backs off, so a server
  that is genuinely down is not hammered.
- `getReconnectMsg`: `screen==='game'` → token-auth `join_room` reclaim; `screen==='waiting'` → plain nickname `join_room` (best-effort; may fail with "nickname already taken" → reload).
- **Everything the server can say lives in `hooks/serverMessages.ts`**, not in `App`.
  `createServerMessageHandler(unoTimer)` is built once (`useMemo([])`) and takes its store snapshot
  at creation: the action functions come from the zustand factory and are stable for the life of the
  app, so closing over them costs nothing. Branches needing CURRENT store *values* call
  `useGameStore.getState()` at the moment they need it: a frozen snapshot would be reading the store
  as it was at mount, which is a different value on every branch that asks about the current screen.
  The one thing passed in is the LOCO! banner's timer (`UnoBannerTimer`), because the ref belongs to
  a component and the handler is not one.
- React renderer relies on Zustand selector equality; expensive re-renders are avoided via stable references in the store.
- **`App` never subscribes to the whole store.** `const store = useGameStore.getState()` is an
  actions-only snapshot (the factory creates them once, so it is stable and safe to close over in a
  deps-free callback), and everything App *renders* comes from one narrow selector per field.
  `handleSend` depends on `[send]` alone.
  - `useGameStore()` here undid, from the parent, the entire stabilisation `GameView` does for
    itself: every broadcast — a latency tick every 3s, any card anybody drew — re-rendered App, and
    the new store object in `handleSend`'s deps gave `onSend` a new identity, which rebuilt
    `GameView`'s memoised callbacks and defeated `<GameBoard />`'s memo one level down. See
    "Nothing continuous goes through React state"; the rule has to hold at *both* levels.
  - `src/test/appSubscription.test.tsx` pins it. Its `useWebSocket` mock returns a **stable**
    `send` on purpose: the real hook's is `useCallback([], …)`, and a mock handing back fresh arrows
    would make `handleSend` unstable by itself and quietly prove nothing.

## Session restore across a reload
The socket-level reconnect only ever covered a **dropped connection**: the store was still in memory,
so it still knew the room, the seat and the token. A refresh, a crashed tab, an accidental navigation
or a phone killing a backgrounded page threw all of that away, and the player landed on the lobby
while the server held their hand and their score for another minute with nobody able to claim it.
That is the disconnect people actually have, and it was the one that could not be undone.

- `hooks/sessionPersistence.ts` owns the record (`loco_session`) and `reconnectMessageFor(state)`.
  **One pure function builds the rejoin for all three cases** (a socket that dropped mid-match, one
  that dropped in the lobby, and a tab that was reloaded), so a reclaim cannot mean two different
  things depending on how the connection was lost.
- **`sessionStorage`, deliberately, not `localStorage`.** It is per tab, so two seats played from one
  browser (how this game is tested, and how a lot of people play with a friend on one machine) cannot
  overwrite each other's token and reclaim the wrong seat; it survives a reload, a back/forward
  navigation and a crash restore, which is every case this exists for; and it dies with the tab
  rather than handing the next person a live seat.
- `initSessionRestore()` runs in `entry.tsx` **before the first render**, next to `initTheme()` and for
  the same reason: `useWebSocket` connects in an effect on App's first mount and the rejoin goes out
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
- Client: `store.myNickname` is kept separately from `players` because a reloaded tab has no roster to
  derive it from and the rejoin is keyed on the nickname. `<Reconnecting />` names the room so the
  player recognises it and offers the way out; scenes `reconnecting-game` / `reconnecting-room`.

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
- Seeded via `useState(readNickname)`, i.e. **read once at mount**. Re-reading storage while the lobby
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
- **"Take a seat" is disabled until the code is whole**, which is the difference between a button
  that does nothing and a button that says why. `handleJoin` checks it again anyway: the guard is not
  the disabled attribute.
- **It decides nothing either.** `join_room` is validated server-side, and an unknown table still
  comes back as `room not found` — the code being *shaped* like a table is not the code being one.
  The nickname is unaffected: it keeps its own instant refusal, and a valid code does not make an
  unacceptable name sendable.

## The link a table is shared with
`hooks/tableInvite.ts`. The waiting room's code is a button, and what the press copies is a URL
carrying the code (`tableInviteUrl`), not the six characters. On the other end, `initTableInvite`
reads that code off the URL before the first render and `App` acts on it.

- **Why a link at all.** A code costs the receiver three steps: read it, retype it without a slip,
  and find the screen to type it into. A link costs one tap, and the seat is the only thing on the
  other side of it. The code stays on screen, unchanged: it is what a stream reads out loud and what
  somebody already sitting at the join form types.
- **It is `?t=CODE` on the home page, never `/t/CODE`.** Every URL here is a page the build emitted,
  and `client/nginx.conf` deliberately answers a miss with a real 404 rather than the app, so there
  is no catch-all a path form could route through — and a static build cannot emit one page per
  table. The query form costs two characters, works identically under `astro dev`, the preview server
  and nginx, and needs nothing added to the server config.
- **The link carries no language.** It is always `/?t=…`, whichever language it was copied from. A
  link gets forwarded, and the person who copied it does not know who ends up pressing it, so
  shipping `/fr/` would decide the reader's language from the other side of the table. That choice
  belongs to whoever opens it and the i18n provider already makes it (a stored choice, then the
  browser). An incoming `/fr/?t=…` still works — `initTableInvite` reads the parameter on any page —
  it is simply not what the button hands out.
- **The code is spent on arrival.** `initTableInvite` takes the parameter back out of the address bar
  with `replaceState` before anything else looks at it. Three reasons, and any one of them is enough:
  a reload must not re-join a table the player has since left (a reload's job is the seat reclaim
  below), a code sitting in the address bar is a code on stream in the one place `TableCode`'s blur
  cannot reach, and a URL copied later would keep pointing at a table that has closed. The parameter
  is dropped by string surgery rather than by `searchParams.delete` + `url.search`: re-encoding the
  query rewrites the parameters it was not asked about, and `?showcase` comes back as `?showcase=`.
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

## The host's control over a row
`WaitingRoom.tsx` puts one icon button on every roster row but the host's own, sending
`kick_player` with that seat. Guests render none of them, on any row.

- **Never on seat 0.** The way out of your own seat is the quit link at the bottom, which asks first.
  A control that could take seat 0 would hand the table away through a button that says nothing of
  the sort, and it sits two pixels from every other row's.
- **It asks nothing.** This screen has exactly one question, the one about leaving, and it earns it:
  leaving is one-way and costs the guest the table code. A kick costs the host nothing to undo —
  the removed player still has the code, and the server runs no ban list — so a second confirmation
  would only teach people to click through both.
- **A bot's row carries it too.** There is no other way to take a bot's seat back, and a roster with
  the control on every row except those would be lying about which of them the host owns.
- **The removed player is told, and it lands where every refusal lands.** `kicked` resets the store
  like `left_room` and then writes `removed by the host`, which `serverErrors.ts` resolves to
  `errors.kicked` under the lobby form. Order matters: `resetToHome` clears `errorMsg`.

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
  open a private table. `matchmaking.test.tsx` asserts none of the copy can name a number.
- The empty chair opposite is drawn as an empty chair. A spinner would be a smaller promise than the
  truth.
- **The searching screen carries the same top bar as every other screen.** It is the longest single
  screen in the game, and turning the music down or reading the rules is exactly what somebody does
  while queueing. It was the one screen without the row.
- **Being found reaches a player who is not looking, two ways, and both are deliberately bounded.**
  `soundsForTransition` plays `matchFound` on the transition into `screen: 'matchfound'` (stacked
  fifths rather than the thirds every other cue uses: nothing has been *won*, somebody has arrived),
  and `useTabAlert` alternates the browser tab's title with `t.matchFoundTab`. The alert **only ever
  arms while the tab is hidden**, and coming back disarms it and restores the real title on the spot,
  never re-arming: a title blinking under the player's eyes says nothing the screen does not, and one
  still blinking after they came back is a bug they can only fix by reloading. `tabAlert.test.tsx`
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
- **The rematch button has three states, and the middle one is the point.** Ask, wait, accept, at
  every table and for every seat: `rematchOffers` and `rematchNeeded` come straight off
  `rematch_offered`, and the button reads "they want another, go" once somebody else has asked first,
  because an ask nobody can see is an ask nobody answers. Past two seats the wait is on the table
  rather than on one named opponent, and the button carries `x/y`; at two the count is noise.
  `player_left` clears the pair, and the server republishes right behind it in every room that still
  has an agreement to publish.
- **A matchmade table with nobody left at it requeues by itself** (the effect in `App.tsx`,
  `rematchRequeue.test.tsx`). The ask cannot complete, the only other thing on the screen is the
  queue, and making the player press it is asking them to confirm the only remaining option.
  Cancelling the search is how they leave. Ordinary tables are left alone: there is a room, a code
  and a lobby to reopen, and nobody there queued for a stranger.
- `<OpponentAway />` is the only thing on the board that reads `opponentAway`, and the store only fills
  it when the server sent a `forfeit_deadline`, i.e. never in an ordinary room, where the seat is
  simply held and a countdown to losing would be a worse table. Its bar is a `useDrainBar` animation:
  a board frozen on somebody else's connection is exactly when the main thread must stay free.

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

- `useWebSocket` runs `v.safeParse(serverMsgSchema, …)` on every payload. Dev: invalid → log and
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

### Nothing continuous goes through React state
A value that changes every frame must never be a `useState` in a component the board
hangs off. `<GameView />` owns the whole match screen, and it is not memoised against
its own store subscription, so one `setState` per frame re-renders the board with it:
seat layout, hand slots, pile positions and every card, re-derived sixty times a second.

- **Countdown bars use `useDrainBar`, not a percentage in state.** The bar is handed a
  CSS animation whose duration is the window and whose *negative* delay is the part
  already elapsed (`--drain-ms` / `--drain-delay`, keyframes `loco-drain` +
  `loco-drain-heat` in `tokens.css`). The browser then drains it on the compositor:
  zero JS per frame, zero React work, and the bar stays smooth while the main thread
  is dealing a hand. This replaced a `requestAnimationFrame` → `setState` loop that
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
- **`<GameBoard />` is `memo`'d and its props are kept referentially stable** in
  `GameView` (`turnTexts`, `fxTexts`, `cardIsPlayable`, `cardIsInteractive`,
  `handleCardClick`, `handleDraw`). An object literal or an arrow in that JSX defeats
  the memo entirely, which is what an inline `turnTexts={{…}}` and
  `onDraw={() => …}` were doing: a latency broadcast every 3s, an error toast or a
  catch window rebuilt the whole board.

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
- `useReconnectAnimation(isReconnecting, onComplete)` shows "Rebuilding table…" overlay for 600ms then calls onComplete (which clears `isReconnecting`).
- `<GameBoard />` hides its children while reconnecting; on the false→true→false transition it bumps an internal `rebuildKey`, replaying a 350ms board fade-in CSS keyframe.
- Visual only; server is authoritative.
- **Nothing but that timer ends the overlay, so nothing may be allowed to swallow it.** The hook used
  to hold a ref guarding against replaying the animation, and the ref outlived the timer it guarded:
  a reload mounts `<GameView />` with `isReconnecting` already true, so the effect runs for the first
  time *on mount*, which is where StrictMode double-invokes it in dev. The first pass set the ref and
  armed the timer, the cleanup cleared the timer, and the second pass returned early on the ref
  without arming another. The seat was reclaimed correctly and the board was live underneath, but the
  card sat over it saying "setting the table back up" for the rest of the match, and `isReconnecting`
  was never cleared so the fade-in never played. The effect re-runs only when `isReconnecting`
  actually changes, so re-arming on every run is the whole guard needed, and a reconnect that
  resolves early now takes the overlay down with it instead of leaving it on a cancelled timeout.
  It was invisible to the store-level tests by construction: every assertion about the seat, the hand
  and the discard passed. `reconnectAnimation.test.tsx` renders the hook under `StrictMode`, and the
  reload E2E asserts the overlay is gone rather than only that the state came back.

## i18n
- `client/src/i18n/en.ts` (source of truth) + `fr.ts`. `Translations` interface in `en.ts` reused as type — missing keys = TS error.
- `I18nProvider` (`client/src/i18n/index.tsx`) wraps app in `entry.tsx`. `useI18n()` → `{ lang, t, setLang }`.
- Detect order: `localStorage('loco_lang')` → `data-served-lang` on `<html>` → `navigator.language`
  prefix (`fr` → French, else English).
- `setLang` persists to localStorage + syncs `document.documentElement.lang`.
- Add language: create `xx.ts` impl `Translations`, add to `translations` map in `index.tsx`, add `{code, label}` to `LANGS` in `LanguageSwitcher.tsx` **and to `LANGS`/`HOME_PATH` in `src/lang.ts`**.
- The switcher is no longer mounted bare: it renders inside the preferences panel (below).
- `rules`: `readonly RulesSection[]` rendered by `RulesModal`.
- Storage key and home paths: `src/lang.ts`, not the provider — see below.

### One document, one language

The key, the pair of languages and the two home paths live in `src/lang.ts`, free of React, for the
reason `theme.ts` exists: the content pages take part in this decision and mount nothing at all.

The bug that produced it. A stored choice outranks the URL in `detectLang`, and half of `/` is markup
Astro built per URL — the footer row, the drawer, the sheet of prose — which no in-app state rewrites.
So `/` opened with French stored rendered the game in French under a footer reading "With friends",
having rewritten `<html lang>` to `fr`: a document declaring itself French while half its text was
English, which is a lie to a screen reader before it is anything else. The lobby's switcher had
already answered this for the *change* — at the entry screen it is two real links, so following one
serves the whole document in the other language — but nothing answered it for the *arrival*.

`initLangUrl()` does, first thing in `entry.tsx`. Three properties are what make it safe:

- **It only ever acts on an explicit choice.** Landing on a French page from a search result is not a
  choice and writes nothing to storage; only the two switches do. So this never fights the URL of a
  reader who has never expressed a preference.
- **It cannot loop.** The decision (`langRedirect`) is pure and is tested exhaustively over both
  languages: every target it names is a URL served *as* the stored language, so the page it arrives
  at has nothing left to disagree about. An unknown stored value and a missing `data-served-lang` are
  both refused — with nothing to compare against, every load would redirect to where it already is.
- **It runs before `initTableInvite()` and it carries the query string.** The invite is spent on
  arrival, so redirecting after that call would drop a guest at a home page with no table in it. Done
  in this order, `/?t=ABC234` with French stored lands at `/fr/` with the code already in the join
  form. `location.replace`, never `assign`: an extra history entry would leave Back pointing at a URL
  that redirects straight back, and the way out of the game would be a trap.

The other half is the content pages' globe. Its two links stay real `<a href>`s — the href is what
makes an `hreflang` pair navigable and a crawler follows nothing else — and `theme-boot.ts` adds one
delegated listener that records the choice on the way out. Without it the choice reached the pages
and never the game: a reader who switched to French, read the rules and pressed "Jouer" arrived at
`/fr/` with English still stored, and the stored choice won. The theme has worked this way since it
was split out (`THEME_STORAGE_KEY`, one key, both halves); the language now does too.

## Preferences
`Preferences.tsx` is the gear in the top bar of the lobby, the waiting room, the reconnect splash and
the board. It holds the language pair (`LanguageSwitcher`, unchanged, now a child), the theme, and
three switches: streamer mode, colour shapes, reduced motion.

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
  at display size. `useStreamerMode` (`localStorage`, key `loco_streamer_mode`) is a module store,
  not store or context state: the flag is read by two screens with no common parent and written from
  a third, and it must survive a reload with no round trip. Nothing about it reaches the wire.
- **`TableCode.tsx` is the only way a screen prints the code.** The blur is a CSS filter over the
  real text, so the copy button still copies the real code and hover/focus clears it for the owner —
  reading the code out loud is a normal thing to want. A screen that renders `roomCode` directly
  leaks it the moment the mode is on, and nothing will fail loudly: go through `TableCode`.
- **The lobby's join field is deliberately not masked.** It holds what the player is typing, and a
  blurred input is a typo you cannot see. The leak there is the code the player already knows.
- **Below 46rem it is a sheet, not a dropdown, and on the lobby the gear stands down.** 250px of
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
- **The drawer opens it by event.** `#navPrefs` is markup Astro rendered, outside `#root`, so
  `homeSheet.ts` closes the popover and dispatches `loco:preferences`; the mounted `<Preferences />`
  answers. Only one screen is mounted at a time, so only one panel opens. It also remembers what had
  the focus, because `hidePopover()` hands it back to the burger and closing the panel has to return
  it somewhere real.
- Showcase: `streamerMode`, `colorAssist` and `prefsOpen` scene flags (`dev/scenes.ts`), scenes
  `waiting-streamer`, `lobby-prefs`, `card-sheet-assist` and `game-color-picker-assist`. `applyScene`
  resets both module stores so neither leaks into later captures.

## Colour assist
Colour is the rule in this game: a card is legal because it matches the pile. Red-green is the most
common colour-vision deficiency there is, and the four suits are separated in luminance as well as
hue for that reason, but "survives" is not "reads".

- **`SUIT_SHAPE` (`cardTheme.ts`) is the vocabulary**: triangle (red), circle (yellow), square
  (green), diamond (blue). They differ at every corner count, which is the only property that
  survives a card overlapped down to a sliver. `suitMark.tsx` draws them the way every card glyph is
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
The setting has three values (`auto` / `reduce` / `full`, `hooks/useMotionPref.ts`) and the UI shows
two, because `auto` is what the switch reads before it is ever touched.

- **`:root[data-motion="reduce"]` is the single source of truth in CSS**, written by `initMotion()`
  before the first paint. The media query is deliberately gone: it cannot be overridden, and a player
  whose system is set to reduce for reasons of their own is allowed to ask this game for its
  animations back. `reducedMotionCss.test.ts` fails on any new `@media (prefers-reduced-motion)`.
- framer-motion goes through `<MotionGate>` in `entry.tsx` (`always`/`never`, not `user`), and the two
  Web Animations shakes (`GameBoard.kickBoard`, `GameView.shakeScreen`) call `prefersReducedMotion()`.
- The capture harness still works unchanged: Playwright emulates the media query, `initMotion` reads
  it, and the attribute lands before the first paint.

### The voice
The copy is the cheapest thing in the product and the first thing a player judges it by. A screen
that says "Waiting Room", "Create Room" and "Game Rules" is a website with cards on it; the same
screen saying "The table", "New table" and "How to play" is a game. Every string is written as
something a person at the table would say, and rewriting one means keeping it inside these rules.

- **The place is a table, never a room.** `salle`, `salon`, `lobby` and `room` are venue-booking
  words. A player opens a table, shares a table code, takes a seat, leaves the table. The store's
  internal names (`room_code` on the wire, `screen === 'waiting'`) are unaffected: this is copy.
- **French is tutoiement**, stated at the top of `fr.ts`. `vous` puts a service counter between the
  game and four friends on a sofa. It is a translation convention, not a per-string decision.
- **A button is a verb the player is about to perform**, in as few words as the control allows.
  `Deal`, `Take a seat`, `Next round`. `rulesBtn` stays one word (`Rules` / `Règles`) because it
  lives in a row of icons in-game; the modal it opens is the one allowed a sentence
  (`rulesTitle`). Keeping them distinct also keeps `getByText` unambiguous in the E2E suite.
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

## Every panel closes twice

Two ways out, on everything that opens over the board, and they are not interchangeable:

- **Escape**, through `hooks/useEscapeKey.ts`. One `document` listener rather than one `useEffect`
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

`src/test/escapeClose.test.tsx` owns the rule for the surfaces that had no coverage; the rules,
legal, preferences and waiting-room panels are pinned in their own test files. A dropdown anchored
to its own opener (the gear, the mixer) needs no ✕ — the button that opened it is the button that
shuts it, and it is never behind a scrim.

## Rules modal
- `RulesModal` accessible from Lobby + WaitingRoom (top-right) and GameView (action bar "Rules").
- Close: ✕, footer Close, backdrop click, `Escape`.
- Mobile (`max-width:480px`): bottom sheet (bottom border-radius 0, max-height 92vh).
- `document.body.style.overflow='hidden'` while open; restored on unmount.
- Content lives in translations; component is content-agnostic.

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
`src/test/legal.test.tsx` pins the disclosures that are obligations rather than prose, so rewording
is free and deleting substance is not; it also pins that the page is built, is in the registry, is
linked from both footers and ships no script. Reasoning and the open questions:
[`docs/notes/legal.md`](legal.md).

