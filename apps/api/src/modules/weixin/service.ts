import { randomUUID } from "node:crypto";

import {
  weixinConnectionSchema,
  weixinLoginSessionSchema,
  type WeixinConnection,
  type WeixinLoginSession,
} from "@linksense/shared";
import { z } from "zod";

import type { WeixinConnection as WeixinConnectionRow } from "../../generated/prisma/client.js";
import { decryptJson, encryptJson } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import type { ApplicationService } from "../applications/service.js";
import {
  RedisWeixinCoordinator,
  WeixinCoordinationError,
} from "./coordinator.js";
import {
  normalizeWeixinApiBaseUrl,
  redirectHostToBaseUrl,
  WeixinIlinkClient,
  WeixinProtocolError,
} from "./protocol.js";
import {
  PrismaWeixinRepository,
  WeixinConnectionDisconnectingError,
  type WeixinConnectionState,
} from "./repository.js";
import {
  decryptWeixinConnectionState,
  encryptWeixinConnectionState,
  type WeixinEncryption,
} from "./state.js";

const LOGIN_TTL_SECONDS = 10 * 60;
const LOGIN_POLL_LEASE_MS = 45_000;
const DISCONNECT_LEASE_MS = 30_000;

const persistedLoginSessionSchema = z.strictObject({
  id: z.uuid(),
  ownerId: z.uuid(),
  status: z.enum([
    "waiting_scan",
    "scanned",
    "verification_required",
    "connected",
    "expired",
    "failed",
  ]),
  qrcode: z.string().min(1).max(16_384).nullable(),
  qrcodeUrl: z.string().url().max(4_096).nullable(),
  baseUrl: z.string().url().max(4_096),
  applicationId: z.uuid().nullable(),
  applicationName: z.string().min(1).max(160).nullable(),
  connectionId: z.uuid().nullable(),
  expiresAt: z.iso.datetime(),
});

const verificationSchema = z.strictObject({
  verifyCode: z.string().regex(/^\d{4,8}$/u),
});

type PersistedLoginSession = z.infer<typeof persistedLoginSessionSchema>;

export interface WeixinRuntimeControl {
  wake(): void;
}

export class WeixinService {
  constructor(
    private readonly repository: PrismaWeixinRepository,
    private readonly coordinator: RedisWeixinCoordinator,
    private readonly client: WeixinIlinkClient,
    private readonly applications: Pick<ApplicationService, "resolveRuntime">,
    private readonly audit: AuditService,
    private readonly encryption: WeixinEncryption,
    private readonly runtime: WeixinRuntimeControl,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async list(ownerId: string): Promise<{ items: WeixinConnection[] }> {
    const connection = await this.repository.findConnectionByOwner(ownerId);
    return {
      items:
        connection && connection.status !== "disconnecting"
          ? [projectConnection(connection, this.now())]
          : [],
    };
  }

  async startLogin(
    ownerId: string,
    input: { application_id: string | null },
  ): Promise<WeixinLoginSession> {
    const application = await this.#resolveApplication(
      ownerId,
      input.application_id,
    );
    const existing = await this.repository.findConnectionByOwner(ownerId);
    if (existing?.status === "disconnecting") {
      throw new AppError("CONFLICT");
    }
    const localTokenList = existing
      ? [this.decryptConnectionState(existing).token]
      : [];
    let started: Awaited<ReturnType<WeixinIlinkClient["startLogin"]>>;
    try {
      started = await this.client.startLogin(localTokenList);
    } catch (error) {
      throw mapProtocolError(error);
    }

    const session: PersistedLoginSession = {
      id: this.createId(),
      ownerId,
      status: "waiting_scan",
      qrcode: started.qrcode,
      qrcodeUrl: started.qrcodeUrl,
      baseUrl: "https://ilinkai.weixin.qq.com",
      applicationId: application?.id ?? null,
      applicationName: application?.name ?? null,
      connectionId: null,
      expiresAt: new Date(
        this.now().getTime() + LOGIN_TTL_SECONDS * 1_000,
      ).toISOString(),
    };
    await this.#storeLoginSession(session);
    return projectLoginSession(session, null);
  }

