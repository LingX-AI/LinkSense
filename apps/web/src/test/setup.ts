import "@testing-library/jest-dom/vitest"
import { vi } from "vitest"
import { configure } from "@testing-library/react"

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

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

class DOMMatrixMock {}

if (typeof window !== "undefined" && typeof HTMLElement !== "undefined") {
  // Async navigation still uses real modules while the browser suite shares CPU.
  configure({ asyncUtilTimeout: 3_000 })
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    writable: true,
    value: vi.fn(() => null),
  })
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage(),
  })
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: createStorage(),
  })
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
}
