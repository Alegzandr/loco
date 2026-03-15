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
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Suppress PixiJS WebGL warnings in test output
    ignoreHTTPSErrors: false,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
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
    command: `VITE_WS_PORT=8080 npm run dev`,
    cwd: resolve(__dirname, '../client'),
    port: 5173,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
