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
  language. A card is an object, not a control.
- `--ease-bounce` for anything that should feel physical; `--ease-out` for travel.
- **Reduced motion is applied by `initMotion()` in `entry.ts`, before first render**: every
  reduced-motion rule in the CSS hangs off `:root[data-motion="reduce"]` instead of a media query,
  so the attribute has to be on `<html>` before the first paint. See `docs/notes/client.md`.

#### Four families, and what each one means
LOCO Red acts, sunny yellow marks a win, electric indigo orients, signal mint confirms. That
separation *is* the palette — it is worth more than any individual hex, and the way it gets undone is
one colour at a time on grounds that have nothing to do with it. The two secondaries were once moved
to orchid and teal because the originals sat near a CSS framework's defaults: true, thin, and it cost
the palette its logic, because the new pair no longer said *win* and *orient* to anybody who had
played a round. **Judge a proposed colour on what it does to the other three, not on its
provenance**, and if it has to move, move it inside its own family.

Two things constrain `--color-tertiary` and both are measured rather than eyeballed: the focus ring
wears it and has to clear **3:1 on the dark card** (WCAG 1.4.11, currently 3.42), and `--color-link`
is the same hue pushed until it clears AA on each canvas separately. A colour written out by hand at
a call site is the bug — `ScoreTable`'s ping tiers held the mint as a literal, a copy nothing keeps
in step — and `playerColors.ts` moves with the token or a seat and the interface disagree about one
colour.

#### One palette
There used to be two — a candy-sky "day" and the indigo "night" — behind `[data-theme]` on `<html>`,
with the dark block duplicated under `@media (prefers-color-scheme: dark)` so the first frame of a
content page was right, a 260ms colour fade armed by `setTheme`, a switch in the preferences panel
and another in the content pages' bar. All of it went in one change, on a product decision: the
game is played in rendered rooms over a near-black table and is built to be captured, and a pale
canvas around that read as a website with a game embedded in it. What the second palette cost was
not only its code: every contrast in the product was measured twice, the wordmark needed two
outline rules, the content pages flashed white between navigations until the media query was
duplicated, and `make visual` shot everything twice.

