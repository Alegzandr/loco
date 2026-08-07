# Audio

Everything is synthesised at runtime: no audio files ship with the client.

> Detailed note split out of `CLAUDE.md`. The root file carries the rule; this file carries the
> reasoning, the edge cases, and the bugs that produced them.

## Audio
Everything is synthesised at runtime. **No audio files ship with the client** — nothing to
download, nothing to licence, no cache-miss silence on a sound's first play.

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
- `audio/sfx.ts` — one-shots. Card handling is **noise** (paper has no pitch; a pitched click per
  card becomes a melody nobody wrote); rule outcomes are **pitched and interval-based** so the table
  learns them by ear.
- `audio/music.ts` — the bed **engine**. It contains no music: tracks are data in `audio/tracks/`,
  and this plays any of them (scheduling, synthesis, the arrangement ladder, the song form).
- `audio/tracks/` — the music. `types.ts` documents the schema; `index.ts` is the registry (add a
  track by writing a `TrackDef` and listing it — engine, picker, tests and harness all read that
  list). Three ship: **Neon Horizon** (uplifting trance 138, transcribed from the user's own Strudel
  sketch `F:/dev/strudel-test/neon-horizon.strudel`), **Pixel Rush** (electro house 128, plucks and
  offbeat stabs), **Voltage** (dark electro 145, wobbled bass, modulates to B major in the bridge).
  - **A track has parts and a form, and that is the whole point.** The first design was one four-bar
    loop whose only variation was layer count; the verdict was "it's just a chorus on repeat", and it
    was right — four bars at 138 BPM is 7 seconds. A track is now parts (`intro` / `verse` / `chorus`
    / `bridge` / `break`) plus a `form` ordering them, ~40 bars before anything returns.
  - **Two independent axes.** The form advances on its own (`nextFormIndex`); the game's intensity
    picks the *stack* (`sectionFor` → `LAYERS`) **and** biases which part comes next by role. Both are
    pure and unit-tested — "does the music go somewhere" is a claim about behaviour, not about taste.
  - `nextFormIndex` is a **single forward scan** for the first part whose role the section accepts,
    stopping one short of a full lap. Two bugs the tests caught, both worth not repeating: scanning a
    *full* lap let a section with one matching part return its own index and **stall**; ranking by
    role instead of taking the first match made a sustained groove **ping-pong between two verses**
    and never reach the bridge or the choruses. Technically moving, musically still a loop.
  - Anti-repetition beyond the form: a riser **and** a crash whenever the *next* part is a chorus, a
    drum fill in the last bar of every part, an octave lift on alternate chorus passes. The ear
    forgives a repeated phrase that arrives differently and never forgives one that arrives
    identically.
  - `Slot` encoding: `0` rest, `-1` **tie** (hold the previous note), `>0` MIDI. Without ties every
    note is exactly one slot long and the result is a sequencer pattern, not a melody. A row may never
    *open* with a tie — it would silently swallow the bar's first slot (tested).
  - `SECTION_AT`: 0 breakdown, 0.2 buildup, 0.3 groove, 0.58 drop. Sections a match visits:
    **breakdown** = round summary, **buildup** = lobby/waiting, **groove** = ordinary play (0.34),
    **drop** = someone on one card or a climbing draw stack. The lobby is a *build-up*, not a
    breakdown — that is the section with the tune and no drums. `intensityOf` returns **0.1 while
    `showRoundSummary`** specifically so the breakdown is reachable; without it the calmest section
    would be dead code.
  - **The lead plays in every section.** Sparse moments get their quietness from the *part* the form
    is on (a `break` part is written sparse), never from muting the melody: an earlier bed gated its
    theme above `intensity > 0.5` while an ordinary turn sits at 0.34, so nobody ever heard a tune.
  - **The bass is deliberately not the reference sketch's bass — the user asked for this by name.**
    The sketch uses `sawtooth` + `lpq(8)` + `shape(.3)` at `gain(.85)`: right for three minutes,
    exhausting across a twenty-minute match (resonant peak where the ear is most sensitive, waveshaper
    filling every gap the arp left). `bassNote` is always a sine sub for weight plus a filtered body,
    never a waveshaper; Neon Horizon keeps the sketch's rhythm exactly (`struct("[~ x x x]*4")`, which
    also keeps it off the kick).
  - Neon Horizon's `chorus` lead is the sketch's, **note for note**, pinned by a test so nobody
    "improves" it by accident. Its bars 3–4 keep **F natural over the C and G chords** — an 11th and a
    dominant colour, his sound, not a transcription slip. What was added around it is what the sketch
    lacked for a long match: a verse, a counter-melody, a Dm→E bridge (the first major V in the
    track) and a break.
  - Arp figures are built from **their own bar's chord** and play in their **written register**. Both
    are tested: a D natural over Voltage's B major was caught this way, and transposing figures `+12`
    once put them above the lead — a busy way to bury the one line the player should follow.
  - `synth()` divides level by unison count, so widening a voice never also makes it louder, and
    implements a real ADSR (attack → decay to sustain → release after the hold) because a
    hold/release approximation loses the pluck.
  - Reverb is **three lowpassed comb delays**, not a convolver: this runs beside card animations on a
    phone, and `latency → smooth animation` outranks "lush". Delay times are **bar fractions computed
    from the tempo** (3/8 lead, 3/16 arp), retuned on every track switch — typed in as seconds, dotted
    delays land between the beats and the groove dies.
  - The pump is stepped on every 16th onto a **pad-only bus** (per the sketch, which puts that gain
    pattern on the pad and leaves the arp flat), as one automated node rather than a gain per note —
    a chord that doesn't breathe together is not a pump.
  - **Output trim is a fixed `0.55` gain node after the duck**, and voice levels are tuned against it.
    Bare, the bed peaked at 0.73 with the music slider at 1 — clipping once effects play over it. A
    `DynamicsCompressor` is the obvious fix and the wrong one: **Chrome applies an internal makeup
    gain**, so the "limiter" came back *louder* (peak 0.81, RMS +45%).
  - **Intensity is slewed at `SLEW_PER_SEC` (per second, not per step).** Game events move it in
    jumps, and applied raw the arrangement would cut from breakdown to drop mid-bar. A per-*step* rate
    was worse than useless: a 16th at 138 BPM is 109ms, so the ramp depended on the tempo and took 14s
    to cross the range — longer than the moment it was reacting to.
  - The section is sampled **at the bar line**: a layer arriving on beat 3 sounds like a bug, the same
    layer on beat 1 sounds intended.
  - **Playback is a shuffled playlist, not a selection.** A track runs
    `form.length × PASSES_PER_TRACK` parts (~2 minutes) and hands over to the next id in a shuffle
    bag; the only human control is `nextTrack()`. `shuffledOrder` deals every track once per bag and
    never opens on the one that just played — pure `Math.random()` repeats about one handover in
    three, which people hear as broken rather than as random. The head swap on collision is a single
    deterministic swap, because re-rolling until the head differs never terminates on a one-track bag.
  - **Two switch timings, deliberately.** The automatic handover waits for a **part boundary** (it
    answers to nothing a person did, so it can land on a phrase); the button swaps on the next **bar
    line**, ≤1.7s, because a press has to feel like it did something. Both go through `dipThrough`: two
    tracks butt-joined still click, since the outgoing reverb, delay repeats and 1.2s pad release get
    cut mid-air. The manual swap is applied **before** `emitStep` reads the track — applying it later
    and returning early swallowed the new track's first sixteenth, which is where its kick, pad and
    first melody note all live.
  - `music.setPartsPerTrack(n)` is a **harness-only seam** (same convention as the server's
    `AFKKickThreshold`): a real track is two minutes, so without it the automatic handover would be
    the one behaviour nothing ever checks.
  - `music.duck(ms)` pulls the bed under the win/lose fanfares through the bed's own output stage,
    so it never touches the user's music volume. Two pieces of music fighting for the same moment
    makes both of them mush, and the fanfare is the one people clip.
