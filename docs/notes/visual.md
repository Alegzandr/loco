# Rendering, layout and art direction

The art direction, the board's geometry, the cards, and the streamable moments.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Art direction — "cartoon premium"
Inspirations: **Nintendo × Gartic Phone**. Chunky rounded shapes, thick ink outlines, saturated
candy palette, solid offset shadows that make every control read as a physical object. The old
Airbnb-derived tokens are gone.

**`DESIGN.md` is the written spec for this system** — North Star, the four colour roles, the type
scale, the elevation vocabulary and the do's/don'ts, in the Stitch DESIGN.md format so tooling can
read it. `styles/tokens.css` remains the executable source of truth for the values; `DESIGN.md`
says what they mean and when to reach for them. Change one, change the other.

Three rules the whole UI obeys (stated at the top of `styles/tokens.css`):
1. Every raised object has an ink outline (`--stroke`) **and** a hard bottom shadow
   (`--shadow-hard`). Soft blurs are ambience, never structure.
2. Nothing is pure white on pure white. The board always sits on colour (`--bg-gradient`, painted
   once on `body`; screen containers stay `transparent`).
3. Type is display-weight and large — a spectator reads it at 720p, not a designer at arm's length.

- Fonts: **Fredoka Variable** (display) + **Nunito Variable** (body), self-hosted via
  `@fontsource-variable/*` and imported in `layouts/Base.astro`, not from the game's entry: the
  content pages mount no application at all and still have to be typeset. No CDN — the CSP stays closed.
- Press feedback (hover lifts, active travels *into* the ledge) is written per component. `tokens.css`
  used to carry a `.btn-chunky` for it, plus a family of `.t-*` type classes, both described as what
  every control extended; **nothing had ever imported either**, and both were deleted. Do not
  reintroduce a shared control class without a caller.
- Scrollbars: styled globally in `tokens.css` (`scrollbar-width`/`scrollbar-color` for Firefox, the
  `::-webkit-scrollbar*` pseudo-elements elsewhere). Thin, no track, thumb in `--color-border-strong`
  with a transparent border plus `background-clip: padding-box` so it never touches the panel edge.
  A default OS scrollbar is the only widget in the UI the browser draws, and it is grey chrome
  sitting on a candy panel in every stream capture. A panel that scrolls needs no scrollbar CSS of
  its own; do not re-declare it per component.
- Card faces: see "Card face" below. The deck has its own identity — full-bleed suit gradients and
  the LOCO mark — and it is the one part of the UI that does **not** follow the app's chunky-sticker
  language or its theme. A card is an object, not a control.
- `--ease-bounce` for anything that should feel physical; `--ease-out` for travel.
- **Theme is applied by `initTheme()` in `entry.ts`, before first render.** It used to be written
  only by the toggle's own hook, so any screen without one (game over, a reload straight into a
  match) silently rendered light. The control now lives in the preferences panel, which makes that
  init call the only thing standing between a reload and the wrong palette.
- **Reduced motion is applied the same way and for the same reason**, by `initMotion()`: every
  reduced-motion rule in the CSS hangs off `:root[data-motion="reduce"]` instead of a media query,
  so the attribute has to be on `<html>` before the first paint. See `docs/notes/client.md`.

#### Day ↔ night crosses, it does not cut
`setTheme` writes `data-theme-anim` on `<html>` for `THEME_FADE_MS` (260ms, mirrored in `tokens.css`
as `--theme-fade`), and the blanket rule behind that attribute transitions colour — `background-color`,
`border-color`, `outline-color`, `box-shadow`, `color`, `fill`, `stroke` — across the whole document.
`themeTransition.test.ts` owns both halves.

It looked for a long time as though the content pages had a fade and the game did not. Nothing
animated the theme anywhere: `body` carried a lone `transition: background-color`, and on a page of
prose `body` **is** the visible surface, so that one property was the whole effect. In the game `#root`
paints the canvas over it and every panel, outline, label and shadow above that comes from a token, so
the same press swapped a full screen in one frame. That declaration is gone now and this rule is the
one definition, which is also why `content/theme-boot.ts` switches through `setTheme` rather than
writing `localStorage` and `data-theme` itself.

Four things about it are load-bearing:

- **The attribute lands in its own style recalc, before the colours move.** A transition compares the
  style before the change to the style after it; if the element only acquires `transition` in the same
  pass that its colours change, there was no transition in the "before" style and the swap is instant.
  Nothing in the CSS looks wrong when that happens. `void root.offsetWidth` between the two is the flush.
- **It comes back off.** A permanent `*` transition would put a quarter of a second of lag on every
  colour a live match moves — the active-colour ring, a catch button arming, a seat taking its turn.
- **Colour only.** A `transform` or an `opacity` in that rule would run over card flights, the
  reconnect curtain and every open panel for the length of the fade.
- **Reduced motion is not a branch in the script.** The rule is `!important` so a component's own
  `transition: color 0.15s` cannot leave its background cutting, and it still loses to
  `:root[data-motion="reduce"] *` — `(0,2,0)` against `(0,1,1)`, both `!important` — so a player who
  asked for less motion gets the instant swap back through the same attribute every other animation
  here obeys.

The boot never arms it: `initTheme()` and `theme-boot.ts`'s first paint call `applyTheme`, which only
writes `data-theme`. Fading there would cross the light palette into the player's actual choice in
front of them, which is the flash `themeFlash.test.ts` exists to prevent, animated.

### Colour assist (the suit silhouettes)
`SUIT_SHAPE` in `cardTheme.ts`, drawn by `SuitMark.svelte`, off by default and switched on from the
preferences panel. Triangle red, circle yellow, square green, diamond blue, sized at 15cqh under the
top-left value, plus the picker swatches and the active-colour chip.

- The card face is the brand and this writes on it, which is why it is a preference rather than the
  default. It is also the only accessibility setting in the game that decides whether somebody can
  play at all: legality is a colour match.
- Reviewed at **hand size**, not at hero size. At 72px wide the mark is ~13px and the square and the
  diamond start to converge, which is why 12cqh was raised to 15. Scene `card-sheet-assist`.
- Same two-pass ink as every other glyph: off-white alone is 1.18:1 on the green suit.

## Board scale (`layout.ts: boardScale` / `boardSpace`)
The board is laid out in a **fixed coordinate space** and scaled to the element by `<div .stage>` in
`<GameBoard />` (`transform: translateY(offsetY) scale(s)`, `transform-origin: 0 0`). The scale is
driven by the **shorter** axis — an ultrawide but short window has no vertical room to spend, and
scaling on width alone pushes the hand under the action bar.

- **Desktop**: design 1240×790, `clamp(min(w/1240, h/790), 1, MAX_BOARD_SCALE=1.45)`.
- **Phone** (`w < 560`): reference 405×830, `clamp(min(w/405, h/830), MIN_BOARD_SCALE=0.78, 1)` — the
  board scales *down* on a screen smaller than the one the cards were drawn for. A 390×844 phone is
  the reference and sits at ≈0.96; an iPhone SE or a 360×640 Android would otherwise show the same
  objects too big for the screen rather than a table seen from above.
- Between the two (560px ≤ w < 1240px) the scale is 1 and the responsive behaviour takes over.

`boardSpace(pxW, pxH, s, insets)` — **not** plain `px / s` — converts pixels to the virtual space. The board is
bracketed by two bands of **real chrome that do not scale with it**: `TOP_CHROME` (round badge,
theme/audio/rules cluster) and `BOTTOM_RESERVE` (the action bar, **plus the LOCO! chip's band above
it** — see "Action bar"). Both must stay constant in *pixels*.
Scaling them along with the board shrinks them on a phone — seat pills slide under the top buttons,
the hand under the action bar — and inflates them on a monitor into two bands nothing may use.
`offsetY = safeTop + TOP_CHROME * (1 - s)` pins the top band, and the height is solved so the bottom
one lands exactly on the action bar. The device's safe areas are part of that same arithmetic: the
element runs edge to edge so the room's picture can, and the coordinate space stops short of the
notch and the home indicator (see "Safe areas"). Asserted in `layout.test.ts`.

- `GameBoard` passes only the virtual size down. Children, `layout.ts` and every animation coordinate
  stay in that one space — nothing else knows about the scale, which is why cards, seats, felt, type
  and fliers all grow together.
- This is the fix for both "1440p shows the same small table surrounded by background" and "the cards
  are too big on a small phone". Do **not** solve that class of problem by bumping `CARD_W` /
  `SEAT_DIMS` — those are design-space constants.
- Deck and discard derive their centre from `tableRect` (`pileTop`), so the pair sits in the middle
  of the felt. Both take `topReserve` and `<GameBoard />` passes `seats.blockHeight` to the piles,
  the fliers and `tableRect` from one variable — mismatched reserves drift the fliers off the pile.

## Seat layout (`layout.ts: seatLayout`)
One function owns opponent seating because three callers must agree exactly: `<GameBoard />`
(renders the pills), `seatPosition` (anchors swap/steal animations), and `tableRect` (must not
slide the felt under the seats). When they disagreed, trails flew to empty space.

- Picks the largest pill size that fits the whole table on one row: `full` (172×66, desktop only) →
  `compact` (124×56) → `mini` (82×46, name + count, no card fan). Sizes in `cardTheme.ts:SEAT_DIMS`.
- Wraps to extra rows when even mini pills don't fit one row (nine opponents on a phone).
- X is spread **linearly**, not by `cos(angle)`: evenly-spaced angles bunch their projections at the
  extremes and outer pills overlapped from six players up.
- Non-mini pills keep `SEAT_EDGE` (28px) clear of both screen edges, mini pills only `SEAT_GAP`
  (10px). A row of full pills that technically fits but runs edge to edge reads as a toolbar, not as
  players around a table; mini pills only appear when the table is crowded and every pixel counts.
- Reports `blockHeight`; `tableRect(width, height, topReserve)` places the felt underneath it,
  clamps to `width - 20`, and keeps an oval aspect (rounder on phones, where a wide oval leaves dead
  bands above and below). The felt takes 74% of the band it is given (capped 440) — at 62%/400 a
  third of the play area was bare background.
- Seats clear `TOP_CHROME` (58px) so they never sit under the round badge / theme / audio / rules
  cluster.

## Action bar (`<ActionBar />`)
- **Fixed three-column grid, never a content-sized flex row**: draw left, the reaction button centre,
  pass right. Slots (`data-slot="left|center|right"`) keep their column empty or not, and the bar's
  own width is constant (`--slot-w` ×3 desktop, three `1fr` columns edge-to-edge under 480px), so
  every control sits on the same screen pixel all match long. LOCO is a reaction game — a player
  parks the cursor over the centre *before* the card that needs it lands, and a bar that reflows when
  the penalty draw appears moves the target out from under them.
