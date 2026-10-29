import { randomUUID } from "node:crypto";
import { automationNotificationTargetSchema, automationNotificationTargetsSchema, type AutomationNotificationTarget, type AutomationNotificationTargets } from "@linksense/shared";
import type { AutomationNotificationDelivery, PrismaClient, BotChannelInboundMessage, Prisma, FeishuConnection, FeishuPeerSession, BotChannelConnection, BotChannelPeerSession } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { translateBackend } from "../../lib/i18n.js";
import { normalizeLocale } from "../../lib/locale.js";
import { DurableWorkDispatcher } from "../../lib/durable-work-dispatcher.js";
import { inspectOfficeAnnotationPrompt } from "../conversations/annotation-prompt.js";

type NotificationSenders = {
  botConnectionIds?: () => string[];
  outcome(turnId: string): Promise<{ status: string; text?: string | null }>;
  feishu(input: { ownerId: string; connectionId: string; chatId: string; text: string; idempotencyKey: string; beforeSend: () => Promise<void> }): Promise<void>;
  bot(input: { ownerId: string; connectionId: string; inbound: BotChannelInboundMessage; text: string; beforeSend: () => Promise<void> }): Promise<void>;
};
const leaseMs = 120_000;
type ResolvedNotificationTarget = { kind: "feishu"; connection: FeishuConnection; peer: FeishuPeerSession } | { kind: "bot_channel"; connection: BotChannelConnection; peer: BotChannelPeerSession; inbound: BotChannelInboundMessage };
export class AutomationNotificationService {
  private readonly work;
  constructor(private readonly db: PrismaClient, private readonly senders: NotificationSenders, private readonly now: () => Date = () => new Date()) {
    this.work = new DurableWorkDispatcher({ concurrency: 8, listPending: limit => this.listPending(limit), key: row => row.id, process: row => this.deliver(row) });
  }
  start(): void { this.work.start(); }
  wake(): void { this.work.wake(); }
  async close(): Promise<void> { await this.work.close(); }

  async listTargets(ownerId: string): Promise<AutomationNotificationTargets> {
    const [feishu, identities] = await Promise.all([
      this.db.feishuConnection.findMany({ where: { ownerId, status: "active" }, select: { id: true } }),
      this.db.botChannelIdentity.findMany({ where: { userId: ownerId }, select: { connectionId: true, senderId: true } }),
    ]);
    const bots = await this.db.botChannelConnection.findMany({ where: {
      id: { in: identities.map(row => row.connectionId) }, status: "active",
      AND: [{ OR: [{ ownerId }, { ownerId: null }] }, { OR: [{ provider: "dingtalk" }, { allowGroupMessages: true }] }],
    }, select: { id: true, provider: true } });
    const botIds = new Set(bots.map(row => row.id));
    const [peers, botPeers] = await Promise.all([
      this.db.feishuPeerSession.findMany({ where: { connectionId: { in: feishu.map(row => row.id) } }, orderBy: { lastInboundAt: "desc" }, take: 50 }),
      this.db.botChannelPeerSession.findMany({ where: { ownerId, OR: identities.filter(row => botIds.has(row.connectionId)).map(row => ({ connectionId: row.connectionId, senderId: row.senderId })) }, orderBy: { lastInboundAt: "desc" }, take: 50 }),
    ]);
    const titles = await this.db.conversation.findMany({ where: { id: { in: [...peers, ...botPeers].map(row => row.conversationId) }, ownerId }, select: { id: true, title: true } });
    const byId = new Map(titles.map(row => [row.id, row.title]));
    return automationNotificationTargetsSchema.parse({ items: [
      ...peers.flatMap(peer => byId.has(peer.conversationId) ? [{ target: { kind: "feishu", connection_id: peer.connectionId, peer_session_id: peer.id }, provider: "feishu", title: byId.get(peer.conversationId) }] : []),
      ...botPeers.flatMap(peer => byId.has(peer.conversationId) ? [{ target: { kind: "bot_channel", connection_id: peer.connectionId, peer_session_id: peer.id }, provider: bots.find(row => row.id === peer.connectionId)?.provider ?? "", title: byId.get(peer.conversationId) }] : []),
    ] });
  }

  async validateTarget(ownerId: string, target: AutomationNotificationTarget): Promise<ResolvedNotificationTarget> {
    if (target.kind === "feishu") {
      const connection = await this.db.feishuConnection.findFirst({ where: { id: target.connection_id, ownerId, status: "active" } });
      const peer = connection && await this.db.feishuPeerSession.findFirst({ where: { id: target.peer_session_id, connectionId: connection.id, senderOpenId: connection.ownerOpenId } });
      if (!connection || !peer) throw new AppError("FORBIDDEN");
      return { kind: "feishu" as const, connection, peer };
    }
    const connection = await this.db.botChannelConnection.findFirst({ where: { id: target.connection_id, status: "active", OR: [{ ownerId }, { ownerId: null }] } });
    if (connection && connection.provider !== "dingtalk" && !connection.allowGroupMessages) throw new AppError("FORBIDDEN");
    const identity = connection && await this.db.botChannelIdentity.findUnique({ where: { connectionId_userId: { connectionId: connection.id, userId: ownerId } } });
    const peer = identity && await this.db.botChannelPeerSession.findFirst({ where: { id: target.peer_session_id, connectionId: connection!.id, ownerId, senderId: identity.senderId } });
    const inbound = peer && await this.db.botChannelInboundMessage.findFirst({ where: { connectionId: connection!.id, peerSessionId: peer.id, ownerId, chatId: peer.chatId, senderId: peer.senderId, status: "accepted" }, orderBy: { ingestOrder: "desc" } });
    if (!connection || !peer || !inbound) throw new AppError("FORBIDDEN");
    return { kind: "bot_channel" as const, connection, peer, inbound };
  }

