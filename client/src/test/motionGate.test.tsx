import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * The motion preference has two halves and they have to agree.
 *
 * `reducedMotionCss.test.ts` guards the CSS half, but it reads stylesheets: it
 * passes whether or not anything ever writes the attribute those rules hang
 * off. Both halves were in fact unwired — `initMotion()` was called by a test
 * and by nothing else, so the OS setting never reached the stylesheet, and
 * framer-motion ran under `reducedMotion="user"`, which is the OS setting alone
 * and cannot be overridden by the player either way.
 *
 * So this file asserts the wiring rather than the rules.
 */

const MOTION_CONFIG_PROPS: Array<Record<string, unknown>> = []

vi.mock('framer-motion', () => ({
  MotionConfig: (props: Record<string, unknown>) => {
    MOTION_CONFIG_PROPS.push(props)
    return props.children as never
  },
}))

import { MotionGate } from '../components/MotionGate'
import { setMotionPref, resetMotionPref } from '../hooks/useMotionPref'

const ENTRY = readFileSync(path.resolve(__dirname, '..', 'entry.tsx'), 'utf8')

describe('the reduced-motion wiring', () => {
  beforeEach(() => {
    MOTION_CONFIG_PROPS.length = 0
    localStorage.clear()
    resetMotionPref()
  })

  afterEach(() => {
    localStorage.clear()
    resetMotionPref()
  })

  it('writes data-motion before the first render', () => {
    // The attribute is the single source of truth for every reduced-motion rule
    // in the CSS. Nothing else in the app calls this, so without the call in
    // entry.tsx the whole stylesheet half is dead on arrival.
    expect(ENTRY).toMatch(/^import \{ initMotion \}/m)
    expect(ENTRY).toMatch(/\binitMotion\(\)/)
  })

  it('hands framer-motion the preference, not the media query', () => {
    // `reducedMotion="user"` is the OS setting and only the OS setting. It is
    // the value that made the switch move the CSS and leave the board alone.
    expect(ENTRY).not.toContain('reducedMotion="user"')
    expect(ENTRY).toContain('<MotionGate>')
  })

  it('lets an explicit "reduce" win over a system that says nothing', () => {
    setMotionPref('reduce')
    render(<MotionGate>ok</MotionGate>)
    expect(MOTION_CONFIG_PROPS.at(-1)?.reducedMotion).toBe('always')
  })

  it('lets an explicit "full" win over a system that says reduce', () => {
    // jsdom ships no matchMedia, which is also why `useMotionPref` calls it
    // optionally: a system that says nothing is the honest fallback.
    const original = window.matchMedia
    window.matchMedia = (() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia

    setMotionPref('full')
    render(<MotionGate>ok</MotionGate>)
    expect(MOTION_CONFIG_PROPS.at(-1)?.reducedMotion).toBe('never')

    window.matchMedia = original
  })
})