So `tokens.css` declares the night palette on `:root`, once, with `color-scheme: dark` so the
browser's own widgets follow; the wordmark's outline is one `::before`; the content pages paint
the game's own canvas. `noLightTheme.test.ts` fails on `data-theme`, `prefers-color-scheme`,
`loco_theme` or `theme-boot` anywhere in the client, the E2E suite or the tools, and on a second
`--color-canvas` in the tokens. The card faces and the rooms are untouched by any of this: they never
followed a theme, and the reasoning that they are objects and places rather than surfaces is what
the interface has now been brought in line with.

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
- **A phone on its side** (`isLandscape`: wider than tall and under `LANDSCAPE_MAX_H` = 560px tall):
  the phone reference turned, `clamp(min(w/830, h/405), MIN_BOARD_SCALE, 1)`. But the scale is the
  smaller half of the answer there — see "A phone on its side" under Mobile: the composition changes,
  and the mode is decided **from pixels, once**, because a short window at 0.78 is taller in virtual
  units than a desktop window at 1 and the virtual space cannot tell them apart.

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
  - **A fourth reading, and it is the only one that is about us rather than the table: the wager is
    spent** (`GameView`'s `catchSpent` — `store.catchSpent` *and* no `catchTarget` left). We have
    already called on this board, so the press the store would send is the blind one it suppresses,
    and the button was drawn live over an action that did nothing at all. That is the one lie a
    reaction bar cannot afford, so it is drawn dead — the same sunken slot as "nobody is close",
    because from the thumb's side the two mean the same thing. It costs no legitimate press: a
    window still ours to aim at names itself in `catchTarget`, which is the ordinary second catch
    after a Swap, and the next card played hands the wager back. `game-catch-failed` is its scene.
  - **And what ends the middle state is a clock, not the board** (`isCatchLive` + `catchLiveUntil`,
    `store.catchLive`). None of the four ways a seat leaves the armed cue touches it — it calls the
    thing, it draws, it swallows a stack of four, it takes two penalty cards from a Contre-LOCO!
    that landed on it — because each of those is the instant a betting thumb has already committed,
    and a button that greys out there is sparing the player a press the server charges a card for
    either way. What takes it down is the window running out, plus the grace the server keeps
    charging through. It is not a latch: held to the next card played instead, the offer was farmed
    a card at a time (`domain-rules.md`).
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

### A phone on its side (`layout.ts: isLandscape`, `ActionBar.svelte`'s landscape block)
Portrait stacks the table — seats, felt, hand, action bar — and the two chrome bands that do not
scale are 198 pixels of that stack. An iPhone 13 Pro sideways with Safari's bar showing is 340
pixels tall: at the scale that fits the stack a card is 25 pixels wide, so the report was right that
"horizontal does not work at all" — the board was laid out at scale 1 (the width was past the phone
threshold), the hand sat across the felt and the seats under the turn pill.

Landscape is therefore **another composition, not a smaller one**, and the whole of it is in
`layout.ts` behind one `landscape` flag every layout function takes:
- `isLandscape(w, h)`: wider than tall and under `LANDSCAPE_MAX_H` (560px). Decided in `GameBoard`
  from the element's pixel size and in `feltInViewport` from the viewport's, and handed down — the
  virtual space cannot re-derive it (see "Board scale"). A short desktop window gets it too, and it
  is the right answer there for the same reason.
- `boardSpace`: the chrome that does not scale is **up the right edge** — the action stack's band,
  `SIDE_RESERVE` = 160 pixels, the stack's 124px slot plus its padding, stroke, margin and a gap —
  and along the top, `TOP_CHROME_LANDSCAPE` = 44 for the round chip and the turn clock. Nothing is
  under the hand: it runs along the bottom safe edge itself, `HAND_MARGIN_LANDSCAPE` above it.
- `seatLayout` → `seatColumn`: the seats stand in a column down the left band
  (`SEAT_BAND_LANDSCAPE`, a compact pill and its margins), centred on the felt, **next player at the
  bottom** — play runs clockwise on screen, 6 → 9 → 12 → 3, so the ring is unchanged. Compact pills
  while the column holds them, mini when it needs the room; what the column cannot hold continues
  **along the top of the felt, left to right**, stopping short of the chip row (`CHIP_ROW_CLEAR`),
  and the felt drops under that row by `blockHeight` exactly as it does under a portrait row.
- `tableRect`: the felt takes the whole band between the top chrome and the hand and the whole
  width right of the seat band, flatter than portrait's oval, never taller than the band.
- The piles stand **high in the felt** (`pileTop`, `PILE_INSET_LANDSCAPE`) and the turn pill takes
  the band under them, centred on the felt (`turnPillPlace`, which also owns the portrait reserve
  above the hand): between a felt that ends a hair above the hand and a hand whose top edge carries
  every card's value, there was nowhere else to put it. A felt squeezed under a top row is shorter
  than the piles and the pill together; the pill then rides the bottom rim and stops short of the
  hand.
- The action bar is a **stack**: draw, Contre-LOCO!, pass, top to bottom, the reaction still in
  the middle, the LOCO! chip above it, at the right safe edge. The same three fixed slots that never
  reflow — only the axis turns, with the phone. `@media (orientation: landscape) and (max-height:
  559px)`, and every measurement the `max-width: 480px` block sets is set again, because a phone on
  its side is wider than that. The chip row stays top-right, above the stack.

`landscape.test.ts` runs the board's whole chain at 844×340 with the notch on one flank, and pins
the stack's CSS to `SIDE_RESERVE` and `LANDSCAPE_MAX_H`, since a stylesheet cannot import a constant.
Review with `make visual ARGS="--viewports=landscape"`, the only viewport the composition is visible
in; `game-eight-players` is the one with a top row.

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
- **A match in a map pins `<html>` to `--room-void`** (`<GameBoard />` sets `data-room` on the root
  and writes the scene's horizon, **taken well down towards the void**, into the variable).
  The browser paints anything the page does not own with the root's colour, so this is the only
  thing that can reach a band left over by a floating browser bar. A violet strip across a dark room
  reads as a broken layout; the same strip in the room's shadow reads as the room. **The horizon
  itself is not that shadow**: a noon sky is a near-white, so on a day map the variable was painting
  the brightest thing on the screen — the opposite of what it is for — and the loading screen, which
  wears the same value, went with it.
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
A map is **a scene, a table and an accent colour**. It changes no rule, no card and no timing. Six
ship: **Neon** (a rooftop terrace above a neon city), **Rune** (a village square with a wizard's
tower), **Velvet** (the square in front of an art-deco hotel), **Orbit** (a base on an airless moon),
**Sakura** (a hot-spring village under cherry trees) and **Marina** (a harbour front). Each is dealt
at one of **four hours** (dawn, day, dusk, night) under one of **six skies** (clear, cloudy, rain,
storm, snow, fog), and the room says which skies it allows: it does not snow on the moon.

**Nothing about a map is a picture any more.** The first four were photographs — a generated room
and a generated table, cropped, placed by a rectangle measured off the art — and a photograph is one
hour under one sky forever. What replaced them is a place that is *built*: the scene is a diorama of
a few thousand coloured blocks rendered in the browser by an isometric engine
(`components/scene/`, three.js), and the table is CSS drawn from the room's own materials. A match at
midnight in the rain and one at noon in the same room are now two rooms, which is what "the maps
dictate the mood" asks for.

- **The draw is server-side and per match, and it is three ids.** `game/maps.go` (`MapID`,
  `TimeOfDay`, `Weather`, `MapWeathers`; `Room.pickMap` / `pickTime` / `pickWeather`); `Room.Start()`
  writes `MapID`, `MapTime` and `MapWeather`, `BeginNextRound` keeps all three (rain does not stop
  between two rounds), `ResetForRematch` clears them so the next match gets a new room. Exported as
  `GameStateDTO.map_id` / `time_of_day` / `weather` on **every** snapshot, not just `game_started`,
  so a reconnecting player rebuilds the same room as everybody else. All three are bare strings on
  the wire, for the reason `map_id` always was: a value this client does not know degrades to a
  default (`resolveScene`: an unknown hour is dealt in daylight, an unknown or unlisted sky is dealt
  clear) and never drops the whole `game_state`.
  - It has to be the server's even though the consequence is purely visual: two players in one room
    describing two different tables to a viewer is a table that does not exist, and a clip cut
    between two seats would jump between two rooms. Hashing the room code client-side would agree
    just as well but would freeze a room's map forever, and a rematch is meant to feel new.
  - **`maps.test.ts` pins the client's three lists and every per-map weather list to the Go source**,
    in order. A map, an hour or a sky on one side and not the other is a match dealt into a room this
    client cannot draw, and it fails as a plain felt, silently.
- **`tableRect()` remains the single authority on the board's geometry.** A scene replaces how the
  felt is *painted*, never where anything is: piles, seats, direction ring and every animation
  coordinate are identical with or without one. There is no `playfield` and no `tableImageRect()`
  any more: the felt *is* the rectangle, and the CSS table is drawn on it directly.

### The light rig (`scene/sky.ts`)
The hour and the sky, as numbers, with no framework and no three.js in the file, so a content page
can read it and a test can assert it. `lightRig(time, weather)` returns the sky gradient, the sun
(colour, intensity, elevation, azimuth, shadow strength), the hemisphere fill, distance fog or null,
and five things the kit and the board build from: `lampsOn`, `windowsLit` (a share), `snow`, `wet`
and `dark` (0 at noon, 1 on a stormy night). The weather is applied *over* the hour — a storm at
noon is still lit from above — and the overcast grey is the hour's own horizon mixed down, which is
what keeps twenty-four combinations from being six: a grey dusk is warm and a grey dawn is pink.
`rigCssVars` is the same rig as four custom properties (`--sky-top`, `--sky-horizon`,
`--scene-tint`, `--scene-dark`) for the board, the overlay and the rooms page.

### The kit and the builders (`scene/kit.ts`, `scene/maps/*.ts`)
A builder never touches three.js. It calls `box`, `cyl`, `sphere`, `cone`, `prism`, `disc`, `halo`
and the props composed from them (`tower` with its window grid, its door, its floor bands and
something on its roof, `window` in a frame with a sill, `door`, `lamp`, `tree` in four kinds,
`person` with legs, arms, a hat or a bag now and then, `car` with glass and hubcaps, `flowerbed`,
`planter`, `bush` with berries, `stall`, `bench`, `fence`, `road`, `lantern`, `flag`…), and
`build()` merges every block into five meshes — lit, glow, ink, shadow, halo — so a whole city is a
handful of draw calls. Four decisions make it look like the rest of the UI rather than a tech demo,
and each is the kit's, not a builder's:
- **Every block carries an outline, in a darker note of its own colour** (`inkFor`), the rule every
  raised object in `tokens.css` obeys with one deliberate difference: the interface draws its ink
  in `INK` because a button is one object on a plain ground, and a city is ten thousand objects —
  ten thousand black rims on it read as wire, not as drawing, and the reference illustration
  separates its shapes with a deeper tone of each fill. An inverted hull per block, drawn back-face
  only, sized from the render's pixel density so the line is ~2 CSS px on a phone and on a monitor
  alike. Per block rather than by pushing vertices along normals, because a box's faces do not
  share vertices and a per-vertex push leaves the corners open. **And a wall darkens towards its
  foot** (`GROUND_SHADE`, on the sides of anything over 0.6 tiles tall): what an illustrator does to
  sit a building on the ground, and what vertex interpolation gives for free.
- **Colour is a vertex attribute, and so is the light** (`scene/shade.ts`, `sceneShade.test.ts`).
  There is no light object in the scene: as a block is pushed, the tone of each face — the top in
  the light, the side towards the sun a step down, the far side two steps down and leaning towards
  the sky's ambient rather than the sun's colour — is multiplied into its vertex colour from its
  normal, and anything in between snaps to the nearest of the three. **The size of the step is the
  whole of the lighting, so it is not a taste setting**: at 1 / 0.84 / 0.66 there was a sixth of a
  stop between a roof and the wall under it in full sun and a fifth between that wall and the one in
  shade, and a street of cubes at that spacing comes out as one flat wash of its own colour —
  "it looks like there is no lighting" is the correct reading of it, and it was the report. An
  illustrated isometric puts the shaded side at about half the lit one; these are 1 / 0.74 / 0.47,
  and `sceneShade.test.ts` pins the ratios rather than the numbers. A cylinder is three stripes,
  a ball three crescents, never a gradient. Exposure follows `rig.dark` and the light's own colour
  tints everything a little more the darker it is, so a dusk is amber and a night is blue rather
  than merely dim. **What it replaced**: a `MeshToonMaterial` ramp under a real directional light
  and a hemisphere fill, which banded on every cylinder and greyed every colour through the
  ambient, plus a 3072² PCF shadow map, which put soft noise and acne on every façade. The
  illustrated isometric city this room is modelled on has flat tones and hard shadows and nothing
  else, and that is now exactly what is rendered.
- **Every outlined block throws a shadow on the ground**, and it is a polygon, not a map: its
  corners slid along the sun's ray to `SHADOW_PLANE_Y` (a tenth of a tile up, above the paving and
  the roads and below anything that stands) and wrapped in a convex hull — exact for every convex
  solid the kit builds, which is all of them. **A drawing's shadow is a shape, not a tint**: at 0.26
  of a sky-blue it was a smudge nobody read as a shadow, which was the other half of the room
  looking unlit, so it starts at 0.38 and still thins with the hour and with the sky.
  The run is capped at 1.25× the height (`shadowRun`),
  because a dawn sun eleven degrees up throws five times a block's height and a street of ten-tile
  houses became a street of shadow. **Drawn once through the stencil** (`EqualStencilFunc` on 0,
  `IncrementStencilOp` on pass): two shadows overlapping stay one tone rather than stacking their
  alpha into a blot at every crowded corner. The renderer asks for `stencil: true`, which three.js
  no longer gives by default. Whether a block throws one follows whether it is outlined — the two
  together are what says "this is an object" rather than "this is a surface" — and a sprite of
  something in the air is built with `shadows: false`.
- **The weather is answered in the kit, once**: `snow` caps every flat top and whitens the ground and
  the foliage, `wet` darkens the ground the builder asks for and lays puddles catching the sky,
  `lampsOn` decides whether a lamp's head, a window, a neon tube or a lantern goes into the unlit
  `glow` bucket (with a halo) or the lit one. A builder says "this is a lamp"; the kit says what a
  lamp looks like tonight. Which is why one builder per room is enough for twenty-four moods.
- **Every decision is seeded** (`scene/rng.ts`, mulberry32 on the scene's key): which windows are
  lit, where a crate stands, how tall the third tower is. A place that rearranges itself on refresh
  is not a place, and every seat at the table has to see the same one.
- **The table stands on a podium the render carries under exactly the felt** (`maps/common.ts:
  podium`, `layout.ts: feltInViewport`). The board's geometry is reproduced in viewport pixels
  (`boardScale` → `boardSpace` → `seatLayout` → `tableRect`, the same chain `GameBoard` lays the
  table out with) and handed to the render as the felt's screen ellipse (`FeltAnchor`, then
  `k.anchor` in tiles). A screen ellipse is a ground ellipse with semi-axes `a` across and
  `b / sin(pitch)` along, and a drum of height `h` shows its top `h · cos(pitch)` higher on screen
  than its base, so the drum is placed that far below the anchor and its top face lands under the
  CSS felt to the pixel, with two steps, a paved plaza and a ring of the room's light around it.
  **This join is what let the blur go**: the felt is CSS and the podium is a bitmap, but they are one
  object, and the seam between a sharp table and a blurred room was the thing that said "painted
  over a photograph". The drum's top is the room's felt colour, so the loading screen (which draws no
  table) shows an empty table where the match will be dealt. `maps.test.ts` pins the anchor to the
  board's own chain at three viewports, and the anchor is part of the cache key, so a resize that
  moves the table re-renders the podium under it.
