import { v7 as uuidv7 } from "uuid";
import type { Locale } from "@linksense/shared";

import { DurableWorkDispatcher } from "../../lib/durable-work-dispatcher.js";
import { translateBackend } from "../../lib/i18n.js";
import type { ConversationService } from "../conversations/service.js";
import {
  RedisFeishuCoordinator,
  type FeishuLease,
} from "./coordinator.js";
import {
  FeishuOfficialClient,
  FeishuProtocolError,
  splitFeishuText,
  type FeishuChannelConnection,
  type FeishuInboundText,
} from "./client.js";
import { PrismaFeishuRepository } from "./repository.js";
import {
  decryptFeishuCredentials,
  type FeishuEncryption,
} from "./state.js";

const CONNECTION_SWEEP_INTERVAL_MS = 5_000;
const WORK_SWEEP_INTERVAL_MS = 1_000;
const WEBSOCKET_LEASE_MS = 60_000;
const INBOUND_LEASE_MS = 6 * 60_000;
const DELIVERY_LEASE_MS = 6 * 60_000;
const SEND_LOCK_MS = 30_000;
const BLOCKED_RETRY_MS = 1_000;
const MAX_PROCESSING_ATTEMPTS = 20;
const MAX_DELIVERY_ATTEMPTS = 10;
const MAX_OUTBOUND_CHUNKS = 10;
const HEARTBEAT_WRITE_INTERVAL_MS = 30_000;

type RuntimeConversations = Pick<
  ConversationService,
  "acceptTurn" | "create"
>;

type ActiveSession = {
  connection: FeishuChannelConnection;
  guard: RenewableLeaseGuard;
  lease: FeishuLease;
  lastHeartbeatAt: number;
};

export class FeishuRuntime {
  private started = false;
  private connectionTimer: ReturnType<typeof setInterval> | null = null;
  private workTimer: ReturnType<typeof setInterval> | null = null;
  private connectionSweepRunning = false;
  private readonly inboundWork;
  private readonly outboundWork;
  private readonly sessions = new Map<string, ActiveSession>();
  private readonly connectingIds = new Set<string>();
  private readonly connectionTasks = new Set<Promise<void>>();

  constructor(
    private readonly repository: PrismaFeishuRepository,
    private readonly coordinator: RedisFeishuCoordinator,
    private readonly client: FeishuOfficialClient,
    private readonly conversations: RuntimeConversations,
    private readonly encryption: FeishuEncryption,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = uuidv7,
  ) {
    this.inboundWork = new DurableWorkDispatcher({
      concurrency: 20,
      listPending: (limit) =>
        this.repository.listPendingInbound(this.now(), limit),
      key: (item) => item.message.id,
      process: (item) => this.#processInbound(item),
    });
    this.outboundWork = new DurableWorkDispatcher({
      concurrency: 20,
      listPending: (limit) =>
        this.repository.listPendingDeliveries(this.now(), limit),
      key: (item) => item.delivery.id,
      process: (item) => this.#deliverOutbound(item),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.inboundWork.start();
    this.outboundWork.start();
    this.connectionTimer = setInterval(
      () => this.wake(),
      CONNECTION_SWEEP_INTERVAL_MS,
    );
    this.workTimer = setInterval(
      () => this.#scheduleWorkSweep(),
      WORK_SWEEP_INTERVAL_MS,
    );
    this.connectionTimer.unref();
    this.workTimer.unref();
    this.wake();
  }

  wake(): void {
    if (!this.started) return;
    queueMicrotask(() => {
      void this.#connectionSweep();
      this.#scheduleWorkSweep();
    });
  }

  async close(): Promise<void> {
    this.started = false;
    if (this.connectionTimer) clearInterval(this.connectionTimer);
    if (this.workTimer) clearInterval(this.workTimer);
    this.connectionTimer = null;
    this.workTimer = null;
    const sessions = [...this.sessions.entries()];
    this.sessions.clear();
    await Promise.allSettled([
      ...sessions.map(([, session]) => this.#closeSession(session)),
      ...this.connectionTasks,
      this.inboundWork.close(),
      this.outboundWork.close(),
    ]);
  }

  async #connectionSweep(): Promise<void> {
    if (!this.started || this.connectionSweepRunning) return;
    this.connectionSweepRunning = true;
    try {
      const connections = await this.repository.listActiveConnections(200);
      const activeIds = new Set(connections.map((item) => item.id));
      for (const [connectionId, session] of this.sessions) {
        if (!activeIds.has(connectionId)) {
          this.sessions.delete(connectionId);
          void this.#closeSession(session);
          continue;
        }
        if (
          this.now().getTime() - session.lastHeartbeatAt >=
          HEARTBEAT_WRITE_INTERVAL_MS
        ) {
          session.lastHeartbeatAt = this.now().getTime();
          void this.repository.markConnected(
            connectionId,
            session.connection.botName,
            this.now(),
          );
        }
      }
      for (const connection of connections) {
        if (
          this.sessions.has(connection.id) ||
          this.connectingIds.has(connection.id)
        ) {
          continue;
        }
        this.connectingIds.add(connection.id);
        const task = this.#connect(connection.id).finally(() => {
          this.connectingIds.delete(connection.id);
          this.connectionTasks.delete(task);
        });
        this.connectionTasks.add(task);
      }
    } catch {
      // The next sweep retries database and coordination failures.
    } finally {
      this.connectionSweepRunning = false;
    }
  }