- **Reserving the column was only half of it: every column holds its button all match and goes dead
  rather than away.** Draw and pass used to be rendered only on our turn, and the slot they left
  behind was empty — the grid held, so nothing moved, but on somebody else's turn the bar became one
  lone pill floating in a wide trough. That is not a neutral state: the bar's outline and the pill's
  outline pinch to a point where they pass each other, so a shape appears at each end of the button —
  little teeth that come and go with the turn, on the one surface that exists to be aimed at without
  being looked at. The silhouette must be the same object all match. It is also the same argument the
  centre column and the LOCO! chip are already written to: a control drawn only while it is pressable
  is one the player has never once looked at before the moment they need it. `game-opponent-turn-quiet`
  is the scene — the bar at its emptiest, every button absent or dead at once.
  - **The penalty draw is the one swap left, and it is ours only.** `Piocher +N` recolours and pulses
    in the left column because a live stack is the most urgent thing in a round; on somebody else's
    turn the stack is theirs to answer, so the column stays the ordinary draw, dead. The loudest
    object on the screen does not belong to a turn we are not taking.
  - **A dead draw wears the neutral fill** (`.btnDrawSecondary`), not the primary gradient and not a
    bare button: an unstyled disabled slot reads as a hole in the bar rather than as the same object,
    off.
- **The other half of that decision is that there is no keyboard shortcut for any of it**, and there
  never will be: the controls hold their coordinates so they can be aimed at, and aiming is the only
  way in. The reasoning, and the global-versus-focused line that keeps the accessibility path intact,
  is in [`client.md`](client.md) ("No gameplay keyboard shortcuts, ever").
- **The centre column is Catch's, all match, and nothing else may ever be in it.** Catch is the
  hardest button in the game to hit — it opens on someone else's mistake and lives for seconds — so
  it sits there mounted the whole match and is only ever **enabled and armed in place**. It is never
  mounted/unmounted: a button that appears is a button you have to find first.
- **Three readable states, not two.** *Dead* while every other hand is above
  `CATCH_LIVE_MAX_HAND` (2) — the opening of every round and most of its middle. *Awake and
  pressable* as soon as any other seat is at two cards or fewer
  (`components/catchAvailability.ts`), i.e. one ordinary play before the server can name anybody:
  a control that only unlocks on the server's cue can be answered but never anticipated, and five
  seconds is not long enough to find a button in. *Armed* for the seconds a seat actually owes the
  call. The middle state is what the price in §14.6 is for, and `game-catch-live` is its scene.
  - **It is looser than the server's window by exactly one play, and no more.** The looseness buys
    the anticipation; a wider one buys a stretch of round where the press can only miss, and a miss
    a player can plan is a card drawn on purpose — see `domain-rules.md`, "The threshold is what
    keeps the price from being buyable".
  - **A declaration the table has heard takes nothing away from it, and that is a rule.** Hand sizes
    decide the middle state; nothing else may. A seat on one card that just called it cannot be
    caught, so the press will miss and cost a card — and the button keeps offering it, because going
    dead there would **say the call happened** to a player who was not listening for it, and because
    that press is precisely the one §14.6 charges for: the thumb already committed when the seat
    shouted. Three states, and only the third one is a promise. What the declaration closes is the
    *armed* cue, which rides `catchTarget`.
  - **And once awake it stays awake until a card is played** (`nextCatchLive`, `store.catchLive`).
    The declaration is only the first of four ways a seat leaves the band with nothing played: it can
    also draw, swallow a stack of four, or take two penalty cards from a Contre-LOCO! that landed on
    it. All four are the instant a bet on that seat has already been made, so **the middle state
    never falls under a thumb**. What ends it is the next card reaching the discard: the hold drops
    and the roster is read again, which is what keeps the offer attached to one board instead of
    standing open to be farmed. Two writes lower it, `applyCardPlayed` and `applyGameState`; nothing
    on screen may lower it on its own.
- **`.armed` is the same cue on Catch and on LOCO**, applied to Catch when `catchArmed` and to LOCO
  whenever it is shown: a punch-in (`armPop`, with a brightness flash) plus a pulsing halo
  (`armGlow`, tinted per button by `--arm-glow`). Deliberately identical — the two are the same
  wager seen from opposite sides of the table, so the player about to be caught must not get a
  louder cue than the player who could catch them. Under `prefers-reduced-motion` it degrades to a
  **static halo**, not to nothing: "this just became clickable" is information.
- **LOCO! is a chip centred above the bar** (`.locoSlot`, `position:absolute`, `data-slot="loco"`),
  out of the grid so it moves no column, **mounted the whole match** and enabled only while
  `handSize === 1 && !hasDeclared`. It followed Catch here, and for Catch's reason: it was drawn only
  in the seconds it was owed, which meant every player met it for the first time inside the window it
  was for. It is dead the rest of the time and that is the whole state — nothing appears, nothing
  leaves, nothing moves. `actionBar.test.ts` asserts the slot, the enabled state and the arming of
  every button across states.
- **It is drawn small, quiet and under 44px, and that is a product decision.** Forgetting the call is
  one of this game's turns — the round where somebody notices too late is the round people talk
  about — so the chip may not read as a fourth action competing with the centre column. 30px tall,
  13px type, `opacity: 0.55` while dead, and its touch target comes from `.hit-target` **only while
  it is live**: a dead control does not need a 44px catcher, and a live one must not steal a tap from
  Catch, which is why the 10px gap above the bar is 3px more than the target overhangs.
- **The band it sits in is part of `BOTTOM_RESERVE`** (140px: 82 for the bar, 58 for the chip), so
  the hand is dealt above it permanently. A chip that fitted only when it lit up would appear inside
  the fan, over the card the player is about to play. Raising or lowering the chip means changing
  that constant in `cardTheme.ts` — never nudging the hand.
- The penalty draw and the ordinary draw share the left slot; `--slot-w` (126px) is sized for the
  widest label either can hold ("Piocher +4").
- **A declaration is a one-shot, and the button is spent with it.** `Room.DeclareLastCard` refuses a
  second call on the same single card (`player already declared`, the string `CatchUndeclared`
  already uses), and the flag only clears when `openCatchWindow` opens a fresh obligation on that
  seat — i.e. a Swap or a GlobalSwitch handing it a card nobody has heard called. Client-side,
  `store.myDeclared` — our own seat read off `store.declaredSeats`, which `applyUnoDeclared` writes
  from the *server's* confirmation and never from the click — disables the button in place: it goes dead in its own slot rather than disappearing, because
  nothing in this bar may move mid-match. Without either half, LOCO! could be
  spammed for as long as the card was held, replaying the banner and the sting each time.
  `hub.handleDeclareUno` deliberately does **not** `noteSuspect` that one rejection: a second call is
  a double tap or a message already in flight, not an attack.
- **The declaration button reads "LOCO!" / "LOCO !"**, not UNO — it is the game's own call. Only the
  visible strings changed: the wire types (`declare_uno`, `uno_declared`), the store fields and the
  E2E helper key stay `uno*`.
- **The catch is "Contre-LOCO !" in French and stays "Catch!" in English**, and that asymmetry is
  deliberate: French UNO players say *contre-UNO*, so the pair LOCO/Contre-LOCO is the vocabulary
  they already have. English has no equivalent term — players *call someone out* or *catch* them —
  so "Counter-LOCO" would be an invented word imposed on the one language that doesn't need it. The
  code keeps `catch*` everywhere (`catchBtn`, `catchWindow`, `catch_uno`, `canCatch`).
- `--slot-w-mid` (172px) is therefore sized for the **French** label; the columns must not resize
  when a player switches language mid-match.

## Mobile
- Seats resize and wrap automatically (see "Seat layout"); nothing about the table is hard-coded to
  desktop. Verify with `make visual ARGS="--viewports=mobile"`.
- All action buttons: `min-height:44px`, `touch-action:manipulation`.
- 400ms debounce (`guardDoubleTap`) on action buttons.
- Wild picker: 64px+ touch targets in a row.
- HTML viewport: `width=device-width, initial-scale=1.0, viewport-fit=cover` and **nothing else**.
  It used to carry `user-scalable=no, maximum-scale=1.0` to stop a double-tap zooming the board
  mid-match, and that took pinch-zoom with it on every page of the site. The double-tap is answered
  by `touch-action: manipulation` on `body`, which leaves the pinch alone; a board can now be
  pinched during a match, deliberately. `a11y.test.ts` fails on either attribute returning.
- CSS `@media (max-width:480px)` for small screens — a **layout** breakpoint: a bar that has to run
  edge to edge, a table that has to drop a column. **A panel that changes shape does it at 46rem**,
  which is where the navigation becomes a burger and where all four sheets flip together; see
  "One sheet, four surfaces" in [`client.md`](client.md).

### Safe areas (the notch and the home indicator)
The page owns the whole screen and keeps the game off its edges. Both halves are needed: without
`viewport-fit=cover` iOS confines the page to the safe area and fills the notch and home-indicator
bands with the **root element's own colour**, which put two bright violet strips across a room lit
like a nightclub; with only the cover flag, the action bar would sit under the home indicator's
swipe bar and the round badge under the status bar.

- `--safe-top` / `--safe-right` / `--safe-bottom` / `--safe-left` in `tokens.css` wrap
  `env(safe-area-inset-*)`. Every piece of chrome anchored to an edge offsets itself by them
  (`.topRight`, `.roundIndicator`, `.turnTimerBar`, `.actionBar`, and the padding of every screen
  container). Zero on any device without a notch, which is why they are plain `calc()` and not a
  media query.
- **`layout.ts: boardSpace` takes the insets**, so `TOP_CHROME` and `BOTTOM_RESERVE` are measured
  from the *safe* edge and the whole coordinate space stops short of the bands. The board element
  still runs edge to edge: the room's picture uses the difference, the game does not. `offsetX` is
  the landscape half of the same rule (a phone on its side puts the notch on one flank).
- `safeAreaInsets` reads the numbers back through a hidden probe whose padding is the `--safe-*`
  tokens, and re-measures on `resize`/`orientationchange` only. An `env()` held in a custom property
  reads back as the unresolved token in several engines, so the resolved computed padding is the
  only reliable source. Reading the *tokens* rather than `env()` directly is also the seam the
  capture harness overrides.
- **A match in a map pins `<html>` to `--room-void`** (`<GameBoard />` sets `data-room` on the root).
  The browser paints anything the page does not own with the root's colour, so this is the only
  thing that can reach a band left over by a floating browser bar. A violet strip across a dark room
  reads as a broken layout; the same strip in the room's shadow reads as the room.
- Review it with `make visual ARGS="--viewports=notch"` — no desktop browser reports an inset, so
  that viewport is the only place this layout is visible at all. `layout.test.ts` owns the maths and
  `safeArea.test.ts` owns the wiring through to the stage's transform.

### The chip row takes no space, so the screen under it has to give some
The gear, the speaker and the "?" are one absolutely positioned row in the top-right corner of every
screen that has them. Absolute means they are out of the flow: the column below them has nothing
telling it they are there, and the container's **top padding is the only thing** holding the first
element off them. That padding used to be a spacing step chosen because it looked generous —
`--space-xl`, 32px — while the chips are 40px tall sitting at `--space-base`, so they reach 56px. The
24px of overlap cost nothing for as long as every screen's content was short enough to be centred.

The waiting room is the one that is not. Roster plus host panel plus two actions plus the leave link
overflows a phone, and `justify-content: safe center` then does exactly what it is there for: it
stops centring and parks the content against the top padding. That is the state in the bug report —
"The table" printed underneath the gear on a private table.

