import { randomUUID } from "node:crypto";

import {
  feishuConnectionSchema,
  feishuRegistrationSessionSchema,
  type FeishuConnection,
  type FeishuRegistrationSession,
} from "@linksense/shared";
import { z } from "zod";

import type { FeishuConnection as FeishuConnectionRow } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import { translateBackend } from "../../lib/i18n.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import {
  FeishuCoordinationError,
  RedisFeishuCoordinator,
} from "./coordinator.js";
import {
  FeishuOfficialClient,
  FeishuProtocolError,
  type FeishuRegistrationResult,
} from "./client.js";
import {
  FeishuConnectionConflictError,
  PrismaFeishuRepository,
} from "./repository.js";
import {
  encryptFeishuCredentials,
  type FeishuEncryption,
} from "./state.js";

const REGISTRATION_TTL_SECONDS = 10 * 60;
const SESSION_RETENTION_SECONDS = 20 * 60;
const USER_LIFECYCLE_LEASE_MS = 30_000;
const QR_GENERATION_TIMEOUT_MS = 30_000;

const persistedRegistrationSchema = z.strictObject({
  id: z.uuid(),
  ownerId: z.uuid(),
  operation: z.enum(["create", "update"]),
  status: z.enum([
    "generating_qr",
    "waiting_scan",
    "pending_approval",
    "connected",
    "expired",
    "failed",
  ]),
  qrcodeUrl: z.string().url().max(8_192).nullable(),
  connectionId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
});

type PersistedRegistration = z.infer<typeof persistedRegistrationSchema>;

export interface FeishuRuntimeControl {
  wake(): void;
}

export class FeishuService {
  private readonly registrationTasks = new Map<
    string,
    { controller: AbortController; promise: Promise<void> }
  >();

  constructor(
    private readonly repository: PrismaFeishuRepository,
    private readonly coordinator: RedisFeishuCoordinator,
    private readonly client: FeishuOfficialClient,
    private readonly audit: AuditService,
    private readonly encryption: FeishuEncryption,
    private readonly runtime: FeishuRuntimeControl,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async list(ownerId: string): Promise<{ items: FeishuConnection[] }> {
    const connection = await this.repository.findConnectionByOwner(ownerId);
    return {
      items:
        connection && connection.status !== "disconnecting"
          ? [projectFeishuConnection(connection, this.now())]
          : [],
    };
  }

  async startRegistration(
    ownerId: string,
    options: {
      allowExistingSelection?: boolean;
      forceCreate?: boolean;
    } = {},
  ): Promise<FeishuRegistrationSession> {
    const existingConnection =
      await this.repository.findConnectionByOwner(ownerId);
    if (existingConnection?.status === "disconnecting") {
      throw new AppError("FEISHU_CONNECTION_CONFLICT");
    }
    const registeredApp =
      options.forceCreate === true
        ? null
        : existingConnection ??
          (await this.repository.findAppBindingByOwner(ownerId));

    const session: PersistedRegistration = {
      id: this.createId(),
      ownerId,
      operation: registeredApp ? "update" : "create",
      status: "generating_qr",
      qrcodeUrl: null,
      connectionId: null,
      expiresAt: new Date(
        this.now().getTime() + REGISTRATION_TTL_SECONDS * 1_000,
      ).toISOString(),
    };
    await this.#storeRegistration(session);
    const previousId = await this.coordinator
      .replaceActiveRegistration(
        ownerId,
        session.id,
        SESSION_RETENTION_SECONDS,
      )
      .catch(mapCoordinationError);
    if (previousId) this.registrationTasks.get(previousId)?.controller.abort();

    const locale = await this.repository.getOwnerLocale(ownerId);
    const controller = new AbortController();
    const registrationSignal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(REGISTRATION_TTL_SECONDS * 1_000),
    ]);
    let resolveQr!: () => void;
    let rejectQr!: (error: unknown) => void;
    let qrReady = false;
    let qrPersistence = Promise.resolve();
    const qrPromise = new Promise<void>((resolve, reject) => {
      resolveQr = resolve;
      rejectQr = reject;
    });
    const qrGenerationTimer = setTimeout(() => {
      controller.abort();
      rejectQr(new AppError("FEISHU_REGISTRATION_UNAVAILABLE"));
    }, QR_GENERATION_TIMEOUT_MS);
    qrGenerationTimer.unref();
    const promise = this.client
      .registerPersonalAgent({
        signal: registrationSignal,
        appName: translateBackend("feishu.personalAgent.name", locale),
        appDescription: translateBackend(
          "feishu.personalAgent.description",
          locale,
        ),
        ...(registeredApp ? { existingAppId: registeredApp.appId } : {}),
        allowExistingSelection:
          !registeredApp && options.allowExistingSelection === true,
        onQrCodeReady: (info) => {
          clearTimeout(qrGenerationTimer);
          qrPersistence = this.#handleQrReady(session, info);
          void qrPersistence
            .then(() => {
              qrReady = true;
              resolveQr();
            })
            .catch(rejectQr);
        },
      })
      .then(async (credentials) => {
        await qrPersistence;
        await this.#completeRegistration(session, credentials);
      })
      .catch(async (error: unknown) => {
        const mapped = mapProtocolError(error);
        await this.#failRegistration(session).catch(() => undefined);
        if (!qrReady) rejectQr(mapped);
      })
      .finally(() => {
        clearTimeout(qrGenerationTimer);
        this.registrationTasks.delete(session.id);
      });
    this.registrationTasks.set(session.id, { controller, promise });

