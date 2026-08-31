import {
  Client,
  Domain,
  LoggerLevel,
  createLarkChannel,
  defaultHttpInstance,
  registerApp,
  type LarkChannel,
  type NormalizedMessage,
} from "@larksuiteoapi/node-sdk";
import { z } from "zod";

import type { FeishuCredentials } from "./state.js";

const registrationResultSchema = z.strictObject({
  client_id: z.string().regex(/^cli_[a-zA-Z0-9]{8,60}$/u),
  client_secret: z.string().min(1).max(16_384),
  user_info: z
    .strictObject({
      open_id: z.string().min(1).max(128),
      tenant_brand: z.enum(["feishu", "lark"]).optional(),
    })
    .optional(),
});

const feishuMessageSchema = z.strictObject({
  messageId: z.string().min(1).max(240),
  chatId: z.string().min(1).max(128),
  chatType: z.enum(["p2p", "group"]),
  senderId: z.string().min(1).max(128),
  content: z.string().max(1_000_000),
  rawContentType: z.string().max(80),
  createTime: z.number().finite(),
});

type RegisterApp = typeof registerApp;

export const FEISHU_PERSONAL_AGENT_SCOPES = [
  "application:application:patch",
  "im:message.p2p_msg:readonly",
  "im:message:send_as_bot",
] as const;
export const FEISHU_MESSAGE_EVENT = "im.message.receive_v1";

export const FEISHU_HTTP_TIMEOUT_MS = 15_000;
defaultHttpInstance.defaults.timeout = FEISHU_HTTP_TIMEOUT_MS;

type FeishuRestClient = {
  im: {
    message: {
      create(input: {
        params: { receive_id_type: "chat_id" };
        data: {
          receive_id: string;
          msg_type: "text";
          content: string;
          uuid: string;
        };
      }): Promise<{ code?: number | undefined }>;
    };
  };
};

type CreateRestClient = (credentials: FeishuCredentials) => FeishuRestClient;

type FeishuApplicationClient = {
  application: {
    scope: {
      list(input: Record<string, never>): Promise<{
        code?: number | undefined;
        data?: {
          scopes?:
            | Array<{
                scope_name: string;
                grant_status: number;
                scope_type?: "user" | "tenant" | undefined;
              }>
            | undefined;
        } | undefined;
      }>;
    };
    v7: {
      applicationConfig: {
        patch(input: {
          data: {
            event: {
              subscription_type: "websocket";
              add_events: string[];
            };
          };
          path: { app_id: string };
        }): Promise<{ code?: number | undefined }>;
      };
    };
  };
};

type CreateApplicationClient = (
  credentials: FeishuCredentials,
) => FeishuApplicationClient;

export type FeishuRegistrationResult = {
  appId: string;
  appSecret: string;
  ownerOpenId: string;
  domain: "feishu" | "lark";
};

export type FeishuInboundText = {
  messageKey: string;
  chatId: string;
  senderOpenId: string;
  text: string;
  receivedAt: Date;
};

export type FeishuChannelConnection = {
  botName: string | null;
  close(): Promise<void>;
};

export class FeishuProtocolError extends Error {
  constructor(
    readonly reasonCode:
      | "FEISHU_REGISTRATION_UNAVAILABLE"
      | "FEISHU_PROTOCOL_INVALID"
      | "FEISHU_UPSTREAM_REJECTED"
      | "FEISHU_CONNECTION_FAILED"
      | "FEISHU_CONFIGURATION_FAILED"
      | "FEISHU_REAUTHORIZATION_REQUIRED",
    options?: { cause?: unknown },
  ) {
    super(reasonCode, options);
    this.name = "FeishuProtocolError";
  }
}

export class FeishuOfficialClient {
  private readonly restClients = new Map<string, FeishuRestClient>();

  constructor(
    private readonly registerAppImpl: RegisterApp = registerApp,
    private readonly createChannelImpl: typeof createLarkChannel =
      createLarkChannel,
    private readonly createRestClientImpl: CreateRestClient =
      createOfficialRestClient,
    private readonly createApplicationClientImpl: CreateApplicationClient =
      createOfficialApplicationClient,
  ) {}

