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
  applicationCatalogQuerySchema,
  applicationShareInputSchema,
  createApplicationInputSchema,
  updateApplicationInputSchema,
  editAndPublishApplicationInputSchema,
  applicationInstallInputSchema,
  applicationVersionInputSchema,
  applicationUpdateInstallationInputSchema,
  applicationDistributionChannelSchema,
  applicationUsageModesSchema,
  type ApplicationDistributionChannel,
  interactiveApplicationRuntimeTokenResultSchema,
  interactiveDependencySelectionSchema,
  interactiveDependencyTypeSchema,
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
      channel?: ApplicationDistributionChannel;
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

  app.get("/catalog", async (request, reply) => {
    const actor = await actorFor(request);
    const query = applicationCatalogQuerySchema.parse(request.query);
    return reply.header("cache-control", "private, no-store").send(ok(await options.service.catalog(actor, query), request));
  });

  app.get("/distribution", async (request, reply) => {
    const actor = await actorFor(request);
    return reply.send(ok({ items: await options.service.distributionSummaries(actor) }, request));
  });

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

  app.get("/:id/details", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const { channel } = z.strictObject({ channel: applicationDistributionChannelSchema.default("direct") }).parse(request.query);
    const details = await options.service.details(actor, id, channel);
    return reply.header("cache-control", "private, no-store").send(ok(details, request));
  });

  app.post("/interactive-import", async (request, reply) => {
    const actor = await actorFor(request);
    const { archive, bindings } = await readInteractiveUpload(request);
    const created = await options.service.importInteractive(
      actor,
      archive,
      auditContext(request),
      bindings,
    );
    return reply.code(201).send(ok(created, request));
  });

  app.post("/interactive-import/preview", async (request, reply) => {
    const actor = await actorFor(request);
    const { application_id: applicationId } = z.strictObject({ application_id: uuid.optional() }).parse(request.query);
    const { archive } = await readInteractiveUpload(request);
    return reply.send(ok(await options.service.previewInteractiveDependencies(actor, archive, applicationId), request));
  });

  app.get("/interactive-dependency-options", async (request, reply) => {
    const actor = await actorFor(request);
    const query = z.strictObject({ type: interactiveDependencyTypeSchema, search: z.string().trim().min(1).max(160).optional(), cursor: uuid.optional() }).parse(request.query);
    return reply.send(ok(await options.service.interactiveDependencyOptions(actor, query.type, query.search, query.cursor), request));
  });

  app.get("/:id/interactive-dependencies", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.interactiveDependencies(actor, id), request));
  });

  app.patch("/:id/interactive-dependencies", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const { bindings } = interactiveDependencySelectionSchema.parse(request.body);
    return reply.send(ok(await options.service.updateInteractiveDependencies(actor, id, bindings, auditContext(request)), request));
  });

  app.post("/:id/interactive-runtime-token", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const body = z
      .strictObject({ package_id: uuid.optional(), conversation_id: uuid.optional() })
      .default({})
      .parse(request.body);
    const ticket = await options.service.createInteractiveRuntimeTicket(
      actor,
      id,
      body.package_id,
      body.conversation_id,
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

  app.get("/:id/publication", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.getPublication(actor, id), request));
  });

  app.get("/:id/distribution/settings", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.distributionSettings(actor, id), request));
  });

  app.get("/:id/publication-readiness", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    reply.header("cache-control", "private, no-store");
    return reply.send(ok(await options.service.publicationReadiness(actor, id), request));
  });

  app.post("/:id/install", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const input = applicationInstallInputSchema.parse(request.body);
    return reply.code(201).send(ok(await options.service.install(actor, id, input, auditContext(request)), request));
  });

  app.post("/:id/publish", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.publish(actor, id, applicationVersionInputSchema.parse(request.body)), request));
  });

  app.post("/:id/service-installation", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const input = z.strictObject({ channel: applicationDistributionChannelSchema, version_id: z.uuid() }).parse(request.body);
    return reply.send(ok(await options.service.installService(actor, id, input.channel, input.version_id, auditContext(request)), request));
  });

  app.get("/:id/installation/update", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    return reply.send(ok(await options.service.previewInstallationUpdate(actor, id), request));
  });

  app.post("/:id/installation/update", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const input = applicationUpdateInstallationInputSchema.parse(request.body);
    return reply.send(ok(await options.service.updateInstallation(actor, id, input.version_id, auditContext(request)), request));
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

  app.post("/:id/edit-and-publish", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const { changes, release } = editAndPublishApplicationInputSchema.parse(request.body);
    return reply.send(ok(await options.service.update(actor, id, changes, auditContext(request), release), request));
  });

  app.post("/:id/interactive-package", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const { archive, bindings, release } = await readInteractiveUpload(request, { allowRelease: true });
    return reply.send(
      ok(
        await options.service.updateInteractivePackage(
          actor,
          id,
          archive,
          auditContext(request),
          bindings,
          ...(release ? [{ release }] : []),
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

  app.post("/:id/share", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const input = applicationShareInputSchema.parse(request.body);
    return reply.send(ok(await options.service.share(actor, id, input, auditContext(request)), request));
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

  app.patch("/:id/grants/:grantId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, grantId } = grantParams.parse(request.params);
    const body = z.strictObject({ usage_modes: applicationUsageModesSchema }).parse(request.body);
    await options.service.updateGrantModes(actor, id, grantId, body.usage_modes, auditContext(request));
    return reply.code(204).send();
  });

  app.post("/:id/conversations", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = applicationParams.parse(request.params);
    const { channel } = z.strictObject({ channel: applicationDistributionChannelSchema.default("direct") }).default({ channel: "direct" }).parse(request.body);
    const conversation = await options.createConversation(actor.id, { id, channel });
    return reply
      .code(201)
      .send(ok({ conversation_id: conversation.id }, request));
  });
};

export const interactiveApplicationRuntimeRoutes: FastifyPluginAsync<{
  service: ApplicationService;
}> = async (app, { service }) => {
  // Run after the host's onSend hook so its default policies are not reapplied.
  // Interactive packages run as trusted web applications, without a sandbox.
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.removeHeader("content-security-policy");
    reply.removeHeader("permissions-policy");
    reply.removeHeader("x-frame-options");
    return payload;
  });

  app.get("/sdk/v1.js", async (_request, reply) =>
    reply
      .header("content-type", "text/javascript; charset=utf-8")
      .header("cache-control", "no-cache")
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

export function defaultActorResolver(request: FastifyRequest): RequestActor {
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

async function readInteractiveUpload(request: FastifyRequest, options: { allowRelease?: boolean } = {}) {
  let archive: Buffer | undefined;
  let selection: unknown = { bindings: [] };
  let release: unknown;
  const fields = new Set<string>();
  for await (const part of request.parts({ limits: { files: 1, fields: options.allowRelease ? 3 : 2, fileSize: INTERACTIVE_APPLICATION_ARCHIVE_MAX_BYTES, fieldSize: 32 * 1024 } })) {
    if (part.type === "file") {
      if (part.fieldname !== "file" || !isZipUpload(part.mimetype)) throw new AppError("APPLICATION_PACKAGE_INVALID");
      archive = await part.toBuffer();
    } else {
      if ((part.fieldname !== "dependencies" && !(options.allowRelease && part.fieldname === "release")) || fields.has(part.fieldname) || part.valueTruncated || typeof part.value !== "string") throw new AppError("VALIDATION_ERROR");
      fields.add(part.fieldname);
      try {
        const value: unknown = JSON.parse(part.value);
        if (part.fieldname === "release") release = value;
        else selection = value;
      } catch { throw new AppError("VALIDATION_ERROR"); }
    }
  }
  if (!archive) throw new AppError("APPLICATION_PACKAGE_INVALID");
  return { archive, ...interactiveDependencySelectionSchema.parse(selection), release: release === undefined ? undefined : applicationVersionInputSchema.parse(release) };
}
