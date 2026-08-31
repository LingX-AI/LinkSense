import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import {
  stopDevelopmentApplications,
} from "./dev-processes.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const developmentComposeFile = "docker-compose.dev.yml";
const developmentImageLabel = "com.linksense.development.fingerprint";
const migrationImageLabel = "com.linksense.migration.fingerprint";
const workerImageLabel = "com.linksense.worker.fingerprint";

function required(source, name) {
  const value = source[name]?.trim();
  if (!value) throw new Error(`${name} is required in .env`);
  return value;
}

function optional(source, name, fallback) {
  return source[name]?.trim() || fallback;
}

export function resolvePortableUserDataRoot(
  configuredValue,
  environment = process.env,
  deploymentRoot = repositoryRoot,
) {
  const portableDefault = "${PWD}/.data/users";
  const configured = configuredValue?.trim() || portableDefault;
  const root = resolve(deploymentRoot);
  const home = environment.HOME?.trim() || environment.USERPROFILE?.trim();
  const needsHome = /\$\{HOME\}|\$HOME(?=[/\\]|$)|^~(?=[/\\]|$)/u.test(
    configured,
  );

  if (needsHome && !home) {
    throw new Error(
      "LINKSENSE_USER_DATA_ROOT uses HOME, but HOME or USERPROFILE is not available",
    );
  }

  const expanded = configured
    .replace(/\$\{PWD\}|\$PWD(?=[/\\]|$)/gu, root)
    .replace(/\$\{HOME\}|\$HOME(?=[/\\]|$)/gu, home || "")
    .replace(/^~(?=[/\\]|$)/u, home || "");

  if (/\$(?:\{[^}]+\}|[A-Za-z_][A-Za-z0-9_]*)/u.test(expanded)) {
    throw new Error(
      "LINKSENSE_USER_DATA_ROOT contains an unsupported environment placeholder",
    );
  }
  if (!isAbsolute(expanded)) {
    throw new Error(
      "LINKSENSE_USER_DATA_ROOT must resolve to an absolute directory",
    );
  }
  return resolve(expanded);
}

export function resolveComposeDatabaseUrl(source) {
  const configured = source.DATABASE_URL?.trim();
  if (!configured) return configured;

  let databaseUrl;
  try {
    databaseUrl = new URL(configured);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }
  if (databaseUrl.hostname !== "postgres") return configured;

  databaseUrl.username = required(source, "POSTGRES_USER");
  databaseUrl.password = required(source, "POSTGRES_PASSWORD");
  databaseUrl.pathname = `/${required(source, "POSTGRES_DB")}`;
  return databaseUrl.toString();
}

