import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";

import { createPrismaClient } from "../../src/db.js";
import { Prisma } from "../../src/generated/prisma/client.js";
import { buildReasoningEventsQuery } from "../../src/modules/conversations/reasoning-events-query.js";

// Uses only a disposable PostgreSQL database; never loads application .env.
// Run: pnpm --filter @linksense/api exec tsx test/integration/conversation-reasoning-postgres.ts
const execute = promisify(execFile);
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const container = `linksense-reasoning-${randomUUID()}`;
const password = randomUUID();
const docker = async (...args: string[]): Promise<string> =>
  (await execute("docker", args, { timeout: 30_000 })).stdout.trim();
let created = false;
let database: ReturnType<typeof createPrismaClient> | undefined;

// The previous SQL is a test oracle for persisted records, never a runtime path.
function previousReasoningQuery(conversationId: string, turnIds: string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT event.id, event.conversation_id AS "conversationId",
      event.turn_id AS "turnId", event.sequence_no AS "sequenceNo",
      event.event_type AS "eventType", event.visibility,
      event.payload_json AS "payloadJson", event.sse_event_id AS "sseEventId",
      event.created_at AS "createdAt"
    FROM conversation_events AS event
    WHERE event.conversation_id = CAST(${conversationId} AS uuid)
      AND event.turn_id IN (${Prisma.join(turnIds.map((id) => Prisma.sql`CAST(${id} AS uuid)`))})
      AND event.visibility IN ('user_visible', 'user_collapsed')
      AND (
        (event.event_type IN ('item/started', 'item/completed')
          AND event.payload_json #>> '{params,item,type}' = 'reasoning')
        OR (event.event_type = 'item/reasoning/textDelta' AND NOT EXISTS (
          SELECT 1 FROM conversation_events AS completed
          WHERE completed.conversation_id = event.conversation_id
            AND completed.turn_id = event.turn_id
            AND completed.event_type = 'item/completed'
            AND completed.payload_json #>> '{params,item,type}' = 'reasoning'
            AND completed.payload_json #>> '{params,item,id}' = event.payload_json #>> '{params,itemId}'
            AND completed.sequence_no > event.sequence_no
        ))
      )
    ORDER BY event.sequence_no ASC
  `;
}

type PlanNode = {
  "Node Type": string;
  "Actual Loops": number;
  "Subplan Name"?: string | undefined;
  Plans?: PlanNode[] | undefined;
};
const planNodeSchema: z.ZodType<PlanNode> = z.lazy(() => z.object({
  "Node Type": z.string(),
  "Actual Loops": z.number(),
  "Subplan Name": z.string().optional(),
  Plans: z.array(planNodeSchema).optional(),
}));
const explainSchema = z.array(z.object({
  "QUERY PLAN": z.array(z.object({
    Plan: planNodeSchema,
    "Execution Time": z.number(),
  })).length(1),
})).length(1);

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)];
}

async function verifyQuery(db: ReturnType<typeof createPrismaClient>): Promise<void> {
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  const turnId = randomUUID();
  const secondTurnId = randomUUID();
  const outsideTurnId = randomUUID();
  const rows: Prisma.ConversationEventCreateManyInput[] = [];
  const expectedIds: string[] = [];
  const content = "Full reasoning\n\n" + "思考内容".repeat(5_000);
  const item = (id: string | null, type = "reasoning"): Prisma.InputJsonObject =>
    ({ item: { id, type, summary: ["Summary"], content: [content] } });
  const delta = (itemId: string | null): Prisma.InputJsonObject =>
    ({ itemId, contentIndex: 0, delta: "Interrupted partial body" });

  function add(
    method: string,
    params: Prisma.InputJsonObject,
    options: { keep?: boolean; conversationId?: string; turnId?: string | null; visibility?: string } = {},
  ): void {
    const id = randomUUID();
    const sequenceNo = BigInt(rows.length + 1);
    const scope = options.conversationId ?? conversationId;
    rows.push({
      id, conversationId: scope,
      turnId: options.turnId === undefined ? turnId : options.turnId,
      sequenceNo, eventType: method,
      visibility: options.visibility ?? "user_collapsed",
      payloadJson: {
        schema_version: 2, source: "codex_app_server", method,
        params: { threadId: "fixture-thread", turnId: "native-turn", ...params },
      },
      sseEventId: `${scope}:${sequenceNo}`,
    });
    if (options.keep !== false) expectedIds.push(id);
  }

  const query = buildReasoningEventsQuery(conversationId, [turnId, secondTurnId]);
  assert.deepEqual(await db.$queryRaw(query), []);

  add("item/started", item("complete"), { visibility: "user_visible" });
  add("item/reasoning/textDelta", delta("complete"), { keep: false });
  add("item/completed", item("complete"));
  add("item/started", item("interrupted"));
  add("item/reasoning/textDelta", delta("interrupted"));
  add("item/reasoning/textDelta", delta("repeated"), { keep: false });
  add("item/completed", item("repeated"));
  add("item/reasoning/textDelta", delta("repeated"), { keep: false });
  add("item/completed", item("repeated"));
  add("item/reasoning/textDelta", delta("repeated"));
  add("item/reasoning/textDelta", delta("reused-across-turns"));
  add("item/completed", item("reused-across-turns"), { turnId: secondTurnId });
  add("item/reasoning/textDelta", delta("other-conversation"));
  add("item/completed", item("other-conversation"), { conversationId: otherConversationId, keep: false });
  add("item/reasoning/textDelta", delta("outside-page"));
  add("item/completed", item("outside-page"), { turnId: outsideTurnId, keep: false });
  add("item/reasoning/textDelta", delta("hidden-completion"), { keep: false });
  add("item/completed", item("hidden-completion"), { visibility: "internal_sanitized", keep: false });
  add("item/started", item("hidden-start"), { visibility: "internal_sanitized", keep: false });
  add("item/reasoning/textDelta", delta("hidden-delta"), { visibility: "internal_sanitized", keep: false });
  add("item/reasoning/textDelta", delta("different-type"));
  add("item/completed", item("different-type", "agentMessage"), { keep: false });
  // Missing/null JSON keys retain SQL NULL semantics. Service tests separately
  // ensure malformed native payloads cannot pass the detail response boundary.
  add("item/reasoning/textDelta", { contentIndex: 0, delta: "Missing item ID" });
  add("item/reasoning/textDelta", delta(null));
  add("item/completed", item(null));
  add("item/completed", { item: { id: "older-event-without-type" } }, { keep: false });
  add("item/completed", item("pre-turn"), { turnId: null, keep: false });
  await db.conversationEvent.createMany({ data: rows });

  const actual = await db.$queryRaw<unknown[]>(query);
  const actualIds = z.array(z.object({ id: z.uuid() })).parse(actual).map(({ id }) => id);
  assert.deepEqual(actualIds, expectedIds);
  assert.deepEqual(actual, await db.$queryRaw(previousReasoningQuery(conversationId, [turnId, secondTurnId])));
  const full = z.object({ payloadJson: z.object({ params: z.object({
    item: z.object({ content: z.array(z.string()) }),
  }) }) }).parse(actual[0]);
  assert.deepEqual(full.payloadJson.params.item.content, [content]);
  const page = buildReasoningEventsQuery(conversationId, [turnId]);
  assert.deepEqual(await db.$queryRaw(page), await db.$queryRaw(previousReasoningQuery(conversationId, [turnId])));
  console.log("PASS: empty history, full bodies, interrupted streams, repeated completions, ordering, visibility, JSON nulls, conversation/turn/page isolation and unchanged persisted rows.");
}

async function verifyPlan(db: ReturnType<typeof createPrismaClient>): Promise<void> {
  const conversationId = randomUUID();
  const turnId = randomUUID();
  const rows: Prisma.ConversationEventCreateManyInput[] = [];
  const add = (method: string, params: Prisma.InputJsonObject): void => {
    const sequenceNo = BigInt(rows.length + 1);
    rows.push({
      conversationId, turnId, sequenceNo, eventType: method, visibility: "user_collapsed",
      payloadJson: { schema_version: 2, source: "codex_app_server", method, params },
      sseEventId: `${conversationId}:${sequenceNo}`,
    });
  };
  const itemCount = 187;
  const deltaCount = 6_079;
  for (let index = 0; index < itemCount; index++)
    add("item/started", { item: { id: `reasoning-${index}`, type: "reasoning", summary: [], content: [] } });
  for (let index = 0; index < deltaCount; index++)
    add("item/reasoning/textDelta", { itemId: `reasoning-${index % itemCount}`, contentIndex: 0, delta: "思考增量" });
  for (let index = 0; index < itemCount; index++)
    add("item/completed", { item: { id: `reasoning-${index}`, type: "reasoning", summary: ["Summary"], content: ["Full reasoning".repeat(100)] } });
  await db.conversationEvent.createMany({ data: rows });
  await db.$executeRaw`ANALYZE conversation_events`;

  const query = buildReasoningEventsQuery(conversationId, [turnId]);
  const previous = previousReasoningQuery(conversationId, [turnId]);
  assert.deepEqual(await db.$queryRaw(query), await db.$queryRaw(previous));
  const explain = async (sql: Prisma.Sql) => {
    const result = explainSchema.parse(await db.$queryRaw(Prisma.sql`
      EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${sql}
    `))[0]?.["QUERY PLAN"][0];
    assert(result);
    return result;
  };
  const before = await explain(previous);
  const after = await explain(query);
  const nodes = planNodes(after.Plan);
  assert(!nodes.some((node) => node["Subplan Name"]?.startsWith("SubPlan")), "must not rescan completions for each delta");
  const aggregation = nodes.filter((node) => node["Subplan Name"] === "CTE completed_reasoning");
  assert.equal(aggregation.length, 1);
  assert.equal(aggregation[0]?.["Actual Loops"], 1);
  console.log(JSON.stringify({
    fixtureEvents: rows.length,
    deltaEvents: deltaCount,
    previousSqlMs: before["Execution Time"],
    optimizedSqlMs: after["Execution Time"],
    previousSubqueryLoops: planNodes(before.Plan)
      .filter((node) => node["Subplan Name"]?.startsWith("SubPlan"))
      .map((node) => node["Actual Loops"]),
    completionAggregationLoops: aggregation[0]?.["Actual Loops"],
  }));
  console.log("PASS: identical results for 6,453 events; completed reasoning is aggregated once without a correlated SubPlan.");
}

try {
  await docker("run", "--rm", "--pull", "never", "--label", "com.linksense.test.disposable=true", "--detach", "--name", container,
    "--publish", "127.0.0.1::5432", "--env", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine");
  created = true;
  const port = Number((await docker("port", container, "5432")).split(":").at(-1));
  assert(Number.isInteger(port) && port > 0);
  for (let attempt = 0; ; attempt++) {
    try { await docker("exec", container, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"); break; }
    catch (error) { if (attempt >= 50) throw error; await delay(100); }
  }
  const databaseUrl = `postgresql://postgres:${password}@127.0.0.1:${port}/postgres`;
  await execute("pnpm", ["exec", "prisma", "migrate", "deploy", "--config", "apps/api/test/integration/prisma.config.ts"], {
    cwd: repositoryRoot, timeout: 120_000, maxBuffer: 4_000_000,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  database = createPrismaClient(databaseUrl);
  await verifyQuery(database);
  await verifyPlan(database);
} finally {
  try { await database?.$disconnect(); }
  finally { if (created) await docker("rm", "--force", "--volumes", container); }
}
