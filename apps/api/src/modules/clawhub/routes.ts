import { clawHubSkillCatalogSortSchema } from "@linksense/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type {
  RequestActor,
  ResolveRequestActor,
} from "../capabilities/types.js";
import type { ClawHubService } from "./service.js";

export interface ClawHubRoutesOptions {
  service: Pick<ClawHubService, "listCatalog" | "previewInstall">;
  resolveActor?: ResolveRequestActor;
}

const skillParamsSchema = z.strictObject({ skillId: z.uuid() });
const emptyBodySchema = z.strictObject({});
const catalogQuerySchema = z.strictObject({
  search: z.string().trim().max(240).optional(),
  sort: clawHubSkillCatalogSortSchema.default("downloads"),
  cursor: z.string().trim().min(1).max(1_024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

export const clawHubRoutes: FastifyPluginAsync<ClawHubRoutesOptions> = async (
  app,
  options,
) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/skills", async (request, reply) => {
    const actor = await actorFor(request);
    const query = catalogQuerySchema.parse(request.query);
    const page = await options.service.listCatalog(actor, {
      limit: query.limit,
      sort: query.sort,
      ...(query.search ? { search: query.search } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return reply.send(
      ok(
        {
          items: page.items,
          next_cursor: page.nextCursor,
          total_count: page.totalCount,
        },
        request,
      ),
    );
  });

  app.post("/skills/:skillId/install-preview", async (request, reply) => {
    const actor = await actorFor(request);
    const { skillId } = skillParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    const result = await options.service.previewInstall(actor, skillId);
    return reply.code(202).send(ok(result, request));
  });
};

interface AuthenticatedRequestCarrier {
  authUser?: {
    id?: unknown;
    role?: unknown;
    status?: unknown;
  };
}

function defaultActorResolver(request: FastifyRequest): RequestActor {
  const user = (request as unknown as AuthenticatedRequestCarrier).authUser;
  if (
    user === undefined ||
    typeof user.id !== "string" ||
    (user.role !== "admin" && user.role !== "user") ||
    (user.status !== "active" && user.status !== "disabled")
  ) {
    throw new AppError("AUTH_REQUIRED");
  }
  return {
    id: user.id,
    role: user.role,
    status: user.status,
  };
}
