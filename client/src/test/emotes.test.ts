import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from './render'
import GameOver from '../components/GameOver.svelte'
import { EMOTE_ORDER } from '../components/emotes'
import { gameStore } from '../hooks/gameStore'
import { EMOTE_TTL_MS } from '../hooks/store/types'
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
})

describe('nothing said is kept', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    gameStore.getState().resetToHome()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('drops a bubble once it has been up long enough', () => {
    gameStore.getState().applyEmote(1, 'gg')
    expect(gameStore.getState().emotes).toHaveLength(1)
    vi.advanceTimersByTime(EMOTE_TTL_MS + 1)
    gameStore.getState().pruneEmotes()
    expect(gameStore.getState().emotes).toHaveLength(0)
  })

  // The second arrival must not hold the first one up: the timer works to an
  // absolute deadline, and the write prunes what is already expired.
  it('does not extend the first one when a second arrives', () => {
    gameStore.getState().applyEmote(0, 'gg')
    vi.advanceTimersByTime(EMOTE_TTL_MS - 100)
    gameStore.getState().applyEmote(1, 'nice')
    expect(gameStore.getState().emotes).toHaveLength(2)
    vi.advanceTimersByTime(200)
    gameStore.getState().pruneEmotes()
    const left = gameStore.getState().emotes
    expect(left).toHaveLength(1)
    expect(left[0].emote).toBe('nice')
  })

  it('publishes nothing when a timer fires with nothing to drop', () => {
    gameStore.getState().applyEmote(0, 'gg')
    const before = gameStore.getState().emotes
    gameStore.getState().pruneEmotes()
    // The same array, not a copy: a new one would wake every subscriber for
    // nothing, and `game.current` is replaced whole on every publish.
    expect(gameStore.getState().emotes).toBe(before)
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
