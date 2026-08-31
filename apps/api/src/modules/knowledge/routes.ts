import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";

import {
  createKnowledgeBaseGrantInputSchema,
  createKnowledgeBaseInputSchema,
  knowledgeBaseCreationCapabilitySchema,
  knowledgeBaseGrantListQuerySchema,
  knowledgeBaseGrantPageSchema,
  knowledgeBaseGrantRevocationResultSchema,
  knowledgeBaseEntryListQuerySchema,
  knowledgeBaseEntryPageSchema,
  knowledgeBaseListQuerySchema,
  knowledgeDocumentListQuerySchema,
  knowledgeDocumentRebuildInputSchema,
  knowledgeDocumentUploadOptionsSchema,
  knowledgeSearchCapabilitySchema,
  knowledgeShareTargetQuerySchema,
  knowledgeUploadLimitsSchema,
  type KnowledgeSearchCapability,
  type KnowledgeBaseCreationCapability,
  updateKnowledgeBaseInputSchema,
} from "@linksense/shared";

import {
  attachmentContentDisposition,
  inlineContentDisposition,
} from "../../lib/content-disposition.js";
import { sseCorsHeaders } from "../../lib/cors.js";
import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { KnowledgeService } from "./service.js";
import type { KnowledgeSourceService } from "../knowledge-sources/service.js";
import type { KnowledgeActor, ResolveKnowledgeActor } from "./types.js";

export interface KnowledgeRoutesOptions {
  service: KnowledgeService;
  getSearchCapability: () => Promise<KnowledgeSearchCapability>;
  creationCapability: {
    read(refresh?: boolean): Promise<KnowledgeBaseCreationCapability>;
    assertReady(): Promise<void>;
  };
  publicBaseUrl: string;
  sourceService?: KnowledgeSourceService;
  resolveActor?: ResolveKnowledgeActor;
}

const uuid = z.string().uuid();
const knowledgeBaseParams = z.strictObject({ id: uuid });
const documentParams = z.strictObject({ id: uuid, documentId: uuid });
const grantParams = z.strictObject({ id: uuid, grantId: uuid });
const assetParams = z.strictObject({
  id: uuid,
  documentId: uuid,
  assetId: uuid,
});
const assetQuery = z.strictObject({ document_version_id: uuid });
const documentVersionQuery = z.strictObject({
  document_version_id: uuid.optional(),
});
const creationCapabilityQuery = z.strictObject({
  refresh: z.literal("true").optional(),
});
const optionalReasonBody = z
  .strictObject({ reason: z.string().trim().min(1).max(1_000).optional() })
  .default({});
