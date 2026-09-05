# Audio

Every sound effect is synthesised at runtime. The music is nineteen CC0 loops, served from this origin.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Audio
**Every sound effect is synthesised at runtime** — nothing to download, nothing to licence, no
cache-miss silence on the first play of a cue that has to answer a tap in the same frame.

**The music is not, any more.** It is nineteen loops by Abstraction, released CC0, normalised and encoded
to MP3 under `client/public/music/`. What that bought and what it cost is the section below; the
short version is that a sound effect is a reaction and a bed is not, so only one of the two can
afford a fetch.

- `audio/engine.ts` — lazy `AudioContext` (browsers refuse one outside a user gesture; every play
  before `unlock()` is a silent no-op), master → sfx/music buses, settings persisted under
  `loco_audio`, per-frame voice budget so a batch play can't stack a dozen voices.
- **Mobile Safari loses the context in three ways, and all three fail as silence rather than as an
  error**, which is why nothing in the suite went red on them for months.
  `src/test/audioLifecycle.test.ts` owns all three.
  - **`unlock()` resumes anything that is not `running`, never just `suspended`.** WebKit parks the
    context in its own non-standard **`interrupted`** state when the page is backgrounded, when a
    call lands, or when Siri speaks. Guarded on `=== 'suspended'` the resume never fired, so
    `isReady()` stayed false forever: `playSfx` became a no-op and `MusicBed.schedule` returned on
    every tick against a frozen clock while its `setInterval` kept running, so `music.isPlaying()`
    was `true` and the gesture handler never restarted the bed either. Switching apps and coming
    back cost the player the sound for the rest of the page's life.
  - **`unlock()` is `async` and resolves once the context is really running.** `resume()` is a
    promise, so starting the bed on the next line found `isReady()` still false and silently did
    nothing; the sound only arrived on the player's *second* tap. `gameAudio()` starts the music
    inside the `.then()`.
  - **`visibilitychange` + `focus` reclaim the context** (`gameAudio()`, skipped while hidden).
    Coming back from another app is exactly when the context needs reclaiming and exactly when
    there is no gesture to hang it on: the player looks at the board before touching it. It does
    not replace the gesture handlers (a resume outside one may be refused), but the page keeps its
    sticky activation, so in practice this is what turns the sound back on.
  - **`navigator.audioSession.type = 'playback'`** at context creation (Safari 16.4+, guarded). On
    iPhone the Ring/Silent switch mutes Web Audio in a page (unlike an inline `<video>`) with no
    error and no way to feature-detect the outcome, so the same build is silent on one phone and
    fine on another. That is most of "sometimes I have sound, sometimes I don't". `playback` is
    what this is (a game with its own soundtrack) and is the category that ignores the switch; it
    also stops whatever the player had going in another app, which is the deliberate trade. Use
    `'ambient'` instead to respect the switch and mix with other audio.
  - **The bed stops while the tab is hidden and comes back with it** (`music.setHidden`, driven
    from `gameAudio()`'s `visibilitychange`). A page that plays audio is exempt from timer
    throttling, so a backgrounded table went on building a bar of synthesis every 40 ms and
    playing it out loud from behind another window. Only the bed: the effects are left alone,
    because the turn cue reaching a player who looked away is the point of it, and `tabAlert`
    expects exactly that.
  - **Muted opens nothing.** `gameAudio()`'s gesture unlock and `AudioSettings`' mute button both
    refuse to create a context while `muted` is set, so a player who muted before the first tap
    never gets a context, a `playback` audio session (which on iOS stops whatever they had going
    in another app) or a scheduler in service of silence. Unmuting is itself a gesture: the button
    unlocks and starts the bed on the spot rather than leaving it to the next store change.
  - **Settings are applied now and written later** (`PERSIST_DEBOUNCE_MS`, flushed on `pagehide`
    and by `persistNow()`). A slider fires `input` dozens of times a second and `setItem` is
    synchronous, so one write per step was sixty blocking writes a second on the main thread over
    a live board, recording values the next step replaced.
- `audio/sfx.ts` — one-shots, and a sound set with an identity rather than a drawer of oscillator
  presets. The first set was sines, squares and swept noise — the sounds every prototype makes,
  which is why it read as "heard a thousand times" — and it was replaced whole. Four materials, each
  a primitive in the file, each voice built from them and nothing else:
  - **Card stock on felt** (`cardHit`: a flick of combed noise, a resonant `snap`, a `thud` of the
    table underneath; `cardDraw` slides fibrous noise through a comb; the deal is a `snap` riffle
    climbing and panning across the pile). Nothing that handles a card is a pitched tone. Every hit
    lands a shade to one side (`HUMAN_PAN`) and never twice the same (`humanVariation`).
  - **Wood** (`mallet`: a fundamental and a fourth partial that dies faster, under a tick of attack
    noise — marimba low, kalimba high). Every interface sound is one: the tap, the back, the turn
    coming round, somebody sitting down or leaving, the two knocks of a refusal, the woodblock of
    the countdown. The game is a table and its controls are things on it, not a phone's beeps.
  - **Brass and bell** (`stab` for the chords, `bell` for a two-operator FM strike whose index
    falls with the note): the call, the verdict, the match. The chords are the ones already
    reasoned below; what changed is the body — a bell partial on top, a sub `thud` under the root,
    and for the catch a gong at ratio 1.41, metal that does not agree with itself, because being
    caught is not a tune.
  - **Air** (`whoosh`: noise swelling into a sweep, panned across the room when it crosses one):
    the breath before the LOCO! and the slam, the two hands of a swap passing each other, the
    rush in front of a match found. It says "something moved fast" without playing a note.
  - Two cues are envelopes nobody else has, on purpose: `reverse` is a note played backwards (it
    swells in and stops dead, then the mallet lands on the far side) and `skip` is a zip past the
    seat into a dead note. The ear knows what the ring did before the eye does.
  - `make audio-verify` prints each cue's audible length beside its peak (`len=`, the last frame
    above a fortieth of the loudest): a card game plays faster than its sounds decay, and that is
    the column to read after touching a voice.
  - **How often a cue plays is part of its level.** `yourTurn` fires once a turn for the whole
    match, so it is mixed *under* the cues that report an event rather than beside them: at the
    card handling's peak it stopped being a nudge and became an alarm somewhere around the tenth
    turn, which is the one complaint a cue this frequent can earn. It sits at ~0.14 against
    `cardPlay`'s ~0.14 over less than half the length, and it is the only voice whose level is
    argued from repetition instead of from what it means.
  - **And the ceiling is the other half of that.** `matchWin` stacks a chord, two bells and a sub on
    the same instant at 0.5s; those four summing put it at 0.82, over `audio-verify`'s 0.8, on the
    moment of the evening most likely to be clipped for a stream. It is trimmed **as a group** — the
    balance between the four is the one that was written, and lowering the loudest alone would
    rewrite the cue rather than the level.
