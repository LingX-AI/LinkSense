import { describe, expect, it, vi } from "vitest";

import {
  APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
  APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
  APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
  APPLICATION_EMBED_TICKET_TTL_SECONDS,
  type ApplicationEmbedAccessTokenClaims,
} from "@linksense/shared";

import { sha256 } from "../src/lib/crypto.js";
import {
  ApplicationExternalAccessService,
  decryptExternalApplicationSessionId,
} from "../src/modules/application-embed/service.js";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const APPLICATION_ID = "20000000-0000-4000-8000-000000000001";
const EXTERNAL_ACCESS_ID = "30000000-0000-4000-8000-000000000001";
const TICKET_ID = "40000000-0000-4000-8000-000000000001";
const SESSION_ID = "50000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "60000000-0000-4000-8000-000000000001";
const SECOND_CONVERSATION_ID = "60000000-0000-4000-8000-000000000002";
const THIRD_CONVERSATION_ID = "60000000-0000-4000-8000-000000000003";
const FIRST_TOKEN_ID = "70000000-0000-4000-8000-000000000001";
const SECOND_TOKEN_ID = "70000000-0000-4000-8000-000000000002";
const ORIGIN = "https://partner.example.test";
const APP_ID = "lsa_test_application_identifier";
const APP_SECRET = "lss_test_application_secret_with_sufficient_entropy";
const MASTER_KEY = "application-embed-master-key-for-tests-1234567890";
const KEY_ID = "application-embed-test-key";
const INITIAL_NOW = new Date("2026-08-13T00:00:00.000Z");