So the reserve names the chip instead of guessing: `--topbar-h` in `tokens.css` is that 40px in one
place, and the container's padding is `--space-base + --topbar-h + --space-sm + --safe-top`, which is
the row's own offset, its height, and a gap. Two tests in `waitingRoom.test.ts` read the rule off the
component's `<style>` block, because nothing renders here — jsdom applies no stylesheet and the
overlap only exists at a width and a content height a unit test does not have. A screen that grows
past its viewport gets the same padding; one whose content is always centred does not need it, which
is why the other five still carry a spacing step.

### The host is told what they are choosing, where they choose it

Two decisions were being made blind. How long a format takes and how many seats a table wants both
had advice written down — in the FAQ and in the rules page, which is to say nowhere near either
control — so a host who had never played a best-of-7 at six seats found out by playing one.

- **The length rides the format button itself** (`matchLengthModel.ts`), a second line under the
  label rather than a note beside the row: the whole promise is then the thing being pressed, the
  same shape the 1v1 button's own hint has.
- **It is a range and it carries an `≈`.** A match ends the moment the lead in rounds won cannot be
  caught, so a best-of-7 finishes anywhere between four rounds and seven. A single figure would be
  wrong at both ends, and wrong in the direction that costs the table: a host who reads "≈ 30 min"
  and gets an hour stops offering long formats. The model is pure and unit-tested for that reason —
  it is the part with arithmetic in it, and `fastestRounds` is the client's statement of the same
  rule `Room.decisiveLeader` enforces.
- **It reads the roster, not the seat cap.** The cap is what the table *could* hold; the question is
  how long the evening will be with the people who are actually here, and it moves as they arrive.
- **The seat advice is a hint under the field**, in `--color-muted` — quiet is a hue here as
  everywhere, never an opacity on the ink. Both are host-only: a guest is not making either choice,
  and advice about a control somebody cannot reach is noise.

## Active colour (four readings, `<DiscardPile />` + `GameBoard`)
The colour in play is the single most-consulted piece of state on the board, and it was stated in
exactly one place — a ring around the discard. Players kept asking where it was. The ring is not
hard to see; it is hard to *know it means that*, and on a wild (black face, no colour of its own)
it was also the only thing saying anything at all. Four readings now, at four distances:

- **The pool** (`.pool`) — coloured light spilled on the felt around the discard, sized well past
  the card. What a viewer gets at 720p without looking for it. Deliberately low and blurred: the
  table stays near-black and card edges keep winning, which is the rule the felt exists for.
- **The ring** (`.ring`) — unchanged, the precise statement.
- **The chip** (`.chip`) — a solid token set into the ring's bottom-left, mirroring the `+N` badge's
  corner so the pile has two fixed places to look and this one is *always* occupied. It carries the
  suit's whole gradient (`SUIT_PAINT`), so it is literally the paint of the `<ColorPicker />`
  swatch that was tapped and of the cards it now lets you play — a flat sample would be a fourth
  colour to learn.
- **The callout** — `GameBoard` announces the colour by name over the pile (`fxTexts.colors`,
  `ACTIVE_RING` tint) **only when the top card is a wild**. Any other card carries its colour on its
  face, and announcing what the player can already read is noise. This is the one that teaches a new
  player that the other three mean anything, and it is what a muted highlight clip needs to show
  "he changed it to green". Delayed by `COLOR_CALLOUT_DELAY_MS` (420ms) past the `+N` callout a
  `wild_draw_four` also fires, so the two read as a sequence instead of stacking on the same pixels.

All three permanent cues are keyed on the colour, so a wild resolving replays them together.
Scene `game-wild-active-color`; `src/test/discardPile.test.ts` covers the chip and both callout
branches.

## Maps (the room a match is played in)
A map is **three things and nothing else**: a backdrop, a table, and an accent colour. It changes no
rule, no card and no timing. Four ship: **Neon** (rooftop club), **Rune** (arcane tavern), **Velvet**
(art-deco lounge), **Orbit** (starship hangar).

- **The draw is server-side and per match.** `game/maps.go` (`MapID`, `MapIDs`, `Room.pickMap`);
  `Room.Start()` writes `Room.MapID`, `BeginNextRound` keeps it, `ResetForRematch` clears it so the
  next match gets a new room. Exported as `GameStateDTO.map_id` on **every** snapshot, not just
  `game_started`, so a reconnecting player rebuilds the same table as everybody else.
  - It has to be the server's even though the consequence is purely visual: two players in one room
    describing two different tables to a viewer is a table that does not exist, and a clip cut
    between two seats would jump between two rooms. Hashing the room code client-side would agree
    just as well but would freeze a room's map forever, and a rematch is meant to feel new.
- **`tableRect()` remains the single authority on the board's geometry.** A map replaces how the felt
  is *painted*, never where anything is: piles, seats, direction ring and every animation coordinate
  are identical with or without one. `maps.ts` names each table's `playfield`, the sub-box of
  `table.webp` holding the playing surface, four numbers measured off the art, and
  `layout.ts: tableImageRect()` solves for where to draw the picture so that box lands on the felt.
  The result deliberately overhangs the felt on every side: rim, base and cast shadow are most of
  what makes each table a different object, and cropping to the felt would cut them off.
- **The backdrop is blurred, the table is not.** `.board[data-map]::after` paints a second copy of
  `room.webp` (`background-image: inherit`, so one place still names the file) at `blur(0.55vmin)`
  behind everything, which is depth of field: the room is behind the table, and a photograph in
  focus competes with a card edge, the one contest a card must always win at 720p. The radius is in
  `vmin` because the board scales with the viewport, so a fixed one is a haze on a phone and a smudge
  on a 1440p monitor. Slight on purpose, and `<MapLoadingScreen />` keeps its backdrop **sharp**:
  that screen exists to show the room, this one to play on the table. The layer needs
  `isolation: isolate` on `.board`, since a negative z-index otherwise escapes to the nearest
  stacking context and lands behind the element's own background.
- **The accent is light, not chrome.** It tints the glow pooled under the table, the ambient wash,
  and the direction ring's chevrons (as an 85% white *wash*, never the raw accent). It deliberately
  does **not** reach `--color-primary`, the active seat's gold, or any card face: those are what a
  viewer reads game state off, and a state cue that changes colour with the scenery is a cue that has
  to be re-learned four times.
- `resolveMap()` returns **null** for an unknown or empty id, and null is a first-class answer: a
  lobby has no map, and a server shipping a new one before the client has its art must degrade to the
  built-in felt rather than to a blank table. Same reason `map_id` is a bare `z.string()` in
  `protocolSchemas.ts` and not an enum: an enum would drop the whole `game_state` in dev.
- Art lives in `client/public/maps/<id>/{room,table}.webp` (~1.6 MB total). `make maps
  ARGS="--src=<folder>"` (`tools/maps/prepare.mjs`) crops and re-encodes it. **Which source file is
  the table is read off the alpha channel, never the filename**, since the renders come out of the
  generator named after their timestamp, and an earlier pass that guessed by frame brightness got
  every map backwards. The table is cropped to its alpha bounding box, which is what makes the
  `playfield` fractions honest. **The source folder holds one folder per map and nothing else**:
  every directory under it is a map, so anything parked beside them aborts the run on "expected
  exactly 2 images" — halfway through, having already written some of them. A replaced render is
  not kept: the map that ships is the one on disk.
- Scenes `game-map-neon` / `-rune` / `-velvet` / `-orbit` / `game-map-loading`. **The playfield
  numbers are measured by eye off the art, so a drifted table shows up in `make visual` and nowhere
  else**, so review any change to the art or to `tableImageRect()` there.
- **The felt's shape at 1× is `tableRect()`'s, never the art's**, and the second number to watch is
  the *scale*: the picture is drawn `1 / playfield.w` times the felt's width, so a table whose rim is
  wide in its own file is a table that runs off a 16:9 screen and takes the room with it. Neon sits
  at 1.17×, and past about 1.4× the board stops reading as a table in a room. **`rune` and `orbit`
  buy that back**: their playfields are widened beyond the painted felt (~8% and ~20%, 1.53×/1.48× →
  1.41×/1.27×), which is why the chevrons there sit on the inner lip rather than on the felt.
  Deliberate, and the reason not to "correct" those two back onto the felt by eye.
- **The third number decides whether a table is an object at all, and it is the box's own aspect.**
  The image is drawn with `object-fit: fill`, so a playfield whose aspect is not the felt's — 2.18:1
  on a desktop — stretches the whole table by exactly the difference, and the *sign* of it is what
  matters. Drawn taller than it was rendered, a table gains apparent height and reads as something
  standing in the room: velvet is drawn 1.67× taller and is the deepest of the four, neon 1.14×.
  Drawn flatter, it loses the one cue saying it is not painted on the floor — which is what `orbit`
  did at 0.82×, its platform being the only one shot from high above (1.78 against velvet's 3.64).
  **So `orbit`'s box is the 2.18 rectangle inscribed in that platform, not the platform's outline**:
  1.00×, undistorted, and 1.27× rather than 1.41× into the bargain. The felt no longer reaches the
  painted surface top and bottom, which costs nothing — the piles sit at the centre and the chevrons
  are inset anyway. Rune's 0.89× is the floor and stays there, its carved frame being thick enough
  to carry the depth its surface loses; `maps.test.ts` reads the shipped `.webp` headers and fails
  under it. **New table art wants a felt at 78–85% of the file's width and roughly 0.40 as tall as
  it is wide** — art drawn to that needs none of this.
- **A map is tried before it is submitted, not after** (`tools/maps/scene-tester.html`). Measuring a
  `playfield` means seeing the felt land on the picture, and until this existed the loop was: guess
  four numbers, add a scene, run `make maps`, run `make visual`, read a screenshot, guess again. A
  build and two harnesses for a rectangle. The tester rebuilds the board around a dropped room and
  table: the layout maths is a transcription of `layout.ts` and `cardTheme.ts`, the paint one of
  `GameBoard.svelte`'s style block, and the alpha work (which picture is the table, its bounding
  box, the WebP qualities) is `prepare.mjs`'s, so **what it previews is what `make maps` would
  ship**, including the `.png` an image generator hands over, which it crops and re-encodes in the
  page. It emits the `maps.ts` entry and both `.webp` files.
  - **The fidelity is checked, not claimed.** Diffing the DOM against the running game at
    1920×1080 on `neon`, every written value matches: the stage's transform and size, the table
    image's box, the glow, the ring and its first chevron. That is why `px()` does not round. What
    is *not* faithful is the furniture: cards carry the right box at the right place but not
    `CardArt`, the seat pills carry `SEAT_DIMS` and a simplified drawing, and the action bar and
    top row are ghosts marking the reserves they own. None of it decides where a table lands.
  - **It is a transcription, which makes it a copy that can drift.** `layout.ts`, `cardTheme.ts`'s
    constants, the board's style block and the four playfields of `maps.ts` move with it in the
    same change set: a tester that lies approves a table the game then draws somewhere else, and
    nothing downstream would catch it. Nothing imports it and no test covers it. Deliberately: it
    ships nothing.
  - **One file, opened off the disk, no `make` target**, because it is handed to whoever is making
    the art. Two consequences, both deliberate: the two families come off a CDN, which
    `client/` may never do and this may because it reaches no player; and a `file://` origin cannot
    read pixels back out of a repository file, so the four reference maps load as pictures and skip
    the alpha pass they no longer need. A dropped file is a data URL and measures normally.
  - The accent it guesses is a starting point and says so. It ranks pixels by saturation times
    brightness and averages the top tenth, because the light source is never the largest thing in
    a frame these rooms keep mostly dark: the first pass took the dominant colour and returned the
    backdrop, the one colour the glow must not be.

