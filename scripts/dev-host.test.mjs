import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseEnv } from "node:util";

import {
  assertHostDependencyEndpoints,
  buildHostDevelopmentEnvironment,
  hostDevelopmentCommands,
  hostPreparationCommands,
  waitForHostDevelopmentApplicationReadiness,
} from "./dev-host.mjs";

const dependencies = {
  DATABASE_URL: "postgresql://linksense:secret@127.0.0.1:5432/linksense",
  REDIS_URL: "redis://:secret@127.0.0.1:6379/0",
  MINIO_ENDPOINT: "127.0.0.1",
  LINKSENSE_EDITION: "core",
  LINKSENSE_RUNNER_SHARED_SECRET: "runner-secret",
};

function readinessResponse(url, status = 200) {
  if (url.endsWith("/auth/refresh")) {
    return Response.json(
      { error_code: "AUTH_SESSION_EXPIRED" },
      { status: status === 200 ? 401 : status },
    );
  }
  if (url.endsWith("/system/bootstrap")) {
    return Response.json({ success: true }, { status });
  }
  if (url.includes(".tsx")) {
    return new Response("export default {}", {
      status,
      headers: { "content-type": "text/javascript" },
    });
  }
  if (url.includes(".css")) {
    return new Response(":root {}", {
      status,
      headers: { "content-type": "text/css" },
    });
  }
  return new Response(
    `<html lang="${url.includes("/en-US/") ? "en-US" : "zh-CN"}"></html>`,
    { status },
  );
}

test("host development exposes cleanup as a recovery command", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    packageJson.scripts["dev:host"],
    "LINKSENSE_ENV_FILE=.env.host node scripts/dev-host.mjs",
  );
  assert.equal(
    packageJson.scripts["dev:host:cleanup"],
    "node scripts/dev-host.mjs --cleanup",
  );
  assert.equal(packageJson.scripts["dev:host:stop"], undefined);
});

test("the tracked host template is a valid minimal Core configuration", async () => {
  const template = parseEnv(
    await readFile(
      new URL("../deploy/development/env.host.example", import.meta.url),
      "utf8",
    ),
  );
  const environment = buildHostDevelopmentEnvironment(template);

  assert.doesNotThrow(() => assertHostDependencyEndpoints(environment));
  assert.equal(environment.LINKSENSE_EDITION, "core");
  assert.equal(
    environment.LINKSENSE_OBJECT_STORAGE_PROVIDER,
    "local-filesystem",
  );
  assert.equal(environment.MINIO_ENDPOINT, undefined);
  assert.equal(environment.LINKSENSE_KB_ELASTICSEARCH_URL, undefined);
  assert.equal(environment.DOCLING_SERVE_URL, undefined);
  const secrets = [
    environment.LINKSENSE_JWT_SECRET,
    environment.LINKSENSE_LOGIN_RATE_LIMIT_HMAC_SECRET,
    environment.LINKSENSE_PASSWORD_RESET_RATE_LIMIT_HMAC_SECRET,
    environment.LINKSENSE_CREDENTIAL_MASTER_KEY,
    environment.LINKSENSE_RUNNER_SHARED_SECRET,
  ];
  assert.equal(new Set(secrets).size, secrets.length);
  assert.ok(secrets.every((secret) => secret.length >= 32));
});

test("host development selects the non-isolated provider and preserves the configured Web port", () => {
  const environment = buildHostDevelopmentEnvironment(
    {
      ...dependencies,
      LINKSENSE_DEV_WEB_ORIGIN: "http://localhost:5273",
      LINKSENSE_DEV_WEB_PORT: "5273",
      LINKSENSE_DEV_API_PORT: "4100",
      LINKSENSE_DEV_RUNNER_PORT: "4110",
      LINKSENSE_USER_DATA_ROOT: "${PWD}/.data/host-users",
    },
    "/tmp/linksense",
  );

  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.LINKSENSE_WORKER_PROVIDER, "local-process");
  assert.equal(environment.LINKSENSE_RUNNER_MODE, "controller");
  assert.equal(environment.LINKSENSE_RUNNER_HOST, "127.0.0.1");
  assert.equal(environment.LINKSENSE_RUNNER_URL, "http://127.0.0.1:4110");
  assert.equal(environment.LINKSENSE_API_INTERNAL_URL, "http://127.0.0.1:4100");
  assert.equal(environment.LINKSENSE_DEV_WEB_PORT, "5273");
  assert.equal(
    environment.LINKSENSE_USER_DATA_ROOT,
    "/tmp/linksense/.data/host-users",
  );
  assert.equal(environment.LINKSENSE_USER_DATA_VOLUME, undefined);
});

