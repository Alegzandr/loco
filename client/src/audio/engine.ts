/**
 * Audio engine — AudioContext lifecycle, buses and persisted mix settings.
 *
 * Everything the game plays is synthesised at runtime (see sfx.ts and music.ts):
 * no audio files ship with the client, so there is nothing to download, nothing
 * to license, and no cache-miss silence on the first play of a sound.
 *
 * Browsers refuse to start an AudioContext outside a user gesture, so the
 * context is created lazily on the first `unlock()` call and every play request
 * before that is a no-op rather than an error.
 */

export interface AudioSettings {
  /** Master mute. Persisted; survives reloads. */
  muted: boolean
  /** 0..1 */
  master: number
  /** 0..1 */
  sfx: number
  /** 0..1 */
  music: number
  /** Id of the chosen track (`audio/tracks`). Persisted like any other setting. */
  track: string
}

const STORAGE_KEY = 'loco_audio'

export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  master: 0.85,
  sfx: 0.9,
  // Music sits well under the effects: it is a bed, not the show. A streamer
  // talking over the game must stay louder than the soundtrack.
  music: 0.32,
  // Deliberately a bare string rather than an import from `audio/tracks`: the
  // engine is the bottom of the audio stack and must not depend on the track
  // registry, which depends on it. `getTrack` falls back on an unknown id.
  track: 'ressac',
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
}

function readSettings(): AudioSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<AudioSettings>
    return {
      muted: Boolean(parsed.muted),
      master: parsed.master === undefined ? DEFAULT_SETTINGS.master : clamp01(parsed.master),
      sfx: parsed.sfx === undefined ? DEFAULT_SETTINGS.sfx : clamp01(parsed.sfx),
      music: parsed.music === undefined ? DEFAULT_SETTINGS.music : clamp01(parsed.music),
      track: typeof parsed.track === 'string' ? parsed.track : DEFAULT_SETTINGS.track,
    }
  } catch {
    // Corrupt or unavailable storage must never stop the game from booting.
    return { ...DEFAULT_SETTINGS }
  }
}

type Listener = (s: AudioSettings) => void

