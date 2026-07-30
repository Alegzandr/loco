import { Page, expect } from '@playwright/test'

/** Text labels from the English translations (en.ts). */
export const T = {
  createRoom: 'Create Room',
  joinRoom: 'Join Room',
  createGame: 'Create Game',
  joinGame: 'Join Game',
  addBot: '+ Add Bot',
  startGame: 'Start Game',
  waitingRoom: 'Waiting Room',
  draw: 'Draw',
  pass: 'Pass',
  unoBtn: 'LOCO!',
  catchBtn: 'Catch!',
  rulesBtn: 'Rules',
  continueBtn: 'Continue',
  rematch: 'Rematch',
  rematchWaiting: 'Waiting for the host to start a rematch…',
  leaveRoom: 'Leave room',
  gameOver: 'Game Over',
  youWin: 'You Win!',
  winsRound: 'wins the round!',
  drawPile: 'Draw pile',
  interruptTitle: 'INTERCEPTED!',
} as const

interface DebugHandOverride {
  playerIndex: number
  hand: E2ECard[]
}

async function forceEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem('loco_lang', 'en')
    } catch {
      // noop
    }
  })
}

async function clickWithRetry(locator: ReturnType<Page['getByRole']>, retries = 3): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await locator.click({ timeout: 5_000 })
      return
    } catch (err) {
      if (i === retries - 1) throw err
      await locator.page().waitForTimeout(200)
    }
  }
}

/** Navigate to home and create a room with the given nickname. Returns the room code. */
export async function createRoom(page: Page, nickname: string): Promise<string> {
  await forceEnglish(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(600)
  await expect(page.getByText('LOCO')).toBeVisible()
  await page.getByRole('button', { name: T.createRoom }).click()
  await page.getByPlaceholder('Your nickname').fill(nickname)

  for (let i = 0; i < 3; i++) {
    await clickWithRetry(page.getByRole('button', { name: T.createGame }))
    const reachedWaiting = await page
      .waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
        undefined,
        { timeout: 4_000 },
      )
      .then(() => true)
      .catch(() => false)
    if (reachedWaiting) {
      break
    }
    if (i === 2) {
      throw new Error('createRoom: failed to reach waiting screen')
    }
    await page.waitForTimeout(400)
  }

  // Room code is displayed in the waiting room
  const codeEl = page.locator('[class*="codeVal"]').first()
  const code = await codeEl.textContent()
  if (!code) throw new Error('Could not read room code from waiting room')
  return code.trim()
}

/** Join a room from the lobby with the given nickname and room code. */
export async function joinRoom(page: Page, nickname: string, roomCode: string): Promise<void> {
  await forceEnglish(page)
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: T.joinRoom }).click()
  await page.getByPlaceholder('Your nickname').fill(nickname)
  await page.getByPlaceholder('Room code').fill(roomCode)

  for (let i = 0; i < 3; i++) {
    await clickWithRetry(page.getByRole('button', { name: T.joinGame }))
    const reachedWaiting = await page
      .waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
        undefined,
        { timeout: 4_000 },
      )
      .then(() => true)
      .catch(() => false)
    if (reachedWaiting) return
    if (i === 2) {
      throw new Error('joinRoom: failed to reach waiting screen')
    }
    await page.waitForTimeout(400)
  }
}

/** Add one bot in the waiting room (host only). */
export async function addBot(page: Page): Promise<void> {
  await page.getByRole('button', { name: T.addBot }).click()
}

/**
 * Wait for the map-loading gate to open on this page.
 *
 * The server refuses every gameplay message between game_started and
 * match_ready, so a test that starts acting on the board as soon as it appears
 * gets "waiting for every player to load the table" and then blocks reading a
 * reply that never comes. The client answers on its own (it preloads the map
 * and sends map_ready); this only waits for the answer to land.
 */
export async function waitForTableOpen(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.mapLoading == null,
    undefined,
    { timeout: timeoutMs },
  )
}

/**
 * Start the game from the waiting room (host only).
 *
 * Returns once the table is genuinely open, not merely once the board is on
 * screen: the loading gate sits between the two.
 */
