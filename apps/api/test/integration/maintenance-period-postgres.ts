import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { maintenanceStatus } from "../../src/modules/system/service.js";

// Run: pnpm --filter @linksense/api exec tsx test/integration/maintenance-period-postgres.ts
// Isolated disposable PostgreSQL, without networking or application credentials.
const name = `linksense-maintenance-period-${randomUUID()}`;
const docker = (...args: string[]) =>
  execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
const sql = (input: string) =>
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      name,
      "psql",
      "-U",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input, encoding: "utf8", timeout: 30_000 },
  ).trim();
const migration = await readFile(
  new URL(
    "../../../../prisma/migrations/20260917120000_add_maintenance_period_identity/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const now = new Date("2026-09-17T12:30:00.000Z");
const legacyWindow = {
  enabled: true,
  reason: "Existing maintenance",
  start_at: "2026-09-17T12:00:00.000Z",
  end_at: "2026-09-17T13:00:00.000Z",
};
const records = [
  {
    system_initialized: true,
    product: { name: "Existing organization" },
    maintenance: legacyWindow,
  },
  { maintenance: { ...legacyWindow, enabled: false } },
  {
    maintenance: {
      ...legacyWindow,
      start_at: "2026-09-17T14:00:00.000Z",
      end_at: "2026-09-17T15:00:00.000Z",
    },
  },
  { maintenance: { ...legacyWindow, end_at: "2026-09-17T12:15:00.000Z" } },
  { maintenance: { ...legacyWindow, maintenance_id: null } },
  { maintenance: null },
  { system_initialized: false },
  {
    maintenance: {
      ...legacyWindow,
      maintenance_id: "01900000-0000-7000-8000-000000000001",
    },
  },
];
let started = false;
try {
  docker(
    "run",
    "--detach",
    "--network",
    "none",
    "--name",
    name,
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:16-alpine",
  );
  started = true;
  for (let attempt = 0; ; attempt++) {
    try {
      docker("exec", name, "pg_isready", "-U", "postgres");
      break;
    } catch (error) {
      if (attempt >= 50) throw error;
      await delay(100);
    }
  }
  sql(
    'CREATE TABLE "system_settings" (id integer PRIMARY KEY, settings_json jsonb NOT NULL);',
  );
  for (const [id, record] of records.entries()) {
    sql(
      `INSERT INTO system_settings VALUES (${id}, '${JSON.stringify(record).replaceAll("'", "''")}'::jsonb);`,
    );
  }
  sql(migration);
  const read = (): Array<{
    id: number;
    settings_json: Record<string, unknown>;
  }> =>
    JSON.parse(sql("SELECT json_agg(s ORDER BY id) FROM system_settings s;"));
  const upgraded = read();
  for (const row of upgraded) {
    const original = records[row.id];
    assert.ok(original);
    const actual = structuredClone(row.settings_json);
    const maintenance = actual.maintenance;
    if (
      maintenance &&
      typeof maintenance === "object" &&
      "maintenance_id" in maintenance
    ) {
      assert.match(String(maintenance.maintenance_id), /^[0-9a-f-]{36}$/);
      const originalMaintenance = original.maintenance;
      if (originalMaintenance && "maintenance_id" in originalMaintenance)
        maintenance.maintenance_id = originalMaintenance.maintenance_id;
      else delete maintenance.maintenance_id;
    }
    assert.deepEqual(
      actual,
      original,
      `Existing settings preserved for row ${row.id}`,
    );
    const status = maintenanceStatus(row.settings_json, now);
    assert.equal(status.active, [0, 4, 7].includes(row.id));
    if (status.active) assert.ok(status.maintenance_id);
  }
  const activeRecord = upgraded[0];
  assert.ok(activeRecord);
  const first = maintenanceStatus(activeRecord.settings_json, now);
  assert.equal(
    maintenanceStatus(activeRecord.settings_json, now).maintenance_id,
    first.maintenance_id,
  );
  assert.equal(
    maintenanceStatus(activeRecord.settings_json, new Date(legacyWindow.end_at))
      .active,
    false,
  );
  sql(migration);
  assert.deepEqual(
    read(),
    upgraded,
    "Reapplying data migration preserves assigned identifiers",
  );
  sql("INSERT INTO system_settings VALUES (99, '{}'::jsonb);");
  assert.deepEqual(maintenanceStatus({}, now), {
    maintenance_id: null,
    enabled: false,
    active: false,
    reason: null,
    start_at: null,
    end_at: null,
  });
  console.log(
    "PASS: PostgreSQL migration preserves 8 legacy configurations, active/scheduled/expired behavior, stable period IDs, and fresh-install defaults.",
  );
} finally {
  if (started) docker("rm", "--force", name);
}
