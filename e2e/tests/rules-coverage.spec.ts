/**
 * rules-coverage.spec.ts
 *
 * End-to-end coverage for LOCO rules (docs/rules.md) gaps not already covered
 * by game-flow / multi-client / penalties / round-progression / special-cards.
 *
 * Each test is deterministic, using debugSetState to seed exact hands / discard /
 * activeColor / pendingDraw / currentTurn. Server runs with LOCO_E2E=1
 * (set in docker-compose.dev.yml and CI).
 *
 * Areas covered (rules.md sections in parens):
 *   - Setup invariants: 8 cards / opening discard is a Number (§3, §14.2)
 *   - Card matching: color / number / symbol / wild (§5.1)
 *   - Wild + color picker UI; next play must match chosen color (§5.1, §7)
 *   - Voluntary draw with playable card (§14.4)
 *   - No double draw on same turn (§5.2)
 *   - Drawn card is playable: legal play with second card play (§5.2)
 *   - Skip (Miss a Turn) skips next player; in 2-player A plays again (§7)
 *   - Reverse: 2-player acts as Skip; 4-player flips direction (§7, §11.3)
 *   - Take 2 stacking cumulative (§7) — extends counter_draw test
 *   - Cross-stack rejection: Take 2 onto Take 4 illegal (§7)
 *   - Take 4 + color picker UI (§7)
 *   - Swap as last card → actor wins, swap aborted (§13)
 *   - GlobalSwitch rotates hand sizes; 2-player = mutual swap; as last card → actor wins (§7, §11.3, §13)
 *   - Interjecting: identical card (wilds included), action effect on next-after-interrupter,
 *     LOCO! still required on 2→1 via interject (§6)
 *   - LOCO! NOT required when receiving 1 card via Swap (§11.1)
 */
import { test, expect, Browser, Page } from '@playwright/test'
import {
  T,
  createRoom,
  joinRoom,
  addBot,
  startGame,
  getState,
  sendMsg,
  waitForMyTurn,
  debugSetState,
  gameBoard,
} from '../helpers/game'

async function waitForTurn(page: Page, idx: number, timeoutMs = 10_000) {
  await page.waitForFunction(
    (target: number) => window.__LOCO_E2E__?.getState?.()?.currentTurn === target,
    idx,
    { timeout: timeoutMs },
  )
}

async function waitForOtherTurn(page: Page, timeoutMs = 10_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s !== undefined && s.currentTurn !== s.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

test.describe('rules coverage — setup invariants', () => {
  test('initial deal: 8 cards per player and opening discard is a number', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await addBot(page)
    await startGame(page)

    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return !!s && s.screen === 'game' && (s.myHand?.length ?? 0) > 0 && !!s.discard
      },
      undefined,
      { timeout: 15_000 },
    )

    const s = await getState(page)
    expect(s?.myHand.length).toBe(8)
    // Opening discard MUST be a number (§14.2)
    expect(s?.discard?.kind).toBe('number')
    // Each opponent reports hand_size 8
    const opponents = (s?.players ?? []).filter((p) => p.index !== s?.myIndex)
    for (const op of opponents) {
      expect(op.hand_size).toBe(8)
    }
  })
})

