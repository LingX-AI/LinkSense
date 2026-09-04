import type {
  FastifyPluginAsync,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";

import {
  INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
  applicationGranteeTypeSchema,
  applicationListQuerySchema,
  createApplicationGrantInputSchema,
  createApplicationInputSchema,
  updateApplicationInputSchema,
  interactiveApplicationRuntimeTokenResultSchema,
  usageAnalyticsReportQuerySchema,
} from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { AuditContext } from "../audit/service.js";
import type {
  RequestActor,
  ResolveRequestActor,
} from "../capabilities/types.js";
import type { ApplicationService } from "./service.js";
import type { UsageAnalyticsService } from "../usage/service.js";
import { interactiveApplicationSdkV1 } from "./interactive-sdk.js";

export interface ApplicationRoutesOptions {
  service: ApplicationService;
  usageAnalytics: Pick<UsageAnalyticsService, "applicationReport">;
  createConversation: (
    ownerId: string,
    application: {
      id: string;
      name: string;
      kind: "standard" | "interactive";
      interactivePackageId: string | null;
    },
  ) => Promise<{ id: string }>;
  resolveActor?: ResolveRequestActor;
}

const uuid = z.string().uuid();
const applicationParams = z.strictObject({ id: uuid });
const grantParams = z.strictObject({ id: uuid, grantId: uuid });
const shareTargetQuery = z.strictObject({
  type: applicationGranteeTypeSchema.optional(),
  search: z.string().trim().min(1).max(240).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const applicationRoutes: FastifyPluginAsync<
  ApplicationRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/share-targets", async (request, reply) => {
    const actor = await actorFor(request);
    const query = shareTargetQuery.parse(request.query);
    const items = await options.service.searchShareTargets(actor, {
      ...(query.type === undefined ? {} : { type: query.type }),
      ...(query.search === undefined ? {} : { search: query.search }),
      limit: query.limit,
    });
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request);
    const query = applicationListQuerySchema.parse(request.query);
    const items = await options.service.list(actor, {
      scope: query.scope,
      ...(query.search === undefined ? {} : { search: query.search }),
      limit: query.limit,
    });
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.post("/interactive-import", async (request, reply) => {
    const actor = await actorFor(request);
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
      },
    });
    if (!file || !isZipUpload(file.mimetype)) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    const created = await options.service.importInteractive(
      actor,
      await file.toBuffer(),
      auditContext(request),
    );
    return reply.code(201).send(ok(created, request));
  });

  app.post("/:id/interactive-runtime-token", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const body = z
      .strictObject({ package_id: uuid.optional() })
      .default({})
      .parse(request.body);
    const ticket = await options.service.createInteractiveRuntimeTicket(
      actor,
      id,
      body.package_id,
    );
    return reply.send(
      ok(
        interactiveApplicationRuntimeTokenResultSchema.parse({
          runtime_url: `/api/v1/interactive-app-runtime/${ticket.token}/index.html`,
          expires_at: ticket.expiresAt.toISOString(),
          manifest: ticket.manifest,
        }),
        request,
      ),
    );
  });

  app.post("/", async (request, reply) => {
    const actor = await actorFor(request);
    const created = await options.service.create(
      actor,
      createApplicationInputSchema.parse(request.body),
      auditContext(request),
    );
    return reply.code(201).send(ok(created, request));
  });

  app.get("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.get(actor, id), request));
  });

  app.get("/:id/usage", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const query = usageAnalyticsReportQuerySchema.parse(request.query);
    const report = await options.usageAnalytics.applicationReport(
      actor.id,
      id,
      query,
    );
    return reply
      .header("cache-control", "private, no-store")
      .send(ok(report, request));
  });

  app.patch("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(
      ok(
        await options.service.update(
          actor,
          id,
          updateApplicationInputSchema.parse(request.body),
          auditContext(request),
        ),
        request,
      ),
    );
  });

  app.post("/:id/interactive-package", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const file = await request.file({
      limits: {
        files: 1,
        fileSize: INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES,
      },
    });
    if (!file || !isZipUpload(file.mimetype)) {
      throw new AppError("APPLICATION_PACKAGE_INVALID");
    }
    return reply.send(
      ok(
        await options.service.updateInteractivePackage(
          actor,
          id,
          await file.toBuffer(),
          auditContext(request),
        ),
        request,
      ),
    );
  });

  app.delete("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    await options.service.delete(actor, id, auditContext(request));
    return reply.code(204).send();
  });

  app.get("/:id/grants", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const items = await options.service.listGrants(actor, id);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.post("/:id/grants", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const body = createApplicationGrantInputSchema.parse(request.body);
    const created = await options.service.grant(
      actor,
      id,
      body.grantee_type === "user"
        ? { granteeType: "user", userId: body.user_id }
        : {
            granteeType: "user_group",
            userGroupId: body.user_group_id,
          },
      auditContext(request),
    );
    return reply.code(201).send(ok(created, request));
  });

  app.delete("/:id/grants/:grantId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, grantId } = grantParams.parse(request.params);
    return reply.send(
      ok(
        await options.service.revokeGrant(
          actor,
          id,
          grantId,
          auditContext(request),
        ),
        request,
      ),
    );
  });

  app.post("/:id/conversations", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const runtime = await options.service.resolveRuntime(actor.id, id);
    const conversation = await options.createConversation(actor.id, {
      id: runtime.applicationId,
      name: runtime.applicationName,
      kind: runtime.kind === "interactive" ? "interactive" : "standard",
      interactivePackageId:
        runtime.kind === "interactive"
          ? (
              await options.service.get(actor, id)
            ).interactive_package?.id ?? null
          : null,
    });
    return reply
      .code(201)
      .send(ok({ conversation_id: conversation.id }, request));
  });
};

