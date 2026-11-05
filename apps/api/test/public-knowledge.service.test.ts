import { describe, expect, it, vi } from "vitest";
import type {
  PrismaClient,
  PublicKnowledgeTurn,
} from "../src/generated/prisma/client.js";
import { PublicKnowledgeService } from "../src/modules/public-knowledge/service.js";
import { publicKnowledgeSettingsSchema } from "@linksense/shared";
import { sha256 } from "../src/lib/crypto.js";
import { AppError } from "../src/lib/errors.js";
import { PublicKnowledgeCapacityUnavailableError } from "../src/modules/public-knowledge/coordinator.js";
import { publicKnowledgeProgressFixture } from "./fixtures/public-knowledge-progress.js";

const id = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const now = new Date("2026-11-05T00:00:00Z"),
  appId = id(1),
  ownerId = id(2),
  visitorId = id(3),
  conversationId = id(4),
  versionId = id(5),
  baseId = id(6);
const token = "anonymous-visitor-capability-".repeat(3),
  publicId = "public-application-identifier-1234";
const actor = { id: ownerId, role: "user", status: "active" } as const;
const settings = publicKnowledgeSettingsSchema.parse({
  name: "Website",
  instructions: "Use website knowledge",
  model: "model",
  reasoning_effort: "medium",
  knowledge_base_ids: [baseId],
  allowed_origins: ["https://website.example"],
});

