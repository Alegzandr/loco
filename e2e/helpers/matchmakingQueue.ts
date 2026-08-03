/**
 * Exclusive use of the server's matchmaking queue.
 *
 * Every other test in this suite is self-contained because it opens its own
 * table: a room code is private, so two tests can hold two rooms on one server
 * and never see each other. The 1v1 queue is the one thing that is not like
 * that. There is exactly one of it per process, it is a FIFO, and `tryPair`
 * hands seat 0 to whoever is at the front — so a searcher belonging to another
 * test, arriving between this test's two, is paired with one of them. The
 * symptom is not a clean failure either: a test waits out its timeout on a
 * `match_found` that went to a stranger, and the *other* test fails too.
 *
 * `workers: 1` in playwright.config.ts hides this today, and CI's four shards
 * each start their own server-bin, so nothing is currently broken. But
 * `fullyParallel: true` sits right above that line and states the opposite
 * promise, the config invites raising `workers` "deliberately rather than by
 * accident", and doing so would break these six tests in a way that reads as
 * flake rather than as contention. A shared global resource is not a reason to
 * serialise a suite; it is a reason to take a lock on the resource.
 *
 * So: a cross-process mutex, held from the first find_match to after the last
 * socket is gone. Every test stays exactly as self-contained as it was — no
 * state crosses, no ordering is implied, nothing aborts the rest on a failure
 * (which is what `describe.serial` would have bought and why CLAUDE.md refuses
 * it). A test waits for the queue the way it would wait for a port.
 */
