import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "../src/generated/prisma/client.js";
import { assertProjectTasksIdle } from "../src/modules/projects/runtime-state.js";

describe("application development project placement", () => {
  it("rejects moving or detaching a development task even when idle, preserving its source workspace", async () => {
    const query = vi.fn().mockResolvedValue([{ busy: false, development: true }]);
    await expect(assertProjectTasksIdle({ $queryRaw: query } as unknown as Prisma.TransactionClient, ["task"])).rejects.toMatchObject({ code: "APPLICATION_DEVELOPMENT_WORKSPACE_BOUND" });
    expect(query.mock.calls[0]?.[0].sql).toContain("application_developments");
  });
  it("allows idle ordinary tasks and never queries an empty project", async () => {
    const query = vi.fn().mockResolvedValue([{ busy: false, development: false }]);
    const tx = { $queryRaw: query } as unknown as Prisma.TransactionClient;
    await expect(assertProjectTasksIdle(tx, ["task"])).resolves.toBeUndefined();
    await assertProjectTasksIdle(tx, []);
    expect(query).toHaveBeenCalledOnce();
  });
});
