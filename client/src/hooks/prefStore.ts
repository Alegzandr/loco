
/**
 * A single on/off preference, kept in a module store rather than in the game
 * store or a context.
 *
 * Every one of these is read by screens that share no parent (a card in the
 * hand, the picker over the board, the panel in the top bar) and has to
 * survive a reload without a server round trip. None of them ever reaches the
 * wire: these are things about the person at the screen, not about the match.
 */
export interface BooleanPref {
  get(): boolean
  set(next: boolean): void
  /**
   * How a component follows the preference: `watchPref` in
   * `hooks/prefs.svelte.ts` wraps this, and every screen goes through that.
   * The store itself stays framework-free, which is what let it keep its value
   * and its listeners while the screens around it were rewritten.
   */
  subscribe(listener: () => void): () => void
  /** Test/showcase seam: re-read storage and notify. */
  reset(): void
}

export function createBooleanPref(storageKey: string): BooleanPref {
  const read = (): boolean => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  }

  let value = read()
  const listeners = new Set<() => void>()
  const get = () => value

  const subscribe = (cb: () => void): (() => void) => {
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  }

  return {
    get,
    set(next: boolean) {
      if (next === value) return
      value = next
      try {
        localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {
        // A blocked storage still gets the preference for this session; losing
        // it on the next load beats refusing to apply it at all.
      }
      listeners.forEach((l) => l())
    },
    subscribe,
    reset() {
      value = read()
      listeners.forEach((l) => l())
    },
  }
}
