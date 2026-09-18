import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";
import { z } from "zod";
import {
  developmentDatabaseConnection,
  inspectDevelopmentDatabase,
  prepareDevelopmentDatabase,
  readMigrationManifest,
} from "./dev-database.mjs";
import { preparationStatePath, recordStoragePreparation, storageNeedsInitialization } from "./dev-preparation.mjs";
import { sourceFingerprint } from "./source-fingerprint.mjs";
import { developmentTlsDirectory, prepareDevelopmentTls, trustDevelopmentCertificate } from "./dev-tls.mjs";
import { assertDevelopmentHttp2 } from "./dev-http2.mjs";
export { sourceFingerprint } from "./source-fingerprint.mjs";

import {
  stopDevelopmentApplications,
} from "./dev-processes.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const developmentComposeFile = "docker-compose.dev.yml";
const developmentImageLabel = "com.linksense.development.fingerprint";
const migrationImageLabel = "com.linksense.migration.fingerprint";
const workerImageLabel = "com.linksense.worker.fingerprint";
const docsImageLabel = "com.linksense.docs.fingerprint";

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
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(`${name} must not contain credentials, path, query, or fragment`);
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

export function buildDevelopmentEnvironment(source, { https = true } = {}) {
  const apiOrigin = optional(
    source,
    "LINKSENSE_DEV_API_ORIGIN",
    "http://localhost:4000",
  );
  const webOrigin = optional(
    source,
    "LINKSENSE_DEV_WEB_ORIGIN",
    "http://localhost:18172",
  );
  const portSchema = z.coerce.number().int().min(1).max(65_535).transform(String);
  const apiPort = portSchema.parse(optional(
    source,
    "LINKSENSE_DEV_API_PORT",
    developmentOriginPort("LINKSENSE_DEV_API_ORIGIN", apiOrigin, "4000"),
  ));
  const webPort = portSchema.parse(optional(
    source,
    "LINKSENSE_DEV_WEB_PORT",
    developmentOriginPort("LINKSENSE_DEV_WEB_ORIGIN", webOrigin, "18172"),
  ));
  const webUrl = new URL(webOrigin);
  webUrl.port = webPort;
  const httpsPort = https ? portSchema.parse(optional(source, "LINKSENSE_DEV_WEB_HTTPS_PORT", "18173")) : "";
  if (httpsPort === webPort) throw new Error("LINKSENSE_DEV_WEB_HTTPS_PORT must differ from LINKSENSE_DEV_WEB_PORT");
  const httpsUrl = new URL(webUrl);
  httpsUrl.protocol = "https:";
  httpsUrl.port = httpsPort;
  const existingNoProxy = source.NO_PROXY?.trim();

  return {
    ...source,
    NODE_ENV: "development",
    LINKSENSE_PUBLIC_BASE_URL: webUrl.origin,
    // Cookie authentication requires same-origin requests through Vite's /api proxy.
    VITE_API_BASE_URL: "",
    LINKSENSE_DEV_API_BIND_ADDRESS: optional(
      source,
      "LINKSENSE_DEV_API_BIND_ADDRESS",
      "127.0.0.1",
    ),
    LINKSENSE_DEV_API_PORT: apiPort,
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
    LINKSENSE_DEV_WEB_PORT: webPort,
    LINKSENSE_DEV_WEB_HTTPS_PORT: httpsPort,
    LINKSENSE_DEV_WEB_HTTPS_ORIGIN: https ? httpsUrl.origin : "",
    LINKSENSE_DEV_TLS_DIR: developmentTlsDirectory(repositoryRoot),
    NO_PROXY: [existingNoProxy, "127.0.0.1", "localhost"]
      .filter(Boolean)
      .join(","),
  };
}

