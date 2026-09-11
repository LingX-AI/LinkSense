import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import { capabilityDisplayName, skillDisplayNameSchema } from "@linksense/shared";

import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { CapabilityService } from "./service.js";
import type {
  CapabilityImportSource,
  RequestActor,
  ResolveRequestActor,
} from "./types.js";

export interface CapabilityRoutesOptions {
  service: CapabilityService;
  resolveActor?: ResolveRequestActor;
}

const uuid = z.string().uuid();
const capabilityIdParams = z.strictObject({ id: uuid });
const importPreviewParams = z.strictObject({ previewToken: uuid });

const manualImportSchema = z.strictObject({
  source_type: z.literal("local"),
  type: z.literal("skill"),
  name: z.string().trim().min(1).max(160),
  display_name: skillDisplayNameSchema,
  description: z.string().trim().max(4_000).nullable().optional(),
  skill_markdown: z.string().min(1).max(1_000_000),
});

export const capabilityRoutes: FastifyPluginAsync<
  CapabilityRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request);
    const query = z
      .strictObject({
        view: z.enum(["available", "managed"]).optional(),
        type: z.enum(["plugin", "skill"]).optional(),
        search: z.string().trim().min(1).max(240).optional(),
        q: z.string().trim().min(1).max(240).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(request.query);
    const view = query.view ?? "available";
    const allItems =
      view === "managed"
        ? await options.service.listManaged(actor)
        : await options.service.listAvailable(actor);
    const search = (query.search ?? query.q)?.toLocaleLowerCase();
    const items = allItems
      .filter((item) => !query.type || item.type === query.type)
      .filter(
        (item) =>
          !search ||
          item.name.toLocaleLowerCase().includes(search) ||
          capabilityDisplayName(item).toLocaleLowerCase().includes(search) ||
          item.description?.toLocaleLowerCase().includes(search),
      )
      .slice(0, query.limit);
    return reply.send(ok({ items, next_cursor: null }, request));
  });

  app.post("/", async (request, reply) => {
    const actor = await actorFor(request);
    const input = isMultipartRequest(request)
      ? await parseCapabilityMultipart(request)
      : parseCapabilityJson(request.body);
    const preview = await options.service.previewImportCapability(actor, input);
    return reply.code(202).send(ok(preview, request));
  });

  app.post("/imports/:previewToken/confirm", async (request, reply) => {
    const actor = await actorFor(request);
    const { previewToken } = importPreviewParams.parse(request.params);
    const capability = await options.service.confirmCapabilityImport(
      actor,
      previewToken,
    );
    return reply.code(201).send(ok(capability, request));
  });

  app.get("/:id/skill-content", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    return reply.send(
      ok(await options.service.getSkillContent(actor, id), request),
    );
  });

  app.get("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    return reply.send(ok(await options.service.get(actor, id), request));
  });

  app.patch("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    const body = z
      .strictObject({
        name: z.string().trim().min(1).max(160).optional(),
        description: z.string().trim().max(4_000).nullable().optional(),
        status: z.enum(["active", "disabled", "failed"]).optional(),
      })
      .refine((value) => Object.keys(value).length > 0)
      .parse(request.body);
    return reply.send(
      ok(
        await options.service.patch(actor, id, {
          ...(body.name === undefined ? {} : { name: body.name }),
          ...(body.description === undefined
            ? {}
            : { description: body.description }),
          ...(body.status === undefined ? {} : { status: body.status }),
        }),
        request,
      ),
    );
  });

  app.delete("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    await options.service.delete(actor, id);
    return reply.code(204).send();
  });

  app.post("/:id/import", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    const input = isMultipartRequest(request)
      ? await parseCapabilityMultipart(request)
      : parseCapabilityJson(request.body);
    const preview = await options.service.previewUpdatePackage(
      actor,
      id,
      input,
    );
    return reply.code(202).send(ok(preview, request));
  });

  app.post("/:id/logo", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    if (!isMultipartRequest(request)) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const upload = await readSingleUpload(request, 2 * 1024 * 1024);
    const result = await options.service.replaceLogo(
      actor,
      id,
      upload.bytes,
      upload.filename,
    );
    return reply.send(ok(result, request));
  });

  app.patch("/:id/preference", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = capabilityIdParams.parse(request.params);
    const body = z
      .strictObject({ status: z.enum(["enabled", "disabled"]) })
      .parse(request.body);
    return reply.send(
      ok(await options.service.setPreference(actor, id, body.status), request),
    );
  });
};

function parseCapabilityJson(body: unknown): {
  source: CapabilityImportSource;
  requestedType?: "plugin" | "skill";
} {
  const value = manualImportSchema.parse(body);
  return {
    source: {
      kind: "manual_skill",
      name: value.name,
      displayName: value.display_name,
      ...(value.description === undefined
        ? {}
        : { description: value.description }),
      skillMarkdown: value.skill_markdown,
    },
    requestedType: "skill",
  };
}

async function parseCapabilityMultipart(request: FastifyRequest): Promise<{
  source: CapabilityImportSource;
  requestedType?: "plugin" | "skill";
}> {
  const fields: Record<string, string> = {};
  let upload: { bytes: Buffer; filename: string } | null = null;
  for await (const part of request.parts()) {
    if (part.type === "file") {
      if (upload !== null) {
        part.file.resume();
        throw new AppError("INVALID_PACKAGE");
      }
      upload = {
        bytes: await part.toBuffer(),
        filename: part.filename,
      };
    } else {
      if (
        fields[part.fieldname] !== undefined ||
        typeof part.value !== "string"
      ) {
        throw new AppError("VALIDATION_ERROR");
      }
      fields[part.fieldname] = part.value;
    }
  }
  if (upload === null) throw new AppError("INVALID_PACKAGE");
  const metadata = z
    .strictObject({
      type: z.enum(["plugin", "skill"]).optional(),
    })
    .parse(fields);
  return {
    source: { kind: "zip", bytes: upload.bytes, filename: upload.filename },
    ...(metadata.type === undefined ? {} : { requestedType: metadata.type }),
  };
}

async function readSingleUpload(
  request: FastifyRequest,
  maxBytes: number,
): Promise<{ bytes: Buffer; filename: string }> {
  let upload: { bytes: Buffer; filename: string } | null = null;
  for await (const part of request.parts()) {
    if (part.type !== "file") continue;
    if (upload !== null) {
      part.file.resume();
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    const bytes = await part.toBuffer();
    if (bytes.length === 0 || bytes.length > maxBytes) {
      throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
    }
    upload = { bytes, filename: part.filename };
  }
  if (upload === null) throw new AppError("CAPABILITY_LOGO_UPLOAD_INVALID");
  return upload;
}

interface AuthenticatedRequestCarrier {
  authUser?: {
    id?: unknown;
    role?: unknown;
    status?: unknown;
  };
}

interface MultipartRequestCarrier {
  isMultipart?: () => boolean;
}

function isMultipartRequest(request: FastifyRequest): boolean {
  const candidate = (request as unknown as MultipartRequestCarrier).isMultipart;
  return typeof candidate === "function" && candidate.call(request);
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