test.describe('rules coverage — card matching (§5.1)', () => {
  test('color match is legal: red 7 plays on red 5', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)

    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 7 },
        { color: 'blue', kind: 'number', value: 1 },
      ],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'number', value: 7 } })

    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s?.discard?.color === 'red' && s?.discard?.value === 7
      },
      undefined,
      { timeout: 5_000 },
    )
    const after = await getState(page)
    expect(after?.errorMsg ?? '').toBe('')
    expect(after?.currentTurn).not.toBe(myIdx)
  })

  test('number match is legal: blue 5 plays on red 5', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [{ color: 'blue', kind: 'number', value: 5 }, { color: 'green', kind: 'number', value: 1 }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'blue', kind: 'number', value: 5 } })

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.color === 'blue',
      undefined, { timeout: 5_000 })
    const after = await getState(page)
    expect(after?.errorMsg ?? '').toBe('')
    expect(after?.discard?.value).toBe(5)
  })

  test('symbol match is legal: blue Skip plays on red Skip', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [
        { color: 'blue', kind: 'skip' },
        { color: 'green', kind: 'number', value: 2 },
      ],
      discard: { color: 'red', kind: 'skip' },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'blue', kind: 'skip' } })

    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s?.discard?.kind === 'skip' && s?.discard?.color === 'blue'
      },
      undefined, { timeout: 5_000 })
    const after = await getState(page)
    expect(after?.errorMsg ?? '').toBe('')
  })

  test('illegal play: blue 5 cannot be played on red 7', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [{ color: 'blue', kind: 'number', value: 5 }, { color: 'red', kind: 'number', value: 1 }],
      discard: { color: 'red', kind: 'number', value: 7 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    // Wait for any prior error to clear
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined, { timeout: 5_000 }).catch(() => undefined)

    await sendMsg(page, { type: 'play_card', card: { color: 'blue', kind: 'number', value: 5 } })

    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined, { timeout: 5_000 })
    const after = await getState(page)
    // Discard unchanged
    expect(after?.discard?.value).toBe(7)
    expect(after?.discard?.color).toBe('red')
    // Still our turn
    expect(after?.currentTurn).toBe(myIdx)
  })
})

test.describe('rules coverage — wild + color picker (§5.1)', () => {
  test('Wild click opens ColorPicker; choosing color sends play with chosen_color', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)

    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [
        { color: 'wild', kind: 'wild' },
        { color: 'red', kind: 'number', value: 1 },
      ],
      discard: { color: 'blue', kind: 'number', value: 9 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    // Click via __LOCO_E2E__.playCard to mimic a UI click (opens picker)
    await page.evaluate(() => window.__LOCO_E2E__?.playCard?.({ color: 'wild', kind: 'wild' }))

    // Picker is shown — pick red (exact match avoids matching in-hand cards)
    const redBtn = page.getByRole('button', { name: 'red', exact: true })
    await expect(redBtn).toBeVisible({ timeout: 5_000 })
    await redBtn.click()

    // Discard updates to wild and active color becomes red
    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s?.discard?.kind === 'wild' && s?.activeColor === 'red'
      },
      undefined, { timeout: 8_000 })

    const after = await getState(page)
    expect(after?.activeColor).toBe('red')
    expect(after?.discard?.kind).toBe('wild')
  })

  test('after wild → red: a non-red non-wild card is rejected', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Set up: Alice on turn, plays a Wild and chooses red. Keep filler so playing
      // doesn't end the round.
      await debugSetState(alice, {
        hand: [
          { color: 'wild', kind: 'wild' },
          { color: 'yellow', kind: 'number', value: 7 },
        ],
        hands: [{ playerIndex: bobIdx, hand: [
          { color: 'blue', kind: 'number', value: 4 }, // not red, not wild → illegal
          { color: 'red', kind: 'number', value: 6 },
        ]}],
        discard: { color: 'blue', kind: 'number', value: 9 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })
      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'wild', kind: 'wild' },
        chosen_color: 'red',
      })

      // Wait for Bob's turn with activeColor=red
      await bob.waitForFunction(
        ([idx]) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return s?.currentTurn === idx && s?.activeColor === 'red'
        },
        [bobIdx] as [number],
        { timeout: 10_000 },
      )

      // Bob attempts illegal blue 4
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'blue', kind: 'number', value: 4 },
      })
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
        undefined, { timeout: 5_000 })
      let bobState = await getState(bob)
      expect(bobState?.currentTurn).toBe(bobIdx)
      expect(bobState?.activeColor).toBe('red')

      // Now Bob plays a legal red
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 6 },
      })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.color === 'red',
        undefined, { timeout: 5_000 })
      bobState = await getState(bob)
      expect(bobState?.discard?.value).toBe(6)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('rules coverage — drawing (§5.2, §14.4)', () => {
  test('voluntary draw is allowed even with a playable card in hand (§14.4)', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0

    await debugSetState(page, {
      // red 7 IS playable on red 5 (color match)
      hand: [{ color: 'red', kind: 'number', value: 7 }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    const before = await getState(page)
    expect(before?.myHand.length).toBe(1)

    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
      undefined, { timeout: 5_000 })

    const after = await getState(page)
    // Hand grew, no error, hasDrawn true, still our turn
    expect(after?.errorMsg ?? '').toBe('')
    expect(after?.hasDrawn).toBe(true)
    expect((after?.myHand.length ?? 0)).toBe(2)
    expect(after?.currentTurn).toBe(myIdx)
  })

  test('cannot draw twice: second draw_card returns an error', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0

    await debugSetState(page, {
      hand: [{ color: 'green', kind: 'number', value: 1 }],
      discard: { color: 'blue', kind: 'number', value: 9 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
      undefined, { timeout: 5_000 })

    // Clear any prior error
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined, { timeout: 5_000 }).catch(() => undefined)

    // Second draw must fail
    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined, { timeout: 5_000 })
  })
})

