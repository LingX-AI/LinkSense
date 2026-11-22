import { countUserProcesses } from "./user-process-activity.js"
import { existsSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { flushCompileCache } from "node:module"

import type { Logger } from "pino"
import { createLogger } from "./lib/logger.js"

import { linksenseRuntimeIdentity } from "@linksense/shared"

import { prepareManagedBrowserPolicy } from "./browser/policy.js"
import { cleanupManagedBrowserSession } from "./browser/session-cleanup.js"
import { loadCodexTemplateFeatureOverrides } from "./codex/template-features.js"
import { assertCodexRuntimeVersion } from "./codex/runtime-version.js"
import { parseRunnerConfig, type RunnerConfig } from "./config.js"
import { desktopWorkerListenerFd } from "./controller/desktop-worker-provider.js"
import { FetchWorkerTransport } from "./controller/worker-http-client.js"
import { WorkerManager } from "./controller/worker-manager.js"
import { createWorkerProvider } from "./controller/worker-provider-registry.js"
import { RunnerHeartbeatReporter } from "./heartbeat.js"
import {
  createUserRuntimeEnsurer,
  MANAGED_BASH_ENVIRONMENT_FILE,
  prepareManagedPackageSourceConfig,
  userRuntimePaths,
} from "./user-runtime.js"
import {
  verifyManagedProjectionAccess,
  verifySharedWorkspaceAccess,
} from "./workspace/shared-access-probe.js"

const workerControlRoot = "/run/linksense-control"
const managedRuntimeToolBin = "/opt/linksense/bin"
const containerTaskProcessIdentity = {
  uid: linksenseRuntimeIdentity.taskUid,
  gid: linksenseRuntimeIdentity.sharedGid,
} as const

export function resolveOwnerExecutionPaths(
  config: Pick<
    RunnerConfig,
    "LINKSENSE_RUNNER_MODE" | "LINKSENSE_USER_DATA_ROOT"
  > &
    Partial<Pick<RunnerConfig, "LINKSENSE_WORKER_CONTROL_ROOT">>,
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
        ? config.LINKSENSE_WORKER_CONTROL_ROOT ?? workerControlRoot
        : path.join(config.LINKSENSE_USER_DATA_ROOT, ownerId, "control"),
    runtime: path.join(home, ".local", "share", "linksense"),
  }
}

export function resolveNativeImageTemporaryRoots(
  config: Pick<RunnerConfig,
    "LINKSENSE_RUNNER_MODE" | "LINKSENSE_WORKER_PROVIDER" | "LINKSENSE_USER_DATA_ROOT"
  >,
  ownerId: string,
): readonly string[] {
  const { runtime } = resolveOwnerExecutionPaths(config, ownerId)
  return [
    userRuntimePaths(runtime).temporaryRoot,
    // Docker gives each worker its own temporary filesystem. Host temporary
    // directories remain outside the local-process and standalone boundary.
    ...(config.LINKSENSE_RUNNER_MODE === "worker" && config.LINKSENSE_WORKER_PROVIDER === "docker"
      ? [tmpdir()]
      : []),
  ]
}

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseRunnerConfig(env)
  if (config.LINKSENSE_WORKER_PROVIDER === "desktop" && !process.connected) {
    throw new Error("desktop worker requires its supervising process")
  }
  if (config.LINKSENSE_RUNNER_MODE === "controller") {
    await startController(config)
    flushCompileCache()
    return
  }
  await assertCodexRuntimeVersion({
    command: config.CODEX_BIN,
    ...(config.LINKSENSE_RUNNER_MODE === "worker" &&
    config.LINKSENSE_WORKER_PROVIDER === "docker"
      ? { processIdentity: containerTaskProcessIdentity }
      : {}),
  })
  await startExecutionRunner(config)
  flushCompileCache()
}

async function startController(config: RunnerConfig): Promise<void> {
  const logger = createLogger("controller")
  const provider = createWorkerProvider(config, logger)
  const workers = new WorkerManager(
    config,
    provider,
    new FetchWorkerTransport(),
    logger,
  )
  // The controller's HTTP schemas load the execution module graph. Load it
  // while the production worker performs its real startup/handshake probe.
  const [{ buildControllerServer }] = await Promise.all([
    import("./controller/server.js"),
    workers.initialize(),
  ])
  workers.startIdleReaper()
  const server = buildControllerServer(config, workers)
  installSignalHandlers(logger, async () => {
    await server.close()
    await workers.shutdown(config.LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN)
  })
  await server.listen({
    host: config.LINKSENSE_RUNNER_HOST,
    port: config.LINKSENSE_RUNNER_PORT,
  })
}

