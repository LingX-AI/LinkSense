import Fastify from "fastify";
import { registerMaintenanceGuard } from "../src/app.js";
import { sendAppError } from "../src/lib/http.js";
import fastifyJwt from "@fastify/jwt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppError } from "../src/lib/errors.js";
import { applicationEmbedRoutes } from "../src/modules/application-embed/routes.js";

const APP_ID = "lsa_application_identifier_1234";
const APPLICATION_ID = "20000000-0000-4000-8000-000000000001";
const OWNER_ID = "30000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "40000000-0000-4000-8000-000000000001";
const SESSION_ID = "50000000-0000-4000-8000-000000000001";
const TURN_ID = "50000000-0000-4000-8000-000000000002";
const ORIGIN = "https://partner.example.test";
const AUDIO_DATA_URL = "data:audio/webm;base64,UklGRg==";
const apps: Array<ReturnType<typeof Fastify>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("application embed routes", () => {
  it.each(["public", "required"] as const)("blocks %s embedded business requests while keeping the frame available during maintenance", async (authMode) => {
    const { app, external, acceptTurn, getMaintenanceStatus } = await routeFixture(authMode, { maintenanceActive: true });
    for (const headers of [
      {},
      { authorization: "Bearer administrator-session" },
      { "x-linksense-embed-app-id": APP_ID, "x-linksense-embed-session-id": SESSION_ID, "x-linksense-embed-origin": ORIGIN },
    ]) {
      for (const endpoint of [
        { method: "POST", url: "/api/v1/embed/session/turns" },
        { method: "GET", url: "/api/v1/embed/session/conversations" },
        { method: "GET", url: "/api/v1/embed/session/events" },
        { method: "POST", url: "/api/v1/embed/public-sessions" },
        { method: "POST", url: "/api/v1/embed/sessions/exchange" },
        { method: "POST", url: "/api/v1/embed/tickets" },
      ] as const) {
        const response = await app.inject({ ...endpoint, headers });
        expect(response.statusCode, response.body).toBe(503);
        expect(response.json().error_code).toBe("SYSTEM_MAINTENANCE_ACTIVE");
      }
    }
    expect(external.verifyPublicSession).not.toHaveBeenCalled();
    expect(external.verifyAccessToken).not.toHaveBeenCalled();
    expect(external.createPublicSession).not.toHaveBeenCalled();
    expect(acceptTurn).not.toHaveBeenCalled();
    const frame = await app.inject({ url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}` });
    expect(frame.statusCode).toBe(200);
    expect(frame.headers["content-security-policy"]).toContain(`frame-ancestors ${ORIGIN}`);

    getMaintenanceStatus.mockResolvedValue({ enabled: false, active: false, reason: null, start_at: null, end_at: null });
    const resumed = await app.inject({
      method: "POST", url: "/api/v1/embed/public-sessions", payload: { app_id: APP_ID, origin: ORIGIN },
    });
    expect(resumed.statusCode, resumed.body).toBe(201);
    expect(external.createPublicSession).toHaveBeenCalledTimes(1);
  });

  it("mounts the complete chat, tool-interaction, attachment, artifact, and knowledge surface", async () => {
    const { app } = await routeFixture("required");

    expect(
      app.hasRoute({ method: "POST", url: "/api/v1/embed/session/turns" }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/voice/transcriptions",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/voice/transcriptions/status",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "PUT",
        url: "/api/v1/embed/session/external-application-session",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/turns/:turnId/interrupt",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/user-input-requests/:requestId/respond",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/attachments",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "DELETE",
        url: "/api/v1/embed/session/attachments",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/events",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/model-preference",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "PUT",
        url: "/api/v1/embed/session/model-preference",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/attachments/:fileId/content",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/files/:fileId/content",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/files/:fileId/download",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/knowledge-citations/:citationId",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/conversations",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/conversations",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "POST",
        url: "/api/v1/embed/session/conversations/:conversationId/select",
      }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "DELETE",
        url: "/api/v1/embed/session/conversations/:conversationId",
      }),
    ).toBe(true);
  });

  it("keeps the embed surface available in Core without knowledge routes", async () => {
    const { app } = await routeFixture("required", {
      knowledgeInstalled: false,
    });

    expect(
      app.hasRoute({ method: "POST", url: "/api/v1/embed/session/turns" }),
    ).toBe(true);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/knowledge-citations/:citationId",
      }),
    ).toBe(false);
    expect(
      app.hasRoute({
        method: "GET",
        url: "/api/v1/embed/session/turns/:turnId/knowledge-assets/:assetId",
      }),
    ).toBe(false);
  });

  it("returns an isolated public frame with an exact frame-ancestor policy", async () => {
    const { app, external } = await routeFixture("public");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}&locale=en-US`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["content-security-policy"]).toContain(
      `frame-ancestors ${ORIGIN}`,
    );
    expect(response.headers["permissions-policy"]).toBe(
      "camera=(), microphone=(self), geolocation=()",
    );
    expect(response.body).toContain("Partner operations");
    expect(response.body).toContain('<html lang="en-US">');
    expect(response.body).toContain('&quot;locale&quot;:&quot;en-US&quot;');
    expect(response.body).toContain("&quot;auth_mode&quot;:&quot;public&quot;");
    expect(response.body).toContain(
      "&quot;allows_user_model_selection&quot;:true",
    );
    expect(response.body).toContain(
      "&quot;starter_questions&quot;:[&quot;How do I apply?&quot;]",
    );
    expect(response.body).toContain("&quot;app_id&quot;:&quot;lsa_application_identifier_1234&quot;");
    expect(response.body).not.toContain("&quot;ticket&quot;");
    expect(response.body).not.toContain("lst_");
    expect(response.body).not.toContain("app_secret");
    expect(response.body).toContain(
      '<link rel="stylesheet" href="/assets/embed-app.css" />',
    );
    expect(response.body).toContain(
      '<script type="module" src="/assets/embed-app.js"></script>',
    );
    expect(response.body).not.toContain("/assets/app.css");
    expect(response.body).not.toContain("/assets/embed.js");
    expect(external.createPublicSession).not.toHaveBeenCalled();
  });

  it("defaults unsupported or missing frame locales to Chinese", async () => {
    const { app } = await routeFixture("public");

    const unsupported = await app.inject({
      method: "GET",
      url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}&locale=fr-FR`,
    });
    const missing = await app.inject({
      method: "GET",
      url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}`,
    });

    expect(unsupported.statusCode, unsupported.body).toBe(200);
    expect(unsupported.body).toContain('<html lang="zh-CN">');
    expect(unsupported.body).toContain('&quot;locale&quot;:&quot;zh-CN&quot;');
    expect(missing.statusCode, missing.body).toBe(200);
    expect(missing.body).toContain('<html lang="zh-CN">');
  });

  it("waits for a host-delivered ticket when authentication is required", async () => {
    const { app, external } = await routeFixture("required");

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).toContain("&quot;auth_mode&quot;:&quot;required&quot;");
    expect(response.body).toContain("&quot;app_id&quot;:&quot;lsa_application_identifier_1234&quot;");
    expect(response.body).not.toContain("&quot;ticket&quot;");
    expect(response.body).not.toContain("lss_");
    expect(external.createPublicSession).not.toHaveBeenCalled();
  });

  it("injects the Vite React refresh preamble for development iframe assets", async () => {
    const { app } = await routeFixture("required", { developmentAssets: true });

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/embed/frame/${APP_ID}?parent_origin=${encodeURIComponent(ORIGIN)}`,
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-security-policy"]).toContain(
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
    );
    expect(response.body).toContain('from "/@react-refresh"');
    expect(response.body).toContain(
      "window.__vite_plugin_react_preamble_installed__ = true",
    );
    expect(response.body).toContain('src="/src/embed-main.tsx"');
  });

  it("creates a direct public session without accepting a secret or ticket", async () => {
    const { app, external } = await routeFixture("public");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/embed/public-sessions",
      payload: {
        app_id: APP_ID,
        origin: ORIGIN,
      },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(external.createPublicSession).toHaveBeenCalledWith(
      APP_ID,
      ORIGIN,
      expect.objectContaining({ ipAddress: expect.any(String) }),
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        session_id: SESSION_ID,
        session_expires_at: "2026-08-20T00:00:00.000Z",
      },
    });
    expect(
      app.hasRoute({ method: "POST", url: "/api/v1/embed/public-tickets" }),
    ).toBe(false);
  });

  it("starts iframe turns without consuming staged composer attachments", async () => {
    const { app, external, acceptTurn } = await routeFixture("public");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/embed/session/turns",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
      payload: {
        input_text: "你好",
        idempotency_key: "embed-turn-idempotency-key",
      },
    });

    expect(response.statusCode, response.body).toBe(202);
    expect(external.assertTurnRateLimit).toHaveBeenCalledWith(
      SESSION_ID,
      expect.any(String),
    );
    expect(acceptTurn).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      expect.objectContaining({
        inputText: "你好",
        collaborationMode: "default",
        priorityCapabilityIds: [],
        knowledgeBaseIds: [],
        submitMode: "normal",
        preserveStagedAttachments: true,
        idempotencyKey: "embed-turn-idempotency-key",
      }),
      expect.any(Object),
    );
    expect(response.json()).toMatchObject({
      success: true,
      data: {
        turn_id: TURN_ID,
        accepted: true,
      },
    });
  });

  it("streams public embedded voice transcription and limits it by session id", async () => {
    const {
      app,
      assertApplicationEmbedSessionAllowed,
      assertVoiceUserAllowed,
      assertCanStartTask,
      streamVoiceTranscription,
    } = await routeFixture("public");

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/embed/session/voice/transcriptions",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
      payload: {
        audio_data_url: AUDIO_DATA_URL,
        language: "zh-CN",
        stream: true,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    expect(assertCanStartTask).toHaveBeenCalledWith(OWNER_ID);
    expect(assertApplicationEmbedSessionAllowed).toHaveBeenCalledWith(
      SESSION_ID,
    );
    expect(assertVoiceUserAllowed).not.toHaveBeenCalled();
    expect(streamVoiceTranscription).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDataUrl: AUDIO_DATA_URL,
        language: "zh-CN",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(parseNdjson(response.body)).toEqual([
      { type: "delta", text: "嵌入识别" },
      { type: "done", text: "嵌入识别" },
    ]);
  });

  it("reports voice transcription availability to an authenticated embedded session", async () => {
    const { app, getVoiceTranscriptionAvailability } = await routeFixture(
      "public",
    );
    getVoiceTranscriptionAvailability.mockResolvedValueOnce({
      available: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/embed/session/voice/transcriptions/status",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      success: true,
      data: { available: false },
    });
    expect(getVoiceTranscriptionAvailability).toHaveBeenCalledOnce();
  });

  it("returns a localized 429 before public embedded voice transcription", async () => {
    const {
      app,
      assertApplicationEmbedSessionAllowed,
      streamVoiceTranscription,
    } = await routeFixture("public");
    assertApplicationEmbedSessionAllowed.mockRejectedValueOnce(
      new AppError("VOICE_TRANSCRIPTION_RATE_LIMITED", {
        retry_after_seconds: 38,
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/embed/session/voice/transcriptions",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
      payload: {
        audio_data_url: AUDIO_DATA_URL,
        language: "en-US",
        stream: true,
      },
    });

    expect(response.statusCode).toBe(429);
    expect(response.headers["retry-after"]).toBe("38");
    expect(response.json()).toMatchObject({
      success: false,
      error_code: "VOICE_TRANSCRIPTION_RATE_LIMITED",
      message:
        "Voice input can be used up to 20 times per minute. Try again shortly.",
      params: { retry_after_seconds: 38 },
    });
    expect(assertApplicationEmbedSessionAllowed).toHaveBeenCalledWith(
      SESSION_ID,
    );
    expect(streamVoiceTranscription).not.toHaveBeenCalled();
  });

  it("limits authenticated embedded voice transcription by its external principal", async () => {
    const {
      app,
      assertApplicationEmbedSessionAllowed,
      assertVoiceUserAllowed,
    } = await routeFixture("required");
    const accessToken = await app.jwt.sign(
      {
        token_use: "application_embed",
        sub: OWNER_ID,
        session_id: SESSION_ID,
        application_id: APPLICATION_ID,
        conversation_id: CONVERSATION_ID,
        external_access_id: "60000000-0000-4000-8000-000000000001",
        origin: ORIGIN,
        credential_version: 1,
        jti: "70000000-0000-4000-8000-000000000011",
      },
      { expiresIn: "1h" },
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/embed/session/voice/transcriptions",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        audio_data_url: AUDIO_DATA_URL,
        stream: true,
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(assertVoiceUserAllowed).toHaveBeenCalledWith(OWNER_ID);
    expect(assertApplicationEmbedSessionAllowed).not.toHaveBeenCalled();
  });

  it("clears an exact attachment batch with one authenticated file operation", async () => {
    const { app, deleteStagedAttachments } = await routeFixture("public");
    const firstFileId = "60000000-0000-4000-8000-000000000011";
    const secondFileId = "60000000-0000-4000-8000-000000000012";

    const response = await app.inject({
      method: "DELETE",
      url: "/api/v1/embed/session/attachments",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
      payload: { file_ids: [firstFileId, secondFileId] },
    });

    expect(response.statusCode, response.body).toBe(204);
    expect(deleteStagedAttachments).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
      [firstFileId, secondFileId],
      expect.objectContaining({ ipAddress: expect.any(String) }),
    );
  });

  it("reads and updates the active embedded conversation model preference", async () => {
    const {
      app,
      assertModelPreferenceMutable,
      getModelPreference,
      updateModelPreference,
    } = await routeFixture("public");
    const headers = {
      "x-linksense-embed-app-id": APP_ID,
      "x-linksense-embed-session-id": SESSION_ID,
      "x-linksense-embed-origin": ORIGIN,
    };

    const readResponse = await app.inject({
      method: "GET",
      url: "/api/v1/embed/session/model-preference",
      headers,
    });
    expect(readResponse.statusCode, readResponse.body).toBe(200);
    expect(assertModelPreferenceMutable).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
    );
    expect(getModelPreference).toHaveBeenCalledWith(
      OWNER_ID,
      CONVERSATION_ID,
    );

    const updateResponse = await app.inject({
      method: "PUT",
      url: "/api/v1/embed/session/model-preference",
      headers,
      payload: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });
    expect(updateResponse.statusCode, updateResponse.body).toBe(200);
    expect(updateModelPreference).toHaveBeenCalledWith(
      OWNER_ID,
      {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
      expect.any(Object),
      CONVERSATION_ID,
    );
    expect(updateResponse.json()).toMatchObject({
      success: true,
      data: {
        selected_model: "model-b",
        selected_reasoning_effort: "high",
      },
    });
  });

  it("does not allow a public embed session to bind a business session id", async () => {
    const { app, external } = await routeFixture("public");

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/embed/session/external-application-session",
      headers: {
        "x-linksense-embed-app-id": APP_ID,
        "x-linksense-embed-session-id": SESSION_ID,
        "x-linksense-embed-origin": ORIGIN,
      },
      payload: {
        external_application_session_id: "must-not-be-bound",
      },
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      external.updateSessionExternalApplicationSession,
    ).not.toHaveBeenCalled();
  });

  it("binds an external application session through an authenticated embed session", async () => {
    const { app, external } = await routeFixture("required");
    const accessToken = await app.jwt.sign(
      {
        token_use: "application_embed",
        sub: OWNER_ID,
        session_id: SESSION_ID,
        application_id: APPLICATION_ID,
        conversation_id: CONVERSATION_ID,
        external_access_id: "60000000-0000-4000-8000-000000000001",
        origin: ORIGIN,
        credential_version: 1,
        jti: "70000000-0000-4000-8000-000000000001",
      },
      { expiresIn: "1h" },
    );

    const response = await app.inject({
      method: "PUT",
      url: "/api/v1/embed/session/external-application-session",
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        external_application_session_id: "business-session-a",
      },
    });

    expect(response.statusCode, response.body).toBe(204);
    expect(external.updateSessionExternalApplicationSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        ownerId: OWNER_ID,
        applicationId: APPLICATION_ID,
      }),
      "business-session-a",
      expect.any(Object),
    );
  });
});

async function routeFixture(
  authMode: "required" | "public",
  options: {
    developmentAssets?: boolean;
    knowledgeInstalled?: boolean;
    maintenanceActive?: boolean;
  } = {},
) {
  const app = Fastify();
  app.setErrorHandler((error, request, reply) => sendAppError(reply, request, error));
  const getMaintenanceStatus = vi.fn(async () => ({
    enabled: options.maintenanceActive ?? false,
    active: options.maintenanceActive ?? false,
    reason: null,
    start_at: null,
    end_at: null,
  }));
  registerMaintenanceGuard(app, { getMaintenanceStatus });
  apps.push(app);
  await app.register(fastifyJwt, {
    secret: "application-embed-route-test-secret-with-enough-entropy",
  });
  const external = {
    frameConfiguration: vi.fn(async () => ({
      access: { authMode },
      starter_questions: ["How do I apply?"],
      application: {
        id: APPLICATION_ID,
        name: "Partner operations",
        description: "Operate partner workflows.",
        icon: { type: "preset" as const, preset: "bot" },
        allows_user_model_selection: true,
      },
    })),
    createPublicSession: vi.fn(async () => ({
      session_id: SESSION_ID,
      session_expires_at: "2026-08-20T00:00:00.000Z",
    })),
    assertTurnRateLimit: vi.fn(async () => undefined),
    updateSessionExternalApplicationSession: vi.fn(
      async () => undefined,
    ),
    verifyPublicSession: vi.fn(async () => ({
      sessionId: SESSION_ID,
      ownerId: OWNER_ID,
      applicationId: APPLICATION_ID,
      conversationId: CONVERSATION_ID,
      externalAccessId: "60000000-0000-4000-8000-000000000001",
      origin: ORIGIN,
      absoluteExpiresAt: new Date("2026-08-20T00:00:00.000Z"),
    })),
    verifyAccessToken: vi.fn(async () => ({
      sessionId: SESSION_ID,
      ownerId: OWNER_ID,
      applicationId: APPLICATION_ID,
      conversationId: CONVERSATION_ID,
      externalAccessId: "60000000-0000-4000-8000-000000000001",
      origin: ORIGIN,
      absoluteExpiresAt: new Date("2026-08-20T00:00:00.000Z"),
    })),
    listSessionConversations: vi.fn(async () => ({
      items: [
        {
          id: CONVERSATION_ID,
          title: "Partner operations",
          updated_at: "2026-08-13T00:00:00.000Z",
          created_at: "2026-08-13T00:00:00.000Z",
          execution_status: "idle",
          current: true,
        },
      ],
    })),
    createSessionConversation: vi.fn(async () => ({
      session_id: SESSION_ID,
      session_expires_at: "2026-08-20T00:00:00.000Z",
      conversation_id: CONVERSATION_ID,
      access_token: null,
      renewal_token: null,
      access_token_expires_at: null,
      renewal_token_expires_at: null,
    })),
    selectSessionConversation: vi.fn(async () => ({
      session_id: SESSION_ID,
      session_expires_at: "2026-08-20T00:00:00.000Z",
      conversation_id: CONVERSATION_ID,
      access_token: null,
      renewal_token: null,
      access_token_expires_at: null,
      renewal_token_expires_at: null,
    })),
    deleteSessionConversation: vi.fn(async () => ({
      session_id: SESSION_ID,
      session_expires_at: "2026-08-20T00:00:00.000Z",
      conversation_id: CONVERSATION_ID,
      access_token: null,
      renewal_token: null,
      access_token_expires_at: null,
      renewal_token_expires_at: null,
    })),
  };
  const acceptTurn = vi.fn(async () => ({
    turn_id: TURN_ID,
    accepted: true,
    status: "starting",
  }));
  const assertModelPreferenceMutable = vi.fn(async () => undefined);
  const getModelPreference = vi.fn(async () => ({
    configured: true,
    models: [],
    default_model: "model-a",
    selected_model: "model-a",
    selected_reasoning_effort: "medium",
  }));
  const updateModelPreference = vi.fn(
    async (
      _ownerId: string,
      input: {
        selected_model: string;
        selected_reasoning_effort: string;
      },
    ) => ({
      configured: true,
      models: [],
      default_model: "model-a",
      ...input,
    }),
  );
  const deleteStagedAttachments = vi.fn(async () => undefined);
  const assertCanStartTask = vi.fn(async () => undefined);
  const assertVoiceUserAllowed = vi.fn(async () => undefined);
  const assertApplicationEmbedSessionAllowed = vi.fn(async () => undefined);
  const streamVoiceTranscription = vi.fn(async function* () {
    yield "嵌入识别";
  });
  const transcribeVoice = vi.fn(async () => "嵌入识别");
  const getVoiceTranscriptionAvailability = vi.fn(async () => ({
    available: true,
  }));
  const services = {
    applicationExternalAccess: external,
    conversations: { acceptTurn, assertModelPreferenceMutable },
    modelProviderSettings: {
      getPreference: getModelPreference,
      updatePreference: updateModelPreference,
    },
    files: { deleteStagedAttachments },
    tokenLimits: { assertCanStartTask },
    voiceTranscriptionRateLimits: {
      assertAllowed: assertVoiceUserAllowed,
      assertApplicationEmbedSessionAllowed,
    },
    voiceTranscription: {
      stream: streamVoiceTranscription,
      transcribe: transcribeVoice,
    },
    voiceTranscriptionSettings: {
      getAvailability: getVoiceTranscriptionAvailability,
    },
    system: { defaultLocale: "zh-CN" },
    prisma: {},
    knowledge: options.knowledgeInstalled === false ? null : {},
    knowledgeRuntime:
      options.knowledgeInstalled === false ? null : { elasticsearch: {} },
    knowledgeTurnAssets: options.knowledgeInstalled === false ? null : {},
    config: { upload: { maxFileSizeBytes: 1024 } },
  };
  await app.register(applicationEmbedRoutes, {
    prefix: "/api/v1/embed",
    services: services as never,
    developmentAssets: options.developmentAssets ?? false,
  });
  await app.ready();
  return {
    app,
    getMaintenanceStatus,
    external,
    acceptTurn,
    assertModelPreferenceMutable,
    getModelPreference,
    updateModelPreference,
    deleteStagedAttachments,
    assertCanStartTask,
    assertVoiceUserAllowed,
    assertApplicationEmbedSessionAllowed,
    streamVoiceTranscription,
    getVoiceTranscriptionAvailability,
  };
}

function parseNdjson(body: string): unknown[] {
  return body
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}
