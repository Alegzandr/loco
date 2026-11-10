/**
 * The weather a device cannot hold is shed, and only the weather.
 *
 * The governor is driven by a hand-cranked clock: frames at a chosen cadence,
 * timers fired by name. What is pinned is the three decisions the module's
 * header says are easy to undo: a mean without its hitches and not the
 * median, one-way, and asleep between bursts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  LOAD_BAD_WINDOWS,
  LOAD_FLOOR_FPS,
  LOAD_GOOD_WINDOWS,
  LOAD_GRACE_MS,
  LOAD_RECHECK_MS,
  LOAD_WINDOW_MS,
  MAX_SHED,
  getWeatherShed,
  resetWeatherShed,
  shedWeatherFrom,
  startWeatherGovernor,
  weatherTier,
  windowVerdict,
  type GovernorClock,
} from '../components/scene/weatherLoad'

function crank() {
  let queued: FrameRequestCallback | null = null
  let timer: { cb: () => void; ms: number } | null = null
  let now = 0
  const clock: GovernorClock = {
    raf: (cb) => ((queued = cb), 1),
    caf: () => {
      queued = null
    },
    setTimer: (cb, ms) => (timer = { cb, ms }),
    clearTimer: () => {
      timer = null
    },
  }
  return {
    clock,
    get asking() {
      return queued !== null
    },
    get timerMs() {
      return timer?.ms ?? null
    },
    fireTimer() {
      const t = timer
      timer = null
      t?.cb()
    },
    /** Runs frames `every` ms apart for `ms`, as long as one is asked for. */
    run(ms: number, every: number) {
      const until = now + ms
      while (now < until && queued) {
        const cb = queued
        queued = null
        cb(now)
        now += every
      }
    },
    /** One frame after a pause: a tab that was hidden. */
    skip(ms: number) {
      now += ms
    },
  }
}

const SLOW = 1000 / 35
const FAST = 1000 / 60

beforeEach(() => resetWeatherShed())

describe('what a window of frames says', () => {
  it('reads the steady cadence, so one long frame is not a slow device', () => {
    const smooth = Array.from({ length: 80 }, () => FAST)
    expect(windowVerdict(smooth)).toBe('good')
    expect(windowVerdict([...smooth, 400])).toBe('good')
    expect(windowVerdict(Array.from({ length: 50 }, () => SLOW))).toBe('bad')
  })

  it('is not fooled by a display it misses every other refresh of', () => {
    // 45 fps on a 60 Hz panel: the median interval is still a 60 Hz frame.
    const juddered = Array.from({ length: 60 }, (_, i) => (i % 3 === 0 ? 1000 / 60 : i % 3 === 1 ? 1000 / 30 : 1000 / 60))
    const halved = Array.from({ length: 60 }, (_, i) => (i % 2 ? 1000 / 30 : 1000 / 60))
    expect(windowVerdict(halved)).toBe('bad')
    expect(windowVerdict(juddered)).toBe('bad')
    // 49 fps the same way: one refresh missed in every five and a bit.
    const nearly = Array.from({ length: 90 }, (_, i) => (i % 9 < 2 ? 1000 / 30 : 1000 / 60))
    expect(windowVerdict(nearly)).toBe('bad')
  })

  it('still reads a device so slow that every frame is long', () => {
    expect(windowVerdict(Array.from({ length: 12 }, () => 125))).toBe('bad')
  })

  it('puts the floor where it says', () => {
    expect(windowVerdict(Array.from({ length: 40 }, () => 1000 / (LOAD_FLOOR_FPS + 1)))).toBe('good')
    expect(windowVerdict(Array.from({ length: 40 }, () => 1000 / (LOAD_FLOOR_FPS - 1)))).toBe('bad')
  })

  it('says nothing about a tab that was hidden, or about a handful of frames', () => {
    expect(windowVerdict([SLOW, SLOW, 5000, SLOW, SLOW, SLOW])).toBeNull()
    expect(windowVerdict([SLOW, SLOW])).toBeNull()
  })
})

