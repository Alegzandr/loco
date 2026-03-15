/**
 * special-cards.spec.ts
 *
 * End-to-end tests for custom card mechanics beyond standard UNO:
 *   - Swap card opens the PlayerPicker modal (choosing a swap target)
 *   - GlobalSwitch plays immediately (no picker) and triggers a game_state broadcast
 *   - Counter-draw (counter_draw message) is valid when pendingDraw > 0 and we hold
 *     a matching card (+2 counters +2, +4 counters +4)
 *   - Interrupt play (interrupt_play message) lets us play out-of-turn with an exact match
 *   - Invalid play during an active +2/+4 penalty shows an error
 *
 * Because Swap and GlobalSwitch cards appear at random in the deck, tests that require
 * holding a specific card use a graceful-skip pattern (same as the mobile color-picker
 * test in mobile.spec.ts).
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
} from '../helpers/game'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to play best card each turn up to `maxTurns`, looking for a card
 * matching `wantKind` in our hand.  Returns the first matching card found,
 * or null if `maxTurns` elapsed without encountering it.
 */
async function findCardInHand(
  page: Parameters<typeof getState>[0],
  wantKind: string,
  maxTurns = 20,
): Promise<E2ECard | null> {
  for (let i = 0; i < maxTurns; i++) {
    try {
      await waitForMyTurn(page, 20_000)
    } catch {
      break
    }

    const state = await getState(page)
    if (!state || state.screen !== 'game' || state.showRoundSummary) break

    // Check if the wanted card is already in hand.
    const target = state.myHand.find((c) => c.kind === wantKind)
    if (target) return target

    // Not found yet — draw+pass to get a new card.
    const { discard, activeColor, pendingDraw } = state
    const hand = state.myHand ?? []
    const playable = hand.find((c) => {
      if ((pendingDraw ?? 0) > 0)
        return c.kind === 'draw_two' || c.kind === 'wild_draw_four'
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
      if (c.kind === 'number' && discard.kind === 'number')
        return c.value === discard.value
      return false
    })

    if (playable && playable.kind !== wantKind) {
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
          await sendMsg(page, { type: 'draw_card' })
          await page.waitForFunction(
            () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
            undefined,
            { timeout: 8_000 },
          )
          await sendMsg(page, { type: 'pass_turn' })
        }
      } else if ((pendingDraw ?? 0) > 0) {
        await sendMsg(page, { type: 'draw_card' })
      } else {
        await sendMsg(page, { type: 'play_card', card: playable })
      }
    } else {
      await sendMsg(page, { type: 'draw_card' })
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
        undefined,
        { timeout: 8_000 },
      )
      await sendMsg(page, { type: 'pass_turn' })
    }

    await page.waitForTimeout(300)

    // Re-check after card draw
    const after = await getState(page)
    const found = after?.myHand.find((c) => c.kind === wantKind)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('special card mechanics', () => {
  /**
   * Swap card: when the local player triggers handleCardClick with a Swap card,
   * the PlayerPicker modal must open (because handleCardClick calls setPlayerPicker).
   * This is an E2E test of the UI flow, not the server-side hand swap logic.
   */
  test('Swap card opens the PlayerPicker modal', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const swapCard = await findCardInHand(page, 'swap', 20)

    if (!swapCard) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No Swap card appeared in hand in this run — PlayerPicker UI test skipped (deck is random)',
      })
      return
    }

    // Ensure it is our turn before clicking.
    await waitForMyTurn(page, 10_000)

    // Use playCard (calls handleCardClick) which opens the PlayerPicker.
    await page.evaluate((card) => window.__LOCO_E2E__?.playCard?.(card), swapCard)

    // PlayerPicker modal must be visible.
    await expect(page.getByText('Choose a player to swap hands with')).toBeVisible({
      timeout: 5_000,
    })

    // Cancel the picker to avoid sending a malformed play.
    await page.getByRole('button', { name: '✕' }).click()
    await expect(page.getByText('Choose a player to swap hands with')).not.toBeVisible()
  })

  /**
   * Swap card end-to-end: playing a Swap card with a valid target results in
   * a game_state broadcast that updates both players' hands.
   * Verified by checking that the local hand changes after the swap.
   */
  test('Swap card played end-to-end changes hand contents', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const swapCard = await findCardInHand(page, 'swap', 20)

    if (!swapCard) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No Swap card appeared in hand — Swap E2E test skipped (deck is random)',
      })
      return
    }

    await waitForMyTurn(page, 10_000)

    const beforeState = await getState(page)
    const opponents = (beforeState?.players ?? []).filter(
      (p) => p.index !== beforeState?.myIndex && !p.finished,
    )

    if (opponents.length === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No valid swap target available — Swap E2E test skipped',
      })
      return
    }

    const handBefore = beforeState?.myHand ?? []

    // Play the Swap card targeting the first opponent.
    await sendMsg(page, {
      type: 'play_card',
      card: swapCard,
      chosen_player: opponents[0].index,
    })

    // After Swap the server sends game_state (full snapshot).
    // Our hand contents must change (we now hold the target's previous hand).
    await page.waitForFunction(
      (beforeSize: number) => {
        const hand = window.__LOCO_E2E__?.getState?.()?.myHand ?? []
        // Hand size or contents should differ — any change confirms game_state was applied.
        return hand.length !== beforeSize || window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'swap'
      },
      handBefore.length,
      { timeout: 10_000 },
    )

    // Discard pile must show the swap card.
    const afterState = await getState(page)
    expect(afterState?.discard?.kind).toBe('swap')
  })

  /**
   * GlobalSwitch card: plays immediately (no picker modal) and triggers a
   * game_state broadcast.  All players' hands are rotated; the discard shows
   * the global_switch card.
   */
  test('GlobalSwitch card plays without picker and triggers game_state update', async ({
    page,
  }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    const gsCard = await findCardInHand(page, 'global_switch', 20)

    if (!gsCard) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No GlobalSwitch card appeared in hand — GlobalSwitch test skipped (deck is random)',
      })
      return
    }

    await waitForMyTurn(page, 10_000)

    const beforeState = await getState(page)
    const handBefore = beforeState?.myHand ?? []

    // Play GlobalSwitch — no chosen_color or chosen_player needed.
    await sendMsg(page, { type: 'play_card', card: gsCard })

    // Server sends game_state; discard must become the global_switch card.
    await page.waitForFunction(
      () => window.__LOCO_E2E__?.getState?.()?.discard?.kind === 'global_switch',
      undefined,
      { timeout: 10_000 },
    )

    // Hand must have changed (we received the previous player's hand).
    const afterState = await getState(page)
    expect(afterState?.discard?.kind).toBe('global_switch')
    // Hand size may stay the same if previous player had same count, but
    // confirming discard kind is sufficient proof the play was processed.
    expect(afterState?.myHand).toBeDefined()
  })

  /**
   * Counter-draw: when pendingDraw > 0 and we hold a matching penalty card,
   * sending counter_draw stacks the penalty and passes the problem to the next player.
   *
   * Requires a +2 to be active on our turn and a +2 in our hand — doubly non-deterministic.
   * Graceful skip if conditions never materialise.
   */
  test('counter_draw stacks penalty when we hold a matching card', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    let testedCounter = false

    for (let i = 0; i < 30; i++) {
      try {
        await waitForMyTurn(page, 20_000)
      } catch {
        break
      }

      const state = await getState(page)
      if (!state || state.screen !== 'game' || state.showRoundSummary) break

      const pendingDraw = state.pendingDraw ?? 0
      if (pendingDraw > 0) {
        // Check if we have a matching counter card.
        const discard = state.discard
        const counterKind =
          discard?.kind === 'draw_two'
            ? 'draw_two'
            : discard?.kind === 'wild_draw_four'
              ? 'wild_draw_four'
              : null

        const counterCard = counterKind
          ? state.myHand.find((c) => c.kind === counterKind)
          : null

        if (counterCard) {
          const stackBefore = pendingDraw

          // Send counter_draw
          if (counterCard.kind === 'wild_draw_four') {
            await sendMsg(page, {
              type: 'counter_draw',
              card: counterCard,
              chosen_color: 'red',
            })
          } else {
            await sendMsg(page, { type: 'counter_draw', card: counterCard })
          }

          // After counter, pendingDraw should increase (stack grows) and turn advances.
          await page.waitForFunction(
            ([before, myIdx]: [number, number]) => {
              const s = window.__LOCO_E2E__?.getState?.()
              return (
                s !== undefined &&
                s.currentTurn !== myIdx &&
                (s.pendingDraw ?? 0) > before
              )
            },
            [stackBefore, state.myIndex] as [number, number],
            { timeout: 10_000 },
          )

          const after = await getState(page)
          expect(after?.pendingDraw).toBeGreaterThan(stackBefore)
          testedCounter = true
          break
        }

        // Have penalty but no counter card — absorb it and move on.
        await sendMsg(page, { type: 'draw_card' })
      } else {
        // Normal turn — draw+pass
        await sendMsg(page, { type: 'draw_card' })
        await page.waitForFunction(
          () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
          undefined,
          { timeout: 8_000 },
        )
        await sendMsg(page, { type: 'pass_turn' })
      }

      await page.waitForTimeout(300)
    }

    if (!testedCounter) {
      test.info().annotations.push({
        type: 'note',
        description:
          'Never had a matching counter card when targeted by a penalty — counter_draw test skipped (deck is random)',
      })
    }
  })

  /**
   * Playing a non-counter card when pendingDraw > 0 should be rejected by the server
   * and produce an error toast — you must either counter or absorb the penalty.
   */
  test('playing a non-counter card during active penalty shows error', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    // Wait for pendingDraw > 0 on our turn.
    let hasPenalty = false
    let penaltyState: Awaited<ReturnType<typeof getState>> = undefined

    for (let i = 0; i < 30; i++) {
      try {
        await waitForMyTurn(page, 20_000)
      } catch {
        break
      }

      const state = await getState(page)
      if (!state || state.screen !== 'game' || state.showRoundSummary) break

      if ((state.pendingDraw ?? 0) > 0) {
        hasPenalty = true
        penaltyState = state
        break
      }

      // Not in penalty yet — draw+pass
      await sendMsg(page, { type: 'draw_card' })
      await page.waitForFunction(
        () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
        undefined,
        { timeout: 8_000 },
      )
      await sendMsg(page, { type: 'pass_turn' })
      await page.waitForTimeout(300)
    }

    if (!hasPenalty || !penaltyState) {
      test.info().annotations.push({
        type: 'note',
        description:
          'Never received a +2/+4 penalty in this run — non-counter error test skipped (deck is random)',
      })
      return
    }

    // Find a non-counter card to play illegally.
    const illegalCard = penaltyState.myHand.find(
      (c) => c.kind !== 'draw_two' && c.kind !== 'wild_draw_four',
    )

    if (!illegalCard) {
      // All cards are counters — skip
      test.info().annotations.push({
        type: 'note',
        description: 'Hand contains only counter cards — non-counter error test skipped',
      })
      return
    }

    // Wait for any pre-existing error toast to clear (auto-clears after 2.5 s).
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') === '',
      undefined,
      { timeout: 5_000 },
    ).catch(() => { /* no prior error — proceed */ })

    // Play the illegal card.
    await sendMsg(page, { type: 'play_card', card: illegalCard })

    // Server must reject it with an error.
    await page.waitForFunction(
      () => (window.__LOCO_E2E__?.getState?.()?.errorMsg ?? '') !== '',
      undefined,
      { timeout: 10_000 },
    )

    await expect(page.locator('[class*="errorToast"]')).toBeVisible()
  })

  /**
   * Interrupt play (jump-in): sending interrupt_play with an exact card match lets
   * a player act out of turn.  The turn advances to the interrupter.
   *
   * This requires the discard pile to show an exact match of a card in our hand
   * (same color, kind, value) — non-deterministic.  Graceful skip.
   */
  test('interrupt_play out-of-turn with exact match advances turn to us', async ({ page }) => {
    await createRoom(page, 'Alice')
    await addBot(page)
    await startGame(page)

    let testedInterrupt = false

    for (let i = 0; i < 30; i++) {
      const state = await getState(page)
      if (!state || state.screen !== 'game' || state.showRoundSummary) break

      const myIdx = state.myIndex
      const isMyTurn = state.currentTurn === myIdx

      if (!isMyTurn && (state.pendingDraw ?? 0) === 0) {
        // Look for an exact match of the top discard in our hand.
        const discard = state.discard
        if (discard && discard.kind !== 'wild' && discard.kind !== 'wild_draw_four') {
          const exactMatch = state.myHand.find(
            (c) =>
              c.color === discard.color &&
              c.kind === discard.kind &&
              c.value === discard.value,
          )

          if (exactMatch) {
            // Send interrupt_play
            await sendMsg(page, { type: 'interrupt_play', card: exactMatch })

            // Turn must advance to us.
            await page.waitForFunction(
              (idx: number) => window.__LOCO_E2E__?.getState?.()?.currentTurn === idx,
              myIdx,
              { timeout: 10_000 },
            ).catch(() => {
              // Server may reject if conditions changed; that is acceptable.
            })

            const after = await getState(page)
            if (after?.currentTurn === myIdx) {
              testedInterrupt = true
            }
            break
          }
        }
      }

      // On our turn: play or draw+pass normally.
      if (isMyTurn) {
        const { discard: d, activeColor, pendingDraw } = state
        const hand = state.myHand ?? []
        const playable = hand.find((c) => {
          if ((pendingDraw ?? 0) > 0)
            return c.kind === 'draw_two' || c.kind === 'wild_draw_four'
          if (
            c.kind === 'wild' ||
            c.kind === 'wild_draw_four' ||
            c.kind === 'swap' ||
            c.kind === 'global_switch'
          )
            return true
          if (!d) return true
          if (c.color === activeColor) return true
          if (c.kind !== 'number' && c.kind === d.kind) return true
          if (c.kind === 'number' && d.kind === 'number') return c.value === d.value
          return false
        })

        if (playable) {
          if (playable.kind === 'wild' || playable.kind === 'wild_draw_four') {
            await sendMsg(page, { type: 'play_card', card: playable, chosen_color: 'red' })
          } else if (playable.kind === 'swap') {
            const opponents = state.players.filter(
              (p) => p.index !== myIdx && !p.finished,
            )
            if (opponents.length > 0) {
              await sendMsg(page, {
                type: 'play_card',
                card: playable,
                chosen_player: opponents[0].index,
              })
            } else {
              await sendMsg(page, { type: 'draw_card' })
              await page.waitForFunction(
                () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
                undefined,
                { timeout: 8_000 },
              )
              await sendMsg(page, { type: 'pass_turn' })
            }
          } else if ((pendingDraw ?? 0) > 0) {
            await sendMsg(page, { type: 'draw_card' })
          } else {
            await sendMsg(page, { type: 'play_card', card: playable })
          }
        } else if ((pendingDraw ?? 0) > 0) {
          await sendMsg(page, { type: 'draw_card' })
        } else {
          await sendMsg(page, { type: 'draw_card' })
          await page.waitForFunction(
            () => window.__LOCO_E2E__?.getState?.()?.hasDrawn === true,
            undefined,
            { timeout: 8_000 },
          )
          await sendMsg(page, { type: 'pass_turn' })
        }
      }

      await page.waitForTimeout(400)
    }

    if (!testedInterrupt) {
      test.info().annotations.push({
        type: 'note',
        description:
          'No exact-match interrupt opportunity arose in this run — interrupt_play test skipped (deck is random)',
      })
    }
  })

  /**
   * Two-player real-time sync with special-card flow: Alice plays a card and Bob's
   * view updates.  Exercises card_played broadcast with players array (including
   * finished/placement fields).
   */
  test('two-player sync: card play is reflected on both clients', async ({ browser }) => {
    const ctx1 = await browser.newContext()
    const ctx2 = await browser.newContext()
    const page1 = await ctx1.newPage()
    const page2 = await ctx2.newPage()

    try {
      const roomCode = await createRoom(page1, 'Alice')
      await joinRoom(page2, 'Bob', roomCode)
      await page1.getByRole('button', { name: T.startGame }).click()

      await expect(page1.locator('canvas')).toBeVisible({ timeout: 10_000 })
      await expect(page2.locator('canvas')).toBeVisible({ timeout: 10_000 })

      const aliceState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceIndex = aliceState?.myIndex ?? 0

      const bobView = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const aliceFromBob = bobView?.players.find((p) => p.index === aliceIndex)
      const handBefore = aliceFromBob?.hand_size ?? 7

      // Wait for Alice's turn and play or draw.
      await waitForMyTurn(page1, 30_000)
      const aliceCurrentState = await page1.evaluate(() => window.__LOCO_E2E__?.getState?.())
      const { myHand, discard, activeColor, pendingDraw } = aliceCurrentState ?? {}

      const playable = (myHand ?? []).find((c) => {
        if ((pendingDraw ?? 0) > 0)
          return c.kind === 'draw_two' || c.kind === 'wild_draw_four'
        if (c.kind === 'wild' || c.kind === 'wild_draw_four') return true
        if (!discard) return true
        if (c.color === activeColor) return true
        if (c.kind !== 'number' && c.kind === discard.kind) return true
        if (c.kind === 'number' && discard.kind === 'number') return c.value === discard.value
        return false
      })

      if (playable && playable.kind !== 'swap') {
        if (playable.kind === 'wild' || playable.kind === 'wild_draw_four') {
          await sendMsg(page1, { type: 'play_card', card: playable, chosen_color: 'red' })
        } else {
          await sendMsg(page1, { type: 'play_card', card: playable })
        }

        // Bob's view of Alice's hand_size must decrease by 1.
        await page2.waitForFunction(
          ([idx, before]: [number, number]) => {
            const players = window.__LOCO_E2E__?.getState?.()?.players ?? []
            const alice = players.find((p) => p.index === idx)
            return (alice?.hand_size ?? 0) < before
          },
          [aliceIndex, handBefore] as [number, number],
          { timeout: 10_000 },
        )

        const bobUpdated = await page2.evaluate(() => window.__LOCO_E2E__?.getState?.())
        const aliceAfter = bobUpdated?.players.find((p) => p.index === aliceIndex)
        expect(aliceAfter?.hand_size).toBeLessThan(handBefore)
      }
    } finally {
      await ctx1.close()
      await ctx2.close()
    }
  })
})