    try {
      await qrPromise;
    } catch (error) {
      throw error instanceof AppError
        ? error
        : new AppError("FEISHU_REGISTRATION_UNAVAILABLE");
    }
    return this.getRegistration(ownerId, session.id);
  }

  async getRegistration(
    ownerId: string,
    sessionId: string,
  ): Promise<FeishuRegistrationSession> {
    const session = await this.#requireRegistration(ownerId, sessionId);
    if (
      !isTerminalRegistration(session) &&
      new Date(session.expiresAt) <= this.now()
    ) {
      session.status = "expired";
      session.qrcodeUrl = null;
      this.registrationTasks.get(session.id)?.controller.abort();
      await this.#storeRegistration(session);
      await this.coordinator
        .clearActiveRegistration(ownerId, session.id)
        .catch(() => undefined);
    }
    return this.#projectRegistration(session);
  }

  async deleteConnection(
    ownerId: string,
    connectionId: string,
    auditContext: AuditContext,
  ): Promise<void> {
    const connection = await this.repository.findConnectionForOwner(
      ownerId,
      connectionId,
    );
    if (!connection) throw new AppError("FEISHU_CONNECTION_NOT_FOUND");
    if (connection.status === "disconnecting") {
      throw new AppError("FEISHU_CONNECTION_CONFLICT");
    }
    const previousStatus =
      connection.status === "reauthorization_required"
        ? "reauthorization_required"
        : "active";

    const lease = await this.coordinator
      .acquireLease("user-lifecycle", ownerId, USER_LIFECYCLE_LEASE_MS)
      .catch(mapCoordinationError);
    if (!lease) throw new AppError("FEISHU_CONNECTION_CONFLICT");
    let deleted = false;
    try {
      const marked = await this.repository.markConnectionDisconnecting(
        ownerId,
        connectionId,
        previousStatus,
      );
      if (!marked) throw new AppError("FEISHU_CONNECTION_CONFLICT");
      await this.repository.deleteConnection(ownerId, connectionId);
      deleted = true;
    } finally {
      if (!deleted) {
        await this.repository
          .restoreConnectionStatus(ownerId, connectionId, previousStatus)
          .catch(() => undefined);
      }
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
    await this.audit.write({
      ...auditContext,
      actorId: ownerId,
      action: "feishu_connection_deleted",
      targetType: "feishu_connection",
      targetId: connection.id,
      result: "success",
      metadata: { domain: connection.domain, status: connection.status },
    });
    this.client.forgetApp(
      connection.appId,
      connection.domain === "lark" ? "lark" : "feishu",
    );
    this.runtime.wake();
  }

  async close(): Promise<void> {
    const tasks = [...this.registrationTasks.values()];
    this.registrationTasks.clear();
    for (const task of tasks) task.controller.abort();
    await Promise.allSettled(tasks.map((task) => task.promise));
  }

  async #handleQrReady(
    original: PersistedRegistration,
    info: { url: string; expireIn: number },
  ): Promise<void> {
    if (
      !(await this.coordinator.isActiveRegistration(
        original.ownerId,
        original.id,
      ))
    ) {
      return;
    }
    const session = await this.#requireRegistration(
      original.ownerId,
      original.id,
    );
    if (isTerminalRegistration(session)) return;
    session.status = "waiting_scan";
    session.qrcodeUrl = info.url;
    const upstreamExpiry =
      this.now().getTime() +
      Math.min(
        Math.max(Math.floor(info.expireIn), 30),
        REGISTRATION_TTL_SECONDS,
      ) *
        1_000;
    session.expiresAt = new Date(
      Math.min(new Date(session.expiresAt).getTime(), upstreamExpiry),
    ).toISOString();
    await this.#storeRegistration(session);
  }

  async #completeRegistration(
    original: PersistedRegistration,
    result: FeishuRegistrationResult,
  ): Promise<void> {
    if (
      !(await this.coordinator.isActiveRegistration(
        original.ownerId,
        original.id,
      ))
    ) {
      return;
    }
    const lifecycleLease = await this.coordinator.acquireLease(
      "user-lifecycle",
      original.ownerId,
      USER_LIFECYCLE_LEASE_MS,
    );
    if (!lifecycleLease) throw new FeishuConnectionConflictError();
    try {
      const previous = await this.repository.findConnectionByOwner(
        original.ownerId,
      );
      const connectionId = this.createId();
      const connection = await this.repository.replaceConnection({
        id: connectionId,
        ownerId: original.ownerId,
        appId: result.appId,
        ownerOpenId: result.ownerOpenId,
        domain: result.domain,
        encryptedCredentials: encryptFeishuCredentials(
          connectionId,
          {
            appId: result.appId,
            appSecret: result.appSecret,
            domain: result.domain,
          },
          this.encryption,
        ),
        encryptionKeyId: this.encryption.keyId,
      });
      const session = await this.#requireRegistration(
        original.ownerId,
        original.id,
      );
      // Feishu has already confirmed the create/update operation at this point.
      // Connection preparation belongs to FeishuRuntime, which retries transient
      // propagation failures and projects approval/error state onto the connection.
      session.status = "connected";
      session.qrcodeUrl = null;
      session.connectionId = connection.id;
      await this.#storeRegistration(session);
      await this.audit.write({
        actorId: original.ownerId,
        action: "feishu_connection_created",
        targetType: "feishu_connection",
        targetId: connection.id,
        result: "success",
        metadata: { domain: connection.domain, status: connection.status },
      });
      if (previous) {
        this.client.forgetApp(
          previous.appId,
          previous.domain === "lark" ? "lark" : "feishu",
        );
      }
      this.runtime.wake();
    } finally {
      await this.coordinator.releaseLease(lifecycleLease).catch(() => undefined);
      await this.coordinator
        .clearActiveRegistration(original.ownerId, original.id)
        .catch(() => undefined);
    }
  }

  async #failRegistration(original: PersistedRegistration): Promise<void> {
    const encrypted = await this.coordinator.getRegistrationSession(original.id);
    if (!encrypted) return;
    const session = this.#decryptRegistration(original.id, encrypted);
    if (
      session.ownerId !== original.ownerId ||
      isTerminalRegistration(session)
    ) {
      return;
    }
    session.status =
      new Date(session.expiresAt) <= this.now() ? "expired" : "failed";
    session.qrcodeUrl = null;
    await this.#storeRegistration(session);
    await this.coordinator
      .clearActiveRegistration(original.ownerId, original.id)
      .catch(() => undefined);
  }

  async #projectRegistration(
    session: PersistedRegistration,
  ): Promise<FeishuRegistrationSession> {
    const connection = session.connectionId
      ? await this.repository.findConnectionForOwner(
          session.ownerId,
          session.connectionId,
        )
      : null;
    return feishuRegistrationSessionSchema.parse({
      id: session.id,
      operation: session.operation,
      status: session.status,
      qrcode_url: session.qrcodeUrl,
      expires_at: session.expiresAt,
      connection:
        connection && connection.status !== "disconnecting"
          ? projectFeishuConnection(connection, this.now())
          : null,
    });
  }

  async #storeRegistration(session: PersistedRegistration): Promise<void> {
    const encrypted = encryptJson(
      persistedRegistrationSchema.parse(session),
      this.encryption.masterKey,
      this.encryption.keyId,
      registrationContext(session.id),
    );
    await this.coordinator
      .setRegistrationSession(
        session.id,
        encrypted,
        SESSION_RETENTION_SECONDS,
      )
      .catch(mapCoordinationError);
  }

  async #requireRegistration(
    ownerId: string,
    sessionId: string,
  ): Promise<PersistedRegistration> {
    const encrypted = await this.coordinator
      .getRegistrationSession(sessionId)
      .catch(mapCoordinationError);
    if (!encrypted) throw new AppError("FEISHU_REGISTRATION_NOT_FOUND");
    try {
      const session = this.#decryptRegistration(sessionId, encrypted);
      if (session.id !== sessionId || session.ownerId !== ownerId) {
        throw new Error("registration owner mismatch");
      }
      return session;
    } catch {
      throw new AppError("FEISHU_REGISTRATION_NOT_FOUND");
    }
  }

  #decryptRegistration(
    sessionId: string,
    encrypted: string,
  ): PersistedRegistration {
    return persistedRegistrationSchema.parse(
      decryptJson(
        encrypted,
        this.encryption.masterKey,
        this.encryption.keyId,
        registrationContext(sessionId),
      ),
    );
  }
}

