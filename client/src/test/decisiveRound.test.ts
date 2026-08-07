/**
 * The round the format did not plan for.
 *
 * A match is settled on rounds won, then points, then the smallest pile of
 * leftovers (`Room.determineMatchWinner`). When that chain separates nobody the
 * server deals one more round and the match keeps running — which is correct,
 * and used to reach the player as a counter that had come loose: "Round 4 · BO3"
 * on the board and "Round 4 of 3 down" on the summary card, at the tensest point
 * of the evening, with nothing anywhere saying why the match had not ended.
 *
 * Both halves are pinned here: the chip stops counting past the format, and the
 * summary card announces the extra round rather than leaving the player to
 * notice that the game-over screen never came.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import { act } from './renderHook'
import GameView from '../components/GameView.svelte'
import RoundSummary from '../components/RoundSummary.svelte'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import type { CardDTO, MatchFormat, ScoreboardEntryDTO } from '../types/protocol'

const red3: CardDTO = { color: 'red', kind: 'number', value: 3 }

function seat(index: number, nickname: string, handSize: number) {
  return { index, nickname, hand_size: handSize, connected: true }
}

function seedBoard(matchFormat: MatchFormat, roundNumber: number) {
  // jsdom measures everything as 0×0, and the board renders nothing until
  // elementSize sees a real box.
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1240, height: 790, top: 0, left: 0, right: 1240, bottom: 790, x: 0, y: 0 }) as DOMRect

  gameStore.setState({
    myIndex: 0,
    myHand: [red3],
    players: [seat(0, 'Alice', 1), seat(1, 'Bob', 3), seat(2, 'Cleo', 2)],
    discard: red3,
    activeColor: 'red',
    currentTurn: 0,
    direction: 1,
    pendingDraw: 0,
    hasDrawn: false,
    lastPlay: null,
    showRoundSummary: false,
    matchFormat,
    roundNumber,
  })
}

describe('the board chip', () => {
  beforeEach(() => seedBoard('BO3', 2))

  it('counts the rounds of the format', () => {
    render(GameView, { onSend: vi.fn(), wsStatus: 'open' })
    expect(screen.getByText(`${en.round} 2 · BO3`)).toBeInTheDocument()
  })

  it('names the decisive round instead of counting past the format', () => {
    render(GameView, { onSend: vi.fn(), wsStatus: 'open' })
    act(() => {
      gameStore.setState({ roundNumber: 4 })
    })
    expect(screen.queryByText(`${en.round} 4 · BO3`)).not.toBeInTheDocument()
    expect(screen.getByText(en.decisiveRound)).toBeInTheDocument()
  })
})

const SCOREBOARD: ScoreboardEntryDTO[] = [
  { player_index: 0, nickname: 'Alice', score: 60, rounds_won: 1 },
  { player_index: 1, nickname: 'Bob', score: 60, rounds_won: 1 },
  { player_index: 2, nickname: 'Cleo', score: 54, rounds_won: 1 },
]

const ROUND_SCORES = SCOREBOARD.map((e) => ({
  player_index: e.player_index,
  nickname: e.nickname,
  round_points: e.player_index === 0 ? 30 : 0,
  cumulative_score: e.score,
  rounds_won: e.rounds_won,
}))

function summary(roundNumber: number, matchOverPending: boolean) {
  render(RoundSummary, {
    roundNumber,
    roundWinner: 'Alice',
    roundScores: ROUND_SCORES,
    scoreboard: SCOREBOARD,
    matchFormat: 'BO3' as MatchFormat,
    summaryCountdown: 8,
    matchOverPending,
    onDismiss: vi.fn(),
    t: en,
  })
}

describe('the round summary', () => {
  it('says nothing about a decisive round mid-format', () => {
    summary(2, false)
    expect(screen.queryByText(en.decisiveRound)).not.toBeInTheDocument()
  })

  // The match ended and its payload is buffered behind this card. Same round
  // number as the case below, and the opposite answer: the format running out
  // is not what makes a round decisive, nothing separating the table is.
  it('says nothing when the format ran out and somebody won', () => {
    summary(3, true)
    expect(screen.queryByText(en.decisiveRound)).not.toBeInTheDocument()
  })

  it('announces the extra round when the format ran out with the match still running', () => {
    summary(3, false)
    expect(screen.getByText(en.decisiveRound)).toBeInTheDocument()
    expect(screen.getByText(en.decisiveRoundWhy)).toBeInTheDocument()
  })

  // Past the format there is no honest number for the round that just ended.
  it('titles a finished decisive round without a number', () => {
    summary(4, true)
    expect(screen.getByText(new RegExp(`${en.decisiveRound} ${en.complete}`))).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(`4 ${en.of} 3`))).not.toBeInTheDocument()
  })
})
