import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import pino from "pino"

import { linksenseRuntimeIdentity } from "@linksense/shared"

import { prepareManagedBrowserPolicy } from "./browser/policy.js"
import { cleanupManagedBrowserSession } from "./browser/session-cleanup.js"
import { loadCodexTemplateFeatureOverrides } from "./codex/template-features.js"
import { parseRunnerConfig, type RunnerConfig } from "./config.js"
import { buildControllerServer } from "./controller/server.js"
import { FetchWorkerTransport } from "./controller/worker-http-client.js"
import { WorkerManager } from "./controller/worker-manager.js"
import { DockerEngineClient } from "./docker/engine-client.js"
import { HttpRunnerEventSink } from "./event-sink.js"
import { ConversationOwnerRegistry } from "./owner-binding.js"
import { ModelGateway } from "./model-gateway/model-gateway.js"
import { AppServerProcessPool } from "./process-pool.js"
import { buildRunnerServer } from "./server.js"
import {
  createUserRuntimeEnsurer,
  MANAGED_BASH_ENVIRONMENT_FILE,
  prepareManagedPackageSourceConfig,
  userRuntimePaths,
} from "./user-runtime.js"
import { CapabilityRuntimeManager } from "./workspace/capability-runtime.js"
import {
  verifyManagedProjectionAccess,
  verifySharedWorkspaceAccess,
} from "./workspace/shared-access-probe.js"
import { WorkspaceManager } from "./workspace/workspace-manager.js"

const workerControlRoot = "/run/linksense-control"
const managedRuntimeToolBin = "/opt/linksense/bin"
const taskProcessIdentity = {
  uid: linksenseRuntimeIdentity.taskUid,
  gid: linksenseRuntimeIdentity.sharedGid,
} as const

export function resolveOwnerExecutionPaths(
  config: Pick<
    RunnerConfig,
    "LINKSENSE_RUNNER_MODE" | "LINKSENSE_USER_DATA_ROOT"
  >,
  ownerId: string,
): {
  home: string
  control: string
  runtime: string
} {
  const home =
    config.LINKSENSE_RUNNER_MODE === "worker"
      ? config.LINKSENSE_USER_DATA_ROOT
      : path.join(config.LINKSENSE_USER_DATA_ROOT, ownerId, "home")
  return {
    home,
    control:
      config.LINKSENSE_RUNNER_MODE === "worker"
        ? workerControlRoot
        : path.join(config.LINKSENSE_USER_DATA_ROOT, ownerId, "control"),
    runtime: path.join(home, ".local", "share", "linksense"),
  }
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseRunnerConfig(env)
  if (config.LINKSENSE_RUNNER_MODE === "controller") {
    await startController(config)
    return
  }
  await startExecutionRunner(config)
}

async function startController(config: RunnerConfig): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" })
  const docker = new DockerEngineClient(
    config.LINKSENSE_DOCKER_SOCKET_PATH,
    config.LINKSENSE_DOCKER_API_VERSION,
  )
  const workers = new WorkerManager(
    config,
    docker,
    new FetchWorkerTransport(),
    logger,
  )
  await workers.initialize()
  workers.startIdleReaper()
  const server = buildControllerServer(config, workers)
  installSignalHandlers(logger, async () => {
    workers.stopIdleReaper()
    await server.close()
    if (config.LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN) {
      await workers.stopAllWorkers()
    }
  })
  await server.listen({
    host: config.LINKSENSE_RUNNER_HOST,
    port: config.LINKSENSE_RUNNER_PORT,
  })
}

