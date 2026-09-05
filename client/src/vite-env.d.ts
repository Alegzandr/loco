/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_PORT?: string
  /**
   * `'1'` asks `sceneCache` to answer the map-loading gate with the sky
   * gradient instead of rendering the room. Set by the Playwright config on
   * the dev server it owns, and read only under `import.meta.env.DEV`, so a
   * production build folds the branch away whatever the environment says.
   */
  readonly VITE_E2E_NO_SCENE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

// Dev-only E2E test helpers exposed on window (stripped from production builds).
interface Window {
  __LOCO_E2E__?: Record<string, unknown>
}