  async registerPersonalAgent(input: {
    signal: AbortSignal;
    appName: string;
    appDescription: string;
    existingAppId?: string;
    allowExistingSelection?: boolean;
    onQrCodeReady(info: { url: string; expireIn: number }): void;
  }): Promise<FeishuRegistrationResult> {
    try {
      const raw = await this.registerAppImpl({
        source: "linksense",
        signal: input.signal,
        ...(input.existingAppId
          ? { appId: input.existingAppId }
          : input.allowExistingSelection
            ? {}
            : { createOnly: true }),
        addons: {
          preset: false,
          scopes: { tenant: [...FEISHU_PERSONAL_AGENT_SCOPES] },
          events: { items: { tenant: [FEISHU_MESSAGE_EVENT] } },
        },
        appPreset: {
          name: input.appName,
          desc: input.appDescription,
        },
        onQRCodeReady: input.onQrCodeReady,
      });
      const result = registrationResultSchema.parse(raw);
      if (
        input.existingAppId &&
        result.client_id !== input.existingAppId
      ) {
        throw new FeishuProtocolError("FEISHU_PROTOCOL_INVALID");
      }
      const ownerOpenId = result.user_info?.open_id;
      if (!ownerOpenId) {
        throw new FeishuProtocolError("FEISHU_PROTOCOL_INVALID");
      }
      const registration: FeishuRegistrationResult = {
        appId: result.client_id,
        appSecret: result.client_secret,
        ownerOpenId,
        domain: result.user_info?.tenant_brand ?? "feishu",
      };
      return registration;
    } catch (error) {
      if (error instanceof FeishuProtocolError) throw error;
      if (error instanceof z.ZodError) {
        throw new FeishuProtocolError("FEISHU_PROTOCOL_INVALID", {
          cause: error,
        });
      }
      throw new FeishuProtocolError("FEISHU_REGISTRATION_UNAVAILABLE", {
        cause: error,
      });
    }
  }

  async connect(input: {
    credentials: FeishuCredentials;
    ownerOpenId: string;
    onMessage(message: FeishuInboundText): Promise<void>;
    onError(error: unknown): void;
    onReconnecting(): void;
    onReconnected(): void;
  }): Promise<FeishuChannelConnection> {
    await this.preparePersonalAgent(input.credentials);
    const channel = this.createChannelImpl({
      appId: input.credentials.appId,
      appSecret: input.credentials.appSecret,
      domain: resolveDomain(input.credentials.domain),
      source: "linksense",
      handshakeTimeoutMs: 15_000,
      policy: {
        dmMode: "allowlist",
        dmAllowlist: [input.ownerOpenId],
        groupAllowlist: ["__linksense_personal_agent_direct_messages_only__"],
        requireMention: true,
      },
      safety: {
        staleMessageWindowMs: 10 * 60_000,
        chatQueue: { enabled: true },
      },
      outbound: {
        retry: { maxAttempts: 3, baseDelayMs: 500 },
      },
      loggerLevel: LoggerLevel.warn,
    });
    channel.on({
      message: async (message) => {
        const inbound = projectInboundMessage(message, input.ownerOpenId);
        if (inbound) await input.onMessage(inbound);
      },
      error: input.onError,
      reconnecting: input.onReconnecting,
      reconnected: input.onReconnected,
    });
    try {
      await channel.connect();
    } catch (error) {
      await channel.disconnect().catch(() => undefined);
      throw new FeishuProtocolError("FEISHU_CONNECTION_FAILED", {
        cause: error,
      });
    }
    return {
      botName: channel.botIdentity?.name?.trim().slice(0, 120) || null,
      close: () => channel.disconnect(),
    };
  }

