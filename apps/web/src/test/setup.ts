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
  // JSDOM does not fetch or decode image resources. Tests that exercise the
  // loading boundary override this promise to model pending or failed decodes.
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    writable: true,
    value: () => Promise.resolve(),
  })
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
    value: vi.fn((query: string) => ({
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
  Object.defineProperty(HTMLElement.prototype, "getAnimations", {
    configurable: true,
    writable: true,
    value: vi.fn(() => []),
  })
  // JSDOM does not render animations; keep Base UI transitions synchronous.
  Object.defineProperty(globalThis, "BASE_UI_ANIMATIONS_DISABLED", {
    configurable: true,
    value: true,
  })
}