async function startExecutionRunner(config: RunnerConfig): Promise<void> {
  const logger = pino({ level: process.env.LOG_LEVEL ?? "info" })
  const workerOwnerId = config.LINKSENSE_WORKER_OWNER_ID
  const isWorker = config.LINKSENSE_RUNNER_MODE === "worker"
  if (isWorker && !config.LINKSENSE_CODEX_HOME_TEMPLATE) {
    throw new Error("worker Codex home template is required")
  }
  const globalFeatureOverrides =
    await loadCodexTemplateFeatureOverrides(
      config.LINKSENSE_CODEX_HOME_TEMPLATE,
    )
  if (isWorker) process.umask(0o007)
  const runtimeRootForOwner = (ownerId: string) =>
    resolveOwnerExecutionPaths(config, ownerId).runtime
  if (isWorker) {
    if (!workerOwnerId) throw new Error("worker owner id is required")
    await prepareManagedPackageSourceConfig(
      config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
      config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
    )
    await prepareManagedBrowserPolicy({
      sessionRoot: userRuntimePaths(runtimeRootForOwner(workerOwnerId))
        .browserSessionRoot,
      sessionLimit: config.LINKSENSE_BROWSER_SESSION_LIMIT,
    })
  }
  const initializeRuntime = createUserRuntimeEnsurer(runtimeRootForOwner, {
    ...(isWorker ||
    existsSync(config.LINKSENSE_PYTHON_BASE_SITE_PACKAGES)
      ? {
          basePythonSitePackages:
            config.LINKSENSE_PYTHON_BASE_SITE_PACKAGES,
        }
      : {}),
    ...(isWorker ||
    existsSync(config.LINKSENSE_NODE_BASE_PROJECT)
      ? { baseNodeProject: config.LINKSENSE_NODE_BASE_PROJECT }
      : {}),
    ...(isWorker ||
    existsSync(config.LINKSENSE_NODE_REGISTER_HOOK)
      ? { nodeRegisterHook: config.LINKSENSE_NODE_REGISTER_HOOK }
      : {}),
    pnpmVersion: config.LINKSENSE_PNPM_VERSION,
    pythonPackageIndexUrl: config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
    nodePackageRegistryUrl: config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
    ...(isWorker
      ? {
          bashEnvironmentFile: MANAGED_BASH_ENVIRONMENT_FILE,
          processIdentity: taskProcessIdentity,
          resetBrowserSessions: true,
          runtimeToolBin: managedRuntimeToolBin,
        }
      : {}),
  })
  const ensureUserRuntime = async (ownerId: string) => {
    if (workerOwnerId && ownerId !== workerOwnerId) {
      throw new Error("worker owner mismatch")
    }
    return initializeRuntime(ownerId)
  }
  if (isWorker && workerOwnerId) {
    // Finish permission validation and persistent runtime initialization before
    // the worker starts accepting health checks or turn traffic.
    await ensureUserRuntime(workerOwnerId)
  }
  const workspaceManager = new WorkspaceManager(
    config.LINKSENSE_USER_DATA_ROOT,
    config.LINKSENSE_CODEX_HOME_TEMPLATE,
    {
      ...(isWorker && workerOwnerId
        ? {
            fixedOwnerId: workerOwnerId,
            fixedHomeRoot: config.LINKSENSE_USER_DATA_ROOT,
            fixedControlRoot: workerControlRoot,
            directoryCleanupIdentity: taskProcessIdentity,
            managedCodexFileIdentity: taskProcessIdentity,
          }
        : {}),
      userNodeModulesForOwner: (ownerId) =>
        userRuntimePaths(runtimeRootForOwner(ownerId)).nodeModules,
    },
  )
  if (isWorker) {
    await Promise.all([
      verifySharedWorkspaceAccess(
        path.join(config.LINKSENSE_USER_DATA_ROOT, "workspaces"),
      ),
      verifyManagedProjectionAccess(
        path.join(config.LINKSENSE_USER_DATA_ROOT, ".agents"),
      ),
    ])
  }
  const eventSink = new HttpRunnerEventSink(
    config.LINKSENSE_API_INTERNAL_URL,
    config.LINKSENSE_RUNNER_SHARED_SECRET,
    workspaceManager,
    {
      logger,
      knowledgeSearchTimeoutMs:
        config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    },
  )
  const builtMcpScript = fileURLToPath(
    new URL("./mcp/core-service-server.js", import.meta.url),
  )
  const mcpScript = existsSync(builtMcpScript)
    ? builtMcpScript
    : fileURLToPath(new URL("./mcp/core-service-server.ts", import.meta.url))
  const builtManagedBrowserMcpScript = fileURLToPath(
    new URL("./mcp/managed-browser-service-server.js", import.meta.url),
  )
  const managedBrowserMcpScript = existsSync(builtManagedBrowserMcpScript)
    ? builtManagedBrowserMcpScript
    : fileURLToPath(
        new URL("./mcp/managed-browser-service-server.ts", import.meta.url),
      )
  const builtPersonalStdioLauncher = fileURLToPath(
    new URL("./mcp/personal-stdio-launcher.js", import.meta.url),
  )
  const personalStdioLauncher = existsSync(builtPersonalStdioLauncher)
    ? builtPersonalStdioLauncher
    : fileURLToPath(
        new URL("./mcp/personal-stdio-launcher.ts", import.meta.url),
      )
  const browserCommand = path.join(
    managedRuntimeToolBin,
    "linksense-browser",
  )
  const modelGateway = new ModelGateway({
    logger,
    onMemoryUsage: async (capture) => {
      if (!eventSink.recordMemoryUsage) {
        throw new Error("memory usage sink is unavailable")
      }
      await eventSink.recordMemoryUsage(capture)
    },
  })
  await modelGateway.start()
  const pool = new AppServerProcessPool({
    command: config.CODEX_BIN,
    processLimit: config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
    idleTtlMs: config.LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS * 1000,
    templateVersion: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
    globalFeatureOverrides,
    workspaceManager,
    modelGateway,
    capabilityRuntimeManager: new CapabilityRuntimeManager(),
    eventSink,
    logger,
    mcpCommand: process.execPath,
    mcpArgs: [...process.execArgv, mcpScript],
    managedBrowserMcpArgs: [...process.execArgv, managedBrowserMcpScript],
    personalStdioLauncherCommand: process.execPath,
    personalStdioLauncherArgs: [...process.execArgv, personalStdioLauncher],
    mcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-file-service`,
    imageGenerationMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-image-generation`,
    knowledgeMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-knowledge-service`,
    skillCreatorMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-skill-creator`,
    interactiveFormMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-interactive-form`,
    knowledgeSearchTimeoutMs:
      config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    runtimeEnvironmentForOwner: async (ownerId) =>
      (await ensureUserRuntime(ownerId)).environment,
    ...(existsSync(browserCommand)
      ? {
          browserSessionCleanup: async ({
            userHome,
            codexHome,
            workspace,
          }) =>
            cleanupManagedBrowserSession({
              command: browserCommand,
              userHome,
              codexHome,
              workspace,
              ...(isWorker
                ? { processIdentity: taskProcessIdentity }
                : {}),
            }),
        }
      : {}),
    ...(isWorker
      ? {
          codexProcessIdentity: taskProcessIdentity,
        }
      : {}),
  })
  try {
    await eventSink.restore()
  } catch (error) {
    await Promise.allSettled([
      pool.closeAll(),
      modelGateway.close(),
      eventSink.close(),
    ])
    throw error
  }
  const ownerRegistry = new ConversationOwnerRegistry(workerOwnerId)
  const server = buildRunnerServer(
    config,
    pool,
    workspaceManager,
    ownerRegistry,
    async (ownerId) => {
      await ensureUserRuntime(ownerId)
    },
  )
  installSignalHandlers(logger, async () => {
    await server.close()
    await pool.closeAll()
    await modelGateway.close()
    await eventSink.close()
  })
  try {
    await server.listen({
      host: config.LINKSENSE_RUNNER_HOST,
      port: config.LINKSENSE_RUNNER_PORT,
    })
  } catch (error) {
    await Promise.allSettled([
      pool.closeAll(),
      modelGateway.close(),
      eventSink.close(),
    ])
    throw error
  }
}

function installSignalHandlers(
  logger: pino.Logger,
  stop: () => Promise<void>,
): void {
  const stopFromSignal = () => {
    void stop().then(
      () => process.exit(0),
      (error: unknown) => {
        logger.error(
          { errorClass: error instanceof Error ? error.name : "unknown" },
          "runner shutdown failed",
        )
        process.exit(1)
      },
    )
  }
  process.once("SIGTERM", stopFromSignal)
  process.once("SIGINT", stopFromSignal)
}

export function isMainModule(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  if (!executablePath) return false
  return fileURLToPath(moduleUrl) === path.resolve(executablePath)
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main()
}