  private listPending(limit: number) {
    return this.db.automationNotificationDelivery.findMany({ where: {
      status: { in: ["pending", "processing"] }, nextAttemptAt: { lte: this.now() },
      OR: [ { targetJson: { path: ["kind"], equals: "feishu" } }, ...(this.senders.botConnectionIds?.() ?? []).map(id => ({ targetJson: { path: ["connection_id"], equals: id } })) ],
    }, orderBy: { nextAttemptAt: "asc" }, take: limit });
  }

  async deliver(row: AutomationNotificationDelivery): Promise<void> {
    const token = randomUUID();
    const claimed = await this.db.automationNotificationDelivery.updateMany({ where: { id: row.id, status: { in: ["pending", "processing"] }, nextAttemptAt: { lte: this.now() } }, data: { status: "processing", processingToken: token, nextAttemptAt: new Date(this.now().getTime() + leaseMs) } });
    if (claimed.count !== 1) return;
    const settle = (data: Prisma.AutomationNotificationDeliveryUpdateManyMutationInput) => this.db.automationNotificationDelivery.updateMany({ where: { id: row.id, processingToken: token, status: "processing" }, data: { ...data, processingToken: null } });
    try {
      const [automation, run, actor] = await Promise.all([
        this.db.automation.findFirst({ where: { id: row.automationId, ownerId: row.ownerId, deletedAt: null } }),
        this.db.automationRun.findFirst({ where: { id: row.runId, ownerId: row.ownerId, automationId: row.automationId } }),
        this.db.user.findFirst({ where: { id: row.ownerId, status: "active" }, select: { preferredLocale: true } }),
      ]);
      const target = automationNotificationTargetSchema.safeParse(row.targetJson);
      const current = automationNotificationTargetSchema.safeParse(automation?.notificationTargetJson);
      if (!automation || !actor || !run || !target.success || !current.success || JSON.stringify(target.data) !== JSON.stringify(current.data)) { await settle({ status: "cancelled" }); return; }
      const conversation = await this.db.conversation.findFirst({ where: { id: run.conversationId, ownerId: row.ownerId }, select: { id: true } });
      if (!conversation) { await settle({ status: "cancelled" }); return; }
      // Queued runs keep their original idempotency key instead of a turn ID.
      const turnId = run.turnId ?? (run.status !== "failed" ? await this.db.conversationTurn.findFirst({ where: { conversationId: run.conversationId, submittedBy: row.ownerId, idempotencyKey: run.idempotencyKey }, select: { id: true } }) : null)?.id;
      const outcome = turnId && run.status !== "failed" ? await this.senders.outcome(turnId) : null;
      const failed = run.status === "failed" || outcome?.status === "failed";
      if (!run.completedAt && !failed) { await settle({ status: "pending", nextAttemptAt: new Date(this.now().getTime() + 15_000) }); return; }
      const resolved = await this.validateTarget(row.ownerId, target.data);
      const reply = outcome?.status === "completed" && outcome.text ? { contentText: outcome.text } : null;
      const locale = normalizeLocale(actor.preferredLocale) ?? "zh-CN";
      const summary = reply ? inspectOfficeAnnotationPrompt(reply.contentText) : null;
      const text = translateBackend(failed ? "automationNotifications.failed" : "automationNotifications.completed", locale, { title: automation.title, summary: (summary?.suspected ? summary.request ?? "" : reply?.contentText ?? "").replace(/\s+/gu, " ").slice(0, 1_200) });
      // A disabled or changed destination cancels queued notices, including retries.
      const beforeSend = async () => {
        const [active, actor, source] = await Promise.all([
          this.db.automationNotificationDelivery.findFirst({ where: { id: row.id, processingToken: token, status: "processing", nextAttemptAt: { gt: this.now() } }, select: { id: true } }),
          this.db.user.findFirst({ where: { id: row.ownerId, status: "active" }, select: { id: true } }),
          this.db.conversation.findFirst({ where: { id: run.conversationId, ownerId: row.ownerId }, select: { id: true } }),
        ]);
        if (!active || !actor || !source) throw new AppError("FORBIDDEN");
      };
      if (resolved.kind === "feishu") await this.senders.feishu({ ownerId: row.ownerId, connectionId: resolved.connection.id, chatId: resolved.peer.chatId, text, idempotencyKey: row.id, beforeSend });
      else await this.senders.bot({ ownerId: row.ownerId, connectionId: resolved.connection.id, inbound: resolved.inbound, text, beforeSend });
      await settle({ status: "sent", sentAt: this.now(), lastErrorCode: null });
    } catch (error) {
      const attempts = row.attempts + 1;
      await settle({ status: error instanceof AppError && error.code === "FORBIDDEN" ? "cancelled" : attempts >= 5 ? "failed" : "pending", attempts, lastErrorCode: "AUTOMATION_NOTIFICATION_FAILED", nextAttemptAt: new Date(this.now().getTime() + Math.min(300_000, 5_000 * 2 ** attempts)) });
    }
  }
}
