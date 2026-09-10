import type { Logger } from "pino"

import type { RunnerConfig } from "../config.js"
import { DockerEngineClient } from "../docker/engine-client.js"
import { DockerWorkerProvider } from "./docker-worker-provider.js"
import { LocalProcessWorkerProvider } from "./local-process-worker-provider.js"
import type { WorkerProvider } from "./worker-provider.js"

export function createWorkerProvider(
  config: RunnerConfig,
  logger: Logger,
): WorkerProvider {
  switch (config.LINKSENSE_WORKER_PROVIDER) {
    case "docker":
      return new DockerWorkerProvider(
        config,
        new DockerEngineClient(
          config.LINKSENSE_DOCKER_SOCKET_PATH,
          config.LINKSENSE_DOCKER_API_VERSION,
        ),
        logger,
      )
    case "local-process":
      return new LocalProcessWorkerProvider(config, logger)
  }
}
