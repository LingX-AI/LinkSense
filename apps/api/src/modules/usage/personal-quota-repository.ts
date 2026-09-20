import { z } from "zod";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { usageWorkloadSchema } from "@linksense/shared";

const amount = z.coerce.bigint().nonnegative();
const creditRowSchema = z.object({
  model: z.string(), workload: usageWorkloadSchema, credits: amount,
});
const dailyRowSchema = creditRowSchema.extend({ date: z.iso.date() });
const taskRowSchema = creditRowSchema.extend({ id: z.uuid().nullable(), title: z.string().nullable() });
const activityRowSchema = z.object({
  kind: z.enum(["tools", "skills", "messages"]), date: z.iso.date(),
  name: z.string(), count: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});

export type PersonalQuotaRows = {
  daily: z.infer<typeof dailyRowSchema>[];
  tasks: z.infer<typeof taskRowSchema>[];
  activity: z.infer<typeof activityRowSchema>[];
};

export class PersonalQuotaRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async read(input: { userId: string; from: Date; to: Date; timeZone: string }): Promise<PersonalQuotaRows> {
    const { userId, from, to, timeZone } = input;
    // Keep the original charge snapshots, including usage outside conversations.
    const credits = Prisma.sql`
      SELECT conversation_id, model, 'assistant_response'::text AS workload, observed_at, used_credit_micros
      FROM token_usage_records
      WHERE owner_id = CAST(${userId} AS uuid) AND observed_at >= ${from} AND observed_at < ${to}
      UNION ALL
      SELECT conversation_id, model, workload, observed_at, used_credit_micros
      FROM model_usage_records
      WHERE owner_id = CAST(${userId} AS uuid) AND observed_at >= ${from} AND observed_at < ${to}
    `;
    const [daily, tasks, activity] = await Promise.all([
      this.prisma.$queryRaw<unknown[]>(Prisma.sql`
        WITH credits AS (${credits})
        SELECT to_char(observed_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
          model, workload, SUM(used_credit_micros)::text AS credits
        FROM credits GROUP BY date, model, workload ORDER BY date, model, workload
      `),
      this.prisma.$queryRaw<unknown[]>(Prisma.sql`
        WITH credits AS (${credits})
        SELECT c.id, c.title, u.model, u.workload, SUM(u.used_credit_micros)::text AS credits
        FROM credits u
        LEFT JOIN conversations c ON c.id = u.conversation_id AND c.owner_id = CAST(${userId} AS uuid)
        GROUP BY c.id, c.title, u.model, u.workload
      `),
      this.prisma.$queryRaw<unknown[]>(Prisma.sql`
        WITH tool_calls AS (
          SELECT DISTINCT ON (e.conversation_id, e.turn_id, e.payload_json #>> '{params,item,id}')
            e.created_at,
            COALESCE(NULLIF(e.payload_json #>> '{params,item,pluginId}', ''),
              e.payload_json #>> '{params,item,server}') AS name
          FROM conversations c JOIN conversation_events e ON e.conversation_id = c.id
          WHERE c.owner_id = CAST(${userId} AS uuid)
            AND (c.fork_source_conversation_id IS NULL OR e.created_at >= c.created_at)
            AND e.created_at >= ${from} AND e.created_at < ${to}
            AND e.event_type = 'item/completed'
            AND e.visibility IN ('user_visible', 'user_collapsed')
            AND e.payload_json ->> 'source' = 'codex_app_server'
            AND e.payload_json ->> 'method' = 'item/completed'
            AND e.payload_json #>> '{params,item,type}' = 'mcpToolCall'
            AND COALESCE(e.payload_json #>> '{params,item,id}', '') <> ''
          ORDER BY e.conversation_id, e.turn_id, e.payload_json #>> '{params,item,id}', e.sequence_no
        )
        SELECT 'tools' AS kind, to_char(created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
          COALESCE(name, '__unknown__') AS name, COUNT(*)::text AS count
        FROM tool_calls GROUP BY date, name
        UNION ALL
        SELECT 'skills', to_char(occurred_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
          COALESCE(capability_name, capability_id, '__unknown__') AS name, COUNT(*)::text
        FROM usage_activity_records
        WHERE owner_id = CAST(${userId} AS uuid) AND activity_type = 'skill_used'
          AND occurred_at >= ${from} AND occurred_at < ${to}
        GROUP BY date, name
        UNION ALL
        SELECT 'messages', to_char(m.created_at AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS date,
          COALESCE(t.model, '__unknown__') AS name, COUNT(*)::text
        FROM conversations c
        JOIN conversation_messages m ON m.conversation_id = c.id
        JOIN conversation_turns t ON t.id = m.turn_id AND t.conversation_id = c.id
        WHERE c.owner_id = CAST(${userId} AS uuid) AND m.role = 'user'
          AND (c.fork_source_conversation_id IS NULL OR m.created_at >= c.created_at)
          AND m.created_at >= ${from} AND m.created_at < ${to}
        GROUP BY date, name
      `),
    ]);
    return {
      daily: z.array(dailyRowSchema).parse(daily),
      tasks: z.array(taskRowSchema).parse(tasks),
      activity: z.array(activityRowSchema).parse(activity),
    };
  }
}