## Card face (`CardArt.svelte`, `cardArtSpace.ts`, `locoMark.ts`, `cardTheme.ts`)
Reproduced from the brand's own card art. Review any change to it with
`make visual ARGS="--scenes=card-sheet"` — the whole deck on one screen, which no gameplay scene
shows.

- **The face is CSS; the mark is a shared mask image; only the rule glyphs are still SVG.** Face,
  watermark and wild fan are all laid out in the same `1000x1500` space, expressed as percentages of
  the card box, and the two are both 2:3, so the mapping is uniform and a CSS rotation lands where the
  SVG one did.
  - This used to be one `<svg>` per card, and it was **the board's single biggest rendering cost**. A
    busy table carries ~50 card faces and backs at once (hand, both piles, every opponent's mini fan)
    and most of them sit under a scale animation, so each one re-filled the mark's 130-odd even-odd
    segments under a gradient, every frame. Measured on the showcase, median of five runs: Firefox
    compositing in software went **3.0 → 9.8 fps** on a full hand and **4.7 → 14.9** on a map, i.e.
    2.3–3.3× depending on the scene. Chromium throttled 6× on CPU went 55 → 59 and sat on the vsync
    ceiling elsewhere, because that throttle constrains script far more than raster, which is why it barely
    registers a raster fix. The win is a cache: `MARK_MASK_URL` is **one string for the whole app**,
    so the browser rasterises the path once per used size and every card composites the same bitmap.
    Build it per card or per suit and the cost comes straight back.
  - `card.test.ts` guards both halves: no live `<path>` carrying `LOCO_MARK_PATH`, and one mask URL
    across every suit. Nothing else in the suite can see this regression happen.
  - **An `objectBoundingBox` gradient is `to top right`, never the angle of the diagonal.** The two
    differ on any non-square box: SVG lays the gradient out on the unit square and *then* stretches
    it onto the box, so its colour bands stay parallel to the other diagonal, which is exactly what
    CSS's corner keyword does. An explicit angle keeps its bands perpendicular to itself and swaps
    the two off-diagonal corners. This shipped wrong once and only `make visual` caught it.
- **The card box and the mark box are two different boxes** (`cardArtSpace.ts`). The card box has the
  card's proportions; the mark is landscape. Reusing the mark's viewBox as the card's — which the
  previous portrait mark got away with — stretches the drawing to the card and turns the duck into a
  goose. It lives in its own module so `CardArt.svelte` exports components only (same reason as
  `hasGlyph`).
- **On a card the mark is cropped and tilted; everywhere else it is whole.** `MARK_CROP_TRANSFORM`
  (`MARK_TILT_DEG` 22°, `MARK_S` 1.95) blows it past all four edges, the way the reference art does;
  `markFitTransform(frac)` is the whole-mark placement. The tilt is what keeps the zoom sane: a
  landscape drawing spanning a portrait card's full height needs ×2.6 square, ×1.95 at 22°. The
  angle's *sign* matters — the duck's head is at the left of its own box, so a clockwise tilt lifts
  it into frame and a counter-clockwise one drops it off the bottom corner. Below `MARK_S` 1.87 the
  crop silently stops being a crop and the dead bands come back.
  - A landscape mark sitting politely centred in a portrait card leaves two dead bands and reads as a
    placeholder. The crop is what makes a card look *printed*, with artwork running under the value.
- The crop applies to the **shape alone**, because it lives inside the mask. The gradient underneath
  never leaves card space, so both gradients span the same line on the card by construction and the
  reversal below is simply the same angle with the stops swapped. (As a filled path it was not: the
  mark's gradient lived in the mark's own space and its axis had to be the card's axis mapped back
  through the crop, inverse rotation included.)
- **The watermark is the face gradient reversed.** `SUIT_PAINT[suit].mark` is `[to, from]`. That one
  trick is the entire art: the mark is brighter than the card where the card is dark and darker where
  it is light, so it never needs an outline, a tint or an opacity to stay legible. Run the two
  gradients the same way and the mark vanishes into the face at both ends.
- `LOCO_MARK_PATH` is the brand mark: a **geometric wireframe duck**, landscape (`712x576`), 15
  subpaths, **even-odd** — the facets between the bars are holes, which is what makes it read as a
  wire drawing rather than a solid animal. It comes **straight from the designer's source file**
  (`logo_canard_geometrique.svg`) and is unmodified. Do not redraw, retrace or tidy the numbers.
  Every brand surface derives from this one path — card watermark, deck back, felt, logo, favicon —
  so a change here lands on all five at once.
  - It replaced a low-poly flamingo that had been traced back out of the reference card art, with its
    eight bleeding side facets reconstructed by hand. That path was always a stand-in; the note that
    said "replace it wholesale if the original logo file ever turns up" is what was acted on.
- Suit gradients run along the card's bottom-left → top-right diagonal at `SUIT_ANGLE_DEG` (35°), and
  the values are measured off the reference, not eyeballed.
- **The colour-change card is named by its four suits, never by a letter** — players read the shape,
  and "W" is also a word in one of the two languages. The four-suit fan belongs to `wild` and
  `wild_draw_four` only; `global_switch` names a colour too but its subject is the rotation, not the
  colour, so it keeps the bare black face and its own glyph: three identical fans would make the
  three wilds one card at a glance.
- **Rule glyphs are drawn, not typed.** ⊘ ⇄ ⇋ ↻ are the obvious characters and the wrong tool:
  Fredoka carries none of them, so the font fallback chain would decide what a rule card looks like.
  **That argument does not stop at the card.** It was written here, tested on the card by
  `card.test.ts`, and then the rules copy went and named the same two cards `Échange (⇋)` and
  `Rotation (↻)` — the exact characters this line rejects, four bullets below five siblings that
  name their card in words alone. The parentheses are gone: Swap and Global Switch are the two cards
  a first-timer has no slot for, and the answer to that is the "Cards" tab beside the bullet, where
  the face is drawn. The rule is enforced across every surface now, by `drawnGlyphs.test.ts`.
- **The four ways a match ends are drawn too** (`components/OutcomeMark.svelte`, one component at two
  sizes). It was 🏆 / 😔 / 🏳️ / 🚪 in a nested ternary at the head of the game-over card, which is
  the one frame in this game most likely to be clipped for a stream and was the only part of it
  nobody here had drawn. An emoji is rendered by the reader's OS — `🏳️` carries a variation selector
  that Windows, Android and iOS resolve differently — so it arrives at a weight and a hue nothing
  chose and takes neither the ink outline nor the hard bottom shadow.

  The replacements are in the game's vocabulary, not a picture library's, and each one is the thing
  it is about rather than a symbol for it: **winning is the mark itself** in `--color-secondary`, the
  gold the scoreboard and the evening recap already win in; **losing is the cards still in your
  hand**, drawn at the trim as a held fan, which is literally what lost the round; **a forfeit is one
  card face-down**, filled rather than outlined because it is the one object on that screen
  deliberately opaque, with an arrow when the seat that walked is ours. No trophy, and **no face**: a
  sad face tells the player how to feel about a hand of cards, and it is the one drawing here that
  could not survive being read by somebody who just lost. `size="sm"` puts the same win drawing on
  the round summary's winner line — one event at two scales — and it holds still there, because a
  glyph that bobs inside a line of type takes the sentence with it.
  `hasGlyph` (in `cardTheme.ts`, so `CardArt.svelte` exports components only) lists the kinds that get
  one. Swap and GlobalSwitch deliberately do not share a silhouette.
- **GlobalSwitch is three cards in a ring, each moving to the next seat** (`rotatingHands`), not the
  single circular arrow it started as. That arrow is the "refresh" pictogram: it says *something*
  turns without ever saying the cards do, and it was read as "redraw your hand". Both halves of each
  connector carry weight — the curved shaft is the only thing that says the three go *round*, and a
  bare arrowhead at this size reads as a wedge pointing at whatever is nearest. Three cards can also
  never be mistaken for Swap's two crossing arrows, which is the trade between exactly two seats.
- **A glyph may carry its own stroke widths** (`twoPassGlyphs`): the wild fan and the ring of hands
  both close up into solid bars at `GLYPH_STROKE`. Such a glyph has to be *drawn twice from scratch*
  rather than letting the ink pass re-render the same element wider, because a child `stroke-width`
  beats whatever the pass sets on its group.
- **Value top-left, monogram bottom-right — the reference's two marks in its two corners, swapped.**
  The reference is a hero shot of one card; in a hand the fan overlaps down to the left ~30% of each
  card, and branding that sliver leaves a player holding twelve cards that all say "L". The wild
  already reads value-first in the reference, so this is also what makes every card consistent.
- **Every glyph is ink-outlined, and that is accessibility rather than styling.** Off-white measures
  **1.18:1** on the green suit and 1.46:1 on yellow; no single flat ink fixes it either (dark ink is
  1.66:1 on blue). Outlined, the glyph is ~15:1 against its own ink and the ink ~14:1 against any
  face. Numerals get `-webkit-text-stroke` + `paint-order: stroke fill`; the SVG glyphs are stroked
  icons with no fill to outline, so they are **drawn twice**, a wider ink pass first. The suit
  colours are never darkened to buy contrast — they are the brand.
- The face does **not** follow the light/dark theme. A card is a physical object; the same card in
  two themes is two cards.
- `CardBack` is the wild card's face plus the **same cropped, tilted mark every face carries**, in
  all four suits at once — the one place the full palette appears. The paint is what makes it a back;
  the framing is a card's, like everything else in this space. It briefly also carried the whole mark
  on top and showed the duck twice at two different angles, which reads as a rendering bug. It drops
  the art below `ART_MIN_W` (26px) and carries an inner light rim, without which a mini fan of eight
  backs merges into a single black bar.

## Card rendering layer

Svelte throughout, and the movement is the browser's: `Card.svelte`, `CardArt.svelte`,
`CardGlyph.svelte`, `CardBack.svelte`, `SuitMark.svelte` and the glyph geometry as data in
`cardGlyphs.ts` for the face; `Hand`, `DiscardPile`, `PlayerSlot`, `TurnIndicator`, `AnimationLayer`,
`GameBoard`, `GameView` for everything that moves them. There is no animation runtime any more —
flights are `element.animate` through the `use:play` action in `AnimationLayer.svelte`, and the fan's
reflow is a CSS transition. The bridge that mounted a Svelte face inside a JSX tree is gone with the
tree; `setNode` survived it, because handing the node back is still how the flight layer gets the
real element.

> **Two things bit during the port and will bite again.**
> **Svelte keeps a whitespace text node where JSX dropped one**, so a card laid out one element per
> line reads as `"     L"` instead of `"L"` and `card.test.ts` fails on the corner mark — the
> children of `Card.svelte` and `CardArt.svelte` therefore run together with no line breaks, on
> purpose. And **a `<script lang="ts">` keeps its imports after type-stripping**, so a type imported
> as a value reaches the bundler and `protocol.ts` (generated, types only) is asked for a runtime
> binding it does not have; every such import is `import type`.
- `<GameBoard />` is the root; it tracks container size via `elementSize` (ResizeObserver) and passes width/height to children that absolute-position in pixel coords.
- Layout helpers (`src/components/cards/layout.ts`): `clockwiseOpponents`, `opponentBubblePositions`, `calcHandSlots`, `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys` — all pure, reused by tests and animations.
- Animations live in `<AnimationLayer />`: an array of `Flier` items (flying card faces or backs) plus `EffectText` floats. Each entry self-cleans on its animation's `finish` → parent `removeFlier`/`removeEffect`.
- Animation triggers (inside `<GameBoard />`), in effect-declaration order:
  - **Opponent play**: keyed on `lastPlay.at`; flies the card from `seatPosition(actor)` to the discard with `arcHeight`. Skipped when the actor is the local player. Sets `suppressNextDiscardFx`.
  - **Card play (own)**: `flyCardFromHand(card, idx)` computes the source slot from `calcHandSlots` and spawns the arced hand→discard flier. Sets `suppressNextDiscardFx`. **It only runs once the play is committed** — `props.onCardClick` returns a boolean ("did the card leave the hand?") and the flier is spawned only on `true`. A tap the client refuses (`clientMayPlay`/`clientMayInterrupt` say no) animates nothing: flying the card out and snapping it back reads as a bug, not as "illegal card". Plays confirmed later (wild colour, swap target) fire it through `flightRef` — a `GameBoardHandle` the `<ColorPicker />`/`<PlayerPicker />` callbacks in `GameView` call after `onSend`.
  - `GameView.handleCardClick` also refuses to open a picker for a card `clientMayPlay` rejects — prompting for a colour and then having the server reject the card is the same broken promise as the animation. **The check runs before the prompts, not after**, and that order is the whole rule: the three wilds always match, so gating them changes nothing, but **Swap is a coloured card** and follows ordinary matching. Behind the prompts, an off-colour Swap was the one card in the deck that asked for a target, took the answer, and *then* came back refused with "illegal card play" — every other unplayable card ignores the tap in silence, so it read as the card behaving differently rather than as an illegal play. `realtime.test.ts` covers both branches (refused Swap opens nothing, playable Swap still prompts).
  - **Discard top change (any source)**: `suppressNextDiscardFx` suppresses **only the generic pile flier**, never the SKIP/REVERSE/+N callout — playing your own Skip must announce itself too. Callout text from `effectFor(card, pendingDraw)`.
  - **Hand grew by 1**: deck→last-slot card-back flier (draws).
  - **Swap / GlobalSwitch**: trails spawned on `swapNotice.at` change.
- Hover lift: CSS-only (`Hand.svelte`) — `.slot.hovered .card { transform: scale(1.08) translateY(-14px) }`.
  **The turn pill's reserve is that transform written out** (`TurnIndicator.svelte`: `PILL_H +
  REST_LIFT + HOVER_LIFT + CLEARANCE`, where `HOVER_LIFT = 14 × 1.08 + 0.04 × CARD_H`). It was a
  flat 58px, which cleared the 9px rest lift and nothing else, so a card under the pointer put its
  top ~20px into the pill. Change the hover and the reserve follows; change the reserve by hand and
  it stops being true.
- **The card's transition is `transform` alone.** It also tweened `box-shadow`, and nothing the
  hover does moves the shadow — the one shadow change a card in hand ever sees is the playable
  glow, which flips for the whole fan at once on a turn change and was being tweened on every card.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`, `PlayerSlot .slot`) is pinned at `left:0;top:0` in CSS and positioned by a `translate()`. Animating `left`/`top` runs layout every frame and visibly stutters once several cards move at once.
