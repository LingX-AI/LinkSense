import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import {
  conversationShareCreateSchema,
  conversationCollaborationModeSchema,
  conversationHistoryQuerySchema,
  conversationSourcesSchema,
  conversationOrderUpdateSchema,
  conversationUserInputResponseSchema,
  knowledgeBaseIdsSchema,
  officeAnnotationInputSchema,
  interactiveApplicationMessageSourceSchema,
  priorityCapabilityIdsSchema,
  updateModelPreferenceSchema,
} from "@linksense/shared";

import { ok } from "../../lib/http.js";
import { resolveLocale } from "../../lib/locale.js";
import { MAX_CONVERSATION_TITLE_CHARACTERS } from "../../lib/conversation-title.js";
import type { AuthenticatedRequest } from "../../plugins/authentication.js";
import type { AppServices } from "../../services.js";
import { parseConversationCursor } from "./service.js";

const uuidParamsSchema = z.strictObject({ id: z.string().uuid() });
const turnParamsSchema = z.strictObject({
  id: z.string().uuid(),
  turnId: z.string().uuid(),
});
const subAgentParamsSchema = turnParamsSchema.extend({
  agentKey: z.string().regex(/^agent_[A-Za-z0-9_-]{24}$/u),
});
const messageParamsSchema = z.strictObject({
  id: z.string().uuid(),
  messageId: z.string().uuid(),
});
const pendingParamsSchema = z.strictObject({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
});
const userInputParamsSchema = z.strictObject({
  id: z.string().uuid(),
  requestId: z.string().uuid(),
});
const planReviewParamsSchema = z.strictObject({
  id: z.string().uuid(),
  reviewId: z.string().uuid(),
});
const pendingRequestOrderBodySchema = z.strictObject({
  request_ids: z
    .array(z.string().uuid())
    .min(2)
    .max(5)
    .refine((ids) => new Set(ids).size === ids.length, "duplicate_request_id"),
});
const contextCompactionBodySchema = z.strictObject({
  idempotency_key: z.string().trim().min(1).max(120),
});
const priorityIds = priorityCapabilityIdsSchema.default([]);
const inputText = z.string().max(1_000_000);
const planReviewActionBodySchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("implement"),
    idempotency_key: z.string().trim().min(1).max(120),
  }),
  z.strictObject({
    action: z.literal("revise"),
    feedback: inputText.trim().min(1),
    idempotency_key: z.string().trim().min(1).max(120),
  }),
  z.strictObject({ action: z.literal("skip") }),
  z.strictObject({ action: z.literal("exit") }),
]);
const turnSubmissionFields = {
  collaboration_mode: conversationCollaborationModeSchema.default("default"),
  priority_capability_ids: priorityIds,
  knowledge_base_ids: knowledgeBaseIdsSchema.default([]),
  idempotency_key: z.string().trim().min(1).max(120).optional(),
  submit_mode: z.enum(["normal", "manual_retry"]).default("normal"),
};
const turnSubmissionBodySchema = z.union([
  z.strictObject({
    input_text: inputText,
    message_source: interactiveApplicationMessageSourceSchema.optional(),
    ...turnSubmissionFields,
  }),
  z.strictObject({
    message_display: officeAnnotationInputSchema,
    ...turnSubmissionFields,
  }),
]);
const pendingRequestFields = {
  collaboration_mode: conversationCollaborationModeSchema.default("default"),
  priority_capability_ids: priorityIds,
  knowledge_base_ids: knowledgeBaseIdsSchema.default([]),
  idempotency_key: z.string().trim().min(1).max(120).optional(),
};
const goalTokenBudgetSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER)
  .nullable();