describe("ApplicationExternalAccessService", () => {
  it("generates an encrypted App Secret and exposes the confirmed token policy", async () => {
    const createdRows: Array<Record<string, unknown>> = [];
    const transaction = {
      applicationExternalAccess: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = {
            id: EXTERNAL_ACCESS_ID,
            ...data,
            createdAt: INITIAL_NOW,
            updatedAt: INITIAL_NOW,
          };
          createdRows.push(row);
          return row;
        }),
      },
    };
    const prisma = {
      application: {
        findFirst: vi.fn(async () => ({
          id: APPLICATION_ID,
          ownerId: OWNER_ID,
          status: "active",
        })),
      },
      applicationExternalAccess: { findUnique: vi.fn(async () => null) },
      $transaction: vi.fn(
        async (action: (tx: typeof transaction) => Promise<unknown>) =>
          action(transaction),
      ),
    };
    const service = createService(prisma, () => INITIAL_NOW);

    const result = await service.updateManagement(
      actor(),
      APPLICATION_ID,
      {
        enabled: true,
        auth_mode: "required",
        allowed_origins: [ORIGIN],
        starter_questions_by_origin: [
          { origin: ORIGIN, questions: ["How do I apply?"] },
        ],
      },
      {},
    );

    expect(result.appSecret).toMatch(/^lss_[A-Za-z0-9_-]+$/u);
    expect(result.access.app_secret).toBe(result.appSecret);
    expect(result.access).toMatchObject({
      enabled: true,
      auth_mode: "required",
      allowed_origins: [ORIGIN],
      access_token_ttl_seconds: APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      renewal_token_ttl_seconds: APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
      absolute_session_ttl_seconds:
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
    });
    expect(result.access.app_id).toMatch(/^lsa_[A-Za-z0-9_-]+$/u);
    expect(createdRows[0]?.appSecretHash).toBe(sha256(result.appSecret!));
    expect(createdRows[0]?.appSecretHash).not.toBe(result.appSecret);
    expect(createdRows[0]?.appSecretEncrypted).toEqual(expect.any(String));
    expect(createdRows[0]?.appSecretEncrypted).not.toBe(result.appSecret);
    expect(String(createdRows[0]?.appSecretEncrypted)).not.toContain(
      result.appSecret!,
    );
    expect(createdRows[0]?.appSecretEncryptionKeyId).toBe(KEY_ID);
    expect(createdRows[0]?.starterQuestionsJson).toEqual([
      { origin: ORIGIN, questions: ["How do I apply?"] },
    ]);
  });

  it("backfills an App ID for legacy external access rows without exposing public ids", async () => {
    const legacyAccess = {
      id: EXTERNAL_ACCESS_ID,
      applicationId: APPLICATION_ID,
      publicId: "app_legacy_public_identifier",
      enabled: true,
      authMode: "public",
      appId: null,
      appSecretHash: null,
      appSecretEncrypted: null,
      appSecretEncryptionKeyId: null,
      credentialVersion: 1,
      allowedOriginsJson: [ORIGIN],
      createdBy: OWNER_ID,
      updatedBy: null,
      createdAt: INITIAL_NOW,
      updatedAt: INITIAL_NOW,
    };
    const prisma = {
      application: {
        findFirst: vi.fn(async () => ({
          id: APPLICATION_ID,
          ownerId: OWNER_ID,
          status: "active",
        })),
      },
      applicationExternalAccess: {
        findUnique: vi.fn(async () => legacyAccess),
        update: vi.fn(
          async ({ data }: { data: Record<string, unknown> }) => ({
            ...legacyAccess,
            ...data,
          }),
        ),
      },
    };
    const service = createService(prisma, () => INITIAL_NOW);

    const access = await service.getManagement(actor(), APPLICATION_ID);

    expect(access?.app_id).toMatch(/^lsa_[A-Za-z0-9_-]+$/u);
    expect(access?.app_id).not.toBe(legacyAccess.publicId);
    expect(access?.iframe_url).toBe(
      `https://linksense.example.test/api/v1/embed/frame/${access?.app_id}`,
    );
    expect(prisma.applicationExternalAccess.update).toHaveBeenCalledWith({
      where: { id: EXTERNAL_ACCESS_ID },
      data: expect.objectContaining({
        appId: access?.app_id,
        updatedBy: OWNER_ID,
        updatedAt: INITIAL_NOW,
      }),
    });
  });

  it("advertises model selection only when the application leaves the model to the user", async () => {
    const fixture = lifecycleFixture();

    await expect(
      fixture.service.frameConfiguration(APP_ID, ORIGIN),
    ).resolves.toMatchObject({
      starter_questions: ["How do I apply?"],
      application: { allows_user_model_selection: true },
    });

    fixture.application.model = "model-a";
    await expect(
      fixture.service.frameConfiguration(APP_ID, ORIGIN),
    ).resolves.toMatchObject({
      application: { allows_user_model_selection: false },
    });
  });

  it("expires a ticket after 60 seconds and invalidates it across a credential version change", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
      },
      { ipAddress: "192.0.2.10" },
    );

    expect(ticket.expires_at).toBe(
      addSeconds(INITIAL_NOW, APPLICATION_EMBED_TICKET_TTL_SECONDS).toISOString(),
    );
    expect(fixture.ticketRow?.ticketHash).toBe(sha256(ticket.ticket));
    expect(fixture.ticketRow?.credentialVersion).toBe(1);

    fixture.setNow(
      addSeconds(INITIAL_NOW, APPLICATION_EMBED_TICKET_TTL_SECONDS + 1),
    );
    await expect(
      fixture.service.exchangeTicket(
        ticket.ticket,
        ORIGIN,
        fixture.issueAccessToken,
        {},
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_TICKET_INVALID" });
    expect(fixture.userCreate).not.toHaveBeenCalled();

    const versionBoundTicket =
      await fixture.service.issueAuthenticatedTicket(
        {
          appId: APP_ID,
          appSecret: APP_SECRET,
          origin: ORIGIN,
          externalSubject: "partner-user-42",
        },
        { ipAddress: "192.0.2.10" },
      );
    fixture.access.credentialVersion = 2;

    await expect(
      fixture.service.exchangeTicket(
        versionBoundTicket.ticket,
        ORIGIN,
        fixture.issueAccessToken,
        {},
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_TICKET_INVALID" });
    expect(fixture.userCreate).not.toHaveBeenCalled();
  });

  it("encrypts, rotates, and clears the business session id on one external session", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-token-test",
      },
      { ipAddress: "192.0.2.10" },
    );
    await fixture.service.exchangeTicket(
      ticket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );
    const verified = await fixture.service.verifyAccessToken(
      accessClaimsFor(fixture.issuedAccessTokens[0]!.claims, INITIAL_NOW),
    );

    await fixture.service.updateSessionExternalApplicationSession(
      verified,
      "business-session-a",
      {},
    );

    expect(fixture.session?.externalApplicationSessionIdEncrypted).toEqual(
      expect.any(String),
    );
    expect(fixture.session?.externalApplicationSessionIdEncrypted).not.toContain(
      "business-session-a",
    );
    expect(fixture.session?.externalApplicationSessionIdEncryptionKeyId).toBe(
      KEY_ID,
    );
    expect(
      decryptExternalApplicationSessionId(fixture.session!, MASTER_KEY),
    ).toBe("business-session-a");

    await fixture.service.updateSessionExternalApplicationSession(
      verified,
      null,
      {},
    );
    expect(fixture.session).toMatchObject({
      externalApplicationSessionIdEncrypted: null,
      externalApplicationSessionIdEncryptionKeyId: null,
      externalApplicationSessionIdUpdatedAt: null,
    });
  });

  it("removes the private conversation and principal when session persistence fails", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
      },
      { ipAddress: "192.0.2.10" },
    );
    fixture.sessionCreate.mockRejectedValueOnce(
      new Error("session persistence failed"),
    );

    await expect(
      fixture.service.exchangeTicket(
        ticket.ticket,
        ORIGIN,
        fixture.issueAccessToken,
        {},
      ),
    ).rejects.toThrow("session persistence failed");

    const principalId = fixture.userCreate.mock.calls[0]?.[0].data.id;
    expect(fixture.cleanupConversation).toHaveBeenCalledWith(
      principalId,
      CONVERSATION_ID,
    );
    expect(fixture.userDelete).toHaveBeenCalledWith({
      where: { id: principalId },
    });
  });

  it("creates a public session directly without issuing tickets or tokens", async () => {
    const fixture = lifecycleFixture();
    fixture.access.authMode = "public";
    fixture.access.appSecretHash = null;

    const session = await fixture.service.createPublicSession(
      fixture.access.appId!,
      ORIGIN,
      { ipAddress: "192.0.2.10" },
      {},
    );

    expect(session).toEqual({
      session_id: SESSION_ID,
      session_expires_at: addSeconds(
        INITIAL_NOW,
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
      ).toISOString(),
    });
    expect(fixture.ticketRow).toBeNull();
    expect(fixture.refreshTokenCreate).not.toHaveBeenCalled();
    expect(fixture.issuedAccessTokens).toHaveLength(0);
    await expect(
      fixture.service.verifyPublicSession(
        fixture.access.appId!,
        SESSION_ID,
        ORIGIN,
      ),
    ).resolves.toMatchObject({
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      origin: ORIGIN,
    });
    await expect(
      fixture.service.verifyPublicSession(
        fixture.access.appId!,
        SESSION_ID,
        "https://attacker.example.test",
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_SESSION_EXPIRED" });
  });

  it("exchanges a ticket once, rotates renewal tokens idempotently, and revokes the family on reuse", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
        externalTenant: "partner-tenant",
        displayName: "Partner user",
      },
      { ipAddress: "192.0.2.10" },
    );
    const exchanged = await fixture.service.exchangeTicket(
      ticket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );

    expect(fixture.issuedAccessTokens[0]?.ttlSeconds).toBe(
      APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
    );
    expect(exchanged).toMatchObject({
      session_id: SESSION_ID,
      access_token_expires_at: addSeconds(
        INITIAL_NOW,
        APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      ).toISOString(),
      renewal_token_expires_at: addSeconds(
        INITIAL_NOW,
        APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
      ).toISOString(),
      session_expires_at: addSeconds(
        INITIAL_NOW,
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
      ).toISOString(),
    });
    expect(exchanged.renewal_token).toMatch(/^lsr_[A-Za-z0-9_-]+$/u);
    expect(fixture.session?.runtimePrincipalId).not.toBe(OWNER_ID);
    const issuedClaims = fixture.issuedAccessTokens[0]?.claims;
    expect(issuedClaims).toBeDefined();
    await expect(
      fixture.service.verifyAccessToken({
        ...issuedClaims!,
        iat: Math.floor(INITIAL_NOW.getTime() / 1_000),
        exp:
          Math.floor(INITIAL_NOW.getTime() / 1_000) +
          APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      }),
    ).resolves.toMatchObject({
      sessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      origin: ORIGIN,
    });
    await expect(
      fixture.service.verifyAccessToken({
        ...issuedClaims!,
        origin: "https://attacker.example.test",
        iat: Math.floor(INITIAL_NOW.getTime() / 1_000),
        exp:
          Math.floor(INITIAL_NOW.getTime() / 1_000) +
          APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
      }),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_SESSION_EXPIRED" });

    await expect(
      fixture.service.exchangeTicket(
        ticket.ticket,
        ORIGIN,
        fixture.issueAccessToken,
        {},
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_TICKET_INVALID" });

    fixture.setNow(addSeconds(INITIAL_NOW, 60 * 60));
    const renewalRequestId = "80000000-0000-4000-8000-000000000001";
    const rotated = await fixture.service.renewSession(
      exchanged.renewal_token,
      renewalRequestId,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );
    expect(rotated.renewal_token).not.toBe(exchanged.renewal_token);
    expect(rotated.renewal_token_expires_at).toBe(
      addSeconds(
        fixture.now(),
        APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS,
      ).toISOString(),
    );

    const retried = await fixture.service.renewSession(
      exchanged.renewal_token,
      renewalRequestId,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );
    expect(retried.renewal_token).toBe(rotated.renewal_token);
    expect(fixture.refreshTokenCreate).toHaveBeenCalledTimes(2);

    await expect(
      fixture.service.renewSession(
        exchanged.renewal_token,
        "80000000-0000-4000-8000-000000000002",
        ORIGIN,
        fixture.issueAccessToken,
        {},
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_RENEWAL_REUSED" });
    expect(fixture.session?.status).toBe("revoked");
    expect(fixture.principal?.status).toBe("disabled");
    expect(fixture.refreshTokens.every((token) => token.revokedAt)).toBe(true);
  });

  it("uses a generic external user name when the host does not provide a display name", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
        externalTenant: "partner-tenant",
      },
      { ipAddress: "192.0.2.10" },
    );

    await fixture.service.exchangeTicket(
      ticket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );

    expect(fixture.userCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: "外部用户" }),
    });
  });

  it("rejects renewal at 8 hours and access at the 7-day absolute boundary", async () => {
    const renewalFixture = lifecycleFixture();
    const renewalTicket =
      await renewalFixture.service.issueAuthenticatedTicket(
        { appId: APP_ID, appSecret: APP_SECRET, origin: ORIGIN },
        { ipAddress: "192.0.2.10" },
      );
    const renewalTokens = await renewalFixture.service.exchangeTicket(
      renewalTicket.ticket,
      ORIGIN,
      renewalFixture.issueAccessToken,
      {},
    );

    renewalFixture.setNow(
      addSeconds(INITIAL_NOW, APPLICATION_EMBED_RENEWAL_TOKEN_TTL_SECONDS),
    );
    await expect(
      renewalFixture.service.renewSession(
        renewalTokens.renewal_token,
        "80000000-0000-4000-8000-000000000003",
        ORIGIN,
        renewalFixture.issueAccessToken,
        {},
      ),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_SESSION_EXPIRED" });
    expect(renewalFixture.session?.status).toBe("expired");
    expect(renewalFixture.principal?.status).toBe("disabled");

    const absoluteFixture = lifecycleFixture();
    const absoluteTicket =
      await absoluteFixture.service.issueAuthenticatedTicket(
        { appId: APP_ID, appSecret: APP_SECRET, origin: ORIGIN },
        { ipAddress: "192.0.2.11" },
      );
    await absoluteFixture.service.exchangeTicket(
      absoluteTicket.ticket,
      ORIGIN,
      absoluteFixture.issueAccessToken,
      {},
    );
    const claims = absoluteFixture.issuedAccessTokens[0]!.claims;
    absoluteFixture.setNow(
      addSeconds(INITIAL_NOW, APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS),
    );

    await expect(
      absoluteFixture.service.verifyAccessToken({
        ...claims,
        iat: Math.floor(INITIAL_NOW.getTime() / 1_000),
        exp:
          Math.floor(INITIAL_NOW.getTime() / 1_000) +
          APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
      }),
    ).rejects.toMatchObject({ code: "APPLICATION_EMBED_SESSION_EXPIRED" });
  });

  it("restores the same external user's conversation history after the absolute session expires", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
        externalTenant: "partner-tenant",
        displayName: "Partner user",
      },
      { ipAddress: "192.0.2.10" },
    );
    await fixture.service.exchangeTicket(
      ticket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );
    const originalPrincipalId = fixture.session?.runtimePrincipalId;

    fixture.setNow(
      addSeconds(
        INITIAL_NOW,
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS + 60,
      ),
    );
    const returningTicket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
        externalTenant: "partner-tenant",
        displayName: "Returning user",
      },
      { ipAddress: "192.0.2.10" },
    );
    const restored = await fixture.service.exchangeTicket(
      returningTicket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );

    expect(fixture.userCreate).toHaveBeenCalledTimes(1);
    expect(fixture.userUpdate).toHaveBeenCalledWith({
      where: { id: originalPrincipalId },
      data: expect.objectContaining({
        status: "active",
        name: "Returning user",
      }),
    });
    expect(fixture.session).toMatchObject({
      id: SESSION_ID,
      runtimePrincipalId: originalPrincipalId,
      conversationId: CONVERSATION_ID,
      status: "active",
      externalSubject: "partner-user-42",
      externalTenant: "partner-tenant",
      origin: ORIGIN,
    });
    expect(restored.session_id).toBe(SESSION_ID);
    expect(restored.session_expires_at).toBe(
      addSeconds(
        fixture.now(),
        APPLICATION_EMBED_SESSION_ABSOLUTE_TTL_SECONDS,
      ).toISOString(),
    );
  });

  it("lists, creates, switches, and permanently deletes external application tasks", async () => {
    const fixture = lifecycleFixture();
    const ticket = await fixture.service.issueAuthenticatedTicket(
      {
        appId: APP_ID,
        appSecret: APP_SECRET,
        origin: ORIGIN,
        externalSubject: "partner-user-42",
      },
      { ipAddress: "192.0.2.10" },
    );
    await fixture.service.exchangeTicket(
      ticket.ticket,
      ORIGIN,
      fixture.issueAccessToken,
      {},
    );
    const firstSession = await fixture.service.verifyAccessToken(
      accessClaimsFor(fixture.issuedAccessTokens[0]!.claims, INITIAL_NOW),
    );

    await expect(
      fixture.service.listSessionConversations(firstSession),
    ).resolves.toMatchObject({
      items: [
        {
          id: CONVERSATION_ID,
          title: "Partner operations",
          current: true,
          execution_status: "idle",
        },
      ],
    });
    fixture.setConversationLastTurnStatus(CONVERSATION_ID, "completed");
    await fixture.service.listSessionConversations(firstSession);
    expect(fixture.scheduleConversationTitle).toHaveBeenCalledWith(
      CONVERSATION_ID,
    );

    const created = await fixture.service.createSessionConversation(
      firstSession,
      fixture.issueAccessToken,
    );
    expect(created).toMatchObject({
      session_id: SESSION_ID,
      conversation_id: SECOND_CONVERSATION_ID,
      access_token: expect.stringMatching(/^jwt_/u),
      renewal_token: expect.stringMatching(/^lsr_/u),
    });
    const secondSession = await fixture.service.verifyAccessToken(
      accessClaimsFor(fixture.issuedAccessTokens.at(-1)!.claims, fixture.now()),
    );
    await expect(
      fixture.service.listSessionConversations(secondSession),
    ).resolves.toMatchObject({
      items: [
        { id: SECOND_CONVERSATION_ID, current: true },
        { id: CONVERSATION_ID, current: false },
      ],
    });

    const selected = await fixture.service.selectSessionConversation(
      secondSession,
      CONVERSATION_ID,
      fixture.issueAccessToken,
    );
    expect(selected).toMatchObject({
      session_id: SESSION_ID,
      conversation_id: CONVERSATION_ID,
      access_token: expect.stringMatching(/^jwt_/u),
      renewal_token: expect.stringMatching(/^lsr_/u),
    });

    const selectedSession = await fixture.service.verifyAccessToken(
      accessClaimsFor(fixture.issuedAccessTokens.at(-1)!.claims, fixture.now()),
    );
    const deleted = await fixture.service.deleteSessionConversation(
      selectedSession,
      CONVERSATION_ID,
      fixture.issueAccessToken,
      { ipAddress: "192.0.2.10" },
    );

    expect(deleted).toMatchObject({
      session_id: SESSION_ID,
      conversation_id: THIRD_CONVERSATION_ID,
      access_token: expect.stringMatching(/^jwt_/u),
      renewal_token: expect.stringMatching(/^lsr_/u),
    });
    expect(fixture.cleanupConversation).toHaveBeenCalledWith(
      firstSession.ownerId,
      CONVERSATION_ID,
      { ipAddress: "192.0.2.10" },
    );
    expect(fixture.session?.conversationId).toBe(THIRD_CONVERSATION_ID);
  });
});