- **Composition is done in screen space** (`at()`, `screenOf()`, `underTable()`): a builder places
  its heroes relative to `k.anchor` (the tavern to the right of the table, the pagoda above it, the
  torii bottom-left) rather than at world coordinates, so the same builder frames a monitor and a
  phone. What the table hides is an ellipse around the anchor; the hand covers the bottom middle and
  the seat pills the top; what is meant to be seen stands in the side bands and the top band, and
  the grid fills every corner behind them.
- **The rest of the room is a street grid** (`cityGrid`): blocks and roads over the whole floor, with
  dashes, sidewalks, crossings, a lamp at the corners, cars along the segments, people on the
  sidewalks, and optionally one road line that is water with a bridge at every crossing. Each
  builder hands it a `fill` for a block (`lots()` subdivides one into houses) and a `land` predicate
  (the sea, the plaza). This is what the example the rooms are modelled on is made of — many small
  simple buildings, roads between them, something on every corner — and a builder that draws heroes
  and nothing else comes out as a monument in a field.
- **The band in front of the table is kept low** (`Cell.front`, from `GridSpec.maxHeight`). The
  table is drawn over the render, so a building standing between the camera and the felt is cut by
  an object farther from the camera than it is, which reads as a table floating over a rooftop. A
  cell whose full-height building would rise into the felt is flagged, and every builder answers the
  flag with a low fill (a kiosk, a parked car, a garden, a tank farm) rather than a tower.
  **The band is measured against what a block *reaches*, not against its centre.** A block is a
  square in the world, and at `rot = π/4` both of its sides run diagonally, so it covers
  `(w + d) / 2 / √2` across the frame — the band stopped a whole half-block short of that, and the
  first row either side of the table put its awnings and its upper floors under the felt. A
  **landmark** is the same arithmetic done by hand: the grand hotel is fifteen tiles square, which
  is ten and a half across the frame, so at `sx + a + 10` its near corner stood a tile and a half
  inside the felt and the table cut the ground floor off a building in front of it. Every landmark
  beside the table sits at least its own half-width plus two clear of `a`. Being cut by the **frame**
  is fine and ordinary; being cut by the table is not.

### The render (`scene/render.ts`, `scene/sceneCache.ts`)
- **One frame, then the context is released.** A match is a hand of cards animating over the scene
  for twenty minutes, and the board's compositing budget belongs to the cards (`cardArtSpace` was
  bought at 3 → 10 fps on a full hand; a live viewport under it would spend that again). So the
  diorama is rendered **once**, the pixels are copied into a 2D canvas, the geometries and the
  WebGL context are disposed, and what the board draws from then on is a static bitmap, exactly as
  cheap as the photograph it replaced. Everything that moves — rain, snow, the fog's drift, the
  storm's flash, the cloud shadow — is a CSS transform animation on a **drawn tile**
  (`weatherTiles.ts`, `WeatherLayer.svelte`), one compositor layer each, and holds its first frame
  under reduced motion (the flash and the bolt are the one thing that goes away entirely: a
  full-frame flicker is what the preference exists to refuse). The tiles used to be CSS gradients —
  a `repeating-linear-gradient` of one-pixel lines for rain, six radial dots for snow — and looked
  like it: every streak the same length and the same white, every flake the same dot, a pattern the
  eye picked out in a second. A tile is a seeded bitmap now, drawn once per tab into a canvas and
  handed to the sheet as a data URL (`img-src` allows `data:`): sixty streaks of different lengths,
  weights and fades, soft flakes with a few big blurred ones close to the lens, haze and cloud shadow
  made of overlapping blobs. Every shape near an edge is drawn again one tile over, in both axes, so
  the tile wraps; the shapes are pure and seeded (`rainDrops`, `snowFlakes`, `fogBlobs`,
  `dustSpecks`) and are what `sceneWeather.test.ts` asserts, since jsdom has no canvas — a
  browser with none gets an empty URL and a dry room, never a throw.
  **Every sheet travels exactly one tile per cycle, and never a percentage of the frame**: the sheet
  wraps back to its start at the end of the cycle, so unless the distance it travelled is a whole
  tile the pattern lands somewhere else than it left — the rain stepped sideways once a cycle on
  every screen whose height was not a multiple of 240. `tiled()` writes the tile as the sheet's
  background **and** as `--tile-w` / `--tile-h`, and the two keyframes (`fall`, `drift`) travel by
  those variables and by no literal, so the two cannot disagree. **The wind is a skew, never a
  diagonal travel**: a streak leaning ten degrees has to fall along its lean or it reads as a drawn
  line sliding down the screen, but a diagonal translation only wraps when both legs are whole
  tiles, which pins the angle to the tile's shape; `.wind` skews the sheets and the vertical wrap is
  untouched. The snow sways on an outer element and falls on an inner one, two transforms on two
  layers. Nearer is faster and brighter (`FALL_S`, `DRIFT_S`, `SWAY` beside `TILES`, so a speed is
  a number somebody can read), and none of it faster than about 550 px/s, past which a spectator
  reads static. How many sheets is the graphics tier's: three of rain and of snow on `high`, two on
  `medium`, one on `light`. Lightning is a sheet flash plus the glow of the bolt off one top corner,
  two flashes close together and a lone one every seventeen seconds, the sheet never past a third.
  A room that declares `dry` (Orbit) gets no rain in a storm: the flash and a drift of dust, because
  nothing falls on an airless moon and the server's weather list says `storm`, not `rain`.`storm`, not `rain`.
- **Isometric, orthographic, framed in tiles.** The camera looks down from a corner at 32°, the
  Habbo angle, so a block's top and two faces are visible and every block reads at the same scale
  wherever it stands. The visible extent is `TILES_ACROSS` (80) tiles on the longer side rather than
  a number of pixels, so a phone and a monitor frame the same density. The number is the density:
  the table hides roughly ±27 by ±12 tiles around its anchor on a monitor, a house is five tiles
  and a person one, so what is left is three rows of houses and a crowd around it. At 32 it was one
  house. Resolution is the viewport at `devicePixelRatio` capped at `MAX_DPR` (2) and `MAX_SIDE`
  (2800) on the long side (`renderSizeFor`).
- **The frame is supersampled** (`SUPERSAMPLE`, 2; `MAX_GL_PIXELS`, 7 M; `supersampleFor`). With
  the light baked and the shadows flat, the one thing the GPU is asked for is edges: the frame is
  rendered up to twice its size on each side, on top of multisampling, and scaled down with
  `imageSmoothingQuality: 'high'`, so an ink line a tile long is one clean stroke at any angle
  rather than a stair. The budget is in pixels, so a phone gets the full factor and a 4K monitor
  at 2× gets what fits under seven million; the side is also held under 4096, which is the texture
  a mobile GPU still accepts. This is what made the cap on `MAX_DPR` safe to raise from 1.5: the
  bitmap kept for the match is still the viewport's size, only the render behind it is larger, and
  the context is released the moment it is copied.
