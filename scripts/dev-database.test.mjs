import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { developmentDatabaseConnection, inspectDevelopmentDatabase, inspectMigrationHistory, prepareDevelopmentDatabase } from "./dev-database.mjs";

const checksum = "a".repeat(64);
const manifest = [{ name: "initial", checksum }];
const row = { migration_name: "initial", checksum, applied: true, rolled_back: false };

test("unchanged database skips migration, seed and credential writes", async () => {
  const calls = [];
  await prepareDevelopmentDatabase({
    inspect: async () => { calls.push("inspect"); return { pending: [], seeded: true }; },
    deploy: async () => calls.push("deploy"),
    seed: async () => calls.push("seed"),
    synchronizeCredentials: async () => calls.push("credentials"),
    bundled: true,
  });
  assert.deepEqual(calls, ["inspect"]);
});

test("new or restored database runs migration and seed and verifies both results", async () => {
  const calls = [];
  const states = [{ pending: ["initial"], seeded: false }, { pending: [], seeded: false }, { pending: [], seeded: true }];
  await prepareDevelopmentDatabase({
    inspect: async () => { calls.push("inspect"); return states.shift(); },
    deploy: async () => calls.push("deploy"),
    seed: async () => calls.push("seed"),
  });
  assert.deepEqual(calls, ["inspect", "deploy", "inspect", "seed", "inspect"]);
});

test("checksum differences without a validated history cache retain Prisma's native deployment check", async () => {
  let deployments = 0;
  for (let index = 0; index < 2; index++) {
    await prepareDevelopmentDatabase({
      inspect: async () => ({ pending: [], seeded: true, historyMatches: false }),
      deploy: async () => { deployments++; },
      warn: () => {},
    });
  }
  assert.equal(deployments, 2);
});

test("cached Prisma validation is reused only for identical live history and invalidates on change or corruption", async () => {
  const root = mkdtempSync(join(tmpdir(), "linksense-migration-validation-"));
  const validationPath = join(root, "validation.json");
  let fingerprint = "a".repeat(64);
  let inspections = 0;
  let deployments = 0;
  let warnings = 0;
  const prepare = () => prepareDevelopmentDatabase({
    inspect: async () => { inspections++; return { pending: [], seeded: true, historyMatches: false, validationFingerprint: fingerprint }; },
    deploy: async () => { deployments++; },
    validationPath,
    warn: () => { warnings++; },
  });
  try {
    await prepare();
    await prepare();
    assert.equal(deployments, 1);
    assert.equal(inspections, 3);
    assert.equal(warnings, 2);
    fingerprint = "b".repeat(64);
    await prepare();
    assert.equal(deployments, 2);
    writeFileSync(validationPath, "invalid JSON");
    await prepare();
    assert.equal(deployments, 3);
    assert.deepEqual(JSON.parse(readFileSync(validationPath, "utf8")), { fingerprint });
    fingerprint = "c".repeat(64);
    await assert.rejects(prepareDevelopmentDatabase({
      inspect: async () => ({ pending: [], seeded: true, historyMatches: false, validationFingerprint: fingerprint }),
      deploy: async () => { throw new Error("validation failed"); },
      validationPath,
    }), /validation failed/u);
    assert.equal(JSON.parse(readFileSync(validationPath, "utf8")).fingerprint, "b".repeat(64));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed migration cannot continue to seed or report readiness", async () => {
  let seeded = false;
  await assert.rejects(prepareDevelopmentDatabase({
    inspect: async () => ({ pending: ["initial"], seeded: false }),
    deploy: async () => { throw new Error("migration failed"); },
    seed: async () => { seeded = true; },
  }), /migration failed/u);
  assert.equal(seeded, false);
  await assert.rejects(prepareDevelopmentDatabase({
    inspect: async () => ({ pending: ["initial"], seeded: false }),
    deploy: async () => undefined,
  }), /still pending/u);
});

test("credentials are repaired only for an authentication failure on bundled Postgres", async () => {
  for (const bundled of [true, false]) {
    let repaired = 0;
    let attempts = 0;
    const action = prepareDevelopmentDatabase({
      bundled,
      inspect: async () => {
        if (attempts++ === 0) throw Object.assign(new Error("authentication failed"), { code: "28P01" });
        return { pending: [], seeded: true };
      },
      synchronizeCredentials: async () => { repaired++; },
    });
    if (bundled) await action;
    else await assert.rejects(action, /authentication failed/u);
    assert.equal(repaired, bundled ? 1 : 0);
  }
});

test("migration history detects pending, rolled back, modified, missing and unfinished entries", () => {
  assert.deepEqual(inspectMigrationHistory(manifest, [row]), { pending: [], historyMatches: true });
  assert.deepEqual(inspectMigrationHistory(manifest, []).pending, ["initial"]);
  assert.deepEqual(inspectMigrationHistory(manifest, [{ ...row, rolled_back: true }]).pending, ["initial"]);
  assert.throws(() => inspectMigrationHistory(manifest, [{ ...row, applied: false }]), /Unfinished/u);
  assert.deepEqual(inspectMigrationHistory(manifest, [{ ...row, checksum: "b".repeat(64) }]), { pending: [], historyMatches: false });
  assert.throws(() => inspectMigrationHistory([], [row]), /missing from/u);
  assert.throws(() => inspectMigrationHistory(manifest, [row, row]), /Duplicate/u);
  assert.throws(() => inspectMigrationHistory(manifest, [{ ...row, applied: "true" }]));
});

test("database probing respects custom published ports and external database connections", () => {
  assert.deepEqual(developmentDatabaseConnection({ DATABASE_URL: "postgresql://user:password@postgres:5432/app?schema=tenant", POSTGRES_BIND_ADDRESS: "0.0.0.0", POSTGRES_PORT: "15432" }), {
    connectionString: "postgresql://user:password@127.0.0.1:15432/app", schema: "tenant", bundled: true,
  });
  assert.equal(developmentDatabaseConnection({ DATABASE_URL: "postgresql://user:password@db.example.test/app" }).connectionString, "postgresql://user:password@db.example.test/app");
});

test("database inspection validates responses, uses bounded queries and always closes its connection", async () => {
  const calls = [];
  const results = [{ rows: [{ migrations: "_prisma_migrations", settings: "system_settings" }] }, { rows: [row] }, { rows: [{ seeded: true }] }];
  let config;
  const state = await inspectDevelopmentDatabase({ DATABASE_URL: "postgresql://user:password@postgres/app" }, manifest, (input) => {
    config = input;
    return {
      connect: async () => calls.push("connect"),
      query: async (sql, values) => { calls.push({ sql, values }); return results.shift(); },
      end: async () => calls.push("end"),
    };
  });
  assert.deepEqual({ ...state, validationFingerprint: undefined }, { pending: [], historyMatches: true, seeded: true, validationFingerprint: undefined });
  assert.match(state.validationFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(calls.at(-1), "end");
  assert.ok(config.connectionTimeoutMillis > 0);
  assert.ok(config.statement_timeout > 0);
  assert.ok(config.query_timeout > 0);
  assert.ok(calls[1].values.every((value) => typeof value === "string"));
  let closed = false;
  await assert.rejects(inspectDevelopmentDatabase({ DATABASE_URL: "postgresql://user:password@postgres/app" }, manifest, () => ({
    connect: async () => undefined,
    query: async () => ({ rows: [{ invalid: true }] }),
    end: async () => { closed = true; },
  })));
  assert.equal(closed, true);
});
