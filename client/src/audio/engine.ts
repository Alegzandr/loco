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
}

const STORAGE_KEY = 'loco_audio'

export const DEFAULT_SETTINGS: AudioSettings = {
  muted: false,
  master: 0.85,
  sfx: 0.9,
  // Music sits well under the effects: it is a bed, not the show. A streamer
  // talking over the game must stay louder than the soundtrack.
  music: 0.32,
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
    }
  } catch {
    // Corrupt or unavailable storage must never stop the game from booting.
    return { ...DEFAULT_SETTINGS }
  }
}

type Listener = (s: AudioSettings) => void

class AudioEngine {
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private sfxBus: GainNode | null = null
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
   * the first time; safe to call on every gesture afterwards.
   */
  unlock(): void {
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
      this.master = this.ctx.createGain()
      this.sfxBus = this.ctx.createGain()
      this.musicBus = this.ctx.createGain()
      this.sfxBus.connect(this.master)
      this.musicBus.connect(this.master)
      this.master.connect(this.ctx.destination)
      this.applyGains(0)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
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