- **And then the frame is photographed** (`scene/post.ts`, `scene/quality.ts`, `sceneQuality.test.ts`).
  The room is drawn flat on purpose, and what the finishing passes add is the *camera* that
  photographed the drawing: a last FXAA pass over the supersampling (the compact form of 3.11, five
  taps to find the edge's direction and four along it — the last quarter-pixel of stair a diagonal
  ink line still shows at 2×), the lamps' bloom (a bright pass at a quarter of the frame, blurred
  twice, added back scaled by `rig.dark` so at noon the snow does not glow and at midnight the lamps
  are the light), a **tilt-shift** focus held on the felt's band and easing off towards the top and
  bottom of the frame — which is how a diorama is photographed, and the one of these a viewer names
  — a vignette elliptical with the frame, a colour fringe out in the corners only, and a fine static
  grain so a wall is a surface rather than a fill. A slight grade in linear light: a touch of
  saturation and of contrast about mid-grey, small because the tones were chosen by hand.
  - **Colour is the contract with the plain path.** The scene renders into a half-float target
    (eight bits of linear light band in the darks of a night room; a GPU that refuses the format
    gets bytes) in linear, the passes work in linear, and the composite ends on
    `colorspace_fragment`, which is the same sRGB encoding `outputColorSpace` gives the direct
    render — so a room with every pass off comes out the colour it came out before there were
    passes. Multisampling is off once supersampling covers it: a 4× MSAA half-float target at 4096²
    is more memory than a phone will grant.
  - **It runs once, and everything it allocates is released with the context.** Every target is
    disposed in a `finally`, and a throw anywhere inside — a target the GPU will not hold — falls
    back to the plain render (`renderScene`: `photographed`), never to no room. A software GPU
    (headless Chromium) is handed the plain frame as before, unless tooling asked for the full one
    (`setForceFullRender`, `?gfx=force`), which is how `make rooms` and a `--gfx=force` visual
    review get it.
  - **Which passes run is the graphics tier's** (`QUALITY`): `high` supersamples up to 3× under 12 M
    pixels and runs all of them; `medium` 2× under 7 M with FXAA, bloom and the vignette; `light`
    is the plain multisampled frame. The tier is the player's (`hooks/graphicsPref.ts`): `auto`
    reads memory, cores and pointer (`autoTier`: under 4 GiB is light, a coarse pointer or four
    cores is medium, else high — a browser that says nothing is a desktop until proven otherwise,
    because the cost of guessing high is a longer gate and not a slow match), and the three explicit
    tiers win over it both ways. It is a segmented row in the preferences panel with the hint naming
    what `auto` landed on, and **it is part of the cache key** (`sceneCache`, `PreparedScene.tier`)
    so moving it mid-match renders the room again, faded in over the old like any re-render.
- **The anchor is the same room whatever the screen is made of** (`renderSizeFor`, `anchorFor`,
  `sceneGeometry.test.ts`). `renderSizeFor` caps the bitmap's long side at `MAX_SIDE` device pixels and
  `anchorFor` divides CSS pixels by the ratio it reports, so the two have to agree: handing back the
  ratio the *screen* asked for after cutting the size down put the anchor **eight tiles right of the
  table and a fifth too large**, and the podium the whole room is composed around was built somewhere
  the table is not. It bit on any display denser than 1× wider than 1600 CSS px — most laptops and
  every phone in landscape — and never in CI, because `make visual` shoots at 1×. A room a few tiles
  out is still a room: nothing errors, nothing looks broken, and the harbour's boats are simply
  moored on the beach.
- **Composition against a screen line goes through `screenSpan`** (`maps/common.ts`). `box(w, h, d)`
  is world-space, and at `rot = π/4` its `w` runs across the frame one tile for one while its `d`
  runs up it at `sin(pitch)` — so the harbour's pier, written as "4.4 across by 1.2 along", came out
  **1.2 tiles wide on screen**, and its railing, its lamps and its cargo, all placed in screen tiles
  either side of it, stood in the water beside a plank. Anything laid against a screen line takes the
  helper, and its furniture is then placed at `at(sx ± sw/2)` and lands on it.
- **A landmark taller than seven tiles belongs in a side band, not the top one.** `sy + b + 8` is
  about a sixth of the way down a monitor's frame, which leaves seven tiles of headroom: the wizard's
  tower is twenty and the rocket eighteen, so both were a base with everything above the top edge.
  Beside the table (`sx ± (a + 8), sy + 2`) there are twenty-eight. The tavern and the bathhouse were
  always there; the two that were not have moved. **On a phone the frame is barely eighteen tiles
  wide and a side band is outside it** — which is already true of the fair, the beach and the torii,
  and is what that band is for.
- **A room is built once per match, and it is built on the main thread, so what it costs is
  measured** (`render.ts` logs `build / merge / draw / sprites` in DEV). The neon city is about a
  half-second of build on a laptop. Three things keep it there rather than at the two seconds it
  reached — **a window is two quads on a sheet, never two blocks** (`Kit.quad`, flushed by
  `build` into one geometry per bucket: the neon city has ten thousand windows, and as boxes they
  were a hundred thousand geometries against seven thousand for everything else), `place()`
  composes one matrix and applies it once (three passes with a normal-matrix update each), and a
  tower's windows are spaced 1.15 tiles with no sill (the frame is the whole drawing at that
  size). The primitives are cloned from cached unit shapes, which turned out to buy little: the
  cost was the count, not the constructor. **And it is built exactly once**, which took three
  separate guarantees and each of them was missing at some point:
  - **`viewportSize()` reads the window synchronously.** The preload asked for the felt's anchor
    before any effect had measured anything, solved it from 0 × 0 to a felt with no size, and
    rendered a whole room around a point that the real size then threw away — every match paid for
    its room twice, and the second one landed *after* the gate opened, as a stall on the first turn.
    `<SceneBackdrop />` refuses a felt with no size for the same reason.
  - **`safeAreaInsets()` reads them synchronously too**, and this was the same bug's other half. The
    anchor is solved from the viewport *and* the insets; seeded at zero and filled in by an effect,
    the room was built around a table twenty pixels up the screen from the one the board settles on,
    thrown away, and built again — on a notched phone, twice a match, on the devices least able to
    afford it. Measured with the probe in `hooks/safeAreaInsets.ts`, which is safe to call during
    setup (no `document.body`, no insets).
  - **A frame within four per cent of the size asked for is stretched, not re-rendered**
    (`sizeCloseEnough`, `sameFelt`). Three things ask for the same room while a match opens — the
    gate, off the viewport; the screen it puts up and the board behind it, each off its own element —
    and they agree to the pixel only when nothing sits between the element and the edge of the
    window. A scrollbar, a browser bar on its way out, a `dvh` that is not `innerHeight`: any of them
    made the board's request a different cache key. The felt is compared by value, because the anchor
    is a `$derived` object and an unchanged viewport still hands out a new one on every re-run.

  `sceneLoadingGate.test.ts` owns all three.
- **`make visual` waits for the room.** The showcase's ready flag fires when the screen mounts,
  and the frame lands a build later — seconds, on headless Chromium's software GPU. Captured
  before it, the room is the sky gradient with the frame mid-fade over it, which reads as a blue
  veil over the whole city and is nothing but timing; `tools/visual/shoot.mjs` waits for
  `.scene:not(.bare)` on any scene that has one.
- **The engine is a lazy chunk.** `sceneCache.prepareScene` is the only importer of `render.ts`,
  through a dynamic `import()`, so three.js never reaches the home page, a waiting room or a content
  page; the map-loading gate is what absorbs the fetch (`sceneCache.PROGRESS`: the chunk is the
  first 10% of the bar, the kits the next 25%, the render's own phases the rest). The chunk comes
  off this origin like every other, so the CSP is untouched and `csp.test.ts` still passes on
  `'self'`.
- **The loading bar is painted between the phases of the render, and that is what makes it a
  bar.** The room is built and drawn on the main thread, and on a rematch — chunk and kits cached
  per tab — that stretch is the whole wait. It used to run in one synchronous piece after a
  `setTimeout(0)`, which was meant to let the screen paint first and did not: a macrotask fires a
  few milliseconds later, inside the same frame, so the thread was taken with the bar drawn at zero
  and the next paint anybody saw had it at one. The player's reading — "it goes from empty to
  loaded, it looks stuck" — was exact. Two things fix it (`scene/nextPaint.ts`,
  `sceneProgress.test.ts`): a report is followed by **two animation frames** (the first callback
  runs before its frame is painted, the second after; a timer stands in for a hidden tab, where no
  frame ever comes and the render still has to happen), and `renderScene` is asynchronous in
  phases — build, merge, draw, depth, then the sprites a few at a time — reporting
  `RENDER_STEPS` and yielding to a paint between each. The weights are a rough measure of where a
  room's second goes, not a promise: the bar is honest about *moving*, which is the thing a player
  can check, and only roughly about *how far*.
