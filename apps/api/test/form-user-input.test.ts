import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient, type ConversationUserInputRequest } from "../src/generated/prisma/client.js";
import type { ConversationUserInputResponse } from "@linksense/shared";
import { respondToFormUserInput } from "../src/modules/conversations/form-user-input.js";
import type { RunnerClient } from "../src/adapters/runner.js";

const ownerId = "10000000-0000-4000-8000-000000000001";
const conversationId = "20000000-0000-4000-8000-000000000001";
const requestId = "30000000-0000-4000-8000-000000000001";
const turnId = "40000000-0000-4000-8000-000000000001";
const createdAt = new Date("2026-10-27T00:00:00Z");
const deadline = new Date(createdAt.getTime() + 180_000);

function setup(optional = true) {
  let row: ConversationUserInputRequest = {
    id: requestId, ownerId, conversationId, turnId, codexThreadId: "thread", codexTurnId: "turn", codexItemId: "form", nativeRequestId: 17n,
    requestKind: "form", questionsJson: [], serverName: "linksense_core", messageText: "Choose the scope",
    formSchemaJson: { type: "object", properties: { scope: { type: "string", enum: ["small", "full"] } }, required: ["scope"] },
    formUiHintsJson: {}, formResponseSemanticsJson: { kind: "input" },
    formWaitingPolicyJson: optional ? { kind: "optional", recommendation: { scope: "small" } } : { kind: "required" },
    responseSource: null, responseContentJson: null, responseDeliveryJson: null,
    status: "pending", autoResolveAt: optional ? deadline : null, resolvedAction: null, resolvedAt: null, createdAt, updatedAt: createdAt,
  };
  let now = createdAt;
  const apply = (data: Record<string, unknown>) => {
    row = { ...row, ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : value])), updatedAt: now };
    return { ...row };
  };
  const model = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => where.ownerId === row.ownerId && where.conversationId === row.conversationId ? { ...row } : null),
    findUniqueOrThrow: vi.fn(async () => ({ ...row })),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => apply(data)),
    updateMany: vi.fn(async ({ where, data }: { where: { status?: string }; data: Record<string, unknown> }) => {
      if (where.status && where.status !== row.status) return { count: 0 };
      apply(data); return { count: 1 };
    }),
  };
  const tx = {
    $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 1), conversationUserInputRequest: model,
    conversation: { findFirst: vi.fn(async () => ({ id: conversationId, codexThreadId: "thread" })) },
    conversationTurn: { findFirst: vi.fn<() => Promise<{ id: string } | null>>(async () => ({ id: turnId })) },
    conversationEvent: { findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
  };
  let transactions = Promise.resolve();
  const prisma = { ...tx, $transaction: (callback: (client: typeof tx) => Promise<unknown>) => {
    const result = transactions.then(() => callback(tx));
    transactions = result.then(() => undefined, () => undefined);
    return result;
  } } as unknown as PrismaClient;
  const runner = { respondUserInputRequest: vi.fn<RunnerClient["respondUserInputRequest"]>(async () => ({ accepted: true as const })) };
  return {
    runner, tx, get row() { return row }, change: apply,
    answer: (response?: ConversationUserInputResponse, at = deadline, overrides: { ownerId?: string; conversationId?: string } = {}) => {
      now = at;
      return respondToFormUserInput({ prisma, runner, ownerId, conversationId, requestId, ...(response ? { response } : {}), now: at, ...overrides });
    },
  };
}