  async #connect(connectionId: string): Promise<void> {
    const lease = await this.coordinator
      .acquireLease("websocket", connectionId, WEBSOCKET_LEASE_MS)
      .catch(() => null);
    if (!lease || !this.started) return;
    let session: ActiveSession | null = null;
    const guard = new RenewableLeaseGuard(
      this.coordinator,
      lease,
      WEBSOCKET_LEASE_MS,
      () => {
        if (session) void this.#dropSession(connectionId, session);
      },
    );
    try {
      const row = await this.repository.findActiveConnection(connectionId);
      if (!row || !this.started) return;
      const connection = await this.client.connect({
        credentials: decryptFeishuCredentials(row, this.encryption),
        ownerOpenId: row.ownerOpenId,
        onMessage: async (message) => {
          await this.#receive(connectionId, message).catch(async (error) => {
            await this.repository
              .recordConnectionError(
                connectionId,
                stableRuntimeErrorCode(error),
                this.now(),
              )
              .catch(() => undefined);
          });
        },
        onError: (error) => {
          void this.repository
            .recordConnectionError(
              connectionId,
              stableRuntimeErrorCode(error),
              this.now(),
            )
            .catch(() => undefined);
        },
        onReconnecting: () => undefined,
        onReconnected: () => {
          void this.repository
            .markConnected(connectionId, row.botName, this.now())
            .catch(() => undefined);
        },
      });
      guard.assertActive();
      if (!this.started) {
        await connection.close();
        return;
      }
      session = {
        connection,
        guard,
        lease,
        lastHeartbeatAt: this.now().getTime(),
      };
      this.sessions.set(connectionId, session);
      await this.repository.markConnected(
        connectionId,
        connection.botName,
        this.now(),
      );
    } catch (error) {
      const errorCode = stableRuntimeErrorCode(error);
      const recordError =
        errorCode === "FEISHU_REAUTHORIZATION_REQUIRED"
          ? this.repository.markApprovalPending(
              connectionId,
              errorCode,
              this.now(),
            )
          : this.repository.recordConnectionError(
              connectionId,
              errorCode,
              this.now(),
            );
      await recordError.catch(() => undefined);
    } finally {
      if (!session) {
        await guard.stop();
        await this.coordinator.releaseLease(lease).catch(() => undefined);
      }
    }
  }

  async #closeSession(session: ActiveSession): Promise<void> {
    await session.connection.close().catch(() => undefined);
    await session.guard.stop();
    await this.coordinator.releaseLease(session.lease).catch(() => undefined);
  }

  async #dropSession(
    connectionId: string,
    session: ActiveSession,
  ): Promise<void> {
    if (this.sessions.get(connectionId) === session) {
      this.sessions.delete(connectionId);
    }
    await this.#closeSession(session);
    this.wake();
  }

  async #receive(
    connectionId: string,
    message: FeishuInboundText,
  ): Promise<void> {
    const persisted = await this.repository.persistInbound({
      id: this.createId(),
      connectionId,
      messageKey: message.messageKey,
      chatId: message.chatId,
      senderOpenId: message.senderOpenId,
      contentText: message.text,
      receivedAt: message.receivedAt,
    });
    if (persisted) this.inboundWork.wake();
  }

  #scheduleWorkSweep(): void {
    if (!this.started) return;
    this.inboundWork.wake();
    this.outboundWork.wake();
  }

  async #processInbound(
    item: Awaited<
      ReturnType<PrismaFeishuRepository["listPendingInbound"]>
    >[number],
  ): Promise<void> {
    const lease = await this.coordinator
      .acquireLease("inbound", item.message.id, INBOUND_LEASE_MS)
      .catch(() => null);
    if (!lease) return;
    const guard = new RenewableLeaseGuard(
      this.coordinator,
      lease,
      INBOUND_LEASE_MS,
    );
    let claimed = null as Awaited<
      ReturnType<PrismaFeishuRepository["claimInbound"]>
    >;
    try {
      const claimedAt = this.now();
      claimed = await this.repository.claimInbound(
        item.message.id,
        lease.token,
        claimedAt,
        new Date(claimedAt.getTime() + INBOUND_LEASE_MS),
      );
      if (!claimed) return;
      item.message = claimed;
      guard.assertActive();
      const connection = await this.repository.findActiveConnection(
        item.connection.id,
      );
      if (!connection) {
        await this.#deferInbound(claimed.id, lease.token);
        return;
      }
      item.connection = connection;
      if (
        (await this.repository.hasEarlierPendingMessage(claimed)) ||
        (await this.repository.hasUnsentDeliveryForChat(
          connection.id,
          claimed.chatId,
        ))
      ) {
        await this.#deferInbound(claimed.id, lease.token);
        return;
      }
      guard.assertActive();
      await this.#acceptInbound(connection.ownerId, claimed, lease.token);
    } catch (error) {
      if (error instanceof FeishuLeaseLostError || !claimed) return;
      if (!guard.isActive()) return;
      const attempts = claimed.attempts + 1;
      const terminal = attempts >= MAX_PROCESSING_ATTEMPTS;
      const errorCode = stableRuntimeErrorCode(error);
      if (terminal) {
        await this.#sendProcessingFailure(item, lease.token).catch(
          () => undefined,
        );
        await this.repository
          .markInboundFailed(claimed.id, lease.token, errorCode, this.now())
          .catch(() => undefined);
      } else {
        await this.repository
          .markInboundRetry({
            messageId: claimed.id,
            processingToken: lease.token,
            attempts,
            errorCode,
            nextAttemptAt: new Date(
              this.now().getTime() + retryDelayMilliseconds(attempts),
            ),
          })
          .catch(() => undefined);
      }
    } finally {
      await guard.stop();
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async #acceptInbound(
    ownerId: string,
    message: NonNullable<
      Awaited<ReturnType<PrismaFeishuRepository["claimInbound"]>>
    >,
    processingToken: string,
  ): Promise<void> {
    const idempotencyKey = `feishu-inbound:${message.id}`;
    if (message.peerSessionId && message.conversationId) {
      const existingTurn = await this.repository.findTurnByIdempotencyKey(
        message.conversationId,
        idempotencyKey,
      );
      if (existingTurn) {
        await this.#markAccepted(message, processingToken, existingTurn.id);
        return;
      }
      if (
        await this.repository.conversationIsAvailable(
          ownerId,
          message.conversationId,
        )
      ) {
        await this.#submitTurn(
          ownerId,
          message,
          processingToken,
          idempotencyKey,
        );
        return;
      }
      if (
        !(await this.repository.clearInboundPreparation(
          message.id,
          processingToken,
        ))
      ) {
        throw new FeishuLeaseLostError();
      }
      message.peerSessionId = null;
      message.conversationId = null;
    }

    let peer = await this.repository.findPeerSession(
      message.connectionId,
      message.chatId,
    );
    if (
      peer &&
      !(await this.repository.conversationIsAvailable(
        ownerId,
        peer.conversationId,
      ))
    ) {
      peer = null;
    }
    if (!peer) {
      const conversation = await this.conversations.create(ownerId, {
        collaborationMode: "default",
      });
      peer = await this.repository.upsertPeerSession({
        id: this.createId(),
        connectionId: message.connectionId,
        chatId: message.chatId,
        senderOpenId: message.senderOpenId,
        conversationId: conversation.id,
        lastInboundAt: message.receivedAt,
      });
    } else {
      peer = await this.repository.upsertPeerSession({
        id: peer.id,
        connectionId: message.connectionId,
        chatId: message.chatId,
        senderOpenId: message.senderOpenId,
        conversationId: peer.conversationId,
        lastInboundAt: message.receivedAt,
      });
    }
    if (
      !(await this.repository.prepareInbound({
        messageId: message.id,
        processingToken,
        peerSessionId: peer.id,
        conversationId: peer.conversationId,
      }))
    ) {
      throw new FeishuLeaseLostError();
    }
    message.peerSessionId = peer.id;
    message.conversationId = peer.conversationId;
    await this.#submitTurn(
      ownerId,
      message,
      processingToken,
      idempotencyKey,
    );
  }

  async #submitTurn(
    ownerId: string,
    message: NonNullable<
      Awaited<ReturnType<PrismaFeishuRepository["claimInbound"]>>
    >,
    processingToken: string,
    idempotencyKey: string,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new FeishuLeaseLostError();
    }
    const existingTurn = await this.repository.findTurnByIdempotencyKey(
      message.conversationId,
      idempotencyKey,
    );
    if (existingTurn) {
      await this.#markAccepted(message, processingToken, existingTurn.id);
      return;
    }
    if (await this.repository.conversationIsBusy(message.conversationId)) {
      await this.#deferInbound(message.id, processingToken);
      return;
    }
    const receipt = await this.conversations.acceptTurn(
      ownerId,
      message.conversationId,
      {
        inputText: message.contentText,
        priorityCapabilityIds: [],
        knowledgeBaseIds: [],
        idempotencyKey,
        submitMode: "normal",
        preserveStagedAttachments: true,
      },
      { actorId: ownerId, userAgent: "LinkSense Feishu" },
    );
    await this.#markAccepted(message, processingToken, receipt.turn_id);
  }

  async #markAccepted(
    message: NonNullable<
      Awaited<ReturnType<PrismaFeishuRepository["claimInbound"]>>
    >,
    processingToken: string,
    turnId: string,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new FeishuLeaseLostError();
    }
    await this.repository.markInboundAccepted({
      messageId: message.id,
      processingToken,
      connectionId: message.connectionId,
      peerSessionId: message.peerSessionId,
      conversationId: message.conversationId,
      turnId,
      processedAt: this.now(),
    });
  }

  async #deliverOutbound(
    item: Awaited<
      ReturnType<PrismaFeishuRepository["listPendingDeliveries"]>
    >[number],
  ): Promise<void> {
    const lease = await this.coordinator
      .acquireLease("delivery", item.delivery.id, DELIVERY_LEASE_MS)
      .catch(() => null);
    if (!lease) return;
    const guard = new RenewableLeaseGuard(
      this.coordinator,
      lease,
      DELIVERY_LEASE_MS,
    );
    let claimed = null as Awaited<
      ReturnType<PrismaFeishuRepository["claimDelivery"]>
    >;
    try {
      const claimedAt = this.now();
      claimed = await this.repository.claimDelivery(
        item.delivery.id,
        lease.token,
        claimedAt,
        new Date(claimedAt.getTime() + DELIVERY_LEASE_MS),
      );
      if (!claimed) return;
      item.delivery = claimed;
      const connection = await this.repository.findActiveConnection(
        item.connection.id,
      );
      if (!connection) {
        await this.#deferDelivery(claimed.id, lease.token);
        return;
      }
      const outcome = await this.repository.getTurnOutcome(claimed.turnId);
      if (outcome.status === "running") {
        await this.#deferDelivery(claimed.id, lease.token);
        return;
      }
      await this.#withLocks(
        connection.ownerId,
        claimed.conversationId,
        async () => {
          const locale = await this.repository.getOwnerLocale(
            connection.ownerId,
          );
          const text =
            outcome.status === "completed"
              ? outcome.text?.trim() || emptyResponseMessage(locale)
              : failedResponseMessage(locale);
          const chunks = boundedChunks(text, locale);
          for (
            let index = claimed!.sentChunkCount;
            index < chunks.length;
            index += 1
          ) {
            guard.assertActive();
            const [currentDelivery, activeConnection] = await Promise.all([
              this.repository.findClaimedDelivery(claimed!.id, lease.token),
              this.repository.findActiveConnection(connection.id),
            ]);
            if (!currentDelivery || !activeConnection) {
              throw new FeishuLeaseLostError();
            }
            if (currentDelivery.sentChunkCount >= index + 1) continue;
            if (currentDelivery.sentChunkCount !== index) {
              throw new FeishuLeaseLostError();
            }
            await this.client.sendText({
              credentials: decryptFeishuCredentials(
                activeConnection,
                this.encryption,
              ),
              chatId: item.inbound.chatId,
              text: chunks[index] ?? "",
              idempotencyKey: `${claimed!.id}-${index}`,
            });
            if (
              !(await this.repository.markDeliveryChunkSent(
                claimed!.id,
                lease.token,
                index + 1,
              ))
            ) {
              throw new FeishuLeaseLostError();
            }
          }
          await this.repository.markDeliverySent(
            claimed!.id,
            lease.token,
            this.now(),
          );
        },
      );
    } catch (error) {
      if (error instanceof FeishuLeaseLostError || !claimed) return;
      if (!guard.isActive()) return;
      const attempts = claimed.attempts + 1;
      await this.repository
        .markDeliveryRetry({
          deliveryId: claimed.id,
          processingToken: lease.token,
          attempts,
          errorCode: stableRuntimeErrorCode(error),
          nextAttemptAt: new Date(
            this.now().getTime() + retryDelayMilliseconds(attempts),
          ),
          terminal: attempts >= MAX_DELIVERY_ATTEMPTS,
        })
        .catch(() => undefined);
    } finally {
      await guard.stop();
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async #sendProcessingFailure(
    item: Awaited<
      ReturnType<PrismaFeishuRepository["listPendingInbound"]>
    >[number],
    processingToken: string,
  ): Promise<void> {
    await this.#withLocks(
      item.connection.ownerId,
      item.message.conversationId,
      async () => {
        const [claimed, connection, locale] = await Promise.all([
          this.repository.findClaimedInbound(
            item.message.id,
            processingToken,
          ),
          this.repository.findActiveConnection(item.connection.id),
          this.repository.getOwnerLocale(item.connection.ownerId),
        ]);
        if (!claimed || !connection) throw new FeishuLeaseLostError();
        await this.client.sendText({
          credentials: decryptFeishuCredentials(connection, this.encryption),
          chatId: claimed.chatId,
          text: processingFailureMessage(locale),
          idempotencyKey: `${claimed.id}-failed`,
        });
      },
    );
  }

  async #withLocks<T>(
    ownerId: string,
    conversationId: string | null,
    action: () => Promise<T>,
  ): Promise<T> {
    const userLease = await this.#acquireRequiredLease(
      "user-lifecycle",
      ownerId,
    );
    let conversationLease: FeishuLease | null = null;
    try {
      if (conversationId) {
        conversationLease = await this.#acquireRequiredLease(
          "conversation",
          conversationId,
        );
      }
      return await action();
    } finally {
      if (conversationLease) {
        await this.coordinator
          .releaseLease(conversationLease)
          .catch(() => undefined);
      }
      await this.coordinator.releaseLease(userLease).catch(() => undefined);
    }
  }

  async #acquireRequiredLease(
    scope: "user-lifecycle" | "conversation",
    resourceId: string,
  ): Promise<FeishuLease> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const lease = await this.coordinator.acquireLease(
        scope,
        resourceId,
        SEND_LOCK_MS,
      );
      if (lease) return lease;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("FEISHU_RUNTIME_LOCK_BUSY");
  }

  #deferInbound(messageId: string, processingToken: string): Promise<void> {
    return this.repository.deferInbound(
      messageId,
      processingToken,
      new Date(this.now().getTime() + BLOCKED_RETRY_MS),
    );
  }

  #deferDelivery(deliveryId: string, processingToken: string): Promise<void> {
    return this.repository.deferDelivery(
      deliveryId,
      processingToken,
      new Date(this.now().getTime() + BLOCKED_RETRY_MS),
    );
  }
}

