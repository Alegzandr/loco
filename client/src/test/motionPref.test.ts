import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initMotion, setMotionPref, resetMotionPref } from '../hooks/motionPref'

/**
 * The motion preference has two halves and they have to agree.
 *
 * `reducedMotionCss.test.ts` guards the CSS half, but it reads stylesheets: it
 * passes whether or not anything ever writes the attribute those rules hang
 * off. Both halves were in fact unwired once — `initMotion()` was called by a
 * test and by nothing else, so the OS setting never reached the stylesheet.
 *
 * So this file asserts the wiring rather than the rules. It used to assert one
 * more thing: that framer-motion was handed the preference rather than the
 * media query, through a `<MotionGate>` wrapper. There is no framer-motion and
 * no MotionGate now — Svelte transitions and the two WAAPI shakes ask
 * `prefersReducedMotion()` directly — so `data-motion` is no longer one half of
 * the mechanism, it is the whole of it, and what follows is the only thing
 * standing between the player's answer and the stylesheet.
 */

const ENTRY = readFileSync(path.resolve(__dirname, '..', 'entry.ts'), 'utf8')

const motion = () => document.documentElement.getAttribute('data-motion')

/** jsdom ships no matchMedia, which is also why `motionPref` calls it optionally. */
function systemSays(reduce: boolean) {
  const original = window.matchMedia
  window.matchMedia = (() => ({
    matches: reduce,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
  return () => {
    window.matchMedia = original
  }
}

describe('the reduced-motion wiring', () => {
  beforeEach(() => {
    localStorage.clear()
    resetMotionPref()
  })

  afterEach(() => {
    localStorage.clear()
    resetMotionPref()
    document.documentElement.removeAttribute('data-motion')
  })

  it('writes data-motion before the first render', () => {
    // The attribute is the single source of truth for every reduced-motion rule
    // in the CSS. Nothing else in the app calls this, so without the call in
    // entry.ts the whole stylesheet half is dead on arrival.
    expect(ENTRY).toMatch(/^import \{ initMotion \}/m)
    expect(ENTRY).toMatch(/\binitMotion\(\)/)
  })

  it('carries a system that asks for less motion into the stylesheet', () => {
    // The failure this replaces: the OS said reduce, the CSS never heard, and a
    // player got the full set of animations for the whole session unless they
    // found the switch in Preferences themselves.
    const restore = systemSays(true)
    initMotion()
    expect(motion()).toBe('reduce')
    restore()
  })

  it('lets an explicit "reduce" win over a system that says nothing', () => {
    const restore = systemSays(false)
    initMotion()
    expect(motion()).toBeNull()

    setMotionPref('reduce')
    expect(motion()).toBe('reduce')
    restore()
  })

  it('lets an explicit "full" win over a system that says reduce', () => {
    // A media query cannot be overridden, which is the entire reason the rules
    // hang off an attribute instead: `full` has to be able to win.
    const restore = systemSays(true)
    initMotion()
    expect(motion()).toBe('reduce')

    setMotionPref('full')
    expect(motion()).toBeNull()
    restore()
  })
})