- `audio/gameSounds.ts` — **decides**, and plays nothing. `soundsForTransition` is a pure function
  of two store snapshots, which is what makes it a unit test rather than a listening exercise.
- `hooks/appEffects.svelte.ts` — `gameAudio()`, **the only place a game sound is played**. One store
  subscription feeding the list above, instead of audio calls scattered through components: every
  sound stays in one readable list and cannot double-fire. A component calling `playSfx` directly is
  a UI tap (`uiTap`, `uiBack`) and never a game event.
- `<AudioSettings />` sits in the top-right cluster on every screen: three sliders, a **now-playing
  line plus a ⏭ next button** (44px target), and mute. There is deliberately **no picker** — choosing
  from a list means reading three names to make a decision nobody opened the panel to make, whereas
  "not this one" is a judgement you can act on in one tap. Music defaults below effects — it is a bed,
  and a streamer talking over the game must stay louder than it. The current track id is written back
  to `loco_audio` on **every** handover, which is also what re-renders the now-playing line when a
  track ends by itself; `engine.ts` stores it as a **bare string** and never imports the registry,
  because the registry depends on the engine.
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
  checks the properties of the bed that are claims rather than code: **every registered track makes
  sound** (a track is pure data, so a typo in it is silence, not an error), that **the form moves on
  its own** at a fixed intensity (the direct test of "it's just a chorus on repeat" — ≥3 distinct
  parts in 26s, which no four-bar loop can clear), that **the next button changes track** without
  ever repeating back to back and covers the whole bag, that a finished track **hands over
  unattended**, calm-vs-tense energy (≥1.3×), that the sections
  actually move breakdown→drop (a bed can get louder without ever bringing the drums in), that the
  slew reaches its targets, that ducking attenuates, and the **frame cost** of the drop against idle
  (continuous 16th supersaws build a lot of nodes; last measured 16.7ms vs 16.7ms, i.e. free).
  - **Measure over a full loop.** `LOOP_MS` is deliberately several bars long; a shorter window
    samples a random slice of the progression, which is exactly how the first version of this check
    confidently reported ×1.05 for a bed that does change.
  - Deliberately outside CI: audio devices in CI containers are unreliable and a flaky sound
    assertion trains people to ignore red. Run it after touching `sfx.ts`, `music.ts` or `engine.ts`.
- **Strudel was evaluated and rejected**: `@strudel/*` and `superdough` are AGPL-3.0-or-later, and
  bundling them into a network-served client triggers §13 for the whole app. Revisit only if LOCO
  itself becomes AGPL.

