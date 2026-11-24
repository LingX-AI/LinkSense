import { conversationReferenceDisplaySchema } from "@linksense/shared";
import { v5 as uuidv5 } from "uuid";
import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { RECOVERED_LOCAL_QUOTE_DRAFT_EVENT_TYPE } from "../src/modules/conversations/recovered-local-quote-draft.js";
import { settleDeploymentTasks } from "../src/operations/deployment-task-stop.js";

vi.mock("../src/modules/events/sequence.js", () => ({
  nextConversationEventSequence: vi.fn(async () => 1n),
}));

const now = new Date("2026-09-09T00:00:00Z");
const stringify = (value: unknown) =>
  JSON.stringify(value, (_key, entry) =>
    typeof entry === "bigint" ? entry.toString() : entry,
  );
const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const projectionTurnId = "30000000-0000-4000-8000-000000000001";
const attachmentId = "40000000-0000-4000-8000-000000000001";
const intent = {
  ownerId,
  conversationId,
  projectionTurnId,
  pendingRequestId: null,
  taskKind: "turn",
  planReviewId: null,
  inputText: "Retained request",
  collaborationMode: "default",
  priorityCapabilityIdsJson: [],
  knowledgeBaseIdsJson: [],
  attachmentsJson: [{ id: attachmentId }],
  idempotencyKey: "request-key",
};

const referenceId = "50000000-0000-4000-8000-000000000001";
const sourceConversationId = "50000000-0000-4000-8000-000000000002";
const sourceMessageId = "50000000-0000-4000-8000-000000000003";
const existingPendingId = "60000000-0000-4000-8000-000000000001";

// A literal question can itself begin with a well-formed annotation prompt.
const annotationShapedRequest = [
  "[LinkSense office annotation]",
  "Display metadata:",
  JSON.stringify({
    kind: "presentation_annotation",
    file_id: "50000000-0000-4000-8000-000000000004",
    file_name: "Quarterly review.pptx",
    annotations: [
      { request: "Improve this slide", slide_number: 3, selection_count: 2 },
    ],
    annotation_count: 1,
  }),
  "",
  "Annotation fingerprint:",
  "c".repeat(64),
  "",
  "User request:",
  "Improve this slide",
  "",
  "Apply the user request to the selected elements.",
].join("\n");

function quoteDisplay(request: string) {
  return conversationReferenceDisplaySchema.parse({
    kind: "conversation_reference",
    reference_id: referenceId,
    request,
    source_conversation_id: sourceConversationId,
    source_message_id: sourceMessageId,
    source_title: "Source task",
    selection_text: "quoted selection",
    recent_message_count: 0,
  });
}

function annotationPrompt(request: string) {
  return [
    "[LinkSense office annotation]",
    "Display metadata:",
    JSON.stringify(quoteDisplay(request)),
    "",
    "Annotation fingerprint:",
    "a".repeat(64),
    "",
    "User request:",
    request,
  ].join("\n");
}

function markerEvents(f: ReturnType<typeof fixture>) {
  return f.tx.conversationEvent.create.mock.calls
    .map(([call]) => call.data as Record<string, unknown>)
    .filter(
      (data) =>
        data.eventType === RECOVERED_LOCAL_QUOTE_DRAFT_EVENT_TYPE,
    );
}

function fixture() {
  const tx = {
    conversationTurn: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    conversationTurnStartIntent: {
      findMany: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
    },
    pendingRequest: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue({ queueNo: 4n }),
      create: vi.fn().mockResolvedValue({ id: projectionTurnId }),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    conversationFile: { updateMany: vi.fn() },
    conversationTurnAttempt: { updateMany: vi.fn() },
    conversationUserInputRequest: { updateMany: vi.fn() },
    conversationGoal: {
      findMany: vi.fn().mockResolvedValue([]),
      updateMany: vi.fn(),
    },
    conversationPlanReview: { updateMany: vi.fn() },
    conversation: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn(),
    },
    conversationEvent: { create: vi.fn() },
    auditLog: { create: vi.fn() },
    automationRun: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
    automation: { updateMany: vi.fn() },
  };
  // Only the Prisma boundary is mocked; real settlement ordering and events run.
  const transaction = vi.fn(
    async (callback: (client: Prisma.TransactionClient) => Promise<unknown>) =>
      callback(tx as unknown as Prisma.TransactionClient),
  );
  const prisma = { $transaction: transaction } as unknown as PrismaClient;
  const redis = { releaseTurnSlot: vi.fn().mockResolvedValue(undefined) };
  return { tx, prisma, redis, transaction };
}

