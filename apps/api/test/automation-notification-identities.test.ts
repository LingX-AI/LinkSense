import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { AutomationNotificationService } from "../src/modules/automations/notifications.js";

const ownerId = "11111111-1111-4111-8111-111111111111";
const connectionId = "22222222-2222-4222-8222-222222222222";
const peerId = "33333333-3333-4333-8333-333333333333";
const conversationId = "44444444-4444-4444-8444-444444444444";
const target = { kind: "bot_channel" as const, connection_id: connectionId, peer_session_id: peerId };

function fixture(provider = "teams") {
  const connection = { id: connectionId, ownerId: provider === "dingtalk" ? ownerId : null, provider, status: "active", allowGroupMessages: true };
  const identity = { connectionId, userId: ownerId, senderId: "linked-sender" };
  const peer = { id: peerId, connectionId, ownerId, senderId: identity.senderId, chatId: "verified-chat", conversationId };
  const inbound = { id: peerId, connectionId, ownerId, peerSessionId: peerId, chatId: peer.chatId, senderId: peer.senderId, status: "accepted" };
  const db = {
    feishuConnection: { findMany: vi.fn().mockResolvedValue([]) },
    feishuPeerSession: { findMany: vi.fn().mockResolvedValue([]) },
    botChannelConnection: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; ownerId?: string | null; OR?: Array<{ ownerId: string | null }> } }) =>
        where.id === connectionId &&
        (where.ownerId === connection.ownerId || where.OR?.some((scope: { ownerId: string | null }) => scope.ownerId === connection.ownerId))
          ? connection : null),
      findMany: vi.fn().mockResolvedValue([connection]),
    },
    botChannelIdentity: { findUnique: vi.fn().mockResolvedValue(identity), findMany: vi.fn().mockResolvedValue([identity]) },
    botChannelPeerSession: {
      findFirst: vi.fn().mockImplementation(async ({ where }: { where: { ownerId: string; senderId: string } }) =>
        where.ownerId === ownerId && where.senderId === identity.senderId ? peer : null),
      findMany: vi.fn().mockResolvedValue([peer]),
    },
    botChannelInboundMessage: { findFirst: vi.fn().mockResolvedValue(inbound) },
    conversation: { findMany: vi.fn().mockResolvedValue([{ id: conversationId, title: "My task" }]) },
  };
  const service = new AutomationNotificationService(db as unknown as PrismaClient, {
    outcome: vi.fn(), feishu: vi.fn(), bot: vi.fn(),
  });
  return { db, service, connection, identity, peer, inbound };
}

describe("automation destinations with personal and organization bot identities", () => {
  it.each(["dingtalk", "wecom", "teams"])("accepts the owner's linked %s destination without a legacy allowedSenderId", async provider => {
    const { db, service, connection, peer, inbound } = fixture(provider);
    await expect(service.validateTarget(ownerId, target)).resolves.toMatchObject({ kind: "bot_channel", connection, peer, inbound });
    expect(db.botChannelIdentity.findUnique).toHaveBeenCalledWith({ where: { connectionId_userId: { connectionId, userId: ownerId } } });
    expect(db.botChannelInboundMessage.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId, senderId: peer.senderId, peerSessionId: peerId }),
    }));
  });

  it("rejects a revoked identity before reading its old peer or inbound messages", async () => {
    const { db, service } = fixture();
    db.botChannelIdentity.findUnique.mockResolvedValue(null);
    await expect(service.validateTarget(ownerId, target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.botChannelPeerSession.findFirst).not.toHaveBeenCalled();
    expect(db.botChannelInboundMessage.findFirst).not.toHaveBeenCalled();
  });

  it("does not reuse an old peer after linking a different platform sender", async () => {
    const { db, service } = fixture();
    db.botChannelIdentity.findUnique.mockResolvedValue({ connectionId, userId: ownerId, senderId: "replacement-sender" });
    await expect(service.validateTarget(ownerId, target)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.botChannelPeerSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId, senderId: "replacement-sender" }),
    }));
    expect(db.botChannelInboundMessage.findFirst).not.toHaveBeenCalled();
  });

  it("never exposes another user's personal bot as a notification destination", async () => {
    const { service, connection } = fixture("dingtalk");
    connection.ownerId = "55555555-5555-4555-8555-555555555555";
    await expect(service.validateTarget(ownerId, target)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lists only linked connections and peers belonging to the current identity", async () => {
    const { db, service, identity } = fixture();
    await expect(service.listTargets(ownerId)).resolves.toEqual({
      items: [{ target, provider: "teams", title: "My task" }],
    });
    expect(db.botChannelIdentity.findMany).toHaveBeenCalledWith({
      where: { userId: ownerId }, select: { connectionId: true, senderId: true },
    });
    expect(db.botChannelConnection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: [connectionId] } }),
    }));
    expect(db.botChannelPeerSession.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId, OR: [{ connectionId, senderId: identity.senderId }] },
    }));
  });
});
