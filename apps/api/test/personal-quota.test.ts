import { describe, expect, it, vi } from "vitest";
import { personalQuotaAnalytics } from "../src/modules/usage/personal-quota-service.js";
import { PersonalQuotaRepository, type PersonalQuotaRows } from "../src/modules/usage/personal-quota-repository.js";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";

const USER = "10000000-0000-4000-8000-000000000001";
const TASK = "10000000-0000-4000-8000-000000000002";
const now = new Date("2026-09-20T02:00:00.000Z");
const empty: PersonalQuotaRows = { daily: [], tasks: [], activity: [] };

describe("personal quota analytics", () => {
  it("uses exact recorded credits, combines workloads and keeps unattributed consumption", async () => {
    const row = { model: "model-a", workload: "assistant_response" as const, credits: 1n };
    const read = vi.fn(async () => ({
      daily: [{ ...row, date: "2026-09-20" }],
      tasks: [{ ...row, id: TASK, title: "Task" }, { ...row, id: TASK, title: "Task", workload: "task_title_generation" as const, credits: 2n },
        { ...row, id: null, title: null, credits: 9_007_199_254_740_993n }],
      activity: [{ kind: "skills" as const, date: "2026-09-20", name: "Skill", count: 2 }],
    }));
    const report = await personalQuotaAnalytics({ read }, USER, { time_zone: "Asia/Shanghai" }, now);
    expect(report.dates).toHaveLength(7);
    expect(report.dates[0]).toBe("2026-09-14");
    expect(report.credits[0]?.credits).toBe("0.000001");
    expect(report.tasks.map(task => task.credits)).toEqual(["9007199254.740993", "0.000003"]);
    expect(report.tasks[1]?.breakdown).toHaveLength(2);
    expect(report.skills).toEqual([{ date: "2026-09-20", name: "Skill", count: 2 }]);
    expect(report.tools).toEqual([]);
    expect(read).toHaveBeenCalledWith({ userId: USER, timeZone: "Asia/Shanghai", from: new Date("2026-09-13T16:00:00Z"), to: new Date(now.getTime() + 1) });
  });

  it("produces a complete empty 30-day calendar across daylight saving boundaries", async () => {
    const read = vi.fn<PersonalQuotaRepository["read"]>().mockResolvedValue(empty);
    const result = await personalQuotaAnalytics({ read }, USER, { range: "30d", time_zone: "America/New_York" }, new Date("2026-03-20T12:00:00Z"));
    expect(result.dates).toHaveLength(30);
    expect(result.dates[0]).toBe("2026-02-19");
    expect(new Set(result.dates).size).toBe(30);
    expect(read.mock.calls[0]?.[0]).toMatchObject({ from: new Date("2026-02-19T05:00:00Z") });
    expect(result.tasks).toEqual([]);
  });

  it.each([{ range: "all" }, { time_zone: "invalid" }, { user_id: TASK }])("rejects invalid or cross-user query parameters %j", async query => {
    const read = vi.fn();
    await expect(personalQuotaAnalytics({ read }, USER, query, now)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it("parameterizes all owner and time filters and excludes copied fork activity", async () => {
    const queries: Prisma.Sql[] = [];
    const prisma = { $queryRaw: vi.fn(async (query: Prisma.Sql) => { queries.push(query); return [] }) };
    const repository = new PersonalQuotaRepository(prisma as unknown as PrismaClient);
    await repository.read({ userId: USER, from: now, to: now, timeZone: "Asia/Shanghai" });
    expect(queries).toHaveLength(3);
    for (const query of queries) {
      expect(query.values).toContain(USER);
      expect(query.values).toContain(now);
      expect(query.text).not.toContain(USER);
      expect(query.text).toContain("owner_id = CAST(");
    }
    expect(queries[2]?.text).toContain("DISTINCT ON");
    expect(queries[2]?.text).toContain("e.created_at >= c.created_at");
    expect(queries[2]?.text).toContain("m.created_at >= c.created_at");
    expect(queries[2]?.text).not.toContain("content_text");
  });
});
