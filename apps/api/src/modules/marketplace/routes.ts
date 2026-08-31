import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type {
  RequestActor,
  ResolveRequestActor,
} from "../capabilities/types.js";

import type { MarketplaceService } from "./service.js";

export interface MarketplaceRoutesOptions {
  service: MarketplaceService;
  resolveActor?: ResolveRequestActor;
}

const uuid = z.string().uuid();
const listingParams = z.strictObject({ listingId: uuid });
const releaseParams = z.strictObject({ releaseId: uuid });

export const marketplaceRoutes: FastifyPluginAsync<
  MarketplaceRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request);
    const query = z
      .strictObject({
        type: z.enum(["plugin", "skill"]).optional(),
        search: z.string().trim().min(1).max(240).optional(),
      })
      .parse(request.query);
    const items = await options.service.listCatalog(actor, {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.search === undefined ? {} : { search: query.search }),
    });
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.get("/mine", async (request, reply) => {
    const actor = await actorFor(request);
    const items = await options.service.listOwnPublications(actor);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.get("/installations", async (request, reply) => {
    const actor = await actorFor(request);
    const items = await options.service.listInstallations(actor);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.post("/submissions", async (request, reply) => {
    const actor = await actorFor(request);
    const body = z
      .strictObject({
        capability_id: uuid,
        listing_id: uuid.optional(),
        release_notes: z.string().trim().max(8_000).nullable().optional(),
      })
      .parse(request.body);
    const result = await options.service.submit(actor, {
      capabilityId: body.capability_id,
      ...(body.listing_id === undefined ? {} : { listingId: body.listing_id }),
      ...(body.release_notes === undefined
        ? {}
        : { releaseNotes: body.release_notes }),
    });
    return reply.code(202).send(ok(result, request));
  });

  app.get("/releases/:releaseId", async (request, reply) => {
    const actor = await actorFor(request);
    const { releaseId } = releaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.getReviewDetail(actor, releaseId), request),
    );
  });

  app.delete("/releases/:releaseId", async (request, reply) => {
    const actor = await actorFor(request);
    const { releaseId } = releaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.withdraw(actor, releaseId), request),
    );
  });

  app.get("/:listingId", async (request, reply) => {
    const actor = await actorFor(request);
    const { listingId } = listingParams.parse(request.params);
    return reply.send(
      ok(await options.service.getCatalogItem(actor, listingId), request),
    );
  });

  app.patch("/:listingId/status", async (request, reply) => {
    const actor = await actorFor(request);
    const { listingId } = listingParams.parse(request.params);
    const body = z
      .strictObject({ status: z.enum(["published", "unlisted"]) })
      .parse(request.body);
    return reply.send(
      ok(
        await options.service.setPublisherListingStatus(
          actor,
          listingId,
          body.status,
        ),
        request,
      ),
    );
  });

  app.post("/:listingId/install", async (request, reply) => {
    const actor = await actorFor(request);
    const { listingId } = listingParams.parse(request.params);
    return reply
      .code(201)
      .send(ok(await options.service.install(actor, listingId), request));
  });

  app.post("/:listingId/update", async (request, reply) => {
    const actor = await actorFor(request);
    const { listingId } = listingParams.parse(request.params);
    return reply.send(
      ok(await options.service.updateInstallation(actor, listingId), request),
    );
  });
};

export const adminMarketplaceRoutes: FastifyPluginAsync<
  MarketplaceRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/reviews", async (request, reply) => {
    const actor = await actorFor(request);
    const items = await options.service.listPendingReviews(actor);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.get("/listings", async (request, reply) => {
    const actor = await actorFor(request);
    const items = await options.service.listAllPublications(actor);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.get("/releases/:releaseId", async (request, reply) => {
    const actor = await actorFor(request);
    const { releaseId } = releaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.getReviewDetail(actor, releaseId), request),
    );
  });

  app.patch("/releases/:releaseId/review", async (request, reply) => {
    const actor = await actorFor(request);
    const { releaseId } = releaseParams.parse(request.params);
    const body = z
      .strictObject({
        decision: z.enum(["approved", "rejected"]),
        review_comment: z.string().trim().max(4_000).nullable().optional(),
      })
      .parse(request.body);
    return reply.send(
      ok(
        await options.service.review(actor, releaseId, {
          decision: body.decision,
          ...(body.review_comment === undefined
            ? {}
            : { comment: body.review_comment }),
        }),
        request,
      ),
    );
  });

  app.patch("/:listingId/status", async (request, reply) => {
    const actor = await actorFor(request);
    const { listingId } = listingParams.parse(request.params);
    const body = z
      .discriminatedUnion("action", [
        z.strictObject({
          action: z.literal("suspend"),
          reason: z.string().trim().min(1).max(4_000),
        }),
        z.strictObject({ action: z.literal("resume") }),
      ])
      .parse(request.body);
    const result =
      body.action === "suspend"
        ? await options.service.suspend(actor, listingId, body.reason)
        : await options.service.resume(actor, listingId);
    return reply.send(ok(result, request));
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
    ipAddress: request.ip,
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
  };
}
