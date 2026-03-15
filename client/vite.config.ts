import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// WebSocket in dev: the client connects directly to ws://<hostname>:8080/ws,
// bypassing Vite's WS proxy (unreliable for upgrades under Docker networking).
// No proxy configuration is needed here.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
