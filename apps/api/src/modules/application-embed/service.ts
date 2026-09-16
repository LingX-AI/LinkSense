import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
  APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
  APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
  APPLICATION_EMBED_TICKET_TTL_SECONDS,
  applicationExternalAccessSchema,
  type ApplicationEmbedAccessTokenClaims,
  type ApplicationEmbedConversationSummary,
  type ApplicationExternalAccess,
  type UpdateApplicationExternalAccessInput,
} from "@linksense/shared";

import type { PrismaClient } from "../../generated/prisma/client.js";
import type { LinkSenseRedis } from "../../adapters/redis.js";
import type { ObjectStorage } from "../../adapters/object-storage.js";
import { decryptJson, encryptJson, randomToken, sha256 } from "../../lib/crypto.js";
import { AppError } from "../../lib/errors.js";
import type { AuditContext, AuditService } from "../audit/service.js";
import type { RequestActor } from "../capabilities/types.js";

const APP_ID_PREFIX = "lsa_";
const APP_SECRET_PREFIX = "lss_";
const PUBLIC_ID_PREFIX = "app_";
const RENEWAL_TOKEN_PREFIX = "lsr_";
const TICKET_PREFIX = "lst_";
const EXTERNAL_APPLICATION_SESSION_ID_CONTEXT_PREFIX =
  "linksense:external-application-session-id:v1:";
