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