export async function startGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: T.startGame }).click()
  await expect(gameBoard(page)).toBeVisible({ timeout: 10_000 })
  await waitForTableOpen(page)
}

/**
 * Locator for the React game board. Use this instead of `page.locator('canvas')`;
 * the legacy PixiJS renderer (which mounted a <canvas>) has been replaced.
 */
export function gameBoard(page: Page) {
  return page.getByTestId('game-board')
}

/** Set the match format from the waiting room (host only). */
export async function setMatchFormat(
  page: Page,
  format: 'BO1' | 'BO3' | 'BO5' | 'BO7',
): Promise<void> {
  await sendMsg(page, { type: 'set_match_format', match_format: format })
}

/** Wait until it's the local player's turn (up to timeoutMs). */
export async function waitForMyTurn(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = window.__LOCO_E2E__?.getState?.()
      return state?.currentTurn === state?.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

/** Return the local player's current hand from the store. */
export async function getHand(page: Page): Promise<E2ECard[]> {
  return page.evaluate(() => window.__LOCO_E2E__?.getState?.()?.myHand ?? [])
}

/** Return the full game state from the store. */
export async function getState(page: Page) {
  return page.evaluate(() => window.__LOCO_E2E__?.getState?.())
}

/**
 * Play a card via the window helper (bypasses canvas hit-testing).
 * The helper still calls handleCardClick which animates and sends the WebSocket message,
 * giving the same server-side path as a real click.
 */
export async function playCard(page: Page, card: E2ECard): Promise<void> {
  await page.evaluate((c) => window.__LOCO_E2E__?.playCard?.(c), card)
}

/** Send a raw message via the window helper. */
export async function sendMsg(page: Page, msg: object): Promise<void> {
  await page.evaluate((m) => window.__LOCO_E2E__?.send?.(m), msg)
}

/**
 * Draw then pass on our turn.
 * Useful to advance a turn without finding a playable card.
 */
export async function drawAndPass(page: Page): Promise<void> {
  await waitForMyTurn(page)
  await sendMsg(page, { type: 'draw_card' })
  // Wait for hasDrawn=true
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
    undefined,
    { timeout: 10_000 },
  )
  await sendMsg(page, { type: 'pass_turn' })
}

/** Wait for the round summary overlay to appear. */
export async function waitForRoundSummary(page: Page, timeoutMs = 60_000): Promise<void> {
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === true,
    undefined,
    { timeout: timeoutMs },
  )
  await expect(page.getByText(T.continueBtn, { exact: false })).toBeVisible({ timeout: 5_000 })
}

/** Close the rules modal via the explicit aria-label close button. */
export async function closeRulesModal(page: Page): Promise<void> {
  const close = page.getByLabel('Close').first()
  await expect(close).toBeVisible({ timeout: 5_000 })
  await close.click()
}

/** Wait for the game-over screen (screen='gameover'). */
export async function waitForGameOver(page: Page, timeoutMs = 120_000): Promise<void> {
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
    undefined,
    { timeout: timeoutMs },
  )
  // The host always gets the rematch button; everyone gets a way out of the room.
  await expect(page.getByRole('button', { name: T.leaveRoom })).toBeVisible({ timeout: 5_000 })
}

/** Click Rematch on the game-over screen (host only) and wait for the lobby. */
export async function clickRematch(page: Page): Promise<void> {
  await page.getByRole('button', { name: T.rematch }).click()
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
    undefined,
    { timeout: 10_000 },
  )
}

/**
 * Dismiss the round summary, and return once it is actually gone.
 *
 * What this waits on is the *state*, never the gesture. The summary auto-dismisses
 * after ROUND_SUMMARY_AUTO_DISMISS_MS (8s), so a click that loses that race can
 * never land — the button is detached and nothing recreates it, since the caller
 * is blocked here and never forces the next round. Playwright then retries into
 * the test timeout while the app has in fact done exactly what was asked.
 *
 * Assumes the round summary is currently visible.
 */