type ExternalAccessRow = {
  id: string;
  applicationId: string;
  publicId: string;
  enabled: boolean;
  authMode: string;
  appId: string | null;
  appSecretHash: string | null;
  appSecretEncrypted: string | null;
  appSecretEncryptionKeyId: string | null;
  credentialVersion: number;
  allowedOriginsJson: string[];
  starterQuestionsJson: Array<{ origin: string; questions: string[] }>;
  createdBy: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type TicketRow = {
  id: string;
  externalAccessId: string;
  credentialVersion: number;
  ticketHash: string;
  origin: string;
  externalSubject: string | null;
  externalTenant: string | null;
  displayName: string | null;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

type SessionRow = {
  id: string;
  externalAccessId: string;
  applicationId: string;
  runtimePrincipalId: string;
  conversationId: string;
  externalSubject: string | null;
  externalTenant: string | null;
  displayName: string | null;
  origin: string;
  status: string;
  credentialVersion: number;
  externalApplicationSessionIdEncrypted: string | null;
  externalApplicationSessionIdEncryptionKeyId: string | null;
  externalApplicationSessionIdUpdatedAt: Date | null;
  absoluteExpiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type RefreshTokenRow = {
  id: string;
  sessionId: string;
  familyId: string;
  parentTokenId: string | null;
  replacedByTokenId: string | null;
  rotationRequestId: string | null;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
  createdAt: Date;
};

type ConversationRow = {
  id: string;
  ownerId: string;
  title: string | null;
  titleSource: string | null;
  archiveStatus: string;
  codexThreadId: string | null;
  lastTurnStatus: string | null;
  applicationId: string | null;
  applicationNameSnapshot: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function lifecycleFixture() {
  let currentNow = new Date(INITIAL_NOW);
  let ticketRow: TicketRow | null = null;
  let session: SessionRow | null = null;
  let principal: {
    id: string;
    status: string;
    accountType: string;
    name: string | null;
  } | null = null;
  const refreshTokens: RefreshTokenRow[] = [];
  const conversations: ConversationRow[] = [];
  const access: ExternalAccessRow = {
    id: EXTERNAL_ACCESS_ID,
    applicationId: APPLICATION_ID,
    publicId: "app_test_public_identifier",
    enabled: true,
    authMode: "required",
    appId: APP_ID,
    appSecretHash: sha256(APP_SECRET),
    appSecretEncrypted: null,
    appSecretEncryptionKeyId: null,
    credentialVersion: 1,
    allowedOriginsJson: [ORIGIN],
    starterQuestionsJson: [
      { origin: ORIGIN, questions: ["How do I apply?"] },
    ],
    createdBy: OWNER_ID,
    updatedBy: null,
    createdAt: INITIAL_NOW,
    updatedAt: INITIAL_NOW,
  };
  const application = {
    id: APPLICATION_ID,
    ownerId: OWNER_ID,
    name: "Partner operations",
    description: "Operate the partner business workflow.",
    iconPreset: "bot",
    iconObjectKey: null,
    model: null as string | null,
    status: "active",
  };
  const userCreate = vi.fn(
    async ({ data }: { data: { id: string; name?: string | null } }) => {
      principal = {
        id: data.id,
        status: "active",
        accountType: "application_external",
        name: data.name ?? null,
      };
      return principal;
    },
  );
  const userDelete = vi.fn(async () => principal);
  const cleanupConversation = vi.fn(
    async (_ownerId: string, conversationId: string) => {
      const index = conversations.findIndex(
        (conversation) => conversation.id === conversationId,
      );
      if (index >= 0) conversations.splice(index, 1);
    },
  );
  const scheduleConversationTitle = vi.fn();
  const conversationCreate = vi.fn(
    async (
      ownerId: string,
      applicationInput: { id: string; name: string },
    ) => {
      const id =
        [CONVERSATION_ID, SECOND_CONVERSATION_ID, THIRD_CONVERSATION_ID][
          conversations.length
        ] ?? crypto.randomUUID();
      conversations.push({
        id,
        ownerId,
        title: applicationInput.name,
        titleSource: "manual",
        archiveStatus: "active",
        codexThreadId: null,
        lastTurnStatus: null,
        applicationId: applicationInput.id,
        applicationNameSnapshot: applicationInput.name,
        createdAt: currentNow,
        updatedAt: currentNow,
      });
      return { id };
    },
  );
  const refreshTokenCreate = vi.fn(
    async ({ data }: { data: Record<string, unknown> }) => {
      const row: RefreshTokenRow = {
        id:
          refreshTokens.length === 0 ? FIRST_TOKEN_ID : SECOND_TOKEN_ID,
        sessionId: String(data.sessionId),
        familyId: String(data.familyId),
        parentTokenId:
          typeof data.parentTokenId === "string" ? data.parentTokenId : null,
        replacedByTokenId: null,
        rotationRequestId: null,
        tokenHash: String(data.tokenHash),
        expiresAt: data.expiresAt as Date,
        revokedAt: null,
        revokeReason: null,
        createdAt: currentNow,
      };
      refreshTokens.push(row);
      return row;
    },
  );
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: FIRST_TOKEN_ID }]),
    applicationEmbedTicket: {
      findUnique: vi.fn(async ({ where }: { where: { ticketHash: string } }) =>
        ticketRow?.ticketHash === where.ticketHash ? ticketRow : null,
      ),
      updateMany: vi.fn(async () => {
        if (!ticketRow || ticketRow.consumedAt !== null) return { count: 0 };
        ticketRow.consumedAt = currentNow;
        return { count: 1 };
      }),
    },
    applicationExternalAccess: {
      findUnique: vi.fn(async () => access),
    },
    applicationExternalRefreshToken: {
      findUnique: vi.fn(
        async ({ where }: { where: { tokenHash?: string; id?: string } }) =>
          refreshTokens.find(
            (token) =>
              (where.tokenHash && token.tokenHash === where.tokenHash) ||
              (where.id && token.id === where.id),
          ) ?? null,
      ),
      create: refreshTokenCreate,
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<RefreshTokenRow>;
        }) => {
          const token = refreshTokens.find((candidate) => candidate.id === where.id);
          if (!token) throw new Error("refresh token not found");
          Object.assign(token, data);
          return token;
        },
      ),
      updateMany: vi.fn(
        async ({ data }: { data: Partial<RefreshTokenRow> }) => {
          for (const token of refreshTokens) {
            if (token.revokedAt === null) Object.assign(token, data);
          }
          return { count: refreshTokens.length };
        },
      ),
    },
    applicationExternalSession: {
      findUnique: vi.fn(async () => session),
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            externalAccessId?: string;
            applicationId?: string;
            externalSubject?: string | null;
            externalTenant?: string | null;
          };
        }) =>
          session &&
          (where.externalAccessId === undefined ||
            session.externalAccessId === where.externalAccessId) &&
          (where.applicationId === undefined ||
            session.applicationId === where.applicationId) &&
          (where.externalSubject === undefined ||
            session.externalSubject === where.externalSubject) &&
          (where.externalTenant === undefined ||
            session.externalTenant === where.externalTenant)
            ? session
            : null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        session = {
          id: SESSION_ID,
          externalAccessId: String(data.externalAccessId),
          applicationId: String(data.applicationId),
          runtimePrincipalId: String(data.runtimePrincipalId),
          conversationId: String(data.conversationId),
          externalSubject:
            typeof data.externalSubject === "string"
              ? data.externalSubject
              : null,
          externalTenant:
            typeof data.externalTenant === "string" ? data.externalTenant : null,
          displayName:
            typeof data.displayName === "string" ? data.displayName : null,
          origin: String(data.origin),
          status: "active",
          credentialVersion: Number(data.credentialVersion),
          externalApplicationSessionIdEncrypted: null,
          externalApplicationSessionIdEncryptionKeyId: null,
          externalApplicationSessionIdUpdatedAt: null,
          absoluteExpiresAt: data.absoluteExpiresAt as Date,
          lastSeenAt: data.lastSeenAt as Date,
          revokedAt: null,
          revokeReason: null,
          createdAt: currentNow,
          updatedAt: currentNow,
        };
        return session;
      }),
      update: vi.fn(async ({ data }: { data: Partial<SessionRow> }) => {
        if (!session) throw new Error("session not found");
        Object.assign(session, data);
        return session;
      }),
      updateMany: vi.fn(
        async ({ data }: { data: Partial<SessionRow> }) => {
          if (!session) return { count: 0 };
          Object.assign(session, data);
          return { count: 1 };
        },
      ),
    },
    application: {
      findUnique: vi.fn(async () => application),
      findFirst: vi.fn(async () => application),
    },
    conversation: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            id?: string;
            ownerId?: string;
            applicationId?: string;
            archiveStatus?: string;
          };
        }) =>
          conversations.find(
            (conversation) =>
              (where.id === undefined || conversation.id === where.id) &&
              (where.ownerId === undefined ||
                conversation.ownerId === where.ownerId) &&
              (where.applicationId === undefined ||
                conversation.applicationId === where.applicationId) &&
              (where.archiveStatus === undefined ||
                conversation.archiveStatus === where.archiveStatus),
          ) ?? null,
      ),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: {
            ownerId?: string;
            applicationId?: string;
            archiveStatus?: string;
          };
          take?: number;
        }) =>
          conversations
            .filter(
              (conversation) =>
                (where.ownerId === undefined ||
                  conversation.ownerId === where.ownerId) &&
                (where.applicationId === undefined ||
                  conversation.applicationId === where.applicationId) &&
                (where.archiveStatus === undefined ||
                  conversation.archiveStatus === where.archiveStatus),
            )
            .sort(
              (left, right) =>
                right.updatedAt.getTime() - left.updatedAt.getTime() ||
                right.id.localeCompare(left.id),
            )
            .slice(0, take ?? conversations.length),
      ),
    },
    conversationTurn: {
      findMany: vi.fn(async () => []),
    },
    pendingRequest: {
      findMany: vi.fn(async () => []),
    },
    user: {
      findUnique: vi.fn(async () => principal),
      update: vi.fn(
        async ({
          data,
        }: {
          data: { status?: string; name?: string; updatedAt?: Date };
        }) => {
          if (!principal) throw new Error("principal not found");
          if (data.status) principal.status = data.status;
          if (data.name) principal.name = data.name;
          return principal;
        },
      ),
      updateMany: vi.fn(
        async ({ data }: { data: { status?: string } }) => {
          if (!principal) return { count: 0 };
          if (data.status) principal.status = data.status;
          return { count: 1 };
        },
      ),
    },
  };
  const sessionCreate = transaction.applicationExternalSession.create;
  const prisma = {
    ...transaction,
    $transaction: vi.fn(
      async (action: (tx: typeof transaction) => Promise<unknown>) =>
        action(transaction),
    ),
    applicationExternalAccess: {
      findFirst: vi.fn(async () => access),
      findUnique: vi.fn(async () => access),
    },
    application: {
      findUnique: vi.fn(async () => application),
      findFirst: vi.fn(async () => application),
    },
    applicationEmbedTicket: {
      ...transaction.applicationEmbedTicket,
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        ticketRow = {
          id: TICKET_ID,
          externalAccessId: String(data.externalAccessId),
          credentialVersion: Number(data.credentialVersion),
          ticketHash: String(data.ticketHash),
          origin: String(data.origin),
          externalSubject:
            typeof data.externalSubject === "string"
              ? data.externalSubject
              : null,
          externalTenant:
            typeof data.externalTenant === "string" ? data.externalTenant : null,
          displayName:
            typeof data.displayName === "string" ? data.displayName : null,
          expiresAt: data.expiresAt as Date,
          consumedAt: null,
          createdAt: currentNow,
        };
        return ticketRow;
      }),
    },
    applicationExternalSession: transaction.applicationExternalSession,
    applicationExternalRefreshToken:
      transaction.applicationExternalRefreshToken,
    user: {
      ...transaction.user,
      create: userCreate,
      delete: userDelete,
    },
  };
  const issuedAccessTokens: Array<{
    claims: Omit<ApplicationEmbedAccessTokenClaims, "iat" | "exp">;
    ttlSeconds: number;
  }> = [];
  const issueAccessToken = vi.fn(
    async (
      claims: Omit<ApplicationEmbedAccessTokenClaims, "iat" | "exp">,
      ttlSeconds: number,
    ) => {
      issuedAccessTokens.push({ claims, ttlSeconds });
      return {
        token: `jwt_${"a".repeat(64)}_${issuedAccessTokens.length}`,
        expiresAt: addSeconds(currentNow, ttlSeconds),
      };
    },
  );
  const service = createService(
    prisma,
    () => currentNow,
    conversationCreate,
    cleanupConversation,
    scheduleConversationTitle,
  );

  return {
    access,
    application,
    service,
    issueAccessToken,
    issuedAccessTokens,
    refreshTokens,
    refreshTokenCreate,
    userCreate,
    userDelete,
    sessionCreate,
    cleanupConversation,
    scheduleConversationTitle,
    conversationCreate,
    userUpdate: transaction.user.update,
    get ticketRow() {
      return ticketRow;
    },
    get session() {
      return session;
    },
    get principal() {
      return principal;
    },
    now: () => currentNow,
    setNow(value: Date) {
      currentNow = value;
    },
    setConversationLastTurnStatus(conversationId: string, status: string) {
      const conversation = conversations.find(
        (item) => item.id === conversationId,
      );
      if (conversation) conversation.lastTurnStatus = status;
    },
  };
}

