import '@testing-library/jest-dom'

// jsdom doesn't ship ResizeObserver; useElementSize relies on it.
class ResizeObserverShim {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).ResizeObserver = ResizeObserverShim
}
