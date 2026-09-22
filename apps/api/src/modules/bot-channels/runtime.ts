import { v7 as uuidv7 } from "uuid";
import type { Locale } from "@linksense/shared";
import type { BotChannelConnection as ConnectionRow } from "../../generated/prisma/client.js";
import { DurableWorkDispatcher } from "../../lib/durable-work-dispatcher.js";
import { translateBackend } from "../../lib/i18n.js";
import type { ConversationService } from "../conversations/service.js";
import {
  RedisBotChannelCoordinator,
  type BotChannelLease,
} from "./coordinator.js";
import { PrismaBotChannelRepository } from "./repository.js";
import {
  decryptChannelCredentials,
  decryptReplyContext,
  encryptReplyContext,
  type ChannelEncryption,
} from "./state.js";
import {
  ChannelProtocolError,
  type BotChannelClient,
  type ChannelHttpRequest,
  type ChannelHttpResponse,
  type ChannelInbound,
  type ChannelSession,
} from "./types.js";

const INBOUND_LEASE_MS = 6 * 60_000;
const DELIVERY_LEASE_MS = 6 * 60_000;
const WEBSOCKET_LEASE_MS = 60_000;
const SEND_LOCK_MS = 30_000;
const BLOCKED_RETRY_MS = 1_000;
const MAX_PROCESSING_ATTEMPTS = 20;
const MAX_DELIVERY_ATTEMPTS = 10;

type SessionEntry = {
  session: ChannelSession;
  controller: AbortController;
  lease: BotChannelLease | null;
  guard: RenewableLeaseGuard | null;
};
export type BotChannelConversations = {
  create(
    ...input: Parameters<ConversationService["create"]>
  ): Promise<{ id: string }>;
  acceptTurn(
    ...input: Parameters<ConversationService["acceptTurn"]>
  ): Promise<{ turn_id: string }>;
};

export class BotChannelRuntime {
  private started = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectionTimer: ReturnType<typeof setInterval> | null = null;
  private connectionSweep: Promise<void> | null = null;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly connectionTasks = new Map<
    string,
    Promise<SessionEntry | null>
  >();
  private readonly controllers = new Set<AbortController>();
  private readonly inboundWork;
  private readonly outboundWork;

