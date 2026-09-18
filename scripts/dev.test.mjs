import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import {
  assertApiPortAvailable,
  assertRunnerPortAvailable,
  assertWebPortAvailable,
  buildDevelopmentComposeEnvironment,
  buildDevelopmentEnvironment,
  buildProductionParityEnvironment,
  buildWorkerRuntimeEnvironment,
  createApplicationShutdown,
  developmentApplicationStartCommands,
  developmentApplicationLogCommand,
  developmentApplicationIsLive,
  developmentComposeArguments,
  developmentDependencyFingerprint,
  developmentImageNames,
  fingerprintBuildConfiguration,
  developmentInfrastructureStartCommand,
  developmentMigrationDeployCommand,
  developmentPostgresCredentialSyncCommand,
  developmentReadinessTargets,
  developmentReadyMessage,
  developmentStorageInitializationCommand,
  developmentWorkerRebuildCommands,
  hasRunningDevelopmentApplications,
  productionComposeArguments,
  resolveComposeDatabaseUrl,
  resolvePortableUserDataRoot,
  sourceFingerprint,
  stopDevelopmentWorkers,
  synchronizeDevelopmentApplications,
  waitForDevelopmentApplicationReadiness as checkDevelopmentReadiness,
  waitForWatchEnabled,
  workerImageFingerprint,
  workerImageNeedsRebuild,
} from "./dev.mjs";

// These orchestration tests isolate both network boundaries. Actual TLS/HTTP2
// negotiation is covered in dev-http2.test.mjs; the gateway smoke covers SSE.
function waitForDevelopmentApplicationReadiness(environment, options = {}) {
  return checkDevelopmentReadiness(environment, { http2Probe: async () => {}, ...options });
}

const containerEnvironment = {
  POSTGRES_DB: "linksense",
  POSTGRES_USER: "linksense",
  POSTGRES_PASSWORD: "password",
  DATABASE_URL: "postgresql://linksense:password@postgres:5432/linksense",
  REDIS_URL: "redis://:password@redis:6379/0",
  MINIO_ENDPOINT: "minio.localhost",
};

test("development logs include this startup without replaying failures from earlier sessions", () => {
  const since = "2026-09-17T14:37:00.000Z";
  assert.deepEqual(developmentApplicationLogCommand(since), [
    "logs", "--follow", "--since", since, "api", "runner", "web", "docs", "dev-gateway",
  ]);
});

test("development ready message shows the browser URL and actual published Web port", () => {
  assert.equal(
    developmentReadyMessage(buildDevelopmentEnvironment(containerEnvironment)),
    "Web: http://localhost:18172 (port 18172)\nWeb HTTPS (HTTP/2): https://localhost:18173\nAPI port: 4000; runner controller port: 4010.",
  );
  assert.equal(
    developmentReadyMessage(buildDevelopmentEnvironment({
      ...containerEnvironment,
      LINKSENSE_DEV_WEB_ORIGIN: "http://127.0.0.1:15173",
      LINKSENSE_DEV_WEB_PORT: "19173",
    })),
    "Web: http://127.0.0.1:19173 (port 19173)\nWeb HTTPS (HTTP/2): https://127.0.0.1:18173\nAPI port: 4000; runner controller port: 4010.",
  );
});

test("development publishes HTTP 18172 and HTTPS 18173 while preserving the internal Vite port", async () => {
  const manifest = JSON.parse(await readFile(resolve("apps/web/package.json"), "utf8"));
  const compose = await readFile(resolve("docker-compose.dev.yml"), "utf8");
  const example = await readFile(resolve(".env.example"), "utf8");

  assert.match(manifest.scripts.dev, /--port 18173 --strictPort/u);
  assert.ok(compose.includes("${LINKSENSE_DEV_WEB_PORT:-18172}:18173"));
  assert.ok(compose.includes("${LINKSENSE_DEV_WEB_HTTPS_PORT:-18173}:443"));
  assert.ok(compose.includes("curl -fsS http://127.0.0.1:18173/"));
  assert.match(compose, /VITE_API_BASE_URL: ""/u);
  assert.match(example, /^LINKSENSE_DEV_WEB_ORIGIN=http:\/\/localhost:18172$/mu);
  assert.match(example, /^LINKSENSE_DEV_WEB_PORT=18172$/mu);
  assert.match(example, /^LINKSENSE_DEV_WEB_HTTPS_PORT=18173$/mu);
});

test("resolveComposeDatabaseUrl synchronizes only the bundled Postgres service", () => {
  assert.equal(
    resolveComposeDatabaseUrl({
      POSTGRES_DB: "linksense",
      POSTGRES_USER: "linksense",
      POSTGRES_PASSWORD: "new password",
      DATABASE_URL: "postgresql://stale:old@postgres:5432/stale",
    }),
    "postgresql://linksense:new%20password@postgres:5432/linksense",
  );
  assert.equal(
    resolveComposeDatabaseUrl({
      POSTGRES_DB: "linksense",
      POSTGRES_USER: "linksense",
      POSTGRES_PASSWORD: "password",
      DATABASE_URL: "postgresql://external:secret@db.example.test:5432/app",
    }),
    "postgresql://external:secret@db.example.test:5432/app",
  );
});

test("resolvePortableUserDataRoot expands portable deployment and home paths", () => {
  const deploymentRoot = resolve(tmpdir(), "linksense-deployment");
  const environment = { HOME: "/srv/linksense-home" };

  assert.equal(
    resolvePortableUserDataRoot(
      "${PWD}/.data/users",
      environment,
      deploymentRoot,
    ),
    resolve(deploymentRoot, ".data/users"),
  );
  assert.equal(
    resolvePortableUserDataRoot(
      "${HOME}/.linksense/users",
      environment,
      deploymentRoot,
    ),
    "/srv/linksense-home/.linksense/users",
  );
  assert.equal(
    resolvePortableUserDataRoot(
      "~/.linksense/users",
      environment,
      deploymentRoot,
    ),
    "/srv/linksense-home/.linksense/users",
  );
});