export function developmentReadyMessage(environment) {
  const webPort = required(environment, "LINKSENSE_DEV_WEB_PORT");
  const webUrl = new URL(required(environment, "LINKSENSE_PUBLIC_BASE_URL"));
  webUrl.port = webPort;
  const httpsMessage = environment.LINKSENSE_DEV_WEB_HTTPS_ORIGIN
    ? `\nWeb HTTPS (HTTP/2): ${environment.LINKSENSE_DEV_WEB_HTTPS_ORIGIN}` : "";
  return `Web: ${webUrl.origin} (port ${webPort})${httpsMessage}\nAPI port: ${required(environment, "LINKSENSE_DEV_API_PORT")}; runner controller port: ${required(environment, "LINKSENSE_DEV_RUNNER_PORT")}.`;
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
    LINKSENSE_DEV_WEB_HTTPS_PORT: environment.LINKSENSE_DEV_WEB_HTTPS_PORT,
    LINKSENSE_DEV_TLS_DIR: environment.LINKSENSE_DEV_TLS_DIR,
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

function captureCommand(command, args, environment) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd: repositoryRoot, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 30_000);
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    // Consume stderr, but do not expose potentially sensitive external errors.
    child.stderr.resume();
    child.once("error", (error) => { clearTimeout(timer); rejectCommand(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveCommand(output);
      else rejectCommand(new Error(`Development ${command} command failed (exit ${code})`));
    });
  });
}

export function waitForWatchEnabled(child, timeoutMs = 30_000) {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    const finish = (error) => {
      clearTimeout(timer);
      child.stdout.off("data", inspect);
      child.stderr.off("data", inspect);
      child.off("exit", exited);
      child.off("error", finish);
      if (error) rejectReady(error);
      else resolveReady();
    };
    const inspect = (chunk) => {
      output = (output + chunk.toString()).slice(-4_096);
      if (/\bWatch enabled\b/u.test(output)) finish();
    };
    const exited = () => finish(new Error("Development watch exited before source watching was ready"));
    const timer = setTimeout(() => finish(new Error("Development watch did not become ready within 30 seconds")), timeoutMs);
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("exit", exited);
    child.once("error", finish);
  });
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
    "apps/web/tsconfig.json",
    "apps/web/tsconfig.app.json",
    "apps/web/tsconfig.node.json",
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
    "apps/docs/package.json",
    "apps/runner/package.json",
    "apps/web/package.json",
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

export function docsImageFingerprint(rootDirectory = repositoryRoot) {
  return sourceFingerprint(rootDirectory, [
    ".dockerignore", "Dockerfile.web", "LICENSE", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches", "tsconfig.base.json",
    "apps/api/package.json", "apps/runner/package.json", "apps/web/package.json", "packages/shared/package.json",
    "apps/docs/package.json", "apps/docs/docusaurus.config.ts", "apps/docs/sidebars.ts", "apps/docs/tsconfig.json",
    "apps/docs/docs", "apps/docs/i18n", "apps/docs/src", "apps/docs/static",
    "deploy/nginx/development-docs.conf", "deploy/nginx/help-location.conf",
  ]);
}