export async function clickContinue(page: Page): Promise<void> {
  const btn = page.getByText(T.continueBtn, { exact: false })
  await btn.waitFor({ state: 'visible' })
  // The summary card springs in over ~420ms. waitForRoundSummary resolves on the
  // store flag, which flips before that animation has settled, so clicking
  // straight away races a moving target and Playwright rightly refuses.
  //
  // The animations must have *started* to be worth waiting on: a CSS animation
  // only begins on the frame after the node is inserted, and `every` on an empty
  // list is true, so the naive check sailed straight through and clicked into the
  // spring.
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector('[class*="roundSummaryCard"]')
        if (!el) return true // already auto-dismissed: nothing left to click
        const anims = el.getAnimations()
        return anims.length > 0 && anims.every((a) => a.playState === 'finished')
      },
      undefined,
      { timeout: 3_000 },
    )
    .catch(() => {
      // Reduced motion, or the card settled before we looked: nothing to wait for.
    })
  await btn.click({ timeout: 5_000 }).catch(() => {
    // Lost the race with the auto-dismiss. The summary is closing anyway.
  })
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === false,
    undefined,
    { timeout: 10_000 },
  )
}

/**
 * Wait for pendingDraw to reach at least `min` (default 1) in the store.
 * This happens when a +2 or +4 is played targeting the current player.
 */
export async function waitForPendingDraw(
  page: Page,
  min = 1,
  timeoutMs = 60_000,
): Promise<void> {
  await page.waitForFunction(
    (threshold: number) => (window.__LOCO_E2E__?.getState?.()?.pendingDraw ?? 0) >= threshold,
    min,
    { timeout: timeoutMs },
  )
}

/**
 * Wait for any player to declare UNO (store.unoDeclared === true).
 * Bots auto-declare when they play to 1 card.
 */
export async function waitForUnoDeclared(page: Page, timeoutMs = 90_000): Promise<void> {
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.unoDeclared === true,
    undefined,
    { timeout: timeoutMs },
  )
}

/**
 * Wait for the round number in the store to reach at least `n`.
 * Useful after dismissing a round summary to confirm the next round started.
 */
export async function waitForRoundNumber(
  page: Page,
  n: number,
  timeoutMs = 30_000,
): Promise<void> {
  await page.waitForFunction(
    (target: number) => (window.__LOCO_E2E__?.getState?.()?.roundNumber ?? 0) >= target,
    n,
    { timeout: timeoutMs },
  )
}

/**
 * Take one turn: play the best available card, or draw+pass if nothing is playable.
 *
 * Uses raw sendMsg to avoid ColorPicker / PlayerPicker modals:
 * - wild / wild_draw_four / global_switch → play with chosen_color 'red'
 * - swap → play with first non-finished opponent
 * - regular card → play directly
 * - nothing playable → draw_card then pass_turn
 *
 * Skips silently if it is not our turn or the game is not in the 'game' screen.
 */
export async function takeTurn(page: Page, turnTimeoutMs = 20_000): Promise<void> {
  await waitForMyTurn(page, turnTimeoutMs)

  const state = await getState(page)
  if (!state || state.screen !== 'game' || state.showRoundSummary) return

  const me = state.players.find((p) => p.index === state.myIndex)
  if (me?.finished) return

  const { myHand, discard, activeColor, pendingDraw } = state
  const hand = myHand ?? []

  const playable = hand.find((c) => {
    if ((pendingDraw ?? 0) > 0) {
      // Under active draw stack only counter cards are valid
      return c.kind === 'draw_two' || c.kind === 'wild_draw_four'
    }
    if (
      c.kind === 'wild' ||
      c.kind === 'wild_draw_four' ||
      c.kind === 'swap' ||
      c.kind === 'global_switch'
    )
      return true
    if (!discard) return true
    if (c.color === activeColor) return true
    if (c.kind !== 'number' && c.kind === discard.kind) return true
    if (c.kind === 'number' && discard.kind === 'number') return c.value === discard.value
    return false
  })

  if (playable) {
    if (
      playable.kind === 'wild' ||
      playable.kind === 'wild_draw_four' ||
      playable.kind === 'global_switch'
    ) {
      await sendMsg(page, { type: 'play_card', card: playable, chosen_color: 'red' })
    } else if (playable.kind === 'swap') {
      const opponents = state.players.filter(
        (p) => p.index !== state.myIndex && !p.finished,
      )
      if (opponents.length > 0) {
        await sendMsg(page, {
          type: 'play_card',
          card: playable,
          chosen_player: opponents[0].index,
        })
      } else {
        // No valid swap target — fall back to draw+pass
        await sendMsg(page, { type: 'draw_card' })
        await page.waitForFunction(
          () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
          undefined,
          { timeout: 8_000 },
        )
        await sendMsg(page, { type: 'pass_turn' })
      }
    } else {
      await sendMsg(page, { type: 'play_card', card: playable })
    }
  } else if ((pendingDraw ?? 0) > 0) {
    // Must absorb the penalty. It no longer costs the turn (rules.md §14.5), so
    // pass explicitly — otherwise the caller waits forever for the turn to move.
    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
      undefined,
      { timeout: 8_000 },
    )
    await sendMsg(page, { type: 'pass_turn' })
  } else {
    // Voluntary draw then pass
    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
      undefined,
      { timeout: 8_000 },
    )
    await sendMsg(page, { type: 'pass_turn' })
  }
}

