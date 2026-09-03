/**
 * The socket does not survive the page being frozen.
 *
 * A browser putting a document into the back/forward cache freezes it instead of
 * unloading it, and keeps its WebSocket open with it. Nothing on the server can
 * tell that document from a player: it went on counting somebody who had walked
 * off to a content page, so coming back to the home screen — a second document,
 * a second socket — reported two players where one person was there. Measured in
 * Brave with the back/forward cache on, which is every real browser and not the
 * one the end-to-end suite drives: Playwright launches Chromium with the cache
 * off, so every navigation there really does unload the page.
 *
 * So `pagehide` drops the socket and `pageshow` asks for it again, and both
 * halves are pinned here: without the first the count is wrong, and without the
 * second a restored page sits behind the reconnect curtain for good.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from './renderHook'
import { webSocket } from '../hooks/webSocket.svelte'

class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeSocket[] = []

  readyState = FakeSocket.CONNECTING
  closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: ((e: Event) => void) | null = null
  onclose: (() => void) | null = null

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  close() {
    this.closed = true
    this.readyState = FakeSocket.CLOSED
  }

  send() {}
}

/** jsdom has no `PageTransitionEvent`, and `persisted` is the whole payload. */
function pageEvent(type: 'pagehide' | 'pageshow', persisted: boolean): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'persisted', { value: persisted })
  return event
}

let original: typeof WebSocket

beforeEach(() => {
  original = globalThis.WebSocket
  FakeSocket.instances = []
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
})

afterEach(() => {
  globalThis.WebSocket = original
})

function mount() {
  return renderHook(() => webSocket(vi.fn()))
}

describe('the socket and the back/forward cache', () => {
  it('opens one socket on mount', () => {
    const { unmount } = mount()
    expect(FakeSocket.instances).toHaveLength(1)
    unmount()
  })

  it('drops the socket when the page is frozen', () => {
    const { result, unmount } = mount()
    FakeSocket.instances[0].open()
    expect(result.wsStatus).toBe('open')

    window.dispatchEvent(pageEvent('pagehide', true))

    expect(FakeSocket.instances[0].closed).toBe(true)
    expect(result.wsStatus).toBe('closed')
    unmount()
  })

  it('asks for a new socket when the page is restored', () => {
    const { unmount } = mount()
    FakeSocket.instances[0].open()

    window.dispatchEvent(pageEvent('pagehide', true))
    window.dispatchEvent(pageEvent('pageshow', true))

    expect(FakeSocket.instances).toHaveLength(2)
    expect(FakeSocket.instances[1].closed).toBe(false)
    unmount()
  })

  it('opens nothing extra on an ordinary load', () => {
    // `connect()` has already run by the time this fires, so a second socket
    // here would be the very thing the pair exists to prevent.
    const { unmount } = mount()
    window.dispatchEvent(pageEvent('pageshow', false))
    expect(FakeSocket.instances).toHaveLength(1)
    unmount()
  })

  it('stops listening once unmounted, so a later freeze reaches nothing', () => {
    const { unmount } = mount()
    FakeSocket.instances[0].open()
    unmount()
    expect(FakeSocket.instances[0].closed).toBe(true)

    window.dispatchEvent(pageEvent('pageshow', true))
    expect(FakeSocket.instances).toHaveLength(1)
  })
})
