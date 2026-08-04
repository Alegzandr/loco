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
    gameStore.getState().applyEmote(0, 'nice')
    const pressed = [...document.querySelectorAll('.emoteRow button')]
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.textContent?.trim())
    expect(pressed).toEqual([en.emotes.nice])
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
    gameStore.getState().applyEmote(0, 'nice')
    expect(document.querySelectorAll('.emoteSlot')).toHaveLength(players.length)
  })

  it('replaces what a seat was saying rather than adding to it', () => {
    gameStore.getState().applyEmote(0, 'gg')
    gameStore.getState().applyEmote(1, 'close')
    gameStore.getState().applyEmote(0, 'nice')
    const said = gameStore.getState().emotes
    expect(said).toHaveLength(2)
    expect(said.find((e) => e.seat === 0)?.emote).toBe('nice')
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