test.describe('rules coverage — Miss a Turn / Skip (§7)', () => {
  test('2-player: Skip → same player goes again', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0

    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'skip' },
        { color: 'red', kind: 'number', value: 1 },
      ],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'skip' } })

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'skip',
      undefined, { timeout: 5_000 })
    // Turn must come back to us (skip in 2-player)
    await waitForTurn(page, myIdx, 8_000)
    const after = await getState(page)
    expect(after?.currentTurn).toBe(myIdx)
  })

  test('3-player: Skip skips the next player (turn lands on player after next)', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page) // bot1
    await addBot(page) // bot2
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const others = (s?.players ?? []).filter((p) => p.index !== myIdx).map((p) => p.index).sort((a, b) => a - b)
    expect(others.length).toBe(2)

    // direction is +1 (clockwise) by default. nextIdx = (myIdx+1) % 3, skipped = (myIdx+2) % 3
    const skippedIdx = (myIdx + 1) % 3
    const expectedNext = (myIdx + 2) % 3

    // Pin bots' hands so they cannot interrupt with a Skip and so the post-skip
    // player has no skip in hand.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'skip' },
        { color: 'red', kind: 'number', value: 1 },
      ],
      hands: others.map((idx) => ({
        playerIndex: idx,
        hand: [
          { color: 'green', kind: 'number', value: 4 },
          { color: 'yellow', kind: 'number', value: 8 },
        ],
      })),
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    // Record the turn sequence: the seat after the skipped one only holds the
    // turn until its bot plays (~800 ms), so sampling currentTurn can miss it
    // entirely. Asserting on the recorded sequence is timing-independent and
    // additionally proves the skipped seat never held the turn at all.
    await page.evaluate(() => window.__LOCO_E2E__?.startTurnRecorder?.())
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'skip' } })

    await expect
      .poll(
        () => page.evaluate(() => window.__LOCO_E2E__?.getRecordedTurns?.() ?? []),
        {
          timeout: 8_000,
          message: `turn never reached seat ${expectedNext} after Skip from seat ${myIdx} (skipped seat should be ${skippedIdx})`,
        },
      )
      .toContain(expectedNext)

    const turns = await page.evaluate(() => window.__LOCO_E2E__?.getRecordedTurns?.() ?? [])
    // Everything up to and including the expected seat must skip `skippedIdx`.
    const upToExpected = turns.slice(0, turns.indexOf(expectedNext) + 1)
    expect(upToExpected, `observed turn sequence: ${JSON.stringify(turns)}`).not.toContain(skippedIdx)
  })
})