test("resolvePortableUserDataRoot rejects unresolved or relative paths", () => {
  assert.throws(
    () =>
      resolvePortableUserDataRoot(
        "${UNKNOWN_ROOT}/users",
        { HOME: "/srv/linksense-home" },
        "/srv/linksense",
      ),
    /unsupported environment placeholder/u,
  );
  assert.throws(
    () =>
      resolvePortableUserDataRoot(
        "relative/users",
        { HOME: "/srv/linksense-home" },
        "/srv/linksense",
      ),
    /absolute directory/u,
  );
});

test("buildDevelopmentEnvironment keeps service DNS and derives all published ports", () => {
  const result = buildDevelopmentEnvironment(containerEnvironment);

  assert.equal(result.DATABASE_URL, containerEnvironment.DATABASE_URL);
  assert.equal(result.REDIS_URL, containerEnvironment.REDIS_URL);
  assert.equal(result.MINIO_ENDPOINT, "minio.localhost");
  assert.equal(result.LINKSENSE_PUBLIC_BASE_URL, "http://localhost:18172");
  assert.equal(result.VITE_API_BASE_URL, "");
  assert.equal(result.LINKSENSE_DEV_API_BIND_ADDRESS, "127.0.0.1");
  assert.equal(result.LINKSENSE_DEV_API_PORT, "4000");
  assert.equal(result.LINKSENSE_DEV_RUNNER_BIND_ADDRESS, "127.0.0.1");
  assert.equal(result.LINKSENSE_DEV_RUNNER_PORT, "4010");
  assert.equal(result.LINKSENSE_DEV_WEB_BIND_ADDRESS, "127.0.0.1");
  assert.equal(result.LINKSENSE_DEV_WEB_PORT, "18172");
  assert.equal(result.NO_PROXY, "127.0.0.1,localhost");
  assert.equal(result.LINKSENSE_RUNNER_MODE, undefined);
});

test("buildDevelopmentEnvironment derives custom API and Web ports from local origins", () => {
  const result = buildDevelopmentEnvironment({
    ...containerEnvironment,
    LINKSENSE_DEV_API_ORIGIN: "http://127.0.0.1:14000",
    LINKSENSE_DEV_WEB_ORIGIN: "http://127.0.0.1:15173",
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS: "0.0.0.0",
    LINKSENSE_DEV_RUNNER_PORT: "14010",
    NO_PROXY: "internal.example",
  });

  assert.equal(result.VITE_API_BASE_URL, "");
  assert.equal(result.LINKSENSE_PUBLIC_BASE_URL, "http://127.0.0.1:15173");
  assert.equal(result.LINKSENSE_DEV_API_PORT, "14000");
  assert.equal(result.LINKSENSE_DEV_RUNNER_BIND_ADDRESS, "0.0.0.0");
  assert.equal(result.LINKSENSE_DEV_RUNNER_PORT, "14010");
  assert.equal(result.LINKSENSE_DEV_WEB_PORT, "15173");
  assert.equal(result.NO_PROXY, "internal.example,127.0.0.1,localhost");
});

test("development uses same-origin API requests and actual Web ports without changing production configuration", () => {
  const source = {
    ...containerEnvironment,
    LINKSENSE_PUBLIC_BASE_URL: "https://production.example.test",
    VITE_API_BASE_URL: "http://localhost:5174",
    LINKSENSE_DEV_API_ORIGIN: "http://localhost:5174",
    LINKSENSE_DEV_API_PORT: "4001",
    LINKSENSE_DEV_WEB_ORIGIN: "http://localhost:5174",
    LINKSENSE_DEV_WEB_PORT: "18172",
    LINKSENSE_USER_DATA_ROOT: "/srv/linksense/users",
  };
  const environment = buildDevelopmentEnvironment(source);
  const compose = buildDevelopmentComposeEnvironment(source, environment);

  assert.equal(environment.VITE_API_BASE_URL, "");
  assert.equal(environment.LINKSENSE_PUBLIC_BASE_URL, "http://localhost:18172");
  assert.equal(compose.VITE_API_BASE_URL, "");
  assert.equal(compose.LINKSENSE_PUBLIC_BASE_URL, "http://localhost:18172");
  assert.equal(source.VITE_API_BASE_URL, "http://localhost:5174");
  assert.equal(source.LINKSENSE_PUBLIC_BASE_URL, "https://production.example.test");
});

test("development rejects invalid explicit Web and API ports before creating browser URLs", () => {
  for (const name of ["LINKSENSE_DEV_WEB_PORT", "LINKSENSE_DEV_WEB_HTTPS_PORT", "LINKSENSE_DEV_API_PORT"]) {
    for (const port of ["0", "65536", "-1", "4001.5", "invalid"]) {
      assert.throws(() => buildDevelopmentEnvironment({
        ...containerEnvironment,
        [name]: port,
      }));
    }
  }
});

test("buildDevelopmentEnvironment rejects unsafe API origin values", () => {
  for (const apiOrigin of [
    "not-a-url",
    "ftp://localhost:4000",
    "https://localhost:4000",
    "https://user:password@localhost:4000",
    "https://localhost:4000?token=secret",
    "https://localhost:0",
  ]) {
    assert.throws(
      () =>
        buildDevelopmentEnvironment({
          ...containerEnvironment,
          LINKSENSE_DEV_API_ORIGIN: apiOrigin,
        }),
      /LINKSENSE_DEV_API_ORIGIN/u,
    );
  }
});

