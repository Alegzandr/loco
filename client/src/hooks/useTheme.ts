import { useEffect, useState, useCallback } from 'react'
import { applyTheme, readInitialTheme, THEME_STORAGE_KEY, type Theme } from '../theme'

// The theme itself lives in `src/theme.ts`, free of React, so the content pages
// can apply it without mounting anything. Re-exported here because this is where
// the rest of the app has always imported it from.
export type { Theme }
export { initTheme } from '../theme'

const STORAGE_KEY = THEME_STORAGE_KEY

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