async function startExecutionRunner(config: RunnerConfig): Promise<void> {
  const [
    { HttpRunnerEventSink },
    { ConversationOwnerRegistry },
    { ModelGateway },
    { AppServerProcessPool },
    { buildRunnerServer },
    { CapabilityRuntimeManager },
    { WorkspaceManager },
  ] = await Promise.all([
    import("./event-sink.js"),
    import("./owner-binding.js"),
    import("./model-gateway/model-gateway.js"),
    import("./process-pool.js"),
    import("./server.js"),
    import("./workspace/capability-runtime.js"),
    import("./workspace/workspace-manager.js"),
  ])
  const logger = createLogger("execution")
  const workerOwnerId = config.LINKSENSE_WORKER_OWNER_ID
  const isWorker = config.LINKSENSE_RUNNER_MODE === "worker"
  const isDesktopWorker = isWorker && config.LINKSENSE_WORKER_PROVIDER === "desktop"
  const isHostWorker =
    isWorker && config.LINKSENSE_WORKER_PROVIDER !== "docker"
  const managedBrowserEnabled =
    config.LINKSENSE_MANAGED_BROWSER_ENABLED && !isHostWorker
  const currentProcessIdentity = {
    uid: process.getuid?.() ?? linksenseRuntimeIdentity.taskUid,
    gid: process.getgid?.() ?? linksenseRuntimeIdentity.sharedGid,
  }
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
  if (isWorker && !isHostWorker) {
    if (!workerOwnerId) throw new Error("worker owner id is required")
    await prepareManagedPackageSourceConfig(
      config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
      config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
    )
    if (managedBrowserEnabled) {
      await prepareManagedBrowserPolicy({
        sessionRoot: userRuntimePaths(runtimeRootForOwner(workerOwnerId))
          .browserSessionRoot,
        sessionLimit: config.LINKSENSE_BROWSER_SESSION_LIMIT,
      })
    }
  }
  const initializeRuntime = createUserRuntimeEnsurer(runtimeRootForOwner, {
    ...((isWorker && !isHostWorker) ||
    (!isDesktopWorker && existsSync(config.LINKSENSE_PYTHON_BASE_SITE_PACKAGES))
      ? {
          basePythonSitePackages:
            config.LINKSENSE_PYTHON_BASE_SITE_PACKAGES,
        }
      : {}),
    ...((isWorker && !isHostWorker) ||
    (!isDesktopWorker && existsSync(config.LINKSENSE_NODE_BASE_PROJECT))
      ? { baseNodeProject: config.LINKSENSE_NODE_BASE_PROJECT }
      : {}),
    ...((isWorker && !isHostWorker) ||
    (!isDesktopWorker && existsSync(config.LINKSENSE_NODE_REGISTER_HOOK))
      ? { nodeRegisterHook: config.LINKSENSE_NODE_REGISTER_HOOK }
      : {}),
    pnpmVersion: config.LINKSENSE_PNPM_VERSION,
    ...(isDesktopWorker ? { skipPythonBootstrap: true } : {}),
    pythonPackageIndexUrl: config.LINKSENSE_PYTHON_PACKAGE_INDEX_URL,
    nodePackageRegistryUrl: config.LINKSENSE_NODE_PACKAGE_REGISTRY_URL,
    ...(isWorker
      ? isHostWorker
        ? {
            runtimeToolBin: requiredLocalProcessRuntimeToolBin(process.env),
            requiredRuntimeTools: ["linksense-plugin-stdio", "linksense-connection-mcp"]
              .map(name => process.platform === "win32" ? `${name}.cmd` : name),
          }
        : {
            bashEnvironmentFile: MANAGED_BASH_ENVIRONMENT_FILE,
            processIdentity: containerTaskProcessIdentity,
            resetBrowserSessions: managedBrowserEnabled,
            runtimeToolBin: managedRuntimeToolBin,
            requiredRuntimeTools: managedBrowserEnabled
              ? ["linksense-browser", "linksense-uv", "linksense-pnpm"]
              : ["linksense-uv", "linksense-pnpm"],
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
            fixedControlRoot:
              config.LINKSENSE_WORKER_CONTROL_ROOT ?? workerControlRoot,
            ...(isHostWorker
              ? {}
              : {
                  directoryCleanupIdentity: containerTaskProcessIdentity,
                  managedCodexFileIdentity: containerTaskProcessIdentity,
                }),
          }
        : {}),
      userNodeModulesForOwner: (ownerId) =>
        userRuntimePaths(runtimeRootForOwner(ownerId)).nodeModules,
    },
  )
  if (isWorker && !isHostWorker) {
    await Promise.all([
      verifySharedWorkspaceAccess(
        path.join(config.LINKSENSE_USER_DATA_ROOT, "projects"),
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
      ...(config.LINKSENSE_SERVICE_SESSION_ID ? { serviceSessionId: config.LINKSENSE_SERVICE_SESSION_ID } : {}),
      ...(isDesktopWorker && config.LINKSENSE_DESKTOP_TURN_ID && config.LINKSENSE_DESKTOP_RUNTIME_GENERATION
        ? { desktopOutboxScope: { turnId: config.LINKSENSE_DESKTOP_TURN_ID, generation: config.LINKSENSE_DESKTOP_RUNTIME_GENERATION } }
        : {}),
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
    ...(isDesktopWorker && config.LINKSENSE_DESKTOP_PROXY_ORIGIN
      ? {
          desktopProxyOrigin: config.LINKSENSE_DESKTOP_PROXY_ORIGIN,
          desktopPaths: {
            home: config.LINKSENSE_USER_DATA_ROOT,
            ...(config.LINKSENSE_DESKTOP_DATA_ROOT && { dataRoot: config.LINKSENSE_DESKTOP_DATA_ROOT }),
            runtimeRoot: path.dirname(path.dirname(config.CODEX_BIN)),
          },
        }
      : {}),
    onMemoryUsage: async (capture) => {
      if (!eventSink.recordMemoryUsage) {
        throw new Error("memory usage sink is unavailable")
      }
      await eventSink.recordMemoryUsage(capture)
    },
    onPrivacyMasking: async (capture) => {
      await eventSink.recordPrivacyMasking?.(capture)
    },
  })
  await modelGateway.start()
  const pool = new AppServerProcessPool({
    desktopWorkspace: isDesktopWorker,
    desktopBrowserEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_BROWSER_ENABLED,
    desktopComputerEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_COMPUTER_ENABLED,
    desktopComputerWaitEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_COMPUTER_ENABLED &&
      config.LINKSENSE_DESKTOP_COMPUTER_WAIT_ENABLED,
    desktopNativeApprovalsEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_NATIVE_APPROVALS_ENABLED,
    desktopArtifactsEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_ARTIFACTS_ENABLED,
    desktopArtifactsWebsiteEnabled: isDesktopWorker && config.LINKSENSE_DESKTOP_ARTIFACTS_ENABLED &&
      config.LINKSENSE_DESKTOP_ARTIFACTS_WEBSITE_ENABLED,
    command: config.CODEX_BIN,
    processLimit: config.LINKSENSE_RUNNER_APP_SERVER_PROCESS_LIMIT,
    idleTtlMs: config.LINKSENSE_CODEX_APP_SERVER_IDLE_TTL_SECONDS * 1000,
    templateVersion: config.LINKSENSE_AGENTS_TEMPLATE_VERSION,
    globalFeatureOverrides,
    workspaceManager,
    modelGateway,
    capabilityRuntimeManager: new CapabilityRuntimeManager(
      isHostWorker
        ? {
            apiIdentity: currentProcessIdentity,
            taskIdentity: currentProcessIdentity,
            managedBrowserEnabled,
          }
        : { managedBrowserEnabled },
    ),
    eventSink,
    logger,
    mcpCommand: process.execPath,
    mcpArgs: [...process.execArgv, mcpScript],
    ...(isDesktopWorker && config.LINKSENSE_DESKTOP_CONNECTIONS_ENABLED ? {
      desktopConnectionMcpArgs: [
        ...process.execArgv,
        fileURLToPath(new URL("./mcp/connection-service-server.js", import.meta.url)),
      ],
    } : {}),
    ...(managedBrowserEnabled
      ? {
          managedBrowserMcpArgs: [
            ...process.execArgv,
            managedBrowserMcpScript,
          ],
        }
      : {}),
    personalStdioLauncherCommand: process.execPath,
    personalStdioLauncherArgs: [...process.execArgv, personalStdioLauncher],
    mcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-file-service`,
    imageGenerationMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-image-generation`,
    knowledgeMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-knowledge-service`,
    skillCreatorMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-skill-creator`,
    skillManagementMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-skills`,
    interactiveFormMcpEndpointBase: `http://127.0.0.1:${config.LINKSENSE_RUNNER_PORT}/mcp-interactive-form`,
    knowledgeSearchTimeoutMs:
      config.LINKSENSE_KNOWLEDGE_SEARCH_TIMEOUT_MS,
    runtimeEnvironmentForOwner: async (ownerId) =>
      (await ensureUserRuntime(ownerId)).environment,
    nativeImageTemporaryRootsForOwner: (ownerId) =>
      resolveNativeImageTemporaryRoots(config, ownerId),
    ...(managedBrowserEnabled && existsSync(browserCommand)
      ? {
          browserSessionCleanup: async ({
            conversationId,
            userHome,
            codexHome,
            workspace,
            preserveHumanControl,
          }) =>
            cleanupManagedBrowserSession({
              command: browserCommand,
              conversationId,
              userHome,
              codexHome,
              workspace,
              ...(preserveHumanControl ? { preserveHumanControl } : {}),
              ...(isWorker && !isHostWorker
                ? { processIdentity: containerTaskProcessIdentity }
                : {}),
            }),
        }
      : {}),
    ...(isWorker && !isHostWorker
      ? {
          codexProcessIdentity: containerTaskProcessIdentity,
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
  const heartbeat = new RunnerHeartbeatReporter(
    () => workerOwnerId ? [workerOwnerId] : pool.ownerIds,
    (ownerId, input) => eventSink.reportHeartbeat(ownerId, input),
    (ownerId) => logger.warn({ ownerId }, "Runner heartbeat delivery failed"),
  )
  const server = buildRunnerServer(
    config,
    pool,
    workspaceManager,
    ownerRegistry,
    async (ownerId) => {
      await ensureUserRuntime(ownerId)
    },
    async () => process.platform === "linux" && config.LINKSENSE_RUNNER_MODE === "worker" && config.LINKSENSE_WORKER_PROVIDER === "docker"
      ? countUserProcesses(containerTaskProcessIdentity.uid)
      : 0,
    eventSink,
  )
  installSignalHandlers(logger, async () => {
    // Trigger native cancellation immediately, including blocked HTTP starts.
    // Waiting for server.close first can deadlock on those same requests.
    const closingPool = pool.closeAll();
    const closed = Promise.all([server.close(), closingPool]);
    // Attach a rejection handler before waiting for heartbeat shutdown.
    const closing = Promise.all([heartbeat.close(), closed]);
    await closing
    await modelGateway.close()
    await eventSink.close()
  })
  if (isDesktopWorker && !process.connected) {
    await Promise.allSettled([server.close(), pool.closeAll(), modelGateway.close(), eventSink.close()])
    return
  }
  try {
    const listenOptions = {
      host: config.LINKSENSE_RUNNER_HOST,
      port: config.LINKSENSE_RUNNER_PORT,
      ...(isDesktopWorker && config.LINKSENSE_DESKTOP_TURN_ID ? { fd: desktopWorkerListenerFd } : {}),
    }
    await server.listen(listenOptions)
    heartbeat.start()
  } catch (error) {
    await Promise.allSettled([
      pool.closeAll(),
      modelGateway.close(),
      eventSink.close(),
    ])
    throw error
  }
}

function requiredLocalProcessRuntimeToolBin(
  environment: NodeJS.ProcessEnv,
): string {
  const value = environment.LINKSENSE_RUNTIME_TOOL_BIN?.trim()
  if (!value) {
    throw new Error("local-process runtime tool directory is required")
  }
  return value
}

function installSignalHandlers(
  logger: Logger,
  stop: () => Promise<void>,
): void {
  let stopping = false
  const stopFromSignal = () => {
    if (stopping) return
    stopping = true
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
  if (process.channel) process.once("disconnect", stopFromSignal)
}

export function isMainModule(
  moduleUrl: string,
  executablePath: string | undefined,
): boolean {
  if (!executablePath) return false
  const entry = fileURLToPath(moduleUrl)
  if (entry === path.resolve(executablePath)) return true
  try {
    return entry === realpathSync(executablePath)
  } catch {
    return false
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  await main()
}