test("development rejects unsafe HTTP Web origins even with an explicit port", () => {
  for (const origin of ["https://localhost:18172", "ftp://localhost:18172", "http://localhost/path", "http://user:password@localhost", "http://localhost?token=x", "http://localhost/#fragment"]) {
    assert.throws(() => buildDevelopmentEnvironment({ LINKSENSE_DEV_WEB_ORIGIN: origin, LINKSENSE_DEV_WEB_PORT: "18172" }), /LINKSENSE_DEV_WEB_ORIGIN/u);
  }
});

test("readiness must verify HTTP2 after the HTTPS application checks pass", async () => {
  const environment = buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" });
  const checked = [];
  await assert.rejects(waitForDevelopmentApplicationReadiness(environment, {
    fetchImplementation: async (url) => { checked.push(url); return readinessResponse(url); },
    http2Probe: async (origin, options) => {
      assert.equal(origin, "https://127.0.0.1:18173");
      assert.equal(checked.length, developmentReadinessTargets(environment).length);
      assert.equal(options.timeoutMs, 500);
      throw new Error("HTTP/2 was not negotiated");
    },
  }), /HTTP\/2 was not negotiated/u);
});

test("both Web entries share the hostname and use independently configured ports", () => {
  const source = {
    ...containerEnvironment,
    LINKSENSE_DEV_WEB_ORIGIN: "http://dev.example.test:15173",
    LINKSENSE_DEV_WEB_PORT: "19173",
    LINKSENSE_DEV_WEB_HTTPS_PORT: "19174",
    LINKSENSE_USER_DATA_ROOT: "/srv/users",
  };
  const environment = buildDevelopmentEnvironment(source);
  const compose = buildDevelopmentComposeEnvironment(source, environment);
  assert.equal(environment.LINKSENSE_PUBLIC_BASE_URL, "http://dev.example.test:19173");
  assert.equal(environment.LINKSENSE_DEV_WEB_HTTPS_ORIGIN, "https://dev.example.test:19174");
  assert.equal(compose.LINKSENSE_DEV_WEB_PORT, "19173");
  assert.equal(compose.LINKSENSE_DEV_WEB_HTTPS_PORT, "19174");
  assert.equal(compose.LINKSENSE_DEV_TLS_DIR, resolve(".data/dev/tls"));
  assert.throws(() => buildDevelopmentEnvironment({ LINKSENSE_DEV_WEB_HTTPS_PORT: "18172" }), /must differ/u);
});

test("readiness probes bootstrap and session restoration on both browser origins", () => {
  const targets = developmentReadinessTargets(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }));
  for (const origin of ["http://127.0.0.1:18172", "https://127.0.0.1:18173"]) {
    assert.ok(targets.some((target) => target.url === `${origin}/api/v1/system/bootstrap`));
    const restore = targets.find((target) => target.url === `${origin}/api/v1/auth/refresh`);
    assert.equal(restore.method, "POST");
    assert.deepEqual(restore.headers, { origin, "sec-fetch-site": "same-origin" });
    assert.equal(restore.expectedStatus, 401);
  }
});

test("Web port checks include HTTPS and identify an occupied HTTPS port", async () => {
  const calls = [];
  const environment = buildDevelopmentEnvironment({});
  await assert.rejects(assertWebPortAvailable(environment, async (host, port) => {
    calls.push([host, port]);
    if (port === 18173) throw Object.assign(new Error("busy"), { code: "EADDRINUSE" });
  }), /Web HTTPS port 127.0.0.1:18173 is already in use/u);
  assert.deepEqual(calls, [["127.0.0.1", 18172], ["127.0.0.1", 18173]]);
});

test("buildDevelopmentComposeEnvironment applies only container development overrides", () => {
  const sourceEnvironment = {
    ...containerEnvironment,
    HOME: "/srv/linksense-home",
    DATABASE_URL: "postgresql://stale:old@postgres:5432/stale",
    LINKSENSE_USER_DATA_ROOT: "${HOME}/.linksense/users",
  };
  const developmentEnvironment = buildDevelopmentEnvironment({
    ...sourceEnvironment,
    LINKSENSE_DEV_API_ORIGIN: "http://localhost:14000",
    LINKSENSE_DEV_WEB_ORIGIN: "http://localhost:15173",
  });
  const result = buildDevelopmentComposeEnvironment(
    sourceEnvironment,
    developmentEnvironment,
  );

  assert.equal(result.DATABASE_URL, containerEnvironment.DATABASE_URL);
  assert.equal(result.REDIS_URL, containerEnvironment.REDIS_URL);
  assert.equal(result.MINIO_ENDPOINT, containerEnvironment.MINIO_ENDPOINT);
  assert.equal(
    result.DATABASE_URL,
    "postgresql://linksense:password@postgres:5432/linksense",
  );
  assert.equal(result.NODE_ENV, "development");
  assert.equal(result.LINKSENSE_PUBLIC_BASE_URL, "http://localhost:15173");
  assert.equal(result.LINKSENSE_TRUST_PROXY, "false");
  assert.equal(result.LINKSENSE_DEV_API_PORT, "14000");
  assert.equal(result.LINKSENSE_DEV_RUNNER_PORT, "4010");
  assert.equal(result.LINKSENSE_DEV_WEB_PORT, "15173");
  assert.equal(result.VITE_API_BASE_URL, "");
  assert.equal(
    result.LINKSENSE_USER_DATA_ROOT,
    "/srv/linksense-home/.linksense/users",
  );
});