const RATE_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if count > tonumber(ARGV[1]) then return 0 end
return 1
`;

type ExternalAccessRow = Awaited<
  ReturnType<PrismaClient["applicationExternalAccess"]["findUnique"]>
> & {};

export type ApplicationEmbedAccessTokenIssuer = (
  claims: Omit<ApplicationEmbedAccessTokenClaims, "iat" | "exp">,
  expiresInSeconds: number,
) => Promise<{ token: string; expiresAt: Date }>;

export type VerifiedApplicationEmbedSession = {
  sessionId: string;
  ownerId: string;
  applicationId: string;
  conversationId: string;
  externalAccessId: string;
  origin: string;
  absoluteExpiresAt: Date;
};

type TicketIdentity = {
  externalSubject: string | null;
  externalTenant: string | null;
  displayName: string | null;
};

type ApplicationEmbedSessionTokenUpdate = {
  session_id: string;
  session_expires_at: string;
  conversation_id: string;
  access_token: string | null;
  renewal_token: string | null;
  access_token_expires_at: string | null;
  renewal_token_expires_at: string | null;
};

export class ApplicationExternalAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: LinkSenseRedis,
    private readonly audit: AuditService,
    private readonly storage: ObjectStorage,
    private readonly publicBaseUrl: string,
    private readonly credentialMasterKey: string,
    private readonly credentialKeyId: string,
    private readonly createConversation: (
      ownerId: string,
      application: { id: string; name: string },
      conversationId?: string,
    ) => Promise<{ id: string }>,
    private readonly cleanupConversation: (
      ownerId: string,
      conversationId: string,
      context?: AuditContext,
      deletionReason?: "user" | "creation-failed",
    ) => Promise<void>,
    private readonly scheduleConversationTitle: (
      conversationId: string,
    ) => void = () => undefined,
    private readonly now: () => Date = () => new Date(),
    private readonly reserveConversationId: () => string = randomUUID,
  ) {}

  async getManagement(
    actor: RequestActor,
    applicationId: string,
  ): Promise<ApplicationExternalAccess | null> {
    assertActiveActor(actor);
    await this.#requireOwnedApplication(actor.id, applicationId);
    const access = await this.prisma.applicationExternalAccess.findUnique({
      where: { applicationId },
    });
    if (!access) return null;
    const normalizedAccess =
      access.appId === null
        ? await this.prisma.applicationExternalAccess.update({
            where: { id: access.id },
            data: {
              appId: `${APP_ID_PREFIX}${randomToken(18)}`,
              updatedBy: actor.id,
              updatedAt: this.now(),
            },
          })
        : access;
    return this.#projectAccess(normalizedAccess);
  }

  async updateManagement(
    actor: RequestActor,
    applicationId: string,
    input: UpdateApplicationExternalAccessInput,
    context: AuditContext,
  ): Promise<{
    access: ApplicationExternalAccess;
    appSecret: string | null;
  }> {
    assertActiveActor(actor);
    await this.#requireOwnedApplication(actor.id, applicationId);
    const normalizedAllowedOrigins = validateAllowedOrigins(
      input.allowed_origins,
    );
    const normalizedStarterQuestionSets = validateStarterQuestionSets(
      input.starter_questions_by_origin,
      normalizedAllowedOrigins,
    );
    const current = await this.prisma.applicationExternalAccess.findUnique({
      where: { applicationId },
    });
    const generatedSecret =
      input.auth_mode === "required" &&
      (current === null ||
        current.authMode !== "required" ||
        current.appId === null ||
        current.appSecretHash === null)
        ? `${APP_SECRET_PREFIX}${randomToken(32)}`
        : null;
    const appId = current?.appId ?? `${APP_ID_PREFIX}${randomToken(18)}`;
    const publicId = current?.publicId ?? `${PUBLIC_ID_PREFIX}${randomToken(18)}`;
    const now = this.now();
    const configurationChanged =
      current !== null &&
      (current.enabled !== input.enabled ||
        current.authMode !== input.auth_mode ||
        !sameStringArray(allowedOrigins(current), normalizedAllowedOrigins));

    const access = await this.prisma.$transaction(async (tx) => {
      if (current === null) {
        return tx.applicationExternalAccess.create({
          data: {
            applicationId,
            publicId,
            enabled: input.enabled,
            authMode: input.auth_mode,
            appId,
            appSecretHash:
              generatedSecret === null ? null : sha256(generatedSecret),
            appSecretEncrypted:
              generatedSecret === null
                ? null
                : encryptApplicationExternalSecret(
                    generatedSecret,
                    this.credentialMasterKey,
                    this.credentialKeyId,
                    applicationId,
                  ),
            appSecretEncryptionKeyId:
              generatedSecret === null ? null : this.credentialKeyId,
            credentialVersion: 1,
            allowedOriginsJson: normalizedAllowedOrigins,
            starterQuestionsJson: normalizedStarterQuestionSets,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
        });
      }
      const updated = await tx.applicationExternalAccess.update({
        where: { id: current.id },
        data: {
          enabled: input.enabled,
          authMode: input.auth_mode,
          appId,
          ...(generatedSecret === null
            ? {}
            : {
                appSecretHash: sha256(generatedSecret),
                appSecretEncrypted: encryptApplicationExternalSecret(
                  generatedSecret,
                  this.credentialMasterKey,
                  this.credentialKeyId,
                  applicationId,
                ),
                appSecretEncryptionKeyId: this.credentialKeyId,
              }),
          ...(configurationChanged
            ? { credentialVersion: { increment: 1 } }
            : {}),
          allowedOriginsJson: normalizedAllowedOrigins,
          starterQuestionsJson: normalizedStarterQuestionSets,
          updatedBy: actor.id,
          updatedAt: now,
        },
      });
      const sessionsToRevoke = configurationChanged
        ? await tx.applicationExternalSession.findMany({
            where: {
              externalAccessId: current.id,
              status: "active",
            },
            select: { id: true, runtimePrincipalId: true },
          })
        : [];
      if (sessionsToRevoke.length > 0) {
        const sessionIds = sessionsToRevoke.map((session) => session.id);
        await tx.applicationExternalSession.updateMany({
          where: { id: { in: sessionIds }, status: "active" },
          data: {
            status: "revoked",
            revokedAt: now,
            revokeReason: !input.enabled
              ? "access_disabled"
              : current.authMode !== input.auth_mode
                ? "auth_mode_changed"
                : "external_access_configuration_changed",
          },
        });
        await tx.applicationExternalRefreshToken.updateMany({
          where: { sessionId: { in: sessionIds }, revokedAt: null },
          data: {
            revokedAt: now,
            revokeReason: "external_access_configuration_changed",
          },
        });
      }
      return updated;
    });
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: current ? "application_external_access_updated" : "application_external_access_created",
      targetType: "application_external_access",
      targetId: access.id,
      result: "success",
      metadata: {
        application_id: applicationId,
        enabled: input.enabled,
        auth_mode: input.auth_mode,
        allowed_origin_count: normalizedAllowedOrigins.length,
        starter_question_count: normalizedStarterQuestionSets.reduce(
          (total, set) => total + set.questions.length,
          0,
        ),
        credentials_generated: generatedSecret !== null,
      },
    });
    return {
      access: this.#projectAccess(access),
      appSecret: generatedSecret,
    };
  }

  async rotateSecret(
    actor: RequestActor,
    applicationId: string,
    context: AuditContext,
  ): Promise<{ access: ApplicationExternalAccess; appSecret: string }> {
    assertActiveActor(actor);
    await this.#requireOwnedApplication(actor.id, applicationId);
    const current = await this.prisma.applicationExternalAccess.findUnique({
      where: { applicationId },
    });
    if (!current) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED");
    }
    if (current.authMode !== "required") {
      throw new AppError("VALIDATION_ERROR");
    }
    const appId = current.appId ?? `${APP_ID_PREFIX}${randomToken(18)}`;
    const appSecret = `${APP_SECRET_PREFIX}${randomToken(32)}`;
    const now = this.now();
    const updated = await this.prisma.$transaction(async (tx) => {
      const access = await tx.applicationExternalAccess.update({
        where: { id: current.id },
        data: {
          appId,
          appSecretHash: sha256(appSecret),
          appSecretEncrypted: encryptApplicationExternalSecret(
            appSecret,
            this.credentialMasterKey,
            this.credentialKeyId,
            applicationId,
          ),
          appSecretEncryptionKeyId: this.credentialKeyId,
          credentialVersion: { increment: 1 },
          updatedBy: actor.id,
          updatedAt: now,
        },
      });
      await tx.applicationExternalSession.updateMany({
        where: { externalAccessId: current.id, status: "active" },
        data: {
          status: "revoked",
          revokedAt: now,
          revokeReason: "app_secret_rotated",
        },
      });
      await tx.applicationExternalRefreshToken.updateMany({
        where: {
          sessionId: {
            in: (
              await tx.applicationExternalSession.findMany({
                where: { externalAccessId: current.id },
                select: { id: true },
              })
            ).map((session) => session.id),
          },
          revokedAt: null,
        },
        data: { revokedAt: now, revokeReason: "app_secret_rotated" },
      });
      return access;
    });
    await this.audit.write({
      ...context,
      actorId: actor.id,
      action: "application_external_secret_rotated",
      targetType: "application_external_access",
      targetId: current.id,
      result: "success",
      metadata: { application_id: applicationId },
    });
    return { access: this.#projectAccess(updated), appSecret };
  }

  async issueAuthenticatedTicket(
    input: {
      appId: string;
      appSecret: string;
      origin: string;
      externalSubject?: string;
      externalTenant?: string;
      displayName?: string;
    },
    metadata: { ipAddress: string },
  ) {
    await this.#takeTicketRateLimit(input.appId, metadata.ipAddress);
    const access = await this.prisma.applicationExternalAccess.findFirst({
      where: { appId: input.appId, authMode: "required" },
    });
    if (
      !access ||
      !access.appSecretHash ||
      !safeHashEqual(access.appSecretHash, sha256(input.appSecret))
    ) {
      throw new AppError("APPLICATION_EXTERNAL_CREDENTIALS_INVALID");
    }
    return this.#issueTicket(access, input.origin, {
      externalSubject: input.externalSubject ?? null,
      externalTenant: input.externalTenant ?? null,
      displayName: input.displayName ?? null,
    }, { ipAddress: metadata.ipAddress, userAgent: null });
  }

  async assertTurnRateLimit(sessionId: string, ipAddress: string) {
    await this.#takeRateLimit([
      {
        key: `linksense:embed-turn:v1:session:${sessionId}`,
        limit: 30,
        windowSeconds: 60,
      },
      {
        key: `linksense:embed-turn:v1:ip:${sha256(ipAddress).slice(0, 32)}`,
        limit: 120,
        windowSeconds: 60,
      },
    ]);
  }

  async createPublicSession(
    appId: string,
    origin: string,
    metadata: { ipAddress: string },
    context: AuditContext,
  ) {
    await this.#takePublicSessionRateLimit(appId, metadata.ipAddress);
    const access = await this.prisma.applicationExternalAccess.findFirst({
      where: { appId, authMode: "public" },
    });
    if (!access) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED");
    }
    const { session, resumed } = await this.#createOrResumeSession(access, origin, {
      externalSubject: null,
      externalTenant: null,
      displayName: null,
    });
    await this.audit.write({
      ...context,
      actorId: session.runtimePrincipalId,
      action: "application_external_session_started",
      targetType: "application_external_session",
      targetId: session.id,
      result: "success",
      metadata: {
        application_id: session.applicationId,
        resumed,
        authenticated_subject: false,
      },
    });
    return {
      session_id: session.id,
      session_expires_at: session.absoluteExpiresAt.toISOString(),
    };
  }

  async frameConfiguration(appId: string, origin: string) {
    const access = await this.#requireEnabledAccessByAppId(appId, origin);
    const application = await this.prisma.application.findFirst({
      where: { id: access.applicationId, status: "active" },
    });
    if (!application) throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    const icon = application.iconObjectKey
      ? {
          type: "custom" as const,
          url: await this.storage.presignedGetObject(
            application.iconObjectKey,
            5 * 60,
          ),
          fallback_preset: application.iconPreset,
        }
      : { type: "preset" as const, preset: application.iconPreset };
    return {
      access,
      starter_questions: starterQuestionsForOrigin(access, origin),
      application: {
        id: application.id,
        name: application.name,
        description: application.description,
        icon,
        allows_user_model_selection: application.model === null,
      },
    };
  }

  async exchangeTicket(
    ticket: string,
    origin: string,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer,
    context: AuditContext,
  ) {
    const now = this.now();
    const ticketHash = sha256(ticket);
    const consumed = await this.prisma.$transaction(async (tx) => {
      const ticketRow = await tx.applicationEmbedTicket.findUnique({
        where: { ticketHash },
      });
      if (
        !ticketRow ||
        ticketRow.consumedAt !== null ||
        ticketRow.expiresAt <= now ||
        ticketRow.origin !== origin
      ) {
        return null;
      }
      const updated = await tx.applicationEmbedTicket.updateMany({
        where: {
          id: ticketRow.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (updated.count !== 1) return null;
      const access = await tx.applicationExternalAccess.findUnique({
        where: { id: ticketRow.externalAccessId },
      });
      return access && access.credentialVersion === ticketRow.credentialVersion
        ? { ticket: ticketRow, access }
        : null;
    });
    if (!consumed) throw new AppError("APPLICATION_EMBED_TICKET_INVALID");
    const { session, resumed } = await this.#createOrResumeSession(
      consumed.access,
      origin,
      {
        externalSubject: consumed.ticket.externalSubject,
        externalTenant: consumed.ticket.externalTenant,
        displayName: consumed.ticket.displayName,
      },
    );
    const tokens = await this.#issueSessionTokens(
      session,
      issueAccessToken,
      null,
    );
    await this.audit.write({
      ...context,
      actorId: session.runtimePrincipalId,
      action: "application_external_session_started",
      targetType: "application_external_session",
      targetId: session.id,
      result: "success",
      metadata: {
        application_id: session.applicationId,
        resumed,
        authenticated_subject: session.externalSubject !== null,
      },
    });
    return tokens;
  }

  async renewSession(
    renewalToken: string,
    renewalRequestId: string,
    origin: string,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer,
    context: AuditContext,
  ) {
    const now = this.now();
    const tokenHash = sha256(renewalToken);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM application_external_refresh_tokens
        WHERE token_hash = ${tokenHash}
        FOR UPDATE
      `;
      if (locked.length !== 1) return { status: "expired" as const };
      const token = await tx.applicationExternalRefreshToken.findUnique({
        where: { tokenHash },
      });
      if (!token) return { status: "expired" as const };
      const session = await tx.applicationExternalSession.findUnique({
        where: { id: token.sessionId },
      });
      if (!session) return { status: "expired" as const };
      const access = await tx.applicationExternalAccess.findUnique({
        where: { id: session.externalAccessId },
      });
      const application = await tx.application.findUnique({
        where: { id: session.applicationId },
        select: { status: true },
      });
      if (
        token.expiresAt <= now ||
        session.absoluteExpiresAt <= now ||
        session.status !== "active" ||
        session.origin !== origin ||
        !access ||
        !access.enabled ||
        access.applicationId !== session.applicationId ||
        access.credentialVersion !== session.credentialVersion ||
        !allowedOrigins(access).includes(origin) ||
        application?.status !== "active"
      ) {
        await tx.applicationExternalSession.updateMany({
          where: { id: session.id, status: "active" },
          data: { status: "expired", revokedAt: now, revokeReason: "expired" },
        });
        return { status: "expired" as const };
      }
      if (
        token.revokedAt !== null ||
        token.replacedByTokenId !== null
      ) {
        if (
          token.revokeReason === "rotated" &&
          token.rotationRequestId === renewalRequestId &&
          token.replacedByTokenId !== null
        ) {
          const replacement =
            await tx.applicationExternalRefreshToken.findUnique({
              where: { id: token.replacedByTokenId },
            });
          const plaintext = deriveRotatedRenewalToken(
            tokenHash,
            renewalRequestId,
            this.credentialMasterKey,
          );
          if (
            replacement &&
            replacement.sessionId === session.id &&
            replacement.familyId === token.familyId &&
            replacement.parentTokenId === token.id &&
            replacement.revokedAt === null &&
            replacement.expiresAt > now &&
            safeHashEqual(replacement.tokenHash, sha256(plaintext))
          ) {
            const updatedSession =
              await tx.applicationExternalSession.update({
                where: { id: session.id },
                data: { lastSeenAt: now },
              });
            return {
              status: "rotated" as const,
              session: updatedSession,
              renewalToken: plaintext,
              renewalExpiresAt: replacement.expiresAt,
            };
          }
          return { status: "expired" as const };
        }
        await tx.applicationExternalRefreshToken.updateMany({
          where: { familyId: token.familyId, revokedAt: null },
          data: { revokedAt: now, revokeReason: "renewal_token_reuse" },
        });
        await tx.applicationExternalSession.updateMany({
          where: { id: session.id, status: "active" },
          data: {
            status: "revoked",
            revokedAt: now,
            revokeReason: "renewal_token_reuse",
          },
        });
        return { status: "reused" as const };
      }
      const nextPlaintext = deriveRotatedRenewalToken(
        tokenHash,
        renewalRequestId,
        this.credentialMasterKey,
      );
      const nextExpiresAt = minimumDate(
        addSeconds(now, APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS),
        session.absoluteExpiresAt,
      );
      const replacement = await tx.applicationExternalRefreshToken.create({
        data: {
          sessionId: session.id,
          familyId: token.familyId,
          parentTokenId: token.id,
          tokenHash: sha256(nextPlaintext),
          expiresAt: nextExpiresAt,
        },
      });
      await tx.applicationExternalRefreshToken.update({
        where: { id: token.id },
        data: {
          revokedAt: now,
          revokeReason: "rotated",
          replacedByTokenId: replacement.id,
          rotationRequestId: renewalRequestId,
        },
      });
      const updatedSession = await tx.applicationExternalSession.update({
        where: { id: session.id },
        data: { lastSeenAt: now },
      });
      return {
        status: "rotated" as const,
        session: updatedSession,
        renewalToken: nextPlaintext,
        renewalExpiresAt: nextExpiresAt,
      };
    });
    if (outcome.status === "reused") {
      throw new AppError("APPLICATION_EMBED_RENEWAL_REUSED");
    }
    if (outcome.status === "expired") {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    const tokens = await this.#issueSessionTokens(
      outcome.session,
      issueAccessToken,
      {
        plaintext: outcome.renewalToken,
        expiresAt: outcome.renewalExpiresAt,
      },
    );
    await this.audit.write({
      ...context,
      actorId: outcome.session.runtimePrincipalId,
      action: "application_external_session_renewed",
      targetType: "application_external_session",
      targetId: outcome.session.id,
      result: "success",
      metadata: { application_id: outcome.session.applicationId },
    });
    return tokens;
  }

  async verifyAccessToken(
    claims: ApplicationEmbedAccessTokenClaims,
  ): Promise<VerifiedApplicationEmbedSession> {
    const now = this.now();
    const [session, access, application] = await Promise.all([
      this.prisma.applicationExternalSession.findUnique({
        where: { id: claims.session_id },
      }),
      this.prisma.applicationExternalAccess.findUnique({
        where: { id: claims.external_access_id },
      }),
      this.prisma.application.findUnique({
        where: { id: claims.application_id },
        select: { status: true },
      }),
    ]);
    if (
      !session ||
      !access ||
      session.status !== "active" ||
      session.absoluteExpiresAt <= now ||
      session.id !== claims.session_id ||
      session.externalAccessId !== claims.external_access_id ||
      session.applicationId !== claims.application_id ||
      session.runtimePrincipalId !== claims.sub ||
      session.conversationId !== claims.conversation_id ||
      session.origin !== claims.origin ||
      session.credentialVersion !== claims.credential_version ||
      !access.enabled ||
      access.applicationId !== session.applicationId ||
      access.credentialVersion !== claims.credential_version ||
      !allowedOrigins(access).includes(claims.origin) ||
      application?.status !== "active"
    ) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    return {
      sessionId: session.id,
      ownerId: session.runtimePrincipalId,
      applicationId: session.applicationId,
      conversationId: session.conversationId,
      externalAccessId: session.externalAccessId,
      origin: session.origin,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  async verifyPublicSession(
    appId: string,
    sessionId: string,
    origin: string,
  ): Promise<VerifiedApplicationEmbedSession> {
    const now = this.now();
    const [session, access] = await Promise.all([
      this.prisma.applicationExternalSession.findUnique({
        where: { id: sessionId },
      }),
      this.prisma.applicationExternalAccess.findUnique({
        where: { appId },
      }),
    ]);
    if (!session || !access) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    const [application] = await Promise.all([
      this.prisma.application.findUnique({
        where: { id: session.applicationId },
        select: { status: true },
      }),
    ]);
    if (
      access.authMode !== "public" ||
      session.status !== "active" ||
      session.absoluteExpiresAt <= now ||
      session.externalAccessId !== access.id ||
      session.applicationId !== access.applicationId ||
      session.origin !== origin ||
      session.credentialVersion !== access.credentialVersion ||
      !access.enabled ||
      !allowedOrigins(access).includes(origin) ||
      application?.status !== "active"
    ) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    return {
      sessionId: session.id,
      ownerId: session.runtimePrincipalId,
      applicationId: session.applicationId,
      conversationId: session.conversationId,
      externalAccessId: session.externalAccessId,
      origin: session.origin,
      absoluteExpiresAt: session.absoluteExpiresAt,
    };
  }

  async updateSessionExternalApplicationSession(
    session: VerifiedApplicationEmbedSession,
    externalApplicationSessionId: string | null,
    context: AuditContext,
  ): Promise<void> {
    const now = this.now();
    const encrypted =
      externalApplicationSessionId === null
        ? null
        : encryptJson(
            { value: externalApplicationSessionId },
            this.credentialMasterKey,
            this.credentialKeyId,
            externalApplicationSessionIdContext(session.sessionId),
          );
    const updated = await this.prisma.applicationExternalSession.updateMany({
      where: {
        id: session.sessionId,
        runtimePrincipalId: session.ownerId,
        applicationId: session.applicationId,
        status: "active",
        absoluteExpiresAt: { gt: now },
      },
      data:
        encrypted === null
          ? {
              externalApplicationSessionIdEncrypted: null,
              externalApplicationSessionIdEncryptionKeyId: null,
              externalApplicationSessionIdUpdatedAt: null,
              lastSeenAt: now,
            }
          : {
              externalApplicationSessionIdEncrypted: encrypted,
              externalApplicationSessionIdEncryptionKeyId:
                this.credentialKeyId,
              externalApplicationSessionIdUpdatedAt: now,
              lastSeenAt: now,
            },
    });
    if (updated.count !== 1) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    await this.audit.write({
      ...context,
      actorId: session.ownerId,
      action: "external_application_session_id_updated",
      targetType: "application_external_session",
      targetId: session.sessionId,
      result: "success",
      metadata: {
        application_id: session.applicationId,
        session_id_configured: externalApplicationSessionId !== null,
      },
    });
  }

  async revokeSession(
    session: VerifiedApplicationEmbedSession,
    context: AuditContext,
  ): Promise<void> {
    const now = this.now();
    await this.prisma.$transaction(async (tx) => {
      await tx.applicationExternalSession.updateMany({
        where: { id: session.sessionId, status: "active" },
        data: {
          status: "revoked",
          revokedAt: now,
          revokeReason: "client_logout",
        },
      });
      await tx.applicationExternalRefreshToken.updateMany({
        where: { sessionId: session.sessionId, revokedAt: null },
        data: { revokedAt: now, revokeReason: "client_logout" },
      });
    });
    await this.audit.write({
      ...context,
      actorId: session.ownerId,
      action: "application_external_session_revoked",
      targetType: "application_external_session",
      targetId: session.sessionId,
      result: "success",
      metadata: { application_id: session.applicationId },
    });
  }

  async listSessionConversations(
    session: VerifiedApplicationEmbedSession,
  ): Promise<{ items: ApplicationEmbedConversationSummary[] }> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        ownerId: session.ownerId,
        applicationId: session.applicationId,
        archiveStatus: "active",
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 50,
    });
    const ids = rows.map((row) => row.id);
    const [running, pending] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            this.prisma.conversationTurn.findMany({
              where: { conversationId: { in: ids }, status: "running" },
              select: { conversationId: true, codexThreadId: true },
            }),
            this.prisma.pendingRequest.findMany({
              where: { conversationId: { in: ids } },
              select: { conversationId: true },
              distinct: ["conversationId"],
            }),
          ]);
    const currentThreadIds = new Map(
      rows.flatMap((row) =>
        row.codexThreadId ? [[row.id, row.codexThreadId] as const] : [],
      ),
    );
    const runningIds = new Set(
      running
        .filter(
          (row) =>
            currentThreadIds.get(row.conversationId) === row.codexThreadId,
        )
        .map((row) => row.conversationId),
    );
    const pendingIds = new Set(pending.map((row) => row.conversationId));
    for (const row of rows) {
      if (
        row.titleSource === "manual" &&
        row.applicationNameSnapshot !== null &&
        row.title === row.applicationNameSnapshot &&
        row.lastTurnStatus !== null
      ) {
        this.scheduleConversationTitle(row.id);
      }
    }
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: projectApplicationEmbedConversationTitle(
          row.title,
          row.titleSource,
        ),
        updated_at: row.updatedAt.toISOString(),
        created_at: row.createdAt.toISOString(),
        execution_status: runningIds.has(row.id)
          ? "running"
          : pendingIds.has(row.id)
            ? "pending"
            : applicationEmbedExecutionStatus(row.lastTurnStatus),
        current: row.id === session.conversationId,
      })),
    };
  }

  async createSessionConversation(
    session: VerifiedApplicationEmbedSession,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer | null,
  ): Promise<ApplicationEmbedSessionTokenUpdate> {
    const application = await this.prisma.application.findFirst({
      where: { id: session.applicationId, status: "active" },
      select: { id: true, name: true },
    });
    if (!application) throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    const conversation = await this.createConversation(session.ownerId, application);
    return this.#setSessionConversation(
      session,
      conversation.id,
      issueAccessToken,
    );
  }

  async selectSessionConversation(
    session: VerifiedApplicationEmbedSession,
    conversationId: string,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer | null,
  ): Promise<ApplicationEmbedSessionTokenUpdate> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerId: session.ownerId,
        applicationId: session.applicationId,
        archiveStatus: "active",
      },
      select: { id: true },
    });
    if (!conversation) throw new AppError("CONVERSATION_NOT_FOUND");
    return this.#setSessionConversation(
      session,
      conversation.id,
      issueAccessToken,
    );
  }

  async deleteSessionConversation(
    session: VerifiedApplicationEmbedSession,
    conversationId: string,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer | null,
    context: AuditContext,
  ): Promise<ApplicationEmbedSessionTokenUpdate> {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id: conversationId,
        ownerId: session.ownerId,
        applicationId: session.applicationId,
        archiveStatus: "active",
      },
      select: { id: true },
    });
    if (!conversation) throw new AppError("CONVERSATION_NOT_FOUND");

    if (conversation.id !== session.conversationId) {
      await this.cleanupConversation(
        session.ownerId,
        conversation.id,
        context,
        "user",
      );
      return this.#setSessionConversation(
        session,
        session.conversationId,
        issueAccessToken,
      );
    }

    const application = await this.prisma.application.findFirst({
      where: { id: session.applicationId, status: "active" },
      select: { id: true, name: true },
    });
    if (!application) throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    const replacement = await this.createConversation(
      session.ownerId,
      application,
    );
    let update: ApplicationEmbedSessionTokenUpdate;
    try {
      update = await this.#setSessionConversation(
        session,
        replacement.id,
        issueAccessToken,
      );
    } catch (error) {
      await this.cleanupConversation(session.ownerId, replacement.id).catch(
        () => undefined,
      );
      throw error;
    }

    try {
      await this.cleanupConversation(
        session.ownerId,
        conversation.id,
        context,
        "user",
      );
    } catch (error) {
      await this.#setSessionConversation(
        session,
        conversation.id,
        null,
      ).catch(() => undefined);
      await this.cleanupConversation(session.ownerId, replacement.id).catch(
        () => undefined,
      );
      throw error;
    }
    return update;
  }

  async #createOrResumeSession(
    access: NonNullable<ExternalAccessRow>,
    origin: string,
    identity: TicketIdentity,
  ) {
    const now = this.now();
    await this.#assertEnabledAccess(access, origin);
    const application = await this.prisma.application.findUnique({
      where: { id: access.applicationId },
      select: { id: true, name: true, status: true },
    });
    if (!application || application.status !== "active") {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    }

    let session = null;
    if (identity.externalSubject !== null) {
      session = await this.#restoreSessionForExternalIdentity(
        access,
        application,
        origin,
        identity,
        now,
      );
    }
    const resumed = session !== null;
    if (!session) {
      const runtimePrincipalId = randomUUID();
      const conversationId = this.reserveConversationId();
      session = await this.prisma.applicationExternalSession.create({
        data: {
          externalAccessId: access.id, applicationId: application.id, runtimePrincipalId, conversationId,
          externalSubject: identity.externalSubject, externalTenant: identity.externalTenant,
          displayName: identity.displayName, origin, status: "active", credentialVersion: access.credentialVersion,
          absoluteExpiresAt: addSeconds(now, APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS), lastSeenAt: now,
        },
      });
      try {
        const conversation = await this.createConversation(runtimePrincipalId, application, conversationId);
        if (conversation.id !== conversationId) throw new AppError("CONFLICT");
      } catch (error) {
        await this.prisma.applicationExternalSession.delete({ where: { id: session.id } });
        throw error;
      }
    }
    if (!session) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    return { session, resumed };
  }

  async #issueTicket(
    access: NonNullable<ExternalAccessRow>,
    origin: string,
    identity: TicketIdentity,
    context: AuditContext,
  ) {
    await this.#assertEnabledAccess(access, origin);
    if (access.appId === null) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED");
    }
    const plaintext = `${TICKET_PREFIX}${randomToken(48)}`;
    const expiresAt = addSeconds(this.now(), APPLICATION_EMBED_TICKET_TTL_SECONDS);
    await this.prisma.applicationEmbedTicket.create({
      data: {
        externalAccessId: access.id,
        credentialVersion: access.credentialVersion,
        ticketHash: sha256(plaintext),
        origin,
        externalSubject: identity.externalSubject,
        externalTenant: identity.externalTenant,
        displayName: identity.displayName,
        expiresAt,
      },
    });
    await this.audit.write({
      ...context,
      actorId: access.createdBy,
      action: "application_embed_ticket_issued",
      targetType: "application_external_access",
      targetId: access.id,
      result: "success",
      metadata: {
        application_id: access.applicationId,
        auth_mode: access.authMode,
        authenticated_subject: identity.externalSubject !== null,
      },
    });
    return {
      ticket: plaintext,
      iframe_url: this.#iframeUrl(access.appId, origin),
      expires_at: expiresAt.toISOString(),
    };
  }

  async #restoreSessionForExternalIdentity(
    access: NonNullable<ExternalAccessRow>,
    application: { id: string; name: string },
    origin: string,
    identity: TicketIdentity,
    now: Date,
  ) {
    const existing = await this.prisma.applicationExternalSession.findFirst({
      where: {
        externalAccessId: access.id,
        applicationId: application.id,
        externalSubject: identity.externalSubject,
        externalTenant: identity.externalTenant,
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    });
    if (!existing) return null;
    await this.prisma.applicationExternalSession.update({ where: { id: existing.id }, data: {
      status: "active", origin, credentialVersion: access.credentialVersion,
      absoluteExpiresAt: addSeconds(now, APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS),
      revokedAt: null, revokeReason: null,
    } });
    const conversation =
      (await this.prisma.conversation.findFirst({
        where: {
          ownerId: existing.runtimePrincipalId,
          applicationId: application.id,
          archiveStatus: "active",
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { id: true },
      })) ?? (await this.createConversation(existing.runtimePrincipalId, application));
    return this.prisma.applicationExternalSession.update({
      where: { id: existing.id },
      data: {
        origin,
        status: "active",
        credentialVersion: access.credentialVersion,
        conversationId: conversation.id,
        externalSubject: identity.externalSubject,
        externalTenant: identity.externalTenant,
        displayName: identity.displayName,
        absoluteExpiresAt: addSeconds(
          now,
          APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
        ),
        lastSeenAt: now,
        revokedAt: null,
        revokeReason: null,
      },
    });
  }

  async #setSessionConversation(
    session: VerifiedApplicationEmbedSession,
    conversationId: string,
    issueAccessToken: ApplicationEmbedAccessTokenIssuer | null,
  ): Promise<ApplicationEmbedSessionTokenUpdate> {
    const now = this.now();
    const updated = await this.prisma.applicationExternalSession.update({
      where: { id: session.sessionId },
      data: { conversationId, lastSeenAt: now },
    });
    if (!issueAccessToken) {
      return {
        session_id: updated.id,
        session_expires_at: updated.absoluteExpiresAt.toISOString(),
        conversation_id: updated.conversationId,
        access_token: null,
        renewal_token: null,
        access_token_expires_at: null,
        renewal_token_expires_at: null,
      };
    }
    const tokens = await this.#issueSessionTokens(
      updated,
      issueAccessToken,
      null,
    );
    return {
      ...tokens,
      conversation_id: updated.conversationId,
    };
  }

  async #issueSessionTokens(
    session: {
      id: string;
      externalAccessId: string;
      applicationId: string;
      runtimePrincipalId: string;
      conversationId: string;
      origin: string;
      credentialVersion: number;
      absoluteExpiresAt: Date;
    },
    issueAccessToken: ApplicationEmbedAccessTokenIssuer,
    existingRenewal: { plaintext: string; expiresAt: Date } | null,
  ) {
    const now = this.now();
    const remainingSessionSeconds = Math.floor(
      (session.absoluteExpiresAt.getTime() - now.getTime()) / 1_000,
    );
    if (remainingSessionSeconds <= 0) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    const accessTtlSeconds = Math.min(
      APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      remainingSessionSeconds,
    );
    let renewal = existingRenewal;
    if (!renewal) {
      const plaintext = `${RENEWAL_TOKEN_PREFIX}${randomToken(48)}`;
      const expiresAt = minimumDate(
        addSeconds(now, APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS),
        session.absoluteExpiresAt,
      );
      await this.prisma.applicationExternalRefreshToken.create({
        data: {
          sessionId: session.id,
          familyId: randomUUID(),
          tokenHash: sha256(plaintext),
          expiresAt,
        },
      });
      renewal = { plaintext, expiresAt };
    }
    const access = await issueAccessToken(
      {
        token_use: "application_embed",
        sub: session.runtimePrincipalId,
        session_id: session.id,
        application_id: session.applicationId,
        conversation_id: session.conversationId,
        external_access_id: session.externalAccessId,
        origin: session.origin,
        credential_version: session.credentialVersion,
        jti: randomUUID(),
      },
      accessTtlSeconds,
    );
    return {
      access_token: access.token,
      renewal_token: renewal.plaintext,
      access_token_expires_at: access.expiresAt.toISOString(),
      renewal_token_expires_at: renewal.expiresAt.toISOString(),
      session_expires_at: session.absoluteExpiresAt.toISOString(),
      session_id: session.id,
    };
  }

  async #assertEnabledAccess(
    access: NonNullable<ExternalAccessRow>,
    origin: string,
  ): Promise<void> {
    if (!access.enabled) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    }
    if (!allowedOrigins(access).includes(origin)) {
      throw new AppError("APPLICATION_EXTERNAL_ORIGIN_FORBIDDEN");
    }
    const application = await this.prisma.application.findUnique({
      where: { id: access.applicationId },
      select: { status: true },
    });
    if (application?.status !== "active") {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_DISABLED");
    }
  }

  async #requireEnabledAccessByAppId(appId: string, origin: string) {
    const access = await this.prisma.applicationExternalAccess.findUnique({
      where: { appId },
    });
    if (!access) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED");
    }
    await this.#assertEnabledAccess(access, origin);
    return access;
  }

  async #requireOwnedApplication(ownerId: string, applicationId: string) {
    const application = await this.prisma.application.findFirst({
      where: {
        id: applicationId,
        ownerId,
        kind: "standard",
        status: { in: ["active", "disabled"] },
      },
    });
    if (!application) throw new AppError("APPLICATION_NOT_FOUND");
    return application;
  }

  async #takeTicketRateLimit(identifier: string, ipAddress: string) {
    await this.#takeRateLimit([
      {
        key: `linksense:embed-ticket:v1:app:${sha256(identifier).slice(0, 32)}`,
        limit: 60,
        windowSeconds: 60,
      },
      {
        key: `linksense:embed-ticket:v1:ip:${sha256(ipAddress).slice(0, 32)}`,
        limit: 120,
        windowSeconds: 60,
      },
    ]);
  }

  async #takePublicSessionRateLimit(identifier: string, ipAddress: string) {
    await this.#takeRateLimit([
      {
        key: `linksense:embed-public-session:v1:app:${sha256(identifier).slice(0, 32)}`,
        limit: 60,
        windowSeconds: 60,
      },
      {
        key: `linksense:embed-public-session:v1:ip:${sha256(ipAddress).slice(0, 32)}`,
        limit: 120,
        windowSeconds: 60,
      },
    ]);
  }

  async #takeRateLimit(
    entries: ReadonlyArray<{
      key: string;
      limit: number;
      windowSeconds: number;
    }>,
  ) {
    try {
      const results = await Promise.all(
        entries.map((entry) =>
          this.redis.client.eval(
            RATE_LIMIT_SCRIPT,
            1,
            entry.key,
            String(entry.limit),
            String(entry.windowSeconds),
          ),
        ),
      );
      if (results.some((result) => Number(result) !== 1)) {
        throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED");
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("APPLICATION_EXTERNAL_RATE_LIMITED", undefined, 503);
    }
  }

  #projectAccess(access: NonNullable<ExternalAccessRow>) {
    if (access.appId === null) {
      throw new AppError("APPLICATION_EXTERNAL_ACCESS_NOT_CONFIGURED");
    }
    return applicationExternalAccessSchema.parse({
      application_id: access.applicationId,
      enabled: access.enabled,
      auth_mode: access.authMode,
      app_id: access.appId,
      app_secret:
        access.authMode === "required"
          ? decryptApplicationExternalSecretIfAvailable(
              access,
              this.credentialMasterKey,
              applicationExternalSecretContext(access.applicationId),
            )
          : null,
      allowed_origins: allowedOrigins(access),
      starter_questions_by_origin: starterQuestionSets(access),
      iframe_url: `${this.publicBaseUrl.replace(/\/$/u, "")}/api/v1/embed/frame/${access.appId}`,
      access_token_ttl_seconds: APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      renewal_token_ttl_seconds: APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
      absolute_session_ttl_seconds:
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
      created_at: access.createdAt.toISOString(),
      updated_at: access.updatedAt.toISOString(),
    });
  }

  #iframeUrl(appId: string, origin: string) {
    const url = new URL(`/api/v1/embed/frame/${appId}`, this.publicBaseUrl);
    url.searchParams.set("parent_origin", origin);
    return url.toString();
  }
}

