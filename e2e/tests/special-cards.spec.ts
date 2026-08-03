/**
 * special-cards.spec.ts
 *
 * Deterministic end-to-end tests for custom card mechanics.
 *
 * All tests use debugSetState (backed by the server-side debug_set_state WebSocket
 * message, active when LOCO_E2E=1) to inject specific cards into the player's hand
 * and control the discard pile / pending-draw state.  No test depends on the random
 * deck; every assertion is guaranteed to run on every execution.
 *
 * Coverage:
 *   - Swap card → PlayerPicker opens, choosing target swaps hands
 *   - GlobalSwitch card → plays without picker, discard updates, hand rotates
 *   - counter_draw → stacks penalty, turn advances to next player
 *   - interrupt_play → out-of-turn play with exact match advances turn to us
 *   - Non-counter card during active +2/+4 penalty returns error
 *   - Two-player real-time sync: card play reflected on both clients
 *
 * Prerequisites:
 *   - Server must be running with LOCO_E2E=1 (set in docker-compose.dev.yml and CI).
 *   - Go server on :8080, Vite dev server on :5173.
 */
import { test, expect, Browser } from '@playwright/test'
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
  waitForTableOpen,
  gameBoard,
  playCard,
} from '../helpers/game'

// ---------------------------------------------------------------------------
// Helpers shared across tests
// ---------------------------------------------------------------------------

