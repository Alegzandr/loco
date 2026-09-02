/**
 * AudioContext lifecycle on mobile Safari.
 *
 * These are the two paths that produce *silence rather than an error*, which is
 * why no other test would ever go red on them: WebKit parking the context in
 * its own `interrupted` state, and nothing asking for it back when the player
 * returns to the tab.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from './renderHook'
import { AudioEngine } from '../audio/engine'

class FakeParam {
  value = 1
  cancelScheduledValues() {}
  setValueAtTime() {}
  linearRampToValueAtTime() {}
}

class FakeGain {
  gain = new FakeParam()
  connect() {}
}

class FakeContext {
  state = 'running'
  currentTime = 0
  destination = {}
  resumeCalls = 0
  createGain() {
    return new FakeGain()
  }
  resume() {
    this.resumeCalls++
    this.state = 'running'
    return Promise.resolve()
  }
  addEventListener() {}
  removeEventListener() {}
}

const created: FakeContext[] = []

function installFakeAudio() {
  created.length = 0
  ;(window as unknown as { AudioContext: unknown }).AudioContext = function () {
    const ctx = new FakeContext()
    created.push(ctx)
    return ctx
  }
}

describe('AudioEngine.unlock', () => {
  beforeEach(() => {
    installFakeAudio()
  })

  afterEach(() => {
    delete (navigator as unknown as { audioSession?: unknown }).audioSession
  })

  it('creates the context once and reuses it', () => {
    const engine = new AudioEngine()
    engine.unlock()
    engine.unlock()
    expect(created).toHaveLength(1)
  })

  it('resumes a suspended context', () => {
    const engine = new AudioEngine()
    engine.unlock()
    created[0].state = 'suspended'
    engine.unlock()
    expect(created[0].resumeCalls).toBe(1)
  })

  // The bug this exists for: quitting Safari, taking a call or triggering Siri
  // puts the context into WebKit's non-standard `interrupted` state, which is
  // neither `running` nor `suspended`. A resume guarded on `=== 'suspended'`
  // never fires, `isReady()` stays false, and every sound is a silent no-op
  // until the page is reloaded.
  it('resumes a context WebKit left in the non-standard "interrupted" state', () => {
    const engine = new AudioEngine()
    engine.unlock()
    created[0].state = 'interrupted'
    expect(engine.isReady()).toBe(false)

    engine.unlock()

    expect(created[0].resumeCalls).toBe(1)
    expect(engine.isReady()).toBe(true)
  })

  it('does not resume a context that is already running', () => {
    const engine = new AudioEngine()
    engine.unlock()
    engine.unlock()
    expect(created[0].resumeCalls).toBe(0)
  })

  // On iPhone the Ring/Silent switch mutes Web Audio in a page, with no error
  // and no clue: the same build is silent on one phone and fine on another.
  it('declares a playback audio session so the silent switch does not mute the game', () => {
    const session = { type: 'auto' }
    ;(navigator as unknown as { audioSession: unknown }).audioSession = session

    new AudioEngine().unlock()

    expect(session.type).toBe('playback')
  })

  it('survives a browser with no audioSession support', () => {
    expect(() => new AudioEngine().unlock()).not.toThrow()
  })

  it('survives an audioSession that refuses the assignment', () => {
    Object.defineProperty(navigator, 'audioSession', {
      configurable: true,
      get: () => {
        throw new Error('nope')
      },
    })
    expect(() => new AudioEngine().unlock()).not.toThrow()
  })
})

vi.mock('../audio/music', () => ({
  music: {
    setIntensity: vi.fn(),
    setHidden: vi.fn(),
    isPlaying: vi.fn(() => true),
    start: vi.fn(),
    stop: vi.fn(),
    duck: vi.fn(),
  },
}))

vi.mock('../audio/sfx', () => ({
  playSfx: vi.fn(),
  playDeal: vi.fn(),
}))

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => value,
  })
}

describe('gameAudio wake-up', () => {
  beforeEach(() => {
    installFakeAudio()
    vi.restoreAllMocks()
    // The redefinition below is permanent, so a test that hides the tab would
    // otherwise hide it for every test after it.
    setVisibility('visible')
  })

  async function mount() {
    const { audio } = await import('../audio/engine')
    const { gameAudio } = await import('../hooks/appEffects.svelte')
    const spy = vi.spyOn(audio, 'unlock')
    // `gameAudio()` is an effect and nothing else, so it needs a component to
    // live in — which is the whole job of `renderHook`.
    const view = renderHook(() => gameAudio())
    spy.mockClear()
    return { spy, view }
  }

  // Returning from another app is the moment the context needs reclaiming, and
  // it is not a gesture: waiting for the next tap means the board is silent for
  // as long as the player is only looking at it.
  it('reclaims the context when the tab comes back to the foreground', async () => {
    const { spy, view } = await mount()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).toHaveBeenCalled()
    view.unmount()
  })

  it('does not bother reclaiming while the tab is hidden', async () => {
    const { spy, view } = await mount()

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))

    expect(spy).not.toHaveBeenCalled()
    view.unmount()
  })

  it('reclaims the context on window focus', async () => {
    const { spy, view } = await mount()
    window.dispatchEvent(new Event('focus'))
    expect(spy).toHaveBeenCalled()
    view.unmount()
  })

  it('stops listening once unmounted', async () => {
    const { spy, view } = await mount()
    view.unmount()
    window.dispatchEvent(new Event('focus'))
    expect(spy).not.toHaveBeenCalled()
  })
})