class FeishuLeaseLostError extends Error {
  constructor() {
    super("FEISHU_LEASE_LOST");
    this.name = "FeishuLeaseLostError";
  }
}

class RenewableLeaseGuard {
  private readonly timer: ReturnType<typeof setInterval>;
  private renewal: Promise<void> | null = null;
  private active = true;

  constructor(
    private readonly coordinator: RedisFeishuCoordinator,
    private readonly lease: FeishuLease,
    ttlMilliseconds: number,
    private readonly onLost?: () => void,
  ) {
    this.timer = setInterval(() => {
      if (this.renewal || !this.active) return;
      this.renewal = this.coordinator
        .renewLease(this.lease, ttlMilliseconds)
        .then((renewed) => {
          if (!renewed) this.#markLost();
        })
        .catch(() => this.#markLost())
        .finally(() => {
          this.renewal = null;
        });
    }, Math.max(1_000, Math.floor(ttlMilliseconds / 3)));
    this.timer.unref();
  }

  isActive(): boolean {
    return this.active;
  }

  assertActive(): void {
    if (!this.active) throw new FeishuLeaseLostError();
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    await this.renewal?.catch(() => undefined);
  }

  #markLost(): void {
    if (!this.active) return;
    this.active = false;
    this.onLost?.();
  }
}

