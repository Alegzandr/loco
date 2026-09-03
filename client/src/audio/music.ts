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
 * can carry, and the bed changes loop for two reasons.
 *
 * - **The table moved.** `sectionFor` maps the game's intensity onto a section,
 *   and a section the bed is not currently playing pulls a loop that carries it.
 * - **This one has come round enough times.** At `LAPS_PER_LOOP` the bed hands
 *   over to another loop of the same section, so a table that sits in an
 *   ordinary groove for ten minutes does not sit on one piece of music.
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

/** The loops that can carry a section, in registry order. */
export function loopsFor(section: Section): LoopDef[] {
  return LOOPS.filter((l) => l.sections.includes(section))
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
 * How many loops the bed keeps warm, out of a registry of eighteen.
 *
 * The warm-up used to walk the whole list, which was right at six loops and
 * five megabytes and is wrong at eighteen and eighteen: a player who sits at one
 * table would pull the entire library in the background for music most of which
 * their match never reaches. Six is a working set — the section playing and its
 * neighbours, which `prefetch` orders by `distance` — and it is re-warmed from
 * wherever the table has moved to, so what is near is always what is cached.
 * Everything else loads on demand, which the section hold and the crossfade give
 * about three seconds of warning for.
 */
export const PREFETCH_MAX = 6

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
): { id: string; bag: string[] } {
  const ids = loopsFor(section).map((l) => l.id)
  if (ids.length === 0) return { id: current ?? DEFAULT_LOOP_ID, bag }
  let rest = bag.filter((id) => ids.includes(id))
  if (rest.length === 0) rest = shuffledOrder(ids, current, rand)
  if (rest.length > 1 && rest[0] === current) rest = rest.slice(1).concat(rest[0])
  const [id, ...tail] = rest
  return { id, bag: tail }
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
  /** A different section, and since when (ms epoch). See SECTION_HOLD_MS. */
  private pendingSection: Section | null = null
  private pendingSince = 0
  private scene: MusicScene = 'off'
  /** Wall-clock of the last slew, for a frame-rate-independent ramp. */
  private lastSlewAt = 0
  /** Deterministic variation, seeded from the clock once per `start()`. */
  private seed = 1
  /** A change is in flight; the tick does not start a second one over it. */
  private swapping = false
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

  /** Loop currently playing. Exposed for the panel and the harness. */
  getLoopId(): string {
    return this.loop.id
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
    const { id, bag } = nextLoopId(this.section, this.loop.id, this.bag, () => this.rand())
    this.bag = bag
    this.setLoop(id)
  }

  /**
   * Switches loop, persisting the choice. Used by `nextTrack`, by the section
   * change and by the verification harness.
   */
  setLoop(id: string): void {
    const next = getLoop(id)
    audio.setSettings({ track: next.id })
    if (!this.isPlaying()) {
      // Stopped, the choice used to be overwritten by `start()`'s own pick from
      // a fresh bag: the label changed and the deal played something else.
      this.chosen = next.id
      this.loop = next
      return
    }
    if (next.id === this.loop.id) return
    this.loop = next
    void this.swapTo(next)
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
    if (hit) return hit
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
        }
        this.cache.set(id, decoded)
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
   * Warms the registry after the first loop is sounding.
   *
   * A section change that had to wait on a fetch would arrive late at exactly
   * the moment the bed exists to answer — somebody reaching one card. One file
   * at a time, so the warm-up never competes with the page it is running under.
   *
   * Ordered and bounded, and both are the point at eighteen loops and eighteen
   * megabytes. The section the table is in comes first, because that is where
   * the next handover will be; then the sections on either side, because that is
   * where the table will go next. It stops at `PREFETCH_MAX` rather than walking
   * the registry, and it is **called again on every section change**, so the
   * working set follows the table instead of being decided once at the deal.
   *
   * Already-cached loops count toward the budget: a bed that has been through
   * three sections has most of what it needs, and the point is a ceiling on what
   * is held, not a quota of fetches to keep issuing.
   */
  private async prefetch(): Promise<void> {
    const here = SECTIONS.indexOf(this.section)
    const order = [...LOOPS]
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
  private async swapTo(def: LoopDef, fade = CROSSFADE_S): Promise<void> {
    if (this.swapping) return
    this.swapping = true
    try {
      const ctx = audio.context()
      const out = this.output()
      if (!ctx || !out) return
      const decoded = await this.load(def.id)
      // Nothing to swap to: keep what is playing rather than going silent, and
      // leave `this.loop` alone so the panel does not name a loop nobody hears.
      if (!decoded || !this.isPlaying()) {
        if (this.voice) this.loop = getLoop(this.voice.id)
        return
      }

      const at = ctx.currentTime
      const src = ctx.createBufferSource()
      src.buffer = decoded.buffer
      src.loop = true
      src.loopStart = decoded.loopStart
      src.loopEnd = decoded.loopEnd
      const gain = ctx.createGain()
      const cross = this.voice !== null && fade > 0
      gain.gain.value = cross ? 0 : 1
      if (cross) gain.gain.setValueCurveAtTime(fadeCurve(true), at, fade)
      src.connect(gain)
      gain.connect(out)
      src.start(at, decoded.loopStart)

      if (this.voice) this.retire(this.voice, at, fade)
      this.voice = {
        id: def.id,
        src,
        gain,
        startedAt: at,
        offset: 0,
        seconds: decoded.loopEnd - decoded.loopStart,
      }
      this.loop = def
    } finally {
      this.swapping = false
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
   * the scene; visible again starts it back up where the scene says.
   *
   * A page that plays audio is exempt from timer throttling, so a backgrounded
   * table would otherwise go on playing out loud from behind another window.
   */
  setHidden(hidden: boolean): void {
    if (this.hidden === hidden) return
    this.hidden = hidden
    if (hidden) {
      this.clearTimer()
      this.stopVoices()
      return
    }
    if (this.scene !== 'off') this.start(this.scene)
  }

  private clearTimer(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  start(scene: MusicScene): void {
    this.scene = scene
    if (scene === 'off') {
      this.stop()
      return
    }
    // Muted opens nothing: no fetch, no decode, no scheduler in service of
    // silence. Unmuting is itself a gesture and starts the bed on the spot.
    if (!audio.isReady() || audio.getSettings().muted || this.timer || this.hidden) return
    // Seed the shuffle from the clock, once. The generator is otherwise
    // deterministic — fine for debugging, useless for "play them in a random
    // order", which would hand every session the same order forever.
    this.seed = (Date.now() & 0x7fffffff) | 1
    this.section = sectionFor(this.currentIntensity, scene === 'lobby')
    this.bag = []
    this.lastSlewAt = Date.now()
    this.timer = setInterval(() => this.tick(), TICK_MS)

    // A loop chosen with ⏭ while the bed was off is what plays, and it is then
    // spent; otherwise the bag picks one that carries the opening section.
    let id = this.chosen
    this.chosen = null
    if (!id || !getLoop(id).sections.includes(this.section)) {
      const pick = nextLoopId(this.section, null, this.bag, () => this.rand())
      this.bag = pick.bag
      id = pick.id
    }
    const def = getLoop(id)
    audio.setSettings({ track: def.id })
    void this.swapTo(def, 0).then(() => this.prefetch())
  }

  stop(): void {
    this.clearTimer()
    this.stopVoices()
    this.scene = 'off'
  }

  /**
   * One pass: slew the intensity, decide whether the section has really moved,
   * and hand over a loop that has come round enough times.
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
    } else if (now - this.pendingSince >= SECTION_HOLD_MS) {
      this.pendingSection = null
      this.section = wanted
      const { id, bag } = nextLoopId(wanted, this.loop.id, this.bag, () => this.rand())
      this.bag = bag
      this.setLoop(id)
      // The working set follows the table. Cheap and idempotent: everything it
      // already holds is a cache hit, and the sort now starts from here.
      void this.prefetch()
      return
    }

    // The table has not moved. What moves the music is the loop having come
    // round enough times — the only thing that does, on a table whose tension
    // holds still for ten minutes.
    if (this.voice && this.getLaps() >= LAPS_PER_LOOP && loopsFor(this.section).length > 1) {
      const { id, bag } = nextLoopId(this.section, this.loop.id, this.bag, () => this.rand())
      this.bag = bag
      this.setLoop(id)
    }
  }
}

export const music = new MusicBed()
export { LOOPS, getLoop, DEFAULT_LOOP_ID, MUSIC_BASE }
