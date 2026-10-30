import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  automationNotificationTargetSchema,
  automationRunContextSchema,
  automationScheduleSchema,
  automationUpdateInputSchema,
  readAutomationMonitoring,
} from "@linksense/shared";
import { nextAutomationRunBeforeExpiration } from "../../src/modules/automations/schedule.js";

const root = new URL("../../../../", import.meta.url);
const schema = `automation_upgrade_${randomUUID().replaceAll("-", "")}`;
const owner = randomUUID();
const automation = randomUUID();
const conversation = randomUUID();
const pausedAutomation = randomUUID();
const oldTurn = randomUUID();
const oldRun = randomUUID();
const now = new Date("2026-10-23T01:00:00.000Z");
const anchor = new Date("2026-10-22T00:00:00.000Z");
const schedule = automationScheduleSchema.parse({
  frequency: "hourly", interval: 1, minute: 0, time_zone: "Asia/Shanghai",
});
let phase = "configuration";

async function migration(name: string): Promise<string> {
  const sql = await readFile(new URL(`prisma/migrations/${name}/migration.sql`, root), "utf8");
  // Only reviewed, schema-local additive migrations may run on this connection.
  assert(!/\b(?:DROP|TRUNCATE|DELETE|COMMIT|ROLLBACK|BEGIN)\b|\bpublic\b|_prisma_migrations/iu.test(sql), `Unsafe migration: ${name}`);
  return sql;
}

