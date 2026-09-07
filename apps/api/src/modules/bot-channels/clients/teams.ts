import { ClientSecretCredential } from "@azure/identity";
import {
  App,
  type AppOptions,
  type IPlugin,
  type HttpRouteHandler,
} from "@microsoft/teams.apps";
import type { Redis } from "ioredis";
import { z } from "zod";
import { decryptJson, encryptJson, sha256 } from "../../../lib/crypto.js";
import type { ChannelEncryption } from "../state.js";
import {
  ChannelProtocolError,
  type ChannelConnectInput,
  type ChannelSession,
} from "../types.js";
import {
  projectChannelMessage,
  validTeamsServiceUrl,
} from "./message-projection.js";

type TeamsLogger = NonNullable<AppOptions<IPlugin>["logger"]>;

export async function connectTeams(
  input: ChannelConnectInput,
  redis: Redis,
  encryption: ChannelEncryption,
): Promise<ChannelSession> {
  const credentials = input.credentials;
  if (credentials.provider !== "teams")
    throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
  const identity = new ClientSecretCredential(
    credentials.tenant_id,
    credentials.client_id,
    credentials.client_secret,
    { retryOptions: { maxRetries: 1 } },
  );
  // SDK debug logs contain entire activities. Persist only our stable errors.
  const logger: TeamsLogger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    // Invalid public callback tokens must not change the owner's connection state.
    error: () => undefined,
    trace: () => undefined,
    log: () => undefined,
    child: () => logger,
  };
  const storageKey = (key: unknown) =>
    `linksense:bot-channel-sdk:${input.id}:${sha256(z.string().max(2048).parse(key))}`;
  const options: AppOptions<IPlugin> = {
    clientId: credentials.client_id,
    tenantId: credentials.tenant_id,
    clientSecret: "",
    token: async (scopes, tenantId) => {
      if (
        tenantId &&
        tenantId.toLowerCase() !== credentials.tenant_id.toLowerCase()
      )
        throw new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED");
      const token = await identity.getToken(scopes, {
        abortSignal: AbortSignal.any([
          input.signal,
          AbortSignal.timeout(15_000),
        ]),
      });
      return token.token;
    },
    dangerouslyAllowUnauthenticatedRequests: false,
    skipAuth: false,
    activity: { mentions: { stripText: false } },
    client: { timeout: 15_000, logger },
    logger,
    storage: {
      get: async (key: unknown) => {
        const name = storageKey(key);
        const value = await redis.get(name);
        return value
          ? z
              .json()
              .parse(
                decryptJson(
                  value,
                  encryption.masterKey,
                  encryption.keyId,
                  name,
                ),
              )
          : undefined;
      },
      set: async (key: unknown, value: unknown) => {
        const serialized = JSON.stringify(value);
        if (!serialized || serialized.length > 200_000)
          throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
        const name = storageKey(key);
        await redis.set(
          name,
          encryptJson(
            z.json().parse(JSON.parse(serialized)),
            encryption.masterKey,
            encryption.keyId,
            name,
          ),
          "EX",
          86_400,
        );
      },
      delete: async (key: unknown) => {
        await redis.del(storageKey(key));
      },
    },
  };
  let handler: HttpRouteHandler | undefined;
  let closed = false;
  const app = new App({
    ...options,
    httpServerAdapter: {
      registerRoute: (method, path, route) => {
        if (method !== "POST" || path !== "/api/messages")
          throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
        handler = route;
      },
      stop: async () => undefined,
    },
  });
  app.on("message", async ({ activity }) => {
    const message = projectChannelMessage(credentials, activity);
    if (message) await input.onMessage(message);
  });
  await app.initialize();
  return {
    isConnected: () => !closed,
    close: async () => {
      closed = true;
      await app.stop();
    },
    handleRequest: async (request) => {
      if (!handler || closed || input.signal.aborted) return { status: 503 };
      const shape = z.object({ type: z.string() }).safeParse(request.body);
      if (!shape.success) return { status: 400 };
      const result = await handler(request);
      if (result.status >= 500)
        input.onError(
          new ChannelProtocolError("BOT_CHANNEL_CONNECTION_FAILED"),
        );
      return result.status >= 400 ? { status: result.status } : result;
    },
    send: async (context, text) => {
      if (
        context.provider !== "teams" ||
        !validTeamsServiceUrl(context.serviceUrl)
      )
        throw new ChannelProtocolError("BOT_CHANNEL_PROTOCOL_INVALID");
      // Use the authenticated, persisted regional service URL after restarts too.
      const sender = new App({ ...options, serviceUrl: context.serviceUrl });
      await sender.send(context.chatId, {
        type: "message",
        text,
        textFormat: "plain",
      });
    },
  };
}
