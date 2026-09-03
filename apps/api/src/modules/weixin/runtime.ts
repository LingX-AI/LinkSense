import { v7 as uuidv7 } from "uuid";

import type { AppError } from "../../lib/errors.js";
import type { ConversationService } from "../conversations/service.js";
import {
  RedisWeixinCoordinator,
  type WeixinLease,
} from "./coordinator.js";
import {
  extractWeixinInboundText,
  splitWeixinText,
  WeixinIlinkClient,
  WeixinProtocolError,
} from "./protocol.js";
import { PrismaWeixinRepository } from "./repository.js";
import {
  decryptWeixinConnectionState,
  decryptWeixinContext,
  encryptWeixinConnectionState,
  encryptWeixinContext,
  type WeixinEncryption,
} from "./state.js";

const POLL_SWEEP_INTERVAL_MS = 5_000;
const DELIVERY_SWEEP_INTERVAL_MS = 1_000;
const POLL_LEASE_MS = 50_000;
const INBOUND_LEASE_MS = 6 * 60_000;
const DELIVERY_LEASE_MS = 6 * 60_000;
const CONNECTION_LEASE_MS = 20_000;
const SEND_LOCK_MS = 30_000;
const BLOCKED_RETRY_MS = 1_000;
const MAX_PROCESSING_ATTEMPTS = 20;
const MAX_DELIVERY_ATTEMPTS = 10;
const MAX_OUTBOUND_CHUNKS = 10;
const MAX_CONCURRENT_POLLS = 100;
const TYPING_KEEPALIVE_MS = 5_000;
const TYPING_CONFIG_CACHE_TTL_MS = 24 * 60 * 60 * 1_000;
const TYPING_CONFIG_INITIAL_RETRY_MS = 2_000;
const TYPING_CONFIG_MAX_RETRY_MS = 60 * 60 * 1_000;

type RuntimeConversations = Pick<
  ConversationService,
  "acceptTurn" | "create" | "createApplicationConversation"
>;

type WeixinTypingTicketEntry = {
  typingTicket: string;
  nextFetchAt: number;
  retryDelayMs: number;
};

type WeixinTypingSession = {
  key: string;
  connectionId: string;
  turnId: string;
  peerUserId: string;
  typingTicket: string;
  timer: ReturnType<typeof setInterval>;
};

type WeixinConnectionRow = Parameters<typeof decryptWeixinConnectionState>[0];
type WeixinTypingConnection = WeixinConnectionRow;

export class WeixinRuntime {
  private started = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private deliveryTimer: ReturnType<typeof setInterval> | null = null;
  private pollSweepRunning = false;
  private workSweepRunning = false;
  private activeWorkSweep: Promise<void> | null = null;
  private readonly pollingConnectionIds = new Set<string>();
  private readonly notifiedConnectionIds = new Set<string>();
  private readonly activePolls = new Set<Promise<void>>();
  private readonly abortControllers = new Set<AbortController>();
  private readonly typingTickets = new Map<string, WeixinTypingTicketEntry>();
  private readonly activeTyping = new Map<string, WeixinTypingSession>();

  constructor(
    private readonly repository: PrismaWeixinRepository,
    private readonly coordinator: RedisWeixinCoordinator,
    private readonly client: WeixinIlinkClient,
    private readonly conversations: RuntimeConversations,
    private readonly encryption: WeixinEncryption,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = uuidv7,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.pollTimer = setInterval(() => this.wake(), POLL_SWEEP_INTERVAL_MS);
    this.deliveryTimer = setInterval(
      () => this.#scheduleWorkSweep(),
      DELIVERY_SWEEP_INTERVAL_MS,
    );
    this.pollTimer.unref();
    this.deliveryTimer.unref();
    this.wake();
  }

  wake(): void {
    if (!this.started) return;
    queueMicrotask(() => {
      void this.#pollSweep();
      this.#scheduleWorkSweep();
    });
  }