const goalStartBodySchema = z.strictObject({
  objective: z.string().trim().min(1).max(4_000),
  token_budget: goalTokenBudgetSchema.optional(),
  priority_capability_ids: priorityIds,
  knowledge_base_ids: knowledgeBaseIdsSchema.default([]),
  idempotency_key: z.string().trim().min(1).max(120).optional(),
});
const goalUpdateBodySchema = z
  .strictObject({
    objective: z.string().trim().min(1).max(4_000).optional(),
    token_budget: goalTokenBudgetSchema.optional(),
    status: z
      .enum(["paused", "blocked", "usageLimited", "complete"])
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0);
const pendingRequestBodySchema = z.union([
  z.strictObject({
    input_text: inputText,
    ...pendingRequestFields,
  }),
  z.strictObject({
    message_display: officeAnnotationInputSchema,
    ...pendingRequestFields,
  }),
]);
const archivedQuery = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");
const prewarmBodySchema = z.strictObject({
  conversation_id: z.string().uuid().optional(),
  collaboration_mode: conversationCollaborationModeSchema.default("default"),
});

export const conversationRoutes: FastifyPluginAsync<{
  services: AppServices;
}> = async (app, { services }) => {
  app.addHook("preHandler", app.authenticate);

  app.post("/prewarm", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const body = prewarmBodySchema.parse(request.body ?? {});
    const receipt = await services.conversations.prewarm(user.id, {
      ...(body.conversation_id
        ? { conversationId: body.conversation_id }
        : {}),
      collaborationMode: body.collaboration_mode,
    });
    return reply.code(202).send(ok(receipt, request.id));
  });

  app.get("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const query = z
      .strictObject({
        search: z.string().trim().max(240).optional(),
        archived: archivedQuery,
        cursor: z
          .string()
          .trim()
          .min(1)
          .max(320)
          .refine(
            (value) => parseConversationCursor(value) !== null,
            "invalid_cursor",
          )
          .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(30),
      })
      .parse(request.query);
    return reply.send(
      ok(
        await services.conversations.list(user.id, {
          ...(query.search ? { search: query.search } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          archived: query.archived,
          limit: query.limit,
        }),
        request.id,
      ),
    );
  });

  app.post("/", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const body = z
      .strictObject({
        collaboration_mode: conversationCollaborationModeSchema.default(
          "default",
        ),
        prewarmed_conversation_id: z.string().uuid().optional(),
        project_id: z.string().uuid().nullable().optional(),
      })
      .parse(request.body);
    const result = await services.conversations.create(user.id, {
      collaborationMode: body.collaboration_mode,
      ...(body.project_id !== undefined ? { projectId: body.project_id } : {}),
      ...(body.prewarmed_conversation_id
        ? { prewarmedConversationId: body.prewarmed_conversation_id }
        : {}),
      fallbackLocale: resolveLocale(
        request,
        user.preferredLocale,
        services.system.defaultLocale,
      ),
    });
    return reply.code(201).send(ok(result, request.id));
  });

  app.delete("/archived", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    return reply.send(
      ok(
        await services.conversations.clearArchived(
          user.id,
          auditContext(request),
        ),
        request.id,
      ),
    );
  });

  app.put("/order", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const body = conversationOrderUpdateSchema.parse(request.body);
    return reply.send(
      ok(
        await services.conversations.reorder(user.id, {
          group: body.group,
          ...(body.project_id !== undefined ? { projectId: body.project_id } : {}),
          conversationIds: body.conversation_ids,
        }),
        request.id,
      ),
    );
  });

  app.get("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const query = conversationHistoryQuerySchema.parse(request.query);
    return reply.send(
      ok(await services.conversations.get(user.id, id, query), request.id),
    );
  });

  app.get("/:id/sources", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const sources = await services.conversations.getReferencedSources(user.id, id);
    return reply.send(ok(conversationSourcesSchema.parse(sources), request.id));
  });

  app.post("/:id/share", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const input = conversationShareCreateSchema.parse(request.body);
    return reply
      .code(201)
      .send(
        ok(
          await services.conversationShares.create(user.id, id, input),
          request.id,
        ),
      );
  });

  app.get("/:id/model-preference", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    return reply.send(
      ok(
        await services.modelProviderSettings.getPreference(user.id, id),
        request.id,
      ),
    );
  });

  app.put("/:id/model-preference", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    await services.conversations.assertModelPreferenceMutable(user.id, id);
    const preference = await services.modelProviderSettings.updatePreference(
      user.id,
      updateModelPreferenceSchema.parse(request.body),
      auditContext(request),
      id,
    );
    return reply.send(ok(preference, request.id));
  });

  app.patch("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = z
      .strictObject({
        title: z
          .string()
          .trim()
          .min(1)
          .max(MAX_CONVERSATION_TITLE_CHARACTERS)
          .optional(),
        archive_status: z.enum(["active", "archived"]).optional(),
        pinned: z.boolean().optional(),
        completion_read: z.literal(true).optional(),
        project_id: z.string().uuid().nullable().optional(),
        collaboration_mode: conversationCollaborationModeSchema.optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body);
    return reply.send(
      ok(
        await services.conversations.patch(user.id, id, {
          ...(body.title ? { title: body.title } : {}),
          ...(body.archive_status
            ? { archiveStatus: body.archive_status }
            : {}),
          ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
          ...(body.project_id !== undefined ? { projectId: body.project_id } : {}),
          ...(body.completion_read ? { completionRead: true } : {}),
          ...(body.collaboration_mode
            ? { collaborationMode: body.collaboration_mode }
            : {}),
        }),
        request.id,
      ),
    );
  });

  app.delete("/:id", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    await services.conversations.delete(user.id, id, auditContext(request));
    return reply.code(204).send();
  });

  app.post("/:id/turns", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = turnSubmissionBodySchema.parse(request.body);
    const result = await services.conversations.acceptTurn(
      user.id,
      id,
      {
        priorityCapabilityIds: body.priority_capability_ids,
        collaborationMode: body.collaboration_mode,
        knowledgeBaseIds: body.knowledge_base_ids,
        ...(body.idempotency_key
          ? { idempotencyKey: body.idempotency_key }
          : {}),
        ...("message_display" in body
          ? body.message_display.kind === "presentation_annotation"
            ? { presentationAnnotation: body.message_display }
            : { officeAnnotation: body.message_display }
          : {
              inputText: body.input_text,
              ...(body.message_source
                ? { messageSource: body.message_source }
                : {}),
            }),
        submitMode: body.submit_mode,
      },
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post("/:id/compact", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = contextCompactionBodySchema.parse(request.body);
    const result = await services.conversations.acceptCompaction(
      user.id,
      id,
      body.idempotency_key,
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post("/:id/goal", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = goalStartBodySchema.parse(request.body);
    const result = await services.conversations.acceptGoal(
      user.id,
      id,
      {
        objective: body.objective,
        ...(body.token_budget !== undefined
          ? { tokenBudget: body.token_budget }
          : {}),
        priorityCapabilityIds: body.priority_capability_ids,
        knowledgeBaseIds: body.knowledge_base_ids,
        ...(body.idempotency_key
          ? { idempotencyKey: body.idempotency_key }
          : {}),
      },
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.get("/:id/goal", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    return reply.send(
      ok(await services.conversations.getGoal(user.id, id), request.id),
    );
  });

  app.patch("/:id/goal", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = goalUpdateBodySchema.parse(request.body);
    return reply.send(
      ok(
        await services.conversations.updateGoal(
          user.id,
          id,
          {
            ...(body.objective !== undefined
              ? { objective: body.objective }
              : {}),
            ...(body.token_budget !== undefined
              ? { tokenBudget: body.token_budget }
              : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
          },
          auditContext(request),
        ),
        request.id,
      ),
    );
  });

  app.post("/:id/goal/resume", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const result = await services.conversations.resumeGoal(
      user.id,
      id,
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.delete("/:id/goal", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    return reply.send(
      ok(
        await services.conversations.clearGoal(
          user.id,
          id,
          auditContext(request),
        ),
        request.id,
      ),
    );
  });

  app.post("/:id/messages/:messageId/regenerate", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, messageId } = messageParamsSchema.parse(request.params);
    const body = z
      .strictObject({
        input_text: z.string().trim().min(1).max(1_000_000),
        idempotency_key: z.string().uuid(),
      })
      .parse(request.body);
    const result = await services.conversations.acceptRegeneration(
      user.id,
      id,
      messageId,
      {
        inputText: body.input_text,
        idempotencyKey: body.idempotency_key,
      },
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post("/:id/messages/:messageId/fork", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, messageId } = messageParamsSchema.parse(request.params);
    const body = z
      .strictObject({ idempotency_key: z.string().uuid() })
      .parse(request.body);
    const result = await services.conversations.forkConversationAtMessage(
      user.id,
      id,
      messageId,
      body.idempotency_key,
      auditContext(request),
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.post("/:id/turns/:turnId/steer", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, turnId } = turnParamsSchema.parse(request.params);
    const body = z
      .strictObject({
        text: inputText.min(1),
        idempotency_key: z.string().uuid(),
      })
      .parse(request.body);
    return reply.send(
      ok(
        await services.conversations.steer(
          user.id,
          id,
          turnId,
          body.text,
          body.idempotency_key,
          auditContext(request),
        ),
        request.id,
      ),
    );
  });

  app.post("/:id/turns/:turnId/interrupt", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, turnId } = turnParamsSchema.parse(request.params);
    return reply
      .code(202)
      .send(
        ok(
          await services.conversations.interrupt(
            user.id,
            id,
            turnId,
            auditContext(request),
          ),
          request.id,
        ),
      );
  });

  app.post(
    "/:id/user-input-requests/:requestId/respond",
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, requestId } = userInputParamsSchema.parse(request.params);
      const body = conversationUserInputResponseSchema.parse(request.body);
      return reply.send(
        ok(
          await services.conversations.respondToUserInputRequest(
            user.id,
            id,
            requestId,
            body,
            auditContext(request),
          ),
          request.id,
        ),
      );
    },
  );

  app.post(
    "/:id/plan-reviews/:reviewId/actions",
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, reviewId } = planReviewParamsSchema.parse(request.params);
      const body = planReviewActionBodySchema.parse(request.body);
      const result = await services.conversations.actOnPlanReview(
        user.id,
        id,
        reviewId,
        body.action === "implement"
          ? {
              action: body.action,
              idempotencyKey: body.idempotency_key,
            }
          : body.action === "revise"
            ? {
                action: body.action,
                feedback: body.feedback,
                idempotencyKey: body.idempotency_key,
              }
            : { action: body.action },
        auditContext(request),
      );
      return reply
        .code(body.action === "implement" || body.action === "revise" ? 202 : 200)
        .send(ok(result, request.id));
    },
  );

  app.get("/:id/turns/:turnId/subagents/:agentKey", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, turnId, agentKey } = subAgentParamsSchema.parse(request.params);
    return reply.send(
      ok(
        await services.conversations.getSubAgentDetail(
          user.id,
          id,
          turnId,
          agentKey,
        ),
        request.id,
      ),
    );
  });

  app.get("/:id/turns/:turnId/subagents", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, turnId } = turnParamsSchema.parse(request.params);
    return reply.send(
      ok(
        await services.conversations.getSubAgentSummaries(
          user.id,
          id,
          turnId,
        ),
        request.id,
      ),
    );
  });

  app.get("/:id/pending-requests", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const detail = await services.conversations.get(user.id, id);
    return reply.send(ok({ items: detail.pending_requests }, request.id));
  });

  app.post("/:id/pending-requests", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = pendingRequestBodySchema.parse(request.body);
    const submission =
      "message_display" in body
        ? body.message_display.kind === "presentation_annotation"
          ? {
              presentationAnnotation: body.message_display,
              preserveStagedAttachments: true,
              priorityCapabilityIds: body.priority_capability_ids,
              collaborationMode: body.collaboration_mode,
              knowledgeBaseIds: body.knowledge_base_ids,
              ...(body.idempotency_key
                ? { idempotencyKey: body.idempotency_key }
                : {}),
            }
          : {
              officeAnnotation: body.message_display,
              preserveStagedAttachments: true,
              priorityCapabilityIds: body.priority_capability_ids,
              collaborationMode: body.collaboration_mode,
              knowledgeBaseIds: body.knowledge_base_ids,
              ...(body.idempotency_key
                ? { idempotencyKey: body.idempotency_key }
                : {}),
            }
        : {
            inputText: body.input_text,
            priorityCapabilityIds: body.priority_capability_ids,
            collaborationMode: body.collaboration_mode,
            knowledgeBaseIds: body.knowledge_base_ids,
            ...(body.idempotency_key
              ? { idempotencyKey: body.idempotency_key }
              : {}),
          };
    const result = await services.conversations.createPending(
      user.id,
      id,
      submission,
      auditContext(request),
    );
    return reply.code(201).send(ok(result, request.id));
  });

  app.put("/:id/pending-requests/order", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id } = uuidParamsSchema.parse(request.params);
    const body = pendingRequestOrderBodySchema.parse(request.body);
    await services.conversations.reorderPending(
      user.id,
      id,
      body.request_ids,
      auditContext(request),
    );
    return reply.code(204).send();
  });

  app.post("/:id/pending-requests/:requestId/start", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, requestId } = pendingParamsSchema.parse(request.params);
    const result = await services.conversations.startPending(
      user.id,
      id,
      requestId,
      auditContext(request),
    );
    return reply.code(202).send(ok(result, request.id));
  });

  app.post("/:id/pending-requests/:requestId/steer", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, requestId } = pendingParamsSchema.parse(request.params);
    return reply.send(
      ok(
        await services.conversations.steerPending(
          user.id,
          id,
          requestId,
          auditContext(request),
        ),
        request.id,
      ),
    );
  });

  app.delete("/:id/pending-requests/:requestId", async (request, reply) => {
    const user = (request as AuthenticatedRequest).authUser;
    const { id, requestId } = pendingParamsSchema.parse(request.params);
    await services.conversations.cancelPending(
      user.id,
      id,
      requestId,
      auditContext(request),
    );
    return reply.code(204).send();
  });

  app.post(
    "/:id/pending-requests/:requestId/restore-input",
    async (request, reply) => {
      const user = (request as AuthenticatedRequest).authUser;
      const { id, requestId } = pendingParamsSchema.parse(request.params);
      return reply.send(
        ok(
          await services.conversations.restorePendingToInput(
            user.id,
            id,
            requestId,
            auditContext(request),
          ),
          request.id,
        ),
      );
    },
  );
};

function auditContext(request: {
  ip: string;
  headers: { "user-agent"?: string | undefined };
}) {
  return {
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"] ?? null,
  };
}
