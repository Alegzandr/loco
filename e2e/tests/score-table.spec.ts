/**
 * score-table.spec.ts
 *
 * The in-game standings overlay: held open with TAB, pinned with the icon
 * button that exists on touch layouts only (where there is no TAB key), and fed
 * by two server-owned streams the client cannot fabricate, the per-round
 * history and the periodic ping.
 *
 * The ping assertion is the one that exercises the whole chain: the server
 * writes a WebSocket ping frame, Chromium answers it in the transport layer
 * with no page code involved, the hub folds the round trip into a smoothed
 * value and broadcasts it. Nothing here is measurable client-side, which is
 * exactly why it is worth an end-to-end test.
 */
import { test, expect } from '@playwright/test'
import {
  T,
  createRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  waitForRoundSummary,
  clickContinue,
  setMatchFormat,
  debugSetState,
  winWith,
} from '../helpers/game'

const scoreTable = (page: Parameters<typeof getState>[0]) => page.getByTestId('score-table')

/**
 * Holds the standings open for the duration of `body`. The button is a
 * touch-only affordance now, so on the desktop project TAB is the way in.
 */
async function holdScores(page: Parameters<typeof getState>[0], body: () => Promise<void>) {
  await page.keyboard.down('Tab')
  try {
    await body()
  } finally {
    await page.keyboard.up('Tab')
  }
}

test.describe('in-game score table', () => {
  /** Ends the current round with the local player as the finisher. */
  async function winRound(page: Parameters<typeof getState>[0]) {
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const opponents = (s?.players ?? []).filter((p) => p.index !== myIdx)
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      hands: opponents.map((p, i) => ({
        playerIndex: p.index,
        hand: [{ color: i % 2 === 0 ? 'blue' : 'green', kind: 'number', value: 9 - i }],
      })),
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await winWith(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })
  }

  test('TAB holds the table open and releasing it closes the table', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await expect(scoreTable(page)).toBeHidden()

    await page.keyboard.down('Tab')
    await expect(scoreTable(page)).toBeVisible()
    await expect(scoreTable(page).getByText('Alice')).toBeVisible()
    await expect(scoreTable(page).getByText('Bot1')).toBeVisible()

    await page.keyboard.up('Tab')
    await expect(scoreTable(page)).toBeHidden()
  })

  // TAB is the scoreboard key and nothing else at the table: it opens the panel
  // on the press itself, and it moves no focus while it is down. Shift+TAB is
  // never taken — it is the whole keyboard path around the board, so a keyboard
  // user is not trapped by a panel they cannot leave.
  test('TAB moves no focus, and Shift+TAB still walks the board without opening it', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // The focus is parked on a real control first, and marked, because the two
    // keys are indistinguishable from a cold start: Chrome resumes its
    // sequential order outside the document, so with nothing focused Shift+TAB
    // walks into the browser's own chrome and `activeElement` stays on <body>
    // whether or not the page swallowed the key. The board's chips are icon
    // buttons, so the mark is what tells them apart, not their text.
    const anchored = await page.evaluate(() => {
      // Visible ones only: the scores button is `display: none` on a desktop
      // layout, and focusing a hidden element does nothing at all.
      const live = [...document.querySelectorAll<HTMLElement>('button:not([disabled])')].filter(
        (el) => el.offsetParent !== null,
      )
      const el = live[live.length - 1]
      if (!el) return false
      el.dataset.e2eAnchor = '1'
      el.focus()
      return document.activeElement === el
    })
    expect(anchored, 'nothing on the board took the focus').toBe(true)

    const onAnchor = () =>
      page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.dataset.e2eAnchor === '1',
      )

    await page.keyboard.down('Tab')
    await expect(scoreTable(page)).toBeVisible()
    expect(await onAnchor(), 'TAB moved the focus under the open panel').toBe(true)
    await page.keyboard.up('Tab')
    await expect(scoreTable(page)).toBeHidden()

    // The modified key belongs to the browser: it navigates, and it opens
    // nothing.
    await page.keyboard.press('Shift+Tab')
    await expect(scoreTable(page)).toBeHidden()
    expect(await onAnchor(), 'Shift+TAB was swallowed too').toBe(false)
  })

  test('the button is a touch affordance: absent on desktop, pins the table on a phone', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Desktop has TAB, so the cluster does not carry the button at all.
    const btn = page.getByRole('button', { name: 'Scores' })
    await expect(btn).toBeHidden()

    await page.setViewportSize({ width: 390, height: 844 })
    await btn.click()
    await expect(scoreTable(page)).toBeVisible()

    // Pinned means pinned: a TAB press and release must not close it.
    await page.keyboard.down('Tab')
    await page.keyboard.up('Tab')
    await expect(scoreTable(page)).toBeVisible()

    // The panel is what a player opened in order to read, so nothing the board
    // draws crosses it — the chip row that pinned it included. The way out is
    // therefore on the panel: the ✕ in its header, which exists only while it is
    // pinned, or a press anywhere on the scrim.
    const covered = await btn.evaluate((el) => {
      const r = el.getBoundingClientRect()
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!top?.closest('[data-testid="score-table"]')
    })
    expect(covered, 'the standings cover the chip row that pinned them').toBe(true)

    await scoreTable(page).getByRole('button', { name: 'Close' }).click()
    await expect(scoreTable(page)).toBeHidden()
  })

  test('a bot seat is labelled instead of showing a ping, a human gets a real measurement', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await holdScores(page, async () => {
      // `exact` because the label and the bot's own nickname are the same word:
      // getByText matches a case-insensitive substring, so a bare 'BOT' catches
      // <span class="nickname">Bot1</span> as well as the ping cell and the
      // assertion dies of its own ambiguity the moment both are on screen.
      await expect(scoreTable(page).getByText('BOT', { exact: true })).toBeVisible()

      // The server pings every 5s and broadcasts every 3s, so the first real
      // number lands within a couple of cycles. Before that the cell says so
      // rather than claiming 0ms.
      await expect(scoreTable(page).getByText(/^\d+ ms$/)).toBeVisible({ timeout: 30_000 })
    })
  })

  test('a finished round adds its own column, holding the points of its winner', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await setMatchFormat(page, 'BO3')
    await startGame(page)

    // Before any round ends there is nothing to tabulate, and the table says so.
    await holdScores(page, async () => {
      await expect(scoreTable(page).getByText(T.scoreTableEmptyRounds)).toBeVisible()
      await expect(scoreTable(page).getByText('R1')).toBeHidden()
    })

    await winRound(page)
    await waitForRoundSummary(page, 20_000)
    await clickContinue(page)

    await holdScores(page, async () => {
      await expect(scoreTable(page).getByText('R1')).toBeVisible()
      // Alice emptied her hand, so hers is the only non-zero cell in that column.
      const aliceRow = scoreTable(page).locator('tr', { hasText: 'Alice' })
      await expect(aliceRow.getByText(/^\+\d+$/)).toBeVisible()
    })
  })

})