import { mkdirSync, rmSync, readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from '@playwright/test'

const LOCK_DIR = join(tmpdir(), 'loco-e2e-matchmaking.lock')
const OWNER_FILE = join(LOCK_DIR, 'owner')

/**
 * How long a lock may be held before it is assumed to belong to a dead run.
 *
 * Above the longest test that takes it (the double-deal rematch, 90s) and not
 * much above: Playwright aborts a timed-out test at its next await, so a
 * `finally` that had not been reached yet never runs and the lock is leaked by a
 * process that is still very much alive. `ownerAlive` cannot see that, so this
 * is what frees it — on a run that is already failing, and only for as long as
 * the slowest legitimate holder could plausibly still be working.
 */
const STALE_MS = 100_000
/** How long a test will wait for its turn before giving up loudly. */
const WAIT_MS = 180_000
const POLL_MS = 50

/**
 * How long to wait for the server's queue to actually be empty once the lock is
 * held, and how often to ask.
 *
 * Holding the mutex is not the whole guarantee. Closing a browser context tears
 * the WebSocket down, but the dequeue happens on the hub's own goroutine a
 * moment later, so the previous test's searcher can still be at the front of the
 * FIFO when the next test enqueues — and then it is paired with the first of
 * this test's two. A fixed sleep was the first shape of this and it is exactly
 * the wrong instrument: too short under load, wasted otherwise, and silent
 * either way. `/metrics` publishes `matchmaking_queue`, so the condition is
 * observable and is waited on rather than estimated.
 */
const DRAIN_MS = 10_000
const DRAIN_POLL_MS = 50

/**
 * Where the Go server is. The suite already assumes :8080 (playwright.config.ts
 * passes VITE_WS_PORT=8080 to the client), and /metrics is served beside /ws.
 */
const METRICS_URL = `http://localhost:${process.env.VITE_WS_PORT ?? '8080'}/metrics`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * How many sockets the server currently has in the 1v1 queue, or null when the
 * number cannot be read.
 *
 * This is the only place in the suite that reads an operator surface, and it is
 * worth saying why it is not a test smell: the queue's size is deliberately
 * never on the wire (see hub/matchmaking.go), so there is no client-visible way
 * to ask "is the queue empty" — and that is precisely the question a test has to
 * answer before it can trust a pairing to be its own.
 */
async function queuedCount(): Promise<number | null> {
  try {
    const res = await fetch(METRICS_URL)
    if (!res.ok) return null
    const body = (await res.json()) as { matchmaking_queue?: number }
    return typeof body.matchmaking_queue === 'number' ? body.matchmaking_queue : null
  } catch {
    return null
  }
}

/** Wait until nobody is left in the server's queue. */
async function waitForEmptyQueue(): Promise<void> {
  const deadline = Date.now() + DRAIN_MS
  for (;;) {
    const n = await queuedCount()
    // null means /metrics is not reachable — an older server, or a run pointed
    // somewhere else. The mutex alone is still most of the guarantee, so this
    // degrades to it rather than failing a test for the wrong reason.
    if (n === null || n === 0) return
    if (Date.now() > deadline) {
      throw new Error(
        `the server's matchmaking queue still holds ${n} searcher(s) after ${DRAIN_MS / 1000}s. ` +
          'A previous test left somebody in it, or another process is talking to this server.',
      )
    }
    await sleep(DRAIN_POLL_MS)
  }
}

/** Whether the process that wrote the lock is still running. */
function ownerAlive(): boolean {
  let pid: number
  try {
    pid = Number(readFileSync(OWNER_FILE, 'utf8').split(' ')[0])
  } catch {
    // Written between our mkdir failing and this read, or never written at all.
    // Treat as alive: the STALE_MS backstop below still frees it.
    return true
  }
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Whether the lock has been held long enough to be a leftover. */
function heldTooLong(): boolean {
  try {
    return Date.now() - statSync(LOCK_DIR).mtimeMs > STALE_MS
  } catch {
    return false
  }
}

/**
 * The running test's timeout budget, adjusted so that time spent queuing behind
 * another worker does not come out of it.
 *
 * Six tests serialising, two of them dealt in twice, is comfortably more than
 * the 30s default before the last one has opened a page. Compensating *after*
 * acquiring the lock is too late and was the first shape of this: the test's
 * clock is already running while it waits, so it expires inside the polling loop
 * and reports "Test timeout of 30000ms exceeded", which reads as a slow app
 * rather than as a queue.
 *
 * So the budget is raised before the wait and trimmed back to what the wait
 * actually cost afterwards. Playwright counts a test's timeout from the moment
 * it started, which is what makes both halves of that arithmetic honest.
 */
function borrowTime(): (spent: number) => void {
  const base = test.info().timeout
  // Zero means "no timeout"; adding to it would invent one.
  if (base === 0) return () => {}
  test.setTimeout(base + WAIT_MS + DRAIN_MS)
  return (spent: number) => test.setTimeout(base + spent)
}

export interface QueueClaim {
  /**
   * Give the queue back. Call it in the test's `finally`, **after** the browser
   * contexts are closed: a test that ends with somebody still searching (the
   * cancel test does, on purpose) would otherwise hand the next test a partner
   * it never asked for. Whoever claims it next waits for the server to agree the
   * queue is empty, so the hand-off does not depend on how fast that happened.
   */
  release(): void
}

/**
 * Take exclusive use of the matchmaking queue, waiting for whoever has it.
 *
 * mkdir is the primitive rather than a flag on open: it is atomic on every
 * platform this suite runs on, needs no cleanup discipline beyond an rm, and a
 * directory that exists *is* the lock, so there is no window where the file is
 * created but not yet claimed.
 */
export async function claimMatchmakingQueue(): Promise<QueueClaim> {
  const startedWaiting = Date.now()
  const deadline = startedWaiting + WAIT_MS
  // Before the first poll, not after the last: the test's clock is running the
  // whole time it waits here.
  const settleUp = borrowTime()
  for (;;) {
    try {
      mkdirSync(LOCK_DIR)
      writeFileSync(OWNER_FILE, `${process.pid} ${Date.now()}`)
      // Held first, drained second: waiting for an empty queue is only
      // meaningful once nobody else is allowed to fill it.
      try {
        await waitForEmptyQueue()
      } catch (err) {
        rmSync(LOCK_DIR, { recursive: true, force: true })
        throw err
      }
      settleUp(Date.now() - startedWaiting)
      return {
        release() {
          rmSync(LOCK_DIR, { recursive: true, force: true })
        },
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
    }
    // A worker killed mid-test (a Ctrl-C, a crashed browser) would otherwise
    // lock the queue for every later run on this machine, which is a failure
    // mode far worse than the one being fixed.
    if (!ownerAlive() || heldTooLong()) {
      rmSync(LOCK_DIR, { recursive: true, force: true })
      continue
    }
    if (Date.now() > deadline) {
      throw new Error(
        `timed out after ${WAIT_MS / 1000}s waiting for the matchmaking queue (${LOCK_DIR}). ` +
          'Another test is holding it, or a previous run left it behind.',
      )
    }
    await sleep(POLL_MS)
  }
}
