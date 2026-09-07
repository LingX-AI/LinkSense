import {
  VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES,
  applicationEmbedAccessTokenClaimsSchema,
  applicationExternalOriginSchema,
  conversationEventSchema,
  conversationUserInputResponseSchema,
  createApplicationEmbedTicketInputSchema,
  createPublicApplicationEmbedSessionInputSchema,
  exchangeApplicationEmbedTicketInputSchema,
  renewApplicationEmbedSessionInputSchema,
  updateModelPreferenceSchema,
  updateApplicationEmbedExternalApplicationSessionInputSchema,
  updateApplicationExternalAccessInputSchema,
  voiceTranscriptionRequestSchema,
} from "@linksense/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  attachmentContentDisposition,
  inlineContentDisposition,
} from "../../lib/content-disposition.js";
import { sseCorsHeaders } from "../../lib/cors.js";
import { AppError } from "../../lib/errors.js";
import { ok, sendAppError } from "../../lib/http.js";
import type { AppServices } from "../../services.js";
import type { RequestActor } from "../capabilities/types.js";
import { KnowledgeCitationReadService } from "../knowledge/citation-read.js";
import { sendVoiceTranscription } from "../voice/http.js";
import type {
  ApplicationEmbedAccessTokenIssuer,
  ApplicationExternalAccessService,
  VerifiedApplicationEmbedSession,
} from "./service.js";

const applicationParams = z.strictObject({ id: z.string().uuid() });
const frameParams = z.strictObject({ appId: z.string().min(16).max(80) });
const fileParams = z.strictObject({ fileId: z.string().uuid() });
const conversationParams = z.strictObject({
  conversationId: z.string().uuid(),
});
const turnParams = z.strictObject({ turnId: z.string().uuid() });
const knowledgeAssetParams = z.strictObject({
  turnId: z.string().uuid(),
  assetId: z.string().uuid(),
});
const citationParams = z.strictObject({ citationId: z.string().uuid() });
const userInputParams = z.strictObject({ requestId: z.string().uuid() });
const parentOriginQuery = z.strictObject({
  parent_origin: z.string().trim().min(1).max(2_048),
  locale: z.unknown().optional(),
});

export const applicationExternalManagementRoutes: FastifyPluginAsync<{
  service: ApplicationExternalAccessService;
}> = async (app, { service }) => {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    return payload;
  });
  app.get("/:id/external-access", async (request, reply) => {
    const actor = managementActor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await service.getManagement(actor, id), request.id));
  });

  app.put("/:id/external-access", async (request, reply) => {
    const actor = managementActor(request);
    const { id } = applicationParams.parse(request.params);
    const result = await service.updateManagement(
      actor,
      id,
      updateApplicationExternalAccessInputSchema.parse(request.body),
      auditContext(request),
    );
    return reply.send(
      ok(
        {
          access: result.access,
          app_secret: result.appSecret,
        },
        request.id,
      ),
    );
  });

  app.post("/:id/external-access/rotate-secret", async (request, reply) => {
    const actor = managementActor(request);
    const { id } = applicationParams.parse(request.params);
    z.strictObject({}).parse(request.body ?? {});
    const result = await service.rotateSecret(
      actor,
      id,
      auditContext(request),
    );
    return reply.send(
      ok(
        { access: result.access, app_secret: result.appSecret },
        request.id,
      ),
    );
  });

};

