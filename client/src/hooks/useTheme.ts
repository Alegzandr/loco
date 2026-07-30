import { useEffect, useState, useCallback } from 'react'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'loco_theme'

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

/**
 * Applies the stored theme once, at startup.
 *
 * Without this the attribute is only written by <ThemeToggle />'s hook, so any
 * screen that does not render the toggle — the game-over screen, or a reload
 * straight into a match — silently falls back to the light palette. Called from
 * main.tsx before the first render, which also removes the flash of the wrong
 * theme on load.
 */
export function initTheme(): void {
  applyTheme(readInitialTheme())
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'light' ? 'dark' : 'light')
  }, [theme, setTheme])

  return { theme, setTheme, toggleTheme }
}