  async getLogin(
    ownerId: string,
    sessionId: string,
  ): Promise<WeixinLoginSession> {
    let session = await this.#requireLoginSession(ownerId, sessionId);
    if (isTerminalLogin(session)) {
      return this.#projectPersistedLogin(session);
    }

    const lease = await this.coordinator
      .acquireLease("login", sessionId, LOGIN_POLL_LEASE_MS)
      .catch(mapCoordinationError);
    if (!lease) return this.#projectPersistedLogin(session);

    try {
      session = await this.#requireLoginSession(ownerId, sessionId);
      if (isTerminalLogin(session)) {
        return this.#projectPersistedLogin(session);
      }
      const verification = await this.#readVerification(session.id);
      let result;
      try {
        result = await this.client.pollLogin({
          qrcode: requireQrCode(session),
          baseUrl: session.baseUrl,
          ...(verification ? { verifyCode: verification.verifyCode } : {}),
        });
      } catch (error) {
        throw mapProtocolError(error);
      }

      switch (result.status) {
        case "wait":
          session.status = "waiting_scan";
          break;
        case "scaned":
          session.status = "scanned";
          break;
        case "need_verifycode":
          session.status = "verification_required";
          break;
        case "scaned_but_redirect":
          if (!result.redirect_host) {
            session.status = "failed";
            break;
          }
          try {
            session.baseUrl = redirectHostToBaseUrl(result.redirect_host);
          } catch (error) {
            throw mapProtocolError(error);
          }
          session.status = "scanned";
          break;
        case "expired":
          session.status = "expired";
          session.qrcode = null;
          session.qrcodeUrl = null;
          break;
        case "verify_code_blocked":
          session.status = "failed";
          session.qrcode = null;
          session.qrcodeUrl = null;
          await this.coordinator
            .clearLoginVerification(session.id)
            .catch(mapCoordinationError);
          break;
        case "binded_redirect": {
          const existing = await this.repository.findConnectionByOwner(ownerId);
          if (!existing) {
            session.status = "failed";
            break;
          }
          if (existing.status === "disconnecting") {
            throw new AppError("CONFLICT");
          }
          let connection: WeixinConnectionRow;
          try {
            connection = await this.repository.reactivateConnection({
              id: existing.id,
              applicationId: session.applicationId,
              applicationName: session.applicationName,
            });
          } catch (error) {
            if (error instanceof WeixinConnectionDisconnectingError) {
              throw new AppError("CONFLICT");
            }
            throw error;
          }
          session.status = "connected";
          session.connectionId = connection.id;
          session.qrcode = null;
          session.qrcodeUrl = null;
          await this.audit.write({
            actorId: ownerId,
            action: "weixin_connection_reconnected",
            targetType: "weixin_connection",
            targetId: connection.id,
            result: "success",
            metadata: {
              application_id: connection.applicationId,
              status: connection.status,
            },
          });
          this.runtime.wake();
          break;
        }
        case "confirmed": {
          if (
            !result.bot_token ||
            !result.ilink_bot_id ||
            !result.ilink_user_id
          ) {
            throw new AppError("WEIXIN_PROTOCOL_INVALID");
          }
          const connectionId = this.createId();
          let apiBaseUrl: string;
          try {
            apiBaseUrl = normalizeWeixinApiBaseUrl(
              result.baseurl ?? session.baseUrl,
            );
          } catch (error) {
            throw mapProtocolError(error);
          }
          let connection: WeixinConnectionRow;
          try {
            connection = await this.#replaceConnection({
              id: connectionId,
              ownerId,
              applicationId: session.applicationId,
              applicationName: session.applicationName,
              ilinkBotId: result.ilink_bot_id,
              ilinkUserId: result.ilink_user_id,
              apiBaseUrl,
              encryptedState: this.encryptConnectionState(connectionId, {
                token: result.bot_token,
                cursor: "",
              }),
              encryptionKeyId: this.encryption.keyId,
            });
          } catch (error) {
            if (
              isUniqueConstraintError(error) ||
              error instanceof WeixinConnectionDisconnectingError
            ) {
              throw new AppError("WEIXIN_CONNECTION_CONFLICT");
            }
            throw error;
          }
          session.status = "connected";
          session.connectionId = connection.id;
          session.qrcode = null;
          session.qrcodeUrl = null;
          await this.audit.write({
            actorId: ownerId,
            action: "weixin_connection_created",
            targetType: "weixin_connection",
            targetId: connection.id,
            result: "success",
            metadata: {
              application_id: connection.applicationId,
              status: connection.status,
            },
          });
          this.runtime.wake();
          break;
        }
      }