- `audio/music.ts` — the bed **engine**. It contains no music: loops are data in `audio/tracks/` and
  files under `client/public/music/`, and this plays any of them (loading, loop points, the
  arrangement ladder, the crossfades).
- `audio/tracks/` — the registry. `types.ts` documents the schema; `index.ts` lists the loops (add
  one by encoding a file and writing a `LoopDef` — engine, panel, tests and harness all read that
  list). Nineteen ship, laid out along the ladder: **Intermission**, **Idle Hands**, **Fanned Out**,
  **Nightcap** and **Small Talk** over the count-up and the wait, **Patience** and **Late Arrivals**
  over the wait alone, **Rowdy**, **Sidetrack**, **Mirage**, **Full Table** and **Clockwork** over
  ordinary play, and **Sleight**, **Pile-Up**, **Uproar**, **Neck and Neck**, **On the Run**,
  **Runaway** and **Bad Manners** as it gets away from everybody. Each carries its tempo
  (`LoopDef.bpm`), which is what lets a change land on a bar line — see "Where a change lands".

### Why the synthesiser went, and what had to be bought back

The bed used to generate every note. A track was `parts` plus a `form` the engine walked, and that
design existed because the version before it was one four-bar loop whose only variation was layer
count — the verdict was "it's just a chorus on repeat", and it was right.

Three tracks was also the ceiling. Writing a fourth meant writing music in a data schema, which is a
much narrower talent than picking one, and the register the synthesiser landed on (138 BPM trance)
was inherited from the Strudel sketch it started as rather than chosen against the art direction.
Cartoon premium wants jazz, funk and something a bit silly; the sequencer was not going to get there.

So the music is recorded now. What that costs is the form, and the property the form defended has to
be bought some other way:

- **More loops than sections.** Each loop declares which sections it can carry, every section is
  carried by **at least two**, and the **groove by at least five** — all pinned by `music.test.ts`,
  because one loop for a section means a table sitting in that section hears one piece of music for
  as long as it sits there, which is the failure the whole design exists to escape.
- **Two reasons to change loop, not one.** The table moved to another section, or this loop has come
  round `LAPS_PER_LOOP` times. The second is what moves the music on a table whose tension never
  changes, and a bed that only ever answered the game would be a loop with extra steps.