  async preparePersonalAgent(credentials: FeishuCredentials): Promise<void> {
    const client = this.createApplicationClientImpl(credentials);
    try {
      const scopes = await client.application.scope.list({});
      if (scopes.code !== undefined && scopes.code !== 0) {
        throw new FeishuProtocolError("FEISHU_CONFIGURATION_FAILED");
      }
      const grantedScopes = new Set(
        scopes.data?.scopes
          ?.filter(
            (scope) =>
              scope.grant_status === 1 &&
              (scope.scope_type === undefined || scope.scope_type === "tenant"),
          )
          .map((scope) => scope.scope_name) ?? [],
      );
      if (
        FEISHU_PERSONAL_AGENT_SCOPES.some(
          (scope) => !grantedScopes.has(scope),
        )
      ) {
        throw new FeishuProtocolError("FEISHU_REAUTHORIZATION_REQUIRED");
      }

      const configured = await client.application.v7.applicationConfig.patch({
        data: {
          event: {
            subscription_type: "websocket",
            add_events: [FEISHU_MESSAGE_EVENT],
          },
        },
        path: { app_id: credentials.appId },
      });
      if (configured.code !== undefined && configured.code !== 0) {
        throw new FeishuProtocolError("FEISHU_CONFIGURATION_FAILED");
      }
    } catch (error) {
      if (error instanceof FeishuProtocolError) throw error;
      throw new FeishuProtocolError("FEISHU_CONFIGURATION_FAILED", {
        cause: error,
      });
    }
  }

  async sendText(input: {
    credentials: FeishuCredentials;
    chatId: string;
    text: string;
    idempotencyKey: string;
  }): Promise<void> {
    const client = this.#restClient(input.credentials);
    try {
      const response = await client.im.message.create({
        params: { receive_id_type: "chat_id" },
        data: {
          receive_id: input.chatId,
          msg_type: "text",
          content: JSON.stringify({ text: input.text }),
          uuid: input.idempotencyKey,
        },
      });
      if (response.code !== undefined && response.code !== 0) {
        throw new FeishuProtocolError("FEISHU_UPSTREAM_REJECTED");
      }
    } catch (error) {
      if (error instanceof FeishuProtocolError) throw error;
      throw new FeishuProtocolError("FEISHU_UPSTREAM_REJECTED", {
        cause: error,
      });
    }
  }

  forgetApp(appId: string, domain: FeishuCredentials["domain"]): void {
    this.restClients.delete(`${domain}:${appId}`);
  }

  #restClient(credentials: FeishuCredentials): FeishuRestClient {
    const cacheKey = `${credentials.domain}:${credentials.appId}`;
    const existing = this.restClients.get(cacheKey);
    if (existing) return existing;
    const created = this.createRestClientImpl(credentials);
    this.restClients.set(cacheKey, created);
    return created;
  }

}

export function splitFeishuText(text: string, maximumLength = 4_000): string[] {
  if (!Number.isInteger(maximumLength) || maximumLength < 1) {
    throw new Error("FEISHU_TEXT_CHUNK_SIZE_INVALID");
  }
  const normalized = text.trim();
  if (!normalized) return [];
  const chunks: string[] = [];
  let remaining = normalized;
  while (remaining.length > maximumLength) {
    const candidate = remaining.slice(0, maximumLength);
    const boundary = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf("。"));
    const splitAt = boundary >= Math.floor(maximumLength / 2) ? boundary + 1 : maximumLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function projectInboundMessage(
  message: NormalizedMessage,
  ownerOpenId: string,
): FeishuInboundText | null {
  const parsed = feishuMessageSchema.safeParse({
    messageId: message.messageId,
    chatId: message.chatId,
    chatType: message.chatType,
    senderId: message.senderId,
    content: message.content,
    rawContentType: message.rawContentType,
    createTime: message.createTime,
  });
  if (!parsed.success) return null;
  const value = parsed.data;
  if (
    value.chatType !== "p2p" ||
    value.senderId !== ownerOpenId ||
    value.rawContentType !== "text" ||
    !value.content.trim()
  ) {
    return null;
  }
  return {
    messageKey: value.messageId,
    chatId: value.chatId,
    senderOpenId: value.senderId,
    text: value.content.trim(),
    receivedAt: new Date(value.createTime),
  };
}

function resolveDomain(domain: FeishuCredentials["domain"]): Domain {
  return domain === "lark" ? Domain.Lark : Domain.Feishu;
}

function createOfficialRestClient(
  credentials: FeishuCredentials,
): FeishuRestClient {
  return new Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: resolveDomain(credentials.domain),
    loggerLevel: LoggerLevel.warn,
    source: "linksense",
  });
}

function createOfficialApplicationClient(
  credentials: FeishuCredentials,
): FeishuApplicationClient {
  return new Client({
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    domain: resolveDomain(credentials.domain),
    loggerLevel: LoggerLevel.warn,
    source: "linksense",
  });
}

export type { LarkChannel };