function developmentOriginPort(name, value, fallback) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL with a local port`);
  }
  if (url.protocol !== "http:") {
    throw new Error(`${name} must use HTTP`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must not contain credentials, query, or fragment`);
  }
  const port = Number(url.port || fallback);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must include a valid TCP port`);
  }
  return String(port);
}

// The standalone runtime smoke remains a dedicated regression test. `pnpm dev`
// no longer uses this host path; it always starts the production worker image.
export function developmentRuntimePaths(rootDirectory) {
  const root = resolve(rootDirectory, ".data/dev/public-runtime");
  const pythonEnvironment = resolve(root, "python");
  const nodeProject = resolve(root, "node");
  return {
    root,
    toolBin: resolve(root, "bin"),
    pythonEnvironment,
    pythonSitePackages: resolve(
      pythonEnvironment,
      "lib/python3.12/site-packages",
    ),
    nodeProject,
    nodeRegisterHook: resolve(nodeProject, "register-hooks.mjs"),
  };
}

export function buildDevelopmentEnvironment(source) {
  const apiOrigin = optional(
    source,
    "LINKSENSE_DEV_API_ORIGIN",
    "http://localhost:4000",
  );
  const webOrigin = optional(
    source,
    "LINKSENSE_DEV_WEB_ORIGIN",
    "http://localhost:5173",
  );
  const existingNoProxy = source.NO_PROXY?.trim();

  return {
    ...source,
    NODE_ENV: "development",
    LINKSENSE_PUBLIC_BASE_URL: webOrigin,
    VITE_API_BASE_URL: apiOrigin,
    LINKSENSE_DEV_API_BIND_ADDRESS: optional(
      source,
      "LINKSENSE_DEV_API_BIND_ADDRESS",
      "127.0.0.1",
    ),
    LINKSENSE_DEV_API_PORT: optional(
      source,
      "LINKSENSE_DEV_API_PORT",
      developmentOriginPort("LINKSENSE_DEV_API_ORIGIN", apiOrigin, "4000"),
    ),
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS: optional(
      source,
      "LINKSENSE_DEV_RUNNER_BIND_ADDRESS",
      "127.0.0.1",
    ),
    LINKSENSE_DEV_RUNNER_PORT: optional(
      source,
      "LINKSENSE_DEV_RUNNER_PORT",
      "4010",
    ),
    LINKSENSE_DEV_WEB_BIND_ADDRESS: optional(
      source,
      "LINKSENSE_DEV_WEB_BIND_ADDRESS",
      "127.0.0.1",
    ),
    LINKSENSE_DEV_WEB_PORT: optional(
      source,
      "LINKSENSE_DEV_WEB_PORT",
      developmentOriginPort("LINKSENSE_DEV_WEB_ORIGIN", webOrigin, "5173"),
    ),
    NO_PROXY: [existingNoProxy, "127.0.0.1", "localhost"]
      .filter(Boolean)
      .join(","),
  };
}

export function buildDevelopmentComposeEnvironment(source, environment) {
  return {
    ...source,
    DATABASE_URL: resolveComposeDatabaseUrl(source),
    NODE_ENV: "development",
    LINKSENSE_PUBLIC_BASE_URL: environment.LINKSENSE_PUBLIC_BASE_URL,
    LINKSENSE_TRUST_PROXY: "false",
    LINKSENSE_DEV_API_BIND_ADDRESS:
      environment.LINKSENSE_DEV_API_BIND_ADDRESS,
    LINKSENSE_DEV_API_PORT: environment.LINKSENSE_DEV_API_PORT,
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS:
      environment.LINKSENSE_DEV_RUNNER_BIND_ADDRESS,
    LINKSENSE_DEV_RUNNER_PORT: environment.LINKSENSE_DEV_RUNNER_PORT,
    LINKSENSE_DEV_WEB_BIND_ADDRESS:
      environment.LINKSENSE_DEV_WEB_BIND_ADDRESS,
    LINKSENSE_DEV_WEB_PORT: environment.LINKSENSE_DEV_WEB_PORT,
    VITE_API_BASE_URL: environment.VITE_API_BASE_URL,
    LINKSENSE_USER_DATA_ROOT: resolvePortableUserDataRoot(
      source.LINKSENSE_USER_DATA_ROOT,
      source,
    ),
  };
}

export function buildProductionParityEnvironment(source) {
  const configuredPublicBaseUrl = required(
    source,
    "LINKSENSE_PUBLIC_BASE_URL",
  );
  let publicBaseUrl;
  try {
    publicBaseUrl = new URL(configuredPublicBaseUrl);
  } catch {
    throw new Error("LINKSENSE_PUBLIC_BASE_URL must be a valid URL");
  }

  if (
    publicBaseUrl.protocol !== "http:" &&
    publicBaseUrl.protocol !== "https:"
  ) {
    throw new Error("LINKSENSE_PUBLIC_BASE_URL must use HTTP or HTTPS");
  }

  return {
    ...source,
    NODE_ENV: "production",
    LINKSENSE_PUBLIC_BASE_URL: publicBaseUrl.toString().replace(/\/$/u, ""),
    LINKSENSE_EXTERNAL_SCHEME: publicBaseUrl.protocol.slice(0, -1),
  };
}

export function developmentComposeArguments(environmentFile, argumentsList) {
  return [
    "compose",
    "--env-file",
    environmentFile,
    "-f",
    "docker-compose.yml",
    "-f",
    developmentComposeFile,
    ...argumentsList,
  ];
}

export function productionComposeArguments(environmentFile, argumentsList) {
  return [
    "compose",
    "--env-file",
    environmentFile,
    "-f",
    "docker-compose.yml",
    ...argumentsList,
  ];
}

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status ?? "no status"}`,
    );
  }
}

function fingerprintEntry(hash, rootDirectory, relativePath) {
  const absolutePath = resolve(rootDirectory, relativePath);
  const information = statSync(absolutePath);
  if (information.isDirectory()) {
    for (const entry of readdirSync(absolutePath).sort()) {
      fingerprintEntry(hash, rootDirectory, `${relativePath}/${entry}`);
    }
    return;
  }
  hash.update(relativePath);
  hash.update("\0");
  hash.update(readFileSync(absolutePath));
  hash.update("\0");
}

export function sourceFingerprint(rootDirectory, relativePaths) {
  const hash = createHash("sha256");
  for (const relativePath of [...relativePaths].sort()) {
    fingerprintEntry(hash, rootDirectory, relativePath);
  }
  return hash.digest("hex");
}

