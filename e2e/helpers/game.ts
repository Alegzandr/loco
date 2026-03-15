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
  unoBtn: 'UNO!',
  catchBtn: 'Catch!',
  rulesBtn: 'Rules',
  continueBtn: 'Continue',
  playAgain: 'Play Again',
  gameOver: 'Game Over',
  youWin: 'You Win!',
  spectating: 'You finished! Watching the round\u2026',
} as const

/** Navigate to home and create a room with the given nickname. Returns the room code. */
export async function createRoom(page: Page, nickname: string): Promise<string> {
  await page.goto('/')
  await expect(page.getByText('LOCO')).toBeVisible()

  await page.getByRole('button', { name: T.createRoom }).click()
  await page.getByPlaceholder('Your nickname').fill(nickname)
  await page.getByRole('button', { name: T.createGame }).click()

  await expect(page.getByText(T.waitingRoom)).toBeVisible()

  // Room code is displayed in the waiting room
  const codeEl = page.locator('[class*="codeVal"]').first()
  const code = await codeEl.textContent()
  if (!code) throw new Error('Could not read room code from waiting room')
  return code.trim()
}

/** Join a room from the lobby with the given nickname and room code. */
export async function joinRoom(page: Page, nickname: string, roomCode: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('button', { name: T.joinRoom }).click()
  await page.getByPlaceholder('Your nickname').fill(nickname)
  await page.getByPlaceholder('Room code').fill(roomCode)
  await page.getByRole('button', { name: T.joinGame }).click()
  await expect(page.getByText(T.waitingRoom)).toBeVisible()
}

/** Add one bot in the waiting room (host only). */
export async function addBot(page: Page): Promise<void> {
  await page.getByRole('button', { name: T.addBot }).click()
}

/** Start the game from the waiting room (host only). */
export async function startGame(page: Page): Promise<void> {
  await page.getByRole('button', { name: T.startGame }).click()
  // Canvas appears once the game has started
  await expect(page.locator('canvas')).toBeVisible({ timeout: 10_000 })
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
  await expect(page.getByText(/Complete/)).toBeVisible({ timeout: 5_000 })
}

/** Wait for the game-over screen (screen='gameover'). */
export async function waitForGameOver(page: Page, timeoutMs = 120_000): Promise<void> {
  await page.waitForFunction(
    () => window.__LOCO_E2E__?.getState?.()?.screen === 'gameover',
    undefined,
    { timeout: timeoutMs },
  )
  await expect(
    page.getByText(T.youWin).or(page.getByText(T.gameOver)),
  ).toBeVisible({ timeout: 5_000 })
}

/**
 * Click the Continue button to dismiss the round summary.
 * Assumes the round summary is currently visible.
 */
export async function clickContinue(page: Page): Promise<void> {
  await page.getByText(T.continueBtn, { exact: false }).click()
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
 * - wild / wild_draw_four → play with chosen_color 'red'
 * - swap → play with first non-finished opponent
 * - global_switch / regular card → play directly
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
    if (playable.kind === 'wild' || playable.kind === 'wild_draw_four') {
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
    // Must absorb the penalty
    await sendMsg(page, { type: 'draw_card' })
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