export const applicationEmbedRoutes: FastifyPluginAsync<{
  services: AppServices;
  developmentAssets: boolean;
}> = async (app, { services, developmentAssets }) => {
  const external = services.applicationExternalAccess;
  const attachmentDeleteBody = z.strictObject({
    file_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(services.config?.upload.maxFilesPerConversation ?? 100),
  });
  const knowledgeServices =
    services.knowledge &&
    services.knowledgeRuntime &&
    services.knowledgeTurnAssets
      ? {
          citations: new KnowledgeCitationReadService(
            services.prisma,
            services.knowledge,
            services.knowledgeRuntime.elasticsearch,
          ),
          turnAssets: services.knowledgeTurnAssets,
        }
      : null;
  const issueAccessToken: ApplicationEmbedAccessTokenIssuer = async (
    claims,
    expiresInSeconds,
  ) => ({
    token: await app.jwt.sign(claims, { expiresIn: expiresInSeconds }),
    expiresAt: new Date(Date.now() + expiresInSeconds * 1_000),
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    return payload;
  });

  app.post("/tickets", async (request, reply) => {
    const body = createApplicationEmbedTicketInputSchema.parse(request.body);
    const ticket = await external.issueAuthenticatedTicket(
      {
        appId: body.app_id,
        appSecret: body.app_secret,
        origin: body.origin,
        ...(body.external_subject
          ? { externalSubject: body.external_subject }
          : {}),
        ...(body.external_tenant ? { externalTenant: body.external_tenant } : {}),
        ...(body.display_name ? { displayName: body.display_name } : {}),
      },
      { ipAddress: request.ip },
    );
    return reply.code(201).send(ok(ticket, request.id));
  });

  app.post("/public-sessions", async (request, reply) => {
    const body = createPublicApplicationEmbedSessionInputSchema.parse(
      request.body,
    );
    const session = await external.createPublicSession(
      body.app_id,
      body.origin,
      { ipAddress: request.ip },
      auditContext(request),
    );
    return reply.code(201).send(ok(session, request.id));
  });

  app.get("/frame/:appId", async (request, reply) => {
    const { appId } = frameParams.parse(request.params);
    const query = parentOriginQuery.parse(request.query);
    const locale = embedLocale(query.locale);
    const frame = await external.frameConfiguration(appId, query.parent_origin);
    const configuration = {
      app_id: appId,
      parent_origin: query.parent_origin,
      auth_mode: frame.access.authMode,
      locale,
      starter_questions: frame.starter_questions,
      application: frame.application,
    };
    const scriptSource = developmentAssets
      ? "/src/embed-main.tsx"
      : "/assets/embed-app.js";
    const developmentPreamble = developmentAssets
      ? `<script type="module">
import RefreshRuntime from "/@react-refresh"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true
</script>`
      : "";
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "private, no-store")
      .header(
        "content-security-policy",
        embedContentSecurityPolicy(
          query.parent_origin,
          developmentAssets,
          frame.application.icon.type === "custom"
            ? new URL(frame.application.icon.url).origin
            : null,
        ),
      )
      .header("referrer-policy", "no-referrer")
      .header(
        "permissions-policy",
        "camera=(), microphone=(self), geolocation=()",
      )
      .send(`<!doctype html>
<html lang="${locale}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${escapeHtml(frame.application.name)}</title>
    ${developmentAssets ? "" : '<link rel="stylesheet" href="/assets/embed-app.css" />'}
  </head>
  <body>
    <div id="embed-root" data-embed-config="${escapeHtml(JSON.stringify(configuration))}"></div>
    ${developmentPreamble}
    <script type="module" src="${scriptSource}"></script>
  </body>
</html>`);
  });

  app.post("/sessions/exchange", async (request, reply) => {
    const body = exchangeApplicationEmbedTicketInputSchema.parse(request.body);
    const tokens = await external.exchangeTicket(
      body.ticket,
      body.origin,
      issueAccessToken,
      auditContext(request),
    );
    return reply.code(201).send(ok(tokens, request.id));
  });

  app.post("/sessions/renew", async (request, reply) => {
    const body = renewApplicationEmbedSessionInputSchema.parse(request.body);
    const tokens = await external.renewSession(
      body.renewal_token,
      body.renewal_request_id,
      body.origin,
      issueAccessToken,
      auditContext(request),
    );
    return reply.send(ok(tokens, request.id));
  });

  app.get("/session", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const conversation = await services.conversations.get(
      session.ownerId,
      session.conversationId,
    );
    return reply.send(
      ok(
        {
          session_id: session.sessionId,
          session_expires_at: session.absoluteExpiresAt.toISOString(),
          conversation,
        },
        request.id,
      ),
    );
  });

  app.put(
    "/session/external-application-session",
    async (request, reply) => {
      const authenticated = await authenticateEmbedRequest(request, external);
      if (authenticated.mode !== "token") {
        throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
      }
      const body =
        updateApplicationEmbedExternalApplicationSessionInputSchema.parse(
          request.body,
        );
      await external.updateSessionExternalApplicationSession(
        authenticated.session,
        body.external_application_session_id,
        auditContext(request),
      );
      return reply.code(204).send();
    },
  );

  app.get("/session/conversations", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    return reply.send(
      ok(await external.listSessionConversations(session), request.id),
    );
  });

  app.get("/session/model-preference", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    await services.conversations.assertModelPreferenceMutable(
      session.ownerId,
      session.conversationId,
    );
    return reply.send(
      ok(
        await services.modelProviderSettings.getPreference(
          session.ownerId,
          session.conversationId,
        ),
        request.id,
      ),
    );
  });

  app.put("/session/model-preference", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    await services.conversations.assertModelPreferenceMutable(
      session.ownerId,
      session.conversationId,
    );
    return reply.send(
      ok(
        await services.modelProviderSettings.updatePreference(
          session.ownerId,
          updateModelPreferenceSchema.parse(request.body),
          auditContext(request),
          session.conversationId,
        ),
        request.id,
      ),
    );
  });

  app.post("/session/conversations", async (request, reply) => {
    const { mode, session } = await authenticateEmbedRequest(request, external);
    z.strictObject({}).parse(request.body ?? {});
    const result = await external.createSessionConversation(
      session,
      mode === "token" ? issueAccessToken : null,
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.post(
    "/session/conversations/:conversationId/select",
    async (request, reply) => {
      const { mode, session } = await authenticateEmbedRequest(
        request,
        external,
      );
      const { conversationId } = conversationParams.parse(request.params);
      z.strictObject({}).parse(request.body ?? {});
      const result = await external.selectSessionConversation(
        session,
        conversationId,
        mode === "token" ? issueAccessToken : null,
      );
      return reply.send(ok(result, request.id));
    },
  );

  app.delete(
    "/session/conversations/:conversationId",
    async (request, reply) => {
      const { mode, session } = await authenticateEmbedRequest(
        request,
        external,
      );
      const { conversationId } = conversationParams.parse(request.params);
      const result = await external.deleteSessionConversation(
        session,
        conversationId,
        mode === "token" ? issueAccessToken : null,
        auditContext(request),
      );
      return reply.send(ok(result, request.id));
    },
  );

  app.post("/session/turns", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    await external.assertTurnRateLimit(session.sessionId, request.ip);
    const body = z
      .strictObject({
        input_text: z.string().max(1_000_000),
        idempotency_key: z.string().trim().min(1).max(120).optional(),
      })
      .parse(request.body);
    const result = await services.conversations.acceptTurn(
      session.ownerId,
      session.conversationId,
      {
        inputText: body.input_text,
        priorityCapabilityIds: [],
        knowledgeBaseIds: [],
        collaborationMode: "default",
        submitMode: "normal",
        preserveStagedAttachments: true,
        ...(body.idempotency_key
          ? { idempotencyKey: body.idempotency_key }
          : {}),
      },
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post(
    "/session/voice/transcriptions",
    { bodyLimit: VOICE_TRANSCRIPTION_REQUEST_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const { mode, session } = await authenticateEmbedRequest(
        request,
        external,
      );
      await services.tokenLimits.assertCanStartTask(session.ownerId);
      const body = voiceTranscriptionRequestSchema.parse(request.body);

      try {
        if (mode === "public") {
          await services.voiceTranscriptionRateLimits.assertApplicationEmbedSessionAllowed(
            session.sessionId,
          );
        } else {
          await services.voiceTranscriptionRateLimits.assertAllowed(
            session.ownerId,
          );
        }
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "VOICE_TRANSCRIPTION_RATE_LIMITED"
        ) {
          const retryAfterSeconds = Number(error.params?.retry_after_seconds);
          if (
            Number.isSafeInteger(retryAfterSeconds) &&
            retryAfterSeconds > 0
          ) {
            reply.header("retry-after", String(retryAfterSeconds));
          }
          return sendAppError(
            reply,
            request,
            error,
            body.language ?? null,
          );
        }
        throw error;
      }

      return sendVoiceTranscription({
        request,
        reply,
        body,
        service: services.voiceTranscription,
        defaultLocale: services.system.defaultLocale,
        preferredLocale: body.language ?? null,
      });
    },
  );

  app.get("/session/voice/transcriptions/status", async (request, reply) => {
    await authenticateEmbedRequest(request, external);
    return reply.send(
      ok(
        await services.voiceTranscriptionSettings.getAvailability(),
        request.id,
      ),
    );
  });

  app.post("/session/turns/:turnId/interrupt", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { turnId } = turnParams.parse(request.params);
    const result = await services.conversations.interrupt(
      session.ownerId,
      session.conversationId,
      turnId,
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post(
    "/session/user-input-requests/:requestId/respond",
    async (request, reply) => {
      const { session } = await authenticateEmbedRequest(request, external);
      const { requestId } = userInputParams.parse(request.params);
      const body = conversationUserInputResponseSchema.parse(request.body);
      const result = await services.conversations.respondToUserInputRequest(
        session.ownerId,
        session.conversationId,
        requestId,
        body,
        auditContext(request),
      );
      return reply.send(ok(result, request.id));
    },
  );

  app.get("/session/events/history", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const query = z
      .strictObject({
        after_sequence: z.coerce.bigint().nonnegative().default(0n),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);
    const page = await services.events.historyPage(
      session.ownerId,
      session.conversationId,
      { afterSequence: query.after_sequence, limit: query.limit },
    );
    return reply.send(
      ok(
        {
          items: page.items,
          next_cursor: page.next_cursor,
          confirmed_sequence: page.confirmed_sequence.toString(),
        },
        request.id,
      ),
    );
  });

  app.get("/session/events", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const lastEventId = request.headers["last-event-id"];
    const query = z
      .strictObject({
        last_event_id: z.string().max(160).optional(),
      })
      .parse(request.query);
    const after =
      parseEventSequence(
        session.conversationId,
        typeof lastEventId === "string" ? lastEventId : query.last_event_id,
      ) ?? 0n;
    const subscriber = services.redis.duplicate();
    await subscriber.connect();

    const channel = `linksense:conversation-events:${session.conversationId}`;
    let lastWrittenSequence = after;
    let observedSequence = after;
    let confirmedSequence = after;
    let replayGapRetryAttempt = 0;
    let pumping = false;
    let closed = false;
    let streamReady = false;
    let heartbeat: NodeJS.Timeout | null = null;
    const response = reply.raw;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      void closeEventSubscriber(subscriber, channel);
    };

    const closeForReplay = () => {
      cleanup();
      if (!response.destroyed) response.destroy();
    };

    const pump = async () => {
      if (pumping || closed) return;
      pumping = true;
      try {
        while (!closed) {
          const previousLastWrittenSequence = lastWrittenSequence;
          const previousConfirmedSequence = confirmedSequence;
          const page = await services.events.historyPage(
            session.ownerId,
            session.conversationId,
            {
              afterSequence: lastWrittenSequence,
              limit: EMBED_SSE_HISTORY_PAGE_SIZE,
            },
          );
          if (page.confirmed_sequence > confirmedSequence) {
            confirmedSequence = page.confirmed_sequence;
          }
          for (const event of page.items) {
            const sequence = BigInt(event.sequence_no);
            if (sequence <= lastWrittenSequence) continue;
            const written = await writeEmbedEvent(response, event);
            if (!written) return;
            lastWrittenSequence = sequence;
          }
          if (
            lastWrittenSequence > previousLastWrittenSequence ||
            confirmedSequence > previousConfirmedSequence
          ) {
            replayGapRetryAttempt = 0;
          }
          if (page.next_cursor) continue;
          if (lastWrittenSequence >= observedSequence) return;
          const retryDelay =
            EMBED_SSE_REPLAY_GAP_RETRY_DELAYS_MS[replayGapRetryAttempt];
          if (retryDelay !== undefined) {
            replayGapRetryAttempt += 1;
            await waitForEmbedReplayProjection(retryDelay);
            continue;
          }
          if (confirmedSequence < observedSequence) {
            request.log.warn(
              {
                conversationId: session.conversationId,
                lastWrittenSequence: lastWrittenSequence.toString(),
                observedSequence: observedSequence.toString(),
                confirmedSequence: confirmedSequence.toString(),
              },
              "embed conversation SSE replay projection remained behind",
            );
            closeForReplay();
          }
          return;
        }
      } catch (error) {
        request.log.warn(
          { err: error, conversationId: session.conversationId },
          "embed conversation SSE replay failed",
        );
        closeForReplay();
      } finally {
        pumping = false;
        if (
          !closed &&
          observedSequence > lastWrittenSequence &&
          observedSequence > confirmedSequence
        ) {
          void pump();
        }
      }
    };

    const onMessage = (_channel: string, value: string) => {
      try {
        const parsed = conversationEventSchema.safeParse(JSON.parse(value));
        if (
          !parsed.success ||
          parsed.data.conversation_id !== session.conversationId
        ) {
          return;
        }
        const sequence = BigInt(parsed.data.sequence_no);
        if (sequence > observedSequence) observedSequence = sequence;
        if (streamReady) void pump();
      } catch {
        // Ignore malformed fan-out data; persisted events remain replayable.
      }
    };
    subscriber.on("message", onMessage);
    await subscriber.subscribe(channel);

    reply.hijack();
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...sseCorsHeaders(
        request.headers.origin,
        services.config.publicBaseUrl,
      ),
    });
    response.flushHeaders();
    streamReady = true;
    heartbeat = setInterval(() => {
      if (!response.writableNeedDrain && !response.destroyed) {
        response.write(": keepalive\n\n");
      }
    }, 15_000);
    heartbeat.unref();
    response.once("close", cleanup);
    void pump();
  });

  if (knowledgeServices) {
    app.get(
      "/session/turns/:turnId/knowledge-assets/:assetId",
      async (request, reply) => {
        const { session } = await authenticateEmbedRequest(request, external);
        const { turnId, assetId } = knowledgeAssetParams.parse(request.params);
        const asset = await knowledgeServices.turnAssets.getAsset(
          {
            id: session.ownerId,
            role: "user",
            status: "active",
            ipAddress: request.ip,
            ...(request.headers["user-agent"]
              ? { userAgent: request.headers["user-agent"] }
              : {}),
          },
          session.conversationId,
          turnId,
          assetId,
        );
        reply.raw.once("close", () => asset.stream.destroy());
        return reply
          .header("cache-control", "private, no-store")
          .header("content-security-policy", "default-src 'none'; sandbox")
          .header("content-length", asset.sizeBytes.toString())
          .header(
            "content-disposition",
            inlineContentDisposition(asset.filename),
          )
          .type(asset.mimeType)
          .send(asset.stream);
      },
    );

    app.get(
      "/session/knowledge-citations/:citationId",
      async (request, reply) => {
        const { session } = await authenticateEmbedRequest(request, external);
        const { citationId } = citationParams.parse(request.params);
        const citation =
          await knowledgeServices.citations.resolveForApplicationTurn(
            {
              id: session.ownerId,
              role: "user",
              status: "active",
              ipAddress: request.ip,
              ...(request.headers["user-agent"]
                ? { userAgent: request.headers["user-agent"] }
                : {}),
            },
            citationId,
            async ({ turnId, knowledgeBaseId }) =>
              (
                await services.applications.resolveUsableKnowledgeBaseIdsForTurn(
                  session.ownerId,
                  { turnId },
                  [knowledgeBaseId],
                )
              ).includes(knowledgeBaseId),
          );
        return reply
          .header("cache-control", "private, no-store")
          .send(ok(citation, request.id));
      },
    );
  }

  app.post("/session/attachments", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const part = await request.file({
      limits: { fileSize: services.config.upload.maxFileSizeBytes, files: 1 },
    });
    if (!part) throw new AppError("ATTACHMENT_UPLOAD_INVALID");
    const result = await services.files.uploadAttachment(
      session.ownerId,
      session.conversationId,
      {
        filename: part.filename,
        reportedMimeType: part.mimetype,
        data: await part.toBuffer(),
      },
      auditContext(request),
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.delete("/session/attachments/:fileId", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { fileId } = fileParams.parse(request.params);
    await services.files.deleteStagedAttachment(
      session.ownerId,
      session.conversationId,
      fileId,
      auditContext(request),
    );
    return reply.code(204).send();
  });

  app.delete("/session/attachments", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { file_ids: fileIds } = attachmentDeleteBody.parse(request.body);
    await services.files.deleteStagedAttachments(
      session.ownerId,
      session.conversationId,
      fileIds,
      auditContext(request),
    );
    return reply.code(204).send();
  });

  app.get("/session/attachments/:fileId/content", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { fileId } = fileParams.parse(request.params);
    const preview = await services.files.readAttachmentPreviewContent(
      session.ownerId,
      session.conversationId,
      fileId,
    );
    return reply
      .type(preview.mimeType)
      .header("cache-control", "private, no-store")
      .header("content-length", preview.sizeBytes)
      .header(
        "content-security-policy",
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
      )
      .header("content-disposition", inlineContentDisposition(preview.filename))
      .send(preview.data);
  });

  app.get("/session/files/:fileId/content", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { fileId } = fileParams.parse(request.params);
    const document = await services.files.readArtifactPreviewDocument(
      session.ownerId,
      session.conversationId,
      fileId,
    );
    reply.raw.once("close", () => document.data.destroy());
    return reply
      .type(document.mimeType)
      .header("cache-control", "private, no-store")
      .header("content-length", document.sizeBytes)
      .header(
        "content-security-policy",
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:",
      )
      .header("content-disposition", inlineContentDisposition(document.filename))
      .send(document.data);
  });

  app.get("/session/files/:fileId/download", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    const { fileId } = fileParams.parse(request.params);
    const artifact = await services.files.readArtifactDownload(
      session.ownerId,
      session.conversationId,
      fileId,
      auditContext(request),
    );
    reply.raw.once("close", () => artifact.data.destroy());
    return reply
      .type(artifact.mimeType)
      .header("cache-control", "private, no-store")
      .header("content-length", artifact.sizeBytes)
      .header(
        "content-disposition",
        attachmentContentDisposition(artifact.filename),
      )
      .send(artifact.data);
  });

  app.post("/session/logout", async (request, reply) => {
    const { session } = await authenticateEmbedRequest(request, external);
    await external.revokeSession(session, auditContext(request));
    return reply.code(204).send();
  });
};

