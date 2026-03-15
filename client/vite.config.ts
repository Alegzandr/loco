import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Target must use http:// (not ws://) so that http-proxy performs an HTTP upgrade,
// which is what gorilla/websocket on the backend expects.
const wsTarget = process.env.VITE_WS_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/ws': {
        target: wsTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
