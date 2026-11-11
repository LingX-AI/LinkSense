import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { Readable } from "node:stream";
import { z } from "zod";
import {
  publicKnowledgeSaveInputSchema,
  publicKnowledgeSessionInputSchema,
  publicKnowledgeQuestionSchema,
  publicKnowledgeConversationQuerySchema,
  applicationExternalOriginSchema,
  supportedLocales,
  publicKnowledgeStatusInputSchema,
  publicKnowledgeUsageQuerySchema,
} from "@linksense/shared";
import { ok } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";
import type { ResolveRequestActor } from "../capabilities/types.js";
import type { PublicKnowledgeService } from "./service.js";

const application = z.strictObject({ id: z.uuid() });
const publicApplication = z.object({
  publicId: z.string().regex(/^[a-zA-Z0-9_-]{24,80}$/u),
});
const publicConversation = publicApplication.extend({
  conversationId: z.uuid(),
});
const bearer = (request: FastifyRequest): string => {
  const token =
    request.headers.authorization?.replace(/^Bearer\s+/iu, "") ?? "";
  if (!token) throw new AppError("AUTH_REQUIRED");
  return token;
};
export const publicKnowledgeManagementRoutes: FastifyPluginAsync<{
  service: PublicKnowledgeService;
  resolveActor?: ResolveRequestActor;
}> = async (app, options) => {
  const actorFor: ResolveRequestActor =
    options.resolveActor ??
    ((request) => {
      if (!request.authUser) throw new AppError("AUTH_REQUIRED");
      return {
        id: request.authUser.id,
        role: request.authUser.role,
        status: request.authUser.status,
      };
    });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    return payload;
  });
  app.post("/public-knowledge", async (request, reply) =>
    reply
      .code(201)
      .send(
        ok(
          await options.service.save(
            await actorFor(request),
            publicKnowledgeSaveInputSchema.parse(request.body),
          ),
          request.id,
        ),
      ),
  );
  app.get("/:id/public-knowledge", async (request, reply) =>
    reply.send(
      ok(
        await options.service.management(
          await actorFor(request),
          application.parse(request.params).id,
        ),
        request.id,
      ),
    ),
  );
  app.put("/:id/public-knowledge", async (request, reply) =>
    reply.send(
      ok(
        await options.service.save(
          await actorFor(request),
          publicKnowledgeSaveInputSchema.parse(request.body),
          application.parse(request.params).id,
        ),
        request.id,
      ),
    ),
  );
  app.get("/:id/public-knowledge/conversations", async (request, reply) =>
    reply.send(
      ok(
        await options.service.listOwnerConversations(
          await actorFor(request),
          application.parse(request.params).id,
          publicKnowledgeConversationQuerySchema.parse(request.query),
        ),
        request.id,
      ),
    ),
  );
  app.patch("/:id/public-knowledge/status", async (request, reply) =>
    reply.send(
      ok(
        await options.service.setEnabled(
          await actorFor(request),
          application.parse(request.params).id,
          publicKnowledgeStatusInputSchema.parse(request.body).enabled,
        ),
        request.id,
      ),
    ),
  );
  app.get("/:id/public-knowledge/usage", async (request, reply) =>
    reply.send(
      ok(
        await options.service.usage(
          await actorFor(request),
          application.parse(request.params).id,
          publicKnowledgeUsageQuerySchema.parse(request.query),
        ),
        request.id,
      ),
    ),
  );
  app.get(
    "/:id/public-knowledge/conversations/:conversationId",
    async (request, reply) => {
      const params = application
        .extend({ conversationId: z.uuid() })
        .parse(request.params);
      return reply.send(
        ok(
          await options.service.ownerDetail(
            await actorFor(request),
            params.id,
            params.conversationId,
          ),
          request.id,
        ),
      );
    },
  );
};

