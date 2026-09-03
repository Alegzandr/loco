/**
 * Adaptive music bed — the engine.
 *
 * This file contains no music. Loops are data (`audio/tracks/`) and files under
 * `client/public/music/`; this plays any of them: loading, loop points, the
 * arrangement ladder, the crossfades.
 *
 * ## What replaced the synthesiser, and what had to survive it
 *
 * Every note used to be generated here. A track was parts plus a form, and the
 * engine walked the form, because the version before that was one four-bar loop
 * whose only variation was layer count — the verdict on it was "it's just a
 * chorus on repeat", and it was right.
 *
 * The music is recorded now (Abstraction, CC0 — see `tracks/index.ts`), so the
 * form is gone. The property it defended is not, and it is bought here instead
 * by keeping **more loops than sections**: each loop declares which sections it
 * can carry, and the bed changes loop for three reasons.
 *
 * - **The table moved.** `sectionFor` maps the game's intensity onto a section,
 *   and a section the bed is not currently playing pulls a loop that carries it.
 * - **This one has come round enough times.** At `LAPS_PER_LOOP` the bed hands
 *   over to another loop of the same section, so a table that sits in an
 *   ordinary groove for ten minutes does not sit on one piece of music.
 * - **The player moved.** A scene change — the menu to a match, a match back to
 *   the menu — draws another palette and hands over immediately, without the
 *   holds below, which are about tension and not about where somebody is.
 *
 * Both go through one crossfade. `sectionFor`, `loopsFor`, `nextLoopId` and
 * `shuffledOrder` are pure, exported and unit-tested, because "does the music go
 * somewhere" is a claim about behaviour and not about sound.
 *
 * ## Why the intensity is slewed and the section is held
 *
 * Game events move the intensity in jumps. Applied raw, a Contre-LOCO! that
 * lands and a hand that grows back would crossfade the bed out and straight back
 * in, twice, inside two seconds. So the intensity is **slewed** toward its
 * target at `SLEW_PER_SEC`, and a section derived from it has to **hold** for
 * `SECTION_HOLD_MS` before the bed acts on it. The two together mean a spike
 * that is immediately undone is never heard, and a real change arrives about a
 * second and a half later, which reads as the music answering rather than
 * twitching.
 */
import { audio } from './engine'
import { DEFAULT_LOOP_ID, getLoop, LOOPS, MUSIC_BASE } from './tracks'
import type { LoopDef } from './tracks/types'

export type MusicScene = 'lobby' | 'game' | 'off'

/** How often the bed re-reads where the table is, in ms. */
const TICK_MS = 250

/** Arrangement stacks, in the order intensity unlocks them. */
export type Section = 'breakdown' | 'buildup' | 'groove' | 'drop'

/** Every section, in ladder order. Exported so a test cannot fall behind it. */
export const SECTIONS: Section[] = ['breakdown', 'buildup', 'groove', 'drop']

/** Intensity at or above which each section plays. Ordered, ascending. */
export const SECTION_AT: Record<Section, number> = {
  breakdown: 0,
  buildup: 0.2,
  groove: 0.3,
  drop: 0.58,
}

/**
 * Which section a given intensity plays.
 *
 * Pure and exported because it is the whole contract between game state and what
 * the room hears — a test can assert it without an AudioContext.
 */
export function sectionFor(intensity: number, lobby = false): Section {
  // The lobby is a build-up, not a breakdown: people are reading names and
  // pressing buttons, and a build-up is the section with a tune and no weight
  // behind it.
  if (lobby) return 'buildup'
  if (intensity >= SECTION_AT.drop) return 'drop'
  if (intensity >= SECTION_AT.groove) return 'groove'
  if (intensity >= SECTION_AT.buildup) return 'buildup'
  return 'breakdown'
}

/**
 * The palettes the registry is split into. A match is played inside one.
 *
 * Every loop in the bed was chosen to fit a card game, and none of them fits
 * the one before it: the groove alone held jazz, funk, a drum-and-bass sketch
 * and an ambient piece, and the bag dealt them in any order, so a loop change
 * — which happens on every section move and every second lap — was heard as
 * the genre changing rather than the piece. A family is the loops that share a
 * palette, named for the room they would play in, and `nextLoopId` never leaves
 * the one the match opened on while it carries the section asked for.
 */
export type Family = 'lounge' | 'party' | 'night'

/** Every family. Exported so a test cannot fall behind it. */
export const FAMILIES: Family[] = ['lounge', 'party', 'night']

/**
 * The loops that can carry a section, in registry order — inside `family`
 * when one is given and it has anything to offer, the whole registry otherwise.
 * The fallback is what keeps a thin family from going silent; `music.test.ts`
 * pins that no family is that thin, so in practice it is never taken.
 */