function createService(
  prisma: object,
  now: () => Date,
  createConversation: (
    ownerId: string,
    application: { id: string; name: string },
  ) => Promise<{ id: string }> = async () => ({ id: CONVERSATION_ID }),
  cleanupConversation: (
    ownerId: string,
    conversationId: string,
    context?: Record<string, unknown>,
  ) => Promise<void> = async () => undefined,
  scheduleConversationTitle: (conversationId: string) => void = () =>
    undefined,
) {
  return new ApplicationExternalAccessService(
    prisma as never,
    { client: { eval: vi.fn(async () => 1) } } as never,
    { write: vi.fn(async () => undefined) } as never,
    { presignedGetObject: vi.fn() } as never,
    "https://linksense.example.test",
    MASTER_KEY,
    KEY_ID,
    createConversation,
    cleanupConversation,
    scheduleConversationTitle,
    now,
  );
}

function actor() {
  return {
    id: OWNER_ID,
    role: "user" as const,
    status: "active" as const,
    ipAddress: "192.0.2.10",
  };
}

function addSeconds(value: Date, seconds: number) {
  return new Date(value.getTime() + seconds * 1_000);
}

function accessClaimsFor(
  claims: Omit<ApplicationEmbedAccessTokenClaims, "iat" | "exp">,
  issuedAt: Date,
): ApplicationEmbedAccessTokenClaims {
  return {
    ...claims,
    iat: Math.floor(issuedAt.getTime() / 1_000),
    exp:
      Math.floor(issuedAt.getTime() / 1_000) +
      APPLICATION_EMBED_ACCESS_TOKEN_TTL_SECONDS,
  };
}