describe("offline deployment settlement", () => {
  it("fails only active execution, blocks automatic replay and preserves history", async () => {
    const f = fixture();
    f.tx.conversationTurn.findMany.mockResolvedValue([
      { id: projectionTurnId, conversationId, interruptRequestedAt: null },
    ]);
    f.tx.pendingRequest.findMany.mockResolvedValue([
      { id: "pending", conversationId, queueNo: 1n },
    ]);
    await expect(
      settleDeploymentTasks(f.prisma, f.redis, now),
    ).resolves.toEqual({ turns: 1, starts: 0, pending: 1 });
    expect(f.tx.conversationTurn.findMany).toHaveBeenCalledWith({
      where: { status: "running" },
    });
    expect(f.tx.conversationTurn.update).toHaveBeenCalledWith({
      where: { id: projectionTurnId },
      data: expect.objectContaining({
        status: "failed",
        completedAt: now,
        errorCode: "DEPLOYMENT_STOPPED",
      }),
    });
    expect(f.tx.pendingRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "blocked_preflight",
          blockCode: "deployment_stopped",
          steerOperationId: null,
        }),
      }),
    );
    expect(f.tx.conversationEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: "conversation.error",
          payloadJson: expect.objectContaining({
            error_code: "DEPLOYMENT_STOPPED",
          }),
        }),
      }),
    );
    expect(f.redis.releaseTurnSlot).toHaveBeenCalledWith(
      conversationId,
      projectionTurnId,
    );
    expect(f.tx.conversationFile.updateMany).not.toHaveBeenCalled();
  });

  it("preserves unprojected input and attachments before removing its start intent", async () => {
    const f = fixture();
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([intent]);
    await settleDeploymentTasks(f.prisma, f.redis, now);
    expect(f.tx.pendingRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputText: intent.inputText,
        queueNo: 5n,
        status: "blocked_preflight",
        blockCode: "deployment_stopped",
      }),
    });
    expect(f.tx.conversationFile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          conversationId,
          id: { in: [attachmentId] },
          turnId: null,
        }),
        data: { pendingRequestId: projectionTurnId, status: "pending" },
      }),
    );
    expect(f.redis.releaseTurnSlot.mock.invocationCallOrder[0]).toBeLessThan(
      f.tx.conversationTurnStartIntent.delete.mock.invocationCallOrder[0]!,
    );
  });

  it("does not duplicate already projected input or create drafts for compaction", async () => {
    const f = fixture();
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      intent,
      { ...intent, taskKind: "compact" },
    ]);
    f.tx.conversationTurn.findUnique.mockResolvedValueOnce({
      id: projectionTurnId,
    });
    await settleDeploymentTasks(f.prisma, f.redis, now);
    expect(f.tx.pendingRequest.create).not.toHaveBeenCalled();
    expect(f.tx.conversationTurnStartIntent.delete).toHaveBeenCalledTimes(2);
  });

  it("rolls back instead of deleting intent when slot release fails", async () => {
    const f = fixture();
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([intent]);
    f.redis.releaseTurnSlot.mockRejectedValue(new Error("redis unavailable"));
    await expect(settleDeploymentTasks(f.prisma, f.redis, now)).rejects.toThrow(
      "redis unavailable",
    );
    expect(f.tx.conversationTurnStartIntent.delete).not.toHaveBeenCalled();
    expect(f.transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 60_000,
    });
  });

  it("rejects mismatched pending ownership before modifying a draft", async () => {
    const f = fixture();
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      { ...intent, pendingRequestId: "pending" },
    ]);
    f.tx.pendingRequest.findUnique.mockResolvedValue({
      id: "pending",
      conversationId: "other",
      submittedBy: ownerId,
    });
    await expect(
      settleDeploymentTasks(f.prisma, f.redis, now),
    ).rejects.toThrow();
    expect(f.tx.conversationFile.updateMany).not.toHaveBeenCalled();
    expect(f.tx.conversationTurnStartIntent.delete).not.toHaveBeenCalled();
  });

  it("excludes already settled drafts and completed automation history on reruns", async () => {
    const f = fixture();
    await settleDeploymentTasks(f.prisma, f.redis, now);
    expect(f.tx.pendingRequest.findMany).toHaveBeenCalledWith({
      where: {
        status: {
          in: ["waiting_previous_turn", "blocked_overload", "steering"],
        },
      },
    });
    expect(f.tx.automationRun.findMany).toHaveBeenCalledWith({
      where: {
        completedAt: null,
        OR: [
          { status: { in: ["dispatching", "queued"] } },
          { status: "started", turnId: { in: [] } },
        ],
      },
    });
    expect(f.tx.conversationEvent.create).not.toHaveBeenCalled();
  });

  it("fences active goals even in a gap between native continuation turns", async () => {
    const f = fixture();
    f.tx.conversationGoal.findMany.mockResolvedValue([{ conversationId }]);
    await settleDeploymentTasks(f.prisma, f.redis, now);
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "conversation_execution_stopped_for_deployment",
        targetId: conversationId,
        createdAt: now,
      }),
    });
    expect(f.tx.conversationGoal.updateMany).toHaveBeenCalledWith({
      where: { status: "active" },
      data: { status: "paused", activeTurnId: null },
    });
    expect(f.tx.conversationTurn.update).not.toHaveBeenCalled();
  });

  it("settles interrupted automation within target constraints while auditing its original links", async () => {
    const f = fixture();
    const scheduledFor = new Date("2026-09-08T10:20:00Z");
    f.tx.automationRun.findMany.mockResolvedValue([
      {
        id: "run",
        automationId: "automation",
        conversationId,
        turnId: projectionTurnId,
        pendingRequestId: null,
        scheduledFor,
      },
    ]);
    await settleDeploymentTasks(f.prisma, f.redis, now);
    expect(f.tx.automationRun.update).toHaveBeenCalledWith({
      where: { id: "run" },
      data: {
        status: "failed",
        turnId: null,
        pendingRequestId: null,
        errorCode: "DEPLOYMENT_STOPPED",
        completedAt: now,
      },
    });
    expect(f.tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "automation_run_stopped_for_deployment",
        targetId: "run",
        metadataJson: {
          conversation_id: conversationId,
          turn_id: projectionTurnId,
          pending_request_id: null,
          reason_code: "DEPLOYMENT_STOPPED",
        },
      }),
    });
    expect(f.tx.automation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "automation",
        OR: [{ lastRunAt: null }, { lastRunAt: { lte: scheduledFor } }],
      },
      data: { lastRunStatus: "failed", lastErrorCode: "DEPLOYMENT_STOPPED" },
    });
  });

  it("recovers an annotation-shaped local quote request exactly and marks it internally", async () => {
    const f = fixture();
    const display = quoteDisplay(annotationShapedRequest);
    const storedInput = annotationPrompt(annotationShapedRequest);
    expect(storedInput).not.toBe(annotationShapedRequest);
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      { ...intent, inputText: storedInput, messageDisplayJson: display },
    ]);
    f.tx.conversation.findFirst.mockResolvedValue({ id: conversationId });

    await settleDeploymentTasks(f.prisma, f.redis, now);

    expect(f.tx.conversation.findFirst).toHaveBeenCalledWith({
      where: {
        id: conversationId,
        ownerId,
        executionTarget: "local",
      },
      select: { id: true },
    });
    expect(f.tx.pendingRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: projectionTurnId,
        inputText: annotationShapedRequest,
        status: "blocked_preflight",
        blockCode: "deployment_stopped",
      }),
    });
    const stored = f.tx.pendingRequest.create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(stored.inputText).toBe(annotationShapedRequest);
    expect(stringify(stored)).not.toContain("quoted selection");
    expect(stringify(stored)).not.toContain("source task");

    const markers = markerEvents(f);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      // The marker closes the exact turn id the Mac admission guard checks.
      id: uuidv5("desktop-start-stop", projectionTurnId),
      conversationId,
      turnId: null,
      visibility: "internal_sanitized",
    });
    expect(markers[0]!.payloadJson).toEqual({
      schema_version: 1,
      pending_request_id: projectionTurnId,
    });
    expect(markers[0]!.eventType).not.toBe(
      "conversation.references.pending",
    );
    expect(stringify(markers[0])).not.toContain("LinkSense");
    expect(stringify(markers[0])).not.toContain("quoted selection");
  });

  it("keeps the stored prompt for a cloud quote intent", async () => {
    const f = fixture();
    const display = quoteDisplay(annotationShapedRequest);
    const storedInput = annotationPrompt(annotationShapedRequest);
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      { ...intent, inputText: storedInput, messageDisplayJson: display },
    ]);

    await settleDeploymentTasks(f.prisma, f.redis, now);

    expect(f.tx.pendingRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputText: storedInput,
        status: "blocked_preflight",
        blockCode: "deployment_stopped",
      }),
    });
    expect(markerEvents(f)).toHaveLength(0);
  });

  it("keeps the stored prompt for a malformed local quote display", async () => {
    const f = fixture();
    const storedInput = annotationPrompt(annotationShapedRequest);
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      {
        ...intent,
        inputText: storedInput,
        messageDisplayJson: { kind: "conversation_reference" },
      },
    ]);
    f.tx.conversation.findFirst.mockResolvedValue({ id: conversationId });

    await settleDeploymentTasks(f.prisma, f.redis, now);

    expect(f.tx.pendingRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inputText: storedInput,
        blockCode: "deployment_stopped",
      }),
    });
    expect(markerEvents(f)).toHaveLength(0);
  });

  it("does not rewrite or mark an existing pending draft reused by settlement", async () => {
    const f = fixture();
    const display = quoteDisplay(annotationShapedRequest);
    f.tx.conversationTurnStartIntent.findMany.mockResolvedValue([
      {
        ...intent,
        pendingRequestId: existingPendingId,
        inputText: annotationPrompt(annotationShapedRequest),
        messageDisplayJson: display,
      },
    ]);
    f.tx.pendingRequest.findUnique.mockResolvedValue({
      id: existingPendingId,
      conversationId,
      submittedBy: ownerId,
    });
    f.tx.conversation.findFirst.mockResolvedValue({ id: conversationId });

    await settleDeploymentTasks(f.prisma, f.redis, now);

    expect(f.tx.pendingRequest.create).not.toHaveBeenCalled();
    expect(f.tx.pendingRequest.update).toHaveBeenCalledWith({
      where: { id: existingPendingId },
      data: expect.objectContaining({
        status: "blocked_preflight",
        blockCode: "deployment_stopped",
        steerOperationId: null,
      }),
    });
    expect(markerEvents(f)).toHaveLength(0);
  });
});