function fixture() {
  const application = {
    id: appId,
    ownerId,
    kind: "public_knowledge",
    name: "Website",
    description: null,
    status: "active",
    publishedVersionId: versionId,
  };
  const visitor = {
    id: visitorId,
    applicationId: appId,
    tokenHash: sha256(token),
    origin: settings.allowed_origins[0],
    expiresAt: new Date("2026-12-01T00:00:00Z"),
  };
  const conversation = {
    id: conversationId,
    applicationId: appId,
    visitorId,
    title: "",
    codexThreadId: null as string | null,
    expiresAt: new Date("2026-12-01T00:00:00Z"),
    createdAt: now,
    updatedAt: now,
  };
  const turns: PublicKnowledgeTurn[] = [];
  const configuration = {
    applicationId: appId,
    publicId,
    settingsJson: { ...settings },
  };
  const findTurn = (where: {
    id?: string;
    conversationId_requestId?: { conversationId: string; requestId: string };
  }) =>
    turns.find((row) =>
      where.id
        ? row.id === where.id
        : row.conversationId ===
            where.conversationId_requestId?.conversationId &&
          row.requestId === where.conversationId_requestId.requestId,
    ) ?? null;
  const db = {
    application: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id: string;
            ownerId?: string;
            kind?: string;
            status?: string;
          };
        }) =>
          where.id === appId &&
          (!where.ownerId || where.ownerId === ownerId) &&
          (!where.kind || where.kind === application.kind) &&
          (typeof where.status !== "string" ||
            where.status === application.status)
            ? application
            : null,
      ),
    },
    publicKnowledgeApplication: {
      findUnique: vi.fn(async () => configuration),
    },
    publicKnowledgeVisitor: {
      findUnique: vi.fn(async () => visitor),
      findFirst: vi.fn(async ({ where }: { where: { tokenHash: string } }) =>
        where.tokenHash === visitor.tokenHash ? visitor : null,
      ),
      create: vi.fn(async () => visitor),
    },
    publicKnowledgeConversation: {
      findUnique: vi.fn(async () => conversation),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { id: string; applicationId: string; visitorId?: string };
        }) =>
          where.id === conversation.id &&
          where.applicationId === appId &&
          (!where.visitorId || where.visitorId === conversation.visitorId)
            ? conversation
            : null,
      ),
      update: vi.fn(async ({ data }: { data: Partial<typeof conversation> }) =>
        Object.assign(conversation, data),
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { title?: string };
          data: Partial<typeof conversation>;
        }) => {
          if (where.title === undefined || where.title === conversation.title)
            Object.assign(conversation, data);
          return { count: 1 };
        },
      ),
      create: vi.fn(async () => conversation),
    },
    publicKnowledgeTurn: {
      findUnique: vi.fn(
        async ({ where }: { where: Parameters<typeof findTurn>[0] }) =>
          findTurn(where),
      ),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => {
        const turn = findTurn(where);
        if (!turn) throw new Error("missing turn");
        return turn;
      }),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            conversationId: string;
            status?: string | { in: string[] };
            id?: string;
          };
        }) =>
          turns.find(
            (row) =>
              row.conversationId === where.conversationId &&
              (!where.status ||
                (typeof where.status === "string"
                  ? row.status === where.status
                  : where.status.in.includes(row.status))) &&
              (!where.id || row.id === where.id),
          ) ?? null,
      ),
      count: vi.fn(async () => turns.length),
      findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
        turns.filter((row) => !where.status || row.status === where.status),
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: Partial<PublicKnowledgeTurn> & {
            inputText: string;
            requestId: string;
          };
        }) => {
          const { requestId, inputText, ...other } = data;
          const turn: PublicKnowledgeTurn = {
            id: id(100 + turns.length),
            conversationId,
            applicationVersionId: versionId,
            applicationVersion: "1.0.0",
            requestId,
            inputText,
            outputText: "",
            model: "model",
            status: "running",
            citationsJson: [],
            codexTurnId: null,
            cancelRequestedAt: null,
            errorCode: null,
            createdAt: now,
            completedAt: null,
            ...other,
          };
          turns.push(turn);
          return turn;
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<PublicKnowledgeTurn>;
        }) => {
          const turn = findTurn(where);
          if (!turn) throw new Error("missing turn");
          return Object.assign(turn, data);
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            status?: string | { in: string[] };
            cancelRequestedAt?: null;
          };
          data: Partial<PublicKnowledgeTurn>;
        }) => {
          const turn = findTurn(where);
          if (
            !turn ||
            (where.status &&
              !(typeof where.status === "string"
                ? turn.status === where.status
                : where.status.in.includes(turn.status))) ||
            (where.cancelRequestedAt === null && turn.cancelRequestedAt)
          )
            return { count: 0 };
          Object.assign(turn, data);
          return { count: 1 };
        },
      ),
    },
    applicationVersion: {
      findFirst: vi.fn(async () => ({
        id: versionId,
        versionLabel: "1.0.0",
        definitionJson: {
          schemaVersion: 1,
          name: "Website",
          description: null,
          iconPreset: "bot",
          iconObjectKey: null,
          kind: "public_knowledge",
          instructions: "Only this website",
          usageInstructions: "",
          model: "model",
          reasoningEffort: "medium",
          interactivePackageId: null,
          capabilities: [],
          knowledgeBaseIds: [baseId],
          mcpServerIds: [],
        },
      })),
    },
    user: { create: vi.fn() },
    conversation: { create: vi.fn() },
    applicationRuntimeInstallation: { create: vi.fn() },
    $queryRaw: vi.fn(async (): Promise<unknown[]> => [conversation]),
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (action: (tx: typeof db) => Promise<unknown>) =>
      action(db),
    ),
  } as unknown as PrismaClient;
  const runner = {
    runPublicKnowledgeTurn: vi.fn(async () => ({
      threadId: "native-thread-a",
      turnId: "native-turn-a",
      status: "completed" as const,
      outputText: "Website answer [1]",
    })),
    readPublicKnowledgeResult: vi.fn(async () => null),
    interruptPublicKnowledgeTurn: vi.fn(async () => undefined),
  };
  const release = vi.fn(async () => undefined),
    coordinator = {
      rateLimit: vi.fn(async () => undefined),
      acquire: vi.fn(async () => ({ release, assertCurrent: vi.fn() })),
    };
  const retrieve = vi.fn(async () => ({
    citations: [
      {
        number: 1,
        knowledge_base_id: baseId,
        document_id: id(7),
        document_version_id: id(8),
        title: "Website page",
        page_numbers: [],
        excerpt: "Website evidence",
      },
    ],
    context: '[{"reference":1,"text":"Website evidence"}]',
  }));
  const audit = { write: vi.fn(async () => undefined) };
  const models = {
    resolveRuntime: vi.fn(),
    resolveModelTransitionRuntime: vi.fn(),
    resolveRuntimeForSelection: vi.fn(async () => ({
      model: "model",
      reasoningEffort: "medium" as const,
      provider: {
        revision: 1,
        baseUrl: "https://models.example/v1",
        protocolMode: "native_responses" as const,
        apiKey: "private-model-credential",
      },
    })),
  };
  const queue = {
    start: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
  const progress = publicKnowledgeProgressFixture();
  const service = new PublicKnowledgeService({
    progress,
    skills: {
      capture: vi.fn(),
      resolve: vi.fn(async () => []),
    },
    prisma,
    models,
    knowledge: { resolveUsableKnowledgeBaseIds: vi.fn(async () => [baseId]) },
    retrieve,
    runner,
    coordinator,
    audit,
    queue,
    now: () => now,
  });
  const askAndRun = async (question: {
    input_text: string;
    request_id: string;
  }) => {
    const queued = await service.ask(
      publicId,
      token,
      conversationId,
      question,
      "ip",
    );
    await service.executeQueuedTurn(queued.id);
    return (
      await service.visitorDetail(publicId, token, conversationId)
    ).turns.find((turn) => turn.id === queued.id);
  };
  return {
    service,
    progress,
    configuration,
    askAndRun,
    queue,
    db,
    application,
    visitor,
    conversation,
    turns,
    runner,
    retrieve,
    release,
    coordinator,
    audit,
  };
}

