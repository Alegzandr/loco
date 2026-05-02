import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'path'

/**
 * Playwright E2E configuration for Loco.
 *
 * Prerequisites:
 *   - Go server running on :8080 (start via docker-compose.dev.yml or manually)
 *   - Playwright starts the Vite dev server automatically
 *
 * Local dev:
 *   docker compose -f docker-compose.dev.yml up --build
 *   cd e2e && npm ci && npx playwright install chromium
 *   npm test
 *
 * CI: server binary is started by the CI script before running tests.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,   // Game tests are stateful — run sequentially to avoid port conflicts
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['junit', { outputFile: 'playwright-results.xml' }], ['list']] : [['list']],

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Suppress PixiJS WebGL warnings in test output
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: '**/mobile.spec.ts',
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      testMatch: '**/mobile.spec.ts',
    },
  ],

  // Start Vite dev server automatically; reuse if already running (local dev).
  // The Go server must already be running (docker-compose or CI script).
  webServer: {
    // Pass --port 5173 explicitly so Vite binds on 5173 in CI (no Docker port
    // mapping).  In Docker local dev, reuseExistingServer reuses the already-
    // running container server and this command is never executed.
    command: `VITE_WS_PORT=8080 VITE_HMR_CLIENT_PORT=4173 npm run dev -- --port 4173`,
    cwd: resolve(__dirname, '../client'),
    port: 4173,
    timeout: 120_000,
    // Always launch an isolated dev server for deterministic E2E behavior.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