export const publicKnowledgeVisitorRoutes: FastifyPluginAsync<{
  service: PublicKnowledgeService;
  developmentAssets: boolean;
}> = async (app, { service, developmentAssets }) => {
  app.addHook("preClose", async () => {
    service.closeEventStreams();
  });
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store");
    return payload;
  });
  app.get("/frame/:publicId", async (request, reply) => {
    const { publicId } = publicApplication.parse(request.params);
    const query = z
      .strictObject({
        parent_origin: applicationExternalOriginSchema,
        locale: z.enum(supportedLocales).default("zh-CN"),
      })
      .parse(request.query);
    const configuration = await service.publicConfiguration(
      publicId,
      query.parent_origin,
    );
    const config = {
      public_id: publicId,
      parent_origin: query.parent_origin,
      locale: query.locale,
      ...configuration,
    };
    const source = developmentAssets
      ? "/src/public-knowledge-main.tsx"
      : "/assets/public-knowledge-app.js";
    const preamble = developmentAssets
      ? `<script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>(type)=>type; window.__vite_plugin_react_preamble_installed__=true;</script>`
      : "";
    return reply
      .type("text/html; charset=utf-8")
      .header("referrer-policy", "no-referrer")
      .header(
        "content-security-policy",
        `default-src 'self'; script-src 'self'${developmentAssets ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'${developmentAssets ? " ws: wss:" : ""}; frame-ancestors ${query.parent_origin}; base-uri 'none'; form-action 'none'`,
      )
      .header("permissions-policy", "camera=(), microphone=(), geolocation=()")
      .send(
        `<!doctype html><html lang="${query.locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(config.name)}</title>${developmentAssets ? "" : '<link rel="stylesheet" href="/assets/embed-app.css">'}</head><body><div id="public-knowledge-root" data-config="${escapeHtml(JSON.stringify(config))}"></div>${preamble}<script type="module" src="${source}"></script></body></html>`,
      );
  });
  app.post("/:publicId/sessions", async (request, reply) => {
    const { publicId } = publicApplication.parse(request.params);
    const body = publicKnowledgeSessionInputSchema.parse(request.body);
    return reply
      .code(201)
      .send(
        ok(
          await service.startSession(publicId, body.origin, request.ip),
          request.id,
        ),
      );
  });
  app.get(
    "/:publicId/conversations/:conversationId/events",
    async (request, reply) => {
      const { publicId, conversationId } = publicConversation.parse(
        request.params,
      );
      const query = z
        .strictObject({ last_event_id: z.string().max(160).optional() })
        .parse(request.query);
      const cursor =
        typeof request.headers["last-event-id"] === "string"
          ? request.headers["last-event-id"]
          : query.last_event_id;
      const after = cursor
        ? BigInt(
            z
              .string()
              .regex(new RegExp(`^${conversationId}:\\d+$`))
              .refine(
                (value) =>
                  BigInt(value.slice(conversationId.length + 1)) <=
                  BigInt(Number.MAX_SAFE_INTEGER),
              )
              .parse(cursor)
              .slice(conversationId.length + 1),
          )
        : 0n;
      const controller = new AbortController();
      const stream = await service.visitorEvents(
        publicId,
        bearer(request),
        conversationId,
        after,
        controller.signal,
      );
      reply.raw.once("close", () => controller.abort());
      return reply
        .type("text/event-stream; charset=utf-8")
        .header("x-accel-buffering", "no")
        .send(Readable.from(stream));
    },
  );
  app.post("/:publicId/conversations", async (request, reply) =>
    reply
      .code(201)
      .send(
        ok(
          await service.createConversation(
            publicApplication.parse(request.params).publicId,
            bearer(request),
          ),
          request.id,
        ),
      ),
  );
  app.get("/:publicId/conversations", async (request, reply) =>
    reply.send(
      ok(
        await service.listVisitorConversations(
          publicApplication.parse(request.params).publicId,
          bearer(request),
        ),
        request.id,
      ),
    ),
  );
  app.get(
    "/:publicId/conversations/:conversationId",
    async (request, reply) => {
      const params = publicConversation.parse(request.params);
      return reply.send(
        ok(
          await service.visitorDetail(
            params.publicId,
            bearer(request),
            params.conversationId,
          ),
          request.id,
        ),
      );
    },
  );
  app.post(
    "/:publicId/conversations/:conversationId/turns",
    async (request, reply) => {
      const params = publicConversation.parse(request.params);
      const result = await service.ask(
        params.publicId,
        bearer(request),
        params.conversationId,
        publicKnowledgeQuestionSchema.parse(request.body),
        request.ip,
      );
      return reply
        .code(
          result.status === "queued" || result.status === "running" ? 202 : 200,
        )
        .send(ok(result, request.id));
    },
  );
  app.post(
    "/:publicId/conversations/:conversationId/turns/:turnId/interrupt",
    async (request, reply) => {
      const params = publicConversation
        .extend({ turnId: z.uuid() })
        .parse(request.params);
      await service.interrupt(
        params.publicId,
        bearer(request),
        params.conversationId,
        params.turnId,
      );
      return reply.code(204).send();
    },
  );
};
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}