- **A match is played inside one family** (`LoopDef.family`, `FAMILIES`: `lounge`, `party`,
  `night`). Eighteen loops chosen one by one to fit a card game did not fit each other: the groove
  alone held jazz, funk, a drum-and-bass sketch and an ambient piece, and the bag dealt them in any
  order, so every loop change — a section move, a second lap, a ⏭ — was heard as the *genre*
  changing rather than the piece, and a match sounded like a radio being retuned. A family is the
  loops that share a palette, `nextLoopId` takes one and never leaves it while it carries the
  section asked for, `prefetch` warms the family's loops only, and `start()` draws a family per
  scene — and draws another, away from the current one, when the scene moves under a running bed,
  which is the one moment a change of palette lands on a loop change the bed was making anyway.
  **The grouping is the composer's tags for the pack** (`jazz`, `silly`/`funk`,
  `ambient`/`electronic`/`lofi`/`dnb`, plus each track's energy) recovered from the bundle's
  `csv_data.js` by matching each loop's `seconds` to its source file — nobody can listen in a
  test — so a loop that turns out to sit in the wrong room moves by editing one field.
  `music.test.ts` pins that every family carries every section, a groove of at least two, **and a
  build-up and a drop of at least two**: the fallback in `loopsFor` that would reach into another
  family exists so a thin family cannot go silent, and the test is what keeps it from ever being
  taken. The last two floors came from reading the registry against the ladder rather than from a
  complaint, and the complaint was on its way: the lounge's drop was **On the Run** alone, so an
  endgame there was one 44-second funk loop for as long as somebody stayed on one card, and its
  build-up was **Fanned Out** alone, so a player who left the home screen up in that palette heard
  one piece of jazz for the whole evening. **Sleight** (the composer's second-highest energy in the
  lounge) now carries the drop as well, **Idle Hands** the build-up as well, and **Late Arrivals** —
  Sketchbook 2024-09-18, jazz, energy 2, the one wait-shaped jazz piece left in the archive — was
  encoded for the same reason. **Sidetrack** went the other way: at 160 BPM and the second-loudest
  file in the registry it was the night palette's *waiting room*, tagged energy 3 by the composer and
  measured as the most driving thing in its family, so it is ordinary play now and nothing else. None
  of that was heard; it was read off the composer's tags and off `librosa`, which is the only way a
  registry nobody can listen to in a test gets audited.

**Both floors are calibration, and both were wrong the first time.** The bed shipped with six loops,
a floor of two everywhere and three laps, and the first verdict on it was that it repeats. It did,
from both ends at once: an ordinary groove is where a match lives, it had three loops, and each was
held for over two minutes. Six became eleven and then eighteen, the groove three then seven then ten,
and three laps became two. Neither number is a preference — a groove floor of two passed every test
and was not something anyone wanted to listen to, and the way that failure shows up is a player
saying "it repeats" rather than a red line.

**Two archives were bought and only one was used.** `2024-q3` is 55 to 102 second pieces and seven of
them are in the registry; `2026-q2` was rejected whole, because outside its ambient tracks nothing in
it runs past 32 seconds and two laps of that is barely a minute — padding the registry with short
loops is the complaint, not the fix. Length is a selection criterion here and `music.test.ts` holds
the floor at 30 seconds.

Both go through one crossfade, and `sectionFor`, `loopsFor`, `nextLoopId` and `shuffledOrder` stay
pure, exported and unit-tested for the same reason they always were: "does the music go somewhere" is
a claim about behaviour, not about taste.

### The details that fail silently

- **MP3, not the source OGG.** The pack ships Ogg Vorbis, which is the better container for looping
  and which **Safari only decodes natively from 18.4** — before that `decodeAudioData` refuses it
  outright. On this platform that is silence with no error, which is the failure mode three other
  entries in this note already exist for. So the files are transcoded, and the seam problem MP3
  brings with it is solved below rather than avoided.
- **A loop is looped on the source file's duration, never the decoded buffer's.** MP3 carries
  encoder delay at the head and padding at the tail, and both survive `decodeAudioData`: a buffer
  looped on its own length inserts exactly the gap the pack's README warns about. `LoopDef.seconds`
  carries the OGG's duration to the sample, the engine finds the first audible frame for `loopStart`
  and adds that figure for `loopEnd`, which puts the seam back where the composer cut it. Measured
  before encoding: none of the sixteen source files has any silence at either end, so the head this
  finds *is* the encoder's and nothing else.
- **Normalised to −18 LUFS, peaks under −2 dBTP.** The archive ranged from −14.5 to −24 LUFS, ten
  units of spread. In a shuffled playlist that is not variety, it is a level jump that reads as a
  defect of the game, and it would arrive at the handover — the moment a player is most likely to
  notice the music at all. The peak ceiling is headroom for the effects that play over the bed, which
  is also why `output()`'s fixed `0.55` trim survives the rewrite unchanged.