export function developmentDependencyFingerprint(
  rootDirectory = repositoryRoot,
) {
  return sourceFingerprint(rootDirectory, [
    ".dockerignore",
    "Dockerfile.dev",
    "apps/api/package.json",
    "apps/docs/package.json",
    "apps/runner/package.json",
    "apps/web/package.json",
    "deploy/docker/configure-debian-apt.sh",
    "package.json",
    "packages/shared/package.json",
    "patches",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prisma/schema.prisma",
    "prisma.config.ts",
    "tsconfig.base.json",
  ]);
}

export function migrationImageFingerprint(rootDirectory = repositoryRoot) {
  return sourceFingerprint(rootDirectory, [
    ".dockerignore",
    "Dockerfile.api",
    "apps/api/package.json",
    "deploy/docker/configure-debian-apt.sh",
    "package.json",
    "packages/shared/package.json",
    "patches",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "prisma",
    "prisma.config.ts",
    "tsconfig.base.json",
  ]);
}

export function workerImageFingerprint(rootDirectory = repositoryRoot) {
  return sourceFingerprint(rootDirectory, [
    ".dockerignore",
    "Dockerfile.runner",
    "apps/runner/package.json",
    "apps/runner/src",
    "apps/runner/tsconfig.json",
    "deploy/codex-home-template",
    "deploy/docker/configure-debian-apt.sh",
    "deploy/runtime/browser",
    "deploy/runtime/node",
    "deploy/runtime/python",
    "deploy/runtime/shell",
    "package.json",
    "packages/shared/package.json",
    "packages/shared/src",
    "packages/shared/tsconfig.json",
    "patches",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "tsconfig.base.json",
  ]);
}

export function workerImageNeedsRebuild(
  currentFingerprint,
  expectedFingerprint,
  force = false,
) {
  return force || currentFingerprint !== expectedFingerprint;
}

function inspectDockerImage(image, format) {
  const result = spawnSync(
    "docker",
    ["image", "inspect", "--format", format, image],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.error) {
    if (result.error.code === "ENOENT") throw result.error;
    return undefined;
  }
  if (result.status !== 0) return undefined;
  return result.stdout.trim() || undefined;
}

export function developmentImageNames(environment) {
  const tag = optional(environment, "LINKSENSE_DEV_IMAGE_TAG", "local");
  return [
    `linksense-api-dev:${tag}`,
    `linksense-runner-controller-dev:${tag}`,
    `linksense-web-dev:${tag}`,
  ];
}

export function buildWorkerRuntimeEnvironment(environment, revision) {
  if (!revision?.trim()) {
    throw new Error("A built worker image revision is required");
  }
  return {
    ...environment,
    LINKSENSE_WORKER_IMAGE_REVISION: revision.trim(),
  };
}

function dockerImageLabel(image, label) {
  return inspectDockerImage(
    image,
    `{{ index .Config.Labels ${JSON.stringify(label)} }}`,
  );
}

function dockerImageId(image) {
  return inspectDockerImage(image, "{{ .Id }}");
}

export function hasRunningDevelopmentApplications(serviceOutput) {
  const runningServices = new Set(
    serviceOutput
      .split(/\r?\n/u)
      .map((service) => service.trim())
      .filter(Boolean),
  );
  return ["api", "runner", "web"].some((service) =>
    runningServices.has(service),
  );
}

export function developmentApplicationStartCommands() {
  return {
    // Infrastructure, storage initialization, and migrations are ready before
    // this command. Do not let Web's service_healthy dependencies block the
    // process that must attach Compose Watch and synchronize current source.
    initial: [
      ["up", "-d", "--no-build", "--no-deps", "runner"],
      ["up", "-d", "--no-build", "--no-deps", "api"],
      ["up", "-d", "--no-build", "--no-deps", "web"],
    ],
  };
}

function developmentPublishedHost(environment, name) {
  const configured = required(environment, name);
  if (configured === "0.0.0.0" || configured === "::") return "127.0.0.1";
  return configured.includes(":") ? `[${configured}]` : configured;
}

export function developmentReadinessTargets(environment) {
  const webOrigin = `http://${developmentPublishedHost(
    environment,
    "LINKSENSE_DEV_WEB_BIND_ADDRESS",
  )}:${required(environment, "LINKSENSE_DEV_WEB_PORT")}`;

  return [
    {
      name: "Runner",
      url: `http://${developmentPublishedHost(
        environment,
        "LINKSENSE_DEV_RUNNER_BIND_ADDRESS",
      )}:${required(environment, "LINKSENSE_DEV_RUNNER_PORT")}/health/ready`,
      headers: {
        authorization: `Bearer ${required(
          environment,
          "LINKSENSE_RUNNER_SHARED_SECRET",
        )}`,
      },
    },
    {
      name: "API",
      url: `http://${developmentPublishedHost(
        environment,
        "LINKSENSE_DEV_API_BIND_ADDRESS",
      )}:${required(
        environment,
        "LINKSENSE_DEV_API_PORT",
      )}/api/v1/system/health/ready`,
      headers: {},
    },
    {
      name: "Web",
      url: `${webOrigin}/`,
      headers: {},
    },
  ];
}

