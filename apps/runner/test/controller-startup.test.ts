import { expect, it, vi } from "vitest"

const startup = vi.hoisted(() => {
  const deferred = () => {
    let resolve = () => {}
    const promise = new Promise<void>((complete) => { resolve = complete })
    return { promise, resolve }
  }
  return {
    initialized: deferred(),
    imported: deferred(),
    importStarted: vi.fn(),
    initialize: vi.fn(),
    listen: vi.fn(async () => undefined),
  }
})

vi.mock("../src/config.js", async (original) => ({
  ...await original<object>(),
  parseRunnerConfig: () => ({
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_RUNNER_HOST: "127.0.0.1",
    LINKSENSE_RUNNER_PORT: 4010,
    LINKSENSE_DOCKER_SOCKET_PATH: "/unused-docker.sock",
    LINKSENSE_DOCKER_API_VERSION: "v1.47",
  }),
}))
vi.mock("../src/controller/worker-manager.js", () => ({
  WorkerManager: class {
    initialize() {
      startup.initialize()
      return startup.initialized.promise
    }
    startIdleReaper() {}
    stopIdleReaper() {}
  },
}))
vi.mock("../src/controller/server.js", async () => {
  startup.importStarted()
  await startup.imported.promise
  return { buildControllerServer: () => ({ listen: startup.listen }) }
})

it("overlaps controller module loading with the real worker initialization gate", async () => {
  const { main } = await import("../src/index.js")
  const signals = ["SIGINT", "SIGTERM"] as const
  const previous = new Set(signals.flatMap((signal) => process.listeners(signal)))
  const running = main({})
  void running.catch(() => undefined)
  try {
    await vi.waitFor(() => {
      expect(startup.initialize).toHaveBeenCalledOnce()
      expect(startup.importStarted).toHaveBeenCalledOnce()
    })
    startup.imported.resolve()
    await Promise.resolve()
    expect(startup.listen).not.toHaveBeenCalled()
    startup.initialized.resolve()
    await running
    expect(startup.listen).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4010 })
  } finally {
    startup.imported.resolve()
    startup.initialized.resolve()
    await running
    for (const signal of signals) {
      for (const listener of process.listeners(signal)) {
        if (!previous.has(listener)) process.removeListener(signal, listener)
      }
    }
  }
})