const renameDocumentBody = z.strictObject({
  display_name: z.string().trim().min(1).max(260),
});
export const knowledgeRoutes: FastifyPluginAsync<
  KnowledgeRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/config", async (request, reply) => {
    const actor = await actorFor(request);
    return reply.send(
      ok(
        knowledgeUploadLimitsSchema.parse(
          options.service.getUploadLimits(actor),
        ),
        request,
      ),
    );
  });

  app.get("/search-capability", async (request, reply) => {
    await actorFor(request);
    return reply.send(
      ok(
        knowledgeSearchCapabilitySchema.parse(
          await options.getSearchCapability(),
        ),
        request,
      ),
    );
  });

  app.get("/creation-capability", async (request, reply) => {
    await actorFor(request);
    const query = creationCapabilityQuery.parse(request.query);
    return reply.send(
      ok(
        knowledgeBaseCreationCapabilitySchema.parse(
          await options.creationCapability.read(query.refresh === "true"),
        ),
        request,
      ),
    );
  });

  app.get("/share-targets", async (request, reply) => {
    const actor = await actorFor(request);
    const query = knowledgeShareTargetQuerySchema.parse(request.query);
    return reply.send(
      ok(
        await options.service.searchShareTargets(actor, {
          ...(query.knowledge_base_id === undefined
            ? {}
            : { knowledgeBaseId: query.knowledge_base_id }),
          type: query.type,
          search: query.search,
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          limit: query.limit,
        }),
        request,
      ),
    );
  });

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request);
    const query = knowledgeBaseListQuerySchema.parse(request.query);
    return reply.send(
      ok(
        await options.service.listKnowledgeBases(actor, {
          scope: query.scope === "owned" ? "mine" : query.scope,
          ...(query.lifecycle_status === undefined
            ? {}
            : { lifecycleStatus: query.lifecycle_status }),
          ...(query.search === undefined ? {} : { search: query.search }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          limit: query.limit,
        }),
        request,
      ),
    );
  });

  app.post("/", async (request, reply) => {
    const resolvedActor = await actorFor(request);
    const actor = {
      ...resolvedActor,
      ipAddress: request.ip,
      ...(request.headers["user-agent"] === undefined
        ? {}
        : { userAgent: request.headers["user-agent"] }),
    };
    const body = createKnowledgeBaseInputSchema.parse(request.body);
    await options.creationCapability.assertReady();
    const created =
      body.source_type === "sharepoint"
        ? await requiredSourceService(options).createSharePointKnowledgeBase(
            actor,
            {
              name: body.name,
              ...(body.description === undefined
                ? {}
                : { description: body.description }),
              folderUrl: body.sharepoint_folder_url,
              schedule: body.sync_schedule,
            },
          )
        : await options.service.createKnowledgeBase(actor, {
            name: body.name,
            ...(body.description === undefined
              ? {}
              : { description: body.description }),
            sourceType: "local",
          });
    return reply.code(201).send(ok(created, request));
  });

  app.get("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.getKnowledgeBase(actor, id), request),
    );
  });

  app.get("/:id/source", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    return reply.send(
      ok(await requiredSourceService(options).getSource(actor, id), request),
    );
  });

  app.post("/:id/source/sync", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    return reply
      .code(202)
      .send(
        ok(
          await requiredSourceService(options).requestSync(actor, id),
          request,
        ),
      );
  });

  app.patch("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const body = updateKnowledgeBaseInputSchema.parse(request.body);
    return reply.send(
      ok(
        await options.service.updateKnowledgeBase(actor, id, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined
            ? {}
            : { description: body.description }),
        }),
        request,
      ),
    );
  });

  app.post("/:id/archive", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.archiveKnowledgeBase(actor, id), request),
    );
  });

  app.post("/:id/restore", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    return reply.send(
      ok(await options.service.restoreKnowledgeBase(actor, id), request),
    );
  });

  app.delete("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const body = optionalReasonBody.parse(request.body ?? {});
    await options.service.deleteKnowledgeBase(
      actor,
      id,
      body.reason ?? "user_requested",
    );
    return reply.code(204).send();
  });

  app.get("/:id/grants", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const query = knowledgeBaseGrantListQuerySchema.parse(request.query);
    const result = await options.service.listGrants(actor, id, {
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });
    return reply.send(ok(knowledgeBaseGrantPageSchema.parse(result), request));
  });

  app.post("/:id/grants", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const body = createKnowledgeBaseGrantInputSchema.parse(request.body);
    const grant = await options.service.createGrant(actor, id, {
      targetType: body.target_type,
      targetId: body.target_id,
    });
    return reply.code(201).send(ok(grant, request));
  });

  app.delete("/:id/grants/:grantId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, grantId } = grantParams.parse(request.params);
    const body = optionalReasonBody.parse(request.body ?? {});
    const result = await options.service.revokeGrant(
      actor,
      id,
      grantId,
      body.reason,
    );
    return reply.send(
      ok(knowledgeBaseGrantRevocationResultSchema.parse(result), request),
    );
  });

  app.get("/:id/documents", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const query = knowledgeDocumentListQuerySchema.parse(request.query);
    const result = await options.service.listDocuments(actor, id, {
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.status === undefined ? {} : { status: query.status }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });
    return reply.send(ok(result, request));
  });

  app.get("/:id/entries", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const query = knowledgeBaseEntryListQuerySchema.parse(request.query);
    const result = await options.service.listDirectoryEntries(actor, id, {
      ...(query.parent_entry_id === undefined
        ? {}
        : { parentEntryId: query.parent_entry_id }),
      ...(query.view === undefined ? {} : { view: query.view }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit: query.limit,
    });
    return reply.send(ok(knowledgeBaseEntryPageSchema.parse(result), request));
  });

  app.post("/:id/documents", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    if (!request.isMultipart())
      throw new AppError("KNOWLEDGE_DOCUMENT_INVALID");
    const part = await request.file({ limits: { files: 1 } });
    if (part === undefined) throw new AppError("KNOWLEDGE_DOCUMENT_INVALID");
    const conflictResolution = multipartTextField(
      part.fields,
      "conflict_resolution",
    );
    const replaceDocumentId = multipartTextField(
      part.fields,
      "replace_document_id",
    );
    const ocrEnabled = multipartTextField(part.fields, "ocr_enabled");
    const relativePath = multipartTextField(part.fields, "relative_path");
    const parentEntryId = multipartTextField(part.fields, "parent_entry_id");
    const uploadOptions = knowledgeDocumentUploadOptionsSchema.parse({
      ...(conflictResolution === undefined
        ? {}
        : { conflict_resolution: conflictResolution }),
      ...(replaceDocumentId === undefined
        ? {}
        : { replace_document_id: replaceDocumentId }),
      ...(ocrEnabled === undefined ? {} : { ocr_enabled: ocrEnabled }),
      ...(relativePath === undefined ? {} : { relative_path: relativePath }),
      ...(parentEntryId === undefined
        ? {}
        : { parent_entry_id: parentEntryId }),
    });
    const upload = {
      filename: part.filename,
      declaredMimeType: part.mimetype,
      stream: part.file,
      ocrEnabled: uploadOptions.ocr_enabled,
      ...(uploadOptions.relative_path === undefined
        ? {}
        : { relativePath: uploadOptions.relative_path }),
      ...(uploadOptions.parent_entry_id === undefined
        ? {}
        : { parentEntryId: uploadOptions.parent_entry_id }),
    };
    const document = await options.service.uploadDocument(
      actor,
      id,
      uploadOptions.conflict_resolution === "replace"
        ? {
            ...upload,
            conflictResolution: "replace",
            replaceDocumentId: uploadOptions.replace_document_id,
          }
        : uploadOptions.conflict_resolution === "keep_both"
          ? { ...upload, conflictResolution: "keep_both" }
          : uploadOptions.conflict_resolution === "replace_path"
            ? { ...upload, conflictResolution: "replace_path" }
            : upload,
    );
    return reply.code(202).send(ok(document, request));
  });

  app.post("/:id/documents/rebuild", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const body = knowledgeDocumentRebuildInputSchema.parse(request.body ?? {});
    return reply
      .code(202)
      .send(
        ok(
          await options.service.rebuildDocuments(
            actor,
            id,
            body.document_ids,
            body.cursor,
          ),
          request,
        ),
      );
  });

  app.get("/:id/documents/:documentId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const query = documentVersionQuery.parse(request.query);
    return reply.send(
      ok(
        await options.service.getDocument(
          actor,
          id,
          documentId,
          query.document_version_id,
        ),
        request,
      ),
    );
  });

  app.patch("/:id/documents/:documentId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const body = renameDocumentBody.parse(request.body);
    return reply.send(
      ok(
        await options.service.renameDocument(actor, id, documentId, {
          displayName: body.display_name,
        }),
        request,
      ),
    );
  });

  app.post("/:id/documents/:documentId/retry", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    return reply
      .code(202)
      .send(
        ok(await options.service.retryDocument(actor, id, documentId), request),
      );
  });

  app.post("/:id/documents/:documentId/reprocess", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    return reply
      .code(202)
      .send(
        ok(
          await options.service.reprocessDocument(actor, id, documentId),
          request,
        ),
      );
  });

  app.post("/:id/documents/:documentId/rebuild", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    return reply
      .code(202)
      .send(
        ok(
          await options.service.rebuildDocument(actor, id, documentId),
          request,
        ),
      );
  });

  app.post("/:id/documents/:documentId/cancel", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const body = optionalReasonBody.parse(request.body ?? {});
    return reply.send(
      ok(
        await options.service.cancelDocumentProcessing(
          actor,
          id,
          documentId,
          body.reason ?? "user_requested",
        ),
        request,
      ),
    );
  });

  app.delete("/:id/documents/:documentId", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const body = optionalReasonBody.parse(request.body ?? {});
    await options.service.deleteDocument(
      actor,
      id,
      documentId,
      body.reason ?? "user_requested",
    );
    return reply.code(204).send();
  });

  app.get("/:id/documents/:documentId/content", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const query = documentVersionQuery.parse(request.query);
    return reply.send(
      ok(
        await options.service.getParsedContent(
          actor,
          id,
          documentId,
          query.document_version_id,
        ),
        request,
      ),
    );
  });

  app.get("/:id/documents/:documentId/original", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const query = documentVersionQuery.parse(request.query);
    const file = await options.service.downloadOriginal(
      actor,
      id,
      documentId,
      query.document_version_id,
    );
    reply.raw.once("close", () => file.stream.destroy());
    return reply
      .type(file.mimeType)
      .header("cache-control", "private, no-store")
      .header("content-length", file.sizeBytes.toString())
      .header(
        "content-disposition",
        attachmentContentDisposition(file.filename),
      )
      .header("x-content-type-options", "nosniff")
      .send(file.stream);
  });

  app.get("/:id/documents/:documentId/preview", async (request, reply) => {
    const actor = await actorFor(request);
    const { id, documentId } = documentParams.parse(request.params);
    const query = documentVersionQuery.parse(request.query);
    const file = await options.service.getOriginalPreview(
      actor,
      id,
      documentId,
      query.document_version_id,
    );
    reply.raw.once("close", () => file.stream.destroy());
    return reply
      .type(file.mimeType)
      .header("cache-control", "private, no-store")
      .header("content-length", file.sizeBytes.toString())
      .header("content-disposition", inlineContentDisposition(file.filename))
      .header("content-security-policy", "default-src 'none'; sandbox")
      .header("x-content-type-options", "nosniff")
      .send(file.stream);
  });

  app.get(
    "/:id/documents/:documentId/assets/:assetId",
    async (request, reply) => {
      const actor = await actorFor(request);
      const { id, documentId, assetId } = assetParams.parse(request.params);
      const query = assetQuery.parse(request.query);
      const asset = await options.service.getAsset(
        actor,
        id,
        documentId,
        query.document_version_id,
        assetId,
      );
      reply.raw.once("close", () => asset.stream.destroy());
      return reply
        .type(asset.mimeType)
        .header("cache-control", "private, no-store")
        .header("content-length", asset.sizeBytes.toString())
        .header("content-disposition", inlineContentDisposition(asset.filename))
        .header("content-security-policy", "default-src 'none'; sandbox")
        .header("x-content-type-options", "nosniff")
        .send(asset.stream);
    },
  );

  app.get("/:id/events", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = knowledgeBaseParams.parse(request.params);
    const controller = new AbortController();
    request.raw.once("close", () => controller.abort());
    const events = await options.service.subscribeEvents(
      actor,
      id,
      controller.signal,
    );
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      ...sseCorsHeaders(request.headers.origin, options.publicBaseUrl),
    });
    reply.raw.flushHeaders();
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableNeedDrain) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 15_000);
    heartbeat.unref();
    try {
      for await (const event of events) {
        if (controller.signal.aborted || reply.raw.destroyed) break;
        const written = reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
        if (!written) await waitForDrain(reply.raw, controller.signal);
      }
    } finally {
      clearInterval(heartbeat);
      if (!reply.raw.destroyed) reply.raw.end();
    }
  });
};

function multipartTextField(
  fields: Record<string, unknown>,
  name: string,
): string | undefined {
  const field = fields[name];
  if (typeof field !== "object" || field === null || Array.isArray(field)) {
    return undefined;
  }
  const value = (field as { value?: unknown }).value;
  return typeof value === "string" ? value : undefined;
}

function requiredSourceService(options: KnowledgeRoutesOptions) {
  if (!options.sourceService)
    throw new AppError("KNOWLEDGE_SOURCE_NOT_CONFIGURED");
  return options.sourceService;
}

function waitForDrain(
  response: {
    once(event: "drain" | "close", listener: () => void): unknown;
    off(event: "drain" | "close", listener: () => void): unknown;
  },
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve) => {
    const settle = () => {
      response.off("drain", settle);
      response.off("close", settle);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    response.once("drain", settle);
    response.once("close", settle);
    signal.addEventListener("abort", settle, { once: true });
  });
}

function defaultActorResolver(request: FastifyRequest): KnowledgeActor {
  const user = request.authUser;
  if (
    user === undefined ||
    (user.role !== "admin" && user.role !== "user") ||
    user.status !== "active"
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
