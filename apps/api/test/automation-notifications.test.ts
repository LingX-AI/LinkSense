import { describe, expect, it, vi } from "vitest";
import type { AutomationNotificationDelivery, PrismaClient } from "../src/generated/prisma/client.js";
import { AutomationNotificationService } from "../src/modules/automations/notifications.js";

const id = "11111111-1111-4111-8111-111111111111";
const target = { kind: "feishu" as const, connection_id: id, peer_session_id: "22222222-2222-4222-8222-222222222222" };
function fixture() {
  const row: AutomationNotificationDelivery = { id, ownerId: id, automationId: id, runId: id, targetJson: target, attempts: 0, status: "pending", createdAt: new Date(), updatedAt: new Date(), nextAttemptAt: new Date(), processingToken: null, lastErrorCode: null, sentAt: null };
  const db = {
    automationNotificationDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn().mockResolvedValue({ id }), findMany: vi.fn().mockResolvedValue([row]) },
    automation: { findFirst: vi.fn().mockResolvedValue({ title: "Brief", notificationTargetJson: target }) },
    automationRun: { findFirst: vi.fn().mockResolvedValue({ id, conversationId: id, turnId: id, idempotencyKey: "scheduled-run", status: "started", completedAt: new Date() }) },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue({ id }) },
    user: { findFirst: vi.fn().mockResolvedValue({ preferredLocale: "en-US" }) },
    conversation: { findFirst: vi.fn().mockResolvedValue({ id }) },
    feishuConnection: { findFirst: vi.fn().mockResolvedValue({ id, ownerId: id, ownerOpenId: "owner" }) },
    feishuPeerSession: { findFirst: vi.fn().mockResolvedValue({ chatId: "verified-chat" }) },
  };
  const feishu = vi.fn(async (input: { beforeSend: () => Promise<void>; text: string }) => { await input.beforeSend(); });
  const senders = { feishu, bot: vi.fn().mockResolvedValue(undefined), outcome: vi.fn().mockResolvedValue({ status: "completed", text: "Result" }) };
  return { db, row, senders, service: new AutomationNotificationService(db as unknown as PrismaClient, senders, () => new Date("2026-10-22T00:00:00Z")) };
}
describe("automation result notifications", () => {
  it("sends a bounded summary to a verified owner destination and records it as sent", async () => {
    const { db, row, senders, service } = fixture(); senders.outcome.mockResolvedValue({ status: "completed", text: "x".repeat(5000) });
    await service.deliver(row);
    expect(senders.feishu).toHaveBeenCalledWith(expect.objectContaining({ ownerId: id, chatId: "verified-chat", idempotencyKey: id }));
    expect(senders.feishu.mock.calls[0]?.[0].text.length).toBeLessThan(1500);
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) }));
  });
  it.each(["disabled", "deleted", "inactive_owner", "source_deleted"])("cancels delivery when %s", async condition => {
    const { db, row, senders, service } = fixture();
    if (condition === "disabled") db.automation.findFirst.mockResolvedValue({ title: "Brief", notificationTargetJson: null });
    if (condition === "deleted") db.automation.findFirst.mockResolvedValue(null);
    if (condition === "inactive_owner") db.user.findFirst.mockResolvedValue(null);
    if (condition === "source_deleted") db.conversation.findFirst.mockResolvedValue(null);
    await service.deliver(row);
    expect(senders.feishu).not.toHaveBeenCalled();
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it("waits for a result without consuming an attempt or resubmitting the task", async () => {
    const { db, row, senders, service } = fixture(); db.automationRun.findFirst.mockResolvedValue({ id, conversationId: id, turnId: id, status: "started", completedAt: null });
    await service.deliver(row);
    expect(senders.feishu).not.toHaveBeenCalled();
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "pending" }) }));
    expect(db.automationNotificationDelivery.updateMany.mock.lastCall?.[0].data).not.toHaveProperty("attempts");
  });
  it.each(["started", "queued"])("notifies a native failure even when the %s run has no completion timestamp", async status => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({ id, conversationId: id, turnId: status === "queued" ? null : id, idempotencyKey: "scheduled-run", status, completedAt: null });
    senders.outcome.mockResolvedValue({ status: "failed" });
    await service.deliver(row);
    expect(senders.feishu).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("failed") }));
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) }));
  });
  it.each(["scheduled", "manual"])("notifies a failed %s fresh dispatch when its task was never created", async trigger => {
    const { db, row, senders, service } = fixture();
    const freshTask = "33333333-3333-4333-8333-333333333333";
    db.automationRun.findFirst.mockResolvedValue({
      id, conversationId: freshTask, turnId: null, status: "failed", completedAt: null,
      executionContextJson: { trigger, context_mode: "fresh_task", stop_condition: null, target_conversation_id: id },
    });
    db.conversation.findFirst.mockImplementation(async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.id === id && where.ownerId === id ? { id } : null);
    await service.deliver(row);
    expect(senders.feishu).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("failed") }));
    expect(senders.outcome).not.toHaveBeenCalled();
    expect(db.conversation.findFirst).toHaveBeenLastCalledWith({ where: { id, ownerId: id }, select: { id: true } });
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "sent" }) }));
  });
  it.each([undefined, null])("keeps a failed legacy run usable with execution context %s", async executionContextJson => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({ id, conversationId: id, turnId: null, status: "failed", completedAt: null, executionContextJson });
    await service.deliver(row);
    expect(senders.feishu).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("failed") }));
    expect(db.conversation.findFirst).toHaveBeenCalledTimes(2);
  });
  it.each([
    undefined,
    null,
    { trigger: "scheduled", context_mode: "reuse_task", stop_condition: null, target_conversation_id: id },
    { trigger: "scheduled", context_mode: "fresh_task", stop_condition: null },
    { context_mode: "fresh_task", target_conversation_id: id },
  ])("does not invent a fallback for a missing task with invalid or legacy context %j", async executionContextJson => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({ id, conversationId: "33333333-3333-4333-8333-333333333333", turnId: null, status: "failed", completedAt: null, executionContextJson });
    db.conversation.findFirst.mockResolvedValue(null);
    await service.deliver(row);
    expect(senders.feishu).not.toHaveBeenCalled();
    expect(db.conversation.findFirst).toHaveBeenCalledOnce();
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it.each([null, "44444444-4444-4444-8444-444444444444"])("does not notify a failed fresh dispatch when the original task is deleted or owned by %s", async sourceOwner => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({
      id, conversationId: "33333333-3333-4333-8333-333333333333", turnId: null, status: "failed", completedAt: null,
      executionContextJson: { trigger: "scheduled", context_mode: "fresh_task", stop_condition: null, target_conversation_id: id },
    });
    db.conversation.findFirst.mockImplementation(async ({ where }: { where: { id: string; ownerId: string } }) =>
      where.id === id && where.ownerId === sourceOwner ? { id } : null);
    await service.deliver(row);
    expect(senders.feishu).not.toHaveBeenCalled();
    expect(db.conversation.findFirst).toHaveBeenLastCalledWith({ where: { id, ownerId: id }, select: { id: true } });
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it("rechecks the original task before sending a failed fresh-dispatch notification", async () => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({
      id, conversationId: "33333333-3333-4333-8333-333333333333", turnId: null, status: "failed", completedAt: null,
      executionContextJson: { trigger: "scheduled", context_mode: "fresh_task", stop_condition: null, target_conversation_id: id },
    });
    db.conversation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id }).mockResolvedValueOnce(null);
    await service.deliver(row);
    await expect(senders.feishu.mock.results[0]?.value).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.conversation.findFirst).toHaveBeenLastCalledWith({ where: { id, ownerId: id }, select: { id: true } });
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it("resolves the original turn of a queued run and includes its final answer", async () => {
    const { db, row, senders, service } = fixture();
    db.automationRun.findFirst.mockResolvedValue({ id, conversationId: id, turnId: null, idempotencyKey: "scheduled-run", status: "queued", completedAt: new Date() });
    await service.deliver(row);
    expect(db.conversationTurn.findFirst).toHaveBeenCalledWith({ where: { conversationId: id, submittedBy: id, idempotencyKey: "scheduled-run" }, select: { id: true } });
    expect(senders.outcome).toHaveBeenCalledWith(id);
    expect(senders.feishu).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("Result") }));
  });
  it("does not send when a distributed claim is already held", async () => {
    const { db, row, senders, service } = fixture(); db.automationNotificationDelivery.updateMany.mockResolvedValue({ count: 0 });
    await service.deliver(row); expect(senders.feishu).not.toHaveBeenCalled();
  });
  it("does not send after its delivery lease or notification setting is revoked", async () => {
    const { db, row, senders, service } = fixture(); db.automationNotificationDelivery.findFirst.mockResolvedValue(null);
    await service.deliver(row);
    await expect(senders.feishu.mock.results[0]?.value).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it("does not let a destination select a different owner's connection", async () => {
    const { db, service } = fixture(); db.feishuPeerSession.findFirst.mockResolvedValue(null);
    await expect(service.validateTarget(id, target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.feishuPeerSession.findFirst).toHaveBeenCalledWith({ where: { id: target.peer_session_id, connectionId: id, senderOpenId: "owner" } });
  });
  it("cancels a revoked destination and uses owner-scoped verification", async () => {
    const { db, row, senders, service } = fixture(); db.feishuConnection.findFirst.mockResolvedValue(null);
    await service.deliver(row);
    expect(db.feishuConnection.findFirst).toHaveBeenCalledWith({ where: { id, ownerId: id, status: "active" } });
    expect(senders.feishu).not.toHaveBeenCalled();
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "cancelled" }) }));
  });
  it("bounds retries of notification sends", async () => {
    const { db, row, senders, service } = fixture(); row.attempts = 4; senders.feishu.mockRejectedValue(new Error("upstream private detail"));
    await service.deliver(row);
    expect(db.automationNotificationDelivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", attempts: 5, lastErrorCode: "AUTOMATION_NOTIFICATION_FAILED" }) }));
    expect(JSON.stringify(db.automationNotificationDelivery.updateMany.mock.calls)).not.toContain("upstream private detail");
  });
});