- **A node's transform has exactly one owner.** A node whose transform a keyframe animates must not also have one set in CSS, and vice-versa. Where a static offset is also needed — centering the effect text, centering the turn indicator — use an outer anchor div for the CSS transform and an inner node for the animation (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card` for the same reason.
- **Layout math is radians; CSS `rotate()` is degrees.** Convert at the render boundary with `radToDeg` (`cardTheme.ts`). Passing radians straight through silently flattens every rotation.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (card flights, as control points because that is what `element.animate` takes) and `DEAL_STAGGER_MS`. The fan's reflow curve lives in `Hand.svelte` beside the rule that uses it.
- **Hand keys come from `handCardKeys(hand)`**, not the array index — occurrence-numbered card identity. Index keys make a keyed block reuse the wrong node when a card leaves the middle of the fan, so the survivors snap instead of sliding into the gap.
- `Hand` staggers cards in only when the hand grows **from empty** (a deal). Any other growth is a draw, which already has its own deck→hand flier.
- `DiscardPile`: 2 static neutral under-layers for pile thickness (deliberately untinted — the active-colour ring owns the colour there) + top card keyed on `cardKey(card)` so each new top card remounts and replays a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` is set by `applyCardPlayed` and exists **only** for animation. Never read it for rules decisions.

### Cues stay on the compositor
A cue that runs for as long as a state lasts — a catch window, a pending stack, the whole match —
may animate **opacity and transform only**, on a pseudo-element if the thing it decorates has to
keep its own paint. Anything else is a repaint per frame for the life of the state, and the audit
of 2026-09 found five of them, every one on the surfaces a reaction is aimed at:

- **The armed halo and the penalty pulse** (`ActionBar.svelte`) were `box-shadow` keyframes on the
  button, infinite — a shadow repainted every frame of every catch window, on the one control the
  game asks to be answered fastest. Each is a `::before` now with a *static* shadow or border,
  breathed on opacity and scale. `::before`, because `::after` is the 44px `.hit-target` on the LOCO!
  chip and the two are armed together; `z-index: -1` inside the button's own stacking context
  (`.armed` sets one, `.btnPenalty` takes `isolation: isolate`) puts the glow under the label and
  over the fill. **`.btn` no longer clips its overflow** — that `overflow: hidden` was cutting the
  LOCO! chip's 44px catcher back to its 34px paint, and it would have clipped the halos too.
- **The penalty throb** (`TurnIndicator.svelte`) was `filter: brightness()` keyframed on the pill.
  It is a white wash on `::after` at 0 → 0.18 opacity, same look, and the pill's transform stays the
  fly transition's alone.
- **The deck's glow** (`Deck.svelte`) was a transitioned `filter: drop-shadow()` on the pile, which
  re-rasterises four card backs per frame of the fade, twice a turn. A `::after` box shadow under the
  pile (`isolation: isolate` on the deck, `z-index: -1` on the glow), faded on opacity. **Hover is
  behind `@media (hover: hover)`**: a touch screen synthesises `:hover` on the tap and keeps it, so
  the pile stayed lifted and lit after the draw, a deck that looked pressable on a turn that was over.
- **The direction ring** (`DirectionRing.svelte`) carried a `filter: drop-shadow()` on each of ten
  chevrons under an infinite opacity chase — ten blurs a frame for the match. Each chevron is drawn
  twice, a wider translucent `.halo` stroke first, exactly the card glyphs' ink pass; the chase
  animates the group's opacity and nothing else.
- **`will-change: transform` is kept where something moves every play and nowhere else.** The
  hand's slots keep it (they reflow on every card). `PlayerSlot` and `DiscardPile .top` lost it: a
  seat glides a handful of times a match and the top card settles once, and the browser promotes an
  animating element for its duration on its own — a permanent hint was a layer per pill and per
  pile held in memory for a movement that was not happening.
- **A scrim held over a live board is a colour, never a blur.** `RoundSummary`, `ScoreTable`'s
  `.overlay` and `GameView`'s `.reconnectOverlay` all ran `backdrop-filter: blur(5px)` over a table
  that keeps animating underneath — the summary for up to eight seconds *while the next round is
  dealt under it*. A backdrop filter re-rasterises the viewport on every frame anything behind it
  moves. They wear `--color-scrim-heavy` now, dense enough to own the screen without the filter.
  The pickers and the rules modal keep their blur: up for a decision, not held open over a read.

### Card rarity & the throw (`cardTheme.ts`)
Presentation-only tiering, invented here and never consulted by `game/`. `cardRarity(card)` follows
scarcity in the deck: number = `common` (72 cards), coloured action = `rare` (28), any wild =
`legendary` (12). A number is two thirds of every hand — dressing up the routine play leaves nothing
to escalate to when a wild drops, which is the whole reason the tiers exist.

- **`flightFor(card)` is the single source of flight timing.** One pure function feeding all four
  callers — hand→pile, seat→pile, the generic pile refresh, and `DiscardPile`'s reveal delay. They
  must agree or the pile shows the answer while its own card is still crossing the table. None of the
  four stores the delay: they each read `flightFor(card).duration` at the point they need it, which is
  what makes the agreement structural rather than a convention somebody has to remember.
- `spin` is **whole turns in the card's own plane**, folded into the same `rotate` track as the
  landing tilt (a full turn is visually a no-op, so the card still settles on exactly `toRot`).
- **A flier shows one side, never two.** It was a barrel roll around Y — two faces in a `preserve-3d`
  node, `.layer` carrying the `perspective` — and the card's back was turned to the table once per
  turn: at two turns in 470ms a wild *blinked*, which reads as a loading spinner rather than as a
  throw. A card spinning flat is still thrown; a card that hides its face mid-flight also hides the
  thing the play is about. `kind` alone decides the side (`data-flier-face`), so a draw is a back for
  its whole flight and a play a face for its whole flight.
- `swell` is the mid-flight scale — the card passes nearer the camera. This is most of what separates
  a card being *thrown* from a sprite being moved.
- **The pile reveals on impact, not on the message.** `DiscardPile` holds its new top for
  `flightFor(card).duration`, except for the first card it ever shows (opening discard, or a board rebuilt after
  a reconnect) — nothing flew there, and waiting for that flight blanks the pile for half a second.
  Same reason the SKIP/REVERSE/+N callout takes a `delayMs`.
- `AnimationLayer.Impact` is the shockwave ring, tinted `ACTIVE_RING[card.color]`, fired by
  `GameBoard.landCard` for rare/legendary only. A legendary also kicks the board — via the **`translate`
  property, not `transform`**: `.stage`'s transform is the board scale, and a WAAPI transform
  animation would override it mid-kick and resize the whole table.
- **Rarity is read in the flight and the impact, never on the face.** `Card.svelte` carries no
  per-rarity treatment at all: its only classes are `.card`, `.card.playable`, `.card.shadow`,
  `.interactive` and the corner variants. A shine or foil run across the face desaturates the suit
  colour, and suit colour is what has to survive stream compression, so `.card.playable` stays the
  one visual override a card in hand gets: "you can play this" is information and outranks flavour.
  - This paragraph used to describe a foil system (`.foil`, `.glint`, `holoOffsetMs`,
    `.card.playable.legendary`) of which **nothing exists in the code**. Checked 2026-08-01: none of
    those four identifiers appears anywhere under `client/src/`. It is exactly the failure mode the
    "Testing" section names, an invariant asserted with no test behind it.

### Reduced motion
- **The switch is `:root[data-motion="reduce"]`, never a media query.** `initMotion()` writes it
  before the first paint from the system setting *and* the player's answer, so the choice can win in
  both directions; `reducedMotionCss.test.ts` fails on any new
  `@media (prefers-reduced-motion: reduce)` block. There is no animation runtime to configure any
  more: the attribute drives the stylesheet, and the two WAAPI shakes and the transitions ask
  `prefersReducedMotion()` themselves. Full reasoning in `docs/notes/client.md`.
- When adding motion, verify it degrades to a readable static state rather than disappearing.
- **A callout collapsing to zero is a callout that never paints.** `AnimationLayer`'s `play()`
  answers reduced motion with a zero-length animation, which is right for a flight (the card is
  simply already there) and was wrong for SKIP / REVERSE / +N and the colour a wild named: they
  finished in the frame they started, invisible to exactly the player who had asked for a board they
  could read. A spec may carry a `still` — the frame to hold and for how long (`EFFECT_STILL_MS`,
  900) — played at the spec's own **delay**, so the colour callout still lands
  `COLOR_CALLOUT_DELAY_MS` after the card's under reduced motion too.

## Player bubble (`<PlayerSlot />`)
- Chunky sticker pill positioned by `seatLayout(...)` (see "Seat layout"), clockwise from the local
  seat. Size is `full` / `compact` / `mini` — the component mirrors `SEAT_DIMS`, it does not choose.
- Active turn: gold gradient fill + glow ring + bobbing arrow above the pill, dark label. It is the
  brightest object on screen on purpose — a viewer must never hunt for whose turn it is.
- Card-count badge on the pill's right edge; it turns red and pulses at exactly 1 card.
- Disconnected: muted fill and a softened outline, the drawn ✗ beside the name — and **the ink is
  not faded**. It was `opacity: 0.72` on the pill *and* `--color-muted-soft` on the label, which
  multiplied out to 2.31:1 on the seat whose absence is the news; the label is `--color-muted` now,
  4.5:1 on the dimmed fill in both themes. Quiet is a hue.
- Mini card-back fan inside `full`/`compact` pills (rotation ±14°/±8°/0° depending on count, "+N"
  overflow label). `mini` drops the fan — at that size it would be unreadable mush.

## Logo, favicon, table
- `<LocoLogo />` is the mark beside the wordmark. `size` sets one font-size; everything else is `em`
  of it. The mark **stands on its own** — it is a closed drawing and needs no frame to explain its
  edges. (It used to be held inside a little card, a device that existed only to make the previous
  mark's bleed read as a deliberate crop.)
- **Whole here, cropped on a card.** Logo, favicon and felt show the complete mark; card faces, the
  mini cards on a wild, and the deck back's watermark blow it past the edges and tilt it (see "Card
  face"). Same geometry, two framings, and they are not interchangeable.
- **Weight is a rendering parameter, not a second path.** `LOCO_MARK_BOLD_STROKE` (logo) and
  `LOCO_MARK_ICON_STROKE` (favicon) stroke the mark with its own paint, which thickens every bar and
  closes the facets by exactly the amount asked for. A dilated *copy* — which is what the previous
  mark shipped — is a second geometry to keep in sync with the designer's, and it drifts.
- The logo draws the mark **twice, widest first**: the ink outline every raised object in this UI
  carries, then the mark over it. `paint-order` does not substitute — the outline must be outside the
  shape only, and a centred stroke on an even-odd wireframe eats its own facets.
- **The favicon is the mark on a rounded near-black square** (`client/public/favicon.svg`), plus
  `apple-touch-icon.png` as its raster twin — iOS ignores SVG icons. `locoMark.ts` is the source of
  truth for the geometry; the two icon files are static copies (a `<link rel=icon>` cannot import a
  module), so a change to the mark means editing all three.
- **The felt watermark is bound by the oval's height, not its width**, even though the mark is
  landscape: the felt is roughly a 2.7:1 ellipse, so a mark sized off the width lands half outside
  the curve and `overflow:hidden` slices it into fragments. `aspect-ratio` is set explicitly — an
  absolutely-positioned `<svg>` with one axis `auto` does not reliably take its intrinsic ratio.
- **The table is near-black, in both themes.** It used to be green felt, which fought the deck: a
  `#00ff6d` card on a `#1fbf8f` table loses its edge, and a card losing its edge is the one thing
  that must not happen. Dark also makes the table the stage and the cards the only bright objects on
  it. The mark is branded into the felt at 7% — the piles sit on top of it, so anything more is a
  table you have to look past.