test.describe('rules coverage — Reverse / Change Direction (§7, §11.3)', () => {
  test('2-player: Reverse acts as Skip (same player goes again)', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'reverse' },
        { color: 'red', kind: 'number', value: 1 },
      ],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'reverse' } })
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'reverse',
      undefined, { timeout: 5_000 })
    await waitForTurn(page, myIdx, 8_000)
    const after = await getState(page)
    expect(after?.currentTurn).toBe(myIdx)
  })

  test('3-player: Reverse flips direction; turn goes to previous-seat player', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const others = (s?.players ?? []).filter((p) => p.index !== myIdx).map((p) => p.index)
    const directionBefore = s?.direction ?? 1

    // After reverse from clockwise, next player = (myIdx - 1 + 3) % 3
    const expectedNext = (myIdx - directionBefore + 3) % 3

    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'reverse' },
        { color: 'red', kind: 'number', value: 1 },
      ],
      hands: others.map((idx) => ({
        playerIndex: idx,
        hand: [
          { color: 'green', kind: 'number', value: 4 },
          { color: 'yellow', kind: 'number', value: 8 },
        ],
      })),
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })
    await sendMsg(page, { type: 'play_card', card: { color: 'red', kind: 'reverse' } })

    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'reverse',
      undefined, { timeout: 5_000 })

    await waitForTurn(page, expectedNext, 8_000)
    const after = await getState(page)
    expect(after?.currentTurn).toBe(expectedNext)
    // The next turn lands on the previous-seat player, confirming direction flipped
    // server-side. (The client `direction` field updates on the next full game_state
    // broadcast — card_played alone doesn't carry direction.)
  })
})