export const interactiveApplicationRuntimeRoutes: FastifyPluginAsync<{
  service: ApplicationService;
}> = async (app, { service }) => {
  app.get("/sdk/v1.js", async (_request, reply) =>
    reply
      .header("content-type", "text/javascript; charset=utf-8")
      .header("cache-control", "public, max-age=31536000, immutable")
      .header("content-security-policy", "default-src 'none'")
      .send(interactiveApplicationSdkV1),
  );

  app.get("/:token/*", async (request, reply) => {
    const params = z
      .strictObject({
        token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
        "*": z.string().min(1).max(1_000),
      })
      .parse(request.params);
    const asset = await service.getInteractiveAssetForTicket(
      params.token,
      params["*"],
    );
    return sendInteractiveAsset(reply, asset);
  });
};

function sendInteractiveAsset(
  reply: FastifyReply,
  asset: {
    data: import("node:stream").Readable;
    contentType: string;
    byteSize: number;
    etag: string;
  },
) {
  const isHtml = asset.contentType.startsWith("text/html");
  return reply
    .header("content-type", asset.contentType)
    .header("content-length", String(asset.byteSize))
    .header("etag", `"${asset.etag}"`)
    .header(
      "cache-control",
      isHtml ? "no-store" : "private, max-age=31536000, immutable",
    )
    .header("x-content-type-options", "nosniff")
    .header("referrer-policy", "no-referrer")
    .header(
      "content-security-policy",
      [
        "default-src 'self'",
        "base-uri 'none'",
        "connect-src 'none'",
        "font-src 'self' data:",
        "form-action 'none'",
        "frame-ancestors 'self'",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
      ].join("; "),
    )
    .send(asset.data);
}

interface AuthenticatedRequestCarrier {
  authUser?: {
    id?: unknown;
    role?: unknown;
    status?: unknown;
    registrationSource?: unknown;
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
    ...(user.registrationSource === "self_registration" ||
      user.registrationSource === "organization_invitation"
      ? { registrationSource: user.registrationSource }
      : {}),
    ipAddress: request.ip,
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
  };
}

function auditContext(request: FastifyRequest): AuditContext {
  return {
    ipAddress: request.ip,
    ...(request.headers["user-agent"] === undefined
      ? {}
      : { userAgent: request.headers["user-agent"] }),
  };
}

function isZipUpload(mimeType: string) {
  return [
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ].includes(mimeType.toLocaleLowerCase("en-US"));
}