function applicationExternalSecretContext(applicationId: string) {
  return `linksense:application-external-secret:v1:${applicationId}`;
}

function externalApplicationSessionIdContext(sessionId: string) {
  return `${EXTERNAL_APPLICATION_SESSION_ID_CONTEXT_PREFIX}${sessionId}`;
}

export function decryptExternalApplicationSessionId(
  session: {
    id: string;
    externalApplicationSessionIdEncrypted: string | null;
    externalApplicationSessionIdEncryptionKeyId: string | null;
  },
  masterKey: string,
): string | null {
  if (
    session.externalApplicationSessionIdEncrypted === null ||
    session.externalApplicationSessionIdEncryptionKeyId === null
  ) {
    return null;
  }
  try {
    const payload = decryptJson<{ value?: unknown }>(
      session.externalApplicationSessionIdEncrypted,
      masterKey,
      session.externalApplicationSessionIdEncryptionKeyId,
      externalApplicationSessionIdContext(session.id),
    );
    return typeof payload.value === "string" && payload.value.length > 0
      ? payload.value
      : null;
  } catch {
    throw new AppError("EXECUTION_ENVIRONMENT_INVALID");
  }
}

function encryptApplicationExternalSecret(
  appSecret: string,
  masterKey: string,
  keyId: string,
  applicationId: string,
) {
  return encryptJson(
    { value: appSecret },
    masterKey,
    keyId,
    applicationExternalSecretContext(applicationId),
  );
}