function embedLocale(value: unknown): "zh-CN" | "en-US" {
  return value === "en-US" ? "en-US" : "zh-CN";
}

async function authenticateEmbedRequest(
  request: FastifyRequest,
  service: ApplicationExternalAccessService,
): Promise<{
  mode: "public" | "token";
  session: VerifiedApplicationEmbedSession;
}> {
  if (!request.headers.authorization?.match(/^Bearer\s+\S+$/u)) {
    const headers = z
      .object({
        "x-linksense-embed-app-id": z.string().min(16).max(80),
        "x-linksense-embed-session-id": z.string().uuid(),
        "x-linksense-embed-origin": applicationExternalOriginSchema,
      })
      .passthrough()
      .safeParse(request.headers);
    if (!headers.success) {
      throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
    }
    return {
      mode: "public",
      session: await service.verifyPublicSession(
        headers.data["x-linksense-embed-app-id"],
        headers.data["x-linksense-embed-session-id"],
        headers.data["x-linksense-embed-origin"],
      ),
    };
  }
  let claims;
  try {
    claims = applicationEmbedAccessTokenClaimsSchema.parse(
      await request.jwtVerify(),
    );
  } catch {
    throw new AppError("APPLICATION_EMBED_SESSION_EXPIRED");
  }
  return {
    mode: "token",
    session: await service.verifyAccessToken(claims),
  };
}

