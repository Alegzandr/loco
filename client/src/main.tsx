import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { I18nProvider } from './i18n'
// Self-hosted variable fonts — no CDN request, so the CSP stays closed and the
// first paint never falls back to a system face mid-animation.
import '@fontsource-variable/fredoka'
import '@fontsource-variable/nunito'
import { initTheme } from './hooks/useTheme'
import { initSessionRestore } from './hooks/useSessionRestore'
import './styles/tokens.css'

// Write data-theme before the first paint: screens without a <ThemeToggle />
// would otherwise render in the light palette regardless of the user's choice.
initTheme()

// A reloaded tab has to know it is reclaiming a seat *before* the socket opens:
// the rejoin is sent from the very first onopen, and useWebSocket connects in an
// effect on App's first mount. Seeding the store here, next to the theme and for
// the same reason, is what puts the restoring screen on the first paint instead
// of a flash of lobby.
initSessionRestore()

/**
 * Dev-only visual showcase. `?showcase` mounts a gallery of every screen/state
 * instead of the app so the whole UI can be reviewed (and screenshotted) without
 * a server. `import.meta.env.DEV` is statically false in production builds, so
 * Rollup drops the branch and never emits the chunk.
 */
async function resolveRoot(): Promise<React.ReactNode> {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('showcase')) {
    const { Showcase } = await import('./dev/Showcase')
    return <Showcase />
  }
  return <App />
}

resolveRoot().then((node) => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      {/* reducedMotion="user" makes framer-motion honour the OS setting: transform
          and layout animations snap to their end state while opacity still fades,
          so the game stays readable without motion. CSS transitions are disabled
          alongside it in tokens.css. */}
      <MotionConfig reducedMotion="user">
        <I18nProvider>{node}</I18nProvider>
      </MotionConfig>
    </React.StrictMode>
  )
})