function decryptApplicationExternalSecretIfAvailable(
  access: {
    appSecretEncrypted?: string | null;
    appSecretEncryptionKeyId?: string | null;
  },
  masterKey: string,
  context: string,
): string | null {
  if (!access.appSecretEncrypted || !access.appSecretEncryptionKeyId) {
    return null;
  }
  try {
    const payload = decryptJson<{ value?: unknown }>(
      access.appSecretEncrypted,
      masterKey,
      access.appSecretEncryptionKeyId,
      context,
    );
    return typeof payload.value === "string" && payload.value.length > 0
      ? payload.value
      : null;
  } catch {
    return null;
  }
}

function allowedOrigins(access: { allowedOriginsJson: unknown }): string[] {
  return Array.isArray(access.allowedOriginsJson)
    ? access.allowedOriginsJson.filter(
        (origin): origin is string => typeof origin === "string",
      )
    : [];
}

function starterQuestionSets(access: {
  allowedOriginsJson: unknown;
  starterQuestionsJson: unknown;
}): Array<{ origin: string; questions: string[] }> {
  const allowed = new Set(allowedOrigins(access));
  if (!Array.isArray(access.starterQuestionsJson)) return [];
  const seen = new Set<string>();
  const result: Array<{ origin: string; questions: string[] }> = [];
  for (const value of access.starterQuestionsJson) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const origin = "origin" in value ? value.origin : undefined;
    const questions = "questions" in value ? value.questions : undefined;
    if (
      typeof origin !== "string" ||
      !allowed.has(origin) ||
      seen.has(origin) ||
      !Array.isArray(questions)
    ) {
      continue;
    }
    const normalizedQuestions = questions
      .filter((question): question is string => typeof question === "string")
      .map((question) => question.trim())
      .filter(
        (question, index, all) =>
          question.length > 0 &&
          question.length <= 500 &&
          all.indexOf(question) === index,
      )
      .slice(0, 4);
    if (normalizedQuestions.length === 0) continue;
    seen.add(origin);
    result.push({ origin, questions: normalizedQuestions });
  }
  return result;
}

