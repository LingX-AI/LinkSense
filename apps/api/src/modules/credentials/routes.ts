import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import {
  createCredentialInputSchema,
  credentialPluginConfigurationSchema,
  credentialEnvironmentKeySchema,
  credentialProviderTypeSchema,
  credentialSecretPayloadSchema,
  syncCredentialBindingsInputSchema,
} from "@linksense/shared";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { ok } from "../../lib/http.js";
import type { ResolveRequestActor } from "../capabilities/types.js";
import type { CredentialService } from "./service.js";
import type { RequestActor } from "./types.js";

export interface CredentialRoutesOptions {
  service: CredentialService;
  resolveActor?: ResolveRequestActor;
}

const uuid = z.string().uuid();
const credentialParams = z.strictObject({ id: uuid });
const bindingParams = z.strictObject({ id: uuid });
const credentialSecretValueSchema = z
  .string()
  .min(1)
  .max(64 * 1024);
const credentialSecretFieldPatchSchema = z.strictObject({
  key: credentialEnvironmentKeySchema,
  previous_key: credentialEnvironmentKeySchema.optional(),
  value: credentialSecretValueSchema.optional(),
});
const patchCredentialInputSchema = z
  .strictObject({
    name: z.string().trim().min(1).max(160).optional(),
    provider_type: credentialProviderTypeSchema.optional(),
    secret_payload: credentialSecretPayloadSchema.optional(),
    secret_fields: z
      .array(credentialSecretFieldPatchSchema)
      .min(1)
      .max(200)
      .optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0)
  .refine(
    (value) =>
      value.secret_payload === undefined || value.secret_fields === undefined,
  );

export const credentialRoutes: FastifyPluginAsync<
  CredentialRoutesOptions
> = async (app, options) => {
  const actorFor = options.resolveActor ?? defaultActorResolver;

  app.get("/", async (request, reply) => {
    const actor = await actorFor(request);
    z.strictObject({}).parse(request.query);
    return reply.send(
      ok({ items: await options.service.list(actor) }, request),
    );
  });

  app.post("/", async (request, reply) => {
    const actor = await actorFor(request);
    const body = createCredentialInputSchema.parse(request.body);
    const created = await options.service.create(actor, {
      name: body.name,
      providerType: body.provider_type,
      secretPayload: body.secret_payload,
    });
    return reply.code(201).send(ok(created, request));
  });

  app.get("/bindings", async (request, reply) => {
    const actor = await actorFor(request);
    return reply.send(
      ok({ items: await options.service.listBindings(actor) }, request),
    );
  });

  app.get("/plugin-configurations", async (request, reply) => {
    const actor = await actorFor(request);
    z.strictObject({}).parse(request.query);
    const items = await options.service.listPluginConfigurations(actor);
    return reply.send(
      ok(
        {
          items: z.array(credentialPluginConfigurationSchema).parse(items),
        },
        request,
      ),
    );
  });

  app.put("/bindings", async (request, reply) => {
    const actor = await actorFor(request);
    const body = syncCredentialBindingsInputSchema.parse(request.body);
    const items = await options.service.syncBindings(actor, {
      credentialId: body.credential_id,
      capabilityId: body.capability_id,
      mappings: body.mappings.map((mapping) => ({
        envKey: mapping.env_key,
        credentialKey: mapping.credential_key,
      })),
    });
    return reply.send(ok({ items }, request));
  });

  app.delete("/bindings", async (request, reply) => {
    const actor = await actorFor(request);
    const query = z
      .strictObject({ credential_id: uuid, capability_id: uuid })
      .parse(request.query);
    await options.service.revokePluginBindings(
      actor,
      query.credential_id,
      query.capability_id,
    );
    return reply.code(204).send();
  });

  app.delete("/bindings/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = bindingParams.parse(request.params);
    await options.service.revokeBinding(actor, id);
    return reply.code(204).send();
  });

  app.get("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = credentialParams.parse(request.params);
    return reply.send(ok(await options.service.get(actor, id), request));
  });

  app.patch("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = credentialParams.parse(request.params);
    const body = patchCredentialInputSchema.parse(request.body);
    const updated = await options.service.patch(actor, id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.provider_type === undefined
        ? {}
        : { providerType: body.provider_type }),
      ...(body.secret_payload === undefined
        ? {}
        : { secretPayload: body.secret_payload }),
      ...(body.secret_fields === undefined
        ? {}
        : {
            secretFields: body.secret_fields.map((field) => ({
              key: field.key,
              ...(field.previous_key === undefined
                ? {}
                : { previousKey: field.previous_key }),
              ...(field.value === undefined ? {} : { value: field.value }),
            })),
          }),
      ...(body.status === undefined ? {} : { status: body.status }),
    });
    return reply.send(ok(updated, request));
  });

  app.delete("/:id", async (request, reply) => {
    const actor = await actorFor(request);
    const { id } = credentialParams.parse(request.params);
    await options.service.delete(actor, id);
    return reply.code(204).send();
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
