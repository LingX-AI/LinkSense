import { describe, expect, it, vi } from "vitest";

import type { DesktopApprovalResponse } from "@linksense/shared";
import type { RunnerClient } from "../src/adapters/runner.js";
import type { ConversationDesktopApproval, Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { AppError } from "../src/lib/errors.js";
import {
  cancelDesktopApprovals,
  projectDesktopApproval,
  resolveDesktopApproval,
  respondToDesktopApproval,
} from "../src/modules/conversations/desktop-approvals.js";
import type { DesktopProjectionFence } from "../src/modules/desktop-credentials/run-authority.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const turnId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const deliveryId = "50000000-0000-4000-8000-000000000001";
const deviceId = "60000000-0000-4000-8000-000000000001";
const runtimeGeneration = "70000000-0000-4000-8000-000000000001";
const codexThreadId = "codex-thread-1";
const codexTurnId = "codex-turn-1";
const codexItemId = "item-1";
const nativeRequestId = 17n;
const createdAt = new Date("2026-11-20T00:00:00.000Z");
const approval = {
  method: "item/commandExecution/requestApproval" as const,
  decisions: ["accept", "decline", "cancel"],
  command: "printf 'approved\\n'",
  cwd: "workspace",
};
const response: DesktopApprovalResponse = { method: approval.method, decision: "accept" };

type ApprovalRow = {
  id: string;
  conversationId: string;
  turnId: string;
  ownerId: string;
  codexThreadId: string;
  codexTurnId: string;
  codexItemId: string;
  nativeRequestId: bigint;
  approvalJson: unknown;
  status: string;
  expiresAt: Date;
  resolvedAction: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Where = {
  id?: string;
  ownerId?: string;
  conversationId?: string;
  turnId?: string;
  status?: string | { in: string[] };
  resolvedAction?: string | null;
  expiresAt?: { gt: Date };
};

function setup(overrides: Partial<ApprovalRow> = {}) {
  let row: ApprovalRow = {
    id: requestId, conversationId, turnId, ownerId,
    codexThreadId, codexTurnId, codexItemId, nativeRequestId,
    approvalJson: approval, status: "pending",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    resolvedAction: null, resolvedAt: null, createdAt, updatedAt: createdAt,
    ...overrides,
  };
  const audits: Array<Record<string, unknown>> = [];
  let sequence = 0n;
  const matches = (candidate: ApprovalRow, where: Where) => {
    if (where.id !== undefined && candidate.id !== where.id) return false;
    if (where.ownerId !== undefined && candidate.ownerId !== where.ownerId) return false;
    if (where.conversationId !== undefined && candidate.conversationId !== where.conversationId) return false;
    if (where.turnId !== undefined && candidate.turnId !== where.turnId) return false;
    if (where.status !== undefined) {
      if (typeof where.status === "string") {
        if (candidate.status !== where.status) return false;
      } else if (!where.status.in.includes(candidate.status)) return false;
    }
    if ("resolvedAction" in where && candidate.resolvedAction !== where.resolvedAction) return false;
    if (where.expiresAt && candidate.expiresAt.getTime() <= where.expiresAt.gt.getTime()) return false;
    return true;
  };
  const apply = (data: Record<string, unknown>) => {
    row = { ...row, ...data, updatedAt: createdAt } as ApprovalRow;
    return { ...row };
  };
  const branch = {
    revokedAt: null, deviceEpoch: createdAt, ownerEpoch: createdAt,
    ownerStatus: "active", codexThreadId,
  };
  const tx = {
    $queryRaw: vi.fn(async () => [branch]),
    $executeRaw: vi.fn(async () => 1),
    conversationTurn: { findFirst: vi.fn(async () => ({ id: turnId })) },
    conversationDesktopApproval: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => matches(row, where) ? { ...row } : null),
      findUnique: vi.fn(async ({ where }: { where: { turnId_nativeRequestId: { turnId: string; nativeRequestId: bigint } } }) => {
        const key = where.turnId_nativeRequestId;
        return key.turnId === row.turnId && key.nativeRequestId === row.nativeRequestId ? { ...row } : null;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => apply(data)),
      updateMany: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        if (!matches(row, where)) return { count: 0 };
        apply(data);
        return { count: 1 };
      }),
      updateManyAndReturn: vi.fn(async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
        if (!matches(row, where)) return [];
        return [apply(data)];
      }),
    },
    conversationEvent: {
      findFirst: vi.fn(async () => null as { sequenceNo: bigint } | null),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: deliveryId, createdAt, sequenceNo: ++sequence, ...data,
      })),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    conversationDesktopApproval: tx.conversationDesktopApproval,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
  const fence: DesktopProjectionFence = {
    scope: { ownerId, conversationId, deviceId, runtimeGeneration, turnId },
    check: vi.fn(async () => undefined),
    approvals: true,
  };
  const runner = {
    respondUserInputRequest: vi.fn<RunnerClient["respondUserInputRequest"]>(
      async () => ({ accepted: true as const }),
    ),
  };
  const respond = (input: DesktopApprovalResponse = response) => respondToDesktopApproval({
    prisma: prisma as unknown as PrismaClient,
    runner,
    scope: fence.scope,
    requestId,
    response: input,
    context: { actorId: ownerId },
  });
  return {
    prisma, tx, fence, runner, respond, audits,
    get row() { return row; },
    resolve: (delivery = deliveryId) => resolveDesktopApproval(
      prisma as unknown as PrismaClient, fence, codexThreadId, Number(nativeRequestId), delivery,
    ),
    cancel: (at = createdAt) => cancelDesktopApprovals(
      tx as unknown as Prisma.TransactionClient, turnId, at,
    ),
  };
}

