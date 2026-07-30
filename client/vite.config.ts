import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App WebSocket: browser connects directly to ws://<hostname>:8080/ws (Go backend).
// No Vite proxy needed — VITE_WS_PORT drives the URL in useWebSocket.ts.
//
// HMR: Vite runs on container port 3000, exposed at host port 5173 (Docker
// port mapping).  Without clientPort the HMR client would try port 3000 (not
// exposed) instead of 5173, causing spurious WebSocket errors in the browser
// console that can be mistaken for the app's own WebSocket failures.

// Absolute origin baked into the link-preview tags in index.html. Discord, X
// and Slack resolve og:image against nothing — a relative path is simply not
// fetched — and they do not run JS, so this cannot be filled in at runtime.
// Defaults to production; override at build time for another deployment.
const OG_ORIGIN = (process.env.VITE_PUBLIC_ORIGIN ?? 'https://loco.kisukesaama.com').replace(/\/+$/, '')

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'loco-og-origin',
      // `pre`, i.e. before vite:build-html: that plugin runs decodeURI over every
      // href it finds, and `%OG` is not a valid escape sequence — the canonical
      // <link> fails the whole build otherwise.
      transformIndexHtml: {
        order: 'pre',
        handler: (html: string) => html.replaceAll('%OG_ORIGIN%', OG_ORIGIN),
      },
    },
  ],
  server: {
    port: 3000,
    host: true,
    hmr: {
      clientPort: parseInt(process.env.VITE_HMR_CLIENT_PORT ?? '5173'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