      if (isTerminalLogin(session)) {
        session.qrcode = null;
        session.qrcodeUrl = null;
        await this.coordinator
          .clearLoginVerification(session.id)
          .catch(() => undefined);
      }
      await this.#storeLoginSession(session);
      return this.#projectPersistedLogin(session);
    } finally {
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async submitVerification(
    ownerId: string,
    sessionId: string,
    verifyCode: string,
  ): Promise<WeixinLoginSession> {
    let lease = null as Awaited<
      ReturnType<RedisWeixinCoordinator["acquireLease"]>
    >;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      lease = await this.coordinator
        .acquireLease("login", sessionId, LOGIN_POLL_LEASE_MS)
        .catch(mapCoordinationError);
      if (lease) break;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    if (!lease) throw new AppError("CONFLICT");

    try {
      const session = await this.#requireLoginSession(ownerId, sessionId);
      if (session.status !== "verification_required") {
        throw new AppError("CONFLICT");
      }
      const encrypted = encryptJson(
        { verifyCode },
        this.encryption.masterKey,
        this.encryption.keyId,
        loginVerificationContext(sessionId),
      );
      await this.coordinator
        .setLoginVerification(
          sessionId,
          encrypted,
          secondsUntil(session.expiresAt, this.now()),
        )
        .catch(mapCoordinationError);
      session.status = "scanned";
      await this.#storeLoginSession(session);
      return this.#projectPersistedLogin(session);
    } finally {
      await this.coordinator.releaseLease(lease).catch(() => undefined);
    }
  }

  async updateConnection(
    ownerId: string,
    connectionId: string,
    input: { application_id: string | null },
    auditContext: AuditContext,
  ): Promise<WeixinConnection> {
    const current = await this.#requireConnection(ownerId, connectionId);
    const application = await this.#resolveApplication(
      ownerId,
      input.application_id,
    );
    let updated: WeixinConnectionRow;
    try {
      updated = await this.repository.updateConnectionApplication({
        id: current.id,
        applicationId: application?.id ?? null,
        applicationName: application?.name ?? null,
      });
    } catch (error) {
      if (error instanceof WeixinConnectionDisconnectingError) {
        throw new AppError("CONFLICT");
      }
      throw error;
    }
    await this.audit.write({
      ...auditContext,
      actorId: ownerId,
      action: "weixin_connection_updated",
      targetType: "weixin_connection",
      targetId: updated.id,
      result: "success",
      metadata: {
        application_id: updated.applicationId,
        status: updated.status,
      },
    });
    this.runtime.wake();
    return projectConnection(updated, this.now());
  }

  async deleteConnection(
    ownerId: string,
    connectionId: string,
    auditContext: AuditContext,
  ): Promise<void> {
    const current = await this.#requireConnection(ownerId, connectionId);
    const marked = await this.repository.markConnectionDisconnecting(
      ownerId,
      connectionId,
    );
    if (!marked) throw new AppError("CONFLICT");

    let lease = null as Awaited<
      ReturnType<RedisWeixinCoordinator["acquireLease"]>
    >;
    let deleted = false;
    try {
      for (let attempt = 0; attempt < 400; attempt += 1) {
        lease = await this.coordinator
          .acquireLease("connection", connectionId, DISCONNECT_LEASE_MS)
          .catch(mapCoordinationError);
        if (lease) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      if (!lease) throw new AppError("CONFLICT");
      await this.repository.deleteConnection(ownerId, connectionId);
      deleted = true;
    } finally {
      if (!deleted) {
        await this.repository
          .restoreConnectionStatus(ownerId, connectionId, current.status)
          .catch(() => undefined);
      }
      if (lease) {
        await this.coordinator.releaseLease(lease).catch(() => undefined);
      }
    }
    await this.audit.write({
      ...auditContext,
      actorId: ownerId,
      action: "weixin_connection_deleted",
      targetType: "weixin_connection",
      targetId: current.id,
      result: "success",
      metadata: {
        application_id: current.applicationId,
        status: current.status,
      },
    });
    this.runtime.wake();
  }

  decryptConnectionState(row: WeixinConnectionRow): WeixinConnectionState {
    return decryptWeixinConnectionState(row, this.encryption);
  }

  encryptConnectionState(
    connectionId: string,
    state: WeixinConnectionState,
  ): string {
    return encryptWeixinConnectionState(connectionId, state, this.encryption);
  }

  async #resolveApplication(
    ownerId: string,
    applicationId: string | null,
  ): Promise<{ id: string; name: string } | null> {
    if (!applicationId) return null;
    const application = await this.applications.resolveRuntime(
      ownerId,
      applicationId,
    );
    return {
      id: application.applicationId,
      name: application.applicationName,
    };
  }

  async #replaceConnection(
    input: Parameters<PrismaWeixinRepository["replaceConnection"]>[0],
  ): Promise<WeixinConnectionRow> {
    const existing = await this.repository.findConnectionByOwner(input.ownerId);
    if (!existing) return this.repository.replaceConnection(input);
    if (existing.status === "disconnecting") throw new AppError("CONFLICT");
    if (
      !(await this.repository.markConnectionDisconnecting(
        input.ownerId,
        existing.id,
      ))
    ) {
      throw new AppError("CONFLICT");
    }

    let lease = null as Awaited<
      ReturnType<RedisWeixinCoordinator["acquireLease"]>
    >;
    let replaced = false;
    try {
      lease = await this.#acquireConnectionLease(existing.id);
      const connection = await this.repository.replaceConnection({
        ...input,
        drainedConnectionId: existing.id,
      });
      replaced = true;
      return connection;
    } finally {
      if (!replaced) {
        await this.repository
          .restoreConnectionStatus(input.ownerId, existing.id, existing.status)
          .catch(() => undefined);
      }
      if (lease) {
        await this.coordinator.releaseLease(lease).catch(() => undefined);
      }
    }
  }

  async #acquireConnectionLease(
    connectionId: string,
  ): Promise<NonNullable<
    Awaited<ReturnType<RedisWeixinCoordinator["acquireLease"]>>
  >> {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const lease = await this.coordinator
        .acquireLease("connection", connectionId, DISCONNECT_LEASE_MS)
        .catch(mapCoordinationError);
      if (lease) return lease;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    throw new AppError("CONFLICT");
  }

  async #requireConnection(
    ownerId: string,
    connectionId: string,
  ): Promise<WeixinConnectionRow> {
    const connection = await this.repository.findConnectionForOwner(
      ownerId,
      connectionId,
    );
    if (!connection) throw new AppError("WEIXIN_CONNECTION_NOT_FOUND");
    if (connection.status === "disconnecting") throw new AppError("CONFLICT");
    return connection;
  }

  async #storeLoginSession(
    session: PersistedLoginSession,
  ): Promise<void> {
    const ttl = secondsUntil(session.expiresAt, this.now());
    const encrypted = encryptJson(
      persistedLoginSessionSchema.parse(session),
      this.encryption.masterKey,
      this.encryption.keyId,
      loginSessionContext(session.id),
    );
    await this.coordinator
      .setLoginSession(session.id, encrypted, ttl)
      .catch(mapCoordinationError);
  }

  async #requireLoginSession(
    ownerId: string,
    sessionId: string,
  ): Promise<PersistedLoginSession> {
    const encrypted = await this.coordinator
      .getLoginSession(sessionId)
      .catch(mapCoordinationError);
    if (!encrypted) throw new AppError("WEIXIN_LOGIN_SESSION_NOT_FOUND");
    let session: PersistedLoginSession;
    try {
      session = persistedLoginSessionSchema.parse(
        decryptJson(
          encrypted,
          this.encryption.masterKey,
          this.encryption.keyId,
          loginSessionContext(sessionId),
        ),
      );
    } catch {
      throw new AppError("WEIXIN_LOGIN_SESSION_NOT_FOUND");
    }
    if (session.ownerId !== ownerId || session.id !== sessionId) {
      throw new AppError("WEIXIN_LOGIN_SESSION_NOT_FOUND");
    }
    if (new Date(session.expiresAt) <= this.now()) {
      await this.coordinator.deleteLoginSession(sessionId).catch(() => undefined);
      throw new AppError("WEIXIN_LOGIN_SESSION_NOT_FOUND");
    }
    return session;
  }

  async #readVerification(
    sessionId: string,
  ): Promise<z.infer<typeof verificationSchema> | null> {
    const encrypted = await this.coordinator
      .takeLoginVerification(sessionId)
      .catch(mapCoordinationError);
    if (!encrypted) return null;
    try {
      return verificationSchema.parse(
        decryptJson(
          encrypted,
          this.encryption.masterKey,
          this.encryption.keyId,
          loginVerificationContext(sessionId),
        ),
      );
    } catch {
      return null;
    }
  }

  async #projectPersistedLogin(
    session: PersistedLoginSession,
  ): Promise<WeixinLoginSession> {
    const connection = session.connectionId
      ? await this.repository.findConnectionForOwner(
          session.ownerId,
          session.connectionId,
        )
      : null;
    return projectLoginSession(
      session,
      connection && connection.status !== "disconnecting"
        ? projectConnection(connection, this.now())
        : null,
    );
  }
}

