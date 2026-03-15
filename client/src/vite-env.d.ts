/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_PORT?: string
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
