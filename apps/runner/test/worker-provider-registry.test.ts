import pino from "pino"
import { describe, expect, it } from "vitest"

import { parseRunnerConfig } from "../src/config.js"
import { DockerWorkerProvider } from "../src/controller/docker-worker-provider.js"
import { LocalProcessWorkerProvider } from "../src/controller/local-process-worker-provider.js"
import { createWorkerProvider } from "../src/controller/worker-provider-registry.js"

const baseEnvironment = {
  NODE_ENV: "development",
  LINKSENSE_RUNNER_MODE: "controller",
  LINKSENSE_RUNNER_HOST: "127.0.0.1",
  LINKSENSE_USER_DATA_ROOT: "/tmp/linksense/users",
  LINKSENSE_RUNNER_SHARED_SECRET: "runner-111111111111111111111111111111",
  LINKSENSE_API_INTERNAL_URL: "http://127.0.0.1:4000/internal",
}

describe("createWorkerProvider", () => {
  it("selects exactly the configured provider", () => {
    const logger = pino({ level: "silent" })
    expect(
      createWorkerProvider(
        parseRunnerConfig({
          ...baseEnvironment,
          LINKSENSE_WORKER_PROVIDER: "docker",
        }),
        logger,
      ),
    ).toBeInstanceOf(DockerWorkerProvider)
    expect(
      createWorkerProvider(
        parseRunnerConfig({
          ...baseEnvironment,
          LINKSENSE_WORKER_PROVIDER: "local-process",
        }),
        logger,
      ),
    ).toBeInstanceOf(LocalProcessWorkerProvider)
  })

  it("rejects an unknown provider instead of silently falling back to Docker", () => {
    expect(() =>
      parseRunnerConfig({
        ...baseEnvironment,
        LINKSENSE_WORKER_PROVIDER: "remote-unknown",
      }),
    ).toThrow()
  })
})