export function projectConnection(
  row: WeixinConnectionRow,
  now: Date,
): WeixinConnection {
  const runtimeStatus =
    row.status === "reauthorization_required"
      ? "reauthorization_required"
      : row.lastErrorAt && (!row.lastPollAt || row.lastErrorAt > row.lastPollAt)
        ? "error"
        : row.lastPollAt && now.getTime() - row.lastPollAt.getTime() <= 90_000
          ? "online"
          : "connecting";
  const identifier = row.ilinkUserId;
  return weixinConnectionSchema.parse({
    id: row.id,
    account_hint: `****${identifier.slice(-4)}`,
    application:
      row.applicationId && row.applicationName
        ? { id: row.applicationId, name: row.applicationName }
        : null,
    status: row.status,
    runtime_status: runtimeStatus,
    last_poll_at: row.lastPollAt?.toISOString() ?? null,
    last_inbound_at: row.lastInboundAt?.toISOString() ?? null,
    last_error_code: row.lastErrorCode,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function projectLoginSession(
  session: PersistedLoginSession,
  connection: WeixinConnection | null,
): WeixinLoginSession {
  return weixinLoginSessionSchema.parse({
    id: session.id,
    status: session.status,
    qrcode_url: session.qrcodeUrl,
    expires_at: session.expiresAt,
    connection,
  });
}

function requireQrCode(session: PersistedLoginSession): string {
  if (!session.qrcode) throw new AppError("WEIXIN_LOGIN_SESSION_NOT_FOUND");
  return session.qrcode;
}

function isTerminalLogin(session: PersistedLoginSession): boolean {
  return ["connected", "expired", "failed"].includes(session.status);
}

function secondsUntil(timestamp: string, now: Date): number {
  return Math.max(1, Math.ceil((new Date(timestamp).getTime() - now.getTime()) / 1_000));
}

function loginSessionContext(sessionId: string): string {
  return `weixin-login:${sessionId}`;
}

function loginVerificationContext(sessionId: string): string {
  return `weixin-login-verification:${sessionId}`;
}

function mapProtocolError(error: unknown): AppError {
  if (!(error instanceof WeixinProtocolError)) {
    return new AppError("WEIXIN_UPSTREAM_UNAVAILABLE");
  }
  if (error.reasonCode === "WEIXIN_PROTOCOL_INVALID") {
    return new AppError("WEIXIN_PROTOCOL_INVALID");
  }
  return new AppError("WEIXIN_UPSTREAM_UNAVAILABLE");
}

function mapCoordinationError(error: unknown): never {
  if (error instanceof WeixinCoordinationError) {
    throw new AppError("WEIXIN_COORDINATION_UNAVAILABLE");
  }
  throw error;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "P2002"
  );
}
