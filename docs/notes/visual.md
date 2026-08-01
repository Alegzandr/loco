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
  `@fontsource-variable/*` and imported in `main.tsx`. No CDN — the CSP stays closed.
- Press feedback: `.btn-chunky` in `tokens.css` (hover lifts, active travels *into* the ledge).
  Components extend it rather than reinventing the six lines.
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
- **Theme is applied by `initTheme()` in `main.tsx`, before first render.** It used to be written
  only by `<ThemeToggle />`'s hook, so any screen without a toggle (game over, a reload straight
  into a match) silently rendered light.

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
theme/audio/rules cluster) and `BOTTOM_RESERVE` (action bar). Both must stay constant in *pixels*.
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
- **The centre column is Catch's home; LOCO only borrows it at `handSize === 1`.** Catch is the
  hardest button in the game to hit — it opens on someone else's mistake and lives for seconds — so
  it sits there *disabled but mounted* the whole match and is only ever **enabled in place**. It is
  never mounted/unmounted by the window: a button that appears is a button you have to find first.
  LOCO borrows the column on one card because declaring is ours to lose and outranks an opportunity.
- **`.armed` is the same cue on both**, applied to Catch when `canCatch` and to LOCO whenever it is
  shown: a punch-in (`armPop`, with a brightness flash) plus a pulsing halo (`armGlow`, tinted per
  button by `--arm-glow`). Deliberately identical — the two are the same wager seen from opposite
  sides of the table, so the player about to be caught must not get a louder cue than the player who
  could catch them. Under `prefers-reduced-motion` it degrades to a **static halo**, not to nothing:
  "this just became clickable" is information.
- **Catch is `position:absolute`, out of the grid** (`data-slot="float"`) for the rare overlap only —
  we are on one card *and* somebody else is catchable: right of the bar on desktop, above its right
  end on mobile, shifting nothing. `actionBar.test.tsx` asserts the slot, the enabled state and the
  arming of every button across states.
- The penalty draw and the ordinary draw share the left slot; `--slot-w` (126px) is sized for the
  widest label either can hold ("Piocher +4").