export function loopsFor(section: Section, family?: Family): LoopDef[] {
  const all = LOOPS.filter((l) => l.sections.includes(section))
  if (!family) return all
  const own = all.filter((l) => l.family === family)
  return own.length > 0 ? own : all
}

/**
 * Intensity units per second. A full swing takes ~1.8s, so the bed answers a
 * change rather than tracking it.
 */
export const SLEW_PER_SEC = 0.55

/**
 * How long a newly derived section must hold before the bed changes loop.
 *
 * Under the slew this is nearly always already satisfied by the time a real
 * change arrives; it exists for the value that parks on a threshold, where the
 * slew alone would let rounding chatter the bed between two loops.
 */
export const SECTION_HOLD_MS = 1200

/**
 * How long a *fall* in tension must hold before the bed steps down the ladder.
 *
 * Rising tension is answered on `SECTION_HOLD_MS`: somebody reaching their last
 * card is the moment the drop exists for. Falling is not symmetrical. In an
 * endgame a hand goes 1 -> 3 -> 2 -> 1 every few turns, and each dip under the
 * threshold was a crossfade out of the drop, followed by one back in, so a
 * tense table heard a different piece every ten seconds. The dip is not the
 * table calming down (the round is not over until somebody goes out), so the
 * bed waits this long, continuously below the threshold, before it believes
 * it. Every return above the line restarts the wait.
 *
 * The breakdown is exempt: `intensityOf` only reaches it on the round summary,
 * which is a stop and not a dip, and the section the ending should sound like.
 */
export const SECTION_RELEASE_MS = 12000

/**
 * How long `to` must hold before the bed leaves `from` for it. Pure and
 * exported so the asymmetry is pinned by a test and not by a listening session.
 */
export function sectionHoldMs(from: Section, to: Section): number {
  const falling = SECTIONS.indexOf(to) < SECTIONS.indexOf(from)
  return falling && to !== 'breakdown' ? SECTION_RELEASE_MS : SECTION_HOLD_MS
}

/**
 * Where a loop that was parked `elapsed` seconds into its run resumes from:
 * the same bar, on the same lap count. `elapsed` is the whole run, laps
 * included, so `getLaps` carries on counting across the pause.
 */
export function resumeOffset(elapsed: number, seconds: number): number {
  if (!(seconds > 0) || !(elapsed > 0)) return 0
  return elapsed % seconds
}

/** Fade-in, in seconds, when a parked loop comes back mid-bar. */
export const RESUME_FADE_S = 0.4

/**
 * How many times a loop comes round before the bed hands over to another one
 * carrying the same section.
 *
 * Two, and it was three. Three turns of a 44s loop is 2m10 of the same piece,
 * and the first verdict on the recorded bed was that it repeats — which it did,
 * from both ends at once: a groove carried by three loops, each held for over
 * two minutes. Both halves are fixed, and this is the half that matters on a
 * table whose tension never changes, because it is the only thing that moves
 * the music there at all.
 *
 * It cannot go to one: a piece heard exactly once is a piece nobody recognises,
 * and the bed would read as a shuffle rather than as music somebody chose.
 */
export const LAPS_PER_LOOP = 2

/** Crossfade length, in seconds, for every loop change. */
export const CROSSFADE_S = 2

/**
 * How many loops the bed warms ahead of needing them.
 *
 * Three, and it is small on purpose, because **a cold change is already
 * inaudible**: `swapTo` loads the incoming buffer *before* it touches the
 * outgoing voice, so a loop that is not cached costs a slightly later crossfade
 * and never a gap. Warming exists to make that delay shorter, not to make the
 * change possible, which is why it does not need to cover the registry.
 *
 * The warm-up used to walk the whole list. That was right at six loops and five
 * megabytes and wrong at eighteen: see `CACHE_BUDGET_BYTES` for what it actually
 * cost, which is not the download.
 */
export const PREFETCH_MAX = 3

/**
 * Ceiling on decoded audio held in memory, in bytes.
 *
 * **This is the number that matters, and it is not the file size.** An
 * `AudioBuffer` is deinterleaved 32-bit float at the context's sample rate, so
 * a 1.5 MB MP3 of 102 seconds decodes to **37 MB** of RAM — measured, not
 * estimated. Eighteen of them is 418 MB, and the worst six is 191 MB, which is
 * what an unevicted cache was quietly holding on a phone by the time a table had
 * been through all four sections.
 *
 * 64 MB is about three loops. Evicting is close to free: the MP3 stays in the
 * browser's HTTP cache (nginx serves `/music/` with a week), so what a re-entry
 * costs is one `decodeAudioData`, measured at 72–208 ms — and that lands inside
 * the window the outgoing voice is still covering.
 */
