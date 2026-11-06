// Executed only inside the disposable benchmark controller image.
import { readFile } from "node:fs/promises";
import pino from "/app/node_modules/pino/pino.js";
import { parseRunnerConfig } from "/app/dist/config.js";
import { WorkerManager } from "/app/dist/controller/worker-manager.js";
import { DockerWorkerProvider } from "/app/dist/controller/docker-worker-provider.js";
import { FetchWorkerTransport } from "/app/dist/controller/worker-http-client.js";
import { DockerEngineClient } from "/app/dist/docker/engine-client.js";
import { buildControllerServer } from "/app/dist/controller/server.js";

const config = parseRunnerConfig(
  JSON.parse(await readFile(process.argv[2], "utf8")),
);
const logger = pino({ level: "silent" });
const manager = new WorkerManager(
  config,
  new DockerWorkerProvider(
    config,
    new DockerEngineClient("/var/run/docker.sock", "1.45"),
    logger,
  ),
  new FetchWorkerTransport(),
  logger,
  // The test has no platform control plane. Real worker filesystem, process
  // isolation, HTTP readiness and native inference are exercised by requests.
  { probeWorkerRuntime: async () => undefined },
);
await manager.initialize();
const server = buildControllerServer(config, manager);
await server.listen({ host: "0.0.0.0", port: 4010 });
process.once("SIGTERM", () => {
  void server.close().finally(() => process.exit());
});
