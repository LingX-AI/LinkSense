import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { publicKnowledgeSettingsSchema } from "@linksense/shared";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { PublicKnowledgeService } from "../src/modules/public-knowledge/service.js";
import { publicKnowledgeProgressFixture } from "./fixtures/public-knowledge-progress.js";

function fixture() {
  const ownerId = randomUUID(),
    applicationId = randomUUID(),
    versionId = randomUUID();
  const actor = { id: ownerId, role: "user", status: "active" } as const;
  const application = {
    id: applicationId,
    ownerId,
    kind: "public_knowledge",
    status: "active",
    publishedVersionId: versionId,
  };
  const settings = publicKnowledgeSettingsSchema.parse({
    name: "Website",
    instructions: "Original guide",
    model: "model",
    reasoning_effort: "medium",
    knowledge_base_ids: [randomUUID()],
    skill_ids: [randomUUID()],
    allowed_origins: ["https://example.test"],
  });
  const configuration = {
    applicationId,
    publicId: "public-application-identifier-1234",
    settingsJson: settings,
  };
  const db = {
    application: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; ownerId: string; kind: string };
        }) =>
          where.id === applicationId &&
          where.ownerId === ownerId &&
          application.kind === where.kind &&
          application.status !== "deleted"
            ? application
            : null,
      ),
      updateMany: vi.fn(async ({ data }: { data: { status: string } }) => {
        application.status = data.status;
        return { count: 1 };
      }),
    },
    applicationVersion: {
      findUnique: vi.fn(async () => ({ id: versionId, versionLabel: "1.0.0" })),
    },
    publicKnowledgeApplication: {
      findUnique: vi.fn(async () => configuration),
      update: vi.fn(
        async ({ data }: { data: { settingsJson: typeof settings } }) => {
          configuration.settingsJson = data.settingsJson;
          return configuration;
        },
      ),
    },
    publicKnowledgeVisitor: { count: vi.fn(async () => 3) },
    publicKnowledgeConversation: { count: vi.fn(async () => 4) },
    $queryRaw: vi.fn(async () => [
      { status: "completed", count: 6, average_duration_ms: 1500 },
      { status: "failed", count: 1, average_duration_ms: null },
    ]),
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (work: (tx: typeof db) => Promise<unknown>) =>
      work(db),
    ),
  } as unknown as PrismaClient;
  const audit = { write: vi.fn(async () => undefined) },
    models = {
      resolveRuntime: vi.fn(),
      resolveRuntimeForSelection: vi.fn(),
      resolveModelTransitionRuntime: vi.fn(),
    };
  const service = new PublicKnowledgeService({
    progress: publicKnowledgeProgressFixture(),
    prisma,
    models,
    audit,
    knowledge: null,
    retrieve: null,
    skills: { capture: vi.fn(), resolve: vi.fn() },
    runner: {
      runPublicKnowledgeTurn: vi.fn(),
      readPublicKnowledgeResult: vi.fn(),
      interruptPublicKnowledgeTurn: vi.fn(),
    },
    coordinator: { acquire: vi.fn(), rateLimit: vi.fn() },
    queue: { start: vi.fn(), enqueue: vi.fn(), close: vi.fn() },
  });
  return {
    service,
    db,
    actor,
    applicationId,
    application,
    configuration,
    settings,
    models,
    audit,
  };
}
describe("public knowledge management actions", () => {
  it("disables and re-enables visitor access without republishing or changing existing selections", async () => {
    const f = fixture();
    expect(
      (await f.service.setEnabled(f.actor, f.applicationId, false)).settings,
    ).toEqual({ ...f.settings, enabled: false });
    expect(f.application.status).toBe("disabled");
    expect(
      (await f.service.setEnabled(f.actor, f.applicationId, true)).settings,
    ).toEqual(f.settings);
    expect(f.application.status).toBe("active");
    expect(f.models.resolveRuntimeForSelection).not.toHaveBeenCalled();
    expect(f.audit.write).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "public_knowledge_application_enabled",
      }),
    );
  });
  it.each(["foreign", "standard", "deleted", "inactive"])(
    "rejects %s management before writing or reading usage",
    async (reason) => {
      const f = fixture();
      if (reason === "standard") f.application.kind = "standard";
      if (reason === "deleted") f.application.status = "deleted";
      const actor =
        reason === "foreign"
          ? { ...f.actor, id: randomUUID() }
          : reason === "inactive"
            ? { ...f.actor, status: "disabled" as const }
            : f.actor;
      await expect(
        f.service.setEnabled(actor, f.applicationId, false),
      ).rejects.toThrow();
      await expect(
        f.service.usage(actor, f.applicationId, {}),
      ).rejects.toThrow();
      expect(f.db.application.updateMany).not.toHaveBeenCalled();
      expect(f.db.publicKnowledgeVisitor.count).not.toHaveBeenCalled();
    },
  );
  it("aggregates only this application's public questions and preserves explicit date bounds", async () => {
    const f = fixture(),
      query = { from: "2026-11-01T00:00:00Z", to: "2026-11-05T23:59:59Z" };
    expect(await f.service.usage(f.actor, f.applicationId, query)).toEqual({
      visitors: 3,
      conversations: 4,
      questions: 7,
      statuses: {
        queued: 0,
        running: 0,
        completed: 6,
        failed: 1,
        interrupted: 0,
      },
      average_duration_ms: 1500,
    });
    expect(f.db.publicKnowledgeVisitor.count).toHaveBeenCalledWith({
      where: {
        applicationId: f.applicationId,
        createdAt: { gte: new Date(query.from), lte: new Date(query.to) },
      },
    });
    expect(f.db.$queryRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        values: expect.arrayContaining([
          f.applicationId,
          new Date(query.from),
          new Date(query.to),
        ]),
      }),
    );
  });
  it("returns zero statuses and no average when there are no questions", async () => {
    const f = fixture();
    f.db.$queryRaw.mockResolvedValue([]);
    expect(await f.service.usage(f.actor, f.applicationId, {})).toMatchObject({
      questions: 0,
      average_duration_ms: null,
      statuses: {
        queued: 0,
        running: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
      },
    });
  });
  it("rejects reversed date bounds before collecting statistics", async () => {
    const f = fixture();
    await expect(
      f.service.usage(f.actor, f.applicationId, {
        from: "2026-11-06T00:00:00Z",
        to: "2026-11-01T00:00:00Z",
      }),
    ).rejects.toThrow();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
  it("does not alter public settings when the application was removed concurrently", async () => {
    const f = fixture();
    f.db.application.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      f.service.setEnabled(f.actor, f.applicationId, false),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(f.db.publicKnowledgeApplication.update).not.toHaveBeenCalled();
  });
});