test.describe('rules coverage — Take 2 / Take 4 stacking (§7)', () => {
  test('Take 2 stack: pendingDraw accumulates +2 per play', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Alice plays red +2 → Bob receives pendingDraw=2.
      // Alice keeps a filler so playing the +2 doesn't end the round (§13-style).
      await debugSetState(alice, {
        hand: [
          { color: 'red', kind: 'draw_two' },
          { color: 'yellow', kind: 'number', value: 3 },
        ],
        // Bob's counter must be the same card as the one played at him — a red
        // +2 answers a red +2 (§11). The off-colour one is tested below.
        hands: [{ playerIndex: bobIdx, hand: [
          { color: 'red', kind: 'draw_two' },
          { color: 'green', kind: 'number', value: 7 },
        ]}],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })
      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'red', kind: 'draw_two' },
      })
      // Wait for Bob to be in pendingDraw=2
      await bob.waitForFunction(
        ([idx]) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return s?.currentTurn === idx && (s?.pendingDraw ?? 0) === 2
        },
        [bobIdx] as [number],
        { timeout: 10_000 },
      )

      // Bob counters with the same-coloured +2
      await sendMsg(bob, {
        type: 'counter_draw',
        card: { color: 'red', kind: 'draw_two' },
      })

      // pendingDraw must accumulate to 4 and turn return to Alice
      await alice.waitForFunction(
        ([idx]) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return s?.currentTurn === idx && (s?.pendingDraw ?? 0) === 4
        },
        [aliceIdx] as [number],
        { timeout: 10_000 },
      )
      const after = await getState(alice)
      expect(after?.pendingDraw).toBe(4)
      expect(after?.discard?.kind).toBe('draw_two')
      expect(after?.discard?.color).toBe('red')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('cross-stack rejection: Take 2 cannot be played on an active Take 4 chain', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)
    const myIdx = (await getState(page))?.myIndex ?? 0

    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'draw_two' },
        { color: 'blue', kind: 'number', value: 1 },
      ],
      discard: { color: 'wild', kind: 'wild_draw_four' },
      activeColor: 'red',
      pendingDraw: 4,
      currentTurn: myIdx,
    })

    // Clear prior error
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined, { timeout: 5_000 }).catch(() => undefined)

    // Try to counter Take 4 with a Take 2 → must error
    await sendMsg(page, {
      type: 'counter_draw',
      card: { color: 'red', kind: 'draw_two' },
    })
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined, { timeout: 5_000 })
    const after = await getState(page)
    expect(after?.pendingDraw).toBe(4) // unchanged
    expect(after?.currentTurn).toBe(myIdx) // still our turn
  })

  test('Take 4 click opens ColorPicker and applies +4 to next player', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      await debugSetState(alice, {
        hand: [
          { color: 'wild', kind: 'wild_draw_four' },
          { color: 'yellow', kind: 'number', value: 3 }, // filler so play doesn't end the round
        ],
        hands: [{ playerIndex: bobIdx, hand: [
          { color: 'blue', kind: 'number', value: 4 },
          { color: 'red', kind: 'number', value: 1 },
        ]}],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      // Click via UI helper to surface the ColorPicker
      await alice.evaluate(() =>
        window.__LOCO_E2E__?.playCard?.({ color: 'wild', kind: 'wild_draw_four' }),
      )
      const greenBtn = alice.getByRole('button', { name: 'green', exact: true })
      await expect(greenBtn).toBeVisible({ timeout: 5_000 })
      await greenBtn.click()

      // Bob ends up with pendingDraw=4 and activeColor=green
      await bob.waitForFunction(
        ([idx]) => {
          const s = window.__LOCO_E2E__?.getState?.()
          return s?.currentTurn === idx && (s?.pendingDraw ?? 0) === 4 && s?.activeColor === 'green'
        },
        [bobIdx] as [number],
        { timeout: 10_000 },
      )
      const bobState = await getState(bob)
      expect(bobState?.pendingDraw).toBe(4)
      expect(bobState?.activeColor).toBe('green')
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('rules coverage — Swap as last card (§13)', () => {
  test('Swap played as last card: actor wins, hands NOT swapped', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Alice has only the Swap card, Bob has multiple cards.
      const bobHand = [
        { color: 'blue', kind: 'number', value: 4 },
        { color: 'green', kind: 'number', value: 7 },
        { color: 'yellow', kind: 'number', value: 2 },
      ]
      await debugSetState(alice, {
        hand: [{ color: 'red', kind: 'swap' }],
        hands: [{ playerIndex: bobIdx, hand: bobHand }],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'red', kind: 'swap' },
        chosen_player: bobIdx,
      })

      // Round summary appears on both clients with Alice as winner
      await alice.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === true,
        undefined, { timeout: 10_000 })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === true,
        undefined, { timeout: 10_000 })

      const aliceState = await getState(alice)
      const bobState = await getState(bob)
      // Alice should be the round winner (roundWinner is a nickname string)
      expect(aliceState?.roundWinner).toBe('Alice')
      // Bob should still have his original-sized hand (swap aborted)
      const bobInBobView = bobState?.players.find((p) => p.index === bobIdx)
      expect(bobInBobView?.hand_size).toBe(bobHand.length)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('rules coverage — GlobalSwitch (§7, §11.3, §13)', () => {
  test('GlobalSwitch in 2-player: hands swap mutually (sizes mirror)', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Alice has GlobalSwitch + 2 fillers. Bob has 4 fillers.
      const aliceHand = [
        { color: 'wild', kind: 'global_switch' },
        { color: 'red', kind: 'number', value: 1 },
        { color: 'blue', kind: 'number', value: 2 },
      ]
      const bobHand = [
        { color: 'green', kind: 'number', value: 4 },
        { color: 'yellow', kind: 'number', value: 7 },
        { color: 'red', kind: 'number', value: 3 },
        { color: 'blue', kind: 'number', value: 9 },
      ]
      await debugSetState(alice, {
        hand: aliceHand,
        hands: [{ playerIndex: bobIdx, hand: bobHand }],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'wild', kind: 'global_switch' },
        chosen_color: 'green',
      })

      // Discard must change to global_switch on both clients
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'global_switch',
        undefined, { timeout: 10_000 })

      const after = await getState(alice)
      // Alice played her GlobalSwitch (3 → 2 cards), then receives Bob's full 4
      expect(after?.myHand.length).toBe(bobHand.length)
      // Bob's view of Alice = bobHand.length, and Bob's own hand = 2 (Alice's leftover)
      const bobAfter = await getState(bob)
      expect(bobAfter?.myHand.length).toBe(aliceHand.length - 1) // minus the played GS
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  // A GlobalSwitch is not a Skip: the seat right after the actor must get the
  // turn, with the hand it just received. Three seats, so "next seat" and "the
  // one after it" are distinguishable — in a 2-player game both are the opponent.
  test('GlobalSwitch: the next seat gets the turn and can play', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await addBot(alice) // third seat, kept idle: it never holds the turn here
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Direction is clockwise (the opening discard is always a Number, so no
      // Reverse can have flipped it), so Bob sits right after Alice.
      const playableAfter = { color: 'red', kind: 'number', value: 6 }
      await debugSetState(alice, {
        hand: [{ color: 'wild', kind: 'global_switch' }, { color: 'red', kind: 'number', value: 1 }],
        hands: [{ playerIndex: bobIdx, hand: [playableAfter, { color: 'blue', kind: 'number', value: 9 }] }],
        discard: { color: 'red', kind: 'number', value: 5 },
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'wild', kind: 'global_switch' },
        chosen_color: 'red',
      })

      // Both clients must agree the turn landed on Bob — not on the seat after him.
      await waitForTurn(bob, bobIdx)
      await waitForTurn(alice, bobIdx)

      // A GlobalSwitch names its colour like any other wild. It must be a real
      // one: with 'wild' active nothing coloured would be legal for anyone and
      // the table would be stuck drawing until somebody turned up a wild.
      expect((await getState(bob))?.activeColor).toBe('red')

      // And it is a real turn: Bob plays a card from the hand he just received
      // (Alice's leftover red 1 rotated to him).
      const bobHand = (await getState(bob))?.myHand ?? []
      expect(bobHand).toHaveLength(1)
      await sendMsg(bob, { type: 'play_card', card: bobHand[0] })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'number',
        undefined, { timeout: 10_000 })
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('GlobalSwitch as last card: actor wins, rotation aborted', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      const bobHand = [
        { color: 'blue', kind: 'number', value: 4 },
        { color: 'green', kind: 'number', value: 7 },
      ]
      await debugSetState(alice, {
        hand: [{ color: 'wild', kind: 'global_switch' }],
        hands: [{ playerIndex: bobIdx, hand: bobHand }],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'wild', kind: 'global_switch' },
        chosen_color: 'blue',
      })

      await alice.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.showRoundSummary === true,
        undefined, { timeout: 10_000 })
      const aliceState = await getState(alice)
      expect(aliceState?.roundWinner).toBe('Alice')

      // Bob still has his original hand size (rotation aborted)
      const bobState = await getState(bob)
      const bobSelf = bobState?.players.find((p) => p.index === bobIdx)
      expect(bobSelf?.hand_size).toBe(bobHand.length)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('rules coverage — Interjecting (§6)', () => {
  // Wilds interject like everything else (§6.2): they all carry the 'wild'
  // colour, so a Wild on a Wild is an exact identity match. The interjecter
  // names the colour that becomes active, exactly as on a normal wild play.
  //
  // Alice must really play the wild — debug_set_state leaves the interject
  // window closed, and a test that skips the play would pass on "window closed"
  // no matter what the wild rule says.
  test('wild card interjects onto an identical wild and sets the chosen colour', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      await debugSetState(alice, {
        hand: [
          { color: 'wild', kind: 'wild' },
          { color: 'red', kind: 'number', value: 1 },
        ],
        hands: [
          {
            playerIndex: bobIdx,
            hand: [
              { color: 'wild', kind: 'wild' },
              { color: 'green', kind: 'number', value: 8 },
            ],
          },
        ],
        discard: { color: 'red', kind: 'number', value: 5 },
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      // Alice's real play puts a wild on top and arms the window.
      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'wild', kind: 'wild' },
        chosen_color: 'red',
      })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'wild',
        undefined, { timeout: 5_000 })

      await sendMsg(bob, {
        type: 'interrupt_play_card',
        card: { color: 'wild', kind: 'wild' },
        chosen_color: 'blue',
      })

      // Bob takes the lead: the colour he named is active and the turn is back
      // on Alice (the seat after Bob in a two-player game).
      await alice.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.activeColor === 'blue',
        undefined, { timeout: 5_000 })
      const after = await getState(alice)
      expect(after?.currentTurn).toBe(aliceIdx)
      expect((await getState(bob))?.myHand?.length).toBe(1)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })

  test('different-color same-value interject is rejected (must be exact identity)', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1

      await debugSetState(alice, {
        hand: [{ color: 'red', kind: 'number', value: 1 }],
        hands: [{ playerIndex: bobIdx, hand: [{ color: 'blue', kind: 'number', value: 5 }] }],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
        undefined, { timeout: 5_000 }).catch(() => undefined)

      await sendMsg(bob, {
        type: 'interrupt_play',
        card: { color: 'blue', kind: 'number', value: 5 },
      })

      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
        undefined, { timeout: 5_000 })
      const after = await getState(alice)
      // Discard unchanged, Alice's turn
      expect(after?.discard?.color).toBe('red')
      expect(after?.currentTurn).toBe(aliceIdx)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})