test("production parity preserves HTTP or HTTPS public URLs and their gateway scheme", () => {
  assert.deepEqual(
    buildProductionParityEnvironment({
      NODE_ENV: "development",
      LINKSENSE_PUBLIC_BASE_URL: "http://localhost:8080/",
    }),
    {
      NODE_ENV: "production",
      LINKSENSE_PUBLIC_BASE_URL: "http://localhost:8080",
      LINKSENSE_EXTERNAL_SCHEME: "http",
    },
  );
  assert.deepEqual(
    buildProductionParityEnvironment({
      LINKSENSE_PUBLIC_BASE_URL: "https://linksense.example.com/base/",
    }),
    {
      NODE_ENV: "production",
      LINKSENSE_PUBLIC_BASE_URL: "https://linksense.example.com/base",
      LINKSENSE_EXTERNAL_SCHEME: "https",
    },
  );
  assert.equal(
    buildProductionParityEnvironment({
      LINKSENSE_PUBLIC_BASE_URL: "http://linksense.example.com",
    }).LINKSENSE_EXTERNAL_SCHEME,
    "http",
  );
});

test("worker image revisions are propagated into controller environments", () => {
  assert.deepEqual(
    buildWorkerRuntimeEnvironment(
      { NODE_ENV: "production" },
      " sha256:worker-image ",
    ),
    {
      NODE_ENV: "production",
      LINKSENSE_WORKER_IMAGE_REVISION: "sha256:worker-image",
    },
  );
  assert.throws(
    () => buildWorkerRuntimeEnvironment({}, " "),
    /worker image revision/u,
  );
});

test("worker images rebuild when their runtime source fingerprint is stale", () => {
  assert.equal(
    workerImageNeedsRebuild("fingerprint-current", "fingerprint-current"),
    false,
  );
  assert.equal(
    workerImageNeedsRebuild("fingerprint-old", "fingerprint-current"),
    true,
  );
  assert.equal(workerImageNeedsRebuild(undefined, "fingerprint-current"), true);
  assert.equal(
    workerImageNeedsRebuild("fingerprint-current", "fingerprint-current", true),
    true,
  );
});

test("image reuse includes effective build arguments and ignores the fingerprint label itself", () => {
  const base = { dockerfile: "Dockerfile.runner", target: "worker", args: { PNPM_VERSION: "10", WORKER_IMAGE_FINGERPRINT: "previous" } };
  const fingerprint = fingerprintBuildConfiguration("source", base);
  assert.equal(fingerprintBuildConfiguration("source", { ...base, args: { ...base.args, WORKER_IMAGE_FINGERPRINT: "next" } }), fingerprint);
  assert.notEqual(fingerprintBuildConfiguration("source", { ...base, args: { ...base.args, PNPM_VERSION: "11" } }), fingerprint);
  assert.notEqual(fingerprintBuildConfiguration("source", { ...base, target: "worker-cached-browser" }), fingerprint);
});

test("Compose argument builders keep development and production modes separate", () => {
  assert.deepEqual(
    developmentComposeArguments("/tmp/linksense.env", ["up", "-d", "api"]),
    [
      "compose",
      "--env-file",
      "/tmp/linksense.env",
      "-f",
      "docker-compose.yml",
      "-f",
      "docker-compose.dev.yml",
      "up",
      "-d",
      "api",
    ],
  );
  assert.deepEqual(
    productionComposeArguments("/tmp/linksense.env", ["up", "-d", "web"]),
    [
      "compose",
      "--env-file",
      "/tmp/linksense.env",
      "-f",
      "docker-compose.yml",
      "up",
      "-d",
      "web",
    ],
  );
});

test("running development application detection allows pnpm dev to reattach", () => {
  assert.equal(
    hasRunningDevelopmentApplications("postgres\napi\nredis\n"),
    true,
  );
  assert.equal(hasRunningDevelopmentApplications("runner\n"), true);
  assert.equal(
    hasRunningDevelopmentApplications("postgres\nredis\nminio\n"),
    false,
  );
});

test("development startup attaches source watch before waiting for health", () => {
  assert.deepEqual(developmentInfrastructureStartCommand(), [
    "up",
    "-d",
    "--wait",
    "postgres",
    "redis",
  ]);
  assert.deepEqual(developmentApplicationStartCommands(), {
    initial: [
      ["up", "-d", "--no-build", "--no-deps", "runner", "api", "web", "docs", "dev-gateway"],
    ],
  });
});

function applicationContainerOutput(health = {}) {
  return ["api", "runner", "web"].map((Service, index) => JSON.stringify({
    Service,
    ID: String(index + 1).repeat(12),
    Health: health[Service] ?? "healthy",
  })).join("\n");
}

test("reattaching restarts an unhealthy watch container even when its source is unchanged", async () => {
  const synchronized = [];
  const restarted = [];
  await synchronizeDevelopmentApplications(applicationContainerOutput({ api: "unhealthy" }), {
    isLive: async () => true,
    synchronize: async (service, id) => {
      synchronized.push([service, id]);
      return { changed: false };
    },
    restart: async (services) => { restarted.push(services); },
  });
  assert.equal(synchronized.length, 3);
  assert.deepEqual(restarted, [["api"]]);
});

test("source sync restarts changed and unhealthy services once, after all transfers finish", async () => {
  const synchronized = [];
  const restarted = [];
  await synchronizeDevelopmentApplications(applicationContainerOutput({ api: "unhealthy", runner: "unhealthy" }), {
    isLive: async () => true,
    synchronize: async (service) => {
      synchronized.push(service);
      return { changed: service !== "runner" };
    },
    restart: async (services) => {
      assert.equal(synchronized.length, 3);
      restarted.push(services);
    },
  });
  assert.deepEqual(restarted, [["api", "runner", "web"]]);
});

