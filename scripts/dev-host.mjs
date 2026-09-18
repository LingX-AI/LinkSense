import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import {
  assertApiPortAvailable,
  assertRunnerPortAvailable,
  assertWebPortAvailable,
  buildDevelopmentEnvironment,
  createApplicationShutdown,
  resolvePortableUserDataRoot,
  waitForDevelopmentApplicationReadiness,
} from "./dev.mjs";
import {
  createDevelopmentProcessRegistry,
  removeDevelopmentProcessRegistry,
  stopDevelopmentApplications,
  writeDevelopmentProcessRegistry,
} from "./dev-processes.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const composeOnlyHosts = new Set([
  "api",
  "host.docker.internal",
  "minio",
  "postgres",
  "redis",
  "runner",
]);

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required for pnpm dev:host`);
  return value;
}

function loopbackOrigin(host, port) {
  const normalizedHost = host === "::1" ? "[::1]" : host;
  return `http://${normalizedHost}:${port}`;
}

export function buildHostDevelopmentEnvironment(
  source,
  rootDirectory = repositoryRoot,
) {
  const development = buildDevelopmentEnvironment(source, { https: false });
  const runnerOrigin = loopbackOrigin(
    development.LINKSENSE_DEV_RUNNER_BIND_ADDRESS,
    development.LINKSENSE_DEV_RUNNER_PORT,
  );
  const apiOrigin = loopbackOrigin(
    development.LINKSENSE_DEV_API_BIND_ADDRESS,
    development.LINKSENSE_DEV_API_PORT,
  );
  const nodeOptions = [source.NODE_OPTIONS?.trim(), "--conditions=development"]
    .filter(Boolean)
    .join(" ");
  const environment = {
    ...development,
    NODE_ENV: "development",
    NODE_OPTIONS: nodeOptions,
    HOST: development.LINKSENSE_DEV_API_BIND_ADDRESS,
    PORT: development.LINKSENSE_DEV_API_PORT,
    LINKSENSE_TRUST_PROXY: "false",
    LINKSENSE_RUNNER_MODE: "controller",
    LINKSENSE_WORKER_PROVIDER: "local-process",
    LINKSENSE_MANAGED_BROWSER_ENABLED: "false",
    LINKSENSE_RUNNER_HOST: development.LINKSENSE_DEV_RUNNER_BIND_ADDRESS,
    LINKSENSE_RUNNER_PORT: development.LINKSENSE_DEV_RUNNER_PORT,
    LINKSENSE_RUNNER_URL: runnerOrigin,
    LINKSENSE_API_INTERNAL_URL: apiOrigin,
    LINKSENSE_CONTROLLER_INTERNAL_URL: runnerOrigin,
    LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: "true",
    LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: "true",
    LINKSENSE_USER_DATA_ROOT: resolvePortableUserDataRoot(
      source.LINKSENSE_USER_DATA_ROOT,
      source,
      rootDirectory,
    ),
    LINKSENSE_CODEX_HOME_TEMPLATE: resolve(
      rootDirectory,
      "deploy/codex-home-template",
    ),
    LINKSENSE_WORKER_IMAGE_REVISION: "host-development",
    VITE_API_BASE_URL: "",
    LINKSENSE_DEV_API_PROXY_TARGET: apiOrigin,
    LINKSENSE_DEV_DOCS_PROXY_TARGET: "http://127.0.0.1:3001",
  };
  delete environment.LINKSENSE_USER_DATA_VOLUME;
  return environment;
}

export function assertHostDependencyEndpoints(environment) {
  const urlDependencies = [
    ["DATABASE_URL", required(environment, "DATABASE_URL")],
    ["REDIS_URL", required(environment, "REDIS_URL")],
  ];
  if ((environment.LINKSENSE_EDITION?.trim() || "full") === "full") {
    urlDependencies.push(
      [
        "LINKSENSE_KB_ELASTICSEARCH_URL",
        required(environment, "LINKSENSE_KB_ELASTICSEARCH_URL"),
      ],
      ["DOCLING_SERVE_URL", required(environment, "DOCLING_SERVE_URL")],
    );
  }
  for (const [name, value] of urlDependencies) {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${name} must be a valid host-reachable URL`);
    }
    assertHostReachableName(name, url.hostname);
  }
  const objectStorageProvider =
    environment.LINKSENSE_OBJECT_STORAGE_PROVIDER?.trim() ||
    (environment.MINIO_ENDPOINT?.trim() ? "minio" : "local-filesystem");
  if (objectStorageProvider === "local-filesystem") return;
  const minioEndpoint = required(environment, "MINIO_ENDPOINT");
  let minioHost = minioEndpoint;
  if (minioEndpoint.includes(":")) {
    try {
      minioHost = new URL(
        minioEndpoint.includes("://")
          ? minioEndpoint
          : `http://${minioEndpoint}`,
      ).hostname;
    } catch {
      throw new Error("MINIO_ENDPOINT must identify a host-reachable service");
    }
  }
  assertHostReachableName("MINIO_ENDPOINT", minioHost);
}

function assertHostReachableName(name, hostname) {
  if (composeOnlyHosts.has(hostname.toLowerCase())) {
    throw new Error(
      `${name} uses the container-only host ${hostname}; configure localhost or a remote host before running pnpm dev:host`,
    );
  }
}

