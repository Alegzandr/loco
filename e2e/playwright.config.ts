import { defineConfig, devices } from '@playwright/test'
import { resolve } from 'path'
import { cpus } from 'os'

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
  // What `fullyParallel` buys is the granularity CI shards at, and it is what
  // lets `workers` below be more than one anywhere else.
  //
  // Left false, Playwright shards whole spec files, and these files are wildly
  // uneven (rules-coverage alone holds 23 of 122 tests): `--shard=i/4` produced
  // 27 / 39 / 0 / 21, i.e. one job running empty while another carried 45% of
  // the suite. True, it shards per test and the four jobs come out even.
  //
  // It is safe here because every test is self-contained: no beforeAll, no
  // describe.serial, no shared fixture — each one creates its own room. Keep it
  // that way, or raise workers deliberately rather than by accident.
  //
  // Raising workers is safe, which it was not: a room code is private so two
  // tests never meet in one, but the 1v1 matchmaking queue is a single FIFO
  // per server and would pair one test's searcher with another's. Those six
  // tests take a cross-process lock on it (helpers/matchmakingQueue.ts) rather
  // than the whole suite being pinned to one worker to hide it.
  fullyParallel: true,
  // Playwright's default is 30s, and a good half of this suite plays a match
  // out: a BO1 against a bot on a loaded runner runs past that honestly, and
  // the failure it produced was a retry of the whole test rather than a bug.
  // `helpers/game.ts: budget()` is the other half of this — every long wait is
  // capped just inside whatever a test is given, so a wait that really is hung
  // still says what it was waiting for instead of spending the lot in silence.
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // CI shards this suite four ways and runs one worker per shard, because the
  // runner's `concurrent = 1` means the shards queue rather than overlap:
  // raising workers there would be four browsers on the CPU one job is given.
  //
  // Everywhere else — a laptop, a cloud sandbox — sharding is not available
  // and one worker is 159 tests end to end for no reason: `fullyParallel` is
  // already true, a room code is private, and the one server-global the suite
  // contends on (the 1v1 queue) is taken under a cross-process lock by the
  // six tests that use it. `LOCO_E2E_WORKERS` overrides for a machine that
  // wants fewer; the cap is deliberate, since every worker is a browser plus
  // the Go server's share of the same box.
  workers: process.env.LOCO_E2E_WORKERS
    ? Number(process.env.LOCO_E2E_WORKERS)
    : process.env.CI
      ? 1
      : Math.min(4, Math.max(1, Math.floor(cpus().length / 2))),
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
      // No room. The suite drives real matches through the map-loading gate
      // and asserts nothing about what the gate was waiting for: appearance
      // is `make visual`'s, behaviour is this suite's. Rendering it anyway
      // cost 2.2s, ~250 requests and ~7MB of models per table opened, on
      // headless Chromium's software GPU, ~167 times a run.
      //
      // `sceneCache` answers the gate with the sky gradient instead — the
      // path a machine with no WebGL already takes — so `map_ready` is still
      // sent and the gate is still exercised. It goes on the dev server
      // rather than in an init script because a page reaches this suite four
      // ways and only the server is common to all four.
      VITE_E2E_NO_SCENE: '1',
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