test.describe('rules coverage — LOCO! call (§8, §11.1)', () => {
  // §11.1: receiving your last card owes the table a declaration exactly like
  // playing down to it. Three seats so the catcher is somebody with a full hand:
  // a player on one card sees LOCO! in the centre slot, not Catch.
  test('LOCO! IS required when a Swap hands you your last card (§11.1)', async ({ browser }: { browser: Browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const ctx3 = await browser.newContext()
    const alice = await ctx1.newPage()
    const bob = await ctx2.newPage()
    const carol = await ctx3.newPage()
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await joinRoom(carol, 'Carol', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await expect(gameBoard(carol)).toBeVisible({ timeout: 10_000 })

      const aliceIdx = (await getState(alice))?.myIndex ?? 0
      const bobIdx = (await getState(bob))?.myIndex ?? 1
      const carolIdx = (await getState(carol))?.myIndex ?? 2

      // Alice: Swap + one leftover. Bob: three cards. Carol: two, so she is the
      // one seat whose action bar still shows Catch.
      // After the swap Alice holds Bob's three and Bob holds Alice's single
      // leftover — Bob never played a card, he was handed his last one.
      await debugSetState(alice, {
        hand: [
          { color: 'red', kind: 'swap' },
          { color: 'blue', kind: 'number', value: 4 },
        ],
        hands: [
          {
            playerIndex: bobIdx,
            hand: [
              { color: 'green', kind: 'number', value: 6 },
              { color: 'green', kind: 'number', value: 7 },
              { color: 'green', kind: 'number', value: 8 },
            ],
          },
          {
            playerIndex: carolIdx,
            hand: [
              { color: 'yellow', kind: 'number', value: 2 },
              { color: 'yellow', kind: 'number', value: 3 },
            ],
          },
        ],
        discard: { color: 'red', kind: 'number', value: 5 },
        pendingDraw: 0,
        currentTurn: aliceIdx,
      })

      await sendMsg(alice, {
        type: 'play_card',
        card: { color: 'red', kind: 'swap' },
        chosen_player: bobIdx,
      })

      // Bob is the only seat left on one card, so he is the catch Carol is offered.
      await carol.waitForFunction(
        (idx: number) => window.__LOCO_E2E__?.getState?.()?.catchTarget === idx,
        bobIdx, { timeout: 10_000 })

      const catchBtn = carol.getByRole('button', { name: T.catchBtn })
      await expect(catchBtn).toBeEnabled({ timeout: 5_000 })
      await catchBtn.click()

      // The penalty lands on Bob: one received card + two drawn.
      await bob.waitForFunction(
        () => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) === 3,
        undefined, { timeout: 10_000 })
      expect((await getState(alice))?.myHand.length).toBe(3)
    } finally {
      await ctx1.close()
      await ctx2.close()
      await ctx3.close()
    }
  })
})