function stableRuntimeErrorCode(error: unknown): string {
  if (
    error instanceof FeishuProtocolError ||
    (error instanceof Error && "code" in error)
  ) {
    const code =
      error instanceof FeishuProtocolError
        ? error.reasonCode
        : error.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,119}$/u.test(code)) {
      return code;
    }
  }
  return "FEISHU_RUNTIME_FAILED";
}

function retryDelayMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 8) * 1_000, 5 * 60_000);
}

function boundedChunks(
  text: string,
  locale: Locale,
): string[] {
  const chunks = splitFeishuText(text);
  if (chunks.length <= MAX_OUTBOUND_CHUNKS) return chunks;
  return [
    ...chunks.slice(0, MAX_OUTBOUND_CHUNKS - 1),
    locale === "zh-CN"
      ? "回复内容较长，请打开 LinkSense 查看完整回答。"
      : locale === "en-US"
        ? "The response is too long. Open LinkSense to view the complete answer."
        : translateBackend("botChannels.longResponse", locale),
  ];
}

function emptyResponseMessage(locale: Locale): string {
  return locale === "zh-CN"
    ? "任务已完成，但没有可发送的文本回复。"
    : locale === "en-US"
      ? "The task finished without a text response."
      : translateBackend("botChannels.emptyResponse", locale);
}

function failedResponseMessage(locale: Locale): string {
  return locale === "zh-CN"
    ? "任务未能完成，请稍后重试。"
    : locale === "en-US"
      ? "The task could not be completed. Please try again later."
      : translateBackend("botChannels.taskFailed", locale);
}

function processingFailureMessage(locale: Locale): string {
  return locale === "zh-CN"
    ? "这条消息暂时无法处理，请稍后重试。"
    : locale === "en-US"
      ? "This message could not be processed. Please try again later."
      : translateBackend("botChannels.processingFailed", locale);
}
