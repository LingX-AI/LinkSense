import { afterAll, vi } from "vitest"

// Keep global overrides local to their test file when reusing worker modules.
afterAll(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