const EMBED_SSE_HISTORY_PAGE_SIZE = 250;
const EMBED_SSE_REPLAY_GAP_RETRY_DELAYS_MS = [25, 50, 100, 200, 400] as const;

function waitForEmbedReplayProjection(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref();
  });
}

function parseEventSequence(
  conversationId: string,
  eventId?: string,
): bigint | null {
  if (!eventId) return 0n;
  const prefix = `${conversationId}:`;
  if (!eventId.startsWith(prefix)) return null;
  const value = eventId.slice(prefix.length);
  if (!/^\d+$/u.test(value)) return null;
  try {
    const sequence = BigInt(value);
    return sequence >= 0n ? sequence : null;
  } catch {
    return null;
  }
}

async function writeEmbedEvent(
  response: {
    destroyed: boolean;
    write(chunk: string): boolean;
    once(event: "drain" | "close", listener: () => void): unknown;
    off(event: "drain" | "close", listener: () => void): unknown;
  },
  event: {
    sse_event_id: string;
    event_type: string;
  },
): Promise<boolean> {
  if (response.destroyed) return false;
  const accepted = response.write(
    `id: ${event.sse_event_id}\nevent: ${event.event_type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
  if (accepted) return true;
  return new Promise<boolean>((resolve) => {
    const settle = (written: boolean) => {
      response.off("drain", onDrain);
      response.off("close", onClose);
      resolve(written);
    };
    const onDrain = () => settle(!response.destroyed);
    const onClose = () => settle(false);
    response.once("drain", onDrain);
    response.once("close", onClose);
  });
}

async function closeEventSubscriber(
  subscriber: {
    unsubscribe(channel: string): Promise<unknown>;
    quit(): Promise<unknown>;
  },
  channel: string,
): Promise<void> {
  await subscriber.unsubscribe(channel).catch(() => undefined);
  await subscriber.quit().catch(() => undefined);
}

function managementActor(request: FastifyRequest): RequestActor {
  const user = request.authUser;
  if (!user) throw new AppError("AUTH_REQUIRED");
  return {
    id: user.id,
    role: user.role,
    status: user.status,
    ipAddress: request.ip,
    ...(request.headers["user-agent"]
      ? { userAgent: request.headers["user-agent"] }
      : {}),
  };
}

function auditContext(request: FastifyRequest) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}

function embedContentSecurityPolicy(
  origin: string,
  development: boolean,
  imageOrigin: string | null,
) {
  return [
    "default-src 'self'",
    development
      ? "script-src 'self' 'unsafe-eval' 'unsafe-inline'"
      : "script-src 'self'",
    "connect-src 'self'",
    `img-src 'self' data: blob:${imageOrigin ? ` ${imageOrigin}` : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "frame-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${origin}`,
  ].join("; ");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