- A near-black card back on a near-black table is 1.3:1 and its ink outline is as dark as both, so
  `CardBack` carries a **light inner rim**. Without it the deck has no edge and an opponent's mini
  fan is one black bar.

## Streamable moments
- **Interception slam** (`<InterruptBanner />`): driven by the server's `interrupt_success`, which
  the client used to ignore entirely. Store field `interruptFlash { actorIndex, count, at }`, set by
  `applyInterrupt`, cleared by the banner after 1800ms. Colour comes from `seatColor(actorIndex)`.
  `<GameView />` also shakes the board via the **Web Animations API** (not a CSS class — a class
  toggle would need a remount to replay, tearing down the board).
- **Contre-LOCO! verdict** (`<CatchBanner />`): driven by `uno_caught`, which the client used to
  consume for its window bookkeeping and nothing else. A landed catch was the **quietest** event in
  the game — the caught seat's hand grew by two, which on a board where hands grow all match long is
  indistinguishable from an ordinary draw, and the player who won the race got no answer at all
  beyond a button going dark. It is the hardest reaction LOCO asks for and it rendered nothing.
  - `store.catchFlash { seat, at }`, set by `applyUnoCaught(seat)` — which also closes that seat's
    window, since settling the seat and announcing it are the same event. Cleared by the banner.
  - Three readings, because one banner cannot carry a moment this short: the **stamp** (who owes the
    call, what it cost), the **penalty cards** flying deck→caught seat with a `+2` callout over the
    pill (`<GameBoard />`, keyed on `catchFlash.at`), and the **`unoCaught` sting** — a voice that
    had been sitting in `sfx.ts` since the start with nothing ever playing it.
  - Deliberately **not** shaped like the interception slam: a red stamp punching *down* with a
    shockwave, against an actor-tinted banner growing out of a horizontal wipe, and a single
    vertical thump against a sideways rattle (`shakeScreen`). The two loudest moments in the game
    have to be told apart in a muted clip. The caught seat's colour appears on their name only.
  - The stamp sits at 30% height, above the piles: the penalty cards leave the deck while it is
    still up, and a verdict covering the cards it is about explains nothing. Same reason the LOCO!
    banner sits above the pile rather than over it.
  - **The catcher is not on the wire** — `uno_caught` carries the caught seat only — so the banner
    names the seat that pays, not the one that called. That is the table's news; the caller already
    knows, they pressed the button. Naming them would be a protocol change for a line of copy.
  - `CATCH_PENALTY_CARDS` (2) is stated once in the store and read by both the banner and the
    flight. Against fully exhausted piles the server hands over fewer (a draw never fails, it
    shrinks), so what is approximate there is the announcement, never the hand — which always comes
    from the server. Scene `game-catch-caught`; `src/test/catchBanner.test.ts`.
- **UNO banner**: tilted sticker, punch-in, positioned *above* the pile so the play that triggered
  it stays visible.
  - **Centred with `inset-inline: 0` + `margin-inline: auto` and `width: fit-content`, never
    `left: 50%`** — the notice pills' rule, and the same bug one size up: anchored at the midpoint
    the sticker was shrink-to-fit against the right half of the screen, and with `nowrap` on top of
    that a 20-character nickname ran it off both edges of a 360px phone. It wraps inside
    `calc(100% - 2 × --space-base)` now, `overflow-wrap: anywhere` for a nickname that is one word,
    the clamp's floor at 26px, and the punch keyframes carry `translateY(-50%)` only.
  - **z-index 45, with the other two shouts.** It sat at 10 — under the notice pills at 14 — so on a
    phone a Swap landing on the same beat printed its line across the shout. The three moments
    allowed to shout share one layer; see the score table's ledger below.
- **Contre-LOCO! verdict, the name line**: the caught seat's colour is a **swatch beside the name**
  (`.seatDot`, ink-outlined), and the name itself is the stamp's white with the title's ink stroke.
  It used to *be* the name's colour, so a viewer following "the orange player" would find them — and
  on the red stamp the ten seat colours measured between 1.05:1 and 2.3:1, the rose seat invisible
  outright. The dot keeps the seat findable; the name stays legible whichever seat it names. Same
  device as the versus reveal's avatar initial (`MatchFound.svelte`), where white on six of the ten
  seat fills failed 3:1 and the letter now carries the ink outline every card glyph carries.
- **The interception banner takes the catch stamp's 480px block**: smaller padding, the ×N chip
  pulled in, and `.subtitle` allowed to wrap. It had no small-screen rule at all, and a subtitle that
  may not wrap took a 20-character nickname off both edges of a phone.
- **Effect callouts** (`AnimationLayer`): SKIP / REVERSE / +N, outlined rather than shadowed so they
  survive landing on felt, on a card, or on the background. Text is localised (`fxSkip`,
  `fxReverse`); `<GameBoard />` takes them as a memoised `fxTexts` prop — a fresh object literal
  would replay the callout on every render.
- **Play direction ring** (`<DirectionRing />`, geometry in `layout.ts: directionMarkers`): chevrons
  around the felt saying which way play is moving. A Reverse otherwise only announces itself for the
  length of one callout, after which nothing on screen answers "who plays after me" — the question
  the card was about.
  - **`direction = +1` is clockwise *on screen*, and the ring must never contradict the seats.** The
    arc puts the next player at the **left** end of the top row, so a table flows 6 o'clock → 9 → 12
    → 3, which is clockwise. Same fact `clockwiseOpponents` is named after; an arrow pointing the
    wrong way is worse than no arrow.
  - The heading lives in the **geometry**, never in the motion: the chase is a second readout, so a
    frozen ring (`prefers-reduced-motion`, a paused clip, a screenshot) still reads. Same principle
    as `.armed` degrading to a static halo.
  - `<GameBoard />` keys it on the direction, so a Reverse remounts it and replays the flip. Nothing
    here goes through per-frame state — the chase is one CSS animation per chevron, staggered by
    index (markers come out of `directionMarkers` in flow order, so index order *is* flow order).
  - Drawn as a sibling of `.tableOval`, not a child: the felt clips its overflow and the chevrons'
    glow extends past the ellipse.
  - Scenes `game-my-turn` (cw) and `game-reversed` (ccw) cover both headings in the showcase.