- **And it ends full.** Nothing under that bar ever reports one: the render stops at its last
  batch of sprites, `prepareScene`'s own `onProgress(1)` lands in the same tick as the resolution,
  and the curtain used to lift on a bar somewhere around nine tenths — which reads as a room that
  was given up on, not one that finished. So the settle is two steps now (`gamePlay.svelte.ts`'s
  `mapPreload`): the bar is put at one, painted (`nextPaint`), and held for `MAP_BAR_FULL_MS`
  (`hooks/mapPreload.ts`) — just above `.fill`'s own transition, so the fill has travelled the whole
  track before anything moves — and only then is `done` published, which is what sends `map_ready`.
  The 12s preload timeout ends through the same settle for the same reason, and 12s plus this is
  still far under the server's 20s `MapLoadTimeout`. The wait is paid once per match behind a
  curtain that is already up, and under reduced motion the hold is zero: the fill snaps, so there is
  nothing to wait for. `mapLoading.test.ts` pins both halves — that the bar is full before
  `map_ready` goes out, and that the hold outlasts the transition it is paying for, read off
  `MapLoadingScreen.svelte` rather than typed twice.
- **A render that fails is a scene, not an error.** No WebGL, a lost context, a builder that
  throws: the cache keeps the entry with a null bitmap, `<SceneBackdrop />` shows the rig's sky
  gradient (which is on screen from the first frame anyway, under the bitmap), and the gate is
  answered. A client that never sends `map_ready` is the one outcome the gate cannot survive, and it
  is the reason `prepareScene` never rejects.
- **Nothing pale is shown while the room is still being built** (`.scene.bare`). Until a frame
  lands, the sky gradient *is* the room — and at noon that is a full screen of near-white under the
  loading screen's white type, on a game whose every other surface is dark: the reveal read as a page
  that had failed to load rather than as a room about to open. `.bare` mixes both stops down to a
  little over a third over the void, so it is still the hour's own sky (a dawn is pink, a dusk amber,
  a night blue) and the type keeps its contrast. The frame is opaque, so this is only ever seen while
  there is nothing to see — including the one case where there never will be, a render that failed.
- **And nothing of the board is shown either: the curtain is opaque from its first frame.** The
  loading screen is an overlay over a *mounted* board — that is the whole point of it, since the
  board spends the wait laying itself out — so an entrance animation on `.screen` fades the void off
  the table it exists to hide. It had one, `mapRoomIn` at 0.6s, and every match opened on half a
  second of the felt and the seats showing through the reveal. The fade belongs to what is *inside*
  the curtain: `.room` wraps the backdrop and the scrim and comes up out of the void, which is the
  effect that was wanted, while `.screen` paints `--room-void` from the start and lets nothing
  through. `sceneLoadingGate.test.ts` pins both halves.
- **The board and the loading screen share the frame, and both draw it sharp.** The first cut
  blurred the board's copy as depth of field, and the blur was doing a second job: hiding that the
  table and the room were two pictures. With the podium under the felt they are one object, and a
  blur between them would be the seam, so `<SceneBackdrop />` has no blur at all. What keeps a card
  edge winning at 720p is the vignette and the cards' own ink line, not a softened room. The cache
  holds three entries (a match, its rematch, a resize), keyed on the scene, the device size **and
  the anchor**.
- **The backdrop isolates its own stack** (`.scene { isolation: isolate }`, `sceneBackdrop.test.ts`).
  It holds two canvases that swap places and the weather above both, so it declares `z-index` three
  times — and `position: absolute` does not contain a z-index. Without the isolation those three
  climb into the board's stacking context, where they outrank `.stage`: the room is painted over the
  cards and the match has no table, no hand and no deck. `.board` isolates one level up for exactly
  the same reason.
- **A resize is a stretch, and then one render** (`SceneBackdrop.svelte`: `RESIZE_SETTLE_MS`, 240 ms).
  The street is composed in screen space around the felt, so two sizes are two different cities, and
  a window being dragged is hundreds of sizes. Rendered per resize event — which is what the first
  cut did, because the effect read the raw viewport and the 96 px step it declared gated nothing —
  the room rebuilt itself under the table dozens of times a second: a frame of main thread each time
  and a visibly different street each time, which is what "the background regenerating" was. The
  frame already up is stretched for free while the drag lasts, and one render is asked for once the
  viewport has held still. **Quantising the size instead would buy nothing**: the podium is built
  under the felt, so a felt that has moved needs a render whatever the width did. The debounce is
  skipped in the one case where there is nothing to stretch — a first mount, a new map, a render
  that failed — because that is the path the map-loading gate waits on.
- **And the render that lands is faded in over the one it replaces, never swapped for it.**
  `<SceneBackdrop />` holds two stacked canvases: the outgoing frame is left at full opacity
  underneath and only the incoming one is animated (`--scene-fade`, 260 ms). Cross-fading them —
  one down while the other comes up — lets the sky through at half opacity in the middle, and on a
  room that has barely changed that reads as a flash. The incoming canvas is held at `opacity: 0`
  with `transition: none` for one flush and a forced layout read, or the two writes coalesce and
  there is no transition left to run. Reduced motion drops the transition and keeps the swap.

### The models (`scene/models/`, `scene/placer.ts`, `tools/models/pack.mjs`)
The blocks were the limit. A house of ten boxes is a box, and the reference the rooms are judged
against is drawn by artists; so the props are drawn models now — Kenney's city, suburban, roads,
nature, car, pirate, fantasy-town, space and holiday kits, and two Quaternius pieces for the shrine,
all **CC0** (`client/public/models/CREDITS.txt`, `NOTICE.md`) — and the kit is what imports them.
- **The manifest is the allowlist** (`models/manifest.json`): per kit, the unpacked archive it
  comes from, the folder holding its GLBs, the scale that turns its units into tiles (a Kenney
  city house is 1.3 units and stands 4.4 tiles wide here; a pirate lighthouse is 10 and stands
  10), the palette colours that glow after dark, and the models used by name. `make models` copies
  exactly those out of `.assets-in/unpacked/` into `client/public/models/<kit>/`, with the kit's
  palette texture at the relative path the GLB references, and writes the credits. The downloads
  are ignored by git; what is packed is committed, because the site serves it and a room a player
  is dealt into cannot depend on somebody's downloads folder. **Served from this origin, never a
  CDN**: the CSP allows no other, by the legal position in `legal.md`.
- **A model is baked into buffers, once per tab** (`models/lib.ts`, `bake.ts`). The loader
  (`GLTFLoader`, three's) gives a mesh with a palette texture and UVs; the palette is sampled at
  each vertex's UV into a vertex colour (in linear, like the material factor a texture-less model
  carries), the model is scaled into tiles, centred on the ground under it and stood on `y = 0`,
  and what is kept is positions, normals, colours, an index, and **smoothed normals** — the
  normals of every face meeting at a position averaged, one weight per face direction, which is
  what the outline hull is pushed along, because a flat-shaded model's faces share no vertices and
  a push along each face's own normal opens every corner. A person is baked in two poses off the
  kit's own animation clips (`idle`, `walk` mid-stride) through `SkinnedMesh.applyBoneTransform`.
  The three.js objects are disposed the moment the buffers are out.
- **And then it is a block**: `k.model(id, x, z, {rot, y, scale})` transforms the buffers, multiplies
  the tone of the hour and the ground shade into the colours (`pushBaked`), lays the shadow polygon
  from its vertices, pushes the hull in each vertex's own darker note, and after dark sends the
  faces painted in the kit's glow colours to the unlit bucket in the warm window colour every
  block window wears (`splitGlow`) — so a Kenney house lights its windows at night and darkens its
  foot the way a box house does, and the room stays one merged mesh per bucket.
- **The kit's props take the model when the room has one.** `k.person` (a spacesuit where the room
  has the space kit, one of twelve townsfolk otherwise, mid-stride when walking), `k.car` (Kenney's
  drive along +z, ours face +x, a quarter turn goes on), `k.tree` (by kind; the cherry stays a
  block, no kit has a pink crown), `k.lamp`, `k.bush`, `k.rock`, `k.crate`, `k.barrel`. A builder
  never names three.js, a file or a format; the same builder builds a room of blocks when the kits
  are not loaded, which is what a model that failed to fetch degrades to.