  async close(): Promise<void> {
    if (
      !this.started &&
      this.activePolls.size === 0 &&
      !this.activeWorkSweep &&
      this.activeTyping.size === 0 &&
      this.notifiedConnectionIds.size === 0
    ) {
      return;
    }
    this.started = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.pollTimer = null;
    this.deliveryTimer = null;
    for (const controller of this.abortControllers) controller.abort();
    await Promise.allSettled([
      ...this.activePolls,
      ...(this.activeWorkSweep ? [this.activeWorkSweep] : []),
    ]);
    const notifiedConnectionIds = [...this.notifiedConnectionIds];
    this.notifiedConnectionIds.clear();
    const activeTyping = [...this.activeTyping.values()];
    await Promise.allSettled(
      [
        ...activeTyping.map((session) => this.#stopTypingSession(session)),
        ...notifiedConnectionIds.map((connectionId) =>
          this.#notifyConnectionStop(connectionId),
        ),
      ],
    );
  }

  async #pollSweep(): Promise<void> {
    if (!this.started || this.pollSweepRunning) return;
    this.pollSweepRunning = true;
    try {
      const availableSlots = Math.max(
        MAX_CONCURRENT_POLLS - this.activePolls.size,
        0,
      );
      if (availableSlots === 0) return;
      const connections = await this.repository.listActiveConnections(
        availableSlots,
      );
      for (const connection of connections) {
        if (this.pollingConnectionIds.has(connection.id)) continue;
        this.pollingConnectionIds.add(connection.id);
        let continuePolling = false;
        const task = this.#pollConnection(connection.id)
          .then((result) => {
            continuePolling = result;
          })
          .finally(() => {
            this.pollingConnectionIds.delete(connection.id);
            this.activePolls.delete(task);
            if (continuePolling && this.started) this.wake();
          });
        this.activePolls.add(task);
      }
    } catch {
      // The next sweep retries database and coordination failures.
    } finally {
      this.pollSweepRunning = false;
    }
  }

  async #pollConnection(connectionId: string): Promise<boolean> {
    const lease = await this.coordinator
      .acquireLease("poll", connectionId, POLL_LEASE_MS)
      .catch(() => null);
    if (!lease || !this.started) return false;

    const controller = new AbortController();
    const guard = new RenewableLeaseGuard(
      this.coordinator,
      lease,
      POLL_LEASE_MS,
      () => controller.abort(),
    );
    this.abortControllers.add(controller);
    try {
      const connection =
        await this.repository.findActiveConnection(connectionId);
      if (!connection) return false;
      const state = decryptWeixinConnectionState(connection, this.encryption);
      await this.#ensureConnectionStarted(connection, state, controller.signal);
      const response = await this.client.getUpdates({
        baseUrl: connection.apiBaseUrl,
        token: state.token,
        cursor: state.cursor,
        signal: controller.signal,
      });
      guard.assertActive();
      if (!this.started || controller.signal.aborted) return false;

      const messages = orderMessagesBySequence(response.messages).flatMap(
        (message) => {
          const inbound = extractWeixinInboundText(message, this.now());
          if (!inbound || inbound.peerUserId !== connection.ilinkUserId) {
            return [];
          }
          const id = this.createId();
          return [
            {
              id,
              peerUserId: inbound.peerUserId,
              messageKey: inbound.messageKey,
              contentText: inbound.text,
              encryptedContext: encryptWeixinContext(
                "inbound",
                id,
                inbound.contextToken,
                this.encryption,
              ),
              encryptionKeyId: this.encryption.keyId,
              receivedAt: inbound.receivedAt,
              sourceSequence: inbound.sourceSequence,
            },
          ];
        },
      );
      guard.assertActive();
      return await this.repository.persistPoll({
        connectionId,
        expectedEncryptedState: connection.encryptedState,
        encryptedState: encryptWeixinConnectionState(
          connectionId,
          { token: state.token, cursor: response.cursor },
          this.encryption,
        ),
        encryptionKeyId: this.encryption.keyId,
        messages,
        polledAt: this.now(),
      });
    } catch (error) {
      const occurredAt = this.now();
      if (
        error instanceof WeixinProtocolError &&
        error.reasonCode === "WEIXIN_CREDENTIAL_EXPIRED"
      ) {
        await this.repository
          .requireReauthorization(connectionId, occurredAt)
          .catch(() => undefined);
      } else if (
        !(error instanceof WeixinLeaseLostError) &&
        !controller.signal.aborted
      ) {
        await this.repository
          .recordConnectionError(
            connectionId,
            stableRuntimeErrorCode(error),
            occurredAt,
          )
          .catch(() => undefined);
      }
      return false;
    } finally {
      this.abortControllers.delete(controller);
      await guard.stop();
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async #ensureConnectionStarted(
    connection: {
      id: string;
      apiBaseUrl: string;
    },
    state: { token: string },
    signal: AbortSignal,
  ): Promise<void> {
    if (this.notifiedConnectionIds.has(connection.id)) return;
    await this.client.notifyStart({
      baseUrl: connection.apiBaseUrl,
      token: state.token,
      signal,
    });
    this.notifiedConnectionIds.add(connection.id);
  }

