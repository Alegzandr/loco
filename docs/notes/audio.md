# Audio

Every sound effect is synthesised at runtime. The music is nineteen CC0 loops, served from this
origin. The rules are in `CLAUDE.md`; this note carries the reasons and the edge cases.

A sound effect is a reaction and has to answer a tap in the same frame, so it cannot afford a fetch:
nothing to download, nothing to licence, no cache-miss silence. A bed is not a reaction, so it can.

## The engine (`audio/engine.ts`)

A lazy `AudioContext` (browsers refuse one outside a user gesture; every play before `unlock()` is a
silent no-op), master → sfx/music buses, settings persisted under `loco_audio`, and a per-frame voice
budget (`budgetVoice`, six) so a batch play cannot stack a dozen voices.

**Mobile Safari loses the context three ways, and all three fail as silence rather than as an
error.** `src/test/audioLifecycle.test.ts` owns all three.

- **`unlock()` resumes anything that is not `running`**, never just `suspended`: WebKit parks the
  context in a non-standard `interrupted` state when the page is backgrounded, a call lands or Siri
  speaks. Guarded on `suspended`, the sound is gone for the rest of the page's life.
- **`unlock()` is `async` and resolves once the context is really running.** `resume()` is a
  promise; a bed started on the next line finds the context not ready and does nothing until the
  second tap. `gameAudio()` starts the music inside the `.then()`.
- **`visibilitychange` + `focus` reclaim the context** (`gameAudio()`, skipped while hidden). Coming
  back from another app is exactly when there is no gesture to hang a resume on; the page keeps its
  sticky activation, so this is what turns the sound back on. It does not replace the gesture
  handlers.

Also:

- **`navigator.audioSession.type = 'playback'`** at context creation (Safari 16.4+, guarded). On
  iPhone the Ring/Silent switch mutes Web Audio with no error and no way to detect it; `playback` is
  the category that ignores the switch. It also stops other apps' audio — the deliberate trade.
  (`'ambient'` would respect the switch and mix.)
- **The bed stops while the tab is hidden** (`music.setHidden`, from `gameAudio()`'s
  `visibilitychange`): a page that plays audio is exempt from timer throttling, and a looping source
  would go on playing from behind another window. The effects are left alone — the turn cue reaching
  a player who looked away is the point of it, and `tabAlert` expects it.
- **Muted opens nothing.** The gesture unlock and `AudioSettings`' mute button refuse to create a
  context while `muted` is set: no context, no `playback` session, no fetch, no decode. Unmuting is a
  gesture, so the button unlocks and starts the bed on the spot.
- **Settings are applied now and written later** (`PERSIST_DEBOUNCE_MS`, 250, flushed on `pagehide`
  and by `persistNow()`): a slider fires `input` dozens of times a second and `setItem` is synchronous.

## Sound effects (`audio/sfx.ts`)

A sound set with an identity, in four materials, each a primitive in the file and every voice built
from them and nothing else:

- **Card stock on felt** (`cardHit`: a flick of combed noise, a resonant `snap`, a `thud` of the
  table; `cardDraw` slides fibrous noise through a comb; the deal is a `snap` riffle climbing and
  panning across the pile). Nothing that handles a card is a pitched tone.
- **Wood** (`mallet`: a fundamental and a faster-dying fourth partial under a tick of attack noise).
  Every interface sound: the tap, the back, the turn coming round, a seat filling or emptying, the two
  knocks of a refusal, the countdown's woodblock. The controls are things on a table, not a phone's
  beeps.
- **Brass and bell** (`stab` for chords, `bell` for a two-operator FM strike): the call, the verdict,
  the match. A bell partial on top, a sub `thud` under the root, and for the catch a gong at ratio
  1.41 — being caught is not a tune.
- **Air** (`whoosh`, a noise swell into a sweep, panned): the breath before the LOCO! and the slam,
  the two hands of a swap passing, the rush before a match found.

Rules on top of the materials:

- **A cue is a struck chord, not a scale, and no two moments may share one** (`stab()`). A chord
  under a filter that opens on the transient says its piece in one hit, which keeps a cue shorter
  than the gap before the next card; a run is as long as its note count, and major-up/minor-down for
  good/bad collapses every moment into one sentence. **`arp()` is not used; do not bring it back.**