describe("desktop approval delivery state and audit", () => {
  it("closes an unanswered native prompt as cancelled without a decision or timeout claim", async () => {
    const fixture = setup();
    const event = await fixture.resolve();
    expect(fixture.row).toMatchObject({ status: "cancelled", resolvedAction: null });
    expect(fixture.row.resolvedAt).toBeInstanceOf(Date);
    expect(event?.payloadJson).toMatchObject({
      user_input_request_id: requestId,
      status: "cancelled",
    });
    expect(fixture.audits).toHaveLength(0);
  });

  it.each(["accept", "decline", "cancel"] as const)(
    "keeps a sent %s decision unconfirmed when the native prompt closes",
    async decision => {
      const fixture = setup({ status: "answering", resolvedAction: decision });
      const event = await fixture.resolve();
      expect(fixture.row).toMatchObject({ status: "unconfirmed", resolvedAction: decision });
      expect(projectDesktopApproval(fixture.row as ConversationDesktopApproval).status)
        .toBe("unconfirmed");
      // The durable event retains the original five-value contract.
      expect(event?.payloadJson).toMatchObject({ status: "cancelled" });
    },
  );

  it("resolves an unconfirmed card when the real receipt arrives", async () => {
    const fixture = setup();
    let release: () => void = () => undefined;
    const receipt = new Promise<void>(resolve => { release = resolve; });
    fixture.runner.respondUserInputRequest.mockImplementationOnce(async () => {
      await receipt;
      return { accepted: true as const };
    });
    const pending = fixture.respond();
    void pending.catch(() => undefined);
    await vi.waitFor(() => expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce());

    // Claim is durable before delivery, and its audit says the reply is unconfirmed.
    expect(fixture.audits).toHaveLength(1);
    expect(fixture.audits[0]?.metadataJson).toMatchObject({
      action: "accept", operation: approval.method, delivery: "unconfirmed",
    });
    expect(Object.keys(fixture.audits[0]?.metadataJson as object).sort()).toEqual([
      "action", "conversation_id", "delivery", "operation", "turn_id",
    ]);

    await fixture.resolve();
    expect(fixture.row.status).toBe("unconfirmed");
    release();
    await expect(pending).resolves.toMatchObject({
      stored: expect.objectContaining({ status: "answered", resolvedAction: "accept" }),
    });
    expect(fixture.row).toMatchObject({ status: "answered", resolvedAction: "accept" });
    expect(fixture.audits.map(audit => (audit.metadataJson as { delivery: string }).delivery))
      .toEqual(["unconfirmed", "confirmed"]);
  });

  it("keeps a turn-end closure resolvable by a late receipt", async () => {
    const fixture = setup();
    let release: () => void = () => undefined;
    const receipt = new Promise<void>(resolve => { release = resolve; });
    fixture.runner.respondUserInputRequest.mockImplementationOnce(async () => {
      await receipt;
      return { accepted: true as const };
    });
    const pending = fixture.respond({ method: approval.method, decision: "decline" });
    void pending.catch(() => undefined);
    await vi.waitFor(() => expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce());
    await fixture.cancel();
    expect(fixture.row).toMatchObject({ status: "unconfirmed", resolvedAction: "decline" });
    release();
    await pending;
    expect(fixture.row).toMatchObject({ status: "cancelled", resolvedAction: "decline" });
  });

  it("does not reopen or resend an uncertain decision", async () => {
    const fixture = setup();
    fixture.runner.respondUserInputRequest.mockRejectedValueOnce(
      new AppError("RUNNER_OPERATION_UNCERTAIN"),
    );
    await expect(fixture.respond()).rejects.toMatchObject({ code: "RUNNER_OPERATION_UNCERTAIN" });
    expect(fixture.row.status).toBe("answering");
    expect(fixture.audits).toHaveLength(1);
    await expect(fixture.respond()).rejects.toMatchObject({
      code: "USER_INPUT_REQUEST_UNAVAILABLE",
    });
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce();
  });

  it("does not reopen a decision after an unexpected transport failure", async () => {
    const fixture = setup();
    fixture.runner.respondUserInputRequest.mockRejectedValueOnce(new Error("transport failed"));
    await expect(fixture.respond()).rejects.toThrow("transport failed");
    expect(fixture.row).toMatchObject({ status: "answering", resolvedAction: "accept" });
    await expect(fixture.respond()).rejects.toMatchObject({ code: "USER_INPUT_REQUEST_UNAVAILABLE" });
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce();
  });

  it("reopens a definitely undelivered answer for a retry", async () => {
    const fixture = setup();
    fixture.runner.respondUserInputRequest.mockRejectedValueOnce(
      new AppError("RUNNER_UNAVAILABLE"),
    );
    await expect(fixture.respond()).rejects.toMatchObject({ code: "RUNNER_UNAVAILABLE" });
    expect(fixture.row).toMatchObject({ status: "pending", resolvedAction: null });
    await fixture.respond();
    expect(fixture.row).toMatchObject({ status: "answered", resolvedAction: "accept" });
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledTimes(2);
  });

  it("keeps an unconfirmed card unconfirmed after an uncertain receipt", async () => {
    const fixture = setup();
    let reject: (error: Error) => void = () => undefined;
    const receipt = new Promise<{ accepted: true }>((_, rejectReceipt) => {
      reject = rejectReceipt;
    });
    fixture.runner.respondUserInputRequest.mockImplementationOnce(() => receipt);
    const pending = fixture.respond();
    const outcome = pending.catch(error => error);
    await vi.waitFor(() => expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce());
    await fixture.resolve();
    reject(new AppError("RUNNER_OPERATION_UNCERTAIN"));
    await expect(outcome).resolves.toMatchObject({ code: "RUNNER_OPERATION_UNCERTAIN" });
    expect(fixture.row).toMatchObject({ status: "unconfirmed", resolvedAction: "accept" });
    expect(fixture.audits).toHaveLength(1);
  });

  it("closes a pre-delivery rejection without a user cancellation decision", async () => {
    const fixture = setup();
    fixture.runner.respondUserInputRequest.mockRejectedValueOnce(
      new AppError("USER_INPUT_REQUEST_UNAVAILABLE"),
    );
    await expect(fixture.respond()).rejects.toMatchObject({
      code: "USER_INPUT_REQUEST_UNAVAILABLE",
    });
    expect(fixture.row).toMatchObject({ status: "cancelled", resolvedAction: null });
    // The sanitized audit still preserves what the user chose.
    expect(fixture.audits[0]?.metadataJson).toMatchObject({
      action: "accept", delivery: "unconfirmed",
    });
  });

  it("closes pending turn work without a decision and in-flight work as unconfirmed", async () => {
    const pending = setup();
    await pending.cancel();
    expect(pending.row).toMatchObject({
      status: "cancelled", resolvedAction: null, resolvedAt: createdAt,
    });

    const inFlight = setup({ status: "answering", resolvedAction: "decline" });
    await inFlight.cancel();
    expect(inFlight.row).toMatchObject({
      status: "unconfirmed", resolvedAction: "decline", resolvedAt: createdAt,
    });
  });

  it("ignores a repeated native close after an unconfirmed closure", async () => {
    const fixture = setup({ status: "unconfirmed", resolvedAction: "accept" });
    await expect(fixture.resolve("80000000-0000-4000-8000-000000000001")).resolves.toBeNull();
    expect(fixture.row).toMatchObject({ status: "unconfirmed", resolvedAction: "accept" });
  });
});