describe("public knowledge authorization and execution", () => {
  it("returns source names without excerpts to visitors and preserves full evidence for creator review", async () => {
    const f = fixture(),
      question = { input_text: "Question", request_id: id(81) };
    const answer = await f.askAndRun(question);
    expect(answer?.citations).toEqual([
      expect.objectContaining({ title: "Website page", excerpt: "" }),
    ]);
    expect(
      (await f.service.ownerDetail(actor, appId, conversationId)).turns[0]
        ?.citations[0]?.excerpt,
    ).toBe("Website evidence");
    f.configuration.settingsJson.show_references = false;
    expect(
      (
        await f.service.publicConfiguration(
          publicId,
          settings.allowed_origins[0]!,
        )
      ).show_references,
    ).toBe(false);
    expect(
      (await f.service.visitorDetail(publicId, token, conversationId)).turns[0]
        ?.citations,
    ).toEqual([]);
    expect(
      (await f.service.ask(publicId, token, conversationId, question, "ip"))
        .citations,
    ).toEqual([]);
    expect(
      (await f.service.ownerDetail(actor, appId, conversationId)).turns[0]
        ?.citations[0]?.excerpt,
    ).toBe("Website evidence");
  });
  it("reports the application's queued visitor count only while a question is waiting", async () => {
    const f = fixture();
    const queued = await f.service.ask(
      publicId,
      token,
      conversationId,
      { input_text: "Queued question", request_id: id(82) },
      "ip",
    );
    f.db.$queryRaw.mockClear().mockResolvedValue([{ count: 3 }]);
    expect(
      (await f.service.visitorDetail(publicId, token, conversationId))
        .queue_waiting_visitors,
    ).toBe(3);
    expect(f.db.$queryRaw).toHaveBeenCalledWith(
      expect.objectContaining({ values: expect.arrayContaining([appId]) }),
    );
    await f.service.interrupt(publicId, token, conversationId, queued.id);
    f.db.$queryRaw.mockClear();
    expect(
      (await f.service.visitorDetail(publicId, token, conversationId))
        .queue_waiting_visitors,
    ).toBeUndefined();
    expect(f.db.$queryRaw).not.toHaveBeenCalled();
  });
  it("lets only the creator review public conversations without invoking a worker", async () => {
    const f = fixture();
    const result = await f.service.ownerDetail(actor, appId, conversationId);
    expect(result.conversation.id).toBe(conversationId);
    await expect(
      f.service.ownerDetail({ ...actor, id: id(90) }, appId, conversationId),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    await expect(
      f.service.ownerDetail(
        { ...actor, id: id(90), role: "admin" },
        appId,
        conversationId,
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    expect(f.runner.readPublicKnowledgeResult).not.toHaveBeenCalled();
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
    expect(f.audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "public_knowledge_conversation_viewed",
        actorId: ownerId,
      }),
    );
  });
  it("does not extend creator inspection to ordinary or interactive applications", async () => {
    for (const kind of ["standard", "interactive"]) {
      const f = fixture();
      f.application.kind = kind;
      await expect(
        f.service.ownerDetail(actor, appId, conversationId),
      ).rejects.toMatchObject({ code: "APPLICATION_NOT_FOUND" });
    }
  });
  it("rejects another visitor's conversation and a forged capability", async () => {
    const f = fixture();
    f.conversation.visitorId = id(99);
    await expect(
      f.service.visitorDetail(publicId, token, conversationId),
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
    await expect(
      f.service.visitorDetail(
        publicId,
        "forged-token-".repeat(6),
        conversationId,
      ),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect(f.runner.readPublicKnowledgeResult).not.toHaveBeenCalled();
  });
  it("sends only selected website evidence and preserves conversation thread binding", async () => {
    const f = fixture();
    f.conversation.codexThreadId = "native-thread-a";
    const result = await f.askAndRun({
      input_text: "What can this product do?",
      request_id: id(30),
    });
    expect(result).toMatchObject({
      status: "completed",
      output_text: "Website answer [1]",
      application_version: "1.0.0",
    });
    expect(f.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        knowledgeBaseIds: [baseId],
        conversationId,
      }),
    );
    expect(f.runner.runPublicKnowledgeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: appId,
        conversationId,
        threadId: "native-thread-a",
      }),
    );
    expect(JSON.stringify(result)).not.toContain("private-model-credential");
    expect(f.db.user.create).not.toHaveBeenCalled();
    expect(f.db.conversation.create).not.toHaveBeenCalled();
    expect(f.db.applicationRuntimeInstallation.create).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("returns a completed idempotent request without starting another turn and rejects changed input", async () => {
    const f = fixture(),
      question = { input_text: "Question one", request_id: id(30) };
    const result = await f.askAndRun(question);
    await expect(
      f.service.ask(publicId, token, conversationId, question, "ip"),
    ).resolves.toEqual(result);
    await expect(
      f.service.ask(
        publicId,
        token,
        conversationId,
        { ...question, input_text: "different" },
        "ip",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.runner.runPublicKnowledgeTurn).toHaveBeenCalledOnce();
  });
  it("retains an uncertain dispatched request for observation rather than replaying it", async () => {
    const f = fixture(),
      question = { input_text: "Question", request_id: id(30) };
    f.runner.runPublicKnowledgeTurn.mockRejectedValueOnce(
      new AppError("RUNNER_UNAVAILABLE"),
    );
    const queued = await f.service.ask(
      publicId,
      token,
      conversationId,
      question,
      "ip",
    );
    await expect(f.service.executeQueuedTurn(queued.id)).rejects.toMatchObject({
      code: "RUNNER_UNAVAILABLE",
    });
    expect(f.release).toHaveBeenCalledWith({ retainUntilExpiry: true });
    expect(f.turns[0]?.status).toBe("running");
    expect(
      (await f.service.ask(publicId, token, conversationId, question, "ip"))
        .status,
    ).toBe("running");
    expect(f.runner.runPublicKnowledgeTurn).toHaveBeenCalledOnce();
  });
  it("records retrieval failure and releases admission without starting inference", async () => {
    const f = fixture();
    f.retrieve.mockRejectedValueOnce(
      new AppError("APPLICATION_DEPENDENCY_UNAVAILABLE"),
    );
    await expect(
      f.askAndRun({ input_text: "Question", request_id: id(30) }),
    ).rejects.toMatchObject({ code: "APPLICATION_DEPENDENCY_UNAVAILABLE" });
    expect(f.turns[0]?.status).toBe("failed");
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("enforces global/application admission before creating a native operation", async () => {
    const f = fixture();
    f.coordinator.acquire.mockRejectedValueOnce(
      new PublicKnowledgeCapacityUnavailableError(),
    );
    await expect(
      f.askAndRun({ input_text: "Question", request_id: id(30) }),
    ).resolves.toMatchObject({ status: "queued" });
    expect(f.turns[0]?.status).toBe("queued");
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
  });
  it("queues a question without starting inference in the HTTP request and cancels it before execution", async () => {
    const f = fixture();
    const queued = await f.service.ask(
      publicId,
      token,
      conversationId,
      { input_text: "Queued", request_id: id(35) },
      "ip",
    );
    expect(queued.status).toBe("queued");
    expect(f.queue.enqueue).toHaveBeenCalledWith(queued.id);
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
    await expect(
      f.service.ask(
        publicId,
        token,
        conversationId,
        { input_text: "Overlapping", request_id: id(36) },
        "ip",
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.service.interrupt(publicId, token, conversationId, queued.id);
    await f.service.executeQueuedTurn(queued.id);
    expect(f.turns[0]?.status).toBe("interrupted");
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
    expect(f.runner.interruptPublicKnowledgeTurn).not.toHaveBeenCalled();
  });
  it("marks failed queue admission and never starts an unaccepted question", async () => {
    const f = fixture();
    f.queue.enqueue.mockRejectedValueOnce(new AppError("RUNNER_UNAVAILABLE"));
    await expect(
      f.service.ask(
        publicId,
        token,
        conversationId,
        { input_text: "Question", request_id: id(34) },
        "ip",
      ),
    ).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    expect(f.turns[0]?.status).toBe("failed");
    const turn = f.turns[0];
    if (!turn) throw new Error("expected failed queued turn");
    await f.service.executeQueuedTurn(turn.id);
    expect(f.runner.runPublicKnowledgeTurn).not.toHaveBeenCalled();
  });
  it("does not grant a disallowed website a visitor identity", async () => {
    const f = fixture();
    await expect(
      f.service.startSession(publicId, "https://other.example", "ip"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.db.publicKnowledgeVisitor.create).not.toHaveBeenCalled();
  });
});