export function developmentContainerReadinessTargets(environmentFile) {
  return [
    {
      name: "Help Center",
      command: "docker",
      argumentsList: developmentComposeArguments(environmentFile, [
        "exec",
        "-T",
        "web",
        "sh",
        "-ec",
        "curl -fsS http://127.0.0.1:3001/help/ >/dev/null",
      ]),
    },
  ];
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

function readinessTargetDescription(target) {
  if ("url" in target) return target.url;
  return `${target.command} ${target.argumentsList.join(" ")}`;
}

function runCommandReadinessCheck(
  target,
  environment,
  commandImplementation,
) {
  const result = commandImplementation(target.command, target.argumentsList, {
    cwd: repositoryRoot,
    env: environment,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    return result.error instanceof Error
      ? result.error.message
      : "command failed";
  }
  if (result.status === 0) return null;
  return (
    result.stderr?.toString().trim() ||
    result.stdout?.toString().trim() ||
    `exit ${result.status ?? "unknown"}`
  );
}

export async function waitForDevelopmentApplicationReadiness(
  environment,
  options = {},
) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const commandImplementation =
    options.commandImplementation ?? spawnSync;
  const commandEnvironment = options.commandEnvironment ?? environment;
  const sleepImplementation = options.sleepImplementation ?? sleep;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 1_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
  const pending = new Map(
    [
      ...developmentReadinessTargets(environment),
      ...(options.commandTargets ?? []),
    ].map((target) => [
      target.name,
      { ...target, lastError: "not checked yet" },
    ]),
  );
  const deadline = Date.now() + timeoutMs;
  while (pending.size > 0 && Date.now() <= deadline) {
    await Promise.all(
      [...pending.entries()].map(async ([name, target]) => {
        if ("command" in target) {
          const error = runCommandReadinessCheck(
            target,
            commandEnvironment,
            commandImplementation,
          );
          if (error === null) {
            pending.delete(name);
            return;
          }
          target.lastError = error;
          return;
        }
        try {
          const response = await fetchImplementation(target.url, {
            method: "GET",
            headers: target.headers,
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          if (response.ok) {
            pending.delete(name);
            return;
          }
          target.lastError = `HTTP ${response.status}`;
        } catch (error) {
          target.lastError =
            error instanceof Error ? error.message : "request failed";
        }
      }),
    );
    if (pending.size === 0) return;
    if (Date.now() >= deadline) break;
    await sleepImplementation(Math.min(intervalMs, deadline - Date.now()));
  }
  const detail = [...pending.values()]
    .map(
      (target) =>
        `${target.name} ${readinessTargetDescription(target)} (${target.lastError})`,
    )
    .join("; ");
  throw new Error(
    `Development services did not become ready within ${Math.ceil(
      timeoutMs / 1000,
    )}s: ${detail}`,
  );
}

export function developmentMigrationDeployCommand() {
  // `migrate` normally runs its seed command as part of its container default
  // command. Reattaching an already-running development stack only needs the
  // idempotent Prisma migration step, so do not reseed on every `pnpm dev`.
  return ["run", "--rm", "migrate", "pnpm", "db:migrate:deploy"];
}

export function developmentInfrastructureStartCommand() {
  return ["up", "-d", "--wait", "postgres", "redis"];
}

export function developmentPostgresCredentialSyncCommand() {
  // The official Postgres image applies POSTGRES_PASSWORD only when the data
  // directory is first initialized. Development credentials can change while
  // the named volume remains, so synchronize the existing role over the
  // container-local trusted connection before Prisma connects over TCP.
  return [
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
    `psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 --set=role_name="$POSTGRES_USER" --set=role_password="$POSTGRES_PASSWORD" <<'SQL'
SELECT format('ALTER ROLE %I WITH PASSWORD %L', :'role_name', :'role_password') \\gexec
SQL`,
  ];
}

export function developmentStorageInitializationCommand() {
  // Reattaching an already-running stack with --no-deps does not rerun the
  // one-shot storage-init service. Prepare the host-backed user data root on
  // every pnpm dev invocation before the API or controller can use it.
  return ["run", "--rm", "storage-init"];
}

export function developmentWorkerRebuildCommands(
  applicationsAlreadyRunning,
) {
  return {
    refreshImages: ["build", "runner", "runner-worker-image"],
    replaceController: applicationsAlreadyRunning
      ? [
          "up",
          "-d",
          "--no-build",
          "--no-deps",
          "--wait",
          "runner",
        ]
      : null,
  };
}

function developmentApplicationsAreRunning(
  environmentFile,
  environment,
) {
  const result = spawnSync(
    "docker",
    developmentComposeArguments(environmentFile, [
      "ps",
      "--status",
      "running",
      "--services",
    ]),
    {
      cwd: repositoryRoot,
      env: environment,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (result.error || result.status !== 0) return false;
  return hasRunningDevelopmentApplications(result.stdout);
}

function ensureDevelopmentImages(
  environmentFile,
  environment,
  { force = false, includeApplications = true } = {},
) {
  const developmentFingerprint = developmentDependencyFingerprint();
  const migrationFingerprint = migrationImageFingerprint();
  const buildEnvironment = {
    ...environment,
    LINKSENSE_DEV_IMAGE_FINGERPRINT: developmentFingerprint,
    LINKSENSE_MIGRATION_IMAGE_FINGERPRINT: migrationFingerprint,
  };
  const composeArguments = (argumentsList) =>
    developmentComposeArguments(environmentFile, argumentsList);

  if (
    includeApplications &&
    (force ||
      developmentImageNames(buildEnvironment).some(
        (image) =>
          dockerImageLabel(image, developmentImageLabel) !==
          developmentFingerprint,
      ))
  ) {
    run(
      "docker",
      composeArguments(["build", "api", "runner", "web"]),
      buildEnvironment,
    );
  }

  const migrationImage = `linksense-migrate:${optional(
    buildEnvironment,
    "LINKSENSE_IMAGE_TAG",
    "local",
  )}`;
  if (
    force ||
    dockerImageLabel(migrationImage, migrationImageLabel) !==
      migrationFingerprint
  ) {
    run(
      "docker",
      composeArguments(["build", "migrate"]),
      buildEnvironment,
    );
  }

  return buildEnvironment;
}

function ensureWorkerImage(
  environmentFile,
  environment,
  { force = false } = {},
) {
  const workerImage = optional(
    environment,
    "LINKSENSE_WORKER_IMAGE",
    "linksense-runner-worker:local",
  );
  const fingerprint = workerImageFingerprint();
  const buildEnvironment = {
    ...environment,
    LINKSENSE_WORKER_IMAGE_FINGERPRINT: fingerprint,
  };
  if (
    workerImageNeedsRebuild(
      dockerImageLabel(workerImage, workerImageLabel),
      fingerprint,
      force,
    )
  ) {
    run(
      "docker",
      developmentComposeArguments(environmentFile, [
        "build",
        "runner-worker-image",
      ]),
      buildEnvironment,
    );
  }
  const revision = dockerImageId(workerImage);
  if (!revision) {
    throw new Error(`Worker image was not created: ${workerImage}`);
  }
  return revision;
}

function ensureEnvironmentFile() {
  const configuredPath = process.env.LINKSENSE_ENV_FILE?.trim();
  const environmentFile = resolve(repositoryRoot, configuredPath || ".env");
  if (!existsSync(environmentFile)) {
    if (configuredPath) {
      throw new Error(
        `Configured environment file does not exist: ${environmentFile}`,
      );
    }
    copyFileSync(resolve(repositoryRoot, ".env.example"), environmentFile);
    console.log("Created .env from .env.example for local development.");
  }
  process.loadEnvFile(environmentFile);
  process.env.LINKSENSE_USER_DATA_ROOT = resolvePortableUserDataRoot(
    process.env.LINKSENSE_USER_DATA_ROOT,
    process.env,
  );
  process.env.DATABASE_URL = resolveComposeDatabaseUrl(process.env);
  return environmentFile;
}

function loadRunnerEnvironmentFile() {
  const configuredPath = process.env.LINKSENSE_RUNNER_ENV_FILE?.trim();
  const environmentFile = resolve(
    repositoryRoot,
    configuredPath || "deploy/runner.env",
  );
  if (!existsSync(environmentFile)) {
    if (configuredPath) {
      throw new Error(
        `Configured runner environment file does not exist: ${environmentFile}`,
      );
    }
    return {};
  }
  return parseEnv(readFileSync(environmentFile, "utf8"));
}

function verifyRunnerEnvironmentFile() {
  loadRunnerEnvironmentFile();
}

export function createApplicationShutdown(
  children,
  options = {},
) {
  const detached = options.detached ?? process.platform !== "win32";
  const killProcess = options.killProcess ?? process.kill;
  let started = false;

  return (signal) => {
    if (started) return;
    started = true;
    let firstUnexpectedError;
    for (const { child } of children) {
      if (
        !child.pid ||
        child.killed ||
        child.exitCode !== null ||
        child.signalCode !== null
      ) {
        continue;
      }
      try {
        if (detached) killProcess(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error?.code !== "ESRCH") firstUnexpectedError ??= error;
      }
    }
    if (firstUnexpectedError) throw firstUnexpectedError;
  };
}

async function assertPublishedPortAvailable(
  label,
  host,
  portValue,
  probe = probePortAvailability,
) {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} port must be a valid TCP port.`);
  }
  try {
    await probe(host, port);
  } catch (error) {
    if (error?.code === "EADDRINUSE") {
      throw new Error(
        `${label} port ${host}:${port} is already in use. Run pnpm dev:stop before starting LinkSense again.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export async function assertRunnerPortAvailable(
  environment,
  probe = probePortAvailability,
) {
  return assertPublishedPortAvailable(
    "Runner",
    required(environment, "LINKSENSE_DEV_RUNNER_BIND_ADDRESS"),
    required(environment, "LINKSENSE_DEV_RUNNER_PORT"),
    probe,
  );
}

export async function assertApiPortAvailable(
  environment,
  probe = probePortAvailability,
) {
  return assertPublishedPortAvailable(
    "API",
    required(environment, "LINKSENSE_DEV_API_BIND_ADDRESS"),
    required(environment, "LINKSENSE_DEV_API_PORT"),
    probe,
  );
}

export async function assertWebPortAvailable(
  environment,
  probe = probePortAvailability,
) {
  return assertPublishedPortAvailable(
    "Web",
    required(environment, "LINKSENSE_DEV_WEB_BIND_ADDRESS"),
    required(environment, "LINKSENSE_DEV_WEB_PORT"),
    probe,
  );
}

function probePortAvailability(host, port) {
  return new Promise((resolveProbe, rejectProbe) => {
    const server = createServer();
    server.unref();
    server.once("error", rejectProbe);
    server.listen({ host, port, exclusive: true }, () => {
      server.close((error) => {
        if (error) rejectProbe(error);
        else resolveProbe();
      });
    });
  });
}

function startComposeDevelopmentSession(
  environmentFile,
  environment,
) {
  const detached = process.platform !== "win32";
  const children = [];
  const shutdown = createApplicationShutdown(children, { detached });
  let shuttingDown = false;
  const beginShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      shutdown(signal);
    } catch (error) {
      console.error(
        error instanceof Error
          ? `Unable to stop every development process: ${error.name}`
          : "Unable to stop every development process.",
      );
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => beginShutdown("SIGINT"));
  process.once("SIGTERM", () => beginShutdown("SIGTERM"));

  let settleSession;
  const completion = new Promise((resolveSession, rejectSession) => {
    let settled = false;
    settleSession = (error) => {
      if (settled) return;
      settled = true;
      beginShutdown("SIGTERM");
      if (error) rejectSession(error);
      else resolveSession();
    };
  });
  const startChild = (label, commandArguments) => {
    const child = spawn(
      "docker",
      developmentComposeArguments(environmentFile, commandArguments),
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: "inherit",
        detached,
      },
    );
    children.push({
      label,
      workspace: "docker-compose.dev.yml",
      child,
    });
    child.once("error", (error) => settleSession(error));
    child.once("exit", (code, signal) => {
      if (shuttingDown || signal === "SIGINT" || signal === "SIGTERM") {
        settleSession();
        return;
      }
      if (code === 0) {
        settleSession();
        return;
      }
      settleSession(
        new Error(
          `${label} exited with ${signal ?? code ?? "an unknown status"}`,
        ),
      );
    });
  };

  startChild("Compose logs", [
    "logs",
    "--follow",
    "--tail",
    "20",
    "api",
    "runner",
    "web",
  ]);
  startChild("Compose Watch", [
    "watch",
    "--no-up",
    "api",
    "runner",
    "web",
  ]);
  return {
    completion,
    stop() {
      beginShutdown("SIGTERM");
    },
  };
}

function developmentRunnerHost(environment) {
  const configured = required(
    environment,
    "LINKSENSE_DEV_RUNNER_BIND_ADDRESS",
  );
  if (configured === "0.0.0.0" || configured === "::") return "127.0.0.1";
  return configured.includes(":") ? `[${configured}]` : configured;
}

export async function stopDevelopmentWorkers(
  environment,
  fetchImplementation = fetch,
) {
  const url = `http://${developmentRunnerHost(environment)}:${required(
    environment,
    "LINKSENSE_DEV_RUNNER_PORT",
  )}/development/workers/stop-all`;
  try {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${required(
          environment,
          "LINKSENSE_RUNNER_SHARED_SECRET",
        )}`,
      },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status === 204) return "stopped";
    if (response.status === 404) return "legacy";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function main(argumentsList = process.argv.slice(2)) {
  const environmentFile = ensureEnvironmentFile();
  const composeArguments = (commandArguments) =>
    developmentComposeArguments(environmentFile, commandArguments);
  const productionArguments = (commandArguments) =>
    productionComposeArguments(environmentFile, commandArguments);
  const environment = buildDevelopmentEnvironment(process.env);
  let composeEnvironment = buildDevelopmentComposeEnvironment(
    process.env,
    environment,
  );
  const productionMode = argumentsList.includes("--production");

  if (productionMode) {
    if (argumentsList.includes("--stop") || argumentsList.includes("--down")) {
      run("docker", productionArguments(["down"]), process.env);
      console.log(
        "Production-parity LinkSense services stopped; persistent data was retained.",
      );
      return;
    }
    verifyRunnerEnvironmentFile();
    const productionEnvironment = {
      ...buildProductionParityEnvironment(process.env),
      LINKSENSE_MIGRATION_IMAGE_FINGERPRINT: migrationImageFingerprint(),
      LINKSENSE_WORKER_IMAGE_FINGERPRINT: workerImageFingerprint(),
    };
    run(
      "docker",
      productionArguments([
        "build",
        "migrate",
        "runner-worker-image",
        "runner",
        "api",
        "web",
      ]),
      productionEnvironment,
    );
    const workerImage = optional(
      productionEnvironment,
      "LINKSENSE_WORKER_IMAGE",
      "linksense-runner-worker:local",
    );
    const workerRevision = dockerImageId(workerImage);
    if (!workerRevision) {
      throw new Error(`Worker image was not created: ${workerImage}`);
    }
    const productionRuntimeEnvironment = buildWorkerRuntimeEnvironment(
      productionEnvironment,
      workerRevision,
    );
    run(
      "docker",
      productionArguments([
        "up",
        "-d",
        "--no-build",
        "--wait",
        "--wait-timeout",
        "300",
        "web",
      ]),
      productionRuntimeEnvironment,
    );
    console.log(
      "Production-parity images were rebuilt and the immutable Compose stack is healthy.",
    );
    return;
  }

  if (argumentsList.includes("--stop")) {
    const workerCleanup = await stopDevelopmentWorkers(environment);
    if (workerCleanup === "legacy") {
      run("docker", composeArguments(["stop", "runner"]), composeEnvironment);
    } else if (workerCleanup === "unavailable") {
      console.log(
        "No reachable development runner controller was found; continuing with Compose cleanup.",
      );
    }
    const result = await stopDevelopmentApplications(repositoryRoot);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    if (result.stoppedServices.length > 0) {
      console.log(
        `Stopped local LinkSense services: ${result.stoppedServices.join(", ")}.`,
      );
    } else {
      console.log("No running local LinkSense services were found.");
    }
    if (result.forcedServices.length > 0) {
      console.warn(
        `Forced unresponsive services to stop: ${result.forcedServices.join(", ")}.`,
      );
    }
    run("docker", composeArguments(["down"]));
    console.log(
      "All LinkSense development services stopped; persistent data was retained.",
    );
    return;
  }

  if (argumentsList.includes("--down")) {
    const workerCleanup = await stopDevelopmentWorkers(environment);
    if (workerCleanup === "legacy") {
      run("docker", composeArguments(["stop", "runner"]), composeEnvironment);
    }
    run("docker", composeArguments(["down"]));
    console.log(
      "Containerized LinkSense services stopped; persistent data was retained.",
    );
    return;
  }

  if (argumentsList.includes("--worker-rebuild")) {
    verifyRunnerEnvironmentFile();
    const applicationsAreRunning = developmentApplicationsAreRunning(
      environmentFile,
      composeEnvironment,
    );
    const workerCleanup = await stopDevelopmentWorkers(environment);
    if (workerCleanup === "legacy") {
      run("docker", composeArguments(["stop", "runner"]), composeEnvironment);
    }
    const rebuildCommands =
      developmentWorkerRebuildCommands(applicationsAreRunning);
    const workerBuildEnvironment = {
      ...composeEnvironment,
      LINKSENSE_WORKER_IMAGE_FINGERPRINT: workerImageFingerprint(),
    };
    run(
      "docker",
      composeArguments(rebuildCommands.refreshImages),
      workerBuildEnvironment,
    );
    const workerImage = optional(
      workerBuildEnvironment,
      "LINKSENSE_WORKER_IMAGE",
      "linksense-runner-worker:local",
    );
    const revision = dockerImageId(workerImage);
    if (!revision) {
      throw new Error(`Worker image was not created: ${workerImage}`);
    }
    if (rebuildCommands.replaceController) {
      run(
        "docker",
        composeArguments(rebuildCommands.replaceController),
        buildWorkerRuntimeEnvironment(workerBuildEnvironment, revision),
      );
    }
    console.log(
      `Rebuilt the development runner-controller and production task-worker images (${revision}), removed reachable development workers, and refreshed any running controller.`,
    );
    return;
  }

  const prepareOnly = argumentsList.includes("--prepare-only");
  const forceRebuild = argumentsList.includes("--rebuild");
  const applicationsAlreadyRunning =
    !prepareOnly &&
    developmentApplicationsAreRunning(environmentFile, composeEnvironment);
  if (!prepareOnly) {
    verifyRunnerEnvironmentFile();
    if (!applicationsAlreadyRunning) {
      await assertApiPortAvailable(environment);
      await assertRunnerPortAvailable(environment);
      await assertWebPortAvailable(environment);
    }
  }

  composeEnvironment = ensureDevelopmentImages(
    environmentFile,
    composeEnvironment,
    {
      force: forceRebuild,
      includeApplications: !prepareOnly,
    },
  );

  if (prepareOnly) {
    run(
      "docker",
      composeArguments(developmentInfrastructureStartCommand()),
      composeEnvironment,
    );
    run(
      "docker",
      composeArguments(developmentPostgresCredentialSyncCommand()),
      composeEnvironment,
    );
    run(
      "docker",
      composeArguments(developmentStorageInitializationCommand()),
      composeEnvironment,
    );
    run(
      "docker",
      composeArguments(["run", "--rm", "migrate"]),
      composeEnvironment,
    );
    console.log(
      "Development infrastructure, containerized migrations, and seed are ready.",
    );
    return;
  }

  run(
    "docker",
    composeArguments(developmentInfrastructureStartCommand()),
    composeEnvironment,
  );

  run(
    "docker",
    composeArguments(developmentPostgresCredentialSyncCommand()),
    composeEnvironment,
  );

  // Ensure the host-backed user data root exists even when application
  // containers are reattached with --no-deps.
  run(
    "docker",
    composeArguments(developmentStorageInitializationCommand()),
    composeEnvironment,
  );

  // A reattached Compose Watch session starts API/runner/web with --no-deps,
  // which otherwise skips the one-shot migrate service. Always apply pending
  // migrations after rebuilding the migration image and before reusing those
  // applications, so Prisma's schema cannot get ahead of PostgreSQL.
  run(
    "docker",
    composeArguments(developmentMigrationDeployCommand()),
    composeEnvironment,
  );

  const workerRevision = ensureWorkerImage(
    environmentFile,
    composeEnvironment,
    { force: forceRebuild },
  );
  composeEnvironment = buildWorkerRuntimeEnvironment(
    composeEnvironment,
    workerRevision,
  );

  const staleProcesses = await stopDevelopmentApplications(repositoryRoot);
  for (const warning of staleProcesses.warnings) {
    console.warn(`Warning: ${warning}`);
  }
  if (staleProcesses.stoppedServices.includes("Compose helpers")) {
    console.log(
      "Stopped the previous LinkSense Compose Watch/log session before attaching this terminal.",
    );
  }

  // Start the containers first, then attach Compose Watch before waiting for
  // health. This makes the host source the startup source of truth even when
  // the cached development image predates a local fix.
  const startup = developmentApplicationStartCommands();
  for (const command of startup.initial) {
    run("docker", composeArguments(command), composeEnvironment);
  }
  const session = startComposeDevelopmentSession(
    environmentFile,
    composeEnvironment,
  );
  try {
    await waitForDevelopmentApplicationReadiness(environment, {
      commandEnvironment: composeEnvironment,
      commandTargets: developmentContainerReadinessTargets(environmentFile),
    });
  } catch (error) {
    session.stop();
    await session.completion.catch(() => undefined);
    throw error;
  }

  console.log(
    `Containerized Vite Web, API, and runner controller are ready on :${environment.LINKSENSE_DEV_WEB_PORT}, :${environment.LINKSENSE_DEV_API_PORT}, and :${environment.LINKSENSE_DEV_RUNNER_PORT}.`,
  );
  console.log(
    "Compose Watch is active. Source changes sync into Linux containers; dependency changes rebuild only the affected development service.",
  );
  console.log(
    "Run pnpm dev:worker:rebuild after runner changes that must reach newly created task workers, or pnpm dev:stop to stop everything.",
  );
  await session.completion;
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