test("reattaching leaves healthy and starting services with unchanged source running", async () => {
  await synchronizeDevelopmentApplications(applicationContainerOutput({ runner: "starting", web: "" }), {
    isLive: async () => true,
    synchronize: async () => ({ changed: false }),
    restart: async () => { assert.fail("no service needs a restart"); },
  });
});

test("source synchronization rejects missing containers before modifying the running stack", async () => {
  await assert.rejects(synchronizeDevelopmentApplications(applicationContainerOutput().split("\n").slice(1).join("\n"), {
    synchronize: async () => { assert.fail("incomplete stack"); },
    restart: async () => { assert.fail("incomplete stack"); },
  }), /Development application containers did not start/u);
});

test("source synchronization failure does not restart partially synchronized applications", async () => {
  await assert.rejects(synchronizeDevelopmentApplications(applicationContainerOutput({ api: "unhealthy" }), {
    synchronize: async () => { throw new Error("rsync failed"); },
    restart: async () => { assert.fail("source sync failed"); },
  }), /rsync failed/u);
});

test("reattaching probes a stale healthy container and restarts its exited application", async () => {
  const restarted = [];
  await synchronizeDevelopmentApplications(applicationContainerOutput(), {
    isLive: async (service) => service !== "api",
    synchronize: async () => ({ changed: false }),
    restart: async (services) => { restarted.push(services); },
  });
  assert.deepEqual(restarted, [["api"]]);
});

test("application liveness checks the process rather than dependency readiness", async () => {
  const requests = [];
  const environment = buildDevelopmentEnvironment(containerEnvironment);
  for (const service of ["api", "runner", "web"]) {
    assert.equal(await developmentApplicationIsLive(service, environment, async (url, options) => {
      requests.push(url);
      assert.ok(options.signal instanceof AbortSignal);
      return new Response("ok");
    }), true);
  }
  assert.deepEqual(requests, ["http://127.0.0.1:4000/api/v1/system/health/live", "http://127.0.0.1:4010/health/live", "http://127.0.0.1:18172/"]);
  assert.equal(await developmentApplicationIsLive("api", environment, async () => { throw new Error("refused"); }), false);
  assert.equal(await developmentApplicationIsLive("api", environment, async () => new Response("unavailable", { status: 503 })), false);
});

test("development startup synchronizes persisted Postgres credentials without embedding secrets", () => {
  const command = developmentPostgresCredentialSyncCommand();

  assert.deepEqual(command.slice(0, 5), [
    "exec",
    "-T",
    "postgres",
    "sh",
    "-ec",
  ]);
  assert.match(command[5], /ALTER ROLE %I WITH PASSWORD %L/u);
  assert.match(command[5], /\$POSTGRES_USER/u);
  assert.match(command[5], /\$POSTGRES_PASSWORD/u);
  assert.doesNotMatch(command[5], /dev-postgres-password-change-me/u);
});

function readinessResponse(url, status = 200) {
  if (url.endsWith("/auth/refresh")) return Response.json({ error_code: "AUTH_SESSION_EXPIRED" }, { status: status === 200 ? 401 : status });
  if (url.endsWith("/system/bootstrap")) return Response.json({ success: true }, { status });
  if (url.includes(".tsx")) return new Response("export default {}", { status, headers: { "content-type": "text/javascript" } });
  if (url.includes(".css")) return new Response(":root {}", { status, headers: { "content-type": "text/css" } });
  return new Response(`<html lang="${url.includes("/en-US/") ? "en-US" : "zh-CN"}"></html>`, { status });
}

test("readiness gates API proxy probes on current upstream health during startup and restarts", async () => {
  const environment = buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" });
  let round = 1;
  const proxyRounds = [];
  const moduleRounds = [];

  await waitForDevelopmentApplicationReadiness(environment, {
    timeoutMs: 1_000,
    sleepImplementation: async () => { round += 1; },
    fetchImplementation: async (url) => {
      if (url.includes(":4000/")) {
        // Health is asynchronous; invoking the probe is not evidence of readiness.
        await Promise.resolve();
        if (round === 1 || round === 4) throw new Error("connect ECONNREFUSED");
        return readinessResponse(url, round === 2 ? 503 : 200);
      }
      if (url.includes(":18172/api/")) {
        proxyRounds.push(round);
        return readinessResponse(url, round === 3 ? 503 : 200);
      }
      if (url.endsWith("/src/main.tsx")) moduleRounds.push(round);
      return readinessResponse(url);
    },
  });

  assert.deepEqual(proxyRounds, [3, 3, 5, 5]);
  assert.deepEqual(moduleRounds, [1, 2, 3, 4, 5]);
});

test("readiness reports an unavailable API without sending requests through its Web proxy", async (context) => {
  context.mock.timers.enable({ apis: ["Date"] });
  const proxyRequests = [];

  await assert.rejects(waitForDevelopmentApplicationReadiness(
    buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }),
    {
      timeoutMs: 100,
      intervalMs: 25,
      sleepImplementation: async (milliseconds) => { context.mock.timers.tick(milliseconds); },
      fetchImplementation: async (url) => {
        if (url.includes(":4000/")) throw new Error("connect ECONNREFUSED");
        if (url.includes(":18172/api/")) proxyRequests.push(url);
        return readinessResponse(url);
      },
    },
  ), /API .*connect ECONNREFUSED/u);

  assert.deepEqual(proxyRequests, []);
});