  constructor(
    private readonly repository: PrismaBotChannelRepository,
    private readonly coordinator: RedisBotChannelCoordinator,
    private readonly client: BotChannelClient,
    private readonly conversations: BotChannelConversations,
    private readonly encryption: ChannelEncryption,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = uuidv7,
  ) {
    this.inboundWork = new DurableWorkDispatcher({
      concurrency: 20,
      listPending: (limit) => repository.listPendingInbound(this.now(), limit),
      key: (item) => item.message.id,
      process: (item) =>
        this.#withConnectionLease(item.connection.id, (assertActive) =>
          this.#processInbound(item, assertActive),
        ),
    });
    this.outboundWork = new DurableWorkDispatcher({
      concurrency: 20,
      listPending: (limit) =>
        repository.listPendingDeliveries(this.now(), limit, [
          ...this.sessions.keys(),
        ]),
      key: (item) => item.delivery.id,
      process: (item) =>
        this.#withConnectionLease(item.connection.id, (assertActive) =>
          this.#deliverOutbound(item, assertActive),
        ),
    });
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.inboundWork.start();
    this.outboundWork.start();
    this.timer = setInterval(() => {
      this.inboundWork.wake();
      this.outboundWork.wake();
    }, 1000);
    this.connectionTimer = setInterval(() => this.wake(), 5000);
    this.timer.unref();
    this.connectionTimer.unref();
    this.wake();
  }

  wake(): void {
    if (!this.started) return;
    this.inboundWork.wake();
    this.outboundWork.wake();
    if (this.connectionSweep) return;
    const sweep = this.#sweepConnections()
      .catch(() => undefined)
      .finally(() => {
        if (this.connectionSweep === sweep) this.connectionSweep = null;
      });
    this.connectionSweep = sweep;
  }

  async close(): Promise<void> {
    this.started = false;
    if (this.timer) clearInterval(this.timer);
    if (this.connectionTimer) clearInterval(this.connectionTimer);
    this.timer = null;
    this.connectionTimer = null;
    for (const controller of this.controllers) controller.abort();
    await Promise.allSettled([
      this.inboundWork.close(),
      this.outboundWork.close(),
      this.connectionSweep,
      ...this.connectionTasks.values(),
    ]);
    await Promise.allSettled(
      [...this.sessions].map(([id, entry]) => this.#closeSession(id, entry)),
    );
  }

  async handleTeams(
    id: string,
    request: ChannelHttpRequest,
  ): Promise<ChannelHttpResponse> {
    if (!this.started) return { status: 503 };
    const row = await this.repository.findActiveConnection(id);
    if (!row || row.provider !== "teams") return { status: 404 };
    const entry = await this.#ensureSession(row);
    return entry?.session.handleRequest
      ? entry.session.handleRequest(request)
      : { status: 503 };
  }

  async #sweepConnections(): Promise<void> {
    const rows = await this.repository.listActiveConnections();
    if (!this.started) return;
    const activeIds = new Set(rows.map((row) => row.id));
    for (const [id, entry] of this.sessions) {
      if (
        !activeIds.has(id) ||
        !entry.session.isConnected() ||
        entry.guard?.isActive() === false
      )
        await this.#closeSession(id, entry);
    }
    await Promise.allSettled(
      rows.map(async (row) => {
        if (!this.started) return;
        if (this.sessions.has(row.id)) {
          if (
            row.provider !== "teams" &&
            (!row.lastConnectedAt ||
              this.now().getTime() - row.lastConnectedAt.getTime() > 30_000)
          )
            await this.repository.markConnected(row.id, this.now());
          return;
        }
        if (
          row.lastErrorAt &&
          this.now().getTime() - row.lastErrorAt.getTime() < 30_000
        )
          return;
        await this.#ensureSession(row);
      }),
    );
  }

  #ensureSession(row: ConnectionRow): Promise<SessionEntry | null> {
    const existing = this.sessions.get(row.id);
    if (existing) return Promise.resolve(existing);
    const pending = this.connectionTasks.get(row.id);
    if (pending) return pending;
    const task = this.#connect(row).finally(() => {
      this.connectionTasks.delete(row.id);
    });
    this.connectionTasks.set(row.id, task);
    return task;
  }

  async #connect(row: ConnectionRow): Promise<SessionEntry | null> {
    let lease: BotChannelLease | null = null;
    let guard: RenewableLeaseGuard | null = null;
    let connected = false;
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      if (!this.started) return null;
      if (row.provider !== "teams") {
        lease = await this.coordinator.acquireLease(
          "websocket",
          row.id,
          WEBSOCKET_LEASE_MS,
        );
        if (!lease) return null;
        guard = new RenewableLeaseGuard(
          this.coordinator,
          lease,
          WEBSOCKET_LEASE_MS,
          () => controller.abort(),
        );
      }
      if (!this.started) return null;
      const session = await this.client.connect({
        id: row.id,
        credentials: decryptChannelCredentials(row, this.encryption),
        signal: controller.signal,
        onMessage: (message) => this.#receive(row.id, message),
        onError: () => {
          void this.repository
            .recordConnectionError(
              row.id,
              "BOT_CHANNEL_CONNECTION_FAILED",
              this.now(),
            )
            .catch(() => undefined);
        },
      });
      if (!this.started || controller.signal.aborted) {
        await session.close();
        return null;
      }
      guard?.assertActive();
      const entry = { session, controller, lease, guard };
      this.sessions.set(row.id, entry);
      connected = true;
      if (row.provider !== "teams")
        await this.repository.markConnected(row.id, this.now());
      this.outboundWork.wake();
      return entry;
    } catch {
      await this.repository
        .recordConnectionError(
          row.id,
          "BOT_CHANNEL_CONNECTION_FAILED",
          this.now(),
        )
        .catch(() => undefined);
      return null;
    } finally {
      if (!connected) {
        controller.abort();
        this.controllers.delete(controller);
        await guard?.stop();
        if (lease)
          await this.coordinator.releaseLease(lease).catch(() => undefined);
      }
    }
  }

  async #closeSession(id: string, entry: SessionEntry): Promise<void> {
    if (this.sessions.get(id) === entry) this.sessions.delete(id);
    entry.controller.abort();
    this.controllers.delete(entry.controller);
    await entry.session.close().catch(() => undefined);
    await entry.guard?.stop();
    if (entry.lease)
      await this.coordinator.releaseLease(entry.lease).catch(() => undefined);
  }

  async #receive(connectionId: string, message: ChannelInbound): Promise<void> {
    if (!this.started)
      throw new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED");
    const row = await this.repository.findActiveConnection(connectionId);
    if (
      !row ||
      row.provider !== message.context.provider ||
      row.allowedSenderId !== message.senderId ||
      (message.group && !row.allowGroupMessages)
    )
      return;
    const id = this.createId();
    const persisted = await this.repository.persistInbound({
      id,
      connectionId,
      messageKey: message.messageKey,
      chatId: message.chatId,
      senderId: message.senderId,
      contentText: message.text,
      receivedAt: message.receivedAt,
      encryptedContext: encryptReplyContext(
        id,
        message.context,
        this.encryption,
      ),
      encryptionKeyId: this.encryption.keyId,
    });
    if (row.provider === "teams")
      await this.repository.markConnected(connectionId, this.now());
    if (persisted) this.inboundWork.wake();
  }

  async #withConnectionLease(
    id: string,
    action: (assertActive: () => void) => Promise<void>,
  ): Promise<void> {
    const lease = await this.coordinator.acquireLease(
      "connection",
      id,
      INBOUND_LEASE_MS,
    );
    if (!lease) return;
    const guard = new RenewableLeaseGuard(
      this.coordinator,
      lease,
      INBOUND_LEASE_MS,
    );
    try {
      guard.assertActive();
      await action(() => guard.assertActive());
    } finally {
      await guard.stop();
      await this.coordinator.releaseLease(lease);
    }
  }

  async #send(
    connectionId: string,
    inbound: Parameters<typeof decryptReplyContext>[0],
    text: string,
  ): Promise<void> {
    const entry = this.sessions.get(connectionId);
    if (
      !entry ||
      !entry.session.isConnected() ||
      entry.controller.signal.aborted
    )
      throw new ChannelProtocolError("BOT_CHANNEL_DELIVERY_FAILED");
    entry.guard?.assertActive();
    await entry.session.send(
      decryptReplyContext(inbound, this.encryption),
      text,
    );
  }
  async #processInbound(
    item: Awaited<
      ReturnType<PrismaBotChannelRepository["listPendingInbound"]>
    >[number],
    assertConnectionActive: () => void,
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
      ReturnType<PrismaBotChannelRepository["claimInbound"]>
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
      assertConnectionActive();
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
      await this.#acceptInbound(
        connection.ownerId,
        claimed,
        lease.token,
        () => {
          guard.assertActive();
          assertConnectionActive();
        },
      );
    } catch (error) {
      if (error instanceof BotChannelLeaseLostError || !claimed) return;
      if (!guard.isActive()) return;
      assertConnectionActive();
      const attempts = claimed.attempts + 1;
      const terminal = attempts >= MAX_PROCESSING_ATTEMPTS;
      const errorCode = stableRuntimeErrorCode(error);
      if (terminal) {
        await this.#sendProcessingFailure(
          item,
          lease.token,
          assertConnectionActive,
        ).catch(() => undefined);
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
      Awaited<ReturnType<PrismaBotChannelRepository["claimInbound"]>>
    >,
    processingToken: string,
    assertActive: () => void,
  ): Promise<void> {
    assertActive();
    const idempotencyKey = `bot-channel-inbound:${message.id}`;
    if (message.peerSessionId && message.conversationId) {
      const existingTurn = await this.repository.findTurnByIdempotencyKey(
        message.conversationId,
        idempotencyKey,
      );
      if (existingTurn) {
        await this.#markAccepted(
          message,
          processingToken,
          existingTurn.id,
          assertActive,
        );
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
          assertActive,
        );
        return;
      }
      if (
        !(await this.repository.clearInboundPreparation(
          message.id,
          processingToken,
        ))
      ) {
        throw new BotChannelLeaseLostError();
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
    assertActive();
    if (!peer) {
      const conversation = await this.conversations.create(ownerId, {
        collaborationMode: "default",
      });
      assertActive();
      peer = await this.repository.upsertPeerSession({
        id: this.createId(),
        connectionId: message.connectionId,
        chatId: message.chatId,
        senderId: message.senderId,
        conversationId: conversation.id,
        lastInboundAt: message.receivedAt,
      });
    } else {
      peer = await this.repository.upsertPeerSession({
        id: peer.id,
        connectionId: message.connectionId,
        chatId: message.chatId,
        senderId: message.senderId,
        conversationId: peer.conversationId,
        lastInboundAt: message.receivedAt,
      });
    }
    assertActive();
    if (
      !(await this.repository.prepareInbound({
        messageId: message.id,
        processingToken,
        peerSessionId: peer.id,
        conversationId: peer.conversationId,
      }))
    ) {
      throw new BotChannelLeaseLostError();
    }
    message.peerSessionId = peer.id;
    message.conversationId = peer.conversationId;
    await this.#submitTurn(
      ownerId,
      message,
      processingToken,
      idempotencyKey,
      assertActive,
    );
  }

  async #submitTurn(
    ownerId: string,
    message: NonNullable<
      Awaited<ReturnType<PrismaBotChannelRepository["claimInbound"]>>
    >,
    processingToken: string,
    idempotencyKey: string,
    assertActive: () => void,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new BotChannelLeaseLostError();
    }
    const existingTurn = await this.repository.findTurnByIdempotencyKey(
      message.conversationId,
      idempotencyKey,
    );
    if (existingTurn) {
      await this.#markAccepted(
        message,
        processingToken,
        existingTurn.id,
        assertActive,
      );
      return;
    }
    if (await this.repository.conversationIsBusy(message.conversationId)) {
      await this.#deferInbound(message.id, processingToken);
      return;
    }
    assertActive();
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
      { actorId: ownerId, userAgent: "LinkSense BotChannel" },
    );
    await this.#markAccepted(
      message,
      processingToken,
      receipt.turn_id,
      assertActive,
    );
  }

  async #markAccepted(
    message: NonNullable<
      Awaited<ReturnType<PrismaBotChannelRepository["claimInbound"]>>
    >,
    processingToken: string,
    turnId: string,
    assertActive: () => void,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new BotChannelLeaseLostError();
    }
    assertActive();
    await this.repository.markInboundAccepted({
      messageId: message.id,
      processingToken,
      connectionId: message.connectionId,
      peerSessionId: message.peerSessionId,
      conversationId: message.conversationId,
      turnId,
      processedAt: this.now(),
    });
    this.outboundWork.wake();
  }

  async #deliverOutbound(
    item: Awaited<
      ReturnType<PrismaBotChannelRepository["listPendingDeliveries"]>
    >[number],
    assertConnectionActive: () => void,
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
      ReturnType<PrismaBotChannelRepository["claimDelivery"]>
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
        async (assertLocksActive) => {
          const locale = await this.repository.getOwnerLocale(
            connection.ownerId,
          );
          const text =
            outcome.status === "completed"
              ? outcome.text?.trim() ||
                translateBackend("botChannels.emptyResponse", locale)
              : translateBackend("botChannels.taskFailed", locale);
          const chunks = boundedChunks(text, locale);
          for (
            let index = claimed!.sentChunkCount;
            index < chunks.length;
            index += 1
          ) {
            guard.assertActive();
            assertConnectionActive();
            assertLocksActive();
            const [currentDelivery, activeConnection] = await Promise.all([
              this.repository.findClaimedDelivery(claimed!.id, lease.token),
              this.repository.findActiveConnection(connection.id),
            ]);
            if (!currentDelivery || !activeConnection) {
              throw new BotChannelLeaseLostError();
            }
            if (currentDelivery.sentChunkCount >= index + 1) continue;
            if (currentDelivery.sentChunkCount !== index) {
              throw new BotChannelLeaseLostError();
            }
            guard.assertActive();
            assertConnectionActive();
            assertLocksActive();
            await this.#send(connection.id, item.inbound, chunks[index] ?? "");
            if (
              !(await this.repository.markDeliveryChunkSent(
                claimed!.id,
                lease.token,
                index + 1,
              ))
            ) {
              throw new BotChannelLeaseLostError();
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
      if (error instanceof BotChannelLeaseLostError || !claimed) return;
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
      ReturnType<PrismaBotChannelRepository["listPendingInbound"]>
    >[number],
    processingToken: string,
    assertConnectionActive: () => void,
  ): Promise<void> {
    await this.#withLocks(
      item.connection.ownerId,
      item.message.conversationId,
      async (assertLocksActive) => {
        const [claimed, connection, locale] = await Promise.all([
          this.repository.findClaimedInbound(item.message.id, processingToken),
          this.repository.findActiveConnection(item.connection.id),
          this.repository.getOwnerLocale(item.connection.ownerId),
        ]);
        if (!claimed || !connection) throw new BotChannelLeaseLostError();
        assertConnectionActive();
        assertLocksActive();
        await this.#send(
          connection.id,
          claimed,
          translateBackend("botChannels.processingFailed", locale),
        );
      },
    );
  }

  async #withLocks<T>(
    ownerId: string,
    conversationId: string | null,
    action: (assertActive: () => void) => Promise<T>,
  ): Promise<T> {
    const userLease = await this.#acquireRequiredLease(
      "user-lifecycle",
      ownerId,
    );
    const userGuard = new RenewableLeaseGuard(
      this.coordinator,
      userLease,
      SEND_LOCK_MS,
    );
    let conversationLease: BotChannelLease | null = null;
    let conversationGuard: RenewableLeaseGuard | null = null;
    try {
      if (conversationId) {
        conversationLease = await this.#acquireRequiredLease(
          "conversation",
          conversationId,
        );
      }
      if (conversationLease)
        conversationGuard = new RenewableLeaseGuard(
          this.coordinator,
          conversationLease,
          SEND_LOCK_MS,
        );
      const assertActive = () => {
        userGuard.assertActive();
        conversationGuard?.assertActive();
      };
      assertActive();
      return await action(assertActive);
    } finally {
      await conversationGuard?.stop();
      await userGuard.stop();
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
  ): Promise<BotChannelLease> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const lease = await this.coordinator.acquireLease(
        scope,
        resourceId,
        SEND_LOCK_MS,
      );
      if (lease) return lease;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("BOT_CHANNEL_RUNTIME_LOCK_BUSY");
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

