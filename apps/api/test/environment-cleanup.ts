import { afterAll, vi } from "vitest"

// Each file owns its injected dependencies; release process-wide test overrides
// before the worker runs another file against the same real module graph.
afterAll(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
