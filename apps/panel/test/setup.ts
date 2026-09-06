/**
 * Panel test setup: unmount between tests, and give jsdom the two browser APIs
 * the panel uses that jsdom does not implement.
 */
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  window.localStorage.clear()
})

// The download flow turns a fetched file into an object URL. jsdom has neither.
if (typeof URL.createObjectURL !== 'function') {
  Object.defineProperty(URL, 'createObjectURL', { value: () => 'blob:test', writable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => undefined, writable: true })
}

/*
 * The download flow appends an <a download> and clicks it. jsdom has no
 * downloads and logs "Not implemented: navigation" for the click, so the click
 * is stubbed out -- the tests assert on the fetch that produced the blob, which
 * is the part that has to be right.
 */
HTMLAnchorElement.prototype.click = function click(): void {}

// The theme toggle asks the OS what it prefers.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}