async function main(): Promise<void> {
  const value = parseEnv(await readFile(new URL(".env.host", root), "utf8")).DATABASE_URL;
  assert(value, "DATABASE_URL is missing from .env.host");
  const url = new URL(value);
  assert(["postgres:", "postgresql:"].includes(url.protocol), "Expected PostgreSQL");
  assert(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname), "Only loopback PostgreSQL is allowed");
  assert([...url.searchParams.keys()].every(key => key === "schema" || key === "sslmode"), "Unsupported connection parameters");
  url.searchParams.delete("schema");

  const historical = await Promise.all([
    "20260730220000_add_automations",
    "20260731100000_add_automation_completion_notifications",
    "20260809120000_add_automation_expiration",
    "20260819093000_add_automation_model_preference",
  ].map(migration));
  const upgrades = await Promise.all([
    "20261022090000_add_automation_notifications",
    "20261023100000_add_automation_monitoring",
  ].map(migration));

  // Reuse the installed adapter's typed pg pool; no additional type dependency is needed.
  const adapter = await new PrismaPg({
    connectionString: url.href,
    connectionTimeoutMillis: 5_000,
    max: 1,
    application_name: "linksense-automation-upgrade",
  }, { schema }).connect();
  try {
    phase = "loopback PostgreSQL connection";
    const client = await adapter.underlyingDriver().connect();
    let started = false;
    try {
      await client.query("BEGIN");
      started = true;
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query("SET LOCAL lock_timeout = '2s'");
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET LOCAL search_path TO "${schema}"`);
      const isolated = await client.query<{ schema: string; search_path: string[] }>(
        "SELECT current_schema()::text AS schema, current_schemas(false)::text[] AS search_path",
      );
      assert.deepEqual(isolated.rows, [{ schema, search_path: [schema] }]);

      phase = "pre-change tables and records";
      assert(historical[0]);
      await client.query(historical[0]);
      // The July backfill uses only these already-existing conversation_turns fields.
      await client.query(`CREATE TABLE conversation_turns (
        id UUID PRIMARY KEY, conversation_id UUID NOT NULL, submitted_by UUID NOT NULL,
        status VARCHAR(32) NOT NULL, completed_at TIMESTAMPTZ(6), idempotency_key VARCHAR(120)
      )`);
      await client.query(`INSERT INTO automations
        (id, owner_id, conversation_id, title, instruction, status, frequency, interval_count,
         minute_of_hour, time_zone, anchor_at, next_run_at, updated_at)
        VALUES ($1,$2,$3,'Legacy active','Keep monitoring','active','hourly',1,0,'Asia/Shanghai',$4,$5,$4),
               ($6,$2,$3,'Legacy paused','Keep paused','paused','hourly',1,0,'Asia/Shanghai',$4,NULL,$4)`,
      [automation, owner, conversation, anchor, now, pausedAutomation]);
      await client.query(`INSERT INTO conversation_turns
        (id,conversation_id,submitted_by,status,completed_at,idempotency_key)
        VALUES ($1,$2,$3,'completed',$4,'automation:legacy-completed')`,
      [oldTurn, conversation, owner, anchor]);
      await client.query(`INSERT INTO automation_runs
        (id,automation_id,owner_id,conversation_id,scheduled_for,idempotency_key,status,turn_id,pending_request_id,updated_at)
        VALUES ($1,$2,$3,$4,$5,'automation:legacy-completed','started',$6,NULL,$5),
               ($7,$2,$3,$4,$5 + INTERVAL '1 hour','automation:legacy-queued','queued',NULL,$8,$5),
               ($9,$2,$3,$4,$5 + INTERVAL '2 hours','automation:legacy-failed','failed',NULL,NULL,$5)`,
      [oldRun, automation, owner, conversation, anchor, oldTurn, randomUUID(), randomUUID(), randomUUID()]);
      for (const sql of historical.slice(1)) await client.query(sql);
      await client.query("UPDATE automations SET model_id='legacy-model',reasoning_effort='medium' WHERE id=$1", [automation]);
      const beforeAutomations = await client.query<{ snapshot: unknown }>("SELECT to_jsonb(a) AS snapshot FROM automations a ORDER BY id");
      const beforeRuns = await client.query<{ snapshot: unknown }>("SELECT to_jsonb(r) AS snapshot FROM automation_runs r ORDER BY id");

      phase = "feature migrations preserve old records";
      for (const sql of upgrades) await client.query(sql);
      const afterAutomations = await client.query<{ snapshot: unknown }>(
        "SELECT to_jsonb(a) - 'notification_target_json' - 'monitoring_json' AS snapshot FROM automations a ORDER BY id",
      );
      const afterRuns = await client.query<{ snapshot: unknown }>(
        "SELECT to_jsonb(r) - 'execution_context_json' AS snapshot FROM automation_runs r ORDER BY id",
      );
      assert.deepEqual(afterAutomations.rows, beforeAutomations.rows);
      assert.deepEqual(afterRuns.rows, beforeRuns.rows);
      const legacy = await client.query<{
        id: string; notification_target_json: unknown; monitoring_json: unknown;
      }>("SELECT id,notification_target_json,monitoring_json FROM automations ORDER BY id");
      assert.equal(legacy.rows.length, 2);
      for (const row of legacy.rows) {
        assert.equal(automationNotificationTargetSchema.nullable().parse(row.notification_target_json), null);
        assert.equal(row.monitoring_json, null);
        assert.deepEqual(readAutomationMonitoring(row.monitoring_json), {
          stop_condition: null, max_runs: null, context_mode: "reuse_task", automatic_run_count: 0,
          stop_reason: null, stop_requested_run_id: null, last_run_conversation_id: null,
        });
      }
      const legacyRuns = await client.query<{ execution_context_json: unknown }>("SELECT execution_context_json FROM automation_runs");
      assert.equal(legacyRuns.rows.length, 3);
      for (const row of legacyRuns.rows) assert.equal(automationRunContextSchema.nullable().parse(row.execution_context_json), null);
      const deliveries = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM automation_notification_deliveries");
      assert.equal(deliveries.rows[0]?.count, 0);

      phase = "legacy editing and scheduled execution";
      const edit = automationUpdateInputSchema.parse({ title: "Legacy edited" });
      assert.equal(edit.notification_target, undefined);
      assert.equal(edit.monitoring, undefined);
      await client.query("UPDATE automations SET title=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [automation, edit.title]);
      const edited = await client.query<{ title: string; notification_target_json: unknown; monitoring_json: unknown }>(
        "SELECT title,notification_target_json,monitoring_json FROM automations WHERE id=$1", [automation],
      );
      assert.deepEqual(edited.rows, [{ title: edit.title, notification_target_json: null, monitoring_json: null }]);
      // Match the scheduler's old-null eligibility, then perform a constraint-checked claim.
      const due = await client.query<{ id: string }>(`SELECT id FROM automations
        WHERE status='active' AND deleted_at IS NULL AND next_run_at <= $1
          AND (expires_at IS NULL OR expires_at > $1)
          AND (monitoring_json IS NULL OR monitoring_json->'stop_requested_run_id' = 'null'::jsonb)
        ORDER BY next_run_at,id FOR UPDATE`, [now]);
      assert.deepEqual(due.rows, [{ id: automation }]);
      const next = nextAutomationRunBeforeExpiration(schedule, anchor, now, null);
      assert(next && next.getTime() > now.getTime());
      const monitoring = readAutomationMonitoring(edited.rows[0]?.monitoring_json);
      const claimedState = { ...monitoring, automatic_run_count: 1 };
      const runContext = automationRunContextSchema.parse({
        trigger: "scheduled", context_mode: monitoring.context_mode,
        stop_condition: monitoring.stop_condition, target_conversation_id: conversation,
      });
      const newRun = randomUUID();
      await client.query("UPDATE automations SET next_run_at=$2,monitoring_json=$3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=$1",
        [automation, next, JSON.stringify(claimedState)]);
      await client.query(`INSERT INTO automation_runs
        (id,automation_id,owner_id,conversation_id,scheduled_for,idempotency_key,status,execution_context_json,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'dispatching',$7::jsonb,CURRENT_TIMESTAMP)`,
      [newRun, automation, owner, conversation, now, `automation:${newRun}`, JSON.stringify(runContext)]);
      await client.query("UPDATE automation_runs SET status='started',turn_id=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1", [newRun, randomUUID()]);
      const startedRun = await client.query<{ conversation_id: string; status: string; execution_context_json: unknown }>(
        "SELECT conversation_id,status,execution_context_json FROM automation_runs WHERE id=$1", [newRun],
      );
      assert.equal(startedRun.rows[0]?.conversation_id, conversation);
      assert.equal(startedRun.rows[0]?.status, "started");
      assert.deepEqual(automationRunContextSchema.parse(startedRun.rows[0]?.execution_context_json), runContext);

      phase = "notification defaults and unique run delivery";
      const target = automationNotificationTargetSchema.parse({
        kind: "feishu", connection_id: randomUUID(), peer_session_id: randomUUID(),
      });
      await client.query("UPDATE automations SET notification_target_json=$2::jsonb WHERE id=$1", [automation, JSON.stringify(target)]);
      const insertDelivery = `INSERT INTO automation_notification_deliveries (id,automation_id,run_id,owner_id,target_json)
        VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (run_id) DO NOTHING RETURNING id`;
      const first = await client.query(insertDelivery, [randomUUID(), automation, newRun, owner, JSON.stringify(target)]);
      const duplicate = await client.query(insertDelivery, [randomUUID(), automation, newRun, owner, JSON.stringify(target)]);
      assert.equal(first.rowCount, 1);
      assert.equal(duplicate.rowCount, 0);
      const defaults = await client.query<{
        status: string; attempts: number; processing_token: string | null; last_error_code: string | null;
        sent_at: Date | null; target_json: unknown; dates_valid: boolean;
      }>(`SELECT status,attempts,processing_token,last_error_code,sent_at,target_json,
          next_attempt_at=CURRENT_TIMESTAMP AND created_at=CURRENT_TIMESTAMP AND updated_at=CURRENT_TIMESTAMP AS dates_valid
        FROM automation_notification_deliveries WHERE run_id=$1`, [newRun]);
      assert.equal(defaults.rows.length, 1);
      const delivery = defaults.rows[0];
      assert(delivery);
      assert.deepEqual({ ...delivery, target_json: automationNotificationTargetSchema.parse(delivery.target_json) }, {
        status: "pending", attempts: 0, processing_token: null, last_error_code: null,
        sent_at: null, target_json: target, dates_valid: true,
      });
    } finally {
      const operationPhase = phase;
      try {
        if (started) {
          phase = "rollback cleanup";
          await client.query("ROLLBACK");
          const remaining = await client.query<{ exists: boolean }>(
            "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS exists", [schema],
          );
          assert.equal(remaining.rows[0]?.exists, false, "Private schema survived rollback");
          phase = operationPhase;
        }
      } finally {
        client.release();
      }
    }
  } finally {
    await adapter.dispose();
  }
}

await main().then(() => {
  console.log("PASS automation upgrade: old records preserved, null defaults decoded, legacy edits and scheduled runs accepted, notification defaults and uniqueness verified.");
  console.log("PASS rollback: private schema absent; no application schema or migration history was changed.");
}, (error: unknown) => {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code.replace(/[^A-Z0-9_]/gu, "").slice(0, 40) : "CHECK_FAILED";
  const line = error instanceof Error ? error.stack?.match(/automation-upgrade\.ts:(\d+):\d+/u)?.[1] : undefined;
  console.error(`FAIL automation upgrade at ${phase} (${code}${line ? `, line ${line}` : ""}).`);
  console.error(`Run: pnpm --filter @linksense/api exec tsx ${fileURLToPath(import.meta.url)}`);
  process.exitCode = 1;
});
