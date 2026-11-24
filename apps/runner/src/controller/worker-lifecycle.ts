import type { Logger } from "pino"

import { DockerEngineError } from "../docker/engine-client.js"

export type WorkerRequestTrace = { requestId: string; apiRequestId?: string }

export async function measureWorkerStage<T>(
  logger: Logger,
  workerName: string,
  trace: WorkerRequestTrace | undefined,
  stage: "create" | "recover" | "start" | "ready",
  action: () => Promise<T>,
  resultFields?: (result: T) => { dockerStatusCode?: number; containerState?: string },
): Promise<T> {
  const startedAt = performance.now()
  try {
    const result = await action()
    logger.info(
      { ...trace, workerName, stage, outcome: "ok", durationMs: Math.round(performance.now() - startedAt), ...resultFields?.(result) },
      "worker lifecycle stage",
    )
    return result
  } catch (error) {
    const dockerError = error instanceof DockerEngineError ? error : undefined
    logger.warn(
      {
        ...trace,
        workerName,
        stage,
        outcome: "error",
        durationMs: Math.round(performance.now() - startedAt),
        errorType: dockerError?.kind ?? (error instanceof Error ? error.name : "unknown"),
        dockerStatusCode: dockerError?.statusCode,
      },
      "worker lifecycle stage",
    )
    throw error
  }
}