class BotChannelLeaseLostError extends Error {
  constructor() {
    super("BOT_CHANNEL_LEASE_LOST");
    this.name = "BotChannelLeaseLostError";
  }
}

class RenewableLeaseGuard {
  private readonly timer: ReturnType<typeof setInterval>;
  private renewal: Promise<void> | null = null;
  private active = true;

  constructor(
    private readonly coordinator: RedisBotChannelCoordinator,
    private readonly lease: BotChannelLease,
    ttlMilliseconds: number,
    private readonly onLost?: () => void,
  ) {
    this.timer = setInterval(
      () => {
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
      },
      Math.max(1_000, Math.floor(ttlMilliseconds / 3)),
    );
    this.timer.unref();
  }

  isActive(): boolean {
    return this.active;
  }

  assertActive(): void {
    if (!this.active) throw new BotChannelLeaseLostError();
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
  return error instanceof ChannelProtocolError
    ? error.code
    : "BOT_CHANNEL_DELIVERY_FAILED";
}
function retryDelayMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 8) * 1000, 300_000);
}
export function boundedChunks(
  text: string,
  locale: Locale,
): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > 3500) {
      chunks.push(chunk);
      chunk = "";
      bytes = 0;
    }
    chunk += character;
    bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks.length <= 10
    ? chunks
    : [
        ...chunks.slice(0, 9),
        translateBackend("botChannels.longResponse", locale),
      ];
}