export function hostDevelopmentCommands(environment) {
  return [
    {
      label: "Runner",
      workspace: "@linksense/runner",
      args: ["--filter", "@linksense/runner", "dev"],
    },
    {
      label: "API",
      workspace: "@linksense/api",
      args: ["--filter", "@linksense/api", "dev"],
    },
    {
      label: "Docs",
      workspace: "@linksense/docs",
      args: ["--filter", "@linksense/docs", "dev"],
    },
    {
      label: "Web",
      workspace: "@linksense/web",
      args: [
        "--filter",
        "@linksense/web",
        "exec",
        "vite",
        "--host",
        environment.LINKSENSE_DEV_WEB_BIND_ADDRESS,
        "--port",
        environment.LINKSENSE_DEV_WEB_PORT,
        "--strictPort",
      ],
    },
  ];
}

export function hostPreparationCommands() {
  return [
    ["db:generate"],
    ["db:migrate:deploy"],
    ["db:seed"],
  ];
}

export function hostReadinessPrerequisiteTargets(environment) {
  return [
    {
      name: "Help Center upstream",
      url: new URL(
        "/help/",
        required(environment, "LINKSENSE_DEV_DOCS_PROXY_TARGET"),
      ).toString(),
      headers: {},
      bodyIncludes: 'lang="zh-CN"',
    },
  ];
}

export function waitForHostDevelopmentApplicationReadiness(
  environment,
  options = {},
) {
  return waitForDevelopmentApplicationReadiness(environment, {
    ...options,
    prerequisiteTargets: hostReadinessPrerequisiteTargets(environment),
  });
}

function loadHostEnvironment(rootDirectory) {
  const configuredPath = process.env.LINKSENSE_ENV_FILE?.trim();
  const environmentFile = resolve(rootDirectory, configuredPath || ".env");
  if (!existsSync(environmentFile)) {
    if (configuredPath) {
      throw new Error(
        `Configured environment file does not exist: ${environmentFile}`,
      );
    }
    copyFileSync(resolve(rootDirectory, ".env.example"), environmentFile);
    console.log("Created .env from .env.example for local development.");
  }
  return {
    ...process.env,
    ...parseEnv(readFileSync(environmentFile, "utf8")),
  };
}

function runPreparation(environment, rootDirectory) {
  for (const args of hostPreparationCommands()) {
    const result = spawnSync("pnpm", args, {
      cwd: rootDirectory,
      env: environment,
      stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `pnpm ${args.join(" ")} exited with ${result.status ?? "no status"}`,
      );
    }
  }
}

function startHostSession(environment, rootDirectory) {
  const detached = process.platform !== "win32";
  const sessionId = randomUUID();
  const registry = createDevelopmentProcessRegistry(rootDirectory, sessionId);
  const children = [];
  let shuttingDown = false;
  let settleCompletion;
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    let settled = false;
    settleCompletion = (error) => {
      if (settled) return;
      settled = true;
      if (error) rejectCompletion(error);
      else resolveCompletion();
    };
  });
  void completion.catch(() => undefined);
  const shutdownChildren = createApplicationShutdown(children, { detached });
  const shutdown = (signal = "SIGTERM") => {
    if (shuttingDown) return;
    shuttingDown = true;
    shutdownChildren(signal);
  };

  for (const command of hostDevelopmentCommands(environment)) {
    const child = spawn("pnpm", command.args, {
      cwd: rootDirectory,
      env: environment,
      stdio: "inherit",
      detached,
    });
    children.push({ ...command, child });
    if (child.pid) {
      registry.processes.push({
        label: command.label,
        workspace: command.workspace,
        processGroupId: child.pid,
      });
      writeDevelopmentProcessRegistry(rootDirectory, registry);
    }
    child.once("error", (error) => settleCompletion(error));
    child.once("exit", (code, signal) => {
      if (shuttingDown || signal === "SIGINT" || signal === "SIGTERM") {
        settleCompletion();
        return;
      }
      settleCompletion(
        new Error(
          `${command.label} exited with ${signal ?? code ?? "an unknown status"}`,
        ),
      );
    });
  }

  return {
    completion,
    sessionId,
    shutdown,
  };
}

export async function main(argumentsList = process.argv.slice(2)) {
  if (argumentsList.includes("--cleanup")) {
    const result = await stopDevelopmentApplications(repositoryRoot);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    console.log(
      result.stoppedServices.length > 0
        ? `Cleaned up local LinkSense service processes: ${result.stoppedServices.join(", ")}.`
        : "No residual local LinkSense service processes were found.",
    );
    return;
  }

  const source = loadHostEnvironment(repositoryRoot);
  const environment = buildHostDevelopmentEnvironment(source, repositoryRoot);
  assertHostDependencyEndpoints(environment);
  mkdirSync(environment.LINKSENSE_USER_DATA_ROOT, {
    recursive: true,
    mode: 0o700,
  });
  await stopDevelopmentApplications(repositoryRoot);
  await Promise.all([
    assertRunnerPortAvailable(environment),
    assertApiPortAvailable(environment),
    assertWebPortAvailable(environment),
  ]);
  runPreparation(environment, repositoryRoot);

  const session = startHostSession(environment, repositoryRoot);
  const stopFromSignal = (signal) => session.shutdown(signal);
  process.once("SIGINT", stopFromSignal);
  process.once("SIGTERM", stopFromSignal);
  try {
    await Promise.race([
      waitForHostDevelopmentApplicationReadiness(environment),
      session.completion.then(() => {
        throw new Error("A host development service stopped during startup");
      }),
    ]);
    console.log(
      `Host-mode LinkSense is ready on :${environment.LINKSENSE_DEV_WEB_PORT}; local-process workers are development-only and provide no isolation.`,
    );
    await session.completion;
  } finally {
    session.shutdown();
    removeDevelopmentProcessRegistry(repositoryRoot, session.sessionId);
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invokedPath === import.meta.url) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