- **The deck falls** on the victory screen only, and once (`CardFall.svelte`). Losing screens do not
  celebrate, and a walkover is not a victory. **What falls is the real components**, fourteen
  `<Card />` faces at 44-64px each backed by a real `<CardBack />`, both hiding their own backface
  inside a `preserve-3d` parent, so a card that turns over in the fall shows the deck's back the way
  a card does. It was confetti first and coloured 2:3 rectangles second, and the second is why the
  rule is stated this way: at 30px, with no value, no mark and no back, the only thing saying "card"
  was the aspect ratio, and nobody reads an aspect ratio.
  - **The fade and the turn are on two different elements, and that split is load-bearing.** A 3D
    context is flattened by anything that makes the browser composite the subtree as a group, and an
    animated `opacity` is one of those, `will-change: opacity` alone being enough. With both on one
    element `preserve-3d` was silently downgraded to `flat`: the back was never drawn and every
    half-turn showed the *front* in mirror image, which looks like a card turning until you read the
    number on it. So `.fall` owns the drift and the fade, `.tumble` owns the rotation and the depth,
    and neither may take the other's property. The perspective sits **per card** rather than on the
    layer, or the cards at the edges of a wide screen turn over more violently than the ones in the
    middle and the whole thing reads as a lens.
  - **The fall accelerates and the turn does not**, which is the pair of curves a tumbling object
    actually has. Linear on both reads as confetti descending at a set speed; a card that gains on
    itself and leaves the frame faster than it entered is the same animation with weight under it.
    The curve is not a pure ease-in either, which starts from a dead stop: these come off a throw, so
    it keeps a little speed at 0. **The fade-out moves with the curve** — at 90% of an accelerating
    fall the card is still a third of a screen from the bottom, so a figure written for a linear drop
    dissolves it in full view.
  - **Half-turns are weighted** (two fifths of the cards none, two fifths one, the rest two): a card
    turning at a constant rate spends as long edge-on as face-on, and edge-on it is a hairline.
    Enough never turn at all that the screen stays mostly colour, and the rest land on their back to
    say these are objects with two sides rather than printed shapes.
  - **One roll decides how near a card is** and size and speed both read off it, because a large card
    drifting down slowly behind a small one is the frame where the depth goes. Reduced motion drops
    the layer entirely.
- **Per-seat identity colours** (`components/playerColors.ts`): a player keeps one colour across
  lobby avatar, banner and scoreboard so a viewer can follow "the orange player" all match.
- Opponent pills show the **exact** card count (the fan only conveys few-vs-many, and caps out).

## Table news (the three notice pills)
Three things happen *around* the match rather than in it, and all three are told by one pill in
`<GameView />`: a Swap or a Global Switch (`swapNotice`), a Contre-LOCO! that arrived too late
(`catchFailed`), a seat gone for the rest of the match (`departureNotice`). They are the counterpart
of the streamable moments above — news, not moments — and the distinction is the whole design:
the LOCO! banner, the interception slam and the catch stamp are the three things allowed to shout,
so anything else wearing a saturated fill of its own competes with them for the same glance.

- **One class, three heights** (`.notice` + `.noticeSwap` / `.noticePenalty` / `.noticeDeparture`).
  The plate is the board's own chrome — `--color-surface-strong`, ink type, ink outline,
  `--shadow-hard` — and the only thing that changes between the three is the `--notice-top` each one
  sits at (13% / 20% / 29%, tightened on a phone), which is what lets a seat leaving on the same beat
  as a missed call read as two pieces of news instead of one covering the other.
  - They were three pills written one at a time before that: two saturated gradients and one plate,
    16px against 17px, a soft glow on two of the three, and white type over the top stop of
    `--gradient-error`, which measures **2.4:1**.
  - Nothing carries a colour of its own, not even a dot: what kind of news it is, is what the line
    says. A mark beside the text is one more object on a board that already has the discard, the
    seats, the ring and the action bar competing for the same two seconds.
- **In on a bounce, out on the beat the store drops it.** `noticeIn` (0.32s, `--ease-bounce`) then
  `noticeOut` (0.24s) delayed by `calc(var(--notice-life) - 240ms)`, where `--notice-life` is the
  component's own `SWAP_NOTICE_MS` / `CATCH_FAIL_NOTICE_MS` / `DEPARTURE_NOTICE_MS` passed inline —
  the three durations differ, so a delay written in the stylesheet would animate the shortest pill
  out over a slot `autoClear` had already emptied. The exit is `forwards`, **never `both`**: `both`
  back-fills its opening frame from time zero and swallows the entrance underneath it. Under
  `data-motion="reduce"` the pill simply is there for its whole life — the news is the line.
- **Centred with `inset-inline: 0` + `margin-inline: auto`, never `left: 50%`.** An absolutely
  positioned box anchored at the midpoint is shrink-to-fit against **the half of the screen to its
  right**, so the longest line in the set wrapped at 180px on a 360px phone and came out four lines
  tall over the seats, whatever `max-width` said. Anything else centred this way inherits the bug.
- **`text-wrap: balance`** keeps the two-line pills from ending on an orphan. It is safe here only
  because the width is now decided before the wrapping is.
- **No arrow glyph in any of them.** The Global Switch line named its heading with `→` / `←`, which
  says "that way" about a board every seat looks at from a different chair, and the two directions
  differ by one character in a pill that is up for a couple of seconds. It names the heading in the
  words the direction ring already uses (`clockwise` / `counter-clockwise`, `horaire` /
  `antihoraire`), so the board and the notice say the same thing the same way.
- **A line is read in passing or it is not read.** Every one of these fits on a single line at
  desktop width and wraps to two at 360px, and the Global Switch line — the only one that ever grew
  past that — names the event and the heading and stops: *"%actor lance la Rotation, sens horaire"*.
  Spelling out that the hands slide one seat put four lines over the seats on a phone to explain
  something the sliding hands and the card's own face are already showing.
- Scenes `game-swap-notice`, `game-global-switch-notice` (the longest line in the set, and the one
  that says whether the wrapping still holds), `game-catch-failed`, `game-departure-notice`.

## Score table (hold TAB)
`<ScoreTable />` is the in-match standings panel: seat colour + nickname, one column per finished
round, cumulative total, rounds won, ping. Pure merge/sort and the ping banding live in
`scoreTableModel.ts` (`buildScoreRows`, `pingTier`), unit-tested; the component only renders.

- **Opened by holding TAB** (`heldKey('Tab', enabled)`) **or pinned by the scores button** in the
  top-right cluster. Held and pinned are separate states: releasing TAB must not close a table
  somebody deliberately pinned, and a phone has no TAB key at all.
- **That button exists on touch layouts only** — `.scoresBtn` is `display:none` until
  `(max-width: 480px), (pointer: coarse)`. It is the fallback for the missing key, so on a machine
  that has the key it is a permanent control for something already one keypress away, spending room
  in a cluster of four. The coarse-pointer half of the query is what covers a tablet, which has no
  TAB either and is wider than 480px.
- **It is an icon** (a table glyph, drawn inline in `GameView` like every other rule glyph in this
  UI, never a font character), 40×40 like the preferences gear beside it: at phone width the cluster
  has no room for a word, and the three buttons next to it are already square. `t.scoreTableBtn`
  survives as its `aria-label` + `title`, so the accessible name is unchanged and the E2E locator
  still finds it. `aria-pressed` tints it with `--color-primary` when pinned — the panel can be
  dismissed by tapping its backdrop, and nothing else would say the state changed.
- E2E: the desktop project therefore opens the table by **holding TAB** (`holdScores` in
  `score-table.spec.ts`); one test resizes to 390×844 to exercise the button and asserts it hidden
  before the resize.
- `heldKey` resets on `blur`. Alt-tabbing away swallows the keyup, and the overlay would stay
  stuck over the board with no way out. It `preventDefault`s TAB, so `enabled` is false while the
  rules modal, a picker or the round summary owns the screen: inside a dialog TAB is the dialog's.
- **Nothing the board draws crosses it, and that is the point of the number.** The panel sits at
  **z-index 48**, above the whole transient band — notices 14, the error toast 30, the three shouts
  (interception slam, catch stamp, LOCO! banner) 45, `.topRight` and the leave question 46, the catch
  capsule and the round summary 47 — and below the three things that outrank a read: the reconnect
  curtain (50), which says the table is not there at all, the two pickers (100), which are a
  decision the player owes the table, and the rules modal (1000) and map gate (900), which own the
  screen outright.
  - **The capsule and the round summary share 47 because they are never up together.**
    `applyRoundEnd` empties every catch window, so the capsule is unmounted by the message that
    raises the summary, and nobody is on one card in the eight seconds after a deal. The summary
    sat at 40, under the banners, the chip row and the capsule, so an interception slam or a
    five-second countdown could be drawn across the scores. It cannot go higher without crossing
    this panel, and the capsule cannot go lower: the chip row is rendered *after* it in `GameView`,
    so at 46 the row would cover it again — the exact bug the capsule's own comment records.
  - It was at 45, which is the banners' own layer, and both banners are rendered *after* it. So the
    one surface in this game somebody opens **in order to read it** was the one surface anything could
    cross: six seats, five columns and a ping, with an interception banner across the middle, a
    five-second countdown capsule over its title and four chips on its corner. Every one of those is a
    cue about the board, and the board is exactly what the player has stopped looking at.
  - **The chip row going under it is the deliberate half.** It carried the button that pinned the
    panel and was kept at 46 for it — but a pinned table has had a ✕ in its own header since, and its
    scrim dismisses on a press anywhere outside the card, so the way out is *on* the panel rather than
    behind it. Held with TAB there was never anything to press. That ✕ is therefore the only control
    answering for the panel on a phone, which is why it is 40px with `.hit-target` rather than the
    32px it shared with the modal's.
  - `scoreTable.test.ts` reads the layers off the sources and asserts the floor per file rather than
    per selector, so a fifth banner added at 46 fails without anybody remembering this rule exists.
    `score-table.spec.ts` asserts the cover from the other end, with `elementFromPoint` over the chip
    the panel is drawn on top of.
- **Ping bands** (`pingTier`): <60 good, <120 ok, <220 poor, beyond that bad. Tighter than a
  turn-based game would need, because an interrupt is decided by arrival order at the server.
  `rtt_ms < 0` renders as "not measured", never as a flattering 0 ms; bots are labelled `BOT`.
- Rows are ordered by score, then rounds won, then seat, i.e. the match tiebreakers, so the panel can never
  contradict the final standings.
- Under 480px the **rounds-won column is dropped** and under 400px the "you" badge goes too. The
  ping must not be the thing pushed off the right edge of a phone: it is the one column that cannot
  be derived from anything else on screen (the gold row already says which seat is yours).
- **An offline row is quiet by hue** (`.rowOffline`): its fill drops back to the panel's own, its
  outline softens to `--color-border-strong`, and every cell reads `--color-muted`. It was
  `opacity: 0.55` on the cells, which put the nickname under 3:1 on the seat a spectator is most
  likely to be asking about. The ping tiers are tokens now too — the amber is `--color-amber`, the
  one step the scale needs that the brand did not carry, and "bad" turned out to be `--color-error`
  retyped.

## The round chip under 480px

The chrome row on the right is five chips wide on a phone (scores, gear, speaker, rules, leave):
5 × 40px plus the gaps and the margin is about 245px of a 360px screen, and "Round 2 · BO3" at 13px
uppercase needs 150. The chip ran under the scores button. Under 480px the chip switches to its short
spelling, `M2 · BO3` (`t.roundShort`, the score table's own `M%n` column head, so a name the player
has already read) and the decisive round keeps one word (`t.decisiveRoundShort`). Two spans, one
hidden per width, so the accessible name stays the long form. Not a scene: `game-uno` at `small`
is where it shows.

## Quiet states, measured
The rule at the top of this note — quiet is a hue, never an opacity — was written for one label and
broken on most of the screens a spectator reads. Each of these was measured, and each is now a
token:
- **Disabled action-bar buttons** were `opacity: 0.55`, held there "so a spectator can still read
  what the centre column is for", and at 0.55 the dead Catch label measured ~2:1 and a dead Draw or
  Pass ~3.4:1 — Catch is disabled through the opening of every round, so that was the state a
  viewer saw most. They wear the fill swap now: `--color-surface-strong`, `--color-border-strong` in
  place of the ink, `--color-muted` for the label (4.5:1 in both themes), and no ledge. The ledge is
  also what still tells a dead Pass from a live one, which wears the same fill: the live one is
  raised and inked, the dead one is printed on the bar. **`.btnDrawSecondary` is surface-strong
  too**: it was `--color-surface-card` on a bar of `--color-surface-card`, a white pill on a white
  bar in light.