- **A cover image rides inside the source files.** Every OGG in the pack embeds a 1000×1000 PNG, and
  `ffmpeg` copies it into the MP3 unless told not to: the first encode came out at 350 kbps apparent
  for 146 kbps of audio, more than double the weight for a picture nothing displays. `-map 0:a -vn`
  is not tidiness, it is three megabytes.
- **The crossfade is equal-power and never touches `out.gain`.** Cosine/sine on the two source gains,
  because a linear ramp on both sides sums to a dip in the middle for material that is not
  correlated, and two different loops never are. The node it leaves alone belongs to `duck()`: the
  synthesised bed covered a track change with a dip on that same node, and `cancelScheduledValues`
  took the duck's own return with it, ramping the bed back to full under the one sound people clip.
  A crossfade between two source gains cannot have that argument, which is why `duckUntil` and
  `duckAmount` are gone rather than ported.
- **The intensity is slewed and the section is held.** Game events move the intensity in jumps. A
  Contre-LOCO! that lands and a hand that grows back would otherwise crossfade the bed out and
  straight back in, twice, inside two seconds. `SLEW_PER_SEC` gives a full swing ~1.8s and
  `SECTION_HOLD_MS` catches the value that parks on a threshold, where the slew alone would let
  rounding chatter the bed between two loops.
- **And a fall is believed later than a rise** (`SECTION_RELEASE_MS`, `sectionHoldMs`). The slew and
  the hold were tuned on a spike — one event, answered and gone — and the endgame is not a spike:
  `intensityOf` crosses the drop's threshold at one card in any hand, and an endgame hand goes
  1 → 3 → 2 → 1 every few turns as seats draw and play back down, so the bed crossfaded out of the
  drop and back into it on every dip, a different piece every ten seconds on the tensest table of
  the evening. A rise is still answered on the hold, because somebody reaching their last card is
  what the drop exists for. A fall has to hold **twelve seconds, continuously** — `pendingSince`
  resets whenever the wanted section changes, so one return above the line restarts the wait — which
  is long enough to be the table calming down and not one seat drawing. The breakdown is exempt:
  the only way in-game intensity reaches it is the round summary, which is a stop and not a dip,
  and the one section a round's end is meant to sound like.