export function workerImageFingerprint(rootDirectory = repositoryRoot) {
  return sourceFingerprint(rootDirectory, [
    ".dockerignore",
    "Dockerfile.runner",
    "LICENSE",
    "apps/api/package.json",
    "apps/docs/package.json",
    "apps/runner/package.json",
    "apps/runner/src",
    "apps/runner/tsconfig.json",
    "apps/runner/tsconfig.build.json",
    "apps/web/package.json",
    "deploy/codex-home-template",
    "deploy/codex-system",
    "deploy/docker/configure-debian-apt.sh",
    "deploy/docker/runner-runtime-smoke.mjs",
    "deploy/runtime/browser",
    "deploy/runtime/fonts",
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
    // process that must attach source watching and synchronize current source.
    initial: [
      ["up", "-d", "--no-build", "--no-deps", "runner", "api", "web", "docs", "dev-gateway"],
    ],
  };
}

export function developmentApplicationLogCommand(since) {
  // Keep errors emitted before logs attach, but exclude previous sessions.
  return ["logs", "--follow", "--since", since, "api", "runner", "web", "docs", "dev-gateway"];
}

export async function synchronizeDevelopmentApplications(output, { synchronize, restart, isLive }) {
  const containers = output.trim().split(/\r?\n/u).filter(Boolean).map((line) => z.object({
    Service: z.enum(["api", "runner", "web"]),
    ID: z.string().regex(/^[a-f0-9]{12,64}$/u),
    Health: z.enum(["", "starting", "healthy", "unhealthy"]),
  }).parse(JSON.parse(line)));
  if (containers.length !== 3 || new Set(containers.map(({ Service }) => Service)).size !== 3) {
    throw new Error("Development application containers did not start");
  }
  const results = await Promise.all(containers.map(async ({ Service, ID, Health }) => {
    const result = z.object({ changed: z.boolean() }).parse(await synchronize(Service, ID));
    // Source reconciliation happens before an explicit restart. Health and a
    // live probe also detect a running but unresponsive development service.
    const needsRestart = result.changed || Health === "unhealthy" ||
      (Health === "healthy" && !(await isLive(Service)));
    return needsRestart ? Service : null;
  }));
  const needsRestart = results.filter(Boolean);
  // Mirror offline edits and deletions before restarting any application.
  if (needsRestart.length > 0) await restart(needsRestart);
}

export async function developmentApplicationIsLive(service, environment, fetchImplementation = fetch) {
  const targets = {
    api: ["API", "/api/v1/system/health/live"],
    runner: ["RUNNER", "/health/live"],
    web: ["WEB", "/"],
  };
  const [name, pathname] = targets[service];
  const host = developmentPublishedHost(environment, `LINKSENSE_DEV_${name}_BIND_ADDRESS`);
  const port = required(environment, `LINKSENSE_DEV_${name}_PORT`);
  try {
    const response = await fetchImplementation(`http://${host}:${port}${pathname}`, { signal: AbortSignal.timeout(2_000) });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  }
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

  const targets = [
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
    { name: "Help Center (zh-CN)", url: `${webOrigin}/help/`, headers: {}, bodyIncludes: 'lang="zh-CN"' },
    { name: "Help Center (en-US)", url: `${webOrigin}/help/en-US/`, headers: {}, bodyIncludes: 'lang="en-US"' },
    { name: "Web entry module", url: `${webOrigin}/src/main.tsx`, headers: {}, contentTypeIncludes: "javascript" },
    { name: "Web application module", url: `${webOrigin}/src/App.tsx`, headers: {}, contentTypeIncludes: "javascript" },
    { name: "Web stylesheet", url: `${webOrigin}/src/index.css?direct`, headers: {}, contentTypeIncludes: "text/css" },
    { name: "Web bootstrap", url: `${webOrigin}/api/v1/system/bootstrap`, headers: {}, contentTypeIncludes: "application/json", bodyIncludes: '"success":true', upstream: "API" },
    {
      name: "Web session restore",
      upstream: "API",
      url: `${webOrigin}/api/v1/auth/refresh`,
      method: "POST",
      headers: { origin: webOrigin, "sec-fetch-site": "same-origin" },
      // No cookie is sent: an expired session is expected; a CSRF rejection is not.
      expectedStatus: 401,
      contentTypeIncludes: "application/json",
      bodyIncludes: '"AUTH_SESSION_EXPIRED"',
    },
  ];
  if (environment.LINKSENSE_DEV_WEB_HTTPS_PORT) {
    const httpsOrigin = `https://${developmentPublishedHost(environment, "LINKSENSE_DEV_WEB_BIND_ADDRESS")}:${environment.LINKSENSE_DEV_WEB_HTTPS_PORT}`;
    for (const name of ["Web", "Web bootstrap", "Web session restore"]) {
      const target = targets.find((candidate) => candidate.name === name);
      targets.push({
        ...target,
        name: `${name} (HTTPS)`,
        url: target.url.replace(webOrigin, httpsOrigin),
        headers: target.headers.origin ? { ...target.headers, origin: httpsOrigin } : {},
      });
    }
  }
  return targets;
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, milliseconds);
  });
}