- **The round summary's delta** was `--color-mint` on `--color-surface-strong`, 1.81:1 in light —
  the one number the card is opened for. `--color-mint-text` is the mint as *text on a panel*, the
  same hue pushed until it clears AA on each canvas, the way `--color-link` is the indigo as text;
  dark keeps the brand mint, which is 6:1 there. The winner row's two literals (`#7a4a00`,
  `#1f6b3c`) are `--color-on-secondary-muted` and `--color-on-secondary-mint`, theme-independent
  like the yellow they sit on; the green moved one step past the literal, which was 4.25:1 on the
  flat yellow.
- **The two text-field focus rings** (`Lobby` `.input`, `WaitingRoom` `.maxInput`) were the indigo at
  0.35 alpha, 1.5:1 on the card — and with `outline: none` on the field that shadow was the whole
  indicator. Both are the solid `--color-tertiary` at 3px, the ring `tokens.css` gives every
  `:focus-visible`.
- **The map-loading roster** set a name still loading at 50% white over a photograph, with no shadow.
  0.72 and the same shadow `.status` carries.
- **`.formatLen`** was 10px with `opacity: 0.75` on the active pill; **the round summary's heads,
  progress title and gap, the game-over gap and the recap heads** were 11px. **12px is the floor**
  for anything on a screen a spectator reads, and the opacity is gone.
- Scenes `game-scores` and `game-scores-round-one` cover both states in the showcase.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard, roundHistory?)`.
- Computes per-player `round_points` as `newScore - prevScore` from pre-round scoreboard, stores `roundScores: RoundScoreEntry[]`, sets `showRoundSummary:true`.
- `GameView` shows: round n/total, winner, per-player breakdown sorted by placement, points (delta), cumulative score, wins, full match scoreboard (BO3+). The round it names is `roundNumber_completed`, a field of its own, because `roundNumber` is already the round being dealt behind it.
- "Continue (Ns)" → `dismissRoundSummary()`, which takes the card down and puts no board back. Auto-dismiss at 8s.

### The card is an overlay, and the board behind it is live

The `game_started` that deals the next round arrives while the card is up, and is applied there. It
used to be buffered in `pendingGameState` and replayed on dismissal, so that the summary would not
vanish the instant the server dealt — and that was the bug:

- the server deals the moment it announces the round that ended, and **arms the turn clock with the
  deal**, so the table is already playing while the card is up;
- every `card_played` of the new round was applied to the store all along — nothing about the board
  was ever actually held back — so the buffer was a snapshot of the deal replayed over a board that
  had moved on for up to the full eight seconds;
- whoever read the scores had their table rolled back: the discard, the hand sizes, and
  `currentTurn`. **If the rolled-back turn was their own, nothing could heal it**: they were shown
  somebody else's turn, so they did not play; nobody else could play; and the table sat there until
  the server's turn timer expired and the `turn_changed` corrected them. A reload fixed it, which is
  how it reads as a server bug when it is not one.

So `applyGameState` settles the board and **does not touch the card** — neither `showRoundSummary`
nor `roundWinner` — and `dismissRoundSummary` only hides it. A snapshot is authoritative when it
arrives and never afterwards; anything held and replayed is a snapshot applied twice, the second
time against a table that has moved. The **match end** is still buffered (`pendingMatchEnd`), and
that one is safe for the reason this one was not: nothing follows a match end.

One consequence is deliberate: the `yourTurn` cue is held while the card is up and played when it
comes down on a turn that is already ours (`audio/gameSounds.ts`), because eight seconds of scores
is a board the player cannot act on.

## Visual showcase & screenshot harness
`client/src/dev/scenes.ts` registers every screen/state as pure data; `?showcase` renders the index,
`?showcase=<id>` renders one scene full-screen with no server, no WebSocket and no second player.
Gated behind `import.meta.env.DEV` (dynamic import in `entry.ts`), so Rollup drops the chunk in prod.

`tools/visual/shoot.mjs` (`make visual`) boots the dev server through
`tools/lib/devserver.mjs`, walks the registry and writes
`.visual/<scene>__<viewport>__<theme>.png` plus one contact sheet per viewport/theme.

- **Add a scene in the same change set as any new screen or visual state.**
- `card-sheet` is the odd one out: not a screen but the whole deck, every kind in every suit, laid
  out to fit the capture viewport. Cards are the component the game draws forty of at once and no
  gameplay scene shows more than a handful of kinds — review any card change against it.
- Flags: `--scenes=a,b`, `--viewports=desktop,mobile,wide,small,notch`, `--themes=light,dark`,
  `--motion` (keep animations running), `--port`. Default runs `desktop` (1440×900) + `mobile`
  (390×844). The two ends of the board-scale range are where its regressions show up — check
  **both** after touching `layout.ts`: `wide` (1920×1080, scaled up) and `small` (360×640, scaled
  down).
- **`notch` is a phone with safe areas** (390×844 plus a 59px notch and a 34px home indicator). A
  viewport entry may carry `insets`, which the init script writes over the `--safe-*` tokens the CSS
  offsets and `safeAreaInsets` both read. No desktop browser reports an inset on its own, so this
  is the only way to see the layout that has to dodge them (see "Safe areas").
- Viewport size goes under `viewport: {...}` in the Playwright context options — width/height at the
  top level are silently ignored and you get the 1280×720 default.
- Captures run with `reducedMotion: 'reduce'` by default so they are deterministic; `--motion` is how
  you check the fall, springs and callouts.
- **The harness asks for the home page of the language it is capturing** (`/fr/` by default, since
  `--lang` defaults to `fr`). `/` and `/fr/` are two builds, and a French screenshot has to be of
  the document a French player is served rather than of the English one translated into French.

  It used to be load-bearing for a harder reason, kept here because the failure is expensive to
  rediscover. While the language was answered by a *navigation*, seeding `loco_lang=fr` and asking
  for `/` made every scene load twice — and one page walks all 62 scenes, so the count is what broke:
  **Chromium stops honouring navigations on a long-lived page somewhere past a hundred of them.** The
  run died on scene 52 with a bare `page.goto` timeout and no error on the page; reversing the scene
  list moved the failure to a different scene at the *same position*, which is what identified it as
  a count rather than a scene. `/` translates itself in place now and never navigates, so nothing
  doubles whatever the harness asks for — but past ~100 scenes, recycle the page rather than hunting
  the scene it stops on.

## Link preview (Discord / X)
The game is shared as a link, so the OG card is a product surface. `make og` (`tools/og/shoot.mjs`)
renders the `og-card` scene at 1200×630 into `client/public/og.png`.

- **Built from the real `<LocoLogo />` and the real `<Card />`** (`client/src/dev/OgCard.svelte`), not a
  redrawn copy: the duck on the preview is the duck on the cards is the duck in the tab, and a
  hand-authored twin would drift the first time either is touched. `OgCard` pins `--color-stroke` /
  `--color-primary` locally — a link preview is one picture and must not depend on which theme the
  machine that captured it was in.
- **Show, don't tell**: the duck, the wordmark and a five-card fan, one line of copy. Discord renders
  this at ~400px wide; a paragraph is unread there. The +4 sits mid-arc, where a crop or an avatar
  overlay can't take it.
- **The tagline is typeset one sentence per line** (`.taglineLine`), because the shared string
  (`t.tagline`, the same one the lobby shows) is two sentences and the column broke it mid-clause:
  "Cards at speed. Nobody / waits their turn." reads as a text box that ran out of room. The line is
  a `block`, not `nowrap`, so a longer sentence in another language wraps inside its own line rather
  than running out of the frame.
- The PNG is **committed** — CI builds the client with `npm run build` and has no browser.
- **Absolute URLs are mandatory** (crawlers resolve `og:image` against nothing) and the tags must be
  in the served HTML, since neither Discord nor X runs JS. `src/seo/meta.ts` holds `ORIGIN` (default
  = prod, override with `VITE_PUBLIC_ORIGIN`) and builds every URL through `absolute()`;
  `layouts/Base.astro` renders the tags. The tags are data rather than markup so `ogCard.test.ts`
  can assert the values instead of running a regex over a template.
- Both platforms **cache the image by URL** for days: bump `OG_VERSION` in `src/seo/meta.ts` after
  regenerating. `twitter:card` must stay `summary_large_image` or X shows a 120px thumbnail.
- No preview on the `-d.` host by design — nginx serves `robots.txt: Disallow: /` there and
  Twitterbot honours it.
- `client/src/test/ogCard.test.ts` is the only thing watching this: nothing else in the app renders
  those tags or that image, so a deleted PNG or a drifted dimension would fail silently in
  production.



## Ambience and celebration

The brief this pass answered was "everything that feels soulless". Four things, each small, each in
the same voice as the rest of the board.

- **No painted ambience.** A first pass put drifting colour lights and floating card silhouettes
  behind the entry screens, and it was taken out the same day: soft glowing blobs on a dark ground
  are the texture every generated interface wears now, and people read it as the absence of a
  decision. The canvas stays the designed gradient and the objects on it carry the life —
  entrances, presses, a hand dealt, numbers counted. If ambience ever comes back it is drawn from
  the game's own vocabulary (a real card, an ink outline, a hard shadow), never from a glow.
- **The home screen arrives in order** (`Lobby`'s `riseIn`): the mark, the line under it, then the
  four buttons one after another, 60 ms apart, once, under the boot fade. A screen that appears in
  one frame is a page loading.
- **A hand is dealt, not drawn** (`GameBoard`'s deal effect, `DEAL_FLIGHT_MS`): eight card backs fly
  off the deck one after another and each lands where the fan will hold it; the fan's own fade-in
  (`Hand`'s `handCardIn`) now waits for its card's flier, so a card never appears before it has
  arrived. Keyed on `roundNumber`, so every round's deal flies and a reload mid-round rebuilds the
  fan quietly. The deal sound already staggered at the same pace, which is why it reads as one thing.
- **Numbers are counted, not printed** (`components/countUp.ts`, on the round summary's points and
  totals and the game-over standings): a figure that pops into place is a spreadsheet cell. Rows on
  both cards arrive top place first and the winner's row catches the light once; the game-over
  heading wraps as a phrase (`text-wrap: balance`) rather than leaving `TOI !` alone on a line.
- **Every screen arrives** (`hooks/screenIn.ts`, on the wrapper `App.svelte` puts round each
  screen): a 240 ms rise and fade in, no departure — nothing pressable is ever behind a screen on
  its way out. `.screen` is `height: 100%` and owns nothing else, so every screen sizes itself to
  it exactly as it sized itself to `#root`.
- **Three small answers to a press**: a card gives under the thumb for the frame before it flies
  (`Hand`'s `:active` squash), the turn pill lands with a ring (`TurnIndicator`'s `turnBurst`, a
  pseudo-element so the pill's own transform stays the fly's), and the reveal's VS lands with one
  too (`MatchFound`'s `vsRing`).