- **A declaration is a one-shot, and the button is spent with it.** `Room.DeclareLastCard` refuses a
  second call on the same single card (`player already declared`, the string `CatchUndeclared`
  already uses), and the flag only clears when `openCatchWindow` opens a fresh obligation on that
  seat — i.e. a Swap or a GlobalSwitch handing it a card nobody has heard called. Client-side,
  `store.myDeclared` (set by `applyUnoDeclared` on the *server's* confirmation, never on the click)
  disables the button in place: it stays in the centre column as a dead object rather than
  disappearing, because nothing in this bar may move mid-match. Without either half, LOCO! could be
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
- HTML viewport: `user-scalable=no`, `maximum-scale=1.0`, **`viewport-fit=cover`**.
- CSS `@media (max-width:480px)` for small screens.

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
- `useSafeAreaInsets` reads the numbers back through a hidden probe whose padding is the `--safe-*`
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
  `safeArea.test.tsx` owns the wiring through to the stage's transform.

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
Scene `game-wild-active-color`; `src/test/discardPile.test.tsx` covers the chip and both callout
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
- Art lives in `client/public/maps/<id>/{room,table}.webp` (~1.75 MB total). `make maps
  ARGS="--src=<folder>"` (`tools/maps/prepare.mjs`) crops and re-encodes it. **Which source file is
  the table is read off the alpha channel, never the filename**, since the renders come out of the
  generator named after their timestamp, and an earlier pass that guessed by frame brightness got
  every map backwards. The table is cropped to its alpha bounding box, which is what makes the
  `playfield` fractions honest.
- Scenes `game-map-neon` / `-rune` / `-velvet` / `-orbit` / `game-map-loading`. **The playfield
  numbers are measured by eye off the art, so a drifted table shows up in `make visual` and nowhere
  else**, so review any change to the art or to `tableImageRect()` there.

## Card face (`CardArt.tsx`, `cardArtSpace.ts`, `locoMark.ts`, `cardTheme.ts`)
Reproduced from the brand's own card art. Review any change to it with
`make visual ARGS="--scenes=card-sheet"` — the whole deck on one screen, which no gameplay scene
shows.

- **One SVG paints the whole face.** Background rect, watermark, wild fan and rule glyphs all live in
  the same `1000x1500` user space (`preserveAspectRatio="none"`), so they scale as one object at any
  card size — hand, discard, a flier mid-flight, a 12px mini fan. A CSS gradient for the face plus a
  separate SVG for the mark drift apart the moment the element's aspect ratio is not the reference's.
- **The card box and the mark box are two different boxes** (`cardArtSpace.ts`). The card box has the
  card's proportions; the mark is landscape. Reusing the mark's viewBox as the card's — which the
  previous portrait mark got away with — stretches the drawing to the card and turns the duck into a
  goose. It lives in its own module so `CardArt.tsx` exports components only (same reason as
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
- Because the mark is drawn inside a transform, its gradient axis is the **card's** axis mapped back
  through that transform (`MARK_AXIS`). Both gradients have to span the same line on the card or the
  reversal below stops being a reversal.
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
  `hasGlyph` (in `cardTheme.ts`, so `CardArt.tsx` exports components only) lists the kinds that get
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

## Card rendering layer (React + Framer Motion)
- `<GameBoard />` is the root; it tracks container size via `useElementSize` (ResizeObserver) and passes width/height to children that absolute-position in pixel coords.
- Layout helpers (`src/components/cards/layout.ts`): `clockwiseOpponents`, `opponentBubblePositions`, `calcHandSlots`, `discardPosition`, `deckPosition`, `seatPosition`, `handCardKeys` — all pure, reused by tests and animations.
- Animations live in `<AnimationLayer />`: an array of `Flier` items (flying card faces or backs) plus `EffectText` floats. Each entry self-cleans via `onAnimationComplete` → parent `removeFlier`/`removeEffect`.
- Animation triggers (inside `<GameBoard />`), in effect-declaration order:
  - **Opponent play**: keyed on `lastPlay.at`; flies the card from `seatPosition(actor)` to the discard with `arcHeight`. Skipped when the actor is the local player. Sets `suppressNextDiscardFx`.
  - **Card play (own)**: `flyCardFromHand(card, idx)` computes the source slot from `calcHandSlots` and spawns the arced hand→discard flier. Sets `suppressNextDiscardFx`. **It only runs once the play is committed** — `props.onCardClick` returns a boolean ("did the card leave the hand?") and the flier is spawned only on `true`. A tap the client refuses (`clientMayPlay`/`clientMayInterrupt` say no) animates nothing: flying the card out and snapping it back reads as a bug, not as "illegal card". Plays confirmed later (wild colour, swap target) fire it through `flightRef` — a `GameBoardHandle` the `<ColorPicker />`/`<PlayerPicker />` callbacks in `GameView` call after `onSend`.
  - `GameView.handleCardClick` also refuses to open a picker for a card `clientMayPlay` rejects — prompting for a colour and then having the server reject the card is the same broken promise as the animation. **The check runs before the prompts, not after**, and that order is the whole rule: the three wilds always match, so gating them changes nothing, but **Swap is a coloured card** and follows ordinary matching. Behind the prompts, an off-colour Swap was the one card in the deck that asked for a target, took the answer, and *then* came back refused with "illegal card play" — every other unplayable card ignores the tap in silence, so it read as the card behaving differently rather than as an illegal play. `realtime.test.tsx` covers both branches (refused Swap opens nothing, playable Swap still prompts).
  - **Discard top change (any source)**: `suppressNextDiscardFx` suppresses **only the generic pile flier**, never the SKIP/REVERSE/+N callout — playing your own Skip must announce itself too. Callout text from `effectFor(card, pendingDraw)`.
  - **Hand grew by 1**: deck→last-slot card-back flier (draws).
  - **Swap / GlobalSwitch**: trails spawned on `swapNotice.at` change.
- Hover lift: CSS-only (`Hand.module.css`) — `.slot.hovered .card { transform: scale(1.08) translateY(-14px) }`.

### Motion conventions (non-negotiable)
- **Animate transforms, never `left`/`top`.** Every moving node (`.flier`, `Hand .slot`, `PlayerSlot .slot`) is pinned at `left:0;top:0` in CSS and positioned by framer-motion `x`/`y`. Animating `left`/`top` runs layout every frame and visibly stutters once several cards move at once.
- **A node's transform has exactly one owner.** If framer-motion animates a node's transform, its CSS must not set `transform` (and vice-versa). Where a static offset is also needed — centering the effect text, centering the turn indicator — use an outer anchor div for the CSS transform and an inner motion node for the animation (`.effectAnchor`, `TurnIndicator .anchor`). The hover lift lives on the inner `.card` for the same reason.
- **Layout math is radians; framer-motion `rotate` is degrees.** Convert at the render boundary with `radToDeg` (`cardTheme.ts`). Passing radians straight to `rotate` silently flattens every rotation.
- Shared motion constants in `cardTheme.ts`: `EASE_OUT_CARD` (card flights), `SPRING_HAND` (fan reflow), `DEAL_STAGGER_MS`.
- **Hand keys come from `handCardKeys(hand)`**, not the array index — occurrence-numbered card identity. Index keys make React reuse the wrong node when a card leaves the middle of the fan, so the survivors snap instead of sliding into the gap.
- `Hand` staggers cards in only when the hand grows **from empty** (a deal). Any other growth is a draw, which already has its own deck→hand flier.
- `DiscardPile`: 2 static neutral under-layers for pile thickness (deliberately untinted — the active-colour ring owns the colour there) + top card keyed on `cardKey(card)` so each new top card remounts and replays a spring settle at a deterministic `hashTilt`.
- `store.lastPlay { actorIndex, card, at }` is set by `applyCardPlayed` and exists **only** for animation. Never read it for rules decisions.

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
- **Rarity is read in the flight and the impact, never on the face.** `Card.module.css` carries no
  per-rarity treatment at all: its only classes are `.card`, `.card.playable`, `.card.shadow`,
  `.interactive` and the corner variants. A shine or foil run across the face desaturates the suit
  colour, and suit colour is what has to survive stream compression, so `.card.playable` stays the
  one visual override a card in hand gets: "you can play this" is information and outranks flavour.
  - This paragraph used to describe a foil system (`.foil`, `.glint`, `holoOffsetMs`,
    `.card.playable.legendary`) of which **nothing exists in the code**. Checked 2026-08-01: none of
    those four identifiers appears anywhere under `client/src/`. It is exactly the failure mode the
    "Testing" section names, an invariant asserted with no test behind it.

### Reduced motion
- `<MotionConfig reducedMotion="user">` in `main.tsx` covers framer-motion; a `@media (prefers-reduced-motion: reduce)` block at the end of `styles/tokens.css` neutralises CSS transitions/animations globally.
- When adding motion, verify it degrades to a readable static state rather than disappearing.

## Player bubble (`<PlayerSlot />`)
- Chunky sticker pill positioned by `seatLayout(...)` (see "Seat layout"), clockwise from the local
  seat. Size is `full` / `compact` / `mini` — the component mirrors `SEAT_DIMS`, it does not choose.
- Active turn: gold gradient fill + glow ring + bobbing arrow above the pill, dark label. It is the
  brightest object on screen on purpose — a viewer must never hunt for whose turn it is.
- Card-count badge on the pill's right edge; it turns red and pulses at exactly 1 card.
- Disconnected: muted fill, faded, `"nickname ✗"`.
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
    from the server. Scene `game-catch-caught`; `src/test/catchBanner.test.tsx`.
- **UNO banner**: tilted sticker, punch-in, positioned *above* the pile so the play that triggered
  it stays visible.
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
- **Confetti** on the victory screen only. Losing screens do not celebrate.
- **Per-seat identity colours** (`components/playerColors.ts`): a player keeps one colour across
  lobby avatar, banner and scoreboard so a viewer can follow "the orange player" all match.
- Opponent pills show the **exact** card count (the fan only conveys few-vs-many, and caps out).

## Score table (hold TAB)
`<ScoreTable />` is the in-match standings panel: seat colour + nickname, one column per finished
round, cumulative total, rounds won, ping. Pure merge/sort and the ping banding live in
`scoreTableModel.ts` (`buildScoreRows`, `pingTier`), unit-tested; the component only renders.

- **Opened by holding TAB** (`useHeldKey('Tab', enabled)`) **or pinned by the scores button** in the
  top-right cluster. Held and pinned are separate states: releasing TAB must not close a table
  somebody deliberately pinned, and a phone has no TAB key at all.
- **That button exists on touch layouts only** — `.scoresBtn` is `display:none` until
  `(max-width: 480px), (pointer: coarse)`. It is the fallback for the missing key, so on a machine
  that has the key it is a permanent control for something already one keypress away, spending room
  in a cluster of four. The coarse-pointer half of the query is what covers a tablet, which has no
  TAB either and is wider than 480px.
- **It is an icon** (a table glyph, drawn inline in `GameView` like every other rule glyph in this
  UI, never a font character), 40×40 like `<ThemeToggle />` beside it: at phone width the cluster
  has no room for a word, and the three buttons next to it are already square. `t.scoreTableBtn`
  survives as its `aria-label` + `title`, so the accessible name is unchanged and the E2E locator
  still finds it. `aria-pressed` tints it with `--color-primary` when pinned — the panel can be
  dismissed by tapping its backdrop, and nothing else would say the state changed.
- E2E: the desktop project therefore opens the table by **holding TAB** (`holdScores` in
  `score-table.spec.ts`); one test resizes to 390×844 to exercise the button and asserts it hidden
  before the resize.
- `useHeldKey` resets on `blur`. Alt-tabbing away swallows the keyup, and the overlay would stay
  stuck over the board with no way out. It `preventDefault`s TAB, so `enabled` is false while the
  rules modal, a picker or the round summary owns the screen: inside a dialog TAB is the dialog's.
- `.topRight` sits at **z-index 46, above the panel's 45**. The button that pins the table open is
  the button that closes it; a panel that swallows its own toggle is a trap on touch. Pickers (100)
  and the rules modal (1000) still cover the cluster.
- **Ping bands** (`pingTier`): <60 good, <120 ok, <220 poor, beyond that bad. Tighter than a
  turn-based game would need, because an interrupt is decided by arrival order at the server.
  `rtt_ms < 0` renders as "not measured", never as a flattering 0 ms; bots are labelled `BOT`.
- Rows are ordered by score, then rounds won, then seat, i.e. the match tiebreakers, so the panel can never
  contradict the final standings.
- Under 480px the **rounds-won column is dropped** and under 400px the "you" badge goes too. The
  ping must not be the thing pushed off the right edge of a phone: it is the one column that cannot
  be derived from anything else on screen (the gold row already says which seat is yours).
- Scenes `game-scores` and `game-scores-round-one` cover both states in the showcase.

## Round summary
- `round_end` → `applyRoundEnd(roundWinner, roundNumber, newScoreboard, roundHistory?)`.
- Computes per-player `round_points` as `newScore - prevScore` from pre-round scoreboard, stores `roundScores: RoundScoreEntry[]`, sets `showRoundSummary:true`.
- If `game_started` arrives while showing → buffer in `pendingGameState`.
- `GameView` shows: round n/total, winner, per-player breakdown sorted by placement, points (delta), cumulative score, wins, full match scoreboard (BO3+).
- "Continue (Ns)" → `dismissRoundSummary()` (applies buffered state, clears summary). Auto-dismiss at 8s.

## Visual showcase & screenshot harness
`client/src/dev/scenes.ts` registers every screen/state as pure data; `?showcase` renders the index,
`?showcase=<id>` renders one scene full-screen with no server, no WebSocket and no second player.
Gated behind `import.meta.env.DEV` (dynamic import in `main.tsx`), so Rollup drops the chunk in prod.

`tools/visual/shoot.mjs` (`make visual`) boots Vite, walks the registry and writes
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
  offsets and `useSafeAreaInsets` both read. No desktop browser reports an inset on its own, so this
  is the only way to see the layout that has to dodge them (see "Safe areas").
- Viewport size goes under `viewport: {...}` in the Playwright context options — width/height at the
  top level are silently ignored and you get the 1280×720 default.
- Captures run with `reducedMotion: 'reduce'` by default so they are deterministic; `--motion` is how
  you check confetti, springs and callouts.

## Link preview (Discord / X)
The game is shared as a link, so the OG card is a product surface. `make og` (`tools/og/shoot.mjs`)
renders the `og-card` scene at 1200×630 into `client/public/og.png`.

- **Built from the real `<LocoLogo />` and the real `<Card />`** (`client/src/dev/OgCard.tsx`), not a
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
  in the served HTML, since neither Discord nor X runs JS. `index.html` carries a `%OG_ORIGIN%` token
  substituted at build time by the `loco-og-origin` plugin in `vite.config.ts` (default = prod
  origin, override with `VITE_PUBLIC_ORIGIN`).
- Both platforms **cache the image by URL** for days: bump the `?v=` on `og:image`/`twitter:image`
  after regenerating. `twitter:card` must stay `summary_large_image` or X shows a 120px thumbnail.
- No preview on the `-d.` host by design — nginx serves `robots.txt: Disallow: /` there and
  Twitterbot honours it.
- `client/src/test/ogCard.test.ts` is the only thing watching this: nothing else in the app renders
  those tags or that image, so a deleted PNG or a drifted dimension would fail silently in
  production.