  async #notifyConnectionStop(connectionId: string): Promise<void> {
    const connection = await this.repository.findActiveConnection(connectionId);
    if (!connection) return;
    const state = decryptWeixinConnectionState(connection, this.encryption);
    await this.client.notifyStop({
      baseUrl: connection.apiBaseUrl,
      token: state.token,
    });
  }

  #scheduleWorkSweep(): void {
    if (!this.started || this.workSweepRunning) return;
    this.workSweepRunning = true;
    const task = this.#workSweep().finally(() => {
      this.workSweepRunning = false;
      if (this.activeWorkSweep === task) this.activeWorkSweep = null;
    });
    this.activeWorkSweep = task;
  }

  async #workSweep(): Promise<void> {
    try {
      const now = this.now();
      const [messages, deliveries] = await Promise.all([
        this.repository.listPendingInbound(now, 20),
        this.repository.listPendingDeliveries(now, 20),
      ]);
      await Promise.allSettled([
        ...messages.map((item) => this.#processInbound(item)),
        ...deliveries.map((item) => this.#deliverOutbound(item)),
      ]);
    } catch {
      // Durable rows remain pending and are picked up by the next sweep.
    }
  }

  async #processInbound(
    item: Awaited<
      ReturnType<PrismaWeixinRepository["listPendingInbound"]>
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
    let connectionLease: WeixinLease | null = null;
    let connectionGuard: RenewableLeaseGuard | null = null;
    let claimed = null as Awaited<
      ReturnType<PrismaWeixinRepository["claimInbound"]>
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

      connectionLease = await this.coordinator
        .acquireLease("connection", item.connection.id, CONNECTION_LEASE_MS)
        .catch(() => null);
      if (!connectionLease) {
        await this.repository.deferInbound(
          claimed.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }
      connectionGuard = new RenewableLeaseGuard(
        this.coordinator,
        connectionLease,
        CONNECTION_LEASE_MS,
      );

      const connection = await this.repository.findActiveConnection(
        item.connection.id,
      );
      if (!connection) {
        await this.repository.deferInbound(
          claimed.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }
      item.connection = connection;
      if (
        (await this.repository.hasEarlierPendingMessage(claimed)) ||
        (await this.repository.hasUnsentDeliveryForPeer(
          connection.id,
          claimed.peerUserId,
        ))
      ) {
        await this.repository.deferInbound(
          claimed.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }

      const idempotencyKey = `weixin-inbound:${claimed.id}`;
      if (claimed.peerSessionId && claimed.conversationId) {
        const existingTurn = await this.repository.findTurnByIdempotencyKey(
          claimed.conversationId,
          idempotencyKey,
        );
        if (existingTurn) {
          await this.#markInboundAccepted(
            claimed,
            lease.token,
            existingTurn.id,
          );
          return;
        }
        if (
          await this.repository.conversationIsAvailable(
            connection.ownerId,
            claimed.conversationId,
          )
        ) {
          await this.#acceptPreparedInbound(
            claimed,
            lease.token,
            idempotencyKey,
            connection.ownerId,
          );
          return;
        }
        if (
          !(await this.repository.clearInboundPreparation(
            claimed.id,
            lease.token,
          ))
        ) {
          throw new WeixinLeaseLostError();
        }
        claimed.peerSessionId = null;
        claimed.conversationId = null;
      }

      let peer = await this.repository.findPeerSession(
        connection.id,
        claimed.peerUserId,
      );
      const persistedPeerId = peer?.id;
      if (
        peer &&
        !(await this.repository.conversationIsAvailable(
          connection.ownerId,
          peer.conversationId,
        ))
      ) {
        peer = null;
      }
      const applicationChanged = peer && peer.applicationIdSnapshot !== null;
      if (!peer || applicationChanged) {
        const conversation = await this.conversations.create(
          connection.ownerId,
          { collaborationMode: "default" },
        );
        const peerId = peer?.id ?? persistedPeerId ?? this.createId();
        peer = await this.repository.upsertPeerSession({
          id: peerId,
          connectionId: connection.id,
          peerUserId: claimed.peerUserId,
          conversationId: conversation.id,
          applicationIdSnapshot: null,
          encryptedContext: encryptWeixinContext(
            "peer",
            peerId,
            this.#decryptInboundContext(claimed),
            this.encryption,
          ),
          encryptionKeyId: this.encryption.keyId,
          lastInboundAt: claimed.receivedAt,
        });
      } else {
        peer = await this.repository.upsertPeerSession({
          id: peer.id,
          connectionId: connection.id,
          peerUserId: claimed.peerUserId,
          conversationId: peer.conversationId,
          applicationIdSnapshot: peer.applicationIdSnapshot,
          encryptedContext: encryptWeixinContext(
            "peer",
            peer.id,
            this.#decryptInboundContext(claimed),
            this.encryption,
          ),
          encryptionKeyId: this.encryption.keyId,
          lastInboundAt: claimed.receivedAt,
        });
      }

      if (
        !(await this.repository.prepareInbound({
          messageId: claimed.id,
          processingToken: lease.token,
          peerSessionId: peer.id,
          conversationId: peer.conversationId,
        }))
      ) {
        throw new WeixinLeaseLostError();
      }
      claimed.peerSessionId = peer.id;
      claimed.conversationId = peer.conversationId;
      await this.#acceptPreparedInbound(
        claimed,
        lease.token,
        idempotencyKey,
        connection.ownerId,
      );
    } catch (error) {
      if (error instanceof WeixinLeaseLostError || !claimed) return;
      if (!guard.isActive() || connectionGuard?.isActive() === false) return;
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
      if (connectionGuard) await connectionGuard.stop();
      if (connectionLease) {
        await this.coordinator
          .releaseLease(connectionLease)
          .catch(() => undefined);
      }
      await guard.stop();
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async #acceptPreparedInbound(
    message: NonNullable<
      Awaited<ReturnType<PrismaWeixinRepository["claimInbound"]>>
    >,
    processingToken: string,
    idempotencyKey: string,
    ownerId: string,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new WeixinLeaseLostError();
    }
    const existingTurn = await this.repository.findTurnByIdempotencyKey(
      message.conversationId,
      idempotencyKey,
    );
    if (existingTurn) {
      await this.#markInboundAccepted(
        message,
        processingToken,
        existingTurn.id,
      );
      return;
    }
    if (await this.repository.conversationIsBusy(message.conversationId)) {
      await this.repository.deferInbound(
        message.id,
        processingToken,
        new Date(this.now().getTime() + BLOCKED_RETRY_MS),
      );
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
      {
        actorId: ownerId,
        userAgent: "LinkSense Weixin",
      },
    );
    await this.#markInboundAccepted(
      message,
      processingToken,
      receipt.turn_id,
    );
  }

  async #markInboundAccepted(
    message: NonNullable<
      Awaited<ReturnType<PrismaWeixinRepository["claimInbound"]>>
    >,
    processingToken: string,
    turnId: string,
  ): Promise<void> {
    if (!message.peerSessionId || !message.conversationId) {
      throw new WeixinLeaseLostError();
    }
    const accepted = await this.repository.markInboundAccepted({
      messageId: message.id,
      processingToken,
      connectionId: message.connectionId,
      peerSessionId: message.peerSessionId,
      conversationId: message.conversationId,
      turnId,
      processedAt: this.now(),
    });
    if (accepted) {
      await this.#startTypingForInbound(message, turnId).catch(() => undefined);
    }
  }

  async #startTypingForInbound(
    message: NonNullable<
      Awaited<ReturnType<PrismaWeixinRepository["claimInbound"]>>
    >,
    turnId: string,
  ): Promise<void> {
    const connection = await this.repository.findActiveConnection(
      message.connectionId,
    );
    if (!connection) throw new WeixinLeaseLostError();
    await this.#startTypingSession({
      connection,
      peerUserId: message.peerUserId,
      turnId,
      contextToken: this.#decryptInboundContext(message),
    });
  }

  async #refreshTypingSession(key: string): Promise<void> {
    const session = this.activeTyping.get(key);
    if (!session) return;
    const connection = await this.repository.findActiveConnection(
      session.connectionId,
    );
    if (!connection) {
      await this.#stopTypingSession(session);
      return;
    }
    const state = decryptWeixinConnectionState(connection, this.encryption);
    await this.#sendTyping({
      connection,
      token: state.token,
      peerUserId: session.peerUserId,
      typingTicket: session.typingTicket,
      status: "typing",
    }).catch(() => undefined);
  }

  async #stopTypingForTurn(
    connectionId: string,
    peerUserId: string,
    turnId: string,
  ): Promise<void> {
    const session = this.#takeTypingSessionForTurn(
      connectionId,
      peerUserId,
      turnId,
    );
    if (!session) return;
    await this.#cancelTypingSession(session);
  }

  async #stopTypingSession(session: WeixinTypingSession): Promise<void> {
    this.#clearTypingSession(session);
    await this.#cancelTypingSession(session);
  }

  #takeTypingSessionForTurn(
    connectionId: string,
    peerUserId: string,
    turnId: string,
  ): WeixinTypingSession | null {
    const session = this.activeTyping.get(
      typingKey(connectionId, peerUserId, turnId),
    );
    if (!session) return null;
    this.#clearTypingSession(session);
    return session;
  }

  #clearTypingSession(session: WeixinTypingSession): void {
    this.activeTyping.delete(session.key);
    clearInterval(session.timer);
  }

  async #cancelTypingSession(session: WeixinTypingSession): Promise<void> {
    const connection = await this.repository.findActiveConnection(
      session.connectionId,
    );
    if (!connection) return;
    const state = decryptWeixinConnectionState(connection, this.encryption);
    await this.#sendTyping({
      connection,
      token: state.token,
      peerUserId: session.peerUserId,
      typingTicket: session.typingTicket,
      status: "cancel",
    }).catch(() => undefined);
  }

  async #getTypingTicket(
    connection: Pick<WeixinTypingConnection, "id" | "apiBaseUrl">,
    token: string,
    peerUserId: string,
    contextToken: string,
  ): Promise<string> {
    const now = this.now().getTime();
    const cacheKey = typingTicketKey(connection.id, peerUserId);
    const entry = this.typingTickets.get(cacheKey);
    if (entry && now < entry.nextFetchAt) {
      return entry.typingTicket;
    }
    try {
      const config = await this.client.getConfig({
        baseUrl: connection.apiBaseUrl,
        token,
        ilinkUserId: peerUserId,
        contextToken,
      });
      this.typingTickets.set(cacheKey, {
        typingTicket: config.typingTicket,
        nextFetchAt:
          now +
          (config.typingTicket
            ? TYPING_CONFIG_CACHE_TTL_MS
            : TYPING_CONFIG_INITIAL_RETRY_MS),
        retryDelayMs: TYPING_CONFIG_INITIAL_RETRY_MS,
      });
      return config.typingTicket;
    } catch {
      const retryDelayMs = Math.min(
        (entry?.retryDelayMs ?? TYPING_CONFIG_INITIAL_RETRY_MS) * 2,
        TYPING_CONFIG_MAX_RETRY_MS,
      );
      this.typingTickets.set(cacheKey, {
        typingTicket: entry?.typingTicket ?? "",
        nextFetchAt: now + retryDelayMs,
        retryDelayMs,
      });
      return entry?.typingTicket ?? "";
    }
  }

  async #sendTyping(input: {
    connection: {
      ownerId: string;
      apiBaseUrl: string;
    };
    token: string;
    peerUserId: string;
    typingTicket: string;
    status: "typing" | "cancel";
  }): Promise<void> {
    await this.#withSendLocks(
      input.connection.ownerId,
      null,
      async () => {
        await this.client.sendTyping({
          baseUrl: input.connection.apiBaseUrl,
          token: input.token,
          ilinkUserId: input.peerUserId,
          typingTicket: input.typingTicket,
          status: input.status,
        });
      },
    );
  }

  async #startTypingSession(input: {
    connection: WeixinTypingConnection;
    peerUserId: string;
    turnId: string;
    contextToken: string;
  }): Promise<void> {
    const key = typingKey(
      input.connection.id,
      input.peerUserId,
      input.turnId,
    );
    if (this.activeTyping.has(key)) return;
    const state = decryptWeixinConnectionState(
      input.connection,
      this.encryption,
    );
    const typingTicket = await this.#getTypingTicket(
      input.connection,
      state.token,
      input.peerUserId,
      input.contextToken,
    );
    if (!typingTicket) return;
    await this.#sendTyping({
      connection: input.connection,
      token: state.token,
      peerUserId: input.peerUserId,
      typingTicket,
      status: "typing",
    });
    const session: WeixinTypingSession = {
      key,
      connectionId: input.connection.id,
      turnId: input.turnId,
      peerUserId: input.peerUserId,
      typingTicket,
      timer: setInterval(() => {
        void this.#refreshTypingSession(key).catch(() => undefined);
      }, TYPING_KEEPALIVE_MS),
    };
    session.timer.unref();
    this.activeTyping.set(key, session);
  }

  async #deliverOutbound(
    item: Awaited<
      ReturnType<PrismaWeixinRepository["listPendingDeliveries"]>
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
    let connectionLease: WeixinLease | null = null;
    let connectionGuard: RenewableLeaseGuard | null = null;
    let claimed = null as Awaited<
      ReturnType<PrismaWeixinRepository["claimDelivery"]>
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
      const activeClaim = claimed;
      item.delivery = activeClaim;
      guard.assertActive();

      connectionLease = await this.coordinator
        .acquireLease("connection", item.connection.id, CONNECTION_LEASE_MS)
        .catch(() => null);
      if (!connectionLease) {
        await this.repository.deferDelivery(
          activeClaim.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }
      connectionGuard = new RenewableLeaseGuard(
        this.coordinator,
        connectionLease,
        CONNECTION_LEASE_MS,
      );

      const connection = await this.repository.findActiveConnection(
        item.connection.id,
      );
      if (!connection) {
        await this.repository.deferDelivery(
          claimed.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }
      item.connection = connection;
      const outcome = await this.repository.getTurnOutcome(activeClaim.turnId);
      if (outcome.status === "running") {
        await this.#ensureTypingForDelivery(
          connection,
          item.inbound,
          activeClaim.turnId,
        ).catch(() => undefined);
        await this.repository.deferDelivery(
          activeClaim.id,
          lease.token,
          new Date(this.now().getTime() + BLOCKED_RETRY_MS),
        );
        return;
      }
      const terminalTypingSession = this.#takeTypingSessionForTurn(
        connection.id,
        item.inbound.peerUserId,
        activeClaim.turnId,
      );
      try {
        const locale = await this.repository.getOwnerLocale(connection.ownerId);
        const text =
          outcome.status === "completed"
            ? outcome.text?.trim() || emptyResponseMessage(locale)
            : failedResponseMessage(locale);
        const chunks = boundedChunks(text, locale);
        const contextToken = this.#decryptInboundContext(item.inbound);
        for (
          let index = activeClaim.sentChunkCount;
          index < chunks.length;
          index += 1
        ) {
          await this.#withSendLocks(
            connection.ownerId,
            activeClaim.conversationId,
            async () => {
              guard.assertActive();
              connectionGuard?.assertActive();
              const [currentDelivery, activeConnection] = await Promise.all([
                this.repository.findClaimedDelivery(activeClaim.id, lease.token),
                this.repository.findActiveConnection(connection.id),
              ]);
              if (!currentDelivery || !activeConnection) {
                throw new WeixinLeaseLostError();
              }
              if (currentDelivery.sentChunkCount >= index + 1) return;
              if (currentDelivery.sentChunkCount !== index) {
                throw new WeixinLeaseLostError();
              }
              await this.client.sendText({
                baseUrl: activeConnection.apiBaseUrl,
                token: decryptWeixinConnectionState(
                  activeConnection,
                  this.encryption,
                ).token,
                toUserId: item.inbound.peerUserId,
                contextToken,
                text: chunks[index] ?? "",
                clientId: `linksense-${activeClaim.id}-${index}`,
              });
              if (
                !(await this.repository.markDeliveryChunkSent(
                  activeClaim.id,
                  lease.token,
                  index + 1,
                ))
              ) {
                throw new WeixinLeaseLostError();
              }
            },
          );
        }
        guard.assertActive();
        connectionGuard.assertActive();
        await this.repository.markDeliverySent(
          activeClaim.id,
          lease.token,
          this.now(),
        );
      } finally {
        if (terminalTypingSession) {
          await this.#cancelTypingSession(terminalTypingSession).catch(
            () => undefined,
          );
        }
      }
    } catch (error) {
      if (error instanceof WeixinLeaseLostError || !claimed) return;
      if (!guard.isActive() || connectionGuard?.isActive() === false) return;
      if (
        error instanceof WeixinProtocolError &&
        error.reasonCode === "WEIXIN_CREDENTIAL_EXPIRED"
      ) {
        await this.repository
          .requireReauthorization(item.connection.id, this.now())
          .catch(() => undefined);
      }
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
      if (connectionGuard) await connectionGuard.stop();
      if (connectionLease) {
        await this.coordinator
          .releaseLease(connectionLease)
          .catch(() => undefined);
      }
      await guard.stop();
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async #ensureTypingForDelivery(
    connection: WeixinTypingConnection,
    inbound: {
      id: string;
      peerUserId: string;
      encryptedContext: string;
      encryptionKeyId: string;
    },
    turnId: string,
  ): Promise<void> {
    const key = typingKey(connection.id, inbound.peerUserId, turnId);
    if (this.activeTyping.has(key)) return;
    await this.#startTypingSession({
      connection,
      peerUserId: inbound.peerUserId,
      turnId,
      contextToken: this.#decryptInboundContext(inbound),
    });
  }

  async #sendProcessingFailure(
    item: Awaited<
      ReturnType<PrismaWeixinRepository["listPendingInbound"]>
    >[number],
    processingToken: string,
  ): Promise<void> {
    const claimedForTyping = await this.repository
      .findClaimedInbound(item.message.id, processingToken)
      .catch(() => null);
    if (claimedForTyping?.turnId) {
      await this.#stopTypingForTurn(
        item.connection.id,
        claimedForTyping.peerUserId,
        claimedForTyping.turnId,
      ).catch(() => undefined);
    }
    await this.#withSendLocks(
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
        if (!claimed || !connection) throw new WeixinLeaseLostError();
        const state = decryptWeixinConnectionState(connection, this.encryption);
        await this.client.sendText({
          baseUrl: connection.apiBaseUrl,
          token: state.token,
          toUserId: claimed.peerUserId,
          contextToken: this.#decryptInboundContext(claimed),
          text: processingFailureMessage(locale),
          clientId: `linksense-${claimed.id}-failed`,
        });
      },
    );
  }

  async #withSendLocks<T>(
    ownerId: string,
    conversationId: string | null,
    action: () => Promise<T>,
  ): Promise<T> {
    const userLease = await this.#acquireRequiredLease(
      "user-lifecycle",
      ownerId,
    );
    let conversationLease: WeixinLease | null = null;
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
  ): Promise<WeixinLease> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const lease = await this.coordinator.acquireLease(
        scope,
        resourceId,
        SEND_LOCK_MS,
      );
      if (lease) return lease;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new Error("WEIXIN_RUNTIME_LOCK_BUSY");
  }

  #decryptInboundContext(message: {
    id: string;
    encryptedContext: string;
    encryptionKeyId: string;
  }): string {
    return decryptWeixinContext(
      "inbound",
      message.id,
      message.encryptedContext,
      message.encryptionKeyId,
      this.encryption,
    );
  }
}