/** Wait for it to be the local player's turn. */
async function waitForTurn(page: Parameters<typeof getState>[0], timeoutMs = 20_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s?.currentTurn === s?.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

/** Wait until it is NOT the local player's turn. */
async function waitForOtherTurn(page: Parameters<typeof getState>[0], timeoutMs = 10_000) {
  await page.waitForFunction(
    () => {
      const s = window.__LOCO_E2E__?.getState?.()
      return s !== undefined && s.currentTurn !== s.myIndex
    },
    undefined,
    { timeout: timeoutMs },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('special card mechanics (deterministic via debug_set_state)', () => {
  /**
   * Swap card — PlayerPicker UI:
   * When the player triggers handleCardClick with a Swap card, the PlayerPicker
   * modal must appear before any message is sent to the server.
   */
  test('Swap card opens the PlayerPicker modal', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)
    const initial = await getState(page)
    const myIdx = initial?.myIndex ?? 0

    // Inject a Swap card as the entire hand, matching the discard's colour.
    //
    // Swap is a *coloured* card — there is exactly one per suit and none in the
    // wild pile — so it obeys ordinary matching, and `handleCardClick` now
    // refuses to open a picker for a card `clientMayPlay` rejects (asking for a
    // target and then having the server refuse the card is a worse refusal than
    // the silent one every other unplayable card gives). This fixture used to
    // inject `{ color: 'wild', kind: 'swap' }`, a card that exists in no deck,
    // against an unstated active colour: once the legality check moved ahead of
    // the prompt, the picker could never open and the test failed on every run.
    //
    // pendingDraw and currentTurn are pinned for the same reason the neighbouring
    // test pins them: a bot's +2 landing before our turn routes the tap to
    // counter_draw instead of the picker, which is the fixture deciding the
    // verdict rather than the behaviour under test.
    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'swap' }],
      discard: { color: 'red', kind: 'number', value: 5 },
      activeColor: 'red',
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    // Verify the hand now contains exactly the Swap card.
    const state = await getState(page)
    expect(state?.myHand).toHaveLength(1)
    expect(state?.myHand[0].kind).toBe('swap')

    // Trigger handleCardClick via the E2E playCard helper.
    await page.evaluate((card) => window.__LOCO_E2E__?.playCard?.(card), {
      color: 'red',
      kind: 'swap',
    })

    // PlayerPicker modal must be visible.
    await expect(page.getByText(T.choosePlayer)).toBeVisible({
      timeout: 5_000,
    })

    // Cancel to avoid sending a partial message.
    await page.getByRole('button', { name: T.pickerCancel }).click()
    await expect(page.getByText(T.choosePlayer)).not.toBeVisible()
  })

  /**
   * Swap card end-to-end:
   * Playing a Swap card via sendMsg (with a valid chosen_player) should:
   *   1. Remove the Swap card from our hand.
   *   2. Cause the discard pile to show the Swap card.
   *   3. Trigger a game_state broadcast so our hand updates.
   *
   * The bot's hand before the swap is unknown, but after swapping our single-card
   * hand the discard must show "swap" and our hand must differ from the pre-swap state.
   */
  test('Swap card played end-to-end changes hand and updates discard', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    // Set a predictable starting state: our hand = one Swap card.
    const initial = await getState(page)
    const myIdx = initial?.myIndex ?? 0
    const opponentIdx = (initial?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    // Two cards, and the second one is what makes this a test of the Swap at
    // all. A lone Swap empties the hand, and a hand-emptying Swap takes the
    // round with its exchange *aborted* (rules.md §11.1) — so the fixture was
    // asserting the abort path under the name of the swap, and is now refused
    // outright for want of a LOCO! call (§14.7).
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'swap' },
        { color: 'yellow', kind: 'number', value: 2 },
      ],
      hands: [{ playerIndex: opponentIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      pendingDraw: 0,
      currentTurn: myIdx,
    })

    await page.waitForFunction(
      (idx: number) => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s !== undefined && s.currentTurn === idx && (s.myHand?.length ?? 0) === 2 && s.myHand?.[0]?.kind === 'swap'
      },
      myIdx,
      { timeout: 8_000 },
    )

    const before = await getState(page)
    expect(before?.myHand).toHaveLength(2)

    // Choose the bot as the swap target (first non-self, non-finished player).
    const opponents = (before?.players ?? []).filter(
      (p) => p.index !== before?.myIndex && !p.finished,
    )
    expect(opponents.length).toBeGreaterThan(0)
    const target = opponents[0].index

    // Play the Swap card.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'red', kind: 'swap' },
      chosen_player: target,
    })

    // After the swap:
    //   • discard shows the Swap card
    //   • if the server rejects the play, fail immediately with the surfaced error
    await page.waitForFunction(
      () => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s?.discard?.kind === 'swap' || (s?.errorMsg ?? '') !== ''
      },
      undefined,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.errorMsg ?? '').toBe('')
    expect(after?.discard?.kind).toBe('swap')
    // Our hand is now whatever the bot had (could be any size ≥ 0).
    // The Swap card itself should no longer be in our hand.
    const stillHasSwap = after?.myHand.some((c) => c.kind === 'swap')
    expect(stillHasSwap).toBe(false)
  })

  /**
   * GlobalSwitch card end-to-end, tapped through the real click handler:
   *   1. The tap opens the colour picker: a GlobalSwitch is a wild and names
   *      the colour that becomes active, so it must never fly out silently.
   *   2. Choosing a colour plays it: the discard shows the GlobalSwitch and the
   *      chosen colour becomes active.
   *   3. Hands rotate (game_state broadcast) and the card leaves our hand.
   *
   * Driven by playCard + a click on the swatch rather than a raw sendMsg: the
   * server rejects a colourless GlobalSwitch now, so a test that sends
   * chosen_color down the socket itself would stay green while the button that
   * produces it was unreachable.
   */
  test('GlobalSwitch asks for a colour, then plays with it', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const initial = await getState(page)
    const myIdx = initial?.myIndex ?? 0
    const opponentIdx = (initial?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    // Inject GlobalSwitch into hand with a neutral discard.
    // Pin the opponent's hand to a non-GlobalSwitch card so that after the
    // switch our new hand cannot accidentally contain another GlobalSwitch.
    // Two cards for the same reason as the Swap fixture above: a lone
    // GlobalSwitch empties the hand, which takes the round with the rotation
    // aborted (rules.md §11.1) and is refused without the LOCO! call (§14.7).
    // What this test is about is the picker and the colour it names.
    await debugSetState(page, {
      hand: [
        { color: 'wild', kind: 'global_switch' },
        { color: 'yellow', kind: 'number', value: 2 },
      ],
      hands: [{ playerIndex: opponentIdx, hand: [{ color: 'red', kind: 'number', value: 4 }] }],
      discard: { color: 'blue', kind: 'number', value: 3 },
      currentTurn: myIdx,
      pendingDraw: 0,
    })

    const before = await getState(page)
    expect(before?.myHand).toHaveLength(2)
    expect(before?.myHand[0].kind).toBe('global_switch')

    // Tap it: the picker must open and nothing must have been played yet.
    await playCard(page, { color: 'wild', kind: 'global_switch' })
    const swatch = page.getByRole('button', { name: 'green' })
    await expect(swatch).toBeVisible({ timeout: 5_000 })
    expect((await getState(page))?.discard?.kind).toBe('number')

    await swatch.click()

    // Discard must update to show global_switch.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'global_switch',
      undefined,
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.discard?.kind).toBe('global_switch')
    // The colour the player named is the colour in play.
    expect(after?.activeColor).toBe('green')
    // GlobalSwitch must no longer be in our hand.
    expect(after?.myHand.some((c) => c.kind === 'global_switch')).toBe(false)
  })

  /**
   * counter_draw — deterministic:
   * 1. Inject a +2 card into our hand.
   * 2. Set the discard to a +2 and pendingDraw to 2 (simulates a +2 played against us).
   * 3. Tap our +2 through the real click handler — this stacks the penalty to 4.
   * 4. The turn must advance away from us and pendingDraw must be > 2.
   *
   * The tap goes through handleCardClick on purpose. An earlier version sent
   * counter_draw straight down the socket, which proved the server stacks
   * correctly while the UI was in fact sending play_card — a message the server
   * always refuses while a penalty is pending. Stacking was unreachable for a
   * human player and the suite was green throughout.
   */
  test('counter_draw stacks the pending draw and advances the turn', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    // Inject: we have a red +2, discard is a red +2, pendingDraw = 2, our turn.
    // Same colour on purpose — a counter is the same card, and the tap has to
    // route to counter_draw for the stack to be reachable at all.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'draw_two' },
        { color: 'red', kind: 'number', value: 7 }, // filler so hand is non-empty after counter
      ],
      hands: [{ playerIndex: otherIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'draw_two' },
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    const before = await getState(page)
    expect(before?.pendingDraw).toBe(2)

    // Counter the +2 with our +2 — stack grows to 4.
    await playCard(page, { color: 'red', kind: 'draw_two' })

    // Turn must advance away from us and pendingDraw must have grown.
    await page.waitForFunction(
      ([idx, stackBefore]: [number, number]) => {
        const s = window.__LOCO_E2E__?.getState?.()
        return (
          s !== undefined &&
          s.currentTurn !== idx &&
          (s.pendingDraw ?? 0) > stackBefore
        )
      },
      [myIdx, 2] as [number, number],
      { timeout: 10_000 },
    )

    const after = await getState(page)
    expect(after?.pendingDraw).toBeGreaterThan(2) // stacked: 2 + 2 = 4
    expect(after?.currentTurn).not.toBe(myIdx)
  })

  /**
   * An off-colour +2 does not counter (§11: a counter is the same card), but it
   * is not a dead card either — the forced draw keeps the turn (§14.5), so after
   * taking the penalty it plays as an ordinary kind-match on the very same +2.
   *
   * This is the full UI path a player actually walks: the tap while the penalty
   * is pending must do nothing at all, the draw must leave the turn on our seat,
   * and the same tap must then send the card.
   */
  test('an off-colour +2 is refused as a counter and playable after the draw', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    await waitForMyTurn(page, 30_000)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    await debugSetState(page, {
      hand: [
        { color: 'blue', kind: 'draw_two' },
        { color: 'red', kind: 'number', value: 7 }, // filler so the round can't end here
      ],
      hands: [{ playerIndex: otherIdx, hand: [{ color: 'blue', kind: 'number', value: 9 }] }],
      discard: { color: 'red', kind: 'draw_two' },
      activeColor: 'red',
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    // Tapping it under the penalty must be a no-op: no counter, no play, no error.
    await playCard(page, { color: 'blue', kind: 'draw_two' })
    const stuck = await getState(page)
    expect(stuck?.pendingDraw).toBe(2)
    expect(stuck?.currentTurn).toBe(myIdx)
    expect(stuck?.myHand.some((c) => c.color === 'blue' && c.kind === 'draw_two')).toBe(true)

    // Take the penalty — the turn must stay on our seat.
    await sendMsg(page, { type: 'draw_card' })
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.pendingDraw ?? -1) === 0,
      undefined,
      { timeout: 10_000 },
    )
    expect((await getState(page))?.currentTurn).toBe(myIdx)

    // Now the same card is an ordinary kind-match on the red +2.
    await playCard(page, { color: 'blue', kind: 'draw_two' })
    await page.waitForFunction(
      ([idx]: [number]) => {
        const s = window.__LOCO_E2E__?.getState?.()
        return s !== undefined && s.currentTurn !== idx && (s.pendingDraw ?? 0) === 2
      },
      [myIdx] as [number],
      { timeout: 10_000 },
    )
    const played = await getState(page)
    expect(played?.discard?.color).toBe('blue')
    expect(played?.discard?.kind).toBe('draw_two')
  })

  /**
   * The interrupt window is armed by a real play and closed by a draw / pass /
   * round end — there is no time limit. A client that sends an interrupt out of
   * the blue (nothing was played) must still be refused.
   *
   * This replaces an earlier test that set the board with debug_set_state, sent
   * an interrupt, and then asserted the discard and turn it had itself just
   * configured — it passed whether or not the interrupt was accepted, and in
   * fact the server was rejecting it the whole time. The success path is covered
   * by the three-client test below, which arms the window properly.
   */
  test('interrupt outside an armed window is rejected', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 5 },
        { color: 'blue', kind: 'number', value: 9 },
      ],
      hands: [{ playerIndex: otherIdx, hand: [{ color: 'blue', kind: 'number', value: 2 }] }],
      discard: { color: 'red', kind: 'number', value: 5 },
      currentTurn: otherIdx,
      pendingDraw: 0,
    })

    await sendMsg(page, {
      type: 'interrupt_play',
      card: { color: 'red', kind: 'number', value: 5 },
    })

    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 5_000 },
    )
    const after = await getState(page)
    expect(after?.errorMsg).toMatch(/interrupt window/i)
    // The card stays in hand: a refused interrupt must not cost anything.
    expect(after?.myHand?.length).toBe(2)
  })

  /**
   * The interception slam is the game's signature moment, driven by the
   * `interrupt_success` message the client used to ignore.
   *
   * The interrupt window is only armed by a real play (debug_set_state leaves it
   * closed), so somebody other than the interrupter has to play first. Carol is
   * a third human rather than a bot so no 800ms bot timer plays a card and
   * re-arms the window under the interrupt in flight.
   */
  test('successful interrupt shows the interception banner on both clients', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()])
    const [alice, bob, carol] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await joinRoom(carol, 'Carol', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)
      await expect(gameBoard(carol)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(carol)

      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Alice and Bob both hold a red 5; the discard is a red 3 so Bob's play is
      // legal. Everyone keeps a spare card so no hand empties and ends the round
      // before the banner can be read.
      await debugSetState(alice, {
        hand: [
          { color: 'red', kind: 'number', value: 5 },
          { color: 'blue', kind: 'number', value: 9 },
        ],
        hands: [
          {
            playerIndex: bobIdx,
            hand: [
              { color: 'red', kind: 'number', value: 5 },
              { color: 'green', kind: 'number', value: 4 },
            ],
          },
        ],
        discard: { color: 'red', kind: 'number', value: 3 },
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: bobIdx,
      })

      // Bob's real play arms the interrupt window and hands the turn to Carol.
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 5 },
        chosen_color: 'red',
      })
      await alice.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.discard?.value === 5,
        undefined,
        { timeout: 5_000 },
      )

      await sendMsg(alice, {
        type: 'interrupt_play_card',
        card: { color: 'red', kind: 'number', value: 5 },
      })

      // The steal must be legible to the player who made it and to the table.
      await expect(alice.getByText(T.interruptTitle)).toBeVisible({ timeout: 5_000 })
      await expect(carol.getByText(T.interruptTitle)).toBeVisible({ timeout: 5_000 })
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })

  /**
   * Taking the lead back from yourself. The player who just played is not
   * excluded from the jump-in — holding two identical cards means you can slam
   * the second one before anybody reacts, and the seat after you plays next.
   * This is the whole point of the mechanic being a race rather than a turn.
   */
  test('the player who just played can slam an identical card and retake the lead', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctxs = await Promise.all([browser.newContext(), browser.newContext()])
    const [alice, bob] = await Promise.all(ctxs.map((c) => c.newPage()))
    try {
      const code = await createRoom(alice, 'Alice')
      await joinRoom(bob, 'Bob', code)
      await startGame(alice)
      await expect(gameBoard(bob)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(bob)

      const bobIdx = (await getState(bob))?.myIndex ?? 1

      // Bob holds two red 5s plus a spare, so emptying his hand cannot end the
      // round before the second slam lands.
      await debugSetState(alice, {
        hand: [{ color: 'blue', kind: 'number', value: 9 }],
        hands: [
          {
            playerIndex: bobIdx,
            hand: [
              { color: 'red', kind: 'number', value: 5 },
              { color: 'red', kind: 'number', value: 5 },
              { color: 'green', kind: 'number', value: 4 },
            ],
          },
        ],
        discard: { color: 'red', kind: 'number', value: 3 },
        activeColor: 'red',
        pendingDraw: 0,
        currentTurn: bobIdx,
      })

      // First play: legal on the red 3, arms the window, turn goes to Alice.
      await sendMsg(bob, {
        type: 'play_card',
        card: { color: 'red', kind: 'number', value: 5 },
        chosen_color: 'red',
      })
      await bob.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.currentTurn !== window.__LOCO_E2E__?.getState?.()?.myIndex,
        undefined,
        { timeout: 5_000 },
      )

      // Second copy, out of turn, against his own card.
      await sendMsg(bob, {
        type: 'interrupt_play_card',
        card: { color: 'red', kind: 'number', value: 5 },
      })

      await alice.waitForFunction(
        (idx) => window.__LOCO_E2E__?.getState?.()?.interruptFlash?.actorIndex === idx,
        bobIdx,
        { timeout: 5_000 },
      )
      const after = await getState(bob)
      expect(after?.errorMsg ?? '').toBe('')
      expect(after?.myHand?.length).toBe(1) // both red 5s gone, spare kept
    } finally {
      await Promise.all(ctxs.map((c) => c.close()))
    }
  })

  /**
   * The draw pile doubles as a draw button when drawing is legal. It must never
   * be reachable when it is not our turn — that would send an illegal intent on
   * every stray click.
   */
  test('draw pile is clickable on our turn and inert otherwise', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)
    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0
    const otherIdx = (s?.players ?? []).find((p) => p.index !== myIdx)?.index ?? 1

    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      discard: { color: 'blue', kind: 'number', value: 2 },
      currentTurn: otherIdx,
      pendingDraw: 0,
    })
    await expect(page.getByRole('button', { name: T.drawPile })).toHaveCount(0)

    await debugSetState(page, {
      hand: [{ color: 'red', kind: 'number', value: 5 }],
      discard: { color: 'blue', kind: 'number', value: 2 },
      currentTurn: myIdx,
      pendingDraw: 0,
    })
    const pile = page.getByRole('button', { name: T.drawPile })
    await expect(pile).toBeVisible()

    const before = (await getState(page))?.myHand?.length ?? 0
    await pile.click()
    await page.waitForFunction(
      (n: number) => (window.__LOCO_E2E__?.getState?.()?.myHand?.length ?? 0) > n,
      before,
      { timeout: 5_000 },
    )
  })

  /**
   * Non-counter card during active +2/+4 penalty returns an error:
   * Under an active draw stack, only a matching +2 or +4 may be countered.
   * Playing any other card via play_card is rejected by the server.
   */
  test('playing a non-counter card during active penalty returns an error', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    await waitForMyTurn(page, 30_000)

    const s = await getState(page)
    const myIdx = s?.myIndex ?? 0

    // Set state: we have a non-counter card (red 7), pendingDraw=2, and it's our turn.
    await debugSetState(page, {
      hand: [
        { color: 'red', kind: 'number', value: 7 },
        { color: 'blue', kind: 'number', value: 3 },
      ],
      discard: { color: 'red', kind: 'draw_two' },
      pendingDraw: 2,
      currentTurn: myIdx,
    })

    const before = await getState(page)
    expect(before?.pendingDraw).toBe(2)

    // Wait for any pre-existing error to clear (auto-clears after 2.5 s).
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined,
      { timeout: 5_000 },
    ).catch(() => { /* no prior error */ })

    // Attempt to play a non-counter card illegally.
    await sendMsg(page, {
      type: 'play_card',
      card: { color: 'red', kind: 'number', value: 7 },
    })

    // Server must reject with an error.
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 10_000 },
    )

    await expect(page.locator('[class*="errorToast"]')).toBeVisible()

    // pendingDraw must remain unchanged (play was rejected).
    const after = await getState(page)
    expect(after?.pendingDraw).toBe(2)
  })

  /**
   * Two-player real-time sync:
   * When Alice plays a card, Bob's store must reflect the reduced hand size.
   * Uses debugSetState to give Alice a guaranteed playable card (a wild)
   * so the play succeeds on the first attempt.
   */
  test('two-player sync: card play is immediately reflected on the other client', async ({
    browser,
  }: {
    browser: Browser
  }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await page1.getByRole('button', { name: T.startGame }).click()

      await expect(gameBoard(page1)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(page1)
      await expect(gameBoard(page2)).toBeVisible({ timeout: 10_000 })
      await waitForTableOpen(page2)

      const aliceState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceIndex = aliceState?.myIndex ?? 0

      const bobView = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceFromBob = (bobView?.players ?? []).find((p) => p.index === aliceIndex)
      const handBefore = aliceFromBob?.hand_size ?? 8

      // Inject a wild card into Alice's hand so she always has a playable card.
      await debugSetState(page1, {
        hand: [
          { color: 'wild', kind: 'wild' },
          { color: 'red', kind: 'number', value: 1 },
          { color: 'blue', kind: 'number', value: 2 },
        ],
        currentTurn: aliceIndex,
        pendingDraw: 0,
      })

      // Verify Alice's hand was updated.
      const aliceHand = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.()?.myHand)
      expect(aliceHand).toHaveLength(3)

      // Alice plays the wild card.
      await sendMsg(page1, {
        type: 'play_card',
        card: { color: 'wild', kind: 'wild' },
        chosen_color: 'red',
      })

      // Bob's view of Alice's hand_size must decrease.
      await page2.waitForFunction(
        ([idx, before]: [number, number]) => {
          const players = window.__LOCO_E2E__?.getState?.()?.players ?? []
          const alice = players.find((p) => p.index === idx)
          return (alice?.hand_size ?? 0) < before
        },
        [aliceIndex, 3] as [number, number],
        { timeout: 10_000 },
      )

      const bobUpdated = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceAfter = (bobUpdated?.players ?? []).find((p) => p.index === aliceIndex)
      expect(aliceAfter?.hand_size).toBeLessThan(3)
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
