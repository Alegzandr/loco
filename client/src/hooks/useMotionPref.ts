import { useSyncExternalStore } from 'react'

/**
 * `auto` follows the operating system, which is the honest default. The two
 * explicit values win over it in both directions: someone whose OS is set to
 * reduce for reasons of their own is allowed to ask this game for its
 * animations back, and someone whose OS says nothing is allowed to turn them
 * off for a stream capture without touching their system settings.
 */
export type MotionPref = 'auto' | 'reduce' | 'full'

const STORAGE_KEY = 'loco_motion'
const QUERY = '(prefers-reduced-motion: reduce)'

let pref: MotionPref = read()
const listeners = new Set<() => void>()

function read(): MotionPref {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'reduce' || v === 'full' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

function osReduce(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches
}

/** The one answer the whole client asks: is motion reduced right now? */
export function prefersReducedMotion(): boolean {
  return pref === 'reduce' || (pref === 'auto' && osReduce())
}

export function getMotionPref(): MotionPref {
  return pref
}

/**
 * Writes `data-motion` on `<html>`.
 *
 * This attribute is the single source of truth in CSS: the reduced-motion rules
 * are scoped to it rather than to `@media (prefers-reduced-motion: reduce)`,
 * because a media query cannot be overridden by a preference and the `full`
 * setting has to be able to win. `initMotion()` runs in entry.tsx before the
 * first render, so the OS setting still lands before the first paint.
 */
function apply(): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (prefersReducedMotion()) root.setAttribute('data-motion', 'reduce')
  else root.removeAttribute('data-motion')
}

function notify(): void {
  apply()
  listeners.forEach((l) => l())
}

export function initMotion(): void {
  apply()
  // The OS setting can change while the tab is open, and it is what `auto`
  // follows: without this listener the board keeps whatever it started with.
  window.matchMedia?.(QUERY).addEventListener?.('change', () => {
    if (pref === 'auto') notify()
  })
}

export function setMotionPref(next: MotionPref): void {
  if (next === pref) return
  pref = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // Same trade as the other preferences: the session keeps it, the next load
    // falls back to the system setting.
  }
  notify()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, prefersReducedMotion)
}

/** Test/showcase seam, like `resetStreamerMode`. */
export function resetMotionPref(): void {
  pref = read()
  notify()
}