export function projectFeishuConnection(
  row: FeishuConnectionRow,
  now: Date,
): FeishuConnection {
  const runtimeStatus =
    row.status === "reauthorization_required"
      ? row.lastErrorCode === "FEISHU_REAUTHORIZATION_REQUIRED"
        ? "pending_approval"
        : "reauthorization_required"
      : row.lastErrorAt &&
          (!row.lastConnectedAt || row.lastErrorAt > row.lastConnectedAt)
        ? "error"
        : row.lastConnectedAt &&
            now.getTime() - row.lastConnectedAt.getTime() <= 90_000
          ? "online"
          : "connecting";
  return feishuConnectionSchema.parse({
    id: row.id,
    account_hint: `****${row.ownerOpenId.slice(-4)}`,
    bot_name: row.botName,
    status: row.status,
    runtime_status: runtimeStatus,
    last_connected_at: row.lastConnectedAt?.toISOString() ?? null,
    last_inbound_at: row.lastInboundAt?.toISOString() ?? null,
    last_error_code: row.lastErrorCode,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function registrationContext(sessionId: string): string {
  return `feishu-registration:${sessionId}`;
}

function isTerminalRegistration(session: PersistedRegistration): boolean {
  return ["pending_approval", "connected", "expired", "failed"].includes(
    session.status,
  );
}

function mapProtocolError(error: unknown): AppError {
  if (error instanceof FeishuProtocolError) {
    return new AppError(
      error.reasonCode === "FEISHU_PROTOCOL_INVALID"
        ? "FEISHU_PROTOCOL_INVALID"
        : "FEISHU_REGISTRATION_UNAVAILABLE",
    );
  }
  if (error instanceof FeishuConnectionConflictError) {
    return new AppError("FEISHU_CONNECTION_CONFLICT");
  }
  return new AppError("FEISHU_REGISTRATION_UNAVAILABLE");
}

function mapCoordinationError(error: unknown): never {
  if (error instanceof FeishuCoordinationError) {
    throw new AppError("FEISHU_COORDINATION_UNAVAILABLE");
  }
  throw error;
}