test("development reattach readiness tolerates transient unhealthy services", async () => {
  const environment = buildDevelopmentEnvironment({
    ...containerEnvironment,
    LINKSENSE_RUNNER_SHARED_SECRET: "runner-secret",
    LINKSENSE_DEV_API_BIND_ADDRESS: "0.0.0.0",
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS: "0.0.0.0",
  });
  const calls = [];
  const attempts = new Map();

  await waitForDevelopmentApplicationReadiness(environment, {
    timeoutMs: 1_000,
    intervalMs: 1,
    requestTimeoutMs: 10,
    sleepImplementation: async () => undefined,
    fetchImplementation: async (url, options) => {
      calls.push({ url, headers: options.headers });
      const nextAttempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, nextAttempt);
      return readinessResponse(url, nextAttempt >= 2 ? 200 : 503);
    },
  });

  const targets = developmentReadinessTargets(environment);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      ...targets.filter((target) => !target.upstream).map((target) => target.url),
      ...targets.filter((target) => !target.upstream).map((target) => target.url),
      ...targets.filter((target) => target.upstream).map((target) => target.url),
      ...targets.filter((target) => !target.upstream).map((target) => target.url),
      ...targets.filter((target) => target.upstream).map((target) => target.url),
    ],
  );
  assert.equal(targets[0].url, "http://127.0.0.1:4010/health/ready");
  assert.equal(targets[2].url, "http://127.0.0.1:18172/");
  assert.equal(targets.length, 13);
  assert.equal(targets[3].url, "http://127.0.0.1:18172/help/");
  assert.equal(targets[4].url, "http://127.0.0.1:18172/help/en-US/");
  assert.deepEqual(calls[0].headers, {
    authorization: "Bearer runner-secret",
  });
});

test("readiness waits for prerequisites before probing application routes", async () => {
  const environment = buildDevelopmentEnvironment({
    ...containerEnvironment,
    LINKSENSE_RUNNER_SHARED_SECRET: "runner-secret",
  });
  const prerequisiteUrl = "http://127.0.0.1:3001/help/";
  const calls = [];
  let prerequisiteAttempts = 0;

  await waitForDevelopmentApplicationReadiness(environment, {
    timeoutMs: 1_000,
    intervalMs: 1,
    requestTimeoutMs: 10,
    prerequisiteTargets: [
      {
        name: "Help Center upstream",
        url: prerequisiteUrl,
        headers: {},
        bodyIncludes: 'lang="zh-CN"',
      },
    ],
    sleepImplementation: async () => undefined,
    fetchImplementation: async (url) => {
      calls.push(url);
      if (url === prerequisiteUrl) {
        prerequisiteAttempts += 1;
        return readinessResponse(url, prerequisiteAttempts >= 2 ? 200 : 503);
      }
      return readinessResponse(url);
    },
  });

  assert.deepEqual(calls.slice(0, 2), [prerequisiteUrl, prerequisiteUrl]);
  assert.deepEqual(
    calls.slice(2),
    [
      ...developmentReadinessTargets(environment).filter((target) => !target.upstream),
      ...developmentReadinessTargets(environment).filter((target) => target.upstream),
    ].map((target) => target.url),
  );
});

test("readiness rejects a Web proxy that forbids same-origin session restoration", async () => {
  const requests = [];
  await assert.rejects(waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }), {
    timeoutMs: 25,
    intervalMs: 1,
    fetchImplementation: async (url, options) => {
      if (url.endsWith("/auth/refresh")) {
        requests.push({ url, method: options.method, headers: options.headers });
        return Response.json({ error_code: "AUTH_CROSS_ORIGIN_REQUEST_FORBIDDEN" }, { status: 403 });
      }
      return readinessResponse(url);
    },
  }), /Web session restore.*HTTP 403/u);
  assert.ok(requests.length > 0);
  assert.deepEqual(requests[0], {
    url: "http://127.0.0.1:18172/api/v1/auth/refresh",
    method: "POST",
    headers: { origin: "http://127.0.0.1:18172", "sec-fetch-site": "same-origin" },
  });
});

test("development reattach applies pending migrations without reseeding", () => {
  assert.deepEqual(developmentMigrationDeployCommand(), [
    "run",
    "--rm",
    "migrate",
    "pnpm",
    "db:migrate:deploy",
  ]);
});

test("readiness rejects an application fallback page in place of the English Help Center", async () => {
  await assert.rejects(waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }), {
    timeoutMs: 25,
    intervalMs: 1,
    fetchImplementation: async () => new Response('<html lang="zh-CN"></html>'),
  }), /Help Center \(en-US\).*Unexpected page content/u);
});

test("readiness rejects HTML fallbacks for uncompiled application modules", async () => {
  await assert.rejects(waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }), {
    timeoutMs: 25,
    intervalMs: 1,
    fetchImplementation: async (url) => url.includes(".tsx")
      ? new Response("<html></html>", { headers: { "content-type": "text/html" } })
      : readinessResponse(url),
  }), /Web entry module.*Unexpected content type/u);
});

test("readiness rechecks previously healthy services until every service passes together", async () => {
  const attempts = new Map();
  await waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }), {
    timeoutMs: 1_000,
    intervalMs: 1,
    fetchImplementation: async (url) => {
      const attempt = (attempts.get(url) ?? 0) + 1;
      attempts.set(url, attempt);
      const unhealthy = url.includes(":4010/") ? attempt === 2 : attempt === 1;
      return readinessResponse(url, unhealthy ? 503 : 200);
    },
  });
  // The first round cannot reach API proxy routes while the API is unhealthy.
  assert.deepEqual([...attempts.values()], [...Array(9).fill(3), 2, 2, 2, 2]);
});

