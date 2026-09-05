import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import GameOver from '../components/GameOver.svelte'
import { EMOTE_ORDER } from '../components/emotes'
import { gameStore } from '../hooks/gameStore'
import { en } from '../i18n/en'
import type { PlayerDTO } from '../types/protocol'

/**
 * The whole vocabulary the game has: three fixed things, on the game-over screen.
 *
 * What is pinned is what makes it safe rather than what makes it work — the set
 * is closed, and nothing said is kept.
 */

const players: PlayerDTO[] = [
  { index: 0, nickname: 'Alice', hand_size: 0, connected: true },
  { index: 1, nickname: 'Bob', hand_size: 4, connected: true },
]

const base = {
  winner: 'Alice',
  myNickname: 'Alice',
  mySeat: 0,
  matchOver: true,
  players,
  onRematch: vi.fn(),
  onFindMatch: vi.fn(),
  onLeave: vi.fn(),
}

describe('the three things', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  it('offers exactly three, in the order the row reads', () => {
    render(GameOver, { ...base, onEmote: vi.fn() })
    const row = document.querySelector('.emoteRow')!
    const labels = [...row.querySelectorAll('button')].map((b) => b.textContent?.trim())
    expect(labels).toEqual(EMOTE_ORDER.map((id) => en.emotes[id]))
    expect(labels).toHaveLength(3)
  })

  it('sends the identifier, never the words', () => {
    const onEmote = vi.fn()
    render(GameOver, { ...base, onEmote })
    fireEvent.click(screen.getByRole('button', { name: en.emotes.gg }))
    expect(onEmote).toHaveBeenCalledWith('gg')
  })

  // The set is the server's, and the client only draws what it is told. A
  // fourth identifier would be a compile error here; this is the runtime half.
  it('draws nothing at all where the screen was not given a way to send one', () => {
    render(GameOver, { ...base })
    expect(document.querySelector('.emoteRow')).toBeNull()
  })

  // Scoped to the feed: the same words are on the button that sends them, so an
  // unscoped query would pass on the control rather than on the bubble.
  it('shows what the table said, named by seat', () => {
    render(GameOver, { ...base, onEmote: vi.fn() })
    gameStore.getState().applyEmote(1, 'close')
    const feed = document.querySelector('.emoteFeed')
    expect(feed, 'a bubble must be drawn').toBeTruthy()
    expect(feed!.textContent).toContain(en.emotes.close)
    expect(feed!.textContent).toContain('Bob')
  })

  // The row is three states, not three sends: pressing another one moves the
  // mark rather than adding a second bubble.
  it('marks the one we are saying, and only that one', () => {
    render(GameOver, { ...base, onEmote: vi.fn() })
    gameStore.getState().applyEmote(0, 'lucky')
    const pressed = [...document.querySelectorAll('.emoteRow button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent?.trim())
    expect(pressed).toEqual([en.emotes.lucky])
  })
})

/*
 * A seat the server plays is refused the emote in both directions
 * (`hub/emotes.go`), so it is not somebody to say "gg" to. At a table where
 * every other seat is one, the three buttons could only ever be pressed at
 * nobody.
 */
describe('nobody to talk to', () => {
  const withBot = (seats: (string | null)[]): PlayerDTO[] =>
    seats.map((nickname, index) => ({
      index,
      nickname: nickname ?? `Bot${index}`,
      hand_size: 0,
      connected: true,
      is_bot: nickname === null,
    }))

  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  // The block goes rather than going dead: a dead control on this card means an
  // offer that may still come back, and nothing is coming back to answer this
  // one.
  it('draws nothing where every other seat is the server', () => {
    render(GameOver, { ...base, players: withBot(['Alice', null]), onEmote: vi.fn() })
    expect(document.querySelector('.emotes')).toBeNull()
    expect(document.querySelector('.emoteRow')).toBeNull()
  })

  it('keeps it where one human is still at the table among the bots', () => {
    render(GameOver, { ...base, players: withBot(['Alice', null, 'Bob', null]), onEmote: vi.fn() })
    expect(document.querySelector('.emoteRow')).toBeTruthy()
  })

  // A bot's line is empty forever, which is height paid for a sentence that
  // cannot be written: the feed is the seats that can speak.
  it('gives a bot no line of its own', () => {
    render(GameOver, { ...base, players: withBot(['Alice', null, 'Bob', null]), onEmote: vi.fn() })
    expect(document.querySelectorAll('.emoteSlot')).toHaveLength(2)
  })
})

describe('one line per seat, and the card never grows', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  // The whole point of the shape: the feed is the roster, so what a table
  // saying a lot changes is what a line reads, never how many lines there are.
  it('draws a slot per player before anybody has said anything', () => {
    render(GameOver, { ...base, onEmote: vi.fn() })
    expect(document.querySelectorAll('.emoteSlot')).toHaveLength(players.length)

    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applyEmote(1, 'gg')
    gameStore.getState().applyEmote(0, 'lucky')
    expect(document.querySelectorAll('.emoteSlot')).toHaveLength(players.length)
  })

  it('replaces what a seat was saying rather than adding to it', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applyEmote(1, 'close')
    gameStore.getState().applyEmote(0, 'lucky')
    const said = gameStore.getState().emotes
    expect(said).toHaveLength(2)
    expect(said.find((e) => e.seat === 0)?.emote).toBe('lucky')
    expect(said.find((e) => e.seat === 1)?.emote).toBe('close')
  })

  it('is forgotten on the way home and on the way into the next match', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().resetToHome()
    expect(gameStore.getState().emotes).toEqual([])

    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applyRematch(0, players, 'BO1', 2)
    expect(gameStore.getState().emotes).toEqual([])
  })
})

/**
 * Nothing is kept, and "nothing" has to hold at every door onto this screen —
 * not only the one the forfeit comes through. What was said belongs to the
 * match it was said about: read over the next one's scoreboard it is somebody
 * congratulating a result that has not happened yet.
 */
describe('a fresh screen says nothing yet, whichever way it opens', () => {
  beforeEach(() => {
    gameStore.getState().resetToHome()
  })

  // The ordinary end of a match: `round_end` puts the summary up and `match_end`
  // waits behind it, so this dismissal — not applyMatchEnd — is what opens the
  // game-over screen almost every time. It was the one door with no reset on it.
  it('forgets it when the buffered match end opens the screen', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().setPendingMatchEnd('Alice', [], [])
    gameStore.getState().dismissRoundSummary()
    expect(gameStore.getState().screen).toBe('gameover')
    expect(gameStore.getState().emotes).toEqual([])
  })

  // A matchmade rematch is dealt as another pairing (server startRematchedMatch),
  // so this is the ordinary table's `applyRematch` seen from the queue's side.
  it('forgets it when a matchmade rematch deals the next pairing', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applyMatchFound({
      roomCode: 'ABC123',
      mySeat: 0,
      sessionToken: 'tok',
      players,
      matchFormat: 'BO1',
      maxPlayers: 2,
      startsInMs: 3000,
    })
    expect(gameStore.getState().emotes).toEqual([])
  })

  it('forgets it when another hand is dealt against the server', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applySoloStarted('ABC123', 0, 'tok')
    expect(gameStore.getState().emotes).toEqual([])
  })
})