- **A tail is a send, never an insert** (`audio.sfxReverbSend()`). The card handling stays dry at
  zero: a reverb inside the voice cannot be taken out, and paper on felt is the family it ruins.
- `reverse` is a note played backwards (swells in, stops dead, mallet on the far side) and `skip` is
  a zip past the seat into a dead note: the ear knows what the ring did before the eye does.
- **How often a cue plays is part of its level.** `yourTurn` fires every turn, so it sits *under*
  the event cues (~0.14 against `cardPlay`'s ~0.14 over less than half the length); at the handling's
  peak it becomes an alarm by the tenth turn.
- **The ceiling is the other half.** `matchWin` stacks a chord, two bells and a sub on one instant;
  it is trimmed **as a group** to stay under `audio-verify`'s 0.8 — lowering the loudest part alone
  would rewrite the cue.
- **The handling is never played twice the same way** (`humanVariation`, applied by `playSfx` to the
  `HUMANISED` set and by `playDeal` to each card): ±45 cents (`HUMAN_CENTS`), gain 0.86–1
  (`HUMAN_GAIN_FLOOR`), pan up to `HUMAN_PAN`. The cues that *mean* something (call, catch, fanfare)
  stay exact: they are the vocabulary. `haptics.test.ts` pins the range.
- **A cue is struck in the bed's key** — see "Keys" below.

## Who decides, who plays

- `audio/gameSounds.ts` **decides** and plays nothing: `soundsForTransition` is a pure function of
  two store snapshots, so it is a unit test rather than a listening exercise.
- `state/appEffects.svelte.ts`'s `gameAudio()` is **the only place a game sound is played**: one
  store subscription, one readable list, nothing double-fires. A component calling `playSfx` directly
  is a UI tap (`uiTap`, `uiBack`), never a game event.
- **What `gameSounds.ts` keys a cue on is a stamp, never a flag or a string** (`unoDeclaredAt`,
  `errorAt`, minted by `store/helpers.ts`'s strictly increasing `stamp()`): a latch misses a second
  seat calling LOCO! after a Global Switch, and a string misses the second of two identical refusals.
  The opening seat's `yourTurn` fires on the table opening (`mapLoading` going null); every round's
  deal gets the flourish (`dealFor`); an opponent going quiet has a voice (`playerAway`); the list is
  de-duplicated (two copies of a cue on one sample is one cue at twice the level on a bus with no
  limiter). The countdown ticks are five timeouts aimed at their seconds.
- **The phone answers the same list** (`state/haptics.ts`): `hapticsFor` picks one pattern per
  moment, the strongest cue's, and `gameAudio()` plays it after the sounds. Off by one switch
  (stored inverted, `loco_haptics_off`), offered only on a touch screen (`pointer: coarse`) with
  `navigator.vibrate` — desktop Chrome and Edge expose the API with no motor. `haptics.test.ts`.

## The bed

`audio/music.ts` is the engine and contains no music. `audio/tracks/` is the registry (`types.ts`
the schema, `index.ts` the list every consumer reads; add a loop by encoding a file and writing a
`LoopDef`), and the files are under `client/public/music/`. The nineteen loops are laid along the
ladder: **Intermission**, **Idle Hands**, **Fanned Out**, **Nightcap**, **Small Talk** over the
count-up and the wait; **Patience**, **Late Arrivals** over the wait alone; **Rowdy**,
**Sidetrack**, **Mirage**, **Full Table**, **Clockwork** over ordinary play; **Sleight**,
**Pile-Up**, **Uproar**, **Neck and Neck**, **On the Run**, **Runaway**, **Bad Manners** as the
round gets away from everybody.

### What keeps recorded loops from repeating

- **More loops than sections.** Every section carried by **at least two**, the groove by **at least
  five** (`music.test.ts`): one loop per section is one piece for as long as the table sits there.
- **Two reasons to change loop**: the table moved section, or this loop came round `LAPS_PER_LOOP`
  (2) times. The second moves the music on a table whose tension never changes.
- **A match is played inside one family** (`LoopDef.family`, `FAMILIES`: `lounge`, `party`,
  `night`). Loops from different palettes heard back to back sound like a radio being retuned.
  `nextLoopId` stays in the family while it carries the section, `prefetch` warms the family only,
  and `start()` draws a family per scene, and another one when the scene moves under a running bed.
  The grouping is the composer's own tags for the pack, so a loop in the wrong room moves by one
  field. `music.test.ts` pins that every family carries every section, a groove of at least two,
  and a build-up and a drop of at least two each — the cross-family fallback in `loopsFor` exists so
  a thin family cannot go silent, and the test keeps it from ever being taken.
- **A loop runs at least 30 seconds** (`music.test.ts`): two laps of a short loop is barely a minute,
  and padding the registry with short loops is the complaint, not the fix.
- `sectionFor`, `loopsFor`, `nextLoopId` and `shuffledOrder` are pure, exported and unit-tested:
  "does the music go somewhere" is behaviour, not taste.

### The file format, and what fails silently

- **MP3, not the source OGG**: Safari decodes Ogg Vorbis in `decodeAudioData` only from 18.4, and
  before that the failure is silence.
- **A loop is looped on the source file's duration, never the decoded buffer's**
  (`LoopDef.seconds`). MP3's encoder delay and padding survive `decodeAudioData`; the engine finds the
  first audible frame for `loopStart` and adds `seconds` for `loopEnd`, which puts the seam where the
  composer cut it. (No source file has silence at either end, so the head found is the encoder's.)
- **Normalised to −18 LUFS, peaks under −2 dBTP.** Unnormalised, a shuffled playlist jumps in level
  at the handover; the peak ceiling is headroom for the effects, with `output()`'s fixed `0.55` trim.
- **Encode with `-map 0:a -vn`**: every source OGG embeds a 1000×1000 cover that `ffmpeg` otherwise
  copies into the MP3, doubling its weight.
- **A loop change is an equal-power crossfade between two source gains and never touches
  `out.gain`**, which belongs to `duck()` alone: a crossfade on that node cancels the duck's own
  return.
- **A voice has two gains, the way in and the way out, and `retire` owns the second alone**, and
  schedules the stop before any automation. Firefox and Safari throw on an event added inside a
  running `setValueCurveAtTime`; on one node a fade-out laid over a fade-in still running threw before
  the source stopped, and the old loop played under the new one. `musicScene.test.ts` fakes the
  strict engines.

### When the bed moves

- **The intensity is slewed and the section is held** (`SLEW_PER_SEC`, a full swing in ~1.8 s;
  `SECTION_HOLD_MS`, 1.2 s): a catch that lands and a hand growing back would otherwise crossfade out
  and back twice in two seconds, and the hold stops rounding at a threshold from chattering.
- **A fall is believed twelve seconds after a rise** (`SECTION_RELEASE_MS`, `sectionHoldMs`). An
  endgame hand goes 1 → 3 → 2 → 1 every few turns; without it the drop changed piece every ten
  seconds. A rise is answered on the hold; a fall must hold **continuously** (`pendingSince` resets
  when the wanted section changes). The breakdown is exempt: in game it is only reached by the round
  summary, which is a stop, not a dip.
- **A scene move is answered on the spot and is not subject to either hold** (`start()`'s `moved`
  branch): leaving the table asks for the menu's build-up, which is a *fall*, and a fresh match
  started inside the twelve seconds otherwise kept the same piece. Another palette (`nextFamily`), the
  section the new screen asks for, the intensity **snapped** to its target. `musicScene.test.ts`.
- **The queue is the wait and the recap is the game** (`sceneFor`): `searching` and `matchfound`
  play the menu's scene, `gameover` the **match's** scene at the round summary's intensity, so the
  recap falls into the breakdown under the 4 s fade. Only `restoring` is off. The bed starts on the
  entry screen, so the first fetch happens while somebody types a nickname.

### Where a change lands

`musicHandover.test.ts` drives a real bed over a fake context and reads the times the bed scheduled.

- **A section change lands on the outgoing loop's next bar line** (`untilNextBar`, `nextBarAt`),
  the incoming downbeat on the outgoing one. A bar line closer than `MIN_LEAD_S` is skipped: a start
  inside the scheduler's latency lands off the beat.
- **A lap handover lands on the wrap** (`untilNextWrap`, `land`): decided `HANDOVER_LOOKAHEAD_S`
  (4 s) before the wrap that completes the laps, the incoming source starts exactly there and
  arrives whole (a 20 ms ramp against the click), the outgoing one fades over its last bar
  (`HANDOVER_TAIL_S`). The lookahead is the load budget; a file not ready in time falls back to an
  ordinary crossfade the instant it is. `getLoopId()` names the outgoing piece until the new one
  sounds.
- **A scene move and ⏭ are answered on the spot**: a press answered a bar later feels ignored.
- **The tempo is data on the loop** (`LoopDef.bpm`, a bar is `240 / bpm`), measured from the files
  (the pack carries none). **Every loop is a whole number of bars** (`music.test.ts`: `seconds × bpm
  / 240` whole to a fiftieth), and where a tempo and its double both fit the **slower** is written:
  its bar lines are downbeats under either reading. On the Run and Full Table sat between a 3:2 pair
  and took the reading with the stronger eight-beat periodicity; if one sounds off at a handover, the
  field is the fix. The slowest bar is pinned well under the release hold.
- **The fade's length is the reason for it** (`fadeFor`): a rise `RISE_FADE_S` (1.5 s, the drop is
  what the bed exists for), a fall `FALL_FADE_S` (4 s, under the round-end fanfare), a player's move
  `CROSSFADE_S` (2 s), the scene going off `STOP_FADE_S` (1.2 s). Only a hidden tab and an unmount
  cut.
- **Phrases**: every loop moves on four-bar lines (`PHRASE_BARS`). **A rise enters on the loop's
  first full phrase** (`LoopDef.entryBar`, a multiple of four, measured: six loops have one), or the
  drop arrives on the quietest bar of the loop; a lap, a fall and a skip start at the top. **A fall
  lands on a phrase line** when one is within `PHRASE_WAIT_MAX_S` (8 s), the bar otherwise
  (`untilFallLands`); the wrap counts as a phrase line. `planSectionChange` decides all of it before
  anything is scheduled, including the lead that leaves room for a cut's tail and swell.

### Keys, and what two loops may do next to each other

The registry spans A major to C minor, seven steps apart on the circle of fifths, and 70 to 130 BPM:
bar alignment alone puts two clashing keys or two drifting drum parts on top of each other for four
seconds.

- **The key is data on the loop** (`LoopDef.key`), measured on the file: the harmonic part against
  three key profiles (Krumhansl-Kessler, Temperley, Albrecht-Shanahan), the bass line as tie-break,
  the majority written; where major and minor of one tonic split, the minor.
- **Whether two loops may overlap** (`harmony.ts: handoverFor`): at most two steps on the key wheel
  (`BLEND_MAX_KEY_STEPS`) **and** a 3% tempo gap (`BLEND_MAX_TEMPO_GAP`, a tempo and its double
  counting as one pulse). Most pairs in this pack do not blend, which is why the cut has to be good
  rather than rare.
- **A blend** is the equal-power crossfade plus a bass handover (`BASS_SWAP_HZ`, 240 Hz): the incoming
  loop arrives with its low end cut and the two swap in 80 ms on the beat nearest the middle.
- **A cut is never a crossfade.** The outgoing loop closes under a low-pass over its last two beats
  (`cutTailFor`, half a bar bounded to 0.6–1.5 s), air rises into the downbeat (`scheduleSwell`,
  pitchless so it sits under any key), and the next loop lands whole on the one. **Only a press may
  overlap a disagreeing pair**, for `SPOT_CUT_S` (0.6 s) with the outgoing loop darkened; a landing
  that misses its moment falls back to that. The swell goes into every cut and every rise into the
  drop, never into a fall: the table settling should not be announced.
- **The next loop is the nearest one left in the bag** (`followCost`: a blendable pair first, then
  the key, then the tempo; ties keep the shuffle's order), **and never the one just left while the
  bag holds another** (`previous`, which dies with the bed): ranking alone alternates the two loops of
  a family that blend best.
- **A cue is struck in the bed's key** (`cueShiftFor`, `sfx.ts: setTonalitySource`). The cues are
  written around C; the whole vocabulary moves together onto the bed's home chord or its IV or V,
  the smallest move, so **never more than three semitones** and every cue is still itself. A minor
  bed is read through its relative major. Only what has a pitch moves (`mallet`, `bell`, `stab`, the
  reverse). `sfx.ts` never imports the bed; `getTonality()` answers through `getLoopId()`, so a
  scheduled handover does not move the cues early. `sfxKey.test.ts`.
- **Refused:** re-pitching a loop with `playbackRate` (a semitone is a 6% tempo and timbre change on
  recorded material, and it moves the bar grid), and regrouping the families by key alone (it mixes
  genres, which is what the families prevent).

### The bed answers a moment (`bedCueFor`, one answer, the strongest)

- **The match's fanfare brakes it** (`brake()`): the loop slows like a record (`BRAKE_RATE` over
  `BRAKE_S`, its low-pass closing), the room is quiet for `BRAKE_REST_MS` (2.6 s, longer than the
  1.7 s fanfare), and the recap's piece rises over `REENTER_FADE_S`. The cues play **before** the
  brake, so the fanfare is struck in the key it was earned in. A change still loading when the brake
  lands is dropped on arrival (`brakes`); a press during the rest is answered and ends it.
- **A round's fanfare ducks it** (`music.duck(ms)`, through the bed's own output stage, never the
  player's volume): the round summary is a breakdown, not an ending.
- **A LOCO! or a Contre-LOCO! dips it** (`dip()`): the bed's low-pass shuts to 520 Hz for 0.7 s, so
  the shout owns the top of the spectrum and the groove never stops.
- **Something read over the table muffles it** (`setMuffled`, `state/bedMuffle.svelte.ts`, counted):
  the rules and the preferences put it behind a 900 Hz door. **Not the audio panel** — somebody
  setting the music's volume is listening to it.

The low-pass behind the muffle and the dip (`tone`) sits after the duck and before the trim, and
never touches `out.gain`. Each voice's own filters (the high-pass the bass swap moves, the low-pass a
cut closes) sit between its source and its gain; a context that cannot make a filter plays the same
changes without them.

### Loading

- **`swapTo` awaits the incoming buffer before it touches the outgoing voice**, so a cold change
  costs a later crossfade and never a gap. That ordering, not the warm-up, is what makes it
  inaudible, which is why `PREFETCH_MAX` (3) is far smaller than the registry.
- **The cache is bounded by memory, not file size** (`CACHE_BUDGET_BYTES`, 64 MB, LRU): a decoded
  buffer is float32 per channel, so a 1.5 MB MP3 of 102 s is **37 MB of RAM**, and the whole registry
  decoded is over 400 MB. A full simulated match peaks under the budget.
- **Eviction never drops a voice that is sounding or fading**: the source keeps reading the buffer,
  and the next reference would decode a second copy.
- **Eviction is close to free**: `/music/` is served with a week of `Cache-Control`, so re-entering a
  loop is one `decodeAudioData` (72–208 ms), inside the window the outgoing voice covers.
- **`PREFETCH_MAX` must fit inside the budget** (`music.test.ts`, against the longest loops), or the
  warm-up evicts what it just decoded. `prefetch` sorts by `distance` from the sounding section and
  runs again on every section change.
- **A request arriving during a swap is recorded in `desired`, never dropped**; `runSwaps` drains it.
- **Nothing a player can see or hear moves before the piece is sounding**: `this.loop` and the
  persisted `track` are written at the commit inside `swapTo`; `getLoopId()` reads the voice.
- **A bed with nothing sounding and nothing on its way asks again on the next tick**: a failed
  opening load would otherwise leave a solo game silent for good.
- **`start()` goes through the same door as every other change**, so a tick cannot start a second
  voice on top of the first one's load.
- **A bed that will not load is a quiet game, never a broken one**: a 404 or a decode failure keeps
  what is sounding and the name that goes with it. `music.test.ts` asserts every declared id has a
  file of a plausible size behind it.
- **A hidden tab is a pause** (`park` / `resume`, `resumeOffset`, `RESUME_FADE_S` 0.4 s): the same
  loop from the same bar, laps included. Chrome marks an occluded window hidden, so restarting there
  would change the music on every glance at another window. Only a scene that moved meanwhile goes
  through `start()`.

### Playback, titles and the panel

- **A shuffled playlist, not a selection**: no picker, one ⏭. `shuffledOrder` deals every id once
  per bag and never opens on the one that just played. **⏭ stays inside the section the table is
  in**: the alternative contradicts the game from a panel open over a live board.
- **A title is a name and its blurb is copy; only the blurb is translated.** One English string;
  `music.test.ts` refuses a character outside `[A-Za-z0-9 '-]`. A name that changes with the
  interface language is two pieces to anybody who switches. **A title names the writing, never the
  genre and never the source file's date** (`Sketchbook 2024-05-29` says nothing).
- `<AudioSettings />` sits in the top-right cluster on every screen: three sliders, a now-playing
  line, a ⏭ (44px target), mute. Music defaults below effects: a streamer talking over the game must
  stay louder than the bed. The current loop id is written to `loco_audio` on every handover, which
  also re-renders the now-playing line; `engine.ts` stores it as a bare string and never imports the
  registry (the registry depends on the engine). The stored key stays `track` so stored preferences
  survive.
- **A slider auditions its bus, and a drag is not a press.** `input` fires on every step, and
  100 ms samples played per event overlap into a buzz the voice budget does not prevent.
  `AUDITION_MS` (130, in the component, where component tests can see it) is a floor between samples,
  and `playVolumeAudition(level)` is **a function of the level**: the pitch climbs a major pentatonic
  over two octaves (A3–A5) so moving up sounds like moving up. **Level moves the pitch and the
  filter, never the gain** — the bus already applies it, and scaling twice silences the bottom of the
  travel. Low-passed under 2.8 kHz: bright once is shrill thirty times. It takes an argument, so it is
  not a `SfxName`; `verify.mjs` measures it by hand (both ends, an FFT proving the climb and the top
  under 1.2 kHz). `src/test/audio.test.ts` owns the rate and the level handed over.

## `make audio-verify` (`tools/audio/verify.mjs`)

The only check that catches a broken envelope, a mis-wired node or a loop file that 404s, because
those produce silence rather than an error. Deliberately outside CI: audio devices in CI containers
are unreliable, and a flaky sound assertion trains people to ignore red. Run it after touching
`sfx.ts`, `music.ts` or `engine.ts`, or after re-encoding a loop.

- **Every voice, read from `sfx.SFX_NAMES`**, never a list in the harness (a copy exempts every
  later sound). Each cue's peak and audible length (`len=`, last frame above a fortieth of the
  loudest). **Anything above 0.8 fails**: headroom below hard clip, since two cues overlap and the bus
  has no limiter.