test("readiness cancellation aborts active probes without another retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  const ready = waitForDevelopmentApplicationReadiness(buildDevelopmentEnvironment({ LINKSENSE_RUNNER_SHARED_SECRET: "test" }), {
    signal: controller.signal,
    fetchImplementation: async (_url, { signal }) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  });
  controller.abort(new Error("watch stopped"));
  await assert.rejects(ready, /watch stopped/u);
  assert.equal(calls, 9);
});

test("watch startup waits for initial synchronization and rejects early exit or timeout", async () => {
  const makeChild = () => Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const child = makeChild();
  let ready = false;
  const pending = waitForWatchEnabled(child, 500).then(() => { ready = true; });
  child.stdout.write("Syncing source files\nWat");
  await Promise.resolve();
  assert.equal(ready, false);
  child.stdout.write("ch enabled\n");
  await pending;
  assert.equal(ready, true);
  assert.equal(child.stdout.listenerCount("data"), 0);
  const exited = makeChild();
  const rejected = waitForWatchEnabled(exited, 500);
  exited.emit("exit", 1);
  await assert.rejects(rejected, /exited before/u);
  await assert.rejects(waitForWatchEnabled(makeChild(), 5), /did not become ready/u);
});

test("development startup prepares the host-backed user data root", () => {
  assert.deepEqual(developmentStorageInitializationCommand(), [
    "run",
    "--rm",
    "storage-init",
  ]);
});

test("worker rebuild refreshes both runner images before replacing a running controller", () => {
  assert.deepEqual(developmentWorkerRebuildCommands(true), {
    refreshImages: ["build", "runner", "runner-worker-image"],
    replaceController: [
      "up",
      "-d",
      "--no-build",
      "--no-deps",
      "--wait",
      "runner",
    ],
  });
});

test("worker rebuild still refreshes both runner images when no controller is running", () => {
  assert.deepEqual(developmentWorkerRebuildCommands(false), {
    refreshImages: ["build", "runner", "runner-worker-image"],
    replaceController: null,
  });
});

test("development Compose runs Web, API, and runner from source-aware images", async () => {
  const compose = await readFile(resolve("docker-compose.dev.yml"), "utf8");
  const webCompose = compose.slice(compose.indexOf("  web:"));

  assert.match(compose, /^  api:\n    image:/mu);
  assert.match(compose, /^  runner:\n    image:/mu);
  assert.match(compose, /^  web:\n    image:/mu);
  assert.match(compose, /dockerfile: Dockerfile\.dev/u);
  assert.match(compose, /action: sync/u);
  assert.match(compose, /action: rebuild/u);
  assert.match(
    webCompose,
    /action: sync\+restart\n\s+path: \.\/packages\/shared\/src/u,
  );
  assert.match(
    compose,
    /LINKSENSE_DEV_API_BIND_ADDRESS:-127\.0\.0\.1.*LINKSENSE_DEV_API_PORT:-4000/u,
  );
  assert.match(
    compose,
    /LINKSENSE_DEV_RUNNER_BIND_ADDRESS:-127\.0\.0\.1.*LINKSENSE_DEV_RUNNER_PORT:-4010/u,
  );
  assert.match(
    compose,
    /LINKSENSE_DEV_WEB_BIND_ADDRESS:-127\.0\.0\.1.*LINKSENSE_DEV_WEB_PORT:-18172/u,
  );
  assert.match(compose, /LINKSENSE_REMOVE_WORKERS_ON_SHUTDOWN: "false"/u);
  assert.match(compose, /LINKSENSE_ENABLE_DEVELOPMENT_ENDPOINTS: "true"/u);
  assert.match(compose, /ports: !override/u);
});

test("development prepares only the host-backed user data root", async () => {
  const [baseCompose, developmentCompose, developmentScript] =
    await Promise.all([
      readFile(resolve("docker-compose.yml"), "utf8"),
      readFile(resolve("docker-compose.dev.yml"), "utf8"),
      readFile(resolve("scripts/dev.mjs"), "utf8"),
    ]);

  const portableUserDataRootExpression =
    "${LINKSENSE_USER_DATA_ROOT:-${PWD}/.data/users}";
  assert.ok(
    baseCompose.includes(
      `LINKSENSE_USER_DATA_ROOT: "${portableUserDataRootExpression}"`,
    ),
  );
  assert.ok(
    baseCompose.includes(
      `- "${portableUserDataRootExpression}:${portableUserDataRootExpression}"`,
    ),
  );
  assert.doesNotMatch(developmentCompose, /legacy-capabilities-import/u);
  assert.doesNotMatch(developmentScript, /legacy-capabilities-import/u);
  assert.doesNotMatch(developmentScript, /\.data\/dev\/capabilities/u);
});

