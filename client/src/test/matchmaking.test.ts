import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from './render'
import { en } from '../i18n/en'
import { gameStore } from '../hooks/gameStore'
import Searching from '../components/Searching.svelte'
import {
  searchStage,
  formatElapsed,
  SEARCH_PATIENT_MS,
  SEARCH_LONG_MS,
} from '../components/searchStages'
import MatchFound from '../components/MatchFound.svelte'
import GameOver from '../components/GameOver.svelte'

const players = [
  { index: 0, nickname: 'Alice', hand_size: 8, connected: true },
  { index: 1, nickname: 'Bob', hand_size: 8, connected: true },
]

describe('search stages', () => {
  it('moves through three stages on elapsed time alone', () => {
    expect(searchStage(0)).toBe('fresh')
    expect(searchStage(SEARCH_PATIENT_MS - 1)).toBe('fresh')
    expect(searchStage(SEARCH_PATIENT_MS)).toBe('patient')
    expect(searchStage(SEARCH_LONG_MS - 1)).toBe('patient')
    expect(searchStage(SEARCH_LONG_MS)).toBe('long')
  })

  it('formats the wait as m:ss', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(9_400)).toBe('0:09')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(-500)).toBe('0:00')
  })
})

describe('Searching screen', () => {
  const noop = () => {}

  it('says the wait is ordinary at first', () => {
    render(
      Searching, { startedAt: Date.now(), nickname: "Alice", onCancel: noop, onCreateTable: noop },
    )
    expect(screen.getByText(en.searchFresh)).toBeInTheDocument()
    expect(screen.queryByText(en.searchCreateTable)).not.toBeInTheDocument()
  })

  it('admits it is still looking once the wait is long enough', () => {
    render(
      Searching, { startedAt: Date.now() - SEARCH_PATIENT_MS - 1000, nickname: "Alice", onCancel: noop, onCreateTable: noop },
    )
    expect(screen.getByText(en.searchPatient)).toBeInTheDocument()
  })

  it('offers a private table instead once the wait is indeterminate', () => {
    render(
      Searching, { startedAt: Date.now() - SEARCH_LONG_MS - 1000, nickname: "Alice", onCancel: noop, onCreateTable: noop },
    )
    expect(screen.getByText(en.searchLong)).toBeInTheDocument()
    expect(screen.getByText(en.searchCreateTable)).toBeInTheDocument()
  })

  // A search can last minutes, and it is exactly where somebody turns the music
  // down or reads the rules while they wait. Every other screen carries the same
  // three controls; this one used to be the hole in the row.
  it('keeps preferences, sound and rules reachable while waiting', () => {
    render(
      Searching, { startedAt: Date.now(), nickname: "Alice", onCancel: noop, onCreateTable: noop },
    )
    expect(screen.getByLabelText(en.prefsBtn)).toBeInTheDocument()
    expect(screen.getByLabelText(en.audioTitle)).toBeInTheDocument()
    expect(screen.getByLabelText(en.rulesBtn)).toBeInTheDocument()
  })

  // The rule the whole mode rests on. None of the three things this screen can
  // say may report, imply or hint at how many people are in the queue: a screen
  // that could render "1 searching" would eventually render it, and every
  // player who leaves on that sentence is the opponent the next one was about
  // to get. The server never sends the number either (matchmaking_queued is an
  // empty acknowledgement), so this is belt and braces on the copy.
  it('never reports how many players are searching', () => {
    for (const copy of [en.searchFresh, en.searchPatient, en.searchLong, en.searchTitle]) {
      expect(copy).not.toMatch(/\d+\s*(player|opponent|people|in (the )?queue)/i)
      expect(copy).not.toMatch(/queue/i)
    }
  })
})

describe('MatchFound reveal', () => {
  it('names both players and counts down to the deal', () => {
    render(
      MatchFound, { myNickname: "Alice", opponentNickname: "Bob", mySeat: 0, startsAt: Date.now() + 2500, format: "BO1" },
    )
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('VS')).toBeInTheDocument()
    expect(screen.getByText(en.matchFoundStartingIn.replace('%n', '3'))).toBeInTheDocument()
    // The badge says what is about to be played, not the wire's name for it.
    expect(screen.getByText(en.bestOf1)).toBeInTheDocument()
    expect(screen.queryByText('BO1')).not.toBeInTheDocument()
  })

  // The countdown is presentation: the match begins when the server deals. A
  // reveal that ran out first must hold, not act.
  it('holds on the dealing message once the countdown is spent', () => {
    render(
      MatchFound, { myNickname: "Alice", opponentNickname: "Bob", mySeat: 0, startsAt: Date.now() - 1000, format: "BO1" },
    )
    expect(screen.getByText(en.matchFoundDealing)).toBeInTheDocument()
  })
})

