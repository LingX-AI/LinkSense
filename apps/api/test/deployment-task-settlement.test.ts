import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { settleDeploymentTasks } from "../src/operations/deployment-task-stop.js";

vi.mock("../src/modules/events/sequence.js", () => ({
  nextConversationEventSequence: vi.fn(async () => 1n),
}));

const now = new Date("2026-09-09T00:00:00Z");
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
    conversation: { update: vi.fn() },
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
});