- **But the scene moving is not a fall in tension, and it must not wait on that hold**
  (`start()`'s `moved` branch). This is the one the release hold broke, and it was reported from the
  outside as "I start a match, I quit, I start another one, and it is still the same music": leaving
  the table asks for the menu's build-up, which is a *fall*, so the bed sat on twelve seconds of
  patience — and pressing play again inside that window reset the wanted section before the wait was
  ever crossed. The menu, the second deal and everything between them came out as one unbroken
  piece. A scene move is a fact about where the player is standing, not a reading of how tense a
  round is, so `start()` answers it on the spot: another palette (`nextFamily`), the section the new
  screen asks for, and a crossfade into a loop of it. The intensity is **snapped** to its target
  there for the same reason — the slew exists to absorb a spike inside a round, and a player leaving
  the table is not a spike. `musicScene.test.ts` drives a real bed over a fake context, because both
  halves of this defect were individually correct and only their ordering was wrong.
### Where a change lands

The bed changed loop whenever a 250 ms tick noticed a reason to, and a crossfade that starts on a
tick lands wherever the tick fell: mid-bar, beat three, the second half of a phrase. Two loops of the
same family at compatible tempos still sounded like a radio being retuned, because the ear hears a
change that lands off the grid as a mistake and one that lands on the one as a cut. Three rules fix
it, and all three are timing rather than sound, which is why `musicHandover.test.ts` drives a real
bed over a fake context whose clock the test moves and reads the times the bed *scheduled*.

- **A section change lands on the outgoing loop's next bar line** (`untilNextBar`, `nextBarAt`). The
  incoming piece's downbeat is put on the outgoing piece's downbeat and both curves run from there.
  The wait is under a bar — 3.4 s at the slowest tempo — after the slew and the hold have already
  spent their second and a half, so a rise still reads as an answer. A bar line closer than
  `MIN_LEAD_S` is skipped for the next: a start inside the scheduler's own latency lands late, and
  late is off the beat, which is worse than a bar later.
- **A lap handover lands on the wrap** (`untilNextWrap`, `land`). Before, the tick noticed the second
  lap had completed up to 250 ms after the fact and started a 2 s crossfade, so the outgoing loop
  restarted its top under the incoming one's: two downbeats a second apart, on every handover, on
  the one change nothing in the game had asked for. Now the handover is decided
  `HANDOVER_LOOKAHEAD_S` before the wrap that completes `LAPS_PER_LOOP`, the file is loaded, the
  incoming source is scheduled to start *exactly* at that wrap and arrives whole (a 20 ms ramp, for
  the click and nothing else), and the outgoing one fades over its own last bar, `HANDOVER_TAIL_S`,
  ending where the new one starts. A breath, then the one. The lookahead is the load budget — a
  cache hit needs none of it, a cold decode 72–208 ms — and a file that is not ready by its moment
  falls back to an ordinary crossfade the instant it is, which is exactly what a cold change cost
  before any of this. `getLoopId()` keeps naming the outgoing piece until the scheduled one is
  sounding, so the panel does not announce a handover four seconds early.
- **A scene move and ⏭ are answered on the spot.** Both are something the player just did, and a
  press answered a bar later is a press that felt ignored; the bar grid is for the changes the bed
  makes on its own.

**The tempo is data on the loop** (`LoopDef.bpm`, one bar is `240 / bpm`), and it had to be
measured: the pack carries the composer's energy and genre tags but no tempo. Each file's onset
envelope was autocorrelated at candidate bar lengths constrained to a **whole number of bars** —
every loop here is one, the composer cut them on bar lines — and the candidate with the strongest
periodicity at one, two, four and eight beats won. Where a tempo and its double both fit (85 and 170
for the drum-and-bass **Neck and Neck**, 80 and 160 for **Sidetrack**), the **slower** is written:
its bar lines are downbeats under either reading, the faster one's fall on beat three half the time.
Two were genuinely ambiguous between a 3:2 pair (**On the Run** at 76.67 or 115, **Full Table** at
86.67 or 130) and went to the reading with the stronger eight-beat periodicity; if one of them ever
sounds off at a handover, the field is the fix. `music.test.ts` asserts that `seconds × bpm / 240`
is whole to a fiftieth, which is the check that catches a wrong tempo, and that the slowest bar is
well under the release hold, so aligning a fall never doubles its wait.

**The fade's length is the reason for it** (`fadeFor`). One `CROSSFADE_S` for everything meant the
drop arriving at the same speed as the round summary's jazz. A rise is `RISE_FADE_S`, 1.5 s: somebody
reached their last card, and the drop is what the bed exists for. A fall is `FALL_FADE_S`, 4 s:
nothing about the table settling is urgent, and it is the fade that plays under the round-end fanfare
and its duck, which a slow one sits under rather than fighting. What the player did — a scene move, a
⏭ — keeps the 2 s. And the scene going `off` **fades** (`STOP_FADE_S`) instead of cutting: `stop()`
took the voice down mid-bar, which for a hidden tab is right and for a screen change was a click.

**Two screens were silent that had no reason to be.** `sceneFor` mapped `searching` and `matchfound`
to `off`, so the bed stopped dead — a hard cut — at the 1v1 press and started again at the deal: the
one screen a player spends minutes on opened in silence, and the queue's own cue landed on nothing.
Both are the wait now, like the waiting room. And `gameover` was `off` too, so the match's last
sound was the fanfare over a bed being cut under it, and the recap — the evening's count-up, the
screen **Intermission**'s blurb describes — was silent. It is the **match's** scene now at the round
summary's intensity: the palette stays, the drop falls into the breakdown under the recap through
the 4 s fade, and a rematch or a requeue is the scene move it always was. Only `restoring` is off.

### Loading, and why none of it is audible

The bed starts on the **entry screen**, not at the deal: `sceneFor` maps `lobby`, `waiting` and the
queue's two screens to music, so the first fetch happens while somebody is typing a nickname. That is most of the answer to
"is the first load covered" — nobody is waiting for music on a screen they have just opened, and by
the time the deal turns the section from build-up to groove the warm-up has had the whole wait.

The rest is the order of operations rather than the warm-up:

- **`swapTo` awaits the incoming buffer before it touches the outgoing voice.** A loop that is not
  cached therefore costs a slightly later crossfade and never a gap. This is the property that makes
  a cold change inaudible; warming only shortens the delay, which is why `PREFETCH_MAX` is 3 against
  a registry of 18 and does not need to grow with it.
- **The cache is bounded by memory, and memory is not file size.** This was measured rather than
  assumed, and the numbers are the reason the mechanism exists: an `AudioBuffer` is deinterleaved
  float32 at the context's sample rate, so `idle-hands` — a **1.5 MB** MP3 of 102 seconds — decodes
  to **37 MB of RAM**, about twenty-four times its own weight. Eighteen decoded at once is **418 MB**
  and the worst six is **191 MB**, which an unevicted cache was quietly holding on a phone once a
  table had been through all four sections. `CACHE_BUDGET_BYTES` is 64 MB with least-recently-used
  eviction, and a full simulated match now peaks at **61.8 MB**.
- **Eviction never drops a voice that is sounding or fading out.** Deleting the `Decoded` does not
  stop the `AudioBufferSourceNode` already reading it, so the next reference would decode a second
  copy of something the room can hear and the two would coexist — memory spent to save memory.
- **Eviction is close to free.** nginx serves `/music/` with a week of `Cache-Control`, so re-entering
  a loop costs one `decodeAudioData` — measured at 72–208 ms — and no network at all. That lands well
  inside the window the outgoing voice is still covering.
- **`PREFETCH_MAX` has to fit inside `CACHE_BUDGET_BYTES`**, or the warm-up evicts what the warm-up
  just decoded: three fetches and three decodes spent to hold three buffers anyway. `music.test.ts`
  pins the relation against the longest loops in the registry rather than against a typed-in figure.
- **`prefetch` sorts by `distance`** — the rungs between a loop's nearest section and the one
  sounding — and is **called again on every section change**, so the working set follows the table
  instead of being decided at the deal.

Three defects came out of writing that down, all of them invisible from the outside:

- **A request arriving during a swap was dropped.** The `swapping` guard returned early, but
  `setLoop` had already written `this.loop` on the way past — so the panel named a piece that would
  never play, and `nextLoopId` then treated that name as the one to avoid while the real voice was a
  candidate to be "changed" to itself, which restarts it from the top. Requests land in `desired`
  now and `runSwaps` drains them, so a section change during a cold fetch is honoured rather than
  lost.
- **Nothing a player can see or hear may move before the piece is sounding.** `this.loop` and the
  persisted `track` setting are written at the commit inside `swapTo`; `getLoopId()` reads the voice.
- **A failed opening load left the table silent for good.** The fetch returns null, the caller
  correctly keeps what is sounding — and at the start of a match that is nothing. The tick now asks
  again when there is no voice, nothing in flight and nothing swapping, because the next section
  change is minutes away on a long round and may never come in a solo game.
- **`start()` goes through the same door as every other change.** It used to call `swapTo` directly
  while the tick was already running, so a tick firing 250 ms in could start a second voice on top of
  the first one's load.
- **A bed that will not load is a quiet game, never a broken one.** A 404 or a decode failure leaves
  whatever is already sounding in place and leaves `this.loop` naming it, so the panel never
  announces a loop nobody can hear. `music.test.ts` asserts every declared id has a file of a
  plausible size behind it, because that failure is invisible at every other layer.
- **Muted still opens nothing** — and now that means no fetch and no decode either, not just no
  scheduler.
- **Hidden stops the sources**, where it used to stop a scheduler. A page that plays audio is exempt
  from timer throttling, so the old bed went on synthesising from behind another window; a looping
  `AudioBufferSourceNode` would go on playing outright.
- **And visible again resumes the same loop from the same bar** (`park` / `resume`, `resumeOffset`,
  `RESUME_FADE_S`). The return used to go through `start()`, which reseeds the shuffle, empties the
  bag and draws a loop, so every alt-tab was a different piece of music — and Chrome marks an
  occluded window hidden, so on desktop that was every glance at another window. The pause parks
  the sounding loop with its position in the run (laps included, so `getLaps` carries on counting)
  and comes back to it under a 0.4s fade rather than a cut into the middle of a phrase; the section
  and the scheduler are left where they were, so a table that moved while the tab was away is
  answered through the ordinary hold like any other change. Only a scene that moved meanwhile —
  the match ended, a rematch dealt — goes through `start()` again, because that is a new scene and
  not a pause.
- **`music.setLapSeconds(n)` is the harness seam**, same convention as the server's
  `AFKKickThreshold`. A real loop is 38 to 102 seconds and hands over after two of them, so without
  it the unattended handover is the one behaviour nothing ever checks. It moves the handover decision
  alone and never the loop points, so what `make audio-verify` hears is still the music playing
  properly.

### What playback still guarantees

- Playback is a **shuffled playlist**, not a selection: no picker, one ⏭. `shuffledOrder` deals every
  id once per bag and never opens on the one that just played — with two loops carrying a section,
  pure random replays the outgoing one half the time, which people hear as broken rather than as
  random.
- **⏭ stays inside the section the table is in.** The alternative is a button that answers a press by
  contradicting the game, and the panel is open over a live board.
- **A title is a name; a blurb is copy; only the blurb is translated.** The title is one string, in
  English, and `music.test.ts` refuses a character outside `[A-Za-z0-9 '-]` so a French one cannot
  drift back in. The first pass had them French — `Entracte`, `Filou`, `Ruade` — which read fine
  next to a French blurb and made the panel look like it was translating the music: a piece whose
  name changes with the interface language is two pieces to anybody who switches, and neither is the
  one the composer released. Names are `Intermission`, `Sleight`, `Bad Manners` now; the blurbs
  underneath stayed in both languages, because those really are the game talking.
- **A title names the writing, never the genre**, and here also never the source file's date. They
  arrive as `Sketchbook 2024-05-29`, a name that says nothing about one piece that it would not say
  about the two hundred others in the bundle. `Intermission` is what plays while the table counts up;
  `Sleight` is somebody setting something up; `Bad Manners` is the table that has stopped being
  polite.
- **`music.duck(ms)`** pulls the bed under the win/lose fanfares through the bed's own output stage,
  so it never touches the user's music volume. Two pieces of music fighting for the same moment makes
  both of them mush, and the fanfare is the one people clip.

### Licence

Abstraction (Tallbeard Studios), *Music Loop Bundle*, **CC0 1.0**: copyright waived, no attribution
required, commercial use and modification permitted. Credited anyway in `NOTICE.md` and
`client/public/licenses.txt`, the way the CC0 model kits are. The authors ask that their work not be
used for NFTs, for training machine-learning models, or resold unmodified, and none of those happens
here. The files are served from this origin and never a CDN, which is what keeps
[`legal.md`](legal.md)'s "no third-party request from the player's browser" true.

- `audio/gameSounds.ts` — **decides**, and plays nothing. `soundsForTransition` is a pure function
  of two store snapshots, which is what makes it a unit test rather than a listening exercise.
- `hooks/appEffects.svelte.ts` — `gameAudio()`, **the only place a game sound is played**. One store
  subscription feeding the list above, instead of audio calls scattered through components: every
  sound stays in one readable list and cannot double-fire. A component calling `playSfx` directly is
  a UI tap (`uiTap`, `uiBack`) and never a game event.
- `<AudioSettings />` sits in the top-right cluster on every screen: three sliders, a **now-playing
  line plus a ⏭ next button** (44px target), and mute. There is deliberately **no picker** — choosing
  from a list means reading six names to make a decision nobody opened the panel to make, whereas
  "not this one" is a judgement you can act on in one tap. Music defaults below effects — it is a bed,
  and a streamer talking over the game must stay louder than it. The current loop id is written back
  to `loco_audio` on **every** handover, which is also what re-renders the now-playing line when the
  bed changes loop on its own; `engine.ts` stores it as a **bare string** and never imports the
  registry, because the registry depends on the engine. The stored key is still `track`: a loop is
  what a player is listening to, and renaming a persisted field to match an internal rework would
  invalidate everybody's stored preference to no end.
  - **Moving a slider auditions the bus, and that is not the same event as a press.** A range input
    fires `input` on every step it crosses, so a drag is dozens of them a second, and the sample
    lasts 100ms: played one per event they overlap four and five deep and the panel answers a volume
    change with a shrill continuous buzz rather than a level. **The engine's voice budget does not
    cover this** — six voices a frame is a clipping guard, and far more than it takes to build the
    buzz. Two things fix it and neither works alone.
    - `AUDITION_MS` (130) is a floor between samples, in the component, because throttling a
      continuous control is a decision about that control. It is also what keeps the fix testable:
      the sfx module is mocked in component tests, so a floor hidden inside it could not be seen.
    - `playVolumeAudition(level)` is the sample, and **it is a function of the level**. Spacing them
      out alone cost the gesture its shape — a row of identical blips says nothing about which way
      the slider went, and on the master bus the audition is the only feedback there is. The pitch
      climbs the travel over two octaves on a major pentatonic (A3 to A5, 11 steps), so moving up
      sounds like moving up: stepped rather than glided, because a run lands and a siren does not.
      **Level moves the pitch and the filter, never the gain** — the bus being moved already applies
      the gain, and scaling twice silences the bottom of the travel, which is the part a player is
      listening for. It stays an octave under `uiTap` and low-passed below 2.8kHz for the original
      reason: a blip that is bright heard once is shrill heard thirty times, and 2-5kHz is the band
      the ear is sharpest in.
    - Because it takes an argument it is **not a `SfxName`**, so the `SFX_NAMES` loop in
      `verify.mjs` cannot reach it and it is measured by hand there — both ends of the travel, plus
      an FFT on each proving the pitch really climbs and that the top stays under 1.2kHz. That last
      one is the only check in the repo that hears a note rather than counting a call.
    - `src/test/audio.test.ts` owns the rate and the level handed over. Anything else that makes a
      sound per step of a continuous control takes the same treatment.
- `make audio-verify` (`tools/audio/verify.mjs`) is the only thing that can catch a broken envelope
  or a mis-wired node: those produce **silence**, not an error, so no unit test would ever go red.
  It plays every voice through a real AudioContext and measures peak amplitude on the bus. **Every
  voice, read from `sfx.SFX_NAMES` rather than from a list in the harness**: it carried a
  hand-written copy for a while, which quietly exempted every sound added after that copy was
  written from the only check that can see silence. Then it
  checks the properties of the bed that are claims rather than code: **every registered loop makes
  sound** (a missing file 404s and the bed keeps what was already sounding, so the failure is silence
  and not an error), that **the ladder reaches the music** — walking the four thresholds must produce
  at least three distinct sections, each with a loop that carries it, which is the one check that
  crosses from a pure function to what comes out of the bus — that **the next button changes loop**
  without ever repeating back to back and covers the section's bag, that a loop that has come round
  enough times **hands over unattended** with the table holding still (the direct test of "it's just
  a chorus on repeat", run under `setLapSeconds` because a real loop takes minutes),
  that calm and tense arrive at the **same level** (×1.00 ± 0.4), that the sections
  actually move breakdown→drop (a bed can get louder without ever bringing the drums in), that the
  slew reaches its targets, that ducking attenuates, and the **frame cost** of the drop against idle
  (the synthesised bed built a lot of nodes; two buffer sources cost less, and it was already free).
  - **The level check is inverted from what it was, on purpose.** It measured a ≥1.3× energy rise
    between calm and tense while the bed was synthesised, because the ladder was a layer count and
    more layers is more signal. Against normalised loops it failed at ×1.02 — for exactly the reason
    the bed is correct, since every file is mastered to −18 LUFS so a shuffled playlist does not
    lurch at the handover. Tension is carried by *which* loop plays now, which `ladder` and
    `sections` assert; what this measurement guards is that a loop added later without normalising
    shows up somewhere, and this is the only place it would.
  - **Measure over a full phrase.** `LOOP_MS` is deliberately several bars long; a shorter window
    samples a random slice of the piece, which is exactly how the first version of this check
    confidently reported ×1.05 for a bed that does change.
  - Deliberately outside CI: audio devices in CI containers are unreliable and a flaky sound
    assertion trains people to ignore red. Run it after touching `sfx.ts`, `music.ts` or `engine.ts`,
    or after re-encoding a loop.
- **What `gameSounds.ts` keys a cue on is a stamp, never a flag or a string.** `unoDeclared` is a
  latch that stays up under the banner, so a second seat calling it (routine after a Global
  Switch) made no sound; `errorMsg` compared as a string heard one of two identical refusals. Both
  carry a stamp now (`unoDeclaredAt`, `errorAt`), minted by `store/helpers.ts`'s `stamp()`, which
  is strictly increasing so two events in one millisecond are two events. The seat that opens the
  match gets its `yourTurn` on the table opening (`mapLoading` going null) rather than on a turn
  number that never moved; every round's deal gets the flourish (`dealFor`), not only the first;
  an opponent going quiet has a voice (`playerAway`) and their return is the arrival cue; and the
  list is de-duplicated, because two copies of one cue on the same sample is one cue at twice the
  level on a bus with no limiter. The countdown ticks are five timeouts aimed at their seconds,
  not a 200 ms poll for the whole turn.
- **`make audio-verify` can borrow a browser** (`LOCO_CHROMIUM=/path/to/chrome`): the harness
  launches whatever Chromium the `playwright` package it resolves has downloaded, and a machine
  that already has one — a sandbox, a CI image with browsers baked in — need not fetch another
  copy to run it. Unset, Playwright uses its own, as before.
- **The handling is never played twice the same way** (`humanVariation` in `sfx.ts`, applied by
  `playSfx` to `cardPlay`, `cardDraw`, `cardDeal`, `uiTap`, `uiBack`, `skip`, `reverse`, and by
  `playDeal` to each card of the flourish): ±45 cents of detune and a gain between 0.86 and 1 per hit
  — under the threshold of "a different sound", over the threshold of "the same sound again". Fifty
  copies of one sample a round is the sound of a machine. The cues that *mean* something (a call, a
  catch, a fanfare) stay exact: those are the vocabulary, and a word is not pronounced differently
  each time. `haptics.test.ts` pins the range.
- **The phone answers the same list** (`hooks/haptics.ts`): `hapticsFor` reads the cues
  `soundsForTransition` produced and picks one pattern per moment, the strongest cue's, never a
  chain; `gameAudio()` plays it right after the sounds. Presentation only, off by one switch in the
  preferences (stored inverted, `loco_haptics_off`, so a fresh install buzzes), and a no-op — with
  no switch offered — wherever `navigator.vibrate` is absent.
- **Strudel was evaluated and rejected**: `@strudel/*` and `superdough` are AGPL-3.0-or-later, and
  bundling them into a network-served client triggers §13 for the whole app. Revisit only if LOCO
  itself becomes AGPL.

