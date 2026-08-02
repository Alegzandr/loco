/**
 * Reading and applying the theme, with no React in it.
 *
 * Split out of `hooks/useTheme.ts` so the content pages can honour the player's
 * choice without pulling React onto a page that mounts nothing: importing the
 * hook would have dragged the whole framework into a document that is otherwise
 * pure HTML. `useTheme` re-exports these, so there is still exactly one
 * definition of what "the theme" means.
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