describe('the tier the weather is drawn at', () => {
  it('steps down the ladder and stops at the bottom', () => {
    expect(weatherTier('high', 0)).toBe('high')
    expect(weatherTier('high', 1)).toBe('medium')
    expect(weatherTier('high', 2)).toBe('light')
    expect(weatherTier('medium', 2)).toBe('light')
    expect(weatherTier('light', 1)).toBe('light')
  })

  it('counts two governors reaching one verdict as one step', () => {
    shedWeatherFrom(0)
    shedWeatherFrom(0)
    expect(getWeatherShed()).toBe(1)
  })

  it('never sheds past the ladder', () => {
    for (let i = 0; i < 5; i++) shedWeatherFrom(getWeatherShed())
    expect(getWeatherShed()).toBe(MAX_SHED)
  })
})

describe('the governor', () => {
  it('asks for no frame until the grace has run', () => {
    const c = crank()
    startWeatherGovernor(c.clock)
    expect(c.asking).toBe(false)
    expect(c.timerMs).toBe(LOAD_GRACE_MS)
    c.fireTimer()
    expect(c.asking).toBe(true)
  })

  it('sheds one step on a device under the floor, then stops', () => {
    const c = crank()
    startWeatherGovernor(c.clock)
    c.fireTimer()
    c.run(LOAD_WINDOW_MS * (LOAD_BAD_WINDOWS + 1), SLOW)
    expect(getWeatherShed()).toBe(1)
    expect(c.asking).toBe(false)
  })

  it('does not shed on one bad window between good ones', () => {
    const c = crank()
    startWeatherGovernor(c.clock)
    c.fireTimer()
    c.run(LOAD_WINDOW_MS + SLOW, SLOW)
    c.run(LOAD_WINDOW_MS * (LOAD_GOOD_WINDOWS + 1), FAST)
    expect(getWeatherShed()).toBe(0)
  })

  it('goes to sleep on a device that holds its rate, and wakes to look again', () => {
    const c = crank()
    startWeatherGovernor(c.clock)
    c.fireTimer()
    c.run(LOAD_WINDOW_MS * (LOAD_GOOD_WINDOWS + 1), FAST)
    expect(getWeatherShed()).toBe(0)
    expect(c.asking).toBe(false)
    expect(c.timerMs).toBe(LOAD_RECHECK_MS)
    c.fireTimer()
    c.run(LOAD_WINDOW_MS * (LOAD_BAD_WINDOWS + 1), SLOW)
    expect(getWeatherShed()).toBe(1)
  })

  it('does not read a hidden tab as a slow one', () => {
    const c = crank()
    startWeatherGovernor(c.clock)
    c.fireTimer()
    for (let i = 0; i < 6; i++) {
      c.run(400, FAST)
      c.skip(20_000)
    }
    expect(getWeatherShed()).toBe(0)
  })

  it('asks for nothing once stopped', () => {
    const c = crank()
    const stop = startWeatherGovernor(c.clock)
    c.fireTimer()
    c.run(200, SLOW)
    stop()
    expect(c.asking).toBe(false)
    c.run(LOAD_WINDOW_MS * 4, SLOW)
    expect(getWeatherShed()).toBe(0)
  })
})

describe('where the governor is allowed to act', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n')
  const layer = read('components/scene/WeatherLayer.svelte')

  it('only under `auto`: a tier the player chose is the player\'s', () => {
    expect(layer).toMatch(/graphicsPref\.current === 'auto' \? weatherTier\(graphicsPref\.tier, weatherShed\.steps\) : graphicsPref\.tier/)
  })

  it('never moves the graphics tier itself, which would render the room again', () => {
    expect(read('components/scene/weatherLoad.ts')).not.toMatch(/setGraphicsPref|resolveGraphics/)
  })

  it('watches only a room that has landed, and nothing that holds still', () => {
    expect(layer).toMatch(/if \(!settled \|\| still \|\| weather === 'clear'\) return/)
  })
})
