/**
 * game-flow.spec.ts
 *
 * Full happy-path gameplay flow tested from a single browser:
 *   create room → add bot → start game → play/draw → round summary → game over
 *
 * The Go server must be running on :8080 before these tests run.
 * In CI the server binary is started by the pipeline; locally use docker-compose.dev.yml.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  addBot,
  startGame,
  waitForMyTurn,
  getHand,
  getState,
  playCard,
  drawAndPass,
  waitForRoundSummary,
  waitForGameOver,
  sendMsg,
  closeRulesModal,
  debugSetState,
  waitForTableOpen,
  gameBoard,
  forceEnglish,
  waitForSocket,
} from '../helpers/game'

test.describe('gameplay flow (single player vs bot)', () => {
  /**
   * Verify the lobby is rendered correctly before any interaction.
   */
  test('app loads and shows lobby', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'LOCO' })).toBeVisible()
    await expect(page.getByRole('button', { name: T.createRoom })).toBeVisible()
    await expect(page.getByRole('button', { name: T.joinRoom })).toBeVisible()
    await expect(page.getByRole('button', { name: T.rulesBtn })).toBeVisible()
  })

  /**
   * The nickname is validated in two places and refused with one sentence.
   *
   * The client answers the shapes it can judge on its own as they are typed;
   * the word list is the server's, so a blocked term costs a round trip. The
   * test asserts both, and asserts they are indistinguishable: a player who
   * could tell which half refused them could read the rule off the message.
   * See server/game/nickname.go.
   */
  test('a nickname the game refuses never opens a table, and never says why', async ({ page }) => {
    await forceEnglish(page)
    await page.goto('/')
    await waitForSocket(page)
    await page.getByRole('button', { name: T.createRoom }).click()
    const field = page.getByPlaceholder(T.yourNickname)

    // A zero-width space between two ordinary letters: invisible, and a seat
    // label nobody else can type. Refused client-side, as it is typed.
    await field.fill('Ali​ce')
    await expect(page.getByRole('alert')).toHaveText(T.nicknameRejected)
    await page.getByRole('button', { name: T.createGame }).click()
    await expect
      .poll(() => page.evaluate(() => window.__LOCO_E2E__?.getState?.()?.screen))
      .toBe('lobby')

    // A blocked term is shaped like a name, so it goes to the server. Same
    // sentence back.
    await field.fill('salope')
    await expect(page.getByRole('alert')).toBeHidden()
    await page.getByRole('button', { name: T.createGame }).click()
    await expect(page.getByRole('alert')).toHaveText(T.nicknameRejected)
    await expect
      .poll(() => page.evaluate(() => window.__LOCO_E2E__?.getState?.()?.screen))
      .toBe('lobby')

    // And an ordinary name still opens a table from the same field.
    await field.fill('Alice')
    await page.getByRole('button', { name: T.createGame }).click()
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.screen === 'waiting',
      undefined,
      { timeout: 5_000 },
    )
  })

  /**
   * Create room → reach waiting room with a valid 6-character room code.
   */
  test('create room reaches waiting room with room code', async ({ page }) => {
    const code = await createRoom(page, 'Alice')
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    // Host badge visible
    await expect(page.getByText('Host')).toBeVisible()
    // Alice in player list
    await expect(page.getByText('Alice')).toBeVisible()
  })

  /**
   * Rules modal is accessible from the waiting room.
   */
  test('rules modal opens and closes from waiting room', async ({ page }) => {
    await createRoom(page, 'Alice')
    await page.getByRole('button', { name: T.rulesBtn }).click()
    await expect(page.getByText(T.rulesTitle)).toBeVisible()
    await closeRulesModal(page)
    await expect(page.getByText(T.rulesTitle)).not.toBeVisible()
  })

  /**
   * Adding a bot puts it in the player list; starting the game shows the canvas.
   */
  test('add bot and start game shows canvas and action bar', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Canvas is the PixiJS rendering surface
    await expect(gameBoard(page)).toBeVisible()
    await waitForTableOpen(page)
    // Action bar is always in the DOM during a game
    await expect(page.locator('[class*="actionBar"]')).toBeVisible()
  })

  /**
   * Full game flow: from lobby to game over.
   * Steps:
   *  1. Create room, add bot, start game
   *  2. On our turn: draw, then pass (or play a valid card if we have one)
   *  3. Wait for round summary
   *  4. Dismiss summary and wait for game over (BO1, so one round = match end)
   */
  test('complete BO1 bot game reaches game over', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponentIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: [{ playerIndex: opponentIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
    await waitForRoundSummary(page, 20_000)

    // Summary shows round winner and "Complete"
    await expect(page.getByText(new RegExp(T.winsRound))).toBeVisible()
    await expect(page.getByText(T.continueBtn, { exact: false })).toBeVisible()

    // Dismiss summary → game over (BO1 ends after one round)
    await page.getByText(T.continueBtn, { exact: false }).click()

    await waitForGameOver(page, 30_000)

    // Game over offers the host a rematch and everyone a way out
    await expect(page.getByRole('button', { name: T.rematch })).toBeVisible()
    await expect(page.getByRole('button', { name: T.leaveRoom })).toBeVisible()
  })

  /**
   * Draw card: clicking Draw during our turn adds a card and enables Pass.
   */
  test('draw and pass actions work on our turn', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const initial = await getState(page)
    const myIdx = initial?.myIndex ?? 0

    // Force a deterministic state: no pending draw, our turn, known hand,
    // discard mismatched in color/value so we cannot play and must draw.
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 1 }],
      discard: { color: 'blue', kind: 'number', value: 9 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    const handBefore = await getHand(page)

    // Draw a card
    await sendMsg(page, { type: 'draw_card' })

    // Hand should grow and hasDrawn should become true
    await page.waitForFunction(
      (prevSize: number) => {
        const state = window.__LOCO_E2E__?.getState?.()
        return state?.hasDrawn === true && (state?.myHand?.length ?? 0) >= prevSize
      },
      handBefore.length,
      { timeout: 10_000 },
    )

    const handAfter = await getHand(page)
    expect(handAfter.length).toBeGreaterThanOrEqual(handBefore.length)

    // Pass turn
    await sendMsg(page, { type: 'pass_turn' })

    // Turn should pass away from us
    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s !== undefined && s.currentTurn !== s.myIndex
      },
      undefined,
      { timeout: 10_000 },
    )
  })

  /**
   * The action bar's centre slot belongs to Catch, and LOCO only borrows it at
   * exactly one card. On a fresh deal (8 cards, nobody catchable) the centre
   * therefore holds a disabled Catch and no LOCO button exists at all.
   */
  test('centre slot holds a disabled catch button on a fresh deal', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const catchBtn = page.getByRole('button', { name: T.catchBtn })
    await expect(catchBtn).toBeVisible({ timeout: 10_000 })
    await expect(catchBtn).toBeDisabled()
    await expect(page.getByRole('button', { name: T.unoBtn })).toHaveCount(0)
  })

  /**
   * Rules modal opens from within the game and can be closed.
   */
  test('rules modal is accessible during game', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Rules button is top-right of game view
    await page.getByRole('button', { name: T.rulesBtn }).click()
    await expect(page.getByText(T.rulesTitle)).toBeVisible()

    // Close by pressing Escape
    await page.keyboard.press('Escape')
    await expect(page.getByText(T.rulesTitle)).not.toBeVisible()

    // Game is still running
    await expect(gameBoard(page)).toBeVisible()
    await waitForTableOpen(page)
  })

  /**
   * Leave room abandons the session and returns to the lobby screen.
   */
  test('leave room returns to lobby after game over', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponentIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: [{ playerIndex: opponentIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
    await waitForRoundSummary(page, 20_000)
    await page.getByText(T.continueBtn, { exact: false }).click()
    await waitForGameOver(page, 30_000)

    await page.getByRole('button', { name: T.leaveRoom }).click()

    // After reload, lobby is visible again
    await expect(page.getByRole('heading', { name: 'LOCO' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: T.createRoom })).toBeVisible()
  })
})