test("host development sends browser API requests through the same-origin Vite proxy", () => {
  const environment = buildHostDevelopmentEnvironment({
    ...dependencies,
    LINKSENSE_DEV_API_PORT: "4100",
  });

  assert.equal(environment.VITE_API_BASE_URL, "");
  assert.equal(
    environment.LINKSENSE_DEV_API_PROXY_TARGET,
    "http://127.0.0.1:4100",
  );
});

test("host development starts every application with pnpm and passes the dynamic Web port", () => {
  const environment = buildHostDevelopmentEnvironment({
    ...dependencies,
    LINKSENSE_DEV_WEB_PORT: "5273",
  });
  const commands = hostDevelopmentCommands(environment);

  assert.deepEqual(
    commands.map((command) => command.workspace),
    ["@linksense/runner", "@linksense/api", "@linksense/docs", "@linksense/web"],
  );
  assert.deepEqual(commands.at(-1)?.args, [
    "--filter",
    "@linksense/web",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    "5273",
    "--strictPort",
  ]);
  assert.deepEqual(hostPreparationCommands(), [
    ["db:generate"],
    ["db:migrate:deploy"],
    ["db:seed"],
  ]);
  assert.equal(
    commands.some((command) => command.args.includes("docker")),
    false,
  );
});

test("host readiness waits for Docs before probing the Vite Help Center proxy", async () => {
  const environment = buildHostDevelopmentEnvironment({
    ...dependencies,
    LINKSENSE_DEV_WEB_PORT: "5273",
  });
  const docsUrl = "http://127.0.0.1:3001/help/";
  const proxyUrl = "http://127.0.0.1:5273/help/";
  const calls = [];
  let docsAttempts = 0;

  await waitForHostDevelopmentApplicationReadiness(environment, {
    timeoutMs: 1_000,
    intervalMs: 1,
    requestTimeoutMs: 10,
    sleepImplementation: async () => undefined,
    fetchImplementation: async (url) => {
      calls.push(url);
      if (url === docsUrl) {
        docsAttempts += 1;
        return readinessResponse(url, docsAttempts >= 2 ? 200 : 503);
      }
      return readinessResponse(url);
    },
  });

  assert.deepEqual(calls.slice(0, 2), [docsUrl, docsUrl]);
  assert.ok(calls.indexOf(proxyUrl) > 1);
});

test("host development rejects container-only dependency addresses instead of falling back", () => {
  for (const [name, value] of [
    ["DATABASE_URL", "postgresql://linksense:secret@postgres:5432/linksense"],
    ["REDIS_URL", "redis://:secret@redis:6379/0"],
    ["MINIO_ENDPOINT", "host.docker.internal"],
  ]) {
    assert.throws(
      () =>
        assertHostDependencyEndpoints({
          ...dependencies,
          [name]: value,
        }),
      new RegExp(`${name} uses the container-only host`, "u"),
    );
  }
});

test("host development accepts remote PostgreSQL, Redis, and MinIO services", () => {
  assert.doesNotThrow(() =>
    assertHostDependencyEndpoints({
      DATABASE_URL:
        "postgresql://linksense:secret@db.internal.example:5432/linksense",
      REDIS_URL: "rediss://:secret@redis.internal.example:6380/0",
      MINIO_ENDPOINT: "objects.internal.example",
      LINKSENSE_EDITION: "core",
    }),
  );
});

test("host development does not require MinIO for local filesystem storage", () => {
  assert.doesNotThrow(() =>
    assertHostDependencyEndpoints({
      DATABASE_URL: dependencies.DATABASE_URL,
      REDIS_URL: dependencies.REDIS_URL,
      LINKSENSE_OBJECT_STORAGE_PROVIDER: "local-filesystem",
      LINKSENSE_EDITION: "core",
    }),
  );
});

test("host development validates full-edition dependencies when the edition is omitted", () => {
  assert.throws(
    () =>
      assertHostDependencyEndpoints({
        DATABASE_URL: dependencies.DATABASE_URL,
        REDIS_URL: dependencies.REDIS_URL,
        MINIO_ENDPOINT: dependencies.MINIO_ENDPOINT,
        LINKSENSE_KB_ELASTICSEARCH_URL: "http://host.docker.internal:9200",
        DOCLING_SERVE_URL: "http://127.0.0.1:5001",
      }),
    /LINKSENSE_KB_ELASTICSEARCH_URL uses the container-only host/u,
  );
});