export const CACHE_BUDGET_BYTES = 64 * 1024 * 1024

/**
 * A shuffle bag: every id exactly once, in a random order that does not open on
 * `avoid`.
 *
 * Not `Math.random()` per pick. Pure random repeats — with two loops carrying a
 * section, half of all handovers would replay the loop that just finished, which
 * people hear as "it's broken", not as "that's what random means".
 */
export function shuffledOrder(ids: string[], avoid: string | null, rand: () => number): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1)) % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  // One deterministic swap rather than a reshuffle loop: re-rolling until the
  // head differs can, with one id in the bag, never terminate.
  if (out.length > 1 && out[0] === avoid) [out[0], out[1]] = [out[1], out[0]]
  return out
}

/**
 * Which loop plays next for `section`, given the one playing now.
 *
 * Never returns `current` while the section has something else to offer, which
 * is what makes both reasons for changing loop actually change it: a handover
 * that returned the same id would restart the piece from the top instead, and a
 * section change that did so would be an audible seam in service of nothing.
 * Falls back to `current` rather than to silence when the section is carried by
 * one loop alone — a registry that thin is a failure `music.test.ts` catches
 * before this is ever reached.
 */
export function nextLoopId(
  section: Section,
  current: string | null,
  bag: string[],
  rand: () => number,
  family?: Family,
): { id: string; bag: string[] } {
  const ids = loopsFor(section, family).map((l) => l.id)
  if (ids.length === 0) return { id: current ?? DEFAULT_LOOP_ID, bag }
  let rest = bag.filter((id) => ids.includes(id))
  if (rest.length === 0) rest = shuffledOrder(ids, current, rand)
  if (rest.length > 1 && rest[0] === current) rest = rest.slice(1).concat(rest[0])
  const [id, ...tail] = rest
  return { id, bag: tail }
}

/**
 * Which family the next scene is played in: any of them for a fresh bed, and
 * never the one just left when the scene moves — a match that opened on the
 * lounge and went back to the waiting room hears the party there, so the
 * evening tours the palettes the way a section tours its loops.
 */
export function nextFamily(current: Family | null, rand: () => number): Family {
  const pool = FAMILIES.filter((f) => f !== current)
  return pool[Math.floor(rand() * pool.length) % pool.length]
}

/** One loop that is sounding, or fading out. */
interface Voice {
  id: string
  src: AudioBufferSourceNode
  gain: GainNode
  /** Context time the source was started at. */
  startedAt: number
  /** Seconds into the loop it was started at. */
  offset: number
  seconds: number
}

/** A decoded file plus the loop points measured on it. */
interface Decoded {
  buffer: AudioBuffer
  loopStart: number
  loopEnd: number
  /** What holding it costs, for the eviction budget. */
  bytes: number
  /** Monotonic stamp of the last use, for least-recently-used eviction. */
  usedAt: number
}

/**
 * An equal-power crossfade curve.
 *
 * A linear ramp on both sides sums to a dip in the middle for material that is
 * not correlated, and two different pieces of music never are: the bed audibly
 * ducks halfway through every change. Cosine/sine holds the sum flat.
 */
function fadeCurve(up: boolean, points = 33): Float32Array {
  const c = new Float32Array(points)
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * (Math.PI / 2)
    c[i] = up ? Math.sin(x) : Math.cos(x)
  }
  return c
}

class MusicBed {
  private timer: ReturnType<typeof setInterval> | null = null
  private out: GainNode | null = null
  /** The tab is hidden. Sources are stopped and the scene is kept. */
  private hidden = false
  /**
   * What was sounding when the tab went away, so coming back resumes it
   * rather than drawing another loop: the scene it was playing for, the loop,
   * and how far into its run it was. See `setHidden`.
   */
  private parked: { scene: MusicScene; id: string; elapsed: number } | null = null
  /** Seconds into the loop the next swap starts at. Consumed by `runSwaps`. */
  private desiredOffset = 0
  /**
   * A loop chosen while the bed was stopped (⏭ on a screen with no music),
   * honoured by the next `start()` instead of the bag's own pick.
   */
  private chosen: string | null = null
  /** Decoded files, by id. One fetch per tab. */
  private cache = new Map<string, Decoded>()
  /** In-flight loads, so two ticks never fetch the same file twice. */
  private loading = new Map<string, Promise<Decoded | null>>()

