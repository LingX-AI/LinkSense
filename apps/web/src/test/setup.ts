import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, String(value))
    },
  }
}

Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: createStorage(),
})
Object.defineProperty(window, "sessionStorage", {
  configurable: true,
  value: createStorage(),
})

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixMock {}

Object.defineProperty(window, "ResizeObserver", {
  writable: true,
  value: ResizeObserverMock,
})

Object.defineProperty(globalThis, "DOMMatrix", {
  configurable: true,
  writable: true,
  value: DOMMatrixMock,
})

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  writable: true,
  value: vi.fn(),
})
