import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// App WebSocket: browser connects directly to ws://<hostname>:8080/ws (Go backend).
// No Vite proxy needed — VITE_WS_PORT drives the URL in useWebSocket.ts.
//
// HMR: Vite runs on container port 3000, exposed at host port 5173 (Docker
// port mapping).  Without clientPort the HMR client would try port 3000 (not
// exposed) instead of 5173, causing spurious WebSocket errors in the browser
// console that can be mistaken for the app's own WebSocket failures.

export default defineConfig({
  plugins: [react()],
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