  /** The loop that owns the bed. Fading-out voices are in `retiring`. */
  private voice: Voice | null = null
  private retiring: Voice[] = []

  private loop: LoopDef = getLoop(DEFAULT_LOOP_ID)
  /** Remaining ids in the current shuffle bag. */
  private bag: string[] = []
  /** Where the game wants the intensity. */
  private target = 0.35
  /** Where the bed actually is — slewed toward the target, never jumped. */
  private currentIntensity = 0.35
  /** The section the bed is playing for. */
  private section: Section = 'groove'
  /**
   * The palette this scene is played in. Drawn by `start()`, and drawn again,
   * away from the current one, when the scene changes under a running bed —
   * lobby to table, table back to the waiting room — which is the one moment a
   * change of palette lands on a change the bed was making anyway.
   */
  private family: Family = 'lounge'
  /** A different section, and since when (ms epoch). See SECTION_HOLD_MS. */
  private pendingSection: Section | null = null
  private pendingSince = 0
  private scene: MusicScene = 'off'
  /** Wall-clock of the last slew, for a frame-rate-independent ramp. */
  private lastSlewAt = 0
  /** Deterministic variation, seeded from the clock once per `start()`. */
  private seed = 1
  /** A change is in flight. A request arriving during one lands in `desired`. */
  private swapping = false
  /**
   * The loop the bed has been asked for but has not started yet.
   *
   * A request used to be dropped when one was already in flight, and it had
   * already written itself into `this.loop` on the way past — so the panel named
   * a piece that would never play, and the handover logic then treated that name
   * as the one to avoid. Recording it here instead means the swap that is
   * running finishes and immediately picks up whatever the table asked for while
   * it was busy.
   */
  private desired: LoopDef | null = null
  /** Ticks upward on every use, so eviction can rank without a clock. */
  private useClock = 0
  /** Harness-only shortening of a lap. See `setLapSeconds`. */
  private lapOverride: number | null = null

  private rand(): number {
    // xorshift — cheap, dependency-free, and repeatable enough to debug.
    this.seed ^= this.seed << 13
    this.seed ^= this.seed >>> 17
    this.seed ^= this.seed << 5
    return Math.abs(this.seed % 1000) / 1000
  }

  isPlaying(): boolean {
    return this.timer !== null
  }

  getScene(): MusicScene {
    return this.scene
  }

  /** Current slewed intensity. Exposed for the verification harness. */
  getIntensity(): number {
    return this.currentIntensity
  }

  /** Section currently playing. Exposed for the verification harness. */
  getSection(): Section {
    return this.section
  }

  /** Family the scene is played in. Exposed for the verification harness. */
  getFamily(): Family {
    return this.family
  }

  /**
   * Loop currently playing. Exposed for the panel and the harness.
   *
   * The sounding voice is the authority, not `this.loop`: between a request and
   * its crossfade there is a load, and during it the honest answer to "what is
   * playing" is still the outgoing piece.
   */
  getLoopId(): string {
    return this.voice?.id ?? this.loop.id
  }

  /** How many times the current loop has come round. Harness only. */
  getLaps(): number {
    const v = this.voice
    const ctx = audio.context()
    if (!v || !ctx) return 0
    const lap = this.lapOverride ?? v.seconds
    return Math.floor((ctx.currentTime - v.startedAt + v.offset) / lap)
  }

  /**
   * Shortens a lap, for the verification harness only.
   *
   * A real loop is 44 to 102 seconds and hands over after three of them, so the
   * unattended handover — the only thing that moves the music on a table whose
   * tension never changes — would be the one behaviour here that nothing ever
   * checks. Same test seam the server uses for `AFKKickThreshold`; pass `null`
   * to restore. It moves the handover decision alone and never the loop points,
   * so what the harness hears is still the music playing properly.
   */
  setLapSeconds(seconds: number | null): void {
    this.lapOverride = seconds
  }