test("development fingerprints are deterministic and include dependency changes", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "linksense-dev-fingerprint-"));
  try {
    await mkdir(resolve(root, "nested"));
    await writeFile(resolve(root, "manifest.json"), "one\n");
    await writeFile(resolve(root, "nested/lock.yaml"), "locked\n");
    const first = sourceFingerprint(root, ["nested", "manifest.json"]);
    assert.equal(first, sourceFingerprint(root, ["manifest.json", "nested"]));
    await writeFile(resolve(root, "manifest.json"), "two\n");
    assert.notEqual(
      first,
      sourceFingerprint(root, ["nested", "manifest.json"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  assert.match(developmentDependencyFingerprint(), /^[0-9a-f]{64}$/u);
  assert.match(workerImageFingerprint(), /^[0-9a-f]{64}$/u);
  assert.deepEqual(developmentImageNames({}), [
    "linksense-api-dev:local",
    "linksense-runner-controller-dev:local",
    "linksense-web-dev:local",
  ]);
});

test("changing the repository Codex pin rebuilds the development worker", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "linksense-codex-fingerprint-"));
  try {
    // Use real build inputs; only the repository pin changes between checks.
    for (const input of [
      ".dockerignore", "Dockerfile.runner", "LICENSE", "package.json",
      "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "patches",
      "apps/api/package.json", "apps/docs/package.json", "apps/web/package.json",
      "apps/runner/package.json", "apps/runner/src", "apps/runner/tsconfig.json",
      "apps/runner/tsconfig.build.json", "packages/shared/package.json",
      "packages/shared/src", "packages/shared/tsconfig.json", "deploy/codex-home-template",
      "deploy/codex-system", "deploy/docker/configure-debian-apt.sh",
      "deploy/docker/runner-runtime-smoke.mjs", "deploy/runtime/browser",
      "deploy/runtime/fonts", "deploy/runtime/node", "deploy/runtime/python", "deploy/runtime/shell",
    ]) {
      await cp(resolve(input), resolve(root, input), {
        recursive: true,
        filter: (source) => !source.split(/[\\/]/u).some((part) => ["node_modules", ".venv", "__pycache__"].includes(part)),
      });
    }
    const directory = resolve(root, "apps/runner/src/codex");
    await mkdir(directory, { recursive: true });
    const versionPath = resolve(directory, "runtime-version.json");
    await writeFile(versionPath, JSON.stringify({ version: "0.154.0" }));
    const previous = workerImageFingerprint(root);
    assert.equal(workerImageNeedsRebuild(previous, workerImageFingerprint(root)), false);

    await writeFile(versionPath, JSON.stringify({ version: "0.155.0" }));
    assert.equal(workerImageNeedsRebuild(previous, workerImageFingerprint(root)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("development worker cleanup uses the authenticated controller endpoint", async () => {
  const environment = {
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS: "0.0.0.0",
    LINKSENSE_DEV_RUNNER_PORT: "4010",
    LINKSENSE_RUNNER_SHARED_SECRET: "runner-111111111111111111111111111111",
  };
  const calls = [];
  const stopped = await stopDevelopmentWorkers(
    environment,
    async (url, init) => {
      calls.push({ url, init });
      return new Response(null, { status: 204 });
    },
  );
  assert.equal(stopped, "stopped");
  assert.equal(
    calls[0].url,
    "http://127.0.0.1:4010/development/workers/stop-all",
  );
  assert.equal(
    new Headers(calls[0].init.headers).get("authorization"),
    `Bearer ${environment.LINKSENSE_RUNNER_SHARED_SECRET}`,
  );
  assert.equal(
    await stopDevelopmentWorkers(
      environment,
      async () => new Response(null, { status: 404 }),
    ),
    "legacy",
  );
  assert.equal(
    await stopDevelopmentWorkers(environment, async () => {
      throw new Error("offline");
    }),
    "unavailable",
  );
});

test("createApplicationShutdown skips exited children, ignores ESRCH, and is idempotent", () => {
  const calls = [];
  const children = [
    childFixture(101),
    childFixture(102),
    childFixture(103, { exitCode: 0 }),
  ];
  const shutdown = createApplicationShutdown(children, {
    detached: true,
    killProcess: (pid, signal) => {
      calls.push({ pid, signal });
      if (pid === -101) {
        throw Object.assign(new Error("process group disappeared"), {
          code: "ESRCH",
        });
      }
    },
  });

  shutdown("SIGTERM");
  shutdown("SIGINT");

  assert.deepEqual(calls, [
    { pid: -101, signal: "SIGTERM" },
    { pid: -102, signal: "SIGTERM" },
  ]);
});

function childFixture(pid, overrides = {}) {
  return {
    child: {
      pid,
      killed: false,
      exitCode: null,
      signalCode: null,
      kill: () => undefined,
      ...overrides,
    },
  };
}

test("published port checks identify the conflicting container service", async () => {
  const environment = {
    LINKSENSE_DEV_API_BIND_ADDRESS: "127.0.0.1",
    LINKSENSE_DEV_API_PORT: "4000",
    LINKSENSE_DEV_RUNNER_BIND_ADDRESS: "127.0.0.1",
    LINKSENSE_DEV_RUNNER_PORT: "4010",
    LINKSENSE_DEV_WEB_BIND_ADDRESS: "127.0.0.1",
    LINKSENSE_DEV_WEB_PORT: "18172",
  };
  const occupied = async () => {
    throw Object.assign(new Error("occupied"), { code: "EADDRINUSE" });
  };

  await assert.rejects(
    assertApiPortAvailable(environment, occupied),
    /API port 127\.0\.0\.1:4000 is already in use/u,
  );
  await assert.rejects(
    assertRunnerPortAvailable(environment, occupied),
    /Runner port 127\.0\.0\.1:4010 is already in use/u,
  );
  await assert.rejects(
    assertWebPortAvailable(environment, occupied),
    /Web port 127\.0\.0\.1:18172 is already in use/u,
  );

  const calls = [];
  for (const assertion of [
    assertApiPortAvailable,
    assertRunnerPortAvailable,
    assertWebPortAvailable,
  ]) {
    await assertion(environment, async (host, port) => {
      calls.push({ host, port });
    });
  }
  assert.deepEqual(calls, [
    { host: "127.0.0.1", port: 4000 },
    { host: "127.0.0.1", port: 4010 },
    { host: "127.0.0.1", port: 18172 },
  ]);
});