describe("form waiting and recommendation delivery", () => {
  it("keeps required forms waiting indefinitely and disallows skipping", async () => {
    const fixture = setup(false);
    await fixture.answer(undefined, new Date(deadline.getTime() + 86_400_000));
    expect(fixture.row.status).toBe("pending");
    expect(fixture.runner.respondUserInputRequest).not.toHaveBeenCalled();
    await expect(fixture.answer({ action: "cancel" })).rejects.toThrow();
    await fixture.answer({ action: "accept", content: { scope: "full" } });
    expect(fixture.row).toMatchObject({ status: "answered", responseSource: "user", responseContentJson: { scope: "full" } });
  });

  it("waits the full three minutes and then delivers the stored recommendation once", async () => {
    const fixture = setup();
    await fixture.answer(undefined, new Date(deadline.getTime() - 1));
    expect(fixture.runner.respondUserInputRequest).not.toHaveBeenCalled();
    await fixture.answer();
    await fixture.answer();
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ response: { action: "accept", content: { scope: "small" } } }));
    expect(fixture.row).toMatchObject({ status: "answered", responseSource: "recommendation" });
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
  });

  it("uses an on-time user answer and never replaces it with the recommendation", async () => {
    const fixture = setup();
    await fixture.answer({ action: "accept", content: { scope: "full" } }, new Date(deadline.getTime() - 1));
    await fixture.answer();
    expect(fixture.row).toMatchObject({ responseSource: "user", responseContentJson: { scope: "full" } });
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce();
  });

  it("uses the recommendation for late submissions instead of a draft", async () => {
    const fixture = setup();
    await fixture.answer({ action: "accept", content: { scope: "full" } });
    expect(fixture.row).toMatchObject({ responseSource: "recommendation", responseContentJson: { scope: "small" } });
  });

  it("does not deliver twice when a user submission and the timeout race", async () => {
    const fixture = setup();
    await Promise.all([fixture.answer({ action: "accept", content: { scope: "full" } }), fixture.answer()]);
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce();
    expect(fixture.row.responseSource).toBe("recommendation");
  });

  it.each([true, false])("allows only one responder to reclaim an abandoned delivery for optional=%s", async optional => {
    const fixture = setup(optional);
    fixture.change({ status: "answering", resolvedAction: "accept", responseSource: optional ? "recommendation" : "user", responseContentJson: { scope: "small" } });
    const response = optional ? undefined : { action: "accept" as const, content: { scope: "small" } };
    await Promise.all([fixture.answer(response), fixture.answer(response)]);
    expect(fixture.runner.respondUserInputRequest).toHaveBeenCalledOnce();
    expect(fixture.tx.conversationEvent.create).toHaveBeenCalledOnce();
    expect(fixture.row.status).toBe("answered");
  });

  it("retains the first claimed answer across a delivery failure and retries the same request", async () => {
    const fixture = setup();
    fixture.runner.respondUserInputRequest.mockRejectedValueOnce(new Error("Runner unavailable"));
    await expect(fixture.answer({ action: "accept", content: { scope: "full" } }, new Date(deadline.getTime() - 1))).rejects.toThrow("Runner unavailable");
    await fixture.answer();
    expect(fixture.row).toMatchObject({ responseSource: "user", responseContentJson: { scope: "full" } });
    expect(fixture.runner.respondUserInputRequest.mock.calls.map(call => call[0])).toEqual([expect.objectContaining({ requestId: 17 }), expect.objectContaining({ requestId: 17 })]);
  });

  it("never auto-approves an approval form even with an optional policy in stored data", async () => {
    const fixture = setup();
    fixture.change({ formResponseSemanticsJson: { kind: "approval", decision_field_id: "scope", approve_value: "full", reject_value: "small" } });
    await expect(fixture.answer()).rejects.toThrow();
    expect(fixture.runner.respondUserInputRequest).not.toHaveBeenCalled();
  });

  it.each(["ownerId", "conversationId"] as const)("rejects a form outside the submitted %s", async key => {
    const fixture = setup();
    await expect(fixture.answer(undefined, deadline, { [key]: "50000000-0000-4000-8000-000000000001" })).rejects.toThrow();
    expect(fixture.runner.respondUserInputRequest).not.toHaveBeenCalled();
  });

  it("keeps pre-change forms usable without inventing a recommendation", async () => {
    const fixture = setup(false);
    fixture.change({ formWaitingPolicyJson: null });
    await fixture.answer({ action: "accept", content: { scope: "full" } });
    expect(fixture.row.status).toBe("answered");
  });

  it("rejects responses for stopped turns", async () => {
    const fixture = setup();
    fixture.tx.conversationTurn.findFirst.mockResolvedValueOnce(null);
    await expect(fixture.answer()).rejects.toThrow();
    expect(fixture.runner.respondUserInputRequest).not.toHaveBeenCalled();
  });
});