class WeixinLeaseLostError extends Error {
  constructor() {
    super("WEIXIN_LEASE_LOST");
    this.name = "WeixinLeaseLostError";
  }
}

class RenewableLeaseGuard {
  private readonly timer: ReturnType<typeof setInterval>;
  private renewal: Promise<void> | null = null;
  private active = true;

  constructor(
    private readonly coordinator: RedisWeixinCoordinator,
    private readonly lease: WeixinLease,
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
    if (!this.active) throw new WeixinLeaseLostError();
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

function orderMessagesBySequence<
  T extends { seq?: number | null | undefined },
>(
  messages: readonly T[],
): T[] {
  if (!messages.every((message) => Number.isSafeInteger(message.seq))) {
    return [...messages];
  }
  return [...messages].sort(
    (left, right) => (left.seq ?? 0) - (right.seq ?? 0),
  );
}

function stableRuntimeErrorCode(error: unknown): string {
  if (
    error instanceof WeixinProtocolError ||
    (error instanceof Error && "code" in error)
  ) {
    const code =
      error instanceof WeixinProtocolError
        ? error.reasonCode
        : (error as AppError).code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{0,119}$/u.test(code)) {
      return code;
    }
  }
  return "WEIXIN_RUNTIME_FAILED";
}

function retryDelayMilliseconds(attempts: number): number {
  return Math.min(2 ** Math.min(attempts, 8) * 1_000, 5 * 60_000);
}

function typingKey(
  connectionId: string,
  peerUserId: string,
  turnId: string,
): string {
  return `${connectionId}:${peerUserId}:${turnId}`;
}

function typingTicketKey(connectionId: string, peerUserId: string): string {
  return `${connectionId}:${peerUserId}`;
}

function boundedChunks(
  text: string,
  locale: "zh-CN" | "en-US",
): string[] {
  const chunks = splitWeixinText(text);
  if (chunks.length <= MAX_OUTBOUND_CHUNKS) return chunks;
  return [
    ...chunks.slice(0, MAX_OUTBOUND_CHUNKS - 1),
    locale === "en-US"
      ? "The response is too long for Weixin. Open the task in LinkSense to read the rest."
      : "回复内容较长，剩余内容请在 LinkSense 任务中查看。",
  ];
}

function emptyResponseMessage(locale: "zh-CN" | "en-US"): string {
  return locale === "en-US"
    ? "The task completed without a text response. Open it in LinkSense for details."
    : "任务已完成，但没有可发送的文本回复，请在 LinkSense 中查看详情。";
}

function failedResponseMessage(locale: "zh-CN" | "en-US"): string {
  return locale === "en-US"
    ? "The task did not complete successfully. Open it in LinkSense for details."
    : "任务未能成功完成，请在 LinkSense 中查看详情。";
}

function processingFailureMessage(locale: "zh-CN" | "en-US"): string {
  return locale === "en-US"
    ? "LinkSense could not process this message. Try again later or open LinkSense for details."
    : "LinkSense 暂时无法处理这条消息，请稍后重试或打开 LinkSense 查看详情。";
}
