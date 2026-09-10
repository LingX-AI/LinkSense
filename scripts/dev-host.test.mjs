import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHostDependencyEndpoints,
  buildHostDevelopmentEnvironment,
  hostDevelopmentCommands,
  hostPreparationCommands,
} from "./dev-host.mjs";

const dependencies = {
  DATABASE_URL: "postgresql://linksense:secret@127.0.0.1:5432/linksense",
  REDIS_URL: "redis://:secret@127.0.0.1:6379/0",
  MINIO_ENDPOINT: "127.0.0.1",
  LINKSENSE_EDITION: "core",
};

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
    ["db:migrate:deploy"],
    ["db:seed"],
  ]);
  assert.equal(
    commands.some((command) => command.args.includes("docker")),
    false,
  );
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