export class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
  private sfxVerbIn: GainNode | null = null
  private musicBus: GainNode | null = null
  private settings: AudioSettings = readSettings()
  private listeners = new Set<Listener>()
  /** Guards against scheduling storms: at most this many voices start per frame. */
  private voicesThisFrame = 0
  private frameStamp = 0

  getSettings(): AudioSettings {
    return this.settings
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    for (const fn of this.listeners) fn(this.settings)
  }

  /**
   * Creates (or resumes) the AudioContext. Must be called from a user gesture
   * the first time; safe to call on every gesture afterwards, and cheap enough
   * to call again whenever the page comes back to the foreground.
   *
   * Resolves once the context is actually running, which is not the same moment
   * as the call: `resume()` is a promise, so a caller that starts the music bed
   * on the next line finds `isReady()` still false and silently does nothing.
   * On iOS that reads as "the first tap never turns the sound on".
   */
  async unlock(): Promise<void> {
    if (typeof window === 'undefined') return
    if (!this.ctx) {
      const Ctor: typeof AudioContext | undefined =
        window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return
      try {
        this.ctx = new Ctor()
      } catch {
        return
      }
      this.declarePlaybackSession()
      this.master = this.ctx.createGain()
      this.sfxBus = this.ctx.createGain()
      this.musicBus = this.ctx.createGain()
      this.sfxBus.connect(this.master)
      this.musicBus.connect(this.master)
      this.master.connect(this.ctx.destination)
      this.buildSfxReverb(this.ctx)
      this.applyGains(0)
    }
    // Anything that is not running, not just `suspended`. WebKit parks the
    // context in its own non-standard `interrupted` state when the page is
    // backgrounded, when a call comes in, or when Siri speaks: neither
    // `running` nor `suspended`, so a resume guarded on `=== 'suspended'` never
    // fires. `isReady()` then stays false forever, every sound becomes a silent
    // no-op and the music scheduler ticks against a frozen clock, with no error
    // anywhere. That is the "I switched apps and lost the sound" bug.
    if (this.ctx.state === 'closed' || this.ctx.state === 'running') return
    try {
      await this.ctx.resume()
    } catch {
      // A resume outside a gesture may simply be refused; the next tap retries.
    }
  }

  /**
   * A short room on a send, for the sounds that are allowed to be an event.
   *
   * The music bed has had reverb since it was written; the effects bus was dry,
   * and a dry bus is why every celebration in this game had to be a *melody* to
   * feel like anything. Something with a tail can be one chord. It is a send and
   * not an insert, so the card handling, which is paper and must stay in the
   * room the player is in, reaches it at zero and is unchanged.
   *
   * The impulse is synthesised for the same reason every other sound here is:
   * shipping an IR would be the first audio file in the client. Noise under an
   * exponential decay, darkening as it falls, which is what a small room does to
   * the top end. Short on purpose: 0.9s. This game plays faster than its sounds
   * decay if you let it.
   */
  private buildSfxReverb(ctx: AudioContext): void {
    if (!this.sfxBus) return
    try {
      const seconds = 0.9
      const len = Math.floor(ctx.sampleRate * seconds)
      const ir = ctx.createBuffer(2, len, ctx.sampleRate)
      for (let channel = 0; channel < 2; channel++) {
        const data = ir.getChannelData(channel)
        let dark = 0
        for (let i = 0; i < len; i++) {
          const decay = Math.pow(1 - i / len, 2.6)
          // A one-pole lowpass over the noise: the tail loses its top as it
          // goes, instead of hissing all the way down at constant brightness.
          dark += ((Math.random() * 2 - 1) - dark) * 0.34
          data[i] = dark * decay
        }
      }
      const convolver = ctx.createConvolver()
      convolver.buffer = ir
      const send = ctx.createGain()
      send.gain.value = 1
      send.connect(convolver)
      convolver.connect(this.sfxBus)
      this.sfxVerbIn = send
    } catch {
      // A refused ConvolverNode costs the tail and nothing else: every voice
      // still reaches the bus dry, so the game keeps its sound.
      this.sfxVerbIn = null
    }
  }

  /**
   * Asks iOS to treat this page as playback audio.
   *
   * On iPhone the Ring/Silent switch mutes Web Audio in a page (unlike an
   * inline `<video>`), silently and with no way to detect it: the same build is
   * silent on one phone and fine on another, which is most of "sometimes I have
   * sound, sometimes I don't". `playback` is the honest description of what this
   * is (a game with its own soundtrack) and it is the category that ignores the
   * switch. It also stops whatever the player had going in another app, which is
   * the deliberate trade; `'ambient'` is the setting that respects the switch and
   * mixes instead. Safari 16.4+; everywhere else the property is absent
   * and the game keeps the old behaviour.
   */
  private declarePlaybackSession(): void {
    try {
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession
      if (session) session.type = 'playback'
    } catch {
      // Non-writable or unsupported. Never worth failing a sound over.
    }
  }

  /** True once the context exists and is running. */
  isReady(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  context(): AudioContext | null {
    return this.ctx
  }

  sfxDestination(): GainNode | null {
    return this.sfxBus
  }

  /**
   * Where a voice sends itself to be given a tail. Null before the first unlock
   * and on any browser that refused the convolver, so callers connect to it only
   * when it is there. The sound is the dry path, never this.
   */
  sfxReverbSend(): GainNode | null {
    return this.sfxVerbIn
  }

  musicDestination(): GainNode | null {
    return this.musicBus
  }

  now(): number {
    return this.ctx?.currentTime ?? 0
  }

  setSettings(patch: Partial<AudioSettings>): void {
    this.settings = {
      ...this.settings,
      ...patch,
      master: patch.master === undefined ? this.settings.master : clamp01(patch.master),
      sfx: patch.sfx === undefined ? this.settings.sfx : clamp01(patch.sfx),
      music: patch.music === undefined ? this.settings.music : clamp01(patch.music),
      track: patch.track ?? this.settings.track,
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings))
    } catch {
      // Private-mode storage failures are not worth surfacing.
    }
    this.applyGains(0.08)
    this.emit()
  }

  toggleMute(): void {
    this.setSettings({ muted: !this.settings.muted })
  }

  private applyGains(ramp: number) {
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus) return
    const t = this.ctx.currentTime
    const m = this.settings.muted ? 0 : this.settings.master
    const set = (node: GainNode, value: number) => {
      node.gain.cancelScheduledValues(t)
      node.gain.setValueAtTime(node.gain.value, t)
      node.gain.linearRampToValueAtTime(value, t + Math.max(0.001, ramp))
    }
    set(this.master, m)
    set(this.sfxBus, this.settings.sfx)
    set(this.musicBus, this.settings.music)
  }

  /**
   * Rate limiter for one-shot effects.
   *
   * A batch play or a penalty draw can fire a dozen sounds in the same tick;
   * past a handful they stop being distinguishable and only add clipping, so
   * the surplus is dropped rather than queued.
   */
  budgetVoice(max = 6): boolean {
    const frame = Math.floor(this.now() * 60)
    if (frame !== this.frameStamp) {
      this.frameStamp = frame
      this.voicesThisFrame = 0
    }
    if (this.voicesThisFrame >= max) return false
    this.voicesThisFrame++
    return true
  }
}

export const audio = new AudioEngine()
