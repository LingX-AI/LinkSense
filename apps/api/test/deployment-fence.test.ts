import { expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { isStoppedDeploymentEvent } from "../src/modules/events/deployment-fence.js";

function fixture() {
  const db = {
    auditLog: {
      findFirst: vi.fn().mockResolvedValue({ createdAt: new Date(100_000) }),
    },
    conversationTurnStartIntent: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    conversationTurn: { findFirst: vi.fn().mockResolvedValue(null) },
    conversationTurnAttempt: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { db, prisma: db as unknown as PrismaClient };
}

it("drops pre-deployment Goal updates but allows newer explicit updates", async () => {
  const f = fixture();
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread", {
      nativeUpdatedAt: 99,
    }),
  ).resolves.toBe(true);
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread", {
      nativeUpdatedAt: 101,
    }),
  ).resolves.toBe(false);
});

it("acknowledges orphaned outbox entries without blocking subsequent FIFO delivery", async () => {
  const f = fixture();
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread"),
  ).resolves.toBe(true);
});

it("does not discard a new unprojected start, active turn or pending recovery", async () => {
  const f = fixture();
  f.db.conversationTurnStartIntent.findUnique.mockResolvedValueOnce({
    projectionTurnId: "new",
  });
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread"),
  ).resolves.toBe(false);
  f.db.conversationTurn.findFirst.mockResolvedValueOnce({ id: "new" });
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread"),
  ).resolves.toBe(false);
  f.db.conversationTurnAttempt.findFirst.mockResolvedValueOnce({ id: "new" });
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread"),
  ).resolves.toBe(false);
});

it("leaves conversations without a deployment stop on their existing projection path", async () => {
  const f = fixture();
  f.db.auditLog.findFirst.mockResolvedValue(null);
  await expect(
    isStoppedDeploymentEvent(f.prisma, "conversation", "thread"),
  ).resolves.toBe(false);
  expect(f.db.conversationTurnStartIntent.findUnique).not.toHaveBeenCalled();
});
