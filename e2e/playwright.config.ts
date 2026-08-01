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
  // `workers: 1` is what keeps the suite sequential — one browser, one room at a
  // time, against a single shared Go server. `fullyParallel` does not change
  // that with a single worker; what it changes is the granularity CI shards at.
  //
  // Left false, Playwright shards whole spec files, and these files are wildly
  // uneven (rules-coverage alone holds 23 of 87 tests): `--shard=i/4` produced
  // 27 / 39 / 0 / 21, i.e. one job running empty while another carried 45% of
  // the suite. True, it shards per test and the four jobs come out even.
  //
  // It is safe here because every test is self-contained: no beforeAll, no
  // describe.serial, no shared fixture — each one creates its own room. Keep it
  // that way, or raise workers deliberately rather than by accident.
  fullyParallel: true,
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

  // Start the client's dev server automatically; never reuse one.
  // The Go server must already be running (docker-compose or CI script).
  webServer: {
    // Pass --port explicitly so the server binds on 4173 rather than its default.
    //
    // `--ignore-lock` because `astro dev` is a singleton: it takes a lock file,
    // and a second invocation prints "dev server already running" and exits
    // without ever binding 4173. Without this the whole suite times out for the
    // sole reason that `make dev` is up in another terminal.
    //
    // Environment goes through `env` rather than a shell prefix: the prefix form
    // is POSIX-only and fails when the suite is run from Windows.
    command: `npm run dev -- --port 4173 --ignore-lock`,
    env: {
      VITE_WS_PORT: '8080',
      VITE_HMR_CLIENT_PORT: '4173',
      // `astro dev` auto-backgrounds itself when it detects an agentic
      // environment, and a backgrounded server refuses --ignore-lock. Playwright
      // owns this server's lifetime, so it must stay in the foreground. The
      // detector treats an empty value as absent.
      CLAUDECODE: '',
      CURSOR_TRACE_ID: '',
      AGENT: '',
      REPL_ID: '',
    },
    cwd: resolve(__dirname, '../client'),
    port: 4173,
    timeout: 120_000,
    // Always launch an isolated dev server for deterministic E2E behavior.
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