describe('matchmaking store transitions', () => {
  beforeEach(() => {
    gameStore.setState({
      screen: 'lobby',
      isMatchmade: false,
      matchFound: null,
      searchStartedAt: null,
      forfeitBy: null,
      opponentAway: null,
      players: [],
      myIndex: -1,
      sessionToken: '',
      roomCode: '',
    })
  })

  it('enters the search screen with its own clock', () => {
    gameStore.getState().beginSearch()
    const s = gameStore.getState()
    expect(s.screen).toBe('searching')
    expect(s.searchStartedAt).toBeGreaterThan(0)
  })

  it('seats both players straight from match_found, with no waiting room', () => {
    gameStore.getState().applyMatchFound({
      roomCode: 'KX7QP2',
      mySeat: 1,
      sessionToken: 'tok',
      players,
      matchFormat: 'BO1',
      maxPlayers: 2,
      startsInMs: 2500,
    })
    const s = gameStore.getState()
    expect(s.screen).toBe('matchfound')
    expect(s.isMatchmade).toBe(true)
    expect(s.myIndex).toBe(1)
    expect(s.myNickname).toBe('Bob')
    expect(s.sessionToken).toBe('tok')
    expect(s.matchFound?.opponentNickname).toBe('Alice')
    expect(s.matchFound?.startsAt).toBeGreaterThan(Date.now())
  })

  // A cancel that raced a pairing arrives after the seat does. Acting on it
  // would drag a seated player out of a match that is about to be dealt.
  it('will not pull a seated player back to the lobby on a late cancel', () => {
    gameStore.getState().applyMatchFound({
      roomCode: 'KX7QP2',
      mySeat: 0,
      sessionToken: 'tok',
      players,
      matchFormat: 'BO1',
      maxPlayers: 2,
      startsInMs: 2500,
    })
    gameStore.getState().endSearch()
    expect(gameStore.getState().screen).toBe('matchfound')
  })

  it('records who abandoned when a match ends on a forfeit', () => {
    gameStore.getState().applyMatchEnd('Alice', [], 1)
    const s = gameStore.getState()
    expect(s.screen).toBe('gameover')
    expect(s.forfeitBy).toBe(1)
    expect(s.showRoundSummary).toBe(false)
  })

  it('leaves forfeitBy null for a match that ended on the cards', () => {
    gameStore.getState().applyMatchEnd('Alice', [])
    expect(gameStore.getState().forfeitBy).toBeNull()
  })

  // Only a deadline makes the banner worth showing: an ordinary room sends none
  // and must not get a countdown on a seat that is simply being held.
  it('only tracks an absent opponent when the server gave a deadline', () => {
    const deadline = Date.now() + 15_000
    gameStore.getState().applyOpponentAway(1, deadline)
    expect(gameStore.getState().opponentAway).toEqual({ seat: 1, deadline })

    gameStore.getState().clearOpponentAway(0)
    expect(gameStore.getState().opponentAway).not.toBeNull()
    gameStore.getState().clearOpponentAway(1)
    expect(gameStore.getState().opponentAway).toBeNull()

    gameStore.getState().applyOpponentAway(1, 0)
    expect(gameStore.getState().opponentAway).toBeNull()
  })

  it('drops the seat, the token and the match on the way home', () => {
    gameStore.setState({ roomCode: 'KX7QP2', sessionToken: 'tok', myIndex: 1, isMatchmade: true })
    gameStore.getState().resetToHome()
    const s = gameStore.getState()
    expect(s.screen).toBe('lobby')
    expect(s.roomCode).toBe('')
    expect(s.sessionToken).toBe('')
    expect(s.myIndex).toBe(-1)
    expect(s.isMatchmade).toBe(false)
  })
})

describe('GameOver after a forfeit', () => {
  it('tells the survivor the opponent left instead of celebrating a win', () => {
    render(
      GameOver, { winner: "Alice", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: 1, mySeat: 0, onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() },
    )
    expect(screen.getByText(en.forfeitWon)).toBeInTheDocument()
    expect(screen.getByText(en.forfeitWonSub)).toBeInTheDocument()
    expect(screen.queryByText(en.matchWon)).not.toBeInTheDocument()
  })

  it('tells the player who walked that they walked', () => {
    render(
      GameOver, { winner: "Bob", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: 0, mySeat: 0, onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() },
    )
    expect(screen.getByText(en.forfeitYouLeft)).toBeInTheDocument()
  })

  // A matchmade rematch is an agreement, so the screen offers both: ask this
  // opponent again, or go and find the next one.
  it('offers both another round with this opponent and another opponent', () => {
    const onRematch = vi.fn()
    const onFindMatch = vi.fn()
    render(
      GameOver, { winner: "Alice", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: null, mySeat: 0, rematchOffers: [], onRematch: onRematch, onFindMatch: onFindMatch, onLeave: vi.fn() },
    )
    screen.getByText(en.rematch).click()
    expect(onRematch).toHaveBeenCalled()
    screen.getByText(en.findAnotherOpponent).click()
    expect(onFindMatch).toHaveBeenCalled()
  })

  // The point of making the offers public: knowing somebody is waiting on you.
  it('says the opponent is waiting once they have asked first', () => {
    render(
      GameOver, { winner: "Alice", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: null, mySeat: 0, rematchOffers: [1], onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() },
    )
    expect(screen.getByText(en.rematchAccept)).toBeInTheDocument()
  })

  it('holds the button once we are the one waiting', () => {
    render(
      GameOver, { winner: "Alice", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: null, mySeat: 0, rematchOffers: [0], onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() },
    )
    const waiting = screen.getByText(en.rematchWaitingOpponent)
    expect(waiting).toBeInTheDocument()
    expect(waiting).toBeDisabled()
  })

  // After a forfeit there is nobody left to agree with, and the server refuses
  // the offer. The button stays where it is, disabled, so the card does not
  // reflow, and App requeues this player without being asked, which is what
  // actually resolves the screen.
  it('greys the rematch out after a forfeit and keeps the queue on offer', () => {
    render(
      GameOver, { winner: "Alice", myNickname: "Alice", scoreboard: [], matchOver: true, isMatchmade: true, forfeitBy: 1, mySeat: 0, rematchOffers: [], onRematch: vi.fn(), onFindMatch: vi.fn(), onLeave: vi.fn() },
    )
    expect(screen.getByRole('button', { name: en.rematch })).toBeDisabled()
    expect(screen.getByText(en.findAnotherOpponent)).toBeInTheDocument()
  })
})