export async function waitForDevelopmentApplicationReadiness(
  environment,
  options = {},
) {
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const sleepImplementation = options.sleepImplementation ?? sleep;
  const timeoutMs = options.timeoutMs ?? 300_000;
  const intervalMs = options.intervalMs ?? 200;
  // Docker's port proxy may accept connections before the application listens.
  // Bound each local probe so those stale connections do not delay the next round.
  const requestTimeoutMs = options.requestTimeoutMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  const targetGroups = [
    ...(options.prerequisiteTargets?.length
      ? [options.prerequisiteTargets]
      : []),
    developmentReadinessTargets(environment),
  ];
  for (const group of targetGroups) {
    const targets = group.map((target) => ({
      ...target,
      lastError: "not checked yet",
    }));
    // Probe upstreams before their Web proxies on every round, including after
    // a source-sync restart. Keep module warmup and other direct probes parallel.
    const batches = [
      targets.filter((target) => !target.upstream),
      targets.filter((target) => target.upstream),
    ];
    let groupReady = false;
    while (Date.now() < deadline) {
      options.signal?.throwIfAborted();
      for (const batch of batches) {
        options.signal?.throwIfAborted();
        await Promise.all(
          batch.map(async (target) => {
            if (
              target.upstream &&
              targets.find((upstream) => upstream.name === target.upstream)
                ?.lastError !== null
            ) {
              target.lastError = `Waiting for ${target.upstream} readiness`;
              return;
            }
            try {
              const response = await fetchImplementation(target.url, {
                method: target.method ?? "GET",
                headers: target.headers,
                signal: AbortSignal.any([
                  AbortSignal.timeout(
                    Math.max(
                      1,
                      Math.min(requestTimeoutMs, deadline - Date.now()),
                    ),
                  ),
                  ...(options.signal ? [options.signal] : []),
                ]),
              });
              const validBody = target.bodyIncludes
                ? (await response.text()).includes(target.bodyIncludes)
                : true;
              const validType =
                !target.contentTypeIncludes ||
                (response.headers.get("content-type") ?? "").includes(
                  target.contentTypeIncludes,
                );
              if (!target.bodyIncludes) await response.body?.cancel();
              const validStatus =
                target.expectedStatus === undefined
                  ? response.ok
                  : response.status === target.expectedStatus;
              target.lastError = !validStatus
                ? `HTTP ${response.status}`
                : !validType
                  ? "Unexpected content type"
                  : validBody
                    ? null
                    : "Unexpected page content";
            } catch (error) {
              target.lastError =
                error instanceof Error ? error.message : "request failed";
            }
          }),
        );
      }
      options.signal?.throwIfAborted();
      // A service that passed an earlier probe may have restarted after source
      // synchronization. Require every target in this stage to pass together.
      if (targets.every((target) => target.lastError === null)) {
        groupReady = true;
        break;
      }
      if (Date.now() >= deadline) break;
      await sleepImplementation(Math.min(intervalMs, deadline - Date.now()));
    }
    if (groupReady) continue;
    const detail = targets
      .filter((target) => target.lastError !== null)
      .map(
        (target) =>
          `${target.name} ${target.url} (${target.lastError})`,
      )
      .join("; ");
    throw new Error(
      `Development services did not become ready within ${Math.ceil(
        timeoutMs / 1000,
      )}s: ${detail}`,
    );
  }
  if (environment.LINKSENSE_DEV_WEB_HTTPS_PORT) {
    const web = developmentReadinessTargets(environment).find((target) => target.name === "Web (HTTPS)");
    await (options.http2Probe ?? assertDevelopmentHttp2)(new URL(web.url).origin, {
      signal: options.signal,
      timeoutMs: requestTimeoutMs,
    });
  }
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

const objectStorageFailureReasons = [
  "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "ECONNRESET",
  "EHOSTUNREACH", "ENETUNREACH", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "MINIO_BUCKET_NOT_FOUND", "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch",
  "CONFIG_INVALID", "OBJECT_STORAGE_UNAVAILABLE",
];

export function developmentObjectStorageCheckCommand(timeoutMs = 10_000) {
  const timeout = z.number().int().positive().max(30_000).parse(timeoutMs);
  // Reuse the API's config validation and storage adapter inside its own
  // network. A host probe cannot resolve container DNS or verify bucket access.
  const probe = `
const report = (result) => { console.log(JSON.stringify(result)); process.exit(0); };
setTimeout(() => report({ ready: false, reason: "ETIMEDOUT" }), ${timeout});
try {
  const { parseConfig } = await import("./src/config.ts");
  const { createObjectStorage } = await import("./src/adapters/object-storage.ts");
  await createObjectStorage(parseConfig()).ensureBucket();
  report({ ready: true });
} catch (error) {
  const allowed = ${JSON.stringify(objectStorageFailureReasons)};
  const code = error?.code ?? error?.message;
  const reason = error?.name === "ZodError" ? "CONFIG_INVALID"
    : allowed.includes(code) ? code : "OBJECT_STORAGE_UNAVAILABLE";
  report({ ready: false, reason });
}`;
  return [
    "run", "--rm", "--no-deps", "--pull", "never", "--workdir", "/workspace/apps/api",
    "--entrypoint", "node", "api", "--import", "tsx", "--input-type=module", "-e", probe,
  ];
}

export async function verifyDevelopmentObjectStorage(check) {
  const result = z.discriminatedUnion("ready", [
    z.object({ ready: z.literal(true) }),
    z.object({ ready: z.literal(false), reason: z.enum(objectStorageFailureReasons) }),
  ]).parse(JSON.parse(await check()));
  if (!result.ready) {
    throw new Error(`Object storage preflight failed (${result.reason}). Start the configured MinIO service and verify MINIO_* credentials and bucket access, then run pnpm dev again.`);
  }
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
  const fingerprints = configuredDevelopmentFingerprints(environmentFile, environment);
  const developmentFingerprint = fingerprints.api;
  const migrationFingerprint = fingerprints.migrate;
  const docsFingerprint = fingerprints.docs;
  const buildEnvironment = {
    ...environment,
    LINKSENSE_DEV_IMAGE_FINGERPRINT: developmentFingerprint,
    LINKSENSE_MIGRATION_IMAGE_FINGERPRINT: migrationFingerprint,
    LINKSENSE_DOCS_IMAGE_FINGERPRINT: docsFingerprint,
    LINKSENSE_WORKER_IMAGE_FINGERPRINT: fingerprints["runner-worker-image"],
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

  if (force || dockerImageLabel(`linksense-docs-dev:${optional(environment, "LINKSENSE_DEV_IMAGE_TAG", "local")}`, docsImageLabel) !== docsFingerprint) {
    run("docker", composeArguments(["build", "docs"]), buildEnvironment);
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

export function fingerprintBuildConfiguration(sourceHash, build) {
  const args = Object.entries(build.args ?? {}).filter(([key]) => !key.endsWith("_IMAGE_FINGERPRINT")).sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify([sourceHash, build.dockerfile, build.target, args])).digest("hex");
}

export function configuredDevelopmentFingerprints(environmentFile, environment) {
  const result = spawnSync("docker", developmentComposeArguments(environmentFile, ["config", "--format", "json"]), {
    cwd: repositoryRoot, env: environment, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Unable to validate development Compose configuration");
  const buildSchema = z.object({ dockerfile: z.string(), target: z.string().optional(), args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional() });
  const config = z.object({ services: z.record(z.string(), z.object({ build: buildSchema.optional() })) }).parse(JSON.parse(result.stdout));
  const sources = { api: developmentDependencyFingerprint(), migrate: migrationImageFingerprint(), docs: docsImageFingerprint(), "runner-worker-image": workerImageFingerprint() };
  return Object.fromEntries(Object.entries(sources).map(([service, hash]) => {
    const build = config.services[service]?.build;
    if (!build) throw new Error(`Missing development build configuration for ${service}`);
    return [service, fingerprintBuildConfiguration(hash, build)];
  }));
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
  const fingerprint = environment.LINKSENSE_WORKER_IMAGE_FINGERPRINT;
  if (!fingerprint) throw new Error("Missing prepared worker image fingerprint");
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
  await assertPublishedPortAvailable(
    "Web",
    required(environment, "LINKSENSE_DEV_WEB_BIND_ADDRESS"),
    required(environment, "LINKSENSE_DEV_WEB_PORT"),
    probe,
  );
  if (environment.LINKSENSE_DEV_WEB_HTTPS_PORT) {
    await assertPublishedPortAvailable(
      "Web HTTPS",
      required(environment, "LINKSENSE_DEV_WEB_BIND_ADDRESS"),
      environment.LINKSENSE_DEV_WEB_HTTPS_PORT,
      probe,
    );
  }
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
  since,
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
  // Startup awaits watch readiness before awaiting the session's lifetime.
  // Attach a rejection observer immediately so an early child failure is
  // reported by that startup path without an unhandled rejection.
  void completion.catch(() => undefined);
  const startChild = (label, commandArguments, command = "docker") => {
    const child = spawn(
      command,
      command === "docker" ? developmentComposeArguments(environmentFile, commandArguments) : commandArguments,
      {
        cwd: repositoryRoot,
        env: environment,
        stdio: label === "Source watch" ? ["ignore", "pipe", "pipe"] : "inherit",
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
    return child;
  };

  startChild("Compose logs", developmentApplicationLogCommand(since));
  const watch = startChild("Source watch", [
    resolve(repositoryRoot, "scripts/dev-watch.mjs"), environmentFile,
  ], process.execPath);
  const ready = waitForWatchEnabled(watch);
  watch.stdout.pipe(process.stdout, { end: false });
  watch.stderr.pipe(process.stderr, { end: false });
  return {
    completion,
    ready,
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
  const startedAt = performance.now();
  const stages = {};
  const measure = async (name, operation) => {
    const start = performance.now();
    const result = await operation();
    stages[name] = Math.round(performance.now() - start);
    console.log(`[dev] ${name}: ${stages[name]}ms`);
    return result;
  };
  const environmentFile = ensureEnvironmentFile();
  const composeArguments = (commandArguments) =>
    developmentComposeArguments(environmentFile, commandArguments);
  const productionArguments = (commandArguments) =>
    productionComposeArguments(environmentFile, commandArguments);
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

  const environment = buildDevelopmentEnvironment(process.env);
  let composeEnvironment = buildDevelopmentComposeEnvironment(process.env, environment);

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
    run("docker", composeArguments(["stop"]));
    console.log(
      "All LinkSense development services stopped; containers, caches and persistent data were retained. Run pnpm dev:down to remove containers.",
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
    const fingerprints = configuredDevelopmentFingerprints(environmentFile, composeEnvironment);
    const workerBuildEnvironment = {
      ...composeEnvironment,
      LINKSENSE_DEV_IMAGE_FINGERPRINT: fingerprints.api,
      LINKSENSE_WORKER_IMAGE_FINGERPRINT: fingerprints["runner-worker-image"],
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
  await measure("certificate", () => {
    prepareDevelopmentTls(environment);
    trustDevelopmentCertificate(environment);
    // Recreate only when Nginx configuration or its certificate has changed;
    // ordinary reattachment must preserve active event streams.
    composeEnvironment.LINKSENSE_DEV_GATEWAY_REVISION = sourceFingerprint(repositoryRoot, [
      "deploy/development/nginx", ".data/dev/tls/cert.pem",
    ]);
  });
  const applicationsAlreadyRunning =
    developmentApplicationsAreRunning(environmentFile, composeEnvironment);
  verifyRunnerEnvironmentFile();
  const rsync = spawnSync("rsync", ["--version"], { stdio: "ignore", timeout: 5_000 });
  if (rsync.error || rsync.status !== 0) throw new Error("Development source synchronization requires rsync on the host (included with macOS; install rsync on Linux)");
  if (!applicationsAlreadyRunning) {
    await assertApiPortAvailable(environment);
    await assertRunnerPortAvailable(environment);
    await assertWebPortAvailable(environment);
  }

  await measure("previous-session", async () => {
    const staleProcesses = await stopDevelopmentApplications(repositoryRoot);
    for (const warning of staleProcesses.warnings) console.warn(`Warning: ${warning}`);
  });

  composeEnvironment = await measure("images", () => ensureDevelopmentImages(
    environmentFile,
    composeEnvironment,
    {
      force: forceRebuild,
      includeApplications: true,
    },
  ));

  await measure("infrastructure", () => run(
    "docker",
    composeArguments(developmentInfrastructureStartCommand()),
    composeEnvironment,
  ));

  await measure("storage", () => {
    const statePath = preparationStatePath(repositoryRoot, environmentFile, composeEnvironment);
    const directory = composeEnvironment.LINKSENSE_USER_DATA_ROOT;
    const configuration = sourceFingerprint(repositoryRoot, ["docker-compose.yml", "docker-compose.dev.yml"]);
    if (storageNeedsInitialization(statePath, directory, configuration)) {
      run("docker", composeArguments(developmentStorageInitializationCommand()), composeEnvironment);
      recordStoragePreparation(statePath, directory, configuration);
    }
  });

  await measure("database", async () => {
    const manifest = readMigrationManifest(repositoryRoot);
    await prepareDevelopmentDatabase({
      inspect: () => inspectDevelopmentDatabase(composeEnvironment, manifest),
      bundled: developmentDatabaseConnection(composeEnvironment).bundled,
      validationPath: `${preparationStatePath(repositoryRoot, environmentFile, composeEnvironment)}.${composeEnvironment.LINKSENSE_MIGRATION_IMAGE_FINGERPRINT}.database`,
      synchronizeCredentials: () => run("docker", composeArguments(developmentPostgresCredentialSyncCommand()), composeEnvironment),
      deploy: () => run("docker", composeArguments(developmentMigrationDeployCommand()), composeEnvironment),
      seed: () => run("docker", composeArguments(["run", "--rm", "--no-deps", "migrate", "pnpm", "db:seed"]), composeEnvironment),
    });
  });

  await measure("object-storage", () => verifyDevelopmentObjectStorage(() => captureCommand(
    "docker", composeArguments(developmentObjectStorageCheckCommand()), composeEnvironment,
  )));

  const workerRevision = await measure("worker-image", () => ensureWorkerImage(
    environmentFile,
    composeEnvironment,
    { force: forceRebuild },
  ));
  composeEnvironment = buildWorkerRuntimeEnvironment(
    composeEnvironment,
    workerRevision,
  );

  const startup = developmentApplicationStartCommands();
  await measure("applications", () => {
    for (const command of startup.initial) run("docker", composeArguments(command), composeEnvironment);
  });
  await measure("source", async () => {
    const output = await captureCommand("docker", composeArguments(["ps", "--status", "running", "--format", "{{json .}}", "api", "runner", "web"]), composeEnvironment);
    await synchronizeDevelopmentApplications(output, {
      isLive: (service) => developmentApplicationIsLive(service, environment),
      synchronize: async (service, container) => JSON.parse(await captureCommand(
        process.execPath, [resolve(repositoryRoot, "scripts/dev-source.mjs"), service, container], composeEnvironment,
      )),
      restart: (services) => run("docker", composeArguments(["restart", "--no-deps", ...services]), composeEnvironment),
    });
  });
  const session = startComposeDevelopmentSession(
    environmentFile,
    composeEnvironment,
    new Date(performance.timeOrigin + startedAt).toISOString(),
  );
  const readinessController = new AbortController();
  try {
    await measure("watch", () => session.ready);
    await measure("readiness", () => Promise.race([
      waitForDevelopmentApplicationReadiness(environment, { signal: readinessController.signal }),
      session.completion.then(() => { throw new Error("Development watch session stopped during startup"); }),
    ]));
  } catch (error) {
    session.stop();
    await session.completion.catch(() => undefined);
    throw error;
  } finally {
    readinessController.abort();
  }

  console.log(developmentReadyMessage(environment));

  if (prepareOnly) {
    session.stop();
    await session.completion;
    console.log("Development images, database, source and runtime caches are prepared; all services are ready. Run pnpm dev to attach source watch and logs.");
    return;
  }

  console.log(`LINKSENSE_DEV_READY ${JSON.stringify({ duration_ms: Math.round(performance.now() - startedAt), stages })}`);

  console.log(
    "Source watching is active. Source changes sync into Linux containers; dependency changes rebuild only the affected development service.",
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