  setIntensity(value: number): void {
    this.target = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))
  }

  /**
   * Skips to another loop that carries the section currently playing.
   *
   * This is the only way a person changes the music: there is no picker.
   * Choosing from a list means reading six names to make a decision nobody
   * opened the panel to make, whereas "not this one" is a judgement you can act
   * on in one tap.
   */
  nextTrack(): void {
    const { id, bag } = nextLoopId(this.section, this.loop.id, this.bag, () => this.rand(), this.family)
    this.bag = bag
    this.setLoop(id)
  }

  /**
   * Switches loop, persisting the choice. Used by `nextTrack`, by the section
   * change and by the verification harness.
   */
  setLoop(id: string): void {
    const next = getLoop(id)
    if (!this.isPlaying()) {
      // Stopped, the choice used to be overwritten by `start()`'s own pick from
      // a fresh bag: the label changed and the deal played something else.
      this.chosen = next.id
      this.loop = next
      audio.setSettings({ track: next.id })
      return
    }
    if (next.id === this.getLoopId()) return
    // Recorded, never applied here. `this.loop` and the persisted setting move
    // when the piece actually starts, so nothing downstream ever names a loop
    // the room cannot hear.
    this.desired = next
    void this.runSwaps()
  }

  /**
   * Drains `desired` until what is sounding is what was last asked for.
   *
   * A loop rather than a single swap because a load takes time and the table
   * does not wait: a section change during a cold fetch used to be dropped on
   * the floor by a `swapping` guard that returned without recording anything.
   */
  private async runSwaps(): Promise<void> {
    if (this.swapping) return
    this.swapping = true
    try {
      while (this.desired && this.isPlaying()) {
        const next = this.desired
        this.desired = null
        const offset = this.desiredOffset
        this.desiredOffset = 0
        if (next.id === this.voice?.id) continue
        await this.swapTo(next, CROSSFADE_S, offset)
      }
    } finally {
      this.swapping = false
    }
  }

  /**
   * Own output stage, between the voices and the music bus, so the bed can be
   * ducked without touching the user's music volume.
   */
  private output(): GainNode | null {
    const ctx = audio.context()
    const bus = audio.musicDestination()
    if (!ctx || !bus) return null
    if (!this.out) {
      this.out = ctx.createGain()
      this.out.gain.value = 1
      // Fixed output trim, downstream of the duck so `duck()` can keep treating
      // 1 as nominal on `out.gain`. The files are mastered to −18 LUFS with
      // peaks under −2 dBTP, so this is headroom for the effects that play over
      // them rather than a correction of the material.
      const trim = ctx.createGain()
      trim.gain.value = 0.55
      this.out.connect(trim)
      trim.connect(bus)
    }
    return this.out
  }

  /**
   * Fetches and decodes a loop, once per tab.
   *
   * The loop points are measured here rather than trusted from the file. MP3
   * carries encoder delay at the head and padding at the tail, both of which
   * survive `decodeAudioData`, so a buffer looped on its own length inserts the
   * gap the pack's README warns about. Finding the first audible sample and
   * adding the source file's exact duration puts the seam back where the
   * composer cut it.
   */
  private async load(id: string): Promise<Decoded | null> {
    const hit = this.cache.get(id)
    if (hit) {
      hit.usedAt = ++this.useClock
      return hit
    }
    const pending = this.loading.get(id)
    if (pending) return pending

    const job = (async (): Promise<Decoded | null> => {
      const ctx = audio.context()
      if (!ctx) return null
      try {
        const res = await fetch(`${MUSIC_BASE}/${id}.mp3`)
        if (!res.ok) return null
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer())
        const def = getLoop(id)
        const data = buffer.getChannelData(0)
        let head = 0
        while (head < data.length && Math.abs(data[head]) < 0.0015) head++
        const loopStart = head / buffer.sampleRate
        const decoded: Decoded = {
          buffer,
          loopStart,
          loopEnd: Math.min(loopStart + def.seconds, buffer.duration),
          bytes: buffer.length * buffer.numberOfChannels * 4,
          usedAt: ++this.useClock,
        }
        this.cache.set(id, decoded)
        this.evict()
        return decoded
      } catch {
        // A bed that will not load is a quiet game, never a broken one: the
        // caller keeps whatever is already sounding.
        return null
      } finally {
        this.loading.delete(id)
      }
    })()
    this.loading.set(id, job)
    return job
  }

  /**
   * Drops least-recently-used buffers until the cache is inside its budget.
   *
   * Never the loop that is sounding and never one still fading out: evicting a
   * `Decoded` does not stop the `AudioBufferSourceNode` already reading it, but
   * it does mean the next reference re-decodes something the room can hear, and
   * the two buffers would then coexist — spending memory to save memory.
   */
  private evict(): void {
    const live = new Set([this.voice?.id, ...this.retiring.map((v) => v.id)])
    let total = 0
    for (const d of this.cache.values()) total += d.bytes
    if (total <= CACHE_BUDGET_BYTES) return
    const order = [...this.cache.entries()]
      .filter(([id]) => !live.has(id))
      .sort((a, b) => a[1].usedAt - b[1].usedAt)
    for (const [id, d] of order) {
      if (total <= CACHE_BUDGET_BYTES) return
      this.cache.delete(id)
      total -= d.bytes
    }
  }

  /** What the decoded cache is holding right now, in bytes. Harness only. */
  getCacheBytes(): number {
    let total = 0
    for (const d of this.cache.values()) total += d.bytes
    return total
  }

  /**
   * Warms the registry after the first loop is sounding.
   *
   * A section change that had to wait on a fetch would arrive late at exactly
   * the moment the bed exists to answer — somebody reaching one card. One file
   * at a time, so the warm-up never competes with the page it is running under.
   *
   * Ordered and bounded. The section the table is in comes first, because that
   * is where the next handover will be; then the sections on either side,
   * because that is where the table will go next. It stops at `PREFETCH_MAX`
   * and is **called again on every section change**, so the working set follows
   * the table instead of being decided once at the deal.
   *
   * It is deliberately smaller than the ladder is wide. Warming more only ever
   * fed `evict`, which would then drop what the warm-up had just decoded — three
   * fetches and three decodes spent to hold the same three buffers. The bound
   * here and `CACHE_BUDGET_BYTES` have to stay in the same order of magnitude
   * for that reason, and `music.test.ts` pins the relation.
   */
  private async prefetch(): Promise<void> {
    const here = SECTIONS.indexOf(this.section)
    // The working set is the family's: what the bed will hand over to is inside
    // it, and warming a loop of another palette is a decode spent on a piece
    // this scene will never play.
    const own = LOOPS.filter((l) => l.family === this.family)
    const order = (own.length > 0 ? own : [...LOOPS])
      .sort((a, b) => this.distance(a, here) - this.distance(b, here))
      .slice(0, PREFETCH_MAX)
    for (const l of order) {
      if (!this.isPlaying()) return
      if (!this.cache.has(l.id)) await this.load(l.id)
    }
  }

  /** How many rungs of the ladder away from `here` a loop's nearest section is. */
  private distance(loop: LoopDef, here: number): number {
    return Math.min(...loop.sections.map((s) => Math.abs(SECTIONS.indexOf(s) - here)))
  }

  /** Starts `def` under a fade-in, retiring whatever is sounding. */
  private async swapTo(def: LoopDef, fade = CROSSFADE_S, offset = 0): Promise<void> {
    {
      const ctx = audio.context()
      const out = this.output()
      if (!ctx || !out) return
      const decoded = await this.load(def.id)
      // Nothing to swap to: keep what is playing rather than going silent. The
      // panel is unaffected either way, since `this.loop` only moves on commit.
      if (!decoded || !this.isPlaying()) return

      const at = ctx.currentTime
      const src = ctx.createBufferSource()
      src.buffer = decoded.buffer
      src.loop = true
      src.loopStart = decoded.loopStart
      src.loopEnd = decoded.loopEnd
      const gain = ctx.createGain()
      const seconds = decoded.loopEnd - decoded.loopStart
      const into = resumeOffset(offset, seconds)
      const cross = this.voice !== null && fade > 0
      // A crossfade over the outgoing voice, or a short fade when a parked loop
      // comes back mid-bar: a hard cut into the middle of a phrase is the one
      // thing a resume must not sound like.
      const fadeIn = cross ? fade : into > 0 ? RESUME_FADE_S : 0
      gain.gain.value = fadeIn > 0 ? 0 : 1
      if (fadeIn > 0) gain.gain.setValueCurveAtTime(fadeCurve(true), at, fadeIn)
      src.connect(gain)
      gain.connect(out)
      src.start(at, decoded.loopStart + into)

      if (this.voice) this.retire(this.voice, at, fade)
      this.voice = {
        id: def.id,
        src,
        gain,
        startedAt: at,
        offset,
        seconds,
      }
      // The commit. Everything a player can see or hear moves here and nowhere
      // earlier: the piece is sounding, so the panel and the stored preference
      // are now telling the truth.
      this.loop = def
      audio.setSettings({ track: def.id })
    }
  }

  /**
   * Fades a voice out and stops it.
   *
   * Note what this does *not* touch: `out.gain`, which belongs to `duck()`. The
   * synthesised bed covered a track change with a dip on that node, and a change
   * landing under a fanfare cancelled the duck's own return with it. A crossfade
   * between two source gains cannot have that argument.
   */
  private retire(v: Voice, at: number, fade: number): void {
    v.gain.gain.cancelScheduledValues(at)
    if (fade > 0) v.gain.gain.setValueCurveAtTime(fadeCurve(false), at, fade)
    else v.gain.gain.setValueAtTime(0, at)
    try {
      v.src.stop(at + fade + 0.05)
    } catch {
      // Already stopped. Nothing to do, and nothing worth reporting.
    }
    this.retiring.push(v)
    const done = () => {
      this.retiring = this.retiring.filter((x) => x !== v)
      try {
        v.gain.disconnect()
      } catch {
        // The graph is already gone.
      }
    }
    v.src.onended = done
  }

  private stopVoices(): void {
    for (const v of [this.voice, ...this.retiring]) {
      if (!v) continue
      try {
        v.src.stop()
      } catch {
        // Already stopped.
      }
      try {
        v.gain.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.voice = null
    this.retiring = []
  }

  /**
   * Pulls the bed down for `ms`, then brings it back.
   *
   * Used under the win/lose fanfares: two pieces of music competing for the same
   * moment makes both of them mush, and the fanfare is the one that matters.
   *
   * It owns `out.gain` outright and needs no bookkeeping to defend it. The
   * synthesised bed had to remember when a duck would end, because it covered a
   * track change with a dip on this same node and the dip's
   * `cancelScheduledValues` took the duck's return with it — the bed came back
   * to full under the one sound people clip. A loop change is a crossfade
   * between two source gains and never touches this node at all.
   */
  duck(ms = 2200, amount = 0.22): void {
    const ctx = audio.context()
    const out = this.output()
    if (!ctx || !out) return
    const t = ctx.currentTime
    out.gain.cancelScheduledValues(t)
    out.gain.setValueAtTime(out.gain.value, t)
    out.gain.linearRampToValueAtTime(amount, t + 0.12)
    out.gain.setValueAtTime(amount, t + ms / 1000)
    out.gain.linearRampToValueAtTime(1, t + ms / 1000 + 0.5)
  }

  /**
   * Tells the bed whether the tab is hidden. Hidden stops the sources and keeps
   * the scene; visible again **resumes the same loop from the same bar**.
   *
   * A page that plays audio is exempt from timer throttling, so a backgrounded
   * table would otherwise go on playing out loud from behind another window.
   *
   * Coming back used to go through `start()`, which reseeds the shuffle, empties
   * the bag and draws a loop, so every alt-tab was a different piece of music,
   * and on desktop that is every glance at another window. The pause is a
   * pause: what was sounding is parked with its position, and comes back where
   * it was, lap count included, unless the scene itself moved while the tab was
   * away.
   */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    if (hidden) {
      this.parked = this.park()
      this.clearTimer()
      this.stopVoices()
      return
    }
    const parked = this.parked
    this.parked = null
    if (this.scene === 'off') return
    if (parked && parked.scene === this.scene) this.resume(parked)
    else this.start(this.scene)
  }

  /** The sounding loop and how far into its run it is, or null when silent. */
  private park(): { scene: MusicScene; id: string; elapsed: number } | null {
    const v = this.voice
    const ctx = audio.context()
    if (!v || !ctx || this.scene === 'off') return null
    return { scene: this.scene, id: v.id, elapsed: ctx.currentTime - v.startedAt + v.offset }
  }

  /**
   * Brings a parked loop back at its position. The scheduler and the section
   * are left as they were: if the table moved while the tab was away, the tick
   * answers it through the ordinary hold, like any other change.
   */
  private resume(parked: { id: string; elapsed: number }): void {
    if (!audio.isReady() || audio.getSettings().muted || this.timer) return
    this.lastSlewAt = Date.now()
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.desired = getLoop(parked.id)
    this.desiredOffset = parked.elapsed
    void this.runSwaps().then(() => this.prefetch())
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  start(scene: MusicScene): void {
    const moved = this.scene !== scene
    this.scene = scene
    if (scene === 'off') {
      this.stop()
      return
    }
    // A running bed whose scene moved draws another palette and hands over on
    // the spot.
    //
    // It cannot be left to the tick, and that was the bug: `sectionHoldMs`
    // makes a *fall* wait twelve seconds, and the fall it was written for is a
    // hand dipping to three cards mid-round — not somebody standing up from
    // the table. A match started, quit and started again inside that window
    // never crossed a hold at all, so the menu, the second deal and everything
    // between them were one unbroken piece of music. A scene move is the table
    // moving: it is a fact about where the player is, not a reading of how
    // tense the round is, so it is answered immediately and the slew is
    // snapped with it.
    if (moved && this.timer) {
      this.family = nextFamily(this.family, () => this.rand())
      this.bag = []
      this.currentIntensity = this.target
      this.lastSlewAt = Date.now()
      this.pendingSection = null
      this.section = sectionFor(this.currentIntensity, scene === 'lobby')
      const { id, bag } = nextLoopId(
        this.section,
        this.getLoopId(),
        this.bag,
        () => this.rand(),
        this.family,
      )
      this.bag = bag
      this.setLoop(id)
      void this.prefetch()
    }
    // Muted opens nothing: no fetch, no decode, no scheduler in service of
    // silence. Unmuting is itself a gesture and starts the bed on the spot.
    if (!audio.isReady() || audio.getSettings().muted || this.timer || this.hidden) return
    // Seed the shuffle from the clock, once. The generator is otherwise
    // deterministic — fine for debugging, useless for "play them in a random
    // order", which would hand every session the same order forever.
    this.seed = (Date.now() & 0x7fffffff) | 1
    this.parked = null
    this.desiredOffset = 0
    this.family = nextFamily(null, () => this.rand())
    // A bed opening from silence has nothing to slew from: what the screen it
    // opens on asks for is true right away. Left slewing, a game opened after a
    // stop carried the last match's tension into its own first bar.
    this.currentIntensity = this.target
    this.section = sectionFor(this.currentIntensity, scene === 'lobby')
    this.bag = []
    this.lastSlewAt = Date.now()
    this.timer = setInterval(() => this.tick(), TICK_MS)

    // A loop chosen with ⏭ while the bed was off is what plays, and it is then
    // spent; otherwise the bag picks one that carries the opening section.
    let id = this.chosen
    this.chosen = null
    if (!id || !getLoop(id).sections.includes(this.section)) {
      const pick = nextLoopId(this.section, null, this.bag, () => this.rand(), this.family)
      this.bag = pick.bag
      id = pick.id
    } else {
      // The press chose a piece, and with it the palette the scene opens in.
      this.family = getLoop(id).family
    }
    // Through the same door as every other change, so the tick that fires 250ms
    // from now cannot start a second voice on top of this one's load.
    this.desired = getLoop(id)
    void this.runSwaps().then(() => this.prefetch())
  }

  stop(): void {
    this.clearTimer()
    this.stopVoices()
    this.desired = null
    this.desiredOffset = 0
    this.parked = null
    this.scene = 'off'
  }

  /**
   * One pass: slew the intensity, decide whether the section has really moved,
   * and hand over a loop that has come round enough times.
   *
   * "Really moved" is asymmetric (`sectionHoldMs`): a rise is answered in about
   * a bar, a fall has to hold for `SECTION_RELEASE_MS`, and every return above
   * the line restarts that wait: `pendingSince` is reset whenever `wanted`
   * changes, so a hand dipping to three cards and back never gets the bed out
   * of the drop.
   */
  private tick(): void {
    if (!audio.isReady() || audio.getSettings().muted) return
    const ctx = audio.context()
    if (!ctx) return

    const now = Date.now()
    const dt = Math.min(1, Math.max(0, (now - this.lastSlewAt) / 1000))
    this.lastSlewAt = now
    const step = SLEW_PER_SEC * dt
    const delta = this.target - this.currentIntensity
    this.currentIntensity += Math.abs(delta) <= step ? delta : Math.sign(delta) * step

    const wanted = sectionFor(this.currentIntensity, this.scene === 'lobby')
    if (wanted === this.section) {
      this.pendingSection = null
    } else if (this.pendingSection !== wanted) {
      this.pendingSection = wanted
      this.pendingSince = now
    } else if (now - this.pendingSince >= sectionHoldMs(this.section, wanted)) {
      this.pendingSection = null
      this.section = wanted
      const { id, bag } = nextLoopId(wanted, this.loop.id, this.bag, () => this.rand(), this.family)
      this.bag = bag
      this.setLoop(id)
      // The working set follows the table. Cheap and idempotent: everything it
      // already holds is a cache hit, and the sort now starts from here.
      void this.prefetch()
      return
    }

    // Nothing is sounding and nothing is on its way: the opening load failed, or
    // the decode did. Ask again rather than leaving the table silent until the
    // next section change, which on a long round is minutes away and on a solo
    // game may never come.
    if (!this.voice && !this.desired && !this.swapping) {
      const { id, bag } = nextLoopId(this.section, null, this.bag, () => this.rand(), this.family)
      this.bag = bag
      this.desired = getLoop(id)
      void this.runSwaps()
      return
    }

    // The table has not moved. What moves the music is the loop having come
    // round enough times — the only thing that does, on a table whose tension
    // holds still for ten minutes.
    if (this.voice && this.getLaps() >= LAPS_PER_LOOP && loopsFor(this.section, this.family).length > 1) {
      const { id, bag } = nextLoopId(this.section, this.loop.id, this.bag, () => this.rand(), this.family)
      this.bag = bag
      this.setLoop(id)
    }
  }
}

export const music = new MusicBed()
export { LOOPS, getLoop, DEFAULT_LOOP_ID, MUSIC_BASE }
