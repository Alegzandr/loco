# Client: transport, state, i18n

The path between the socket and the store, and the performance rules that protect it. For rendering,
see `visual.md`.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

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
- **A tap that is not a play animates nothing.** `GameView.handleCardClick` returns `false` when the
  client refuses the card and when the tap only opens the colour/player prompt. It used to fly the
  card on every tap, so an illegal card and an unconfirmed wild both threw the card at the pile and
  had it reappear in the fan. Plays confirmed later go through `flightRef`
  (`GameBoardHandle.flyFromHand`), called by the picker callbacks straight after `onSend`.
- **The double-tap guard is per control** (`guardDoubleTap(key, fn)`, keyed `draw` / `pass` / `uno` /
  `catch:<seat>`). One shared 400ms lockout silently ate the most ordinary sequence in the game,
  draw then pass, along with LOCO-then-catch and catching a second seat after a Swap. A control that
  ignores a deliberate tap because a *different* control was used 300ms ago reads as a dead button.
  The catch key carries its target because two seats are two taps.
- **A prompt lives exactly as long as the play behind it stays legal.** `GameView` re-reads the
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
- `useWebSocket.send(msg)` queues to `pendingRef: ClientMsg[]` when not OPEN; FIFO flush on `onopen`.
- Auto-reconnect: `reconnectDelay(attempt)` walks `RECONNECT_DELAYS_MS`
  (250ms, 500ms, 1s, 2s, 4s, then held), max 10 attempts, `attemptsRef` resets on `onopen`.
  **The first retry is deliberately almost immediate.** Most drops are a single lost connection
  that comes straight back, and the flat 2s first retry it replaced cost the player an entire
  interrupt window of dead board every time one happened. The tail still backs off, so a server
  that is genuinely down is not hammered.
- `getReconnectMsg`: `screen==='game'` → token-auth `join_room` reclaim; `screen==='waiting'` → plain nickname `join_room` (best-effort; may fail with "nickname already taken" → reload).
- `App.handleMessage` deps `[]`. Branches needing CURRENT store values use `useGameStore.getState()`. Stable Zustand actions safe.
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
- `initSessionRestore()` runs in `main.tsx` **before the first render**, next to `initTheme()` and for
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
- **The reveal counts down but decides nothing.** `starts_in_ms` sizes the counter; the match starts
  when `game_started` lands. A counter that reaches zero first holds on "dealing", which is the right
  behaviour for a screen whose server is the one deciding.
- **A forfeit never renders as a victory.** `<GameOver />` with `forfeitBy` set drops the confetti and
  the trophy and says what happened, on both sides: the player who left is told they left. It also
  drops the rematch button entirely: the opponent is gone from the room, the server would refuse the
  offer, and a button that cannot work is worse than no button.
- **The rematch button has three states, and the middle one is the point.** Ask, wait, accept. A
  matchmade rematch is an agreement, so `rematchOffers` holds both seats' offers and the button reads
  "they want another, go" once the other side has asked first: an offer nobody can see is an offer
  nobody answers. `player_left` clears the offers, because there is no longer anybody to agree with.
- `<OpponentAway />` is the only thing on the board that reads `opponentAway`, and the store only fills
  it when the server sent a `forfeit_deadline`, i.e. never in an ordinary room, where the seat is
  simply held and a countdown to losing would be a worse table. Its bar is a `useDrainBar` animation:
  a board frozen on somebody else's connection is exactly when the main thread must stay free.

## Protocol validation (client)
- `client/src/types/protocolSchemas.ts` defines Zod schemas for inbound `ServerMsg`. `client/src/types/protocol.ts` infers `CardDTO`/`PlayerDTO`/`GameStateDTO`/`ServerMsg`/etc. from the schemas — single source of truth.
- `useWebSocket` runs `serverMsgSchema.safeParse` on every WS payload. In dev: invalid → log + drop (surfaces Go↔TS drift in tests). In prod: log + pass through (forward-compat with new server fields).
- `ClientMsg` stays hand-typed (we control what we send).
- When you change `server/protocol/messages.go`: update `protocolSchemas.ts` for any inbound shape changes (inferred types follow). `client/src/test/protocolSchemas.test.ts` exercises the schema.

## Client protocol coverage
- New inbound message types must be added to `serverMsgTypeSchema` in `protocolSchemas.ts` or `useWebSocket` drops them in dev. New outbound types go in `ClientMsgType` (`protocol.ts`).

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

## i18n
- `client/src/i18n/en.ts` (source of truth) + `fr.ts`. `Translations` interface in `en.ts` reused as type — missing keys = TS error.
- `I18nProvider` (`client/src/i18n/index.tsx`) wraps app in `main.tsx`. `useI18n()` → `{ lang, t, setLang }`.
- Detect order: `localStorage('loco_lang')` → `navigator.language` prefix (`fr` → French, else English).
- `setLang` persists to localStorage + syncs `document.documentElement.lang`.
- Add language: create `xx.ts` impl `Translations`, add to `translations` map in `index.tsx`, add `{code, label}` to `LANGS` in `LanguageSwitcher.tsx`.
- `rules`: `readonly RulesSection[]` rendered by `RulesModal`.
- Storage key: `'loco_lang'`.

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

## Rules modal
- `RulesModal` accessible from Lobby + WaitingRoom (top-right) and GameView (action bar "Rules").
- Close: ✕, footer Close, backdrop click, `Escape`.
- Mobile (`max-width:480px`): bottom sheet (bottom border-radius 0, max-height 92vh).
- `document.body.style.overflow='hidden'` while open; restored on unmount.
- Content lives in translations; component is content-agnostic.

