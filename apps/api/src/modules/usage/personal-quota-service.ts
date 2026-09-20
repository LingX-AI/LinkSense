import { creditMicrosToDecimal, personalQuotaQuerySchema, personalQuotaAnalyticsSchema,
  type PersonalQuotaAnalytics } from "@linksense/shared";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import type { PersonalQuotaRepository } from "./personal-quota-repository.js";

dayjs.extend(utc);
dayjs.extend(timezone);

export async function personalQuotaAnalytics(
  repository: Pick<PersonalQuotaRepository, "read">,
  userId: string,
  rawQuery: unknown,
  now: Date,
): Promise<PersonalQuotaAnalytics> {
  const query = personalQuotaQuerySchema.parse(rawQuery);
  const days = query.range === "7d" ? 7 : 30;
  const today = dayjs(now).tz(query.time_zone).format("YYYY-MM-DD");
  // Build calendar dates first, then resolve each boundary in the zone (DST-safe).
  const dates = Array.from({ length: days }, (_, index) =>
    dayjs.utc(today).subtract(days - 1 - index, "day").format("YYYY-MM-DD"));
  const rows = await repository.read({
    userId, timeZone: query.time_zone,
    from: dayjs.tz(dates[0], query.time_zone).toDate(),
    to: new Date(now.getTime() + 1),
  });
  const taskMap = new Map<string | null, {
    id: string | null; title: string | null; micros: bigint;
    breakdown: PersonalQuotaAnalytics["tasks"][number]["breakdown"];
  }>();
  for (const row of rows.tasks) {
    const task = taskMap.get(row.id) ?? { id: row.id, title: row.title, micros: 0n, breakdown: [] };
    task.micros += row.credits;
    task.breakdown.push({ model: row.model, workload: row.workload, credits: creditMicrosToDecimal(row.credits) });
    taskMap.set(row.id, task);
  }
  const tasks = [...taskMap.values()].sort((a, b) =>
    a.micros === b.micros ? (a.id ?? "").localeCompare(b.id ?? "") : a.micros > b.micros ? -1 : 1);
  const activity = (kind: "tools" | "skills" | "messages") => rows.activity
    .filter(row => row.kind === kind).map(({ date, name, count }) => ({ date, name, count }));
  return personalQuotaAnalyticsSchema.parse({
    generated_at: now.toISOString(), range: query.range, time_zone: query.time_zone, dates,
    credits: rows.daily.map(row => ({ ...row, credits: creditMicrosToDecimal(row.credits) })),
    tasks: tasks.map(({ id, title, micros, breakdown }) => ({ id, title, credits: creditMicrosToDecimal(micros), breakdown })),
    tools: activity("tools"), skills: activity("skills"), messages: activity("messages"),
  });
}