- **Nothing stands inside anything else** (`placer.ts`, `placer.test.ts`). Every `k.model` claims
  its footprint — an oriented rectangle, the kit's rotation convention, grown by a margin — and is
  refused when the claim overlaps one already made; the answer is the builder's to move on from. A
  builder claims its zones first: the podium's steps and drum, the water, a road. The test is the
  separating-axis test on two rectangles, and the claims are filed in a coarse grid so a room of a
  thousand claims does not test each against every other.
- **The kits per room are declared beside the builders** (`maps/index.ts: KITS`) and loaded by
  `sceneCache.prepareScene` before the builder runs, as the middle half of the loading bar on a
  first visit and nothing on a rematch. A packed room's models are one to two megabytes gzipped,
  under the engine chunk.

### What moves (`scene/life.ts`, `scene/LifeLayer.svelte`, `maps/actors.ts`)
The room is rendered once and released, so nothing in it can move — and a room where nothing moves
is a photograph again. What moves is **a sprite over it**: a boat, a balloon, a passer-by, a puff of
smoke, built with the same kit under the same light and the same line weight, rendered to its own
little bitmap **in the same pass as the room** (`render.ts`, after the frame: one more scene per
actor, cleared transparent, sized to the actor's projected bounds, the ground point recorded), and
carried along a route by one Web Animations transform (`LifeLayer.svelte`). The board's compositing
budget still belongs to the cards: an actor is one composited layer under one animation, exactly
what a rain layer is, so a ferry costs the board what a raindrop does, and the render loop it would
otherwise take stays closed.
- **A builder returns its actors beside the room** (`Builder = (k) => Actor[] | void`). An actor is a
  `build` that draws the thing at the origin standing on `y = 0` heading +x, a `path` in the same
  screen tiles everything else is composed in (`sceneLife.test.ts` pins that frame to the render's
  own: `TILES_ACROSS` off the longer side, the origin at the centre, `sy` up), a `motion`: `loop`
  (a circuit), `bounce` (there and back), `pass` (across once, then gone until `every`) — and
  either a `duration` or, for a thing on the ground, a `speed`. `turn` flips the sprite on a leg
  that heads left; `bob`, `spin` and `puff` animate an inner element; `fade` softens the ends of a
  run; `flying` builds it without a ground shadow. The common ones — `cloud`, `bird`, `balloon`,
  `plane`, `puff`, `walker`, `strollers` on the promenade round the plaza, `streetWalkers` on the
  pavements, `traffic` in the lanes, `pacers`, `boat`, `mote` after dark — are `maps/actors.ts`;
  the harbour's ferris wheel (spokes spinning about the hub, twelve cabins riding a circle upright)
  and the moon's rover and satellite are their builders' own.
- **A `loop` either walks its closing leg or fades over it, and there is no third option**
  (`closesTheRing`, `sceneLife.test.ts`). A loop wraps to its start, and a wrap the player can *see*
  is a person teleporting home and setting off again — which is what every walker whose route
  survived trimming whole did, because the keyframes stopped at the last point and jumped back to
  the first. Two honest ways to wrap: a cloud, a bird or a puff **fades** at both ends of its run, so
  the jump happens while there is nothing on screen (that is what `fade` and `puff` are for); anything
  else has to travel back, so the closing leg is walked and `routeLength` counts it. A path that
  already ends where it started is a circuit and closes itself — `mote` is one.
- **A thing on the ground moves at a speed, and distance is measured on the ground.** `WALK_SPEED`
  is 0.75 tiles a second against a person a tile and a half tall, `DRIVE_SPEED` 3.2; the route
  decides the duration (`durationFor`, there and back for a bounce), and every leg is weighted by
  `groundDist` — a leg up the screen is `1 / sin(pitch)` longer than it looks. Written as
  durations, the strollers did the plaza's ring in eighty seconds, which is two and a half tiles a
  second, and a cloud drifting at one screen speed is the only thing here that should.
- **A route on the ground is a candidate, and the render decides where it runs** (`life.ts:
  trimRoute`, `selectActors`; `render.ts: readDepth`). A sprite is drawn over the whole frame, so
  it passes in front of everything the render has, and a walker crossing a house at the wrong depth
  is the illusion breaking — which is what every stroller did on the old ring, six and a half tiles
  out from the felt, through the crowd, the market stalls and the first row of blocks, and what the
  two cars lapping the paving did across the whole lower band. Now a builder says what a thing
  takes up (`body`: width across the screen, height, footprint) and hands in every route it might
  take, and every route is sampled at half a tile. A sample stands where (1) it is inside the frame
  or three tiles off it and (2) the ground plan (`placer.ts`) is free of its footprint — `cityGrid`
  claims every lot it fills, since a house is blocks and blocks never claimed — **asked with no
  margin** (`Placer.free(f, margin)`, `kit.free(…, 0, 0)`). The placer's 0.3 keeps two things
  *built* from touching; a thing passing through only has to not stand inside anything, and with
  the margin on, a bystander standing at the kerb line refused the walk line 0.7 tiles behind him
  and cut every pavement into stretches of three or four tiles. The longest run of good samples is
  the route: a loop that is cut walks its longest clear arc there and back, a `pass` fades over
  one tile at either end (that is where it would walk into something the plan has claimed, or off
  the frame — and a pass that survives whole gets those fade *points* too, because fading the two
  endpoints of a two-point route is a crossing that is transparent from end to end), and a run
  shorter than `minLen` (four tiles; ten for a stroller, twelve for a car) is dropped. A `part`
  then takes a stretch of what survives, so three strollers handed the same arc are three walks.
  **A `pick` group is how a builder asks for a few without having seen the frame**: `streetWalkers`
  hands in both pavements of every run both ways, `traffic` the right-hand lane of every run both
  ways, and the `keep` worth most survive — worth being the length *seen*, inside the frame, not
  under the hand, and not behind anything the room drew nearer (`lengthInside`, `occluded`); a
  survivor worth less than its `minLen` is dropped whatever its length, since a route that runs
  whole behind a terrace is a layer nobody sees. Which pavements survive depends on the viewport:
  on a monitor it is the ones with the plaza or the low front band on their near side, on a phone
  the deep top and bottom bands. `sceneLife.test.ts` pins the trimming, the selection, the depth
  arithmetic, and that `render.ts` reads the depth back and selects before a single sprite is built.
- **What stands in front of a route is a veil over the sprite, never a cut in the route**
  (`life.ts: occlusionVeil`, `Sprite.mask`, `render.ts: veilImage`, `LifeLayer`'s `.veil`). After
  the frame is drawn the room is rendered **once more, as depth** — the same scene under a
  material that packs eye depth into RGBA, into a target at half the frame's resolution, read back
  once and released with the context, the shadows and the halos left out. The first version of
  this used that map to *cut* routes: a sample was refused wherever anything in the depth map was
  nearer than the thing's own silhouette by more than `OCCLUSION_SLACK` (0.3 tiles), the silhouette
  being the `body` stood on the sample and its depth written per row from the camera's pitch
  (`depthAt`: a tile up the screen on the ground is `1 / tan(pitch)` farther, a tile up a thing
  standing there is `tan(pitch)` nearer). The arithmetic was right and the consequence was wrong:
  a pavement has a lamp every block, a bystander at the kerb and a parked car in the lane beside
  it, and each one is *in front* of the walk line on the far side of the street, so every pavement
  became a row of three-tile walks — a `pass` fading in beside one lamp and out at the next, a
  stroller's ring cut into arcs walked there and back between two bystanders. Measured on the
  boulevard at 1920×1080: eight walkers of 3 to 9 tiles, no car at all. That is what "the things
  in the rooms walk backwards and fade away" was, and no threshold fixes it, because the test was
  answering the right question about the wrong thing. Now the same test is made **once per pixel
  and kept**: `occlusionVeil` walks the route in the depth map's own pixels, finds under each
  column the ground point the route stands at there (the nearest one where it passes twice, the
  silhouette's own width either side), and for the rows from its feet up its `body` — plus the
  little the shadow spreads below — writes 0 where the room's depth is nearer than the thing's own
  by more than the slack and 255 elsewhere. That byte map is the alpha of a frame-sized PNG
  (`veilImage`, at the depth map's resolution: the browser stretches it, so the edge of a building
  is soft by a frame pixel, which reads as the anti-aliasing the room already has), and the sprite's
  layer wears it as a CSS `mask-image` on a **wrapper that does not move** — the actor is animated
  inside it — so the walker goes *behind* the lamp post, the bystander and the parked car and comes
  out the other side, and a car drives its whole run. A sprite with nothing in front of it wears
  none and costs what it cost. Something in the air is never veiled. The mask is a `data:` URL, which
  `img-src` already allows, so nothing off this origin is fetched for it. The depth map is still
  what says what a route is *worth* (above): a route the veil would hide entirely is dropped
  before a sprite is built for it. `sceneLife.test.ts` pins the veil's arithmetic (a wall in front
  cuts the rows it covers in the columns the route reaches and nothing else; one behind cuts
  nothing; the air is never veiled), that `render.ts` cuts on the plan and veils on the depth and
  hands every sprite its veil, and that the layer wears the mask on the wrapper and not on the
  actor. The residual: a sprite is one bitmap, so its own silhouette is masked by *anything*
  nearer along the route's column, including a thing it is standing in front of at another moment
  of a route that doubles back — the nearer of the two ground points wins, so a doubling route
  ghosts over rather than vanishes behind.
- **Pavements are the grid's, and a street is a run.** `SIDEWALK` (1.4 tiles) comes off each side
  of a block before `fill` sees it, so the buildings stop at the building line; walkers keep to
  `WALK_LINE` (0.45 in from that line), standers and lamps to `KERB_LINE` (0.25 in from the kerb),
  and the 0.7 between them is what the placer's margin plus a person's claim needs
  (`sceneGeometry.test.ts`). It was 0.6 wide, which is narrower than a person, and the people it
  scattered "on the sidewalk" stood in the road. `cityGrid` returns a `StreetPlan`: every block-long
  segment it laid, merged by `mergeRuns` into one run per street from the last block it borders to
  the first it does not, so a car drives it end to end and a walker crosses the side streets. A car
  is built facing the way its lane goes (`carRot`, `personRot` — a mirror of a sprite facing one
  diagonal faces the *other* diagonal, not the way back, which is why a street walker is a `pass`
  one way rather than a bounce with `turn`). Facing is answered per heading, and the walkers on
  the promenade keep `turn` because that arc runs across the screen.
- **Two things were tried and taken out before any of this existed**: the harbour's ferris wheel
  turned for an afternoon as sprites (spokes spinning about the hub, twelve cabins riding a circle),
  and the cabins rode across the roofs of the terrace standing in front of the fair as pale cubes
  floating on the houses; and the ferry sailed the whole width of the frame, which took it through
  the lighthouse island and over the pier head. The wheel stands still in the render now, and the
  ferry runs east of the pier only, fading in there. Both would be trimmed correctly today; neither
  is worth putting back, because a wheel that only turns where nothing is in front of it is a
  wheel that stops.
- **A pass writes its opacity on every frame.** A keyframe without a property interpolates towards
  the next one that has it, so a route whose hidden tail alone said `opacity: 0` faded out across
  its whole crossing, and the ferry came through as a grey ghost. `routeKeyframes` writes `1` on
  the crossing whenever any frame carries opacity (`sceneLife.test.ts`).
- **Facing is a quarter turn.** Screen-right is the world (1, −1) diagonal, so a thing that faces +x
  at rot 0 (a car, a boat's bow) is built at π/4 and a person, who faces +z, at 3π/4. The mirror of
  that sprite faces the other diagonal, which is what `turn` relies on.
- **The layer is laid out in the frame's CSS pixels and scaled to the element**, one transform, so a
  window being dragged stretches the boat with the water until the next render lands with sprites
  of its own. It sits at z-index 3, above both frames and under the weather (4): the rain falls on
  the boat. **Reduced motion holds every actor on the first frame of its route** — the boat is
  still a boat, moored — which is the readable static state motion is required to degrade to.
- **A sprite is keyed on the actor's id within the room**, and its seed is the room's key plus that
  id, so the balloon's colours and the walker's hat are the same for every seat and after a reload.

### Props that were the same mistake in every room (`scene/kit.ts`)
Five of them, and each was one line of geometry standing in for something with a shape:
- **`awning`** — a canopy that starts *at* the wall and carries a valance. Every shopfront in the
  boulevard and every row house in the harbour hung a bare plate half a tile off its façade and
  wider than the façade it was on, which reads as a coloured card hovering in the air.
- **`festoon`** — the cord, and the lights on it. The square and the boulevard both placed their
  bulbs on a sine and drew nothing between them: a curved line of lanterns floating in the air with
  two posts standing some way off. **And a ring of posts, never four** (`stringLights`, in
  `maps/common.ts`, the only way a room strings them now — `sceneGeometry.test.ts` fails on a builder
  that festoons its own): four posts round an oval table is a rectangle laid over an ellipse, with
  corners nothing else in the room has and two runs going straight up the frame, and what it read as
  was a stray wireframe rather than bunting. Nine posts on the paving's own ring, and **each run hung
  by its own length on screen** — a run going up the frame is drawn shorter than one going across it,
  so the fixed count the two rooms guessed piled its lanterns on top of one another there and spaced
  them out here.
- **`stall`** — four legs, thick enough to be seen. Two posts a tenth of a tile wide on the centre
  line are hidden by the canopy from this camera and by the counter from every other, so what was on
  screen was a striped roof floating a tile above a box, in every market in the game.
- **`tree({ kind: 'palm' })`** — a frond in two segments, out and then steeply down. Five flat
  planks radiating from a trunk draw a five-pointed star, and a star is exactly what a 32° camera
  sees of anything horizontal.
- **A prism's `w` is its ridge**, so a roof rotated by `π/2` has to swap `w` and `d` with it. The
  harbour's terraces did not, and every roof sat across the house it belonged to.

### The table (`GameBoard.svelte`'s `.tableOval` / `.tablePlinth` / `.tableGlow`)
A felt inside a rim, standing on a plinth, all CSS, on exactly `tableRect()`. Every room hands the
same object its own materials (`MapDef.table` in `maps.ts`: `felt`, `feltDeep`, `rim`, `rimLight`,
`base`, `inlay`), reaching the style block as `--tbl-*`; without a scene the variables fall back to
the tokens' near-black table, which is what a lobby's felt and an unknown map id draw.
- **The materials never follow the hour; the light does.** A table is a physical thing and night
  does not repaint it, so `--tbl-*` are constants per room. What the rig hands the table is
  `--scene-tint` (the sun's colour, on the sheen across the top of the felt and the rim's top edge)
  and `--scene-dark` (a dimming of the felt, the rim, the vignette and the glow, through
  `color-mix()` with a `calc()` percentage). Neon's black glass at noon and at midnight are the same
  glass under two lights.
- **It obeys the three rules every raised object obeys**: an ink line on both sides of the rim, a
  hard bottom edge (the `0 16px 0` shadow *is* the rim's thickness, seen from above and in front),
  and a soft shadow that is ambience, never structure. The **inlay** is the one line of the room's
  accent set into the rim — a neon tube, a brass bead, a rune groove, a strip of lacquer — and it is
  what makes six tables six objects rather than six recolours.
- **In a room the render carries the plinth; without one the CSS does.** On a scene the table
  stands on the rendered podium (above), and its own cast shadow falls on the top step in the
  direction of the rig's sun (`--sun-dx` / `--sun-dy`), which is the cue that says "standing in the
  room" rather than "painted on its floor". `.tablePlinth` is drawn only when there is no scene (a
  lobby's felt, an unknown map id, the rooms page): a CSS column under a rendered drum would be two
  bases for one table.
- **The rooms page lays the same table over a photograph of the render** (`content/TablesArticle.astro`,
  `.roomTable` / `.roomGlow` in `content.css`, `src/dev/RoomStill.svelte`, `tools/rooms/shoot.mjs`,
  `roomsPage.test.ts`). A content page ships no script, so it cannot render the diorama; `make rooms`
  opens the `room-still-<id>` scene for each room — the room alone at its signature hour under a
  clear sky, 16:9, at `?gfx=force` so headless Chromium's software GPU renders the full tier — with
  the podium built under exactly the ellipse `.roomTable` draws (centred, 70% by 50%), and writes
  `src/assets/rooms/<id>.webp`, served through `<Image />` at three widths. The page then draws the
  board's own CSS table over it: same materials, same rim, same inlay, and no plinth, since the
  render carries the podium there as on the board. The hour is written twice — `SIGNATURE` on the
  page, the scene list in `scenes.ts` — and the test pins the two; a room with no still falls back
  to its sky and fails the test rather than the build. Re-shoot after touching a builder, the kit,
  the rig or the passes: nothing checks that the stills still match the render.

### Reviewing a room
Scenes `game-map-<id>` (one per room at its signature hour) plus `game-map-<id>-<variant>` (the
hour or the sky that changes the room the most) and `game-map-loading`. **These are the only place a
room is reviewable without a server dealing a match, and what `make visual` shoots is exactly what a
match draws**: the diorama is built in the browser from the three ids, so there is no art to drift
from and no rectangle to measure. Review a new builder at `--viewports=wide,mobile`: the tile
density is the same but the table covers a different shape of the frame on a phone, and a hero placed
just past the felt's edge on a monitor is under the hand on a phone. Check the podium's rim shows
under the table's lower edge on both, and that nothing in the front band rises into the felt. The harness runs the real engine in
headless Chromium (SwiftShader), so a render that takes a second on a laptop takes a few there.

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
- The face does **not** follow the interface's palette. A card is a physical object.
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
  **The hover is a mouse's and nobody else's**: `.hovered` is set on `pointerenter` gated on
  `pointerType === 'mouse'`. It was `mouseenter`, which a touch screen synthesises on the tap and
  never follows with a `mouseleave` until the finger lands somewhere else, so a card tapped and
  refused stayed lifted and straightened over the fan for the rest of the turn — the "it puts a card
  forward and it stays like that" of the bug report. A finger gets the press (`.slot:active`) and
  nothing else, and the platform's grey tap wash is off the card (`-webkit-tap-highlight-color`).
  `handTouch.test.ts`; same rule as the deck's `@media (hover: hover)` below.
  **The turn pill's reserve is that transform written out** (`layout.ts: turnPillPlace`, `TURN_PILL_H +
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

### The turn clock (`GameView`'s `.turnTimerBar`, `tokens.css`'s `loco-slide`)
The only place the remaining time is written down, read from across the room and from the seat
opposite alike, so it stays a full-width strip flush with the safe top edge — the chip row and
the round badge start 12px lower, so the two never meet. It used to be a 6px band of raw colour
with a `currentColor` glow, emptied by a `scaleX` that squashed its rounded end into a sliver as
it went, and coloured by three hex values typed into the keyframes. Now:
- **The track is a slot, the way a dead action-bar button is**: `--color-surface-sunken`, a hard
  shadow inside its top edge, a hairline under it, so the bar sits *in* something rather than
  floating on the room.
- **The bar is drawn back out of it** (`loco-slide`: `translateX(0)` → `translateX(-100%)` on
  the whole fill, the track clipping) rather than scaled flat (`loco-drain`, which survives for
  anything that wants it). Same one compositor-side transform, same `--drain-ms` /
  `--drain-delay` written by `drainBar`, and the rounded leading edge stays round: a bar being
  drawn back reads as an object, a rectangle being flattened reads as a bug in the renderer.
- **It is a raised object at a size where an outline would be half of it**: a gloss along the
  top and a shade along the bottom in place of the ink line, and a bright cap on the leading edge
  (`::after`, a white gradient) so the eye has a tip to follow and the heat reads on the tip too.
- **The heat is the palette's** (`loco-drain-heat`): indigo while there is time, amber past
  halfway, LOCO Red in the last quarter — orient, warn, act — as `background-color` on the fill,
  which is what lets the gloss and the cap stay on top of it. A colour written out by hand at a
  call site is the bug, and the keyframes were three of them.
- The catch capsule's fill takes `loco-slide` and the gloss for the same reason, and keeps its own
  paint: five seconds is not long enough to report a trend.
- Reviewed with `--motion` at 2, 9, 15 and 19 seconds of a 21-second turn on `game-my-turn`, and on
  `mobile`, where the strip runs under the notch and above the badges exactly as before.

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
  4.5:1 on the dimmed fill. Quiet is a hue.
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
- **The table is near-black.** It used to be green felt, which fought the deck: a
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
  - **The tilt and the sweep are two elements, and they have to be** (`.slashTilt` / `.slash`,
    `interruptHint.test.ts`). `skewY` moves a point vertically by its distance from the transform
    origin, so the band — skewed about its own left edge, a fifth of a screen off the left of the
    frame — arrived at the middle of the screen a hundred and forty pixels above where it was drawn:
    on a wide monitor the words came down on empty board with their band floating over them. The
    tilt now pivots about the centre, where the banner is; the sweep still starts at the left,
    because that is the gesture.
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
  somebody deliberately pinned, and a phone has no TAB key at all. The panel is up on the **press**,
  not after an arming delay, and the key moves no focus while it is down — the scoreboard key of
  every other game, and `client.md` has why it is not a keyboard trap.
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
  rules modal, a picker or the round summary owns the screen: inside a dialog TAB is the dialog's,
  and `dialogFocus.ts` cycles it there. **Shift+TAB is never taken anywhere**, which is what keeps
  every board control reachable from the keyboard.
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
  viewer saw most. The fill swap that replaced it fixed the contrast and left the state itself
  ambiguous: the dead fill was `--color-surface-strong`, which is what a **live** Pass wears, so the
  two were told apart by a label colour and a missing ledge and half the bar read as pressable for
  the whole of somebody else's turn. A dead button is the **inverse of a raised object**, not a
  quieter one, so all three of the things that raise one are inverted:
  `--color-surface-sunken` (a fill below the bar rather than on it, desaturated as well as darker —
  the live Pass keeps the lilac), the hard ledge replaced by a **hard shadow inside the top edge**
  (`inset 0 2px 0`, the same zero-blur vocabulary read as a hollow), and the outline dropped to
  `--color-hairline`. Not the ink, and not `--color-border-strong` either: on a sunken fill that
  border drew a ringed ghost pill, which is a pressable shape everywhere else a player has been.
  The label is `--color-disabled-ink` — 5.1:1 in light, 6.1:1 in dark, both measured in
  `actionBar.test.ts` off `tokens.css`, because Catch sits
  dead through the opening of every round and a spectator reads it at 720p. Still no opacity
  anywhere. **`.btnDrawSecondary` is surface-strong too**: it was `--color-surface-card` on a bar of
  `--color-surface-card`, a white pill on a white bar in light.
- **The round summary's delta** was `--color-mint` on `--color-surface-strong`, 1.81:1 in light —
  the one number the card is opened for. `--color-mint-text` is the mint as *text on a panel*, the
  same hue as text, the way `--color-link` is the indigo as text; on this canvas the brand mint
  itself is 6:1, so the two land on one value. The winner row's two literals (`#7a4a00`,
  `#1f6b3c`) are `--color-on-secondary-muted` and `--color-on-secondary-mint`, fixed like the
  yellow they sit on; the green moved one step past the literal, which was 4.25:1 on the
  flat yellow.
- **The two text-field focus rings** (`Lobby` `.input`, `WaitingRoom` `.maxInput`) were the indigo at
  0.35 alpha, 1.5:1 on the card — and with `outline: none` on the field that shadow was the whole
  indicator. Both are the solid `--color-tertiary` at 3px, the ring `tokens.css` gives every
  `:focus-visible`.
- **The map-loading roster** set a name still loading at 50% white over the room, with no shadow.
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
`.visual/<scene>__<viewport>.png` plus one contact sheet per viewport.

- **A room takes three query overrides on top of its scene**: `?showcase=game-map-marina&time=day`,
  and the same for `weather` and `map`. Dev-only, applied over the scene patch in `Showcase.svelte`,
  and there so that fixing a diorama does not need a registry entry per hour and sky — six rooms by
  five hours by five skies is not a contact sheet anybody reads. The registry still owns what
  `make visual` captures.
- **Add a scene in the same change set as any new screen or visual state.**
- `card-sheet` is the odd one out: not a screen but the whole deck, every kind in every suit, laid
  out to fit the capture viewport. Cards are the component the game draws forty of at once and no
  gameplay scene shows more than a handful of kinds — review any card change against it.
- Flags: `--scenes=a,b`, `--viewports=desktop,mobile,wide,small,notch`, `--gfx=high|medium|light|force` (the tier a room is rendered at; `force` is the full tier on the harness's software GPU, which is otherwise handed the plain frame — the way the finishing passes are reviewed),
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
  `--color-primary` locally — a link preview is one picture and must not depend on what the tokens
  say the day it is captured.
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
  - **That last ring grows wider than the gap it sits in, so it passes behind the two cards**
    (`.side` carries `position: relative` and `z-index: 1`; `z-index: -1` on the pseudo-element only
    puts it behind `.vs`'s own text, and `.vs` is the positioned sibling, so it painted over both
    cards). Drawn on top, the stroke crossed an avatar and two nicknames at the exact second the
    screen exists to say who they are — a burst read as a stray line laid across the reveal. Behind
    them it is a burst again, and the two cards never overlap the badge itself, so nothing else in
    the collision changes.