/**
 * Inject specific game state via the debug_set_state WebSocket message.
 *
 * Requires the server to be running with LOCO_E2E=1 (set in docker-compose.dev.yml
 * and in the CI e2e_test script).  Any combination of the options may be provided;
 * omitted fields leave the existing server state unchanged.
 *
 * After the server applies the changes it broadcasts a game_state message to all
 * players, so the store updates automatically before this function returns.
 *
 * Options:
 *   hand         — Replace the local player's entire hand with these cards.
 *   discard      — Replace the top of the discard pile with this card.
 *   activeColor  — Override the active color (required when setting a wild discard).
 *   pendingDraw  — Override the accumulated draw-penalty count.
 *   currentTurn  — Override which seat holds the turn.
 *   direction    — Pin the play direction (1 clockwise, -1 counter-clockwise).
 *                  Any test that computes "the next seat" must set this: the bots
 *                  play before the local player's first turn and a Reverse among
 *                  them mirrors the table.
 *
 * @example
 *   // Give the player a Swap card, set a red discard so it's playable:
 *   await debugSetState(page, {
 *     hand: [{ color: 'wild', kind: 'swap' }],
 *     discard: { color: 'red', kind: 'number', value: 5 },
 *   })
 */
export async function debugSetState(
  page: Page,
  opts: {
    hand?: E2ECard[]
    hands?: DebugHandOverride[]
    discard?: E2ECard
    activeColor?: string
    pendingDraw?: number
    currentTurn?: number
    direction?: number
  },
): Promise<void> {
  const msg: Record<string, unknown> = { type: 'debug_set_state' }
  if (opts.hand !== undefined) msg.debug_hand = opts.hand
  if (opts.hands !== undefined) {
    msg.debug_hands = opts.hands.map((h) => ({
      player_index: h.playerIndex,
      hand: h.hand,
    }))
  }
  if (opts.discard !== undefined) msg.debug_discard = opts.discard
  if (opts.activeColor !== undefined) msg.debug_active_color = opts.activeColor
  if (opts.pendingDraw !== undefined) msg.debug_pending_draw = opts.pendingDraw
  if (opts.currentTurn !== undefined) msg.debug_current_turn = opts.currentTurn
  if (opts.direction !== undefined) msg.debug_direction = opts.direction
  await sendMsg(page, msg)
  // Give the broadcasted game_state a moment to arrive before the next action.
  await page.waitForTimeout(200)
  // currentTurn can change quickly (e.g. bot takes an automatic move), so do not
  // assert it here; tests that depend on turn ownership should assert immediately
  // after calling debugSetState.
}

/**
 * Participate in up to `maxTurns` of the local player's turns.
 * Stops early if the screen leaves 'game' or the round summary appears.
 */
export async function participateInTurns(page: Page, maxTurns: number): Promise<void> {
  for (let i = 0; i < maxTurns; i++) {
    const state = await getState(page)
    if (!state || state.screen !== 'game' || state.showRoundSummary) break
    const me = state.players.find((p) => p.index === state.myIndex)
    if (me?.finished) break
    try {
      await takeTurn(page, 20_000)
      await page.waitForTimeout(300)
    } catch {
      break
    }
  }
}
