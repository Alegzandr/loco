# Implemented Features

The grouped list of what ships. `README.md` describes the stack and how to run it, `CLAUDE.md` the
rules, `docs/notes/` the reasoning.

## Lobby & rooms
- Auto-generated 6-character human-friendly room codes (collision-free registry; charset excludes `0/O/1/I/l`).
- Join by room code; nickname-only entry (no accounts).
- **Nickname validation, server-authoritative** (`server/game/nickname.go`): up to 20 *characters*, Latin/Greek/Cyrillic letters, digits, single spaces and `-_.'` — an allowlist, so zero-width characters, right-to-left overrides, emoji and stacked combining marks never reach a seat label. Insults and hate terms are filtered on a normalised form (case, diacritics, leetspeak, separators, repeated letters) against the embedded [LDNOOBW lists](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words) in 19 languages — no service, no key, no request — and short terms match whole words only, so Constance, Dominique, Cassandra and Scunthorpe still get to play. **Every refusal is the same single line**, in both languages, whichever rule fired. The client checks the shape as you type (`client/src/components/nicknameRules.ts`) and ships none of the word list.
- Join by link: the code in the waiting room is a button that copies `<origin>/i/?t=CODE`, with no language on it (the arriving player's browser decides that). Opening it fills the join form with the code and asks only for a name, or seats the player outright when the browser already remembers one. The code is removed from the address bar on arrival, so a reload reclaims the seat rather than re-joining and a copied URL never keeps naming a closed table. That URL is a page of its own, so a link pasted into a chat window unfurls as an invitation — its own title and its own art — rather than as the home page. The code is only read there: the same parameter on any other page means nothing.
- Real-time lobby with live player list updates.
- Host-only game start.
- Leaving a table before the deal: host and guest alike get a quit button in the waiting room, behind an in-place confirmation (Stay / Yes, leave; Escape stays). Confirmed, the seat is released immediately (`leave_room`) and the rest of the table sees the roster update. Once the cards are out there is still a way out, at every table: a chip in the board's chrome row (never on the action bar) behind the same in-place question, and under that question one line saying what leaving costs the others — the bot minds nothing, a 1v1 opponent takes the match, a table of four keeps playing, a table of two stops. Where two seats able to play are left after the departure, the round carries on: the seat is out for good — the hand goes back into the deck, the turn steps over it, it is dealt nothing after that — and the scoreboard is left exactly as it stood, because leaving is a departure and not a forfeit. Where they are not, the match ends there and goes to whoever stayed, announced as a forfeit, rather than leaving them in front of a board that will never move again. A solo game against the bot simply closes. Everybody still holding cards is told who left, by name, on the board. A table where every other seat is a player whose reconnect window has run out says so as well, and closes when it is left, rather than dealing itself out to nobody for another five minutes.
- The host's controls over a roster row, before the deal: one ⋯ button on every row but their own — right-click on the row opens the same menu — offering *hand the table over* and *remove from the table*, each behind a question that takes the menu's place. Below 46rem the menu is a bottom sheet instead of a dropdown. Removing a seat (`kick_player`) includes bots, since nothing else takes a bot's seat back; the table sees an ordinary departure and the removed player is told why. It is not a ban — the code is still theirs and they may rejoin. Handing the table over (`transfer_host`) swaps the two seats, so the controls move with them in both directions and the new host can deal; a bot is never offered it, because a table it owns could never start. Both are refused once the cards are out, and in a matchmade room, which has no host.
- Match format selection (BO1/BO3/BO5/BO7), broadcast live in lobby.
- Max-players configuration (2–10), live in lobby; cannot drop below current count.
- **1v1 matchmaking**: a single FIFO queue on the home screen. Two searchers are paired, shown a versus reveal naming their opponent, and dealt in 2.5 s later (a single round) with nobody pressing start. No host, no code, no lobby. The queue's size is never sent to a client in any form; the searching screen times its own wait and restates it at 15 s and 45 s, offering a private table past that. At the end either player may ask for a rematch: both asks are broadcast, and the same two are dealt in again only once both are in. If the opponent leaves instead, there is nobody to agree with, so the player who stayed goes back into the queue by default and cancelling the search is how they leave. No rank, and nothing calls the mode "unranked".
- **Forfeit instead of an empty seat** (matchmade matches only): a dropped opponent is held 15 s rather than 60, with the countdown on the board, and two consecutive turn timeouts end the match instead of four. Either way the match goes to whoever stayed, announced as a forfeit with the scoreboard untouched. Quitting on purpose (`leave_room`) does it immediately. Ordinary rooms keep the 60 s hold and the 4-timeout threshold.
- Bot players: host adds AI bots; bots play autonomously with card-preference heuristics, counter a draw stack, declare LOCO!, call Contre-LOCO! and interject identical cards into an open window like any other player. Every reaction is delayed and probabilistic so they stay beatable.

## Gameplay
- 112-card deck (numbers 1–9, Skip, Reverse, +2, Swap, Wild, +4, Global Switch).
- 8-card initial deal; opening discard always a number.
- Legal-move validation (color/number/kind matching).
- Skip, Reverse (Skip-equivalent in 2-player), +2.
- Wild, Wild Draw Four and Global Switch with color choice (every wild names the new active colour).
- +2 / +4 stacking (counter chain, same card only — same kind and same colour) and out-of-turn +2 free interrupt.
- A forced draw costs cards, not the turn: the victim takes the whole stack and then plays or passes.
- Identical-card interrupt (single + batch). The window has **no deadline**: it opens when a card is played and closes only when somebody draws, passes, or the round ends. Anyone may take it, including the player who just played and the player whose turn it is — it is a race decided by arrival order at the server.
- Batch identical-card play on your turn (effects compound).
- Swap (colored, opponent hand swap) and Global Switch (wild: names a colour, then rotates all hands in current direction).
- UNO declaration + 5 s server-enforced catch window. **A hand-emptying play is refused without the call**, so nobody forgets LOCO! and takes the round anyway; a batch that empties the hand in one go carries the call in the play itself, since it never passes through a single card.
- **Contre-LOCO! is pressable from three cards out, not from the moment the server says so.** The button holds the centre of the action bar all match and goes live as soon as any opponent is down to 3 cards or fewer, so the call is a read of the table rather than an answer to a cue. It goes quiet again once every one of them sitting on a single card has called it: there is nobody left to catch, and the game does not offer a wager that can only lose. A press that finds nobody on the hook costs 1 card — **once per card played**, however many times it is pressed, so a misread is a mistake and spamming it is not a second one. LOCO! is a small chip above the bar, on screen from the deal and lit only for the seconds you owe it.
- Single-finisher round scoring (number = face; Reverse = 10; Skip = 20; +2 and Swap = 30; Wild and Global Switch = 40; +4 = 50).
- Multi-round matches with persistent scoreboard. **The match is taken by rounds won**, and it ends the moment the lead cannot be caught: 2–0 in a BO3, 3–1 in a BO5, 4–3 in a BO7. Points are still accumulated and shown, as the measure of the gap rather than the thing being raced to.
- Tiebreakers: most rounds won → highest score → lowest lost-hand total → sudden-death extra round.
- **Three fixed things to say, on the game-over screen, at every table**: GG, that was close, nicely
  played. A closed set decided by the server and sent as an identifier, so no client can invent a
  fourth, and **no free text anywhere in the game** — that would be a moderation surface, and
  collecting nothing is the compliance strategy rather than an accident. Nothing said is stored,
  logged or carried across a deploy: it is shown for a few seconds and forgotten. One per seat every
  two seconds, refused to its sender alone, never to or from a bot.
- **Evening recap on the game-over screen**: one column per match this table has finished, with each seat's rounds won and points, and its total of matches taken. A rematch wipes the scoreboard, so without it a group playing six matches on one code ends up with nobody able to say who won the night. Hidden until the table has rematched, since one column would be the standings above it said twice.
- Win detection (empty hand) and deck replenishment from the discard pile.
- **The rules page opens on what is different**: eight lines for a visitor who already knows a card
  game of colours and symbols, above the rules themselves. The hand size, the deck size and the
  number range in it are read from the server rather than written down. It is deliberately absent
  from the in-game rules modal, which is a reference rather than an argument.
- **The in-game "How to play" has a Cards half**: the rulebook on one tab, the deck drawn on the
  other — every kind with its real face, its name and one line. A first-time player can read that a
  Swap takes somebody's whole hand and still not recognise one in their hand a minute later, and
  Swap and Global Switch are exactly the two cards a player arriving from an ordinary colours-and-
  symbols card game has no picture of. Eight lines, not a catalogue: copies, points and the long form
  stay on the cards page, and the modal still links nowhere.
- Rematch: once a match is over, the table reopens the same room (same code, same roster, cleared scores) instead of everyone rebuilding a room from scratch. It takes two asks, not the host's word: one player offers, another accepts, and the room reopens for the whole table — the players who had not answered land in the waiting room with everybody else rather than out of the game. Each ask is public so nobody presses into silence, a player leaving stops being waited on, and bots are not asked. Seats with nobody behind them are pruned first, and the reopened table is hosted by somebody who asked for it: a host who said nothing, or who left, hands the badge to the longest-standing player who did.

- **The waiting room tells the host what they are picking**: an estimated length on every format
  button (a *range*, because a match ends the moment the lead cannot be caught) and a line under the
  seat count saying it breathes best between 2 and 6. Both used to exist only in the FAQ, which is to
  say nowhere near the decision.
- **The code plate carries a chain**, because pressing it copies a link rather than the six
  characters, and the toast only said so after the press. It is drawn, and it is not blurred by
  streamer mode: what has to stay off a stream is the code.
- **Streamer mode hides the table code, and the host's hides it for the whole table.** The code is one
  string shared by everybody who can see it, so a host with it on camera is exposed by their guests'
  screens as much as by their own: the switch travels to the server and every seat blurs, including
  people who join an hour later and tabs that reload mid-match. A player's own switch stays their
  own — the two are ORed, so nobody's code is uncovered by somebody else's stream ending. Nothing
  uncovers a blurred code, at all: not hover, not focus, not a tap. Sharing a table with it on is the
  link the code plate copies, which travels through chat rather than through the capture.
- **Play the bot**: a 1v1 against the server from the home screen — a nickname, one press, a dealt
  hand. No table code, no waiting room, no host controls, one round. It is the queue's offer with the
  wait taken out, so it is the fourth button of the home menu, drawn like the other three and sitting
  directly under the queue's — a line of underlined text between two ledged buttons read as a
  footnote, and the mode that needs nobody else organised is not a footnote. The game-over screen offers
  another press or the queue; there is no rematch to negotiate.
- **A sign of life on the home screen**: a small plate opposite the chip row saying how many players
  are connected to this server, sent by the server on arrival and then only when the number moves.
  It is not the queue and does not say it is — the queue's size is still nowhere on the wire — and it
  is drawn from two players up and simply absent below that, never rounded, padded or reworded. A
  count of one is the number that closes the tab, and the plate that would carry it is the one that
  should not be there. It is drawn on the home screen only: a table in progress is neither sent it
  nor has any use for it.
- **The way out of the queue arrives inside twenty seconds**: the searching screen's three stages are
  0-10 s, 10-20 s and 20 s+, and the last of them is where a private table is offered. At 45 s it was
  a tab that had been closed at ten.

## UI / UX
- Svelte 5 game view, animated by the browser rather than by a runtime. All card movement is expressed as GPU-composited `translate`/`rotate` transforms — never `left`/`top` — so multiple cards can fly at once without triggering layout.
- Motion detail: cards fly from the acting player's own seat to the discard pile (so opponents' plays are legible without watching the pile), the hand fan springs closed behind a played card, a fresh deal staggers in, the discard settles with a per-card tilt, and turn-indicator text crossfades.
- `prefers-reduced-motion` is honoured throughout: transforms snap to their end state and CSS transitions are disabled, leaving the game fully playable without movement.
- Round summary overlay with placements, points earned, cumulative scoreboard; auto-dismiss after 8 s or via Continue. Next-round state is buffered so the overlay never vanishes instantly.
- Match-end screen with final scoreboard, winner highlight, the rematch ask every seat gets (see above — it is not the host's call), and Leave room.
- Score table on held `TAB` (and on a **Scores** button, the only way in on a touch device): one row per seat with its identity colour, one column per finished round, rounds won (the column the match is settled on, and the one that survives on a phone), the cumulative total, and a live ping. The ping is banded by colour (green under 60 ms, yellow under 120, orange under 220, red beyond) because an interrupt is decided by arrival order at the server. Bots are labelled rather than given a fake number, and a seat with no measurement yet says so.
- Play direction ring: chevrons around the felt, chasing the way play is moving and flipping over when a Reverse lands. The heading is carried by the chevrons themselves, so it still reads on a paused clip or with reduced motion, long after the REVERSE callout is gone.
- UNO reaction timer: countdown bar visible whenever a player declares UNO.
- Reconnect visual recovery: brief "Rebuilding table…" overlay, then staggered entrance of bubbles, hand cards, and discard pile.
- Mobile support: responsive layout, 44 px+ tap targets, 400 ms double-tap guard, touch-friendly wild color picker. Zooming is never forbidden: the double-tap is answered by `touch-action: manipulation` on `body`, not by `user-scalable=no`.
- Rules modal accessible from Lobby, Waiting Room, and Game View; bottom-sheet on mobile.
- Internationalisation: English + French, manual switcher persisted to `localStorage`. **A device set to French opens `/` in French** — the whole document, footer and links included, without a reload: the served markup carries both languages and the address bar moves to `/fr/`, which is a real page a reload would fetch. The browser only decides at `/`; `/fr/` is somebody having asked, so a French link stays French whoever opens it, and a detection is never written down. Switching language applies on the pick, on every screen. Refused actions included: server prose is translated into player-facing copy rather than shown as it came off the wire.
- **Preferences behind one gear**, in the top bar of every screen including the board: language, theme, and three switches. **Streamer mode** blurs the table code everywhere it is drawn (the value itself is untouched, so the press still copies a working link and hover/focus clears the blur). **Colour shapes** give each suit a silhouette on the card, on every picker and on the active-colour chip, so hue is never the only thing telling two cards apart. **Reduced motion** stops the card flights and the confetti; it follows the system setting until it is set here, then wins over it in both directions. All three live in `localStorage` and none is ever sent to the server.
- On a phone with a notch the page runs edge to edge (`viewport-fit=cover`) so the room's picture reaches every edge, while the board, the action bar and the top cluster keep clear of the notch and the home indicator.
- Privacy, terms and credits as one content page (`/privacy/`, `/fr/confidentialite/`), linked from every footer (last in the home page's row of links, at the right-hand end of the content pages' bar), in both languages. Three anchored sections; the copy is read at build time and ships in no bundle.

## Look & sound

- **Art direction**: chunky cartoon system — 3 px ink outlines, solid press-down shadows, a dark table with a real rim. Seats resize and wrap so a nine-player table stays readable on a phone. Tokens live in `client/src/styles/tokens.css`; the written system is `DESIGN.md`.
- **The deck has its own identity**: each face is a full-bleed suit gradient with the LOCO mark — a geometric wireframe duck, straight from the brand's source file — behind it in the *same gradient reversed*, drawn as one SVG. On a card the mark is cropped and tilted so the artwork runs off all four edges; the logo, the favicon and the table watermark show it whole. Card faces do not follow the light/dark theme: a card is an object, not a control. Every glyph is ink-outlined, which is what makes off-white legible on the green and yellow suits at all.
- **Card feel**: cards are tiered by scarcity for presentation only — a number lands clean and quick, a coloured action spins once flat, a wild spins twice, arriving bigger, ringed by a shockwave and kicking the board. Special cards carry a trading-card foil masked to the frame, desynchronised per card. The discard pile reveals its new top **on impact**, so the throw is the reveal.
- **Maps**: every match is dealt into one of four rooms — **Neon** (a rooftop club above the skyline), **Rune** (the back room of an arcane tavern), **Velvet** (an art-deco lounge) and **Orbit** (a starship hangar). A map is a backdrop, a table and an accent colour; it changes no rule and no card. The **server** draws it once per match and tells every seat, so a clip cut between two players does not jump between two rooms, and a rematch draws a new one. The accent tints the light the table casts and the direction ring, never the brand red, the active seat's gold or a card face.
- **Synchronised loading**: between "hands dealt" and "clock running" the table stays shut while every client downloads and decodes the map, on a screen naming the room and showing who is still loading. A map is around 600 kB and the game is decided by arrival order, so starting the first turn against a grey rectangle would be a head start. Gameplay messages are refused server-side until then, and a 20 s deadline stops one backgrounded tab holding the room hostage.
- **Streamable moments**: interception slam (banner + screen shake + sting), Contre-LOCO! verdict stamp with the penalty cards flying to the caught seat, LOCO! punch-in banner, floating SKIP/REVERSE/+N callouts, per-seat identity colours, exact card counts on every opponent.
- **Audio**: runtime-synthesised effects for every action and rule outcome, plus **three adaptive soundtracks** — *Neon Horizon* (uplifting trance, 138 BPM), *Pixel Rush* (electro house, 128) and *Voltage* (dark electro, 145) — each written as parts (intro, verse, chorus, bridge, break) rather than a loop, played as a **shuffled playlist** with a single ⏭ control. The song form advances by itself and the table's tension picks how thickly it is played *and* which part comes next: a breakdown between rounds, a build-up in the lobby, the full drop when someone is one card from winning. Risers and crashes announce a chorus, fills close every part, the bed ducks under the win/lose fanfares. Per-bus mixer (overall / effects / music) with mute, persisted. Nothing plays before the first user gesture, and **no audio file ships**.

## Findable pages

- **Twelve indexable pages** built by Astro as static files: the game, the rules, the cards, the tables, playing with friends and the FAQ, each in English at `/` and French under `/fr/`. All are readable with JavaScript disabled.
- The content pages restate what the game already knows and are pinned to it: the rules page maps the app's own strings and the deck table is checked against `server/game/deck.go`.
- Link previews (`og.png`, 1200×630) are rendered from the real logo and the real card art, and committed — CI has no browser.

## Server / infra
- Per-player personalized state (hidden hand info never leaks to other clients).
- 60-second reconnect window during active games (15 s in a matchmade 1v1, where it expires into a forfeit). The same window holds a seat on the game-over screen of an ordinary table, so a socket that drops between the last card and the rematch button reclaims its seat instead of losing it.
- Client auto-reconnect with a backoff that never runs out, plus an immediate retry when the network comes back, when the tab comes back, and from a button on the reconnect overlay.
- **One tab at a time.** A second tab of the same browser says where the game is instead of opening a second connection, and carries one button that brings it over — which the copy warns about first when the other tab is mid-match, since the seat does not travel with it. The game comes back on its own when the tab holding it is closed. A tab that crashes releases the game after a few seconds rather than holding it, and anything the mechanism cannot read (no storage, no channel) simply lets the tab play.
- JSON `GET /health` endpoint (room count, client count, uptime). Operator-only: nginx does not proxy it, and the container healthcheck reads it from inside.
- `GET /metrics` endpoint: atomic counters for `rooms_active`, `players_connected`, `matches_started`, `matches_finished`, `bots_active`, `uptime_sec`, `goroutine_count`, `messages_rate_limited`, `messages_dropped_busy`, `slow_clients_closed`, `channel_retries`, `suspected_cheats`, `reconnect_expirations`, `matchmaking_queue`, `matches_matchmade`, `debug_mode_active`, `handler_panics`, `conns_refused`, `joins_throttled`, `log_lines_dropped`, and saturation (`loop_queue_depth` and `loop_queue_capacity` for the hub's routing queue, `loop_queue_peak` for the deepest any one table's box has been, `loop_slowest_us` for the longest a single message has taken anywhere, `loop_events`). The two matchmaking counters are the only place the queue's size is readable at all.
- Empty-room cleanup: rooms held 5 min after empty, then deleted; rejoin cancels the timer.
- **One goroutine per table.** The hub owns what is between tables (the map of them, the matchmaking queue, the sockets, the drain) and routes each message to the table it is for; that table's own goroutine handles it. Bought for isolation rather than throughput: one table's slow message is no longer every other table's wait, in a game whose reaction windows are decided by arrival order.
- Structured server logging (room/match/connection lifecycle, queue-pressure warnings, suspected cheat), written **off the event loop** through a bounded asynchronous sink: a slow log consumer can no longer stall the server, and anything the sink has to drop is counted on `/metrics` and admitted in the log.
- Session tokens (128-bit, `crypto/rand`) required for reconnect, preventing slot hijacking.
- Per-client rate limiting (token bucket, 10 msg/s sustained, burst 20).
- Per-seat latency measured server-side from WebSocket ping/pong frames (5 s probe, smoothed), broadcast every 3 s to rooms in play. Browsers answer ping frames in the transport layer, so the number is a real network round trip and no client can report its own.
- Per-round score history kept on the room and exported in every snapshot, so the score table is identical for a reconnecting player.
- AFK auto-kick after consecutive turn-timeouts (~2 rounds in a 2-player game; bots exempt). A matchmade 1v1 halves the threshold and forfeits the match rather than closing the socket, so the opponent is not made to sit through a second wait.
- Game event log (`EventLog`, append-only) delivered to reconnecting players for history.
- `Origin` checking on the WebSocket upgrade (same hostname by default, port-insensitive; `LOCO_ALLOWED_ORIGINS` narrows it to an exact allowlist), a closed Content-Security-Policy and the usual security headers, sent by nginx on every response.
- Connection and table ceilings refused before the upgrade (`MaxClients`, `MaxConnsPerNet`) and at `create_room` (`MaxRooms`), plus a per-network budget of 20 wrong table codes a minute — a code read out on stream is not a strong secret, and what this stops is a script sweeping for open tables.
- **A deploy does not end the matches on the server.** `SIGTERM` drains: nothing that would start a new match is accepted, the matchmaking queue is emptied with an explanation, every table is told once — including the waiting rooms, the game-over screens and a versus reveal, which are the three that would otherwise learn about the deploy by having their one button refused — and everything already running is left completely alone — same turn clock, same reaction windows, same bots. Whatever the drain does not finish is written to `LOCO_SNAPSHOT_PATH` and read back by the next process before its listener is up, so clients reconnect into their match with the token they already hold and a deploy reads as the one-second reconnect overlay a dropped wifi frame produces. Only matches in flight travel; a snapshot is never replayed, and one from another build or older than two minutes is discarded whole.
- Docker + docker-compose for both production-style and bind-mounted dev workflows.
