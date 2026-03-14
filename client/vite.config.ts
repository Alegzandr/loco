import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const wsTarget = process.env.VITE_WS_TARGET ?? 'ws://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/ws': {
        target: wsTarget,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
