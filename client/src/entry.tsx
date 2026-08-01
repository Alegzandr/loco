import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { I18nProvider } from './i18n'
import { MotionGate } from './components/MotionGate'
import { initTheme } from './hooks/useTheme'
import { initMotion } from './hooks/useMotionPref'
import { initSessionRestore } from './hooks/useSessionRestore'

/**
 * The game, mounted into #root by a module script.
 *
 * Deliberately *not* an Astro island. `client:only` works, but Astro ships its
 * hydration runtime as two inline <script> blocks in the HTML, and
 * `client/nginx.conf` sends `script-src 'self'` with no 'unsafe-inline': in
 * production those blocks are refused, the island never hydrates and the page is
 * blank. Astro's own CSP support emits hashes in a <meta>, which does not help
 * either — a meta policy and a header policy are both enforced, so the header
 * still blocks them. An ordinary <script> in a .astro file is bundled to an
 * external module instead, which the policy allows, and it is exactly the
 * mechanism the app already used under Vite. See src/test/csp.test.ts.
 */

// Write data-theme before the first paint: screens without a <ThemeToggle />
// would otherwise render in the light palette regardless of the user's choice.
initTheme()

// Same reason, for the same kind of preference: every reduced-motion rule in
// the CSS hangs off `data-motion`, and nothing writes that attribute until this
// runs. Without it a player whose system asks for less motion got the full set
// of animations for the whole session unless they happened to open Preferences
// and toggle the switch themselves — the OS setting alone never reached the
// stylesheet. This also registers the listener that keeps `auto` following the
// system while the tab is open.
initMotion()

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
 * Rollup drops the branch and never emits the chunk. Keeping the query-string
 * contract rather than moving to a route is what leaves tools/visual/shoot.mjs
 * and tools/og/shoot.mjs untouched.
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
      {/* Transform and layout animations snap to their end state while opacity
          still fades, so the game stays readable without motion. CSS
          transitions are disabled alongside it in tokens.css, off the same
          preference — see <MotionGate />. */}
      <MotionGate>
        <I18nProvider>{node}</I18nProvider>
      </MotionGate>
    </React.StrictMode>,
  )
})