- The bed's claims: every registered loop makes sound; walking the ladder's thresholds produces at
  least three distinct sections each with a loop; ⏭ changes loop, never back to back, covering the
  section's bag; a loop that has come round enough times **hands over unattended**
  (`music.setLapSeconds(n)`, the one seam: it moves the handover decision, never the loop points);
  the sections move breakdown → drop; the slew reaches its targets; ducking attenuates; the muffle is
  read as the power above 2 kHz (a 900 Hz low-pass barely moves a mixed loop's RMS, which lives in
  the bass); the frame cost of the drop against idle.
- **Calm and tense arrive at the same level** (×1.00 ± 0.4): every file is mastered to −18 LUFS, so
  tension is *which* loop plays (asserted by the ladder and section checks). What this guards is a
  loop added later without normalising. Measured over `LOOP_MS`, several bars: a shorter window reads
  a random slice of the piece.
- `LOCO_CHROMIUM=/path/to/chrome` borrows an installed Chromium; unset, Playwright uses its own.

## Licence

Abstraction (Tallbeard Studios), *Music Loop Bundle*, **CC0 1.0**: no attribution required,
commercial use and modification permitted. Credited anyway in `NOTICE.md` and
`client/public/licenses.txt`. The authors ask that the work not be used for NFTs, for training
machine-learning models, or resold unmodified; none of those happens here. Served from this origin,
never a CDN, which keeps [`legal.md`](legal.md)'s "no third-party request from the player's browser"
true.

**Strudel is refused**: `@strudel/*` and `superdough` are AGPL-3.0-or-later, and bundling them into a
network-served client brings §13 onto the whole app.
