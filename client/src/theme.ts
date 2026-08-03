/**
 * Reading and applying the theme, with no framework in it.
 *
 * This began as `hooks/useTheme.ts` and was split out of it so the content pages
 * could honour the player's choice without pulling a framework onto a page that
 * mounts nothing — importing the hook would have dragged the whole thing into a
 * document that is otherwise pure HTML. The hook is gone and this is all that is
 * left, which is the right way round: **the theme is a module, and a component
 * subscribes to it.** Keep it importable by a page with no application on it.
 */

export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'loco_theme'

export function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Applies the stored theme once, at startup.
 *
 * Without this the attribute is only written by the preferences panel's hook, so
 * any screen that does not render the toggle — the game-over screen, a reload
 * straight into a match, or a content page, which renders no React at all —
 * silently falls back to the light palette. `tokens.css` keys its dark palette
 * on `[data-theme='dark']` and on nothing else, so the attribute is the theme.
 */
export function initTheme(): void {
  applyTheme(readInitialTheme())
}

/**
 * The current theme, as a module rather than as component state.
 *
 * It used to live in component state, which worked while the only thing that
 * could change it was the one panel holding it. Two things could by the end —
 * the panel and a content page's own button, in different trees — so the value
 * moved here, the same move the language and the game store made.
 */
let current: Theme | null = null
const listeners = new Set<() => void>()

export function getTheme(): Theme {
  if (current === null) current = readInitialTheme()
  return current
}

export function setTheme(next: Theme): void {
  if (next === getTheme()) return
  current = next
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Private mode. The session keeps the choice; the next load re-reads the OS.
  }
  applyTheme(next)
  for (const fn of listeners) fn()
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