function starterQuestionsForOrigin(
  access: { allowedOriginsJson: unknown; starterQuestionsJson: unknown },
  origin: string,
) {
  return (
    starterQuestionSets(access).find((set) => set.origin === origin)
      ?.questions ?? []
  );
}

function validateAllowedOrigins(origins: string[]): string[] {
  return origins.map((origin) => {
    const url = new URL(origin);
    const isLoopback =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
      throw new AppError("VALIDATION_ERROR");
    }
    return url.origin;
  });
}

function validateStarterQuestionSets(
  sets: UpdateApplicationExternalAccessInput["starter_questions_by_origin"],
  allowedOrigins: readonly string[],
) {
  const allowed = new Set(allowedOrigins);
  const seen = new Set<string>();
  return sets.flatMap((set) => {
    const origin = new URL(set.origin).origin;
    if (!allowed.has(origin) || seen.has(origin)) {
      throw new AppError("VALIDATION_ERROR");
    }
    seen.add(origin);
    const questions = set.questions.map((question) => question.trim());
    if (
      questions.length > 4 ||
      questions.some((question) => question.length === 0) ||
      questions.some((question) => question.length > 500) ||
      new Set(questions).size !== questions.length
    ) {
      throw new AppError("VALIDATION_ERROR");
    }
    return questions.length > 0 ? [{ origin, questions }] : [];
  });
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function applicationEmbedExecutionStatus(
  value: string | null,
): ApplicationEmbedConversationSummary["execution_status"] {
  if (
    value === "running" ||
    value === "pending" ||
    value === "completed" ||
    value === "failed" ||
    value === "interrupted"
  ) {
    return value;
  }
  return "idle";
}

function projectApplicationEmbedConversationTitle(
  title: string,
  titleSource: string,
) {
  if (titleSource !== "fallback") return title;
  if (title === "未命名对话") return "未命名任务";
  if (title === "Untitled conversation") return "Untitled task";
  return title;
}

function safeHashEqual(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return (
    expectedBytes.length === actualBytes.length &&
    timingSafeEqual(expectedBytes, actualBytes)
  );
}

function deriveRotatedRenewalToken(
  currentTokenHash: string,
  renewalRequestId: string,
  secret: string,
): string {
  return `${RENEWAL_TOKEN_PREFIX}${createHmac("sha256", secret)
    .update("linksense:application-embed-renewal:v1\0", "utf8")
    .update(currentTokenHash, "utf8")
    .update("\0", "utf8")
    .update(renewalRequestId, "utf8")
    .digest("base64url")}`;
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1_000);
}

function minimumDate(left: Date, right: Date): Date {
  return left <= right ? left : right;
}

function assertActiveActor(actor: RequestActor) {
  if (actor.status !== "active") throw new AppError("USER_DISABLED");
}
